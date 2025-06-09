// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};
use cfg_if::cfg_if;
use earn::{
    state::{Global as EarnGlobal, GLOBAL_SEED as EARN_GLOBAL_SEED},
    ID as EARN_PROGRAM,
};
use switchboard_on_demand::{on_demand::accounts::pull_feed::PullFeedAccountData, sb_pid};

// local dependencies
use crate::{
    constants::ANCHOR_DISCRIMINATOR_SIZE,
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED},
};

#[cfg(feature = "ibt")]
use crate::utils::conversion::set_ibt_rate;

// conditional dependencies
cfg_if! {
    if #[cfg(feature = "ibt")] {
        use anchor_spl::token_2022_extensions::spl_pod::optional_keys::OptionalNonZeroPubkey;
        use spl_token_2022::extension::{
            interest_bearing_mint::InterestBearingConfig, BaseStateWithExtensions, ExtensionType,
            StateWithExtensions,
        };
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = ANCHOR_DISCRIMINATOR_SIZE + ExtGlobal::INIT_SPACE,
        seeds = [EXT_GLOBAL_SEED],
        bump
    )]
    pub global_account: Account<'info, ExtGlobal>,

    #[account(
        mint::token_program = m_token_program,
        address = m_earn_global_account.mint,
    )]
    pub m_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        mint::token_program = ext_token_program,
        mint::decimals = m_mint.decimals,
        constraint = ext_mint.supply == 0 @ ExtError::InvalidMint,
    )]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Validated by the seeds, stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        bump
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    /// CHECK: Validated by the seeds, stores no data
    #[account(
        seeds = [M_VAULT_SEED],
        bump
    )]
    pub m_vault: AccountInfo<'info>,

    #[account(
        associated_token::mint = m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = m_token_program,
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [EARN_GLOBAL_SEED],
        seeds::program = EARN_PROGRAM,
        bump = m_earn_global_account.bump,
    )]
    pub m_earn_global_account: Account<'info, EarnGlobal>,

    #[cfg(feature = "ibt")]
    #[account(owner = sb_pid())]
    pub rate_feed: AccountInfo<'info>,

    pub m_token_program: Program<'info, Token2022>, // we have duplicate entries for the token2022 program bc the M token program could change in the future

    pub ext_token_program: Program<'info, Token2022>,

    pub system_program: Program<'info, System>,
}

impl Initialize<'_> {
    // This instruction initializes the program to make the provided ext_mint into an M extension
    fn validate(&self, wrap_authorities: &[Pubkey]) -> Result<()> {
        // Validate the ext_mint_authority PDA is the mint authority for the ext mint
        let ext_mint_authority = self.ext_mint_authority.key();
        if self.ext_mint.mint_authority.unwrap_or_default() != ext_mint_authority {
            return err!(ExtError::InvalidMint);
        }

        // Validate that the ext mint has a freeze authority
        if self.ext_mint.freeze_authority.is_none() {
            return err!(ExtError::InvalidMint);
        }

        // Validate and create the wrap authorities array
        if wrap_authorities.len() > 10 {
            return err!(ExtError::InvalidParam);
        }

        cfg_if! {
            if #[cfg(feature = "ibt")] {
                // Validate that the ext mint has the InterestBearing extension and
                // that the ext mint authority is the rate authority
                {
                    // explicit scope to drop the borrow at the end of the code block
                    let ext_account_info = &self.ext_mint.to_account_info();
                    let ext_data = ext_account_info.try_borrow_data()?;
                    let ext_mint_data =
                        StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&ext_data)?;
                    let extensions = ext_mint_data.get_extension_types()?;

                    if !extensions.contains(&ExtensionType::InterestBearingConfig) {
                        return err!(ExtError::InvalidMint);
                    }

                    let interest_bearing_config = ext_mint_data.get_extension::<InterestBearingConfig>()?;
                    if interest_bearing_config.rate_authority != OptionalNonZeroPubkey(ext_mint_authority) {
                        return err!(ExtError::InvalidMint);
                    }
                }

                // Validate oracle
                #[cfg(feature = "ibt")]
                {
                    let feed_account = self.rate_feed.data.borrow();
                    let feed = PullFeedAccountData::parse(feed_account)
                        .map_err(|_| ExtError::InvalidSwitchboardFeed)?;

                    let value = feed.value(&Clock::get().unwrap())
                        .map_err(|_| ExtError::InvalidSwitchboardFeed)?;

                    if value.is_sign_negative() || value.gt(&u16::MAX.into()) {
                        return err!(ExtError::InvalidSwitchboardFeed);
                    }
                }

                // TODO: Validate that the rate on the ext_mint prior to this has been zero?
            }
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&wrap_authorities))]
    pub fn handler(ctx: Context<Initialize>, wrap_authorities: Vec<Pubkey>) -> Result<()> {
        let mut wrap_authorities_array = [Pubkey::default(); 10];
        for (i, authority) in wrap_authorities.iter().enumerate() {
            if wrap_authorities_array.contains(authority) {
                return err!(ExtError::InvalidParam);
            }
            wrap_authorities_array[i] = *authority;
        }

        // Initialize the ExtGlobal account
        ctx.accounts.global_account.set_inner(ExtGlobal {
            admin: ctx.accounts.admin.key(),
            ext_mint: ctx.accounts.ext_mint.key(),
            m_mint: ctx.accounts.m_mint.key(),
            m_earn_global_account: ctx.accounts.m_earn_global_account.key(),
            bump: ctx.bumps.global_account,
            m_vault_bump: ctx.bumps.m_vault,
            ext_mint_authority_bump: ctx.bumps.ext_mint_authority,
            wrap_authorities: wrap_authorities_array,
        });

        // If an IBT extension, set the initial rate
        #[cfg(feature = "ibt")]
        {
            let feed_account = ctx.accounts.rate_feed.data.borrow();
            let feed = PullFeedAccountData::parse(feed_account).unwrap();
            let rate = feed.value(&Clock::get().unwrap()).unwrap();

            set_ibt_rate(
                &mut ctx.accounts.ext_mint,
                &ctx.accounts.ext_token_program,
                &ctx.accounts.ext_mint_authority,
                &[&[MINT_AUTHORITY_SEED, &[ctx.bumps.ext_mint_authority]]],
                rate.to_u16(),
            )?;
        }

        Ok(())
    }
}

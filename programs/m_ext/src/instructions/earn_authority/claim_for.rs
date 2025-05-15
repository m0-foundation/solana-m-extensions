// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, TokenAccount, TokenInterface};
use earn::instructions::claim_for::RewardsClaim;

// local dependencies
use crate::{
    constants::ONE_HUNDRED_PERCENT_U64,
    errors::ExtError,
    state::{
        Config, EarnManager, Earner, ExtConfig, YieldConfig, CONFIG_SEED, EARNER_SEED_PREFIX,
        EARN_MANAGER_SEED_PREFIX, EXT_CONFIG_SEED_PREFIX, MINT_AUTHORITY_SEED_PREFIX,
        M_VAULT_SEED_PREFIX,
    },
    utils::token::mint_tokens,
};

#[derive(Accounts)]
pub struct ClaimFor<'info> {
    pub earn_authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = m_mint @ ExtError::InvalidMint,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        has_one = ext_mint @ ExtError::InvalidMint,
        constraint = if let YieldConfig::Manual(manual_config) = ext_config.yield_config {
            manual_config.earn_authority == earn_authority.key()
        } else {
            false
        } @ ExtError::NotAuthorized,
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.bump,
    )]
    pub ext_config: Account<'info, ExtConfig>,

    #[account(mut)]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.ext_mint_authority_bump,
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.m_vault_bump,
    )]
    pub m_vault_account: AccountInfo<'info>,

    #[account(
        associated_token::mint = config.m_mint,
        associated_token::authority = m_vault_account,
        associated_token::token_program = token_2022,
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        address = match earner_account.recipient_token_account {
            Some(token_account) => token_account,
            None => earner_account.user_token_account,
        } @ ExtError::InvalidAccount,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [EARNER_SEED_PREFIX, ext_mint.key().as_ref(), earner_account.user_token_account.as_ref()],
        bump = earner_account.bump,
    )]
    pub earner_account: Account<'info, Earner>,

    #[account(
        seeds = [EARN_MANAGER_SEED_PREFIX, ext_mint.key().as_ref(), earner_account.earn_manager.as_ref()],
        bump = earn_manager_account.bump,
    )]
    pub earn_manager_account: Account<'info, EarnManager>,

    /// CHECK: we validate this manually in the handler so we can skip it
    /// if the token account has been closed or is not initialized
    /// This prevents DoSing earner yield by closing this account
    #[account(
        mut,
        address = earn_manager_account.fee_token_account @ ExtError::InvalidAccount,
    )]
    pub earn_manager_token_account: AccountInfo<'info>,

    pub ext_token_program: Interface<'info, TokenInterface>,
}

impl<'info> ClaimFor<'info> {
    fn validate(&self) -> Result<()> {
        // Revert if extension is not crank based
        match self.ext_config.yield_config {
            YieldConfig::Manual(manual_config) => match manual_config.manual_type {
                ManualType::Crank => {}
                _ => {
                    return err!(ExtError::InstructionNotSupported);
                }
            },
            _ => {
                return err!(ExtError::InstructionNotSupported);
            }
        }

        // Validate that the earner account has not already claimed this cycle
        // Earner index should never be > global index, but we check to be safe against an error with index propagation
        if ctx.accounts.earner_account.last_claim_index >= ctx.accounts.ext_config.last_ext_index {
            return err!(ExtError::AlreadyClaimed);
        }

        // Validate that the earn manager is active
        if !self.earn_manager_account.is_active {
            return err!(ExtError::NotActive);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>, snapshot_balance: u64) -> Result<()> {
        let manual_config = match &ctx.accounts.ext_config.yield_config {
            YieldConfig::Manual(config) => config,
            _ => unreachable!(),
        };

        // Calculate the amount of tokens to send to the user
        // Cast to u128 for multiplication to avoid overflows
        let mut rewards: u64 = (snapshot_balance as u128)
            .checked_mul(manual_config.ext_index as u128)
            .unwrap()
            .checked_div(ctx.accounts.earner_account.last_claim_index as u128)
            .unwrap()
            .try_into()
            .unwrap();

        rewards -= snapshot_balance; // can't underflow because global index > last claim index

        // Validate that the newly minted rewards will not make the extension undercollateralized
        let ext_supply = ctx.accounts.ext_mint.supply;
        let ext_collateral = ctx.accounts.vault_m_token_account.amount;

        if ext_supply + rewards > ext_collateral {
            return err!(ExtError::InsufficientCollateral);
        }

        // Set the earner's last claim index to the global index and update the last claim timestamp
        ctx.accounts.earner_account.last_claim_index = manual_config.ext_index;
        ctx.accounts.earner_account.last_claim_timestamp = manual_config.ext_timestamp;

        // Setup the signer seeds for the mint CPI(s)
        let mint_authority_seeds: &[&[&[u8]]] = &[&[
            MINT_AUTHORITY_SEED_PREFIX,
            ctx.accounts.ext_mint.key().as_ref(),
            &[ctx.accounts.ext_config.ext_mint_authority_bump],
        ]];

        // Calculate the earn manager fee if applicable and subtract from the earner's rewards
        // If the earn manager is not active, then no fee is taken
        let fee = self.handle_fee(&ctx, rewards, mint_authority_seeds)?;

        rewards -= fee;

        // Mint the tokens to the user's token aaccount
        mint_tokens(
            &ctx.accounts.user_token_account, // to
            rewards,                          // amount
            &ctx.accounts.ext_mint,           // mint
            &ctx.accounts.ext_mint_authority, // authority
            mint_authority_seeds,             // authority seeds
            &ctx.accounts.ext_token_program,  // token program
        )?;

        emit!(RewardsClaim {
            token_account: ctx.accounts.earner_account.user_token_account,
            recipient_token_account: ctx.accounts.user_token_account.key(),
            amount: rewards,
            fee,
            ts: ctx.accounts.earner_account.last_claim_timestamp,
            index: ctx.accounts.earner_account.last_claim_index,
        });

        Ok(())
    }

    fn handle_fee(
        ctx: &Context<Self>,
        rewards: u64,
        mint_authority_seeds: &[&[&[u8]]],
    ) -> Result<u64> {
        // Calculate the earn manager fee if applicable and subtract from the earner's rewards
        // If the earn manager doesn't charge a fee or is not active, then no fee is taken
        if ctx.accounts.earn_manager_account.fee_bps == 0
            || !ctx.accounts.earn_manager_account.is_active
        {
            return Ok(0);
        }

        // If the earn manager token account is not initialized, then no fee is taken
        if ctx.accounts.earn_manager_token_account.owner != &ctx.accounts.ext_token_program.key()
            || ctx.accounts.earn_manager_token_account.lamports() == 0
        {
            return Ok(0);
        }

        // Fees are rounded down in favor of the user
        let fee = (rewards * ctx.accounts.earn_manager_account.fee_bps) / ONE_HUNDRED_PERCENT_U64;

        // Return early if the fee rounds to zero
        if fee == 0 {
            return Ok(0);
        }

        // mint tokens to the earn manager token account
        // we don't use the helper function due to lifetime issues
        let mint_options = MintTo {
            mint: ctx.accounts.ext_mint.to_account_info(),
            to: ctx.accounts.earn_manager_token_account.clone(),
            authority: ctx.accounts.ext_mint_authority.clone(),
        };

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.ext_token_program.to_account_info(),
            mint_options,
            mint_authority_seeds,
        );

        mint_to(cpi_context, fee)?;

        Ok(fee)
    }
}

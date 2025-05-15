use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::{
    errors::ExtError,
    state::{
        Config, CONFIG_SEED,
        ExtConfig, EXT_CONFIG_SEED_PREFIX,
        MINT_AUTHORITY_SEED_PREFIX,
        M_VAULT_SEED_PREFIX,
    },
    utils::{
        token::{
            burn_tokens,
            mint_tokens,
            transfer_tokens_from_program
        },
        conversion::{
            check_solvency,
            sync_multiplier,
        }
    }
};

#[derive(Accounts)]
pub struct Swap<'info> {
    pub user: Signer<'info>,

    pub m_mint: InterfaceAccount<'info, Mint>,

    pub m_earn_global_account: Account<'info, EarnGlobal>,

    #[account(
        has_one = m_mint @ ExtError::InvalidMint,
        has_one = m_earn_global_account @ ExtError::InvalidAccount,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub from_ext_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        has_one = from_ext_mint,
        seeds = [EXT_CONFIG_SEED_PREFIX, from_ext_mint.key().as_ref()],
        bump = from_ext_global.bump,
    )]
    pub from_ext_config: Account<'info, ExtConfig>,

    /// CHECK: The account is checked by the seeds and holds no data.
    #[account(
        seeds = [M_VAULT_SEED_PREFIX, from_ext_mint.key().as_ref()],
        bump = from_ext_global.m_vault_bump,
    )]
    pub from_m_vault: AccountInfo<'info>,

    #[account(mut)]
    pub to_ext_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        has_one = to_ext_mint,
        seeds = [EXT_CONFIG_SEED_PREFIX, to_ext_mint.key().as_ref()],
        bump = to_ext_global.bump,
    )]
    pub to_ext_config: Account<'info, ExtConfig>,

    #[account(
        seeds = [M_VAULT_SEED_PREFIX, to_ext_mint.key().as_ref()],
        bump = to_ext_global.m_vault_bump,
    )]
    pub to_m_vault: AccountInfo<'info>,

    /// CHECK: The account is checked by the seeds and holds no data.
    #[account(
        seeds = [MINT_AUTHORITY_SEED_PREFIX, to_ext_mint.key().as_ref()],
        bump = to_ext_global.ext_mint_authority_bump,  
    )]
    pub to_ext_mint_authority: AccountInfo<'info>,

    #[account(
        mut,
        token::mint = from_ext_mint,
        token::authority = user,
        token::token_program = from_ext_token_program,
    )]
    pub from_user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = from_m_vault,
        associated_token::token_program = m_token_program,
    )]
    pub from_m_vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = to_ext_mint,
        // not restricted to the user to allow swap + send
        token::token_program = to_ext_token_program,
    )]
    pub to_user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = to_m_vault,
        associated_token::token_program = m_token_program,
    )]
    pub to_m_vault_token_account: InterfaceAccount<'info, TokenAccount>,

    pub m_token_program: Program<'info, TokenInterface>,
    pub from_ext_token_program: Program<'info, TokenInterface>,
    pub to_ext_token_program: Program<'info, TokenInterface>,
}

impl<'info> Swap<'info> {
    fn validate(&self) -> Result<()> {
        match ctx.accounts.from_ext_global.ext_access {
            ExtAccess::Open => {},
            ExtAccess::Finite(ext_finite) => {
                // Check if the user is allowed to swap
                if !ext_finite.wrap_authorities.contains(&ctx.accounts.user.key()) {
                    return err!(ExtError::Unauthorized);
                }
            }
        }

        // TODO should we check the recipient or the signer here?
        match ctx.accounts.to_ext_global.ext_access {
            ExtAccess::Open => {},
            ExtAccess::Finite(ext_finite) => {
                // Check if the user is allowed to swap
                if !ext_finite.wrap_authorities.contains(&ctx.accounts.user.key()) {
                    return err!(ExtError::Unauthorized);
                }
            }
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Swap>, amount_m: u64) -> Result<()> {
        // Order:
        // 1. sync from token or call unwrap hook
        // 2. sync to token or call wrap hook
        // 3. burn from token
        // 4. transfer M from from vault to to vault
        // 5. mint to token

        // sync from token or call unwrap hook
        // get the from multiplier
        let from_multiplier = match ctx.accounts.from_ext_config.yield_config {
            YieldConfig::Rebasing(rebasing_config) => {
                // sync the extension if required and return the conversion rate (aka multiplier)
                rebasing_config.sync(
                    &mut ctx.accounts.from_ext_mint,
                    &mut ctx.accounts.m_earn_global_account,
                    &ctx.accounts.from_ext_mint_authority,
                    &[&[
                        MINT_AUTHORITY_SEED_PREFIX,
                        ctx.accounts.from_ext_mint.key().as_ref(),
                        &[ctx.accounts.from_ext_global.ext_mint_authority_bump],
                    ]],
                    &ctx.accounts.from_ext_token_program,
                )?.get()
            },
            YieldConfig::Custom(custom_config) => {
                if custom_config.unwrap_hook {
                    // custom extensions may implement a unwrap hook to perform custom logic
                    // and/or be able to provide a conversion rate (aka multiplier)
                    // if the ratio is not 1:1 between m and ext tokens
                    // if no unwrap hook is provided, we assume a 1:1 ratio
                    custom_config.unwrap_hook(ctx)? // TODO need to implement
                } else {
                    // if no unwrap hook is provided, we assume a 1:1 ratio
                    MULTIPLIER_SCALE
                }
            },
            _ => {
                MULTIPLIER_SCALE
            }
        };

        // sync to token or call wrap hook
        // get the to multiplier
        let to_multiplier = match ctx.accounts.to_ext_config.yield_config {
            YieldConfig::Rebasing(rebasing_config) => {
                // sync the extension if required and return the conversion rate (aka multiplier)
                rebasing_config.sync(
                    &mut ctx.accounts.to_ext_mint,
                    &mut ctx.accounts.m_earn_global_account,
                    &ctx.accounts.to_ext_mint_authority,
                    &[&[
                        MINT_AUTHORITY_SEED_PREFIX,
                        ctx.accounts.to_ext_mint.key().as_ref(),
                        &[ctx.accounts.to_ext_global.ext_mint_authority_bump],
                    ]],
                    &ctx.accounts.to_ext_token_program,
                )?.get()
            },
            YieldConfig::Custom(custom_config) => {
                if custom_config.wrap_hook {
                    // custom extensions may implement a wrap hook to perform custom logic
                    // and/or be able to provide a conversion rate (aka multiplier)
                    // if the ratio is not 1:1 between m and ext tokens
                    // if no wrap hook is provided, we assume a 1:1 ratio
                    custom_config.wrap_hook(ctx)? // TODO need to implement
                } else {
                    // if no wrap hook is provided, we assume a 1:1 ratio
                    MULTIPLIER_SCALE
                }
            },
            _ => {
                MULTIPLIER_SCALE
            }
        };
        

        // Burn the from token's from the user's token account
        let mut amount_from = amount_to_principal_up(amount_m, multiplier)?;
        // Decrease by 1 if rounding error causes user to not be able to swap
        // whole balance.
        if from_amount - 1 == ctx.accounts.from_ext_token_account.amount {
            from_amount = ctx.accounts.from_ext_token_account.amount;
        }

        burn_tokens(
            &ctx.accounts.from_user_token_account,
            from_amount,
            &ctx.accounts.from_ext_mint,
            &ctx.accounts.user,
            &ctx.accounts.from_ext_token_program,
        )?;

        // Transfer M from the from ext m vault to the to ext m vault
        transfer_tokens_from_program(
            &ctx.accounts.from_m_vault_token_account,
            &ctx.accounts.to_m_vault_token_account,
            amount,
            &ctx.accounts.m_mint,
            &ctx.accounts.from_m_vault,
            &[&[
                M_VAULT_SEED_PREFIX,
                ctx.accounts.from_ext_mint.key().as_ref(),
                &[ctx.accounts.from_ext_global.m_vault_bump],
            ]],
            &ctx.accounts.m_token_program,
        )?;

        // Mint the to token to the to token account
        let to_amount = amount_to_principal_down(amount_from, to_multiplier)?;

        mint_tokens(
            &ctx.accounts.to_user_token_account,
            to_amount,
            &ctx.accounts.to_ext_mint,
            &ctx.accounts.to_ext_mint_authority,
            &[&[
                MINT_AUTHORITY_SEED_PREFIX,
                ctx.accounts.to_ext_mint.key().as_ref(),
                &[ctx.accounts.to_ext_global.ext_mint_authority_bump],
            ]],
            &ctx.accounts.to_ext_token_program,
        )?;

        Ok(())
    }
}

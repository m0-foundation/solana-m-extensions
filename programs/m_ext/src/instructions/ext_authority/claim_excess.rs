// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use earn::state::Global as EarnGlobal;

// local dependencies
use crate::{
    errors::ExtError,
    state::{Config, ExtConfig, CONFIG_SEED, EXT_CONFIG_SEED_PREFIX, MINT_AUTHORITY_SEED_PREFIX, M_VAULT_SEED_PREFIX},
    utils::{
        conversion::{amount_to_principal_down, principal_to_amount_up},
        token::mint_tokens,
    },
};

#[derive(Accounts)]
pub struct ClaimExcess<'info> {
    pub ext_authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = m_earn_global_account @ ExtError::InvalidAccount,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_config.ext_mint.as_ref()],
        has_one = ext_authority @ ExtError::NotAuthorized,
        has_one = ext_mint @ ExtError::InvalidMint,
        bump = ext_config.bump,
    )]
    pub ext_config: Account<'info, ExtConfig>,

    pub m_earn_global_account: Account<'info, EarnGlobal>,

    #[account(mut)]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED_PREFIX, ext_config.ext_mint.as_ref()],
        bump = ext_config.ext_mint_authority_bump,
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    /// CHECK: There is no data in this account, it is validated by the seed
    #[account(
        seeds = [M_VAULT_SEED_PREFIX, ext_config.ext_mint.as_ref()],
        bump = ext_config.m_vault_bump,
    )]
    pub m_vault: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = config.m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = ext_token_program,
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Allowing the admin to specify the recipient account is more flexible
    /// so the authority of this token account is not checked
    #[account(
        mut,
        token::mint = ext_mint,
    )]
    pub recipient_ext_token_account: InterfaceAccount<'info, TokenAccount>,

    pub ext_token_program: Interface<'info, TokenInterface>,
}


impl<'info> ClaimExcess<'info> {
    fn validate(&self) - Result<()> {
        match ctx.accounts.ext_config.yield_config {
            YieldConfig::Manual(_) => {
                return err!(ExtError::InstructionNotSupported);
            },
            YieldConfig::Custom(_) => {
                return err!(ExtError::InstructionNotSupported);
            },
            _ => Ok(())
        }
    }

    pub fn handler(ctx: Context<Self>) -> Result<()> {
        // Calculate the amount of excess ext tokens that can be minted
        // This is equivalent to the amount of fee taken on rebasing tokens
        // and the amount of M yield when there is no yield distribution
        let excess_ext = match &mut ctx.accounts.ext_config.yield_config {
            YieldConfig::None => {
                // The excess is the amount of M in the vault minus the supply of the extension
                let vault_m = ctx.accounts.vault_m_token_account.amount;
                let ext_supply = ctx.accounts.ext_mint.supply;

                vault_m
                    .checked_sub(ext_supply)
                    .ok_or(ExtError::InsufficientCollateral)? // This shouldn't underflow, but we check for safety
            },
            YieldConfig::Rebasing(rebasing_config) => {
                // Sync the multiplier, which also checks solvency
                let multiplier = rebasing_config.sync(
                    &mut ctx.accounts.ext_mint,
                    &ctx.accounts.m_earn_global_account,
                    &ctx.accounts.vault_m_token_account,
                    &ctx.accounts.ext_mint_authority,
                    &[&[
                        MINT_AUTHORITY_SEED_PREFIX,
                        ctx.accounts.ext_mint.key().to_bytes(),
                        &[ctx.accounts.global_account.ext_mint_authority_bump],
                    ]],
                    &ctx.accounts.ext_token_program,
                )?;

                // Calculate the required collateral, rounding up to be conservative
                // This amount will always be greater than what is required in the check_solvency function
                // since it allows a rounding error of up to 2e-6
                let required_m = principal_to_amount_up(ctx.accounts.ext_mint.supply, multiplier)?;

                // Excess M is the amount of M in the vault above the amount needed to fully collateralize the extension
                let vault_m = ctx.accounts.vault_m_token_account.amount;

                let excess = vault_m
                    .checked_sub(required_m)
                    .ok_or(ExtError::InsufficientCollateral)?; // This shouldn't underflow, but we check for safety

                // Return the principal amount of ext tokens to mint
                // Rounding down to be conservative
                amount_to_principal_down(excess, multiplier)?
            },
            YieldConfig::Custom(_) => {
                // TODO should we allow this for custom extensions? Currently we don't
                0
            },
            _ => unreachable!(),
        }
        
        // Only mint a positive amount of excess
        if excess_ext > 0 {
            mint_tokens(
                &ctx.accounts.recipient_ext_token_account,
                excess_ext,
                &ctx.accounts.ext_mint,
                &ctx.accounts.ext_mint_authority,
                &[&[
                    MINT_AUTHORITY_SEED,
                    &[ctx.accounts.global_account.ext_mint_authority_bump],
                ]],
                &ctx.accounts.ext_token_program,
            )?;

            emit!(ExcessClaimed {
                recipient_token_account: ctx.accounts.recipient_ext_token_account.key(),
                amount: excess_ext, // TODO this will be in "principal" units, should it be in M units?
            });
        }

        Ok(())
    }
}

#[event]
pub struct ExcessClaimed {
    pub recipient_token_account: Pubkey,
    pub amount: u64,
}

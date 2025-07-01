// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};
use earn::{
    state::{Earner, EARNER_SEED},
    ID as EARN_PROGRAM,
};

// local dependencies
use crate::{
    constants::ONE_HUNDRED_PERCENT_U64,
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED},
    utils::conversion::sync_multiplier,
};

#[derive(Accounts)]
pub struct SetFee<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        has_one = admin @ ExtError::NotAuthorized,
        has_one = ext_mint @ ExtError::InvalidMint,
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED],
        bump = global_account.m_vault_bump,
    )]
    pub m_vault: AccountInfo<'info>,

    #[account(
        associated_token::mint = global_account.m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = Token2022::id(),
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [EARNER_SEED, vault_m_token_account.key().as_ref()],
        seeds::program = EARN_PROGRAM,
        bump = m_earner_account.bump,
    )]
    pub m_earner_account: Account<'info, Earner>,

    #[account(
        mut,
        mint::token_program = ext_token_program,
    )]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        bump = global_account.ext_mint_authority_bump,
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    pub ext_token_program: Program<'info, Token2022>,
}

impl SetFee<'_> {
    // This instruction allows the admin to set a new fee in basis points (bps).
    // The fee must be between 0 and 100 bps (inclusive).
    // If the fee is set to 0, it effectively disables the fee.
    // If the fee is set to 100, it means the entire amount is taken as a fee.
    // Any value above 100 bps will result in an error.
    fn validate(&self, fee_bps: u64) -> Result<()> {
        // Validate that the fee is between 0 and 100 bps
        if fee_bps > ONE_HUNDRED_PERCENT_U64 {
            return err!(ExtError::InvalidParam);
        }
        Ok(())
    }

    #[access_control(ctx.accounts.validate(fee_bps))]
    pub fn handler(ctx: Context<Self>, fee_bps: u64) -> Result<()> {
        // Sync the multiplier prior to updating the fee.
        // This will update the multiplier on ext_mint
        // if it doesn't match the index on m_earn_global_account
        // It also checks that the vault is solvent after the update
        let signer_bump = ctx.accounts.global_account.ext_mint_authority_bump;
        sync_multiplier(
            &mut ctx.accounts.ext_mint,
            &mut ctx.accounts.global_account,
            &ctx.accounts.m_earner_account,
            &ctx.accounts.vault_m_token_account,
            &ctx.accounts.ext_mint_authority,
            &[&[MINT_AUTHORITY_SEED, &[signer_bump]]],
            &ctx.accounts.ext_token_program,
        )?;

        // Set the new fee
        ctx.accounts.global_account.yield_config.fee_bps = fee_bps;

        Ok(())
    }
}

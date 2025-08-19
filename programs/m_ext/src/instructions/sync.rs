use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED},
    utils::conversion::sync_multiplier,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};
use earn::{
    state::{Global as EarnGlobal, EARNER_SEED, GLOBAL_SEED as EARN_GLOBAL_SEED},
    ID as EARN_PROGRAM,
};

#[derive(Accounts)]
pub struct Sync<'info> {
    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = ext_mint @ ExtError::InvalidMint,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    #[account(
        seeds = [EARN_GLOBAL_SEED],
        seeds::program = EARN_PROGRAM,
        bump = m_earn_global_account.bump,
    )]
    pub m_earn_global_account: Account<'info, EarnGlobal>,

    // CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED],
        bump = global_account.m_vault_bump,
    )]
    pub m_vault: UncheckedAccount<'info>,

    #[account(
        associated_token::mint = global_account.m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = m_token_program,
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: We partially validate this account is the correct address
    /// via the seed, but we delay full validation to the handler
    /// so we can handle cases where the account has been closed.
    #[account(
        seeds = [EARNER_SEED, vault_m_token_account.key().as_ref()],
        seeds::program = EARN_PROGRAM,
        bump
    )]
    pub m_earner_account: UncheckedAccount<'info>,

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

    pub m_token_program: Program<'info, Token2022>,

    pub ext_token_program: Program<'info, Token2022>,
}

impl Sync<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        // Sync the multiplier
        // This will update the multiplier on ext_mint
        // if it doesn't match the index on m_earn_global_account
        let signer_bump = ctx.accounts.global_account.ext_mint_authority_bump;
        sync_multiplier(
            &mut ctx.accounts.ext_mint,
            &mut ctx.accounts.global_account,
            &ctx.accounts.m_earn_global_account,
            &ctx.accounts.ext_mint_authority,
            &[&[MINT_AUTHORITY_SEED, &[signer_bump]]],
            &ctx.accounts.ext_token_program,
            &ctx.accounts.m_earner_account,
        )?;

        Ok(())
    }
}

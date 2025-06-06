// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022};

// local dependencies
use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED},
    utils::conversion::set_ibt_rate,
};

#[derive(Accounts)]
pub struct SetIbtRate<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        has_one = admin @ ExtError::NotAuthorized,
        has_one = ext_mint @ ExtError::InvalidMint,
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    #[account(
        mut,
        mint::token_program = ext_token_program
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

impl SetIbtRate<'_> {
    // This instruction allows the admin to set a new interest rate in basis points (bps).
    // The rate must not be negative.
    // The admin should ensure that the rate is less than the global M interest rate to avoid the extension
    // becoming undercolletateralized.
    fn validate(&self, rate: i16) -> Result<()> {
        // Don't allow negative rates
        if rate < 0 {
            return err!(ExtError::InvalidParam);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(rate))]
    pub fn handler(ctx: Context<Self>, rate: i16) -> Result<()> {
        let authority_seeds: &[&[&[u8]]] = &[&[
            MINT_AUTHORITY_SEED,
            &[ctx.accounts.global_account.ext_mint_authority_bump],
        ]];

        // Set the rate on the ext mint
        set_ibt_rate(
            &mut ctx.accounts.ext_mint,
            &ctx.accounts.ext_token_program,
            &ctx.accounts.ext_mint_authority,
            authority_seeds,
            rate,
        )
    }
}

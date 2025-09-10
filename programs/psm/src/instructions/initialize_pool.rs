use anchor_lang::{accounts::interface_account::InterfaceAccount, prelude::*};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    errors::PSMError,
    state::{Global, Pool, GLOBAL_SEED, LP_MINT_SEED, POOL_CONFIG_SEED},
    utils::has_scaled_extension,
};

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [GLOBAL_SEED],
        bump = global.bump,
        has_one = admin,
    )]
    pub global: Account<'info, Global>,

    #[account(
        init,
        seeds = [POOL_CONFIG_SEED, swap_mint_a.key().as_ref(), swap_mint_b.key().as_ref()],
        space = 8 + Pool::INIT_SPACE,
        bump,
        payer = admin,
    )]
    pub pool: Account<'info, Pool>,

    pub swap_mint_a: InterfaceAccount<'info, Mint>,

    pub swap_mint_b: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        seeds = [LP_MINT_SEED, pool.key().as_ref()],
        bump,
        payer = admin,
        mint::decimals = swap_mint_a.decimals,
        mint::authority = pool,
        mint::token_program = lp_receipt_token_program,
    )]
    pub lp_receipt_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = swap_mint_a,
        associated_token::authority = pool,
        associated_token::token_program = token_program_a,
    )]
    pub vault_a: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = swap_mint_b,
        associated_token::authority = pool,
        associated_token::token_program = token_program_b,
    )]
    pub vault_b: InterfaceAccount<'info, TokenAccount>,

    pub token_program_a: Interface<'info, TokenInterface>,

    pub token_program_b: Interface<'info, TokenInterface>,

    pub lp_receipt_token_program: Program<'info, Token2022>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,
}

impl InitializePool<'_> {
    fn validate(&self, trade_fee_bps: u16) -> Result<()> {
        if trade_fee_bps > 10_000 {
            return Err(ProgramError::InvalidArgument.into());
        }

        // Mint pubkeys should be sorted to prevent duplicate pools
        if self.swap_mint_a.key().to_string() > self.swap_mint_b.key().to_string() {
            msg!("unsorted mint pubkeys");
            return Err(ProgramError::InvalidArgument.into());
        }

        if self.swap_mint_a.decimals != self.swap_mint_b.decimals {
            msg!("mints must have the same decimals");
            return Err(ProgramError::InvalidArgument.into());
        }

        // Scaling principal amounts unsupported
        if has_scaled_extension(&self.swap_mint_a)? || has_scaled_extension(&self.swap_mint_b)? {
            return err!(PSMError::UnsupportedMint);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(trade_fee_bps))]
    pub fn handler(ctx: Context<Self>, trade_fee_bps: u16) -> Result<()> {
        ctx.accounts.pool.set_inner(Pool {
            swap_mint_a: ctx.accounts.swap_mint_a.key(),
            swap_mint_b: ctx.accounts.swap_mint_b.key(),
            lp_receipt_mint: ctx.accounts.lp_receipt_mint.key(),
            balance_a: 0,
            balance_b: 0,
            trade_fee_bps,
            bump: ctx.bumps.pool,
        });

        Ok(())
    }
}

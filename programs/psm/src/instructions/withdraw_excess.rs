use anchor_lang::{accounts::interface_account::InterfaceAccount, prelude::*};
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    errors::PSMError,
    state::{Global, Pool, GLOBAL_SEED, POOL_CONFIG_SEED},
};

#[derive(Accounts)]
pub struct WithdrawExcess<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [GLOBAL_SEED],
        bump = global.bump,
        has_one = admin @ PSMError::Unauthorized,
    )]
    pub global: Account<'info, Global>,

    #[account(
        seeds = [POOL_CONFIG_SEED, pool.swap_mint_a.key().as_ref(), pool.swap_mint_b.key().as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        constraint = pool.swap_mint_a == mint.key() || pool.swap_mint_b == mint.key() @ PSMError::InvalidMint,
        token::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl WithdrawExcess<'_> {
    fn validate(&self) -> Result<()> {
        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        let excess = if ctx.accounts.mint.key() == ctx.accounts.pool.swap_mint_a {
            ctx.accounts
                .vault
                .amount
                .saturating_sub(ctx.accounts.pool.balance_a)
        } else {
            ctx.accounts
                .vault
                .amount
                .saturating_sub(ctx.accounts.pool.balance_b)
        };

        if excess == 0 {
            return err!(PSMError::NoExcess);
        }

        // Seeds for PDA
        let mint_a = ctx.accounts.pool.swap_mint_a.key();
        let mint_b = ctx.accounts.pool.swap_mint_b.key();

        let seeds: &[&[&[u8]]] = &[&[
            POOL_CONFIG_SEED,
            mint_a.as_ref(),
            mint_b.as_ref(),
            &[ctx.accounts.pool.bump],
        ]];

        // Transfer excess tokens to admin
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            &seeds,
        );
        transfer_checked(cpi_context, excess, ctx.accounts.mint.decimals)?;

        Ok(())
    }
}

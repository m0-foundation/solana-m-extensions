use anchor_lang::{accounts::interface_account::InterfaceAccount, prelude::*};
use anchor_spl::{
    token::Token,
    token_interface::{transfer_checked, Mint, TokenAccount, TransferChecked},
};

use crate::{
    errors::PSMError,
    state::{Global, Pool, GLOBAL_SEED, POOL_CONFIG_SEED},
};

#[derive(Accounts)]
pub struct Swap<'info> {
    pub signer: Signer<'info>,

    #[account(
        seeds = [GLOBAL_SEED],
        bump = global.bump,
    )]
    pub global: Account<'info, Global>,

    #[account(
        seeds = [POOL_CONFIG_SEED, pool.swap_mint_a.key().as_ref(), pool.swap_mint_b.key().as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        constraint = pool.swap_mint_a == from_mint.key() || pool.swap_mint_b == from_mint.key()  @ PSMError::InvalidMint,
        token::token_program = from_token_program,
    )]
    pub from_mint: InterfaceAccount<'info, Mint>,

    #[account(
        constraint = pool.swap_mint_a == to_mint.key() || pool.swap_mint_b == to_mint.key()  @ PSMError::InvalidMint,
        token::token_program = to_token_program,
    )]
    pub to_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = from_mint,
        token::authority = signer,
        token::token_program = from_token_program,
    )]
    pub from_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = to_mint,
        token::token_program = to_token_program,
    )]
    pub to_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = from_mint,
        associated_token::authority = pool,
        associated_token::token_program = from_token_program,
    )]
    pub vault_a: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = to_mint,
        associated_token::authority = pool,
        associated_token::token_program = to_token_program,
    )]
    pub vault_b: InterfaceAccount<'info, TokenAccount>,

    pub from_token_program: Program<'info, Token>,

    pub to_token_program: Program<'info, Token>,
}

impl Swap<'_> {
    fn validate(&self, amount: u64) -> Result<()> {
        if amount == 0 {
            return err!(PSMError::InvalidAmount);
        }

        if self.from_mint.key() == self.to_mint.key() {
            return err!(PSMError::InvalidMint);
        }

        if self.global.freeze_swaps {
            return err!(PSMError::Frozen);
        }

        if self.from_mint.key() == self.pool.swap_mint_a {
            if amount > self.pool.balance_b {
                return err!(PSMError::InsufficientPoolBalance);
            }
        } else {
            if amount > self.pool.balance_a {
                return err!(PSMError::InsufficientPoolBalance);
            }
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(amount))]
    pub fn handler(ctx: Context<Self>, amount: u64) -> Result<()> {
        // Transfer input tokens to vault
        let cpi_context = CpiContext::new(
            ctx.accounts.from_token_program.to_account_info(),
            TransferChecked {
                mint: ctx.accounts.from_mint.to_account_info(),
                from: ctx.accounts.from_token_program.to_account_info(),
                to: ctx.accounts.vault_a.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        );
        transfer_checked(cpi_context, amount, ctx.accounts.from_mint.decimals)?;

        let mint_a = ctx.accounts.pool.swap_mint_a.key();
        let mint_b = ctx.accounts.pool.swap_mint_b.key();

        let seeds: &[&[&[u8]]] = &[&[
            POOL_CONFIG_SEED,
            mint_a.as_ref(),
            mint_b.as_ref(),
            &[ctx.accounts.pool.bump],
        ]];

        // Transfer output tokens to swapper
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.to_token_program.to_account_info(),
            TransferChecked {
                mint: ctx.accounts.to_mint.to_account_info(),
                from: ctx.accounts.vault_b.to_account_info(),
                to: ctx.accounts.to_token_account.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            &seeds,
        );
        transfer_checked(cpi_context, amount, ctx.accounts.from_mint.decimals)?;

        // Track balances
        if ctx.accounts.from_mint.key() == ctx.accounts.pool.swap_mint_a {
            ctx.accounts.pool.balance_a += amount;
            ctx.accounts.pool.balance_b -= amount;
        } else {
            ctx.accounts.pool.balance_a -= amount;
            ctx.accounts.pool.balance_b += amount;
        }

        Ok(())
    }
}

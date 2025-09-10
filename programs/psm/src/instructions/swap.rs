use anchor_lang::{accounts::interface_account::InterfaceAccount, prelude::*};
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
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

    pub from_token_program: Interface<'info, TokenInterface>,

    pub to_token_program: Interface<'info, TokenInterface>,
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

        let out_amount = calculate_out_amount(amount, ctx.accounts.pool.trade_fee_bps);

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
        transfer_checked(cpi_context, out_amount, ctx.accounts.from_mint.decimals)?;

        // Track balances
        if ctx.accounts.from_mint.key() == ctx.accounts.pool.swap_mint_a {
            ctx.accounts.pool.balance_a += amount;
            ctx.accounts.pool.balance_b -= out_amount;
        } else {
            ctx.accounts.pool.balance_a -= out_amount;
            ctx.accounts.pool.balance_b += amount;
        }

        Ok(())
    }
}

fn calculate_out_amount(amount: u64, fee_bps: u16) -> u64 {
    if fee_bps == 0 {
        return amount;
    }

    let fee = amount
        .checked_mul(fee_bps as u64)
        .unwrap()
        .checked_div(10_000)
        .unwrap();

    amount.checked_sub(fee).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_fee_zero_bps() {
        assert_eq!(calculate_out_amount(1000, 0), 1000);
        assert_eq!(calculate_out_amount(0, 0), 0);
    }

    #[test]
    fn test_calculate_fee_normal_cases() {
        // 1% fee (100 bps)
        assert_eq!(calculate_out_amount(10000, 100), 9900);
        assert_eq!(calculate_out_amount(1000, 100), 990);

        // 0.5% fee (50 bps)
        assert_eq!(calculate_out_amount(10000, 50), 9950);

        // 0.1% fee (10 bps)
        assert_eq!(calculate_out_amount(10000, 10), 9990);
    }

    #[test]
    fn test_calculate_fee_rounding() {
        // 0.3% fee (30 bps) on 1000 = 3 (rounded down)
        assert_eq!(calculate_out_amount(1000, 30), 997);

        // 0.3% fee (30 bps) on 10 = 0.03 (rounds to 0)
        assert_eq!(calculate_out_amount(10, 30), 10); // Fee is effectively 0
    }
}

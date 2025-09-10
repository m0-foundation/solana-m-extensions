use anchor_lang::{accounts::interface_account::InterfaceAccount, prelude::*};
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{
        burn_checked, transfer_checked, BurnChecked, Mint, TokenAccount, TokenInterface,
        TransferChecked,
    },
};

use crate::{
    errors::PSMError,
    state::{
        ApprovedPoolActor, Global, Pool, GLOBAL_SEED, LP_MINT_SEED, POOL_ACTOR, POOL_CONFIG_SEED,
    },
};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(address = actor.owner)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_ACTOR, actor.owner.as_ref()],
        bump = actor.bump,
    )]
    pub actor: Account<'info, ApprovedPoolActor>,

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
        constraint = pool.swap_mint_a == mint.key() || pool.swap_mint_b == mint.key() @ PSMError::InvalidMint,
        token::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [LP_MINT_SEED, pool.key().as_ref()],
        token::token_program = lp_receipt_token_program,
        bump,
    )]
    pub lp_receipt_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub actor_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = lp_receipt_mint,
        token::token_program = lp_receipt_token_program,
    )]
    pub actor_receipt_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,

    pub lp_receipt_token_program: Program<'info, Token2022>,
}

impl Withdraw<'_> {
    fn validate(&self, amount: u64) -> Result<()> {
        if amount == 0 {
            return err!(PSMError::InvalidAmount);
        }

        if self.mint.key() == self.pool.swap_mint_a {
            if amount > self.pool.balance_a {
                return err!(PSMError::InsufficientPoolBalance);
            }
        } else {
            if amount > self.pool.balance_b {
                return err!(PSMError::InsufficientPoolBalance);
            }
        }

        if self.global.freeze_liquidity {
            return err!(PSMError::Frozen);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(amount))]
    pub fn handler(ctx: Context<Self>, amount: u64) -> Result<()> {
        // Burn receipt tokens
        let cpi_context = CpiContext::new(
            ctx.accounts.lp_receipt_token_program.to_account_info(),
            BurnChecked {
                mint: ctx.accounts.lp_receipt_mint.to_account_info(),
                from: ctx.accounts.actor_receipt_token_account.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        );
        burn_checked(cpi_context, amount, ctx.accounts.lp_receipt_mint.decimals)?;

        let mint_a = ctx.accounts.pool.swap_mint_a.key();
        let mint_b = ctx.accounts.pool.swap_mint_b.key();

        let seeds: &[&[&[u8]]] = &[&[
            POOL_CONFIG_SEED,
            mint_a.as_ref(),
            mint_b.as_ref(),
            &[ctx.accounts.pool.bump],
        ]];

        // Transfer tokens to user
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.actor_token_account.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            &seeds,
        );
        transfer_checked(cpi_context, amount, ctx.accounts.mint.decimals)?;

        // Track balances
        if ctx.accounts.mint.key() == ctx.accounts.pool.swap_mint_a {
            ctx.accounts.pool.balance_a -= amount;
        } else {
            ctx.accounts.pool.balance_b -= amount;
        }

        Ok(())
    }
}

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ExtError,
    state::{Config, CONFIG_SEED},
};
use earn::state::{Global as EarnGlobal, GLOBAL_SEED as EARN_GLOBAL_SEED};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = ANCHOR_DISCRIMINATOR_SIZE + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [EARN_GLOBAL_SEED],
        seeds::program = earn::ID,
        bump,
    )]
    pub m_earn_global_account: AccountInfo<'info>,

    #[account(
        constraint = m_mint.key() == m_earn_global_account.mint @ ExtError::InvalidMint,
        mint::token_program = m_token_program,
    )]
    pub m_mint: InterfaceAccount<'info, Mint>,

    pub m_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitializeConfig<'info> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        ctx.accounts.config.set_inner(Config {
            admin: ctx.accounts.signer.key(),
            m_mint: ctx.accounts.m_mint.key(),
            m_earn_global_account: ctx.accounts.m_earn_global_account.key(),
            m_token_program: ctx.accounts.m_token_program.key(),
            bump: ctx.bumps.config,
        });

        Ok(())
    }
}

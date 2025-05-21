use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};
use earn::state::Global as EarnGlobal;
use solana_program::sysvar::instructions::get_instruction_relative;
use std::str::FromStr;

use crate::{errors::ExtError, state::MINT_AUTH_SEED, utils::sync_rate, EXT_CORE_PROGRAM_ID};

#[derive(Accounts)]
pub struct Sync<'info> {
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: This account is validated by the seed
    #[account(
        seeds = [MINT_AUTH_SEED],
        bump
    )]
    pub mint_authority: AccountInfo<'info>,

    pub m_global_account: Account<'info, EarnGlobal>,

    pub token_program: Interface<'info, TokenInterface>,

    /// CHECK: This account is validated by address
    #[account(address = Pubkey::from_str("Sysvar1nstructions1111111111111111111111111").unwrap())]
    pub sysvar_instructions_account: AccountInfo<'info>,
}

impl Sync<'_> {
    fn validate(&self) -> Result<()> {
        let instruction = get_instruction_relative(0, &self.sysvar_instructions_account).unwrap();

        // Only allow the program to be called by EXT_CORE_PROGRAM_ID
        if instruction.program_id != EXT_CORE_PROGRAM_ID {
            return err!(ExtError::InvalidInvocation);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Sync>) -> Result<f64> {
        sync_rate(
            &mut ctx.accounts.mint,
            &ctx.accounts.m_global_account,
            &ctx.accounts.mint_authority,
            ctx.bumps.mint_authority,
        )
    }
}

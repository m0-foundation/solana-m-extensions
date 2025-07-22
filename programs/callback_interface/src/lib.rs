use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};

declare_id!("F7HuoZhamk9hawJcwLv9q4XnZXJv3cJwAe4BNuyA4Uri");

#[program]
pub mod callback_interface {
    use super::*;

    pub fn wrap_callback(_ctx: Context<Callback>, _amount: u64) -> Result<()> {
        Ok(())
    }

    pub fn unwrap_callback(_ctx: Context<Callback>, _amount: u64) -> Result<()> {
        Ok(())
    }
}

// TODO need to think about signer permissions for token transfers
// as well as access control for who can call the callback
#[derive(Accounts)]
pub struct Callback<'info> {
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        token::mint = mint,
        token::token_program = token_program
    )]
    pub send_to: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Program<'info, Token2022>,
}

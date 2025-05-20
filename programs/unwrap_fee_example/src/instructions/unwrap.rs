use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use earn::state::Global as EarnGlobal;
use m_ext_interface::state::ExtraAccountMetas;
use scaled_ui_ext::utils::{conversion::amount_to_principal_up, token::burn_tokens};

use solana_program::sysvar::instructions::get_instruction_relative;
use std::{cmp::max, str::FromStr};

use crate::{
    errors::ExtError,
    state::{WrapConfig, MINT_AUTH_SEED},
    utils::sync_rate,
    EXT_CORE_PROGRAM_ID,
};

#[derive(Accounts)]
pub struct Unwrap<'info> {
    pub signer: Signer<'info>,

    pub m_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: This account is validated by the seed
    #[account(
        seeds = [MINT_AUTH_SEED],
        bump
    )]
    pub mint_authority: AccountInfo<'info>,

    pub m_global_account: Account<'info, EarnGlobal>,

    /// CHECK: TODO: Add vault seeds
    pub m_vault: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = token_program,
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = signer,
    )]
    pub from_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = m_mint,
    )]
    pub to_m_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,

    /// CHECK: This account is validated by address
    #[account(address = Pubkey::from_str("Sysvar1nstructions1111111111111111111111111").unwrap())]
    pub sysvar_instructions_account: AccountInfo<'info>,

    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        constraint = extra_account_metas.extra_accounts.len() > 0,
        bump
    )]
    pub extra_account_metas: InterfaceAccount<'info, ExtraAccountMetas>,

    /// Account from ExtraAccountMetas
    #[account(
        address = Pubkey::new_from_array(extra_account_metas.extra_accounts[0].address_config),
    )]
    pub wrap_config: Account<'info, WrapConfig>,
}

impl Unwrap<'_> {
    fn validate(&self) -> Result<()> {
        let instruction = get_instruction_relative(0, &self.sysvar_instructions_account).unwrap();

        // Only allow the program to be called by EXT_CORE_PROGRAM_ID
        if instruction.program_id != EXT_CORE_PROGRAM_ID {
            return err!(ExtError::InvalidInvocation);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>, amount: u64) -> Result<()> {
        let multiplier = sync_rate(
            &mut ctx.accounts.mint,
            &ctx.accounts.m_global_account,
            &ctx.accounts.mint_authority,
            ctx.bumps.mint_authority,
        )?;

        // Calculate the principal amount of ext tokens to burn from the amount of m tokens to unwrap
        let principal = max(
            amount_to_principal_up(amount, multiplier)?,
            ctx.accounts.from_token_account.amount,
        );

        burn_tokens(
            &ctx.accounts.from_token_account,
            principal,
            &ctx.accounts.mint,
            &ctx.accounts.signer.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        )?;

        // Apply unwrap tax
        // Excess tokens can be claimed on core program
        let amount = amount
            - (amount as f64 * ((1 - ctx.accounts.wrap_config.fee_bps) as f64 / 10_000.)) as u64;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.m_vault.to_account_info(),
                    to: ctx.accounts.to_m_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    authority: ctx.accounts.m_vault.clone(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        Ok(())
    }
}

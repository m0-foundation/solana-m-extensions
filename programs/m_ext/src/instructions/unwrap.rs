use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};

use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED},
    utils::{
        conversion::sync_multiplier,
        quote::{Op, Quoter},
        token::{burn_tokens, transfer_tokens_from_program},
    },
};

#[derive(Accounts)]
pub struct Unwrap<'info> {
    pub token_authority: Signer<'info>,

    // Will be set if a whitelisted authority is signing for a user
    pub unwrap_authority: Option<Signer<'info>>,

    #[account(mint::token_program = m_token_program)]
    pub m_mint: InterfaceAccount<'info, Mint>,

    #[account(mut, mint::token_program = ext_token_program)]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = m_mint @ ExtError::InvalidAccount,
        has_one = ext_mint @ ExtError::InvalidAccount,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED],
        bump = global_account.m_vault_bump,
    )]
    pub m_vault: AccountInfo<'info>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        bump = global_account.ext_mint_authority_bump,
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    #[account(
        mut,
        token::mint = m_mint,
        token::token_program = m_token_program,
        // authority of the to token account is not checked to allow unwrap + send
    )]
    pub to_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = m_token_program,
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = ext_mint,
        token::token_program = ext_token_program,
        // signer must be the authority of the from token account or delegated by the owner
        // this is checked by the token program
    )]
    pub from_ext_token_account: InterfaceAccount<'info, TokenAccount>,

    // we have duplicate entries for the token2022 program since the interface needs to be consistent
    // but we want to leave open the possibility that either may not have to be token2022 in the future
    pub m_token_program: Program<'info, Token2022>,
    pub ext_token_program: Program<'info, Token2022>,
}

impl Unwrap<'_> {
    pub fn validate(&self, principal: u64) -> Result<()> {
        let auth = match &self.unwrap_authority {
            Some(auth) => auth.key,
            None => self.token_authority.key,
        };

        // Ensure the caller is authorized to wrap
        if !self.global_account.wrap_authorities.contains(auth) {
            return err!(ExtError::NotAuthorized);
        }

        if principal == 0 {
            return err!(ExtError::InvalidAmount);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(principal))]
    pub fn handler(ctx: Context<Self>, principal: u64, exact_out: bool) -> Result<()> {
        let authority_seeds: &[&[&[u8]]] = &[&[
            MINT_AUTHORITY_SEED,
            &[ctx.accounts.global_account.ext_mint_authority_bump],
        ]];

        let (m_principal, ext_principal) = pre_unwrap(
            &mut ctx.accounts.ext_mint,
            &ctx.accounts.m_mint,
            &mut ctx.accounts.global_account,
            &ctx.accounts.ext_mint_authority,
            authority_seeds,
            &ctx.accounts.ext_token_program,
            principal,
            exact_out,
        )?;

        // Burn the amount of ext tokens from the user
        burn_tokens(
            &ctx.accounts.from_ext_token_account,            // from
            ext_principal,                                   // amount
            &ctx.accounts.ext_mint,                          // mint
            &ctx.accounts.token_authority.to_account_info(), // authority
            &ctx.accounts.ext_token_program,                 // token program
        )?;

        // Transfer the amount of m tokens from the m vault to the user
        transfer_tokens_from_program(
            &ctx.accounts.vault_m_token_account, // from
            &ctx.accounts.to_m_token_account,    // to
            m_principal,                         // amount
            &ctx.accounts.m_mint,                // mint
            &ctx.accounts.m_vault,               // authority
            &[&[M_VAULT_SEED, &[ctx.accounts.global_account.m_vault_bump]]], // authority seeds
            &ctx.accounts.m_token_program,       // token program
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct OptimisticUnwrap<'info> {
    common: Unwrap<'info>,

    /// CHECK: Manually validated as a program in instruction handler
    pub callback_program: UncheckedAccount<'info>,
}

impl<'info> OptimisticUnwrap<'info> {
    fn validate(&self, principal: u64) -> Result<()> {
        let auth = match &self.common.unwrap_authority {
            Some(auth) => auth.key,
            None => self.common.token_authority.key,
        };

        // Ensure the caller is authorized to wrap
        if !self.common.global_account.wrap_authorities.contains(auth) {
            return err!(ExtError::NotAuthorized);
        }

        if principal == 0 {
            return err!(ExtError::InvalidAmount);
        }

        // Ensure callback program is executable
        if !self.callback_program.executable {
            return err!(ExtError::InvalidAccount);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(principal))]
    pub fn handler(
        ctx: Context<'_, '_, '_, 'info, Self>,
        principal: u64,
        exact_out: bool,
    ) -> Result<()> {
        let authority_seeds: &[&[&[u8]]] = &[&[
            MINT_AUTHORITY_SEED,
            &[ctx.accounts.common.global_account.ext_mint_authority_bump],
        ]];

        let (m_principal, ext_principal) = pre_unwrap(
            &mut ctx.accounts.common.ext_mint,
            &ctx.accounts.common.m_mint,
            &mut ctx.accounts.common.global_account,
            &ctx.accounts.common.ext_mint_authority,
            authority_seeds,
            &ctx.accounts.common.ext_token_program,
            principal,
            exact_out,
        )?;

        // Send the M tokens to the to_token_account optimistically
        transfer_tokens_from_program(
            &ctx.accounts.common.vault_m_token_account, // from
            &ctx.accounts.common.to_m_token_account,    // to
            m_principal,                                // amount
            &ctx.accounts.common.m_mint,                // mint
            &ctx.accounts.common.m_vault,               // authority
            &[&[
                M_VAULT_SEED,
                &[ctx.accounts.common.global_account.m_vault_bump],
            ]], // authority seeds
            &ctx.accounts.common.m_token_program,       // token program
        )?;

        // CPI to the callback program to allow it to perform additional logic
        // TODO: does this need to be custodied by the program or can we use the provided "from_token_account"
        callback_interface::cpi::wrap_callback(
            CpiContext::new(
                ctx.accounts.callback_program.to_account_info(),
                callback_interface::cpi::accounts::Callback {
                    mint: ctx.accounts.common.ext_mint.to_account_info(),
                    send_to: ctx.accounts.common.from_ext_token_account.to_account_info(),
                    token_program: ctx.accounts.common.ext_token_program.to_account_info(),
                },
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            ext_principal,
        )?;

        // Reload the from_ext_token_account
        ctx.accounts.common.from_ext_token_account.reload()?;

        // Burn the ext_principal from the from_ext_token_account
        // This suffices as a balance check since it will fail if they did not provide the tokens
        burn_tokens(
            &ctx.accounts.common.from_ext_token_account, // from
            ext_principal,                               // amount
            &ctx.accounts.common.ext_mint,               // mint
            &ctx.accounts.common.token_authority.to_account_info(), // authority
            &ctx.accounts.common.ext_token_program,      // token program
        )?;

        Ok(())
    }
}

fn pre_unwrap<'info>(
    ext_mint: &mut InterfaceAccount<'info, Mint>,
    m_mint: &InterfaceAccount<'info, Mint>,
    ext_global_account: &mut Account<'info, ExtGlobal>,
    ext_mint_authority: &AccountInfo<'info>,
    authority_seeds: &[&[&[u8]]],
    ext_token_program: &Program<'info, Token2022>,
    principal: u64,
    exact_out: bool,
) -> Result<(u64, u64)> {
    // If necessary, sync the multiplier between M and Ext tokens
    // Return the current value to use for conversions
    let (m_ext_multiplier, ext_multiplier): (f64, f64) = sync_multiplier(
        ext_mint,
        ext_global_account,
        m_mint,
        ext_mint_authority,
        authority_seeds,
        ext_token_program,
    )?;

    let quoter = Quoter::new_from_cache(m_ext_multiplier, ext_multiplier);

    // Return (m_principal, ext_principal) quote for the unwrap operation
    if exact_out {
        Ok((quoter.quote(Op::Unwrap, principal, true)?, principal))
    } else {
        Ok((principal, quoter.quote(Op::Unwrap, principal, false)?))
    }
}

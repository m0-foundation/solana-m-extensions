use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};

use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED},
    utils::{
        conversion::sync_multiplier,
        quote::{Op, Quoter},
        token::{mint_tokens, transfer_tokens},
    },
};

#[derive(Accounts)]
pub struct Wrap<'info> {
    pub token_authority: Signer<'info>,

    // Will be set if a whitelisted authority is signing for a user
    pub wrap_authority: Option<Signer<'info>>,

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
        bump = global_account.m_vault_bump
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
        // signer must be authority of the from token account or delegated by the owner
        // this is checked by the token program
        token::token_program = m_token_program,
    )]
    pub from_m_token_account: InterfaceAccount<'info, TokenAccount>,

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
        // signer is arbitrary to allow wrapping to another user's account
        token::token_program = ext_token_program,
    )]
    pub to_ext_token_account: InterfaceAccount<'info, TokenAccount>,

    // we have duplicate entries for the token2022 program since the interface needs to be consistent
    // but we want to leave open the possibility that either may not have to be token2022 in the future
    pub m_token_program: Program<'info, Token2022>,
    pub ext_token_program: Program<'info, Token2022>,
}

impl Wrap<'_> {
    fn validate(&self, principal: u64) -> Result<()> {
        let auth = match &self.wrap_authority {
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

        let (m_principal, ext_principal): (u64, u64) = pre_wrap(
            &mut ctx.accounts.ext_mint,
            &ctx.accounts.m_mint,
            &mut ctx.accounts.global_account,
            &ctx.accounts.ext_mint_authority,
            authority_seeds,
            &ctx.accounts.ext_token_program,
            principal,
            exact_out,
        )?;

        // Transfer the amount of m tokens from the user to the m vault
        transfer_tokens(
            &ctx.accounts.from_m_token_account,              // from
            &ctx.accounts.vault_m_token_account,             // to
            m_principal,                                     // amount
            &ctx.accounts.m_mint,                            // mint
            &ctx.accounts.token_authority.to_account_info(), // authority
            &ctx.accounts.m_token_program,                   // token program
        )?;

        // Mint the amount of ext tokens to the user
        mint_tokens(
            &ctx.accounts.to_ext_token_account, // to
            ext_principal,                      // amount
            &ctx.accounts.ext_mint,             // mint
            &ctx.accounts.ext_mint_authority,   // authority
            authority_seeds,                    // authority seeds
            &ctx.accounts.ext_token_program,    // token program
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct OptimisticWrap<'info> {
    // TODO a couple accounts are not needed in this version. might make sense to copy and remove them:
    // - from_token_account
    // - token_authority -> will need an explicit wrap authority passed though, however not including means we reduce the risk of the callback since this user doesn't have to sign this call
    common: Wrap<'info>,

    /// CHECK: Manually validated as a program
    callback_program: UncheckedAccount<'info>,
}

impl<'info> OptimisticWrap<'info> {
    fn validate(&self, principal: u64) -> Result<()> {
        let auth = match &self.common.wrap_authority {
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

        // TODO do we need to add a re-entrancy lock
        // to prevent nested calls to this program from the callback?
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

        let (m_principal, ext_principal): (u64, u64) = pre_wrap(
            &mut ctx.accounts.common.ext_mint,
            &ctx.accounts.common.m_mint,
            &mut ctx.accounts.common.global_account,
            &ctx.accounts.common.ext_mint_authority,
            authority_seeds,
            &ctx.accounts.common.ext_token_program,
            principal,
            exact_out,
        )?;

        // Mint the ext_principal to the to_token_account optimistically
        mint_tokens(
            &ctx.accounts.common.to_ext_token_account, // to
            ext_principal,                             // amount
            &ctx.accounts.common.ext_mint,             // mint
            &ctx.accounts.common.ext_mint_authority,   // authority
            authority_seeds,                           // authority seeds
            &ctx.accounts.common.ext_token_program,    // token program
        )?;

        // Cache the balance of the m vault
        let pre_m_balance = ctx.accounts.common.vault_m_token_account.amount;

        // CPI to the callback program to allow it to perform additional logic
        callback_interface::cpi::callback(
            CpiContext::new(
                ctx.accounts.callback_program.to_account_info(),
                callback_interface::cpi::accounts::Callback {
                    mint: ctx.accounts.common.m_mint.to_account_info(),
                    send_to: ctx.accounts.common.vault_m_token_account.to_account_info(),
                    token_program: ctx.accounts.common.m_token_program.to_account_info(),
                },
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            m_principal,
        )?;

        // Revert if the vault balance has not increased by atleast the m_principal calculated for the wrap
        ctx.accounts.common.vault_m_token_account.reload()?;

        if ctx.accounts.common.vault_m_token_account.amount
            < pre_m_balance
                .checked_add(m_principal)
                .ok_or(ExtError::MathOverflow)?
        {
            return err!(ExtError::InvalidAmount);
        }

        Ok(())
    }
}

fn pre_wrap<'info>(
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
    // Return the current values to use for conversions
    let (m_multiplier, ext_multiplier): (f64, f64) = sync_multiplier(
        ext_mint,
        ext_global_account,
        m_mint,
        ext_mint_authority,
        authority_seeds,
        ext_token_program,
    )?;

    let quoter = Quoter::new_from_cache(m_multiplier, ext_multiplier);

    // Calculate the principal amount of ext tokens to mint
    // based on the principal amount of m tokens to wrap
    if exact_out {
        Ok((quoter.quote(Op::Wrap, principal, true)?, principal))
    } else {
        Ok((principal, quoter.quote(Op::Wrap, principal, false)?))
    }
}

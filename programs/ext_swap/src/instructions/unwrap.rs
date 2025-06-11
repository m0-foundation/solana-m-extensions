use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use earn::state::{Earner, EARNER_SEED};
use m_ext::cpi::accounts::Unwrap as ExtUnwrap;
use m_ext::state::{EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED};

use crate::errors::SwapError;
use crate::state::{SwapGlobal, GLOBAL_SEED};

#[derive(Accounts)]
pub struct Unwrap<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    // Required if the swap program is not whitelisted on the extension
    pub unwrap_authority: Option<Signer<'info>>,

    /*
     * Global and Earner accounts
     */
    #[account(
        has_one = m_mint,
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
    )]
    pub swap_global: Box<Account<'info, SwapGlobal>>,
    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        seeds::program = from_ext_program.key(),
        bump,
    )]
    /// CHECK: CPI will validate the global account
    pub from_global: AccountInfo<'info>,
    #[account(
        seeds = [EARNER_SEED, from_m_vault.key().as_ref()],
        seeds::program = earn::ID,
        bump = m_earner_account.bump,
    )]
    pub m_earner_account: Box<Account<'info, Earner>>,

    /*
     * Mints
     */
    #[account(mut)]
    pub from_mint: Box<InterfaceAccount<'info, Mint>>,
    pub m_mint: Box<InterfaceAccount<'info, Mint>>,

    /*
     * Token Accounts
     */
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = m_mint,
        associated_token::authority = signer,
        associated_token::token_program = m_token_program,
    )]
    pub m_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = from_mint,
        associated_token::authority = signer,
        associated_token::token_program = from_token_program,
    )]
    pub from_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /*
     * Authorities
     */
    #[account(
        seeds = [M_VAULT_SEED],
        seeds::program = from_ext_program.key(),
        bump,
    )]
    /// CHECK: account does not hold data
    pub from_m_vault_auth: AccountInfo<'info>,
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        seeds::program = from_ext_program.key(),
        bump,
    )]
    /// CHECK: account does not hold data
    pub from_mint_authority: AccountInfo<'info>,

    /*
     * Vaults
     */
    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = from_m_vault_auth,
        associated_token::token_program = m_token_program,
    )]
    pub from_m_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /*
     * Token Programs
     */
    pub from_token_program: Interface<'info, TokenInterface>,
    pub m_token_program: Interface<'info, TokenInterface>,

    /*
     * Programs
     */
    /// CHECK: checked against whitelisted extensions
    pub from_ext_program: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Unwrap<'info> {
    fn validate(&self) -> Result<()> {
        if !self
            .swap_global
            .whitelisted_extensions
            .contains(self.from_ext_program.key)
        {
            return err!(SwapError::InvalidExtension);
        }

        if !self
            .swap_global
            .whitelisted_unwrappers
            .contains(self.signer.key)
        {
            return err!(SwapError::UnauthorizedUnwrapper);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<'_, '_, '_, 'info, Self>, amount: u64) -> Result<()> {
        // Set swap program as authority if none provided
        let unwrap_authority = match &ctx.accounts.unwrap_authority {
            Some(auth) => auth.to_account_info(),
            None => ctx.accounts.swap_global.to_account_info(),
        };

        m_ext::cpi::unwrap(
            CpiContext::new_with_signer(
                ctx.accounts.from_ext_program.to_account_info(),
                ExtUnwrap {
                    token_authority: ctx.accounts.signer.to_account_info(),
                    unwrap_authority: Some(unwrap_authority),
                    m_mint: ctx.accounts.m_mint.to_account_info(),
                    ext_mint: ctx.accounts.from_mint.to_account_info(),
                    global_account: ctx.accounts.from_global.to_account_info(),
                    m_earner_account: ctx.accounts.m_earner_account.to_account_info(),
                    m_vault: ctx.accounts.from_m_vault_auth.to_account_info(),
                    ext_mint_authority: ctx.accounts.from_mint_authority.to_account_info(),
                    to_m_token_account: ctx.accounts.m_token_account.to_account_info(),
                    vault_m_token_account: ctx.accounts.from_m_vault.to_account_info(),
                    from_ext_token_account: ctx.accounts.from_token_account.to_account_info(),
                    m_token_program: ctx.accounts.m_token_program.to_account_info(),
                    ext_token_program: ctx.accounts.from_token_program.to_account_info(),
                },
                &[&[GLOBAL_SEED, &[ctx.accounts.swap_global.bump]]],
            )
            .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            amount,
        )
    }
}

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use earn::state::{Global as EarnGlobal, GLOBAL_SEED as EARN_GLOBAL_SEED};
use m_ext::cpi::accounts::{Unwrap, Wrap};
use m_ext::state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED};

use crate::{
    errors::SwapError,
    state::{Global, GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    /*
     * Program globals
     */
    #[account(
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
        has_one = m_mint,
    )]
    pub swap_global: Account<'info, Global>,
    #[account(
        seeds = [EXT_GLOBAL_SEED],
        seeds::program = from_ext_program,
        bump = from_global.bump,
    )]
    pub from_global: Account<'info, ExtGlobal>,
    #[account(
        seeds = [EXT_GLOBAL_SEED],
        seeds::program = to_ext_program,
        bump = to_global.bump,
    )]
    pub to_global: Account<'info, ExtGlobal>,
    #[account(
        seeds = [EARN_GLOBAL_SEED],
        seeds::program = earn::ID,
        bump = to_global.bump,
    )]
    pub m_earn_global_account: Account<'info, EarnGlobal>,

    /*
     * Mints
     */
    #[account(mut)]
    pub from_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub to_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub m_mint: InterfaceAccount<'info, Mint>,

    /*
     * Token Accounts
     */
    #[account(mut)]
    pub from_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub to_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = m_mint,
        associated_token::authority = signer,
        associated_token::token_program = m_token_program,
    )]
    pub intermediate_m_account: InterfaceAccount<'info, TokenAccount>,

    /*
     * Authorities
     */
    #[account(
        seeds = [M_VAULT_SEED],
        seeds::program = from_ext_program,
        bump = from_global.m_vault_bump,
    )]
    pub from_m_vault_auth: AccountInfo<'info>,
    #[account(
        seeds = [M_VAULT_SEED],
        seeds::program = to_ext_program,
        bump = to_global.m_vault_bump,
    )]
    pub to_m_vault_auth: AccountInfo<'info>,
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        seeds::program = from_ext_program,
        bump = from_global.ext_mint_authority_bump,
    )]
    pub from_mint_authority: AccountInfo<'info>,
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        seeds::program = to_ext_program,
        bump = to_global.ext_mint_authority_bump,
    )]
    pub to_mint_authority: AccountInfo<'info>,

    /*
     * Vaults
     */
    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = from_m_vault_auth,
        associated_token::token_program = m_token_program,
    )]
    pub from_m_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = to_m_vault_auth,
        associated_token::token_program = m_token_program,
    )]
    pub to_m_vault: InterfaceAccount<'info, TokenAccount>,

    /*
     * Token Programs
     */
    pub from_token_program: Interface<'info, TokenInterface>,
    pub to_token_program: Interface<'info, TokenInterface>,
    pub m_token_program: Interface<'info, TokenInterface>,

    /*
     * Programs
     */
    pub from_ext_program: UncheckedAccount<'info>,
    pub to_ext_program: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Swap<'info> {
    fn validate(
        &self,
        remaining_accounts: &[AccountInfo<'_>],
        remaining_accounts_split_idx: usize,
    ) -> Result<()> {
        for ext_program in [&self.from_ext_program, &self.to_ext_program] {
            if !self
                .swap_global
                .whitelisted_extensions
                .contains(ext_program.key)
            {
                return err!(SwapError::InvalidExtension);
            }
        }

        if remaining_accounts_split_idx > remaining_accounts.len() {
            return err!(SwapError::InvalidRemainingAccountsIndex);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(ctx.remaining_accounts, remaining_accounts_split_idx))]
    pub fn handler(
        ctx: Context<'_, '_, '_, 'info, Self>,
        amount: u64,
        remaining_accounts_split_idx: usize,
    ) -> Result<()> {
        let m_pre_balance = ctx.accounts.intermediate_m_account.amount;
        let to_pre_balance = ctx.accounts.to_token_account.amount;

        // Optional remainging accounts passed to the instructions
        let remaining_accounts = ctx.remaining_accounts;
        let (unwrap_remaining_accounts, wrap_remaining_accounts) =
            remaining_accounts.split_at(remaining_accounts_split_idx);

        m_ext::cpi::unwrap(
            CpiContext::new(
                ctx.accounts.from_ext_program.to_account_info(),
                Unwrap {
                    signer: ctx.accounts.signer.to_account_info(),
                    m_mint: ctx.accounts.m_mint.to_account_info(),
                    ext_mint: ctx.accounts.from_mint.to_account_info(),
                    global_account: ctx.accounts.from_global.to_account_info(),
                    m_earn_global_account: ctx.accounts.m_earn_global_account.to_account_info(),
                    m_vault: ctx.accounts.from_m_vault_auth.to_account_info(),
                    ext_mint_authority: ctx.accounts.from_mint_authority.to_account_info(),
                    to_m_token_account: ctx.accounts.intermediate_m_account.to_account_info(),
                    vault_m_token_account: ctx.accounts.from_m_vault.to_account_info(),
                    from_ext_token_account: ctx.accounts.from_token_program.to_account_info(),
                    m_token_program: ctx.accounts.m_token_program.to_account_info(),
                    ext_token_program: ctx.accounts.from_ext_program.to_account_info(),
                },
            )
            .with_remaining_accounts(unwrap_remaining_accounts.to_vec()),
            amount,
        )?;

        // Reload M balance and wrap difference
        ctx.accounts.intermediate_m_account.reload()?;
        let m_delta = ctx.accounts.intermediate_m_account.amount - m_pre_balance;

        m_ext::cpi::wrap(
            CpiContext::new(
                ctx.accounts.to_ext_program.to_account_info(),
                Wrap {
                    signer: ctx.accounts.signer.to_account_info(),
                    m_mint: ctx.accounts.m_mint.to_account_info(),
                    ext_mint: ctx.accounts.to_mint.to_account_info(),
                    global_account: ctx.accounts.to_global.to_account_info(),
                    m_earn_global_account: ctx.accounts.m_earn_global_account.to_account_info(),
                    m_vault: ctx.accounts.to_m_vault_auth.to_account_info(),
                    ext_mint_authority: ctx.accounts.to_mint_authority.to_account_info(),
                    from_m_token_account: ctx.accounts.intermediate_m_account.to_account_info(),
                    vault_m_token_account: ctx.accounts.to_m_vault.to_account_info(),
                    to_ext_token_account: ctx.accounts.to_token_program.to_account_info(),
                    m_token_program: ctx.accounts.m_token_program.to_account_info(),
                    ext_token_program: ctx.accounts.to_ext_program.to_account_info(),
                },
            )
            .with_remaining_accounts(wrap_remaining_accounts.to_vec()),
            m_delta,
        )?;

        // Reload and log amounts
        ctx.accounts.to_token_account.reload()?;
        let received_amount = ctx.accounts.to_token_account.amount - to_pre_balance;
        msg!("{} -> {} M -> {}", amount, m_delta, received_amount);

        // Close intermediate account
        ctx.accounts.intermediate_m_account.reload()?;
        if ctx.accounts.intermediate_m_account.amount == 0
            && ctx.accounts.intermediate_m_account.owner == ctx.accounts.signer.key()
        {
            anchor_spl::token_interface::close_account(CpiContext::new(
                ctx.accounts.m_token_program.to_account_info(),
                anchor_spl::token_interface::CloseAccount {
                    account: ctx.accounts.intermediate_m_account.to_account_info(),
                    destination: ctx.accounts.signer.to_account_info(),
                    authority: ctx.accounts.signer.to_account_info(),
                },
            ))?;
        }

        Ok(())
    }
}

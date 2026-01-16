use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use m_ext::cpi::accounts::{Unwrap, UnwrapAsset as ExtUnwrapAsset};
use m_ext::state::{EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED};

use crate::{
    errors::SwapError,
    state::{SwapGlobal, GLOBAL_SEED, REPLACE_AUTHORITY_SEED},
};

#[derive(Accounts)]
pub struct UnwrapAsset<'info> {
    pub signer: Signer<'info>,

    // Required if the fallback_replace_authority is not whitelisted on the extension
    pub replace_authority: Option<Signer<'info>>,

    /// CHECK: PDA used as replace authority for JMI extensions
    #[account(
        seeds = [REPLACE_AUTHORITY_SEED],
        bump,
    )]
    pub fallback_replace_authority: AccountInfo<'info>,

    /*
     * Program globals
     */
    #[account(
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
    )]
    pub swap_global: Box<Account<'info, SwapGlobal>>,

    /// Source extension global (for unwrap)
    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        seeds::program = from_ext_program.key(),
        bump,
    )]
    /// CHECK: CPI will validate the global account
    pub from_global: AccountInfo<'info>,

    /// JMI extension global (for unwrap_asset)
    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        seeds::program = jmi_ext_program.key(),
        bump,
    )]
    /// CHECK: CPI will validate the global account
    pub jmi_global: AccountInfo<'info>,

    /*
     * Mints
     */
    #[account(mut)]
    /// Validated by unwrap on the extension program
    pub from_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mint::token_program = m_token_program)]
    pub m_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mint::token_program = asset_token_program)]
    pub asset_mint: Box<InterfaceAccount<'info, Mint>>,

    /*
     * Asset config for JMI
     */
    #[account(mut)]
    /// CHECK: CPI will validate the asset config
    pub asset_config: AccountInfo<'info>,

    /*
     * Token Accounts
     */
    #[account(
        mut,
        token::mint = from_mint,
        token::token_program = from_token_program,
    )]
    pub from_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = asset_mint,
        token::token_program = asset_token_program,
    )]
    pub to_asset_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = swap_global,
        associated_token::token_program = m_token_program,
    )]
    pub swap_m_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /*
     * Authorities & Vaults for source extension (unwrap)
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
    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = from_m_vault_auth,
        associated_token::token_program = m_token_program,
    )]
    pub from_m_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /*
     * Vaults for JMI extension (unwrap_asset)
     */
    #[account(
        seeds = [M_VAULT_SEED],
        seeds::program = jmi_ext_program.key(),
        bump,
    )]
    /// CHECK: account does not hold data
    pub jmi_m_vault_auth: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = jmi_m_vault_auth,
        associated_token::token_program = m_token_program,
    )]
    pub jmi_m_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = asset_mint,
        associated_token::authority = jmi_m_vault_auth,
        associated_token::token_program = asset_token_program,
    )]
    pub jmi_asset_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /*
     * Token Programs
     */
    pub from_token_program: Interface<'info, TokenInterface>,
    pub asset_token_program: Interface<'info, TokenInterface>,
    pub m_token_program: Interface<'info, TokenInterface>,

    /*
     * Programs
     */
    /// CHECK: checked against whitelisted extensions
    pub from_ext_program: UncheckedAccount<'info>,
    /// CHECK: checked against whitelisted extensions
    pub jmi_ext_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> UnwrapAsset<'info> {
    fn validate(&self, from_principal: u64) -> Result<()> {
        // Validate both extensions are whitelisted
        for ext_program in [&self.from_ext_program, &self.jmi_ext_program] {
            if !self.swap_global.is_extension_whitelisted(ext_program.key) {
                return err!(SwapError::InvalidExtension);
            }
        }

        if from_principal == 0 {
            return err!(SwapError::InvalidAmount);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(from_principal))]
    pub fn handler(ctx: Context<'_, '_, '_, 'info, Self>, from_principal: u64) -> Result<()> {
        let m_pre_balance = ctx.accounts.swap_m_account.amount;

        // Set replace authority as authority if none provided
        let replace_authority = match &ctx.accounts.replace_authority {
            Some(auth) => auth.to_account_info(),
            None => ctx.accounts.fallback_replace_authority.to_account_info(),
        };

        // 1. Unwrap source extension → M (to swap_m_account)
        m_ext::cpi::unwrap(
            CpiContext::new_with_signer(
                ctx.accounts.from_ext_program.to_account_info(),
                Unwrap {
                    token_authority: ctx.accounts.signer.to_account_info(),
                    unwrap_authority: Some(replace_authority.clone()),
                    m_mint: ctx.accounts.m_mint.to_account_info(),
                    ext_mint: ctx.accounts.from_mint.to_account_info(),
                    global_account: ctx.accounts.from_global.to_account_info(),
                    m_vault: ctx.accounts.from_m_vault_auth.to_account_info(),
                    ext_mint_authority: ctx.accounts.from_mint_authority.to_account_info(),
                    to_m_token_account: ctx.accounts.swap_m_account.to_account_info(),
                    vault_m_token_account: ctx.accounts.from_m_vault.to_account_info(),
                    from_ext_token_account: ctx.accounts.from_token_account.to_account_info(),
                    m_token_program: ctx.accounts.m_token_program.to_account_info(),
                    ext_token_program: ctx.accounts.from_token_program.to_account_info(),
                },
                &[&[
                    REPLACE_AUTHORITY_SEED,
                    &[ctx.bumps.fallback_replace_authority],
                ]],
            ),
            from_principal,
        )?;

        // 2. Calculate M received
        ctx.accounts.swap_m_account.reload()?;
        let m_amount = ctx.accounts.swap_m_account.amount - m_pre_balance;

        // 3. Call JMI unwrap_asset (swap_global signs for token transfer, replace_authority for authorization)
        m_ext::cpi::unwrap_asset(
            CpiContext::new_with_signer(
                ctx.accounts.jmi_ext_program.to_account_info(),
                ExtUnwrapAsset {
                    token_authority: ctx.accounts.swap_global.to_account_info(),
                    replace_authority: Some(replace_authority),
                    m_mint: ctx.accounts.m_mint.to_account_info(),
                    asset_mint: ctx.accounts.asset_mint.to_account_info(),
                    global_account: ctx.accounts.jmi_global.to_account_info(),
                    asset_config: ctx.accounts.asset_config.to_account_info(),
                    m_vault: ctx.accounts.jmi_m_vault_auth.to_account_info(),
                    from_m_token_account: ctx.accounts.swap_m_account.to_account_info(),
                    vault_m_token_account: ctx.accounts.jmi_m_vault.to_account_info(),
                    vault_asset_token_account: ctx.accounts.jmi_asset_vault.to_account_info(),
                    to_asset_token_account: ctx.accounts.to_asset_token_account.to_account_info(),
                    m_token_program: ctx.accounts.m_token_program.to_account_info(),
                    asset_token_program: ctx.accounts.asset_token_program.to_account_info(),
                },
                &[
                    &[
                        REPLACE_AUTHORITY_SEED,
                        &[ctx.bumps.fallback_replace_authority],
                    ],
                    &[GLOBAL_SEED, &[ctx.accounts.swap_global.bump]],
                ],
            ),
            m_amount,
        )?;

        msg!("{} ext -> {} M -> asset", from_principal, m_amount);

        Ok(())
    }
}

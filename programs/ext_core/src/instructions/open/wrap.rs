use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ExtError,
    state::{
        Config, ExtConfig, CONFIG_SEED, EXT_CONFIG_SEED_PREFIX, MINT_AUTHORITY_SEED_PREFIX,
        M_VAULT_SEED_PREFIX,
    },
    utils::{
        conversion::{amount_to_principal_down, MULTIPLIER_SCALE},
        token::{mint_tokens, transfer_tokens},
    },
};
use earn::state::Global as EarnGlobal;
use ext_yield_interface::cpi::accounts::Sync;

#[derive(Accounts)]
pub struct Wrap<'info> {
    // TODO handle optional permissions
    // #[account(
    //     constraint = signer.key() != Pubkey::default() && global_account.wrap_authorities.contains(&signer.key()) @ ExtError::NotAuthorized,
    // )]
    pub signer: Signer<'info>,

    pub m_mint: InterfaceAccount<'info, Mint>,

    pub m_earn_global_account: Account<'info, EarnGlobal>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = m_mint @ ExtError::InvalidMint,
        has_one = m_earn_global_account @ ExtError::InvalidAccount,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.bump,
        has_one = ext_program @ ExtError::InvalidExtensionProgram,
    )]
    pub ext_config: Account<'info, ExtConfig>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.m_vault_bump
    )]
    pub m_vault: AccountInfo<'info>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.ext_mint_authority_bump,
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    #[account(
        mut,
        token::mint = m_mint,
        token::authority = signer,
        token::token_program = m_token_program
    )]
    pub from_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = m_token_program,
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    pub m_token_program: Interface<'info, TokenInterface>,

    #[account(
        mut,
        token::mint = ext_mint,
        token::token_program = ext_token_program
    )]
    pub to_ext_token_account: InterfaceAccount<'info, TokenAccount>,

    pub ext_token_program: Interface<'info, TokenInterface>,

    /// CHECK: This program is validated by checking that the key
    /// matches the stored key on the ext_config account
    pub ext_program: AccountInfo<'info>,
}

pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, Wrap<'info>>, amount: u64) -> Result<()> {
    // Transfer the amount of m tokens from the user to the m vault
    transfer_tokens(
        &ctx.accounts.from_m_token_account,     // from
        &ctx.accounts.vault_m_token_account,    // to
        amount,                                 // amount
        &ctx.accounts.m_mint,                   // mint
        &ctx.accounts.signer.to_account_info(), // authority
        &ctx.accounts.m_token_program,          // token program
    )?;

    // If the extension requires syncing before conversions,
    // Sync the ext token before wrapping and get the current multiplier
    // of ext tokens to m tokens. This will most often be 1:1,
    // but a few yield distribution formats, such as IBT and ScaledUiAmount,
    // will have a different multiplier.
    // Formats that have permissioned syncs do not have multipliers
    let multiplier = if ctx.accounts.ext_config.sync_on_op {
        let cpi_context = CpiContext::new(
            ctx.accounts.ext_program.to_account_info(),
            Sync {
                m_mint: ctx.accounts.m_mint.to_account_info(),
                ext_mint: ctx.accounts.ext_mint.to_account_info(),
                ext_global_account: ctx.accounts.m_earn_global_account.to_account_info(),
                m_earn_global_account: ctx.accounts.m_earn_global_account.to_account_info(),
                core_config: ctx.accounts.config.to_account_info(),
                ext_config: ctx.accounts.ext_config.to_account_info(),
                m_vault: ctx.accounts.m_vault.to_account_info(),
                vault_m_token_account: ctx.accounts.vault_m_token_account.to_account_info(),
            },
        )
        .with_remaining_accounts(ctx.remaining_accounts.to_vec());

        ext_yield_interface::cpi::sync(cpi_context)?.get()
    } else {
        MULTIPLIER_SCALE
    };

    // Calculate the amount of ext tokens to mint based
    // on the amount of m tokens wrapped
    let principal = amount_to_principal_down(amount, multiplier)?;

    // Mint the amount of ext tokens to the user
    mint_tokens(
        &ctx.accounts.to_ext_token_account, // to
        principal,                          // amount
        &ctx.accounts.ext_mint,             // mint
        &ctx.accounts.ext_mint_authority,   // authority
        &[&[
            MINT_AUTHORITY_SEED_PREFIX,
            ctx.accounts.ext_mint.key().as_ref(),
            &[ctx.accounts.ext_config.ext_mint_authority_bump],
        ]], // authority seeds
        &ctx.accounts.ext_token_program,    // token program
    )?;

    Ok(())
}

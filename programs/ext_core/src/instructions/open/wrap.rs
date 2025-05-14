use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ExtError,
    state::{Config, ExtConfig, CONFIG_SEED, EXT_CONFIG_SEED_PREFIX, M_VAULT_SEED_PREFIX},
    utils::token::transfer_tokens,
};
use earn::state::Global as EarnGlobal;
use ext_yield_interface::cpi::accounts::MintEquivalent;

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

    #[account(
        mut,
        mint::token_program = ext_token_program,
        mint::authority = ext_mint_authority,
    )]
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

    /// CHECK: This account is validated in the CPI call to the extension program
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

    // Mint the amount of ext tokens to the user
    // The extension yield program should handle the conversion of m tokens to ext tokens
    // and update the multiplier prior to minting the ext tokens, if required
    let cpi_context = CpiContext::new(
        ctx.accounts.ext_program.to_account_info(),
        MintEquivalent {
            m_mint: ctx.accounts.m_mint.to_account_info(),
            ext_mint: ctx.accounts.ext_mint.to_account_info(),
            ext_global_account: ctx.accounts.m_earn_global_account.to_account_info(),
            m_earn_global_account: ctx.accounts.m_earn_global_account.to_account_info(),
            core_config: ctx.accounts.config.to_account_info(),
            ext_config: ctx.accounts.ext_config.to_account_info(),
            m_vault: ctx.accounts.m_vault.to_account_info(),
            vault_m_token_account: ctx.accounts.vault_m_token_account.to_account_info(),
            to_ext_token_account: ctx.accounts.to_ext_token_account.to_account_info(),
            ext_token_program: ctx.accounts.ext_token_program.to_account_info(),
            ext_mint_authority: ctx.accounts.ext_mint_authority.clone(),
        },
    )
    .with_remaining_accounts(ctx.remaining_accounts.to_vec());

    ext_yield_interface::cpi::mint_equivalent(cpi_context, amount)?;

    Ok(())
}

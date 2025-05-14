use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    mint_to_checked, Mint, MintToChecked, TokenAccount, TokenInterface,
};
use earn::state::Global as EarnGlobal;

declare_program!(ext_core);
use ext_core::{
    accounts::{Config as CoreConfig, ExtConfig},
    constants::{CONFIG_SEED as CORE_CONFIG_SEED, EXT_CONFIG_SEED_PREFIX, M_VAULT_SEED_PREFIX},
    program::ExtCore,
};

declare_id!("4TqLZemQ5ba29dgg1N2NvY65hyG2nDF5EnyGXm8xfjHb");

#[program]
pub mod ext_yield_interface {
    use super::*;

    pub fn mint_equivalent(ctx: Context<MintEquivalent>, amount_m: u64) -> Result<()> {
        // Note: sync multiplier first, if required

        // Multiplier is 1:1 so we just use the m_amount as the amount to mint
        let amount = amount_m;

        let mint_authority_seeds: &[&[&[u8]]] = &[&[
            MINT_AUTHORITY_SEED,
            &[ctx.accounts.ext_global_account.ext_mint_authority_bump],
        ]];

        mint_tokens(
            &ctx.accounts.to_ext_token_account, // to: &InterfaceAccount<'info, TokenAccount>,
            amount,                             // amount: u64,
            &ctx.accounts.ext_mint,             // mint: &InterfaceAccount<'info, Mint>,
            &ctx.accounts.ext_mint_authority,   // authority: &AccountInfo<'info>,
            mint_authority_seeds,               // authority_seeds: &[&[&[u8]]],
            &ctx.accounts.ext_token_program,    // token_program: &Interface<'info, TokenInterface>,
        )?;

        Ok(())
    }

    pub fn get_equivalent(_ctx: Context<GetEquivalent>, amount_m: u64) -> Result<u64> {
        // Note: sync multiplier first, if required

        // Multiplier is 1:1 so we just return the amount_m as the equivalent amount
        Ok(amount_m)
    }
}

// Note: this interface assumes a constant ratio of 1:1 between m_mint and ext_mint.
// If this is not the case, then implementing the actual calculation of the multiplier
// will be necessary, which may involve more complex logic in the `sync` function.
pub const MULTIPLIER: u64 = 1_000_000_000_000;

pub const MINT_AUTHORITY_SEED: &[u8] = b"mint_authority";
pub const EXT_GLOBAL_SEED: &[u8] = b"global";

#[account]
pub struct ExtGlobal {
    pub bump: u8,
    pub ext_mint_authority_bump: u8,
}

#[derive(Accounts)]
pub struct GetEquivalent<'info> {
    m_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    ext_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = ext_global_account.bump,
    )]
    ext_global_account: Account<'info, ExtGlobal>,

    m_earn_global_account: Account<'info, EarnGlobal>,

    #[account(
        seeds = [CORE_CONFIG_SEED],
        bump = core_config.bump,
        seeds::program = ExtCore::id(),
        has_one = m_earn_global_account,
        has_one = m_mint,
    )]
    core_config: Account<'info, CoreConfig>,

    #[account(
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.bump,
        has_one = ext_mint,
    )]
    ext_config: Account<'info, ExtConfig>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED_PREFIX, ext_mint.key().as_ref()],
        bump,
        seeds::program = ExtCore::id(),
    )]
    m_vault: AccountInfo<'info>,

    #[account(
        associated_token::mint = m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = core_config.m_token_program,
    )]
    vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        bump = ext_global_account.ext_mint_authority_bump,
    )]
    ext_mint_authority: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct MintEquivalent<'info> {
    m_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        mint::token_program = ext_token_program
    )]
    ext_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = ext_global_account.bump,
    )]
    ext_global_account: Account<'info, ExtGlobal>,

    m_earn_global_account: Account<'info, EarnGlobal>,

    #[account(
        seeds = [CORE_CONFIG_SEED],
        bump = core_config.bump,
        seeds::program = ExtCore::id(),
        has_one = m_earn_global_account,
        has_one = m_mint,
    )]
    core_config: Account<'info, CoreConfig>,

    #[account(
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.bump,
        has_one = ext_mint,
    )]
    ext_config: Account<'info, ExtConfig>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED_PREFIX, ext_mint.key().as_ref()],
        bump,
        seeds::program = ExtCore::id(),
    )]
    m_vault: AccountInfo<'info>,

    #[account(
        associated_token::mint = m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = core_config.m_token_program,
    )]
    vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = ext_mint,
        token::token_program = ext_token_program,
    )]
    to_ext_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        bump = ext_global_account.ext_mint_authority_bump,
    )]
    ext_mint_authority: AccountInfo<'info>,

    ext_token_program: Interface<'info, TokenInterface>,
}

pub fn mint_tokens<'info>(
    to: &InterfaceAccount<'info, TokenAccount>,
    amount: u64,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &AccountInfo<'info>,
    authority_seeds: &[&[&[u8]]],
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    // Build the arguments for the mint instruction
    let mint_options = MintToChecked {
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.clone(),
    };

    let cpi_context = CpiContext::new_with_signer(
        token_program.to_account_info(),
        mint_options,
        authority_seeds,
    );

    // Call the mint instruction
    mint_to_checked(cpi_context, amount, mint.decimals)?;

    Ok(())
}

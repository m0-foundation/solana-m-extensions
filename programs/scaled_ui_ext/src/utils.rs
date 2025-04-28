// ext_earn/utils/token.rs

// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, mint_to, transfer_checked, Burn, Mint, MintTo, Token2022, TokenAccount, TransferChecked,
};
use earn::state::Global as EarnGlobal;
use solana_program::program::invoke_signed;
use crate::constants::{INDEX_SCALE_F64, INDEX_SCALE_U64};

pub fn transfer_tokens_from_program<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    amount: u64,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &AccountInfo<'info>,
    authority_seeds: &[&[&[u8]]],
    token_program: &Program<'info, Token2022>,
) -> Result<()> {
    // Build the arguments for the transfer instruction
    let transfer_options = TransferChecked {
        from: from.to_account_info(),
        to: to.to_account_info(),
        mint: mint.to_account_info(),
        authority: authority.clone(),
    };
    let cpi_context = CpiContext::new_with_signer(
        token_program.to_account_info(),
        transfer_options,
        authority_seeds,
    );

    // Call the transfer instruction
    transfer_checked(cpi_context, amount, mint.decimals)?;

    Ok(())
}

pub fn transfer_tokens<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    amount: u64,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &AccountInfo<'info>,
    token_program: &Program<'info, Token2022>,
) -> Result<()> {
    // Build the arguments for the transfer instruction
    let transfer_options = TransferChecked {
        from: from.to_account_info(),
        to: to.to_account_info(),
        mint: mint.to_account_info(),
        authority: authority.clone(),
    };
    let cpi_context = CpiContext::new(token_program.to_account_info(), transfer_options);

    // Call the transfer instruction
    transfer_checked(cpi_context, amount, mint.decimals)?;

    Ok(())
}

// Convenience functions to mint and burn tokens from a program using a PDA signer

pub fn mint_tokens<'info>(
    to: &InterfaceAccount<'info, TokenAccount>,
    amount: u64,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &AccountInfo<'info>,
    authority_seeds: &[&[&[u8]]],
    token_program: &Program<'info, Token2022>,
) -> Result<()> {
    // Build the arguments for the mint instruction
    let mint_options = MintTo {
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
    mint_to(cpi_context, amount)?;

    Ok(())
}

pub fn burn_tokens<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    amount: u64,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &AccountInfo<'info>,
    token_program: &Program<'info, Token2022>,
) -> Result<()> {
    // Build the arguments for the burn instruction
    let burn_options = Burn {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        authority: authority.clone(),
    };

    let cpi_context = CpiContext::new(token_program.to_account_info(), burn_options);

    // Call the burn instruction
    burn(cpi_context, amount)?;

    Ok(())
}

fn update_scaled_ui_multiplier<'info>(
    mint: &InterfaceAccount<'info, Mint>,
    multiplier: f64,
    timestamp: i64,
    authority: &AccountInfo<'info>,
    authority_seeds: &[&[&[u8]]],
    token_program: &Program<'info, Token2022>,
) -> Result<()> {

    invoke_signed(
        &spl_token_2022::extension::scaled_ui_amount::instruction::update_multiplier(
            &token_program.key(),
            &mint.key(),
            &authority.key(),
            &[],
            multiplier,
            timestamp,
        )?,
        &[
            mint.to_account_info(),
            authority.clone(),
        ],
        authority_seeds,
    )?;

    Ok(())
}

pub fn sync_multiplier<'info>(
    mint: &InterfaceAccount<'info, Mint>,
    m_earn_global_account: &Account<'info, EarnGlobal>,
    authority: &AccountInfo<'info>,
    authority_seeds: &[&[&[u8]]],
    token_program: &Program<'info, Token2022>,
) -> Result<f64> {
    // Get the current index and timestamp from the m_earn_global_account
    let multiplier: f64 = (m_earn_global_account.index as f64) / INDEX_SCALE_F64;
    let timestamp: i64 = m_earn_global_account.timestamp as i64;

    update_scaled_ui_multiplier(mint, multiplier, timestamp, authority, authority_seeds, token_program)?;

    return Ok(multiplier)
}

pub fn amount_to_principal(
    amount: u64,
    multiplier: f64
) -> u64 {
    // We want to avoid precision errors with floating point numbers
    // Therefore, we use integer math.
    let index = (multiplier * INDEX_SCALE_F64).trunc() as u64;

    // Calculate the principal from the amount and index, rounding down
    // TODO mirror EVM rounding behavior
    (amount * INDEX_SCALE_U64) / index
}

pub fn principal_to_amount(
    principal: u64,
    multiplier: f64
) -> u64 {
    // We want to avoid precision errors with floating point numbers
    // Therefore, we use integer math.
    let index = (multiplier * INDEX_SCALE_F64).trunc() as u64;

    // Calculate the amount from the principal and index, rounding down
    // TODO mirror EVM rounding behavior``
    (principal * index) / INDEX_SCALE_U64
}

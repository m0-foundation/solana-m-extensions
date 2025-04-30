// ext_earn/utils/token.rs

// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, mint_to, transfer_checked, Burn, Mint, MintTo, Token2022, TokenAccount, TransferChecked,
};
use spl_token_2022::extension::{
    BaseStateWithExtensions, StateWithExtensions,
    scaled_ui_amount::{PodF64, UnixTimestamp, ScaledUiAmountConfig},
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

    // Compare against the current multiplier
    // If the multiplier is the same, we don't need to update
    { // explicit scope to drop the borrow at the end of the code block
        let ext_account_info= &mint.to_account_info();
        let ext_data = ext_account_info.try_borrow_data()?;
        let ext_mint_data = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(
            &ext_data
        )?;
        let scaled_ui_config = ext_mint_data
            .get_extension::<ScaledUiAmountConfig>()?;

        if scaled_ui_config.new_multiplier == PodF64::from(multiplier) 
            && scaled_ui_config.new_multiplier_effective_timestamp == UnixTimestamp::from(timestamp) {
            return Ok(multiplier);
        }
    }

    update_scaled_ui_multiplier(mint, multiplier, timestamp, authority, authority_seeds, token_program)?;

    return Ok(multiplier)
}

pub fn amount_to_principal(
    amount: u64,
    multiplier: f64
) -> u64 {
    // We want to avoid precision errors with floating point numbers
    // Therefore, we use integer math.
    let index = (multiplier * INDEX_SCALE_F64).trunc() as u128;

    // Calculate the principal from the amount and index, rounding down
    // TODO mirror EVM rounding behavior
    let principal: u64 = (amount as u128)
        .checked_mul(INDEX_SCALE_U64 as u128).expect("amount * INDEX_SCALE_U64 overflow")
        .checked_div(index).expect("amount * INDEX_SCALE_U64 / index underflow")
        .try_into().expect("conversion overflow");
    
    principal
}

pub fn principal_to_amount(
    principal: u64,
    multiplier: f64
) -> u64 {
    // We want to avoid precision errors with floating point numbers
    // Therefore, we use integer math.
    let index = (multiplier * INDEX_SCALE_F64).trunc() as u128;

    // Calculate the amount from the principal and index, rounding down
    // TODO mirror EVM rounding behavior``
    let amount: u64 = index.checked_mul(principal as u128).expect("index * principal overflow")
        .checked_div(INDEX_SCALE_U64 as u128).expect("index * principal / INDEX_SCALE_U64 underflow")
        .try_into().expect("conversion overflow");

    amount
}

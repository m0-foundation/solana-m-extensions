// ext_earn/utils/conversion.rs

use crate::{
    constants::{INDEX_SCALE_F64, INDEX_SCALE_U64, ONE_HUNDRED_PERCENT_F64},
    errors::ExtError,
    state::ExtGlobal,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};
use earn::state::Global as EarnGlobal;
use solana_program::program::invoke_signed;
use spl_token_2022::extension::{
    scaled_ui_amount::{PodF64, ScaledUiAmountConfig, UnixTimestamp},
    BaseStateWithExtensions, StateWithExtensions,
};

fn get_latest_multiplier_and_timestamp<'info>(
    ext_global_account: &Account<'info, ExtGlobal>,
    m_earn_global_account: &Account<'info, EarnGlobal>,
) -> (f64, i64) {
    // TODO explore fixed point math to avoid floating point precision unpredictability
    let current_m_multiplier = m_earn_global_account.index as f64 / INDEX_SCALE_F64;
    let last_m_multiplier = ext_global_account.last_m_index as f64 / INDEX_SCALE_F64;
    let timestamp: i64 = m_earn_global_account.timestamp as i64;
    let last_ext_multiplier = ext_global_account.last_ext_index as f64 / INDEX_SCALE_F64;

    msg!("current_m_multiplier: {}", current_m_multiplier);
    msg!("last_m_multiplier: {}", last_m_multiplier);

    // If no change, return early
    if current_m_multiplier == last_m_multiplier {
        msg!("Hasn't changed");
        return (last_ext_multiplier, timestamp);
    }

    let m_increase_factor = current_m_multiplier / last_m_multiplier;
    msg!("m_increase_factor: {}", m_increase_factor);

    // Calculate the increase factor for the ext index, if the fee is zero, then the increase factor is the same as M
    let ext_increase_factor = if ext_global_account.fee_bps == 0 {
        m_increase_factor
    } else {
        // Calculate the increase factor for the ext index
        let fee_on_yield = ext_global_account.fee_bps as f64 / ONE_HUNDRED_PERCENT_F64;
        m_increase_factor.powf(1.0f64 - fee_on_yield)
    };

    msg!("ext_increase_factor: {}", ext_increase_factor);

    // Calculate the new extension multiplier (index in f64 scaled down)
    let new_ext_multiplier = last_ext_multiplier * ext_increase_factor;

    msg!("new_ext_multiplier: {}", new_ext_multiplier);

    (new_ext_multiplier, timestamp)
}

pub fn check_solvency<'info>(
    ext_mint: &InterfaceAccount<'info, Mint>,
    ext_global_account: &Account<'info, ExtGlobal>,
    m_earn_global_account: &Account<'info, EarnGlobal>,
    vault_m_token_account: &InterfaceAccount<'info, TokenAccount>,
) -> Result<()> {
    // Get the current index and timestamp from the m_earn_global_account
    let (multiplier, _): (f64, i64) =
        get_latest_multiplier_and_timestamp(ext_global_account, m_earn_global_account);

    // Calculate the amount of tokens in the vault
    let vault_amount = vault_m_token_account.amount;

    // Calculate the amount of tokens needed to be solvent
    // Reduce it by two to avoid rounding errors (there is an edge cases where the rounding error
    // from one index (down) to the next (up) can cause the difference to be 2)
    let mut required_amount = principal_to_amount_down(ext_mint.supply, multiplier);
    required_amount -= std::cmp::min(2, required_amount);

    // Check if the vault has enough tokens
    if vault_amount < required_amount {
        return err!(ExtError::InsufficientCollateral);
    }

    Ok(())
}

pub fn sync_multiplier<'info>(
    ext_mint: &mut InterfaceAccount<'info, Mint>,
    ext_global_account: &mut Account<'info, ExtGlobal>,
    m_earn_global_account: &Account<'info, EarnGlobal>,
    authority: &AccountInfo<'info>,
    authority_seeds: &[&[&[u8]]],
    token_program: &Program<'info, Token2022>,
) -> Result<f64> {
    // Get the current index and timestamp from the m_earn_global_account
    let (multiplier, timestamp): (f64, i64) =
        get_latest_multiplier_and_timestamp(ext_global_account, m_earn_global_account);

    // Compare against the current multiplier
    // If the multiplier is the same, we don't need to update
    {
        // explicit scope to drop the borrow at the end of the code block
        let ext_account_info = &ext_mint.to_account_info();
        let ext_data = ext_account_info.try_borrow_data()?;
        let ext_mint_data = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&ext_data)?;
        let scaled_ui_config = ext_mint_data.get_extension::<ScaledUiAmountConfig>()?;

        if scaled_ui_config.new_multiplier == PodF64::from(multiplier)
            && scaled_ui_config.new_multiplier_effective_timestamp == UnixTimestamp::from(timestamp)
        {
            return Ok(multiplier);
        }
    }

    // Update the multiplier and timestamp in the mint account
    invoke_signed(
        &spl_token_2022::extension::scaled_ui_amount::instruction::update_multiplier(
            &token_program.key(),
            &ext_mint.key(),
            &authority.key(),
            &[],
            multiplier,
            timestamp,
        )?,
        &[ext_mint.to_account_info(), authority.clone()],
        authority_seeds,
    )?;

    // Reload the mint account so the new multiplier is reflected
    ext_mint.reload()?;

    // Update the last m index and last ext index in the global account
    ext_global_account.last_m_index = m_earn_global_account.index;
    ext_global_account.last_ext_index = (multiplier * INDEX_SCALE_F64).trunc() as u64;

    return Ok(multiplier);
}

pub fn amount_to_principal_down(amount: u64, multiplier: f64) -> u64 {
    // We want to avoid precision errors with floating point numbers
    // Therefore, we use integer math.
    let index = (multiplier * INDEX_SCALE_F64).trunc() as u128;

    // Calculate the principal from the amount and index, rounding down
    let principal: u64 = (amount as u128)
        .checked_mul(INDEX_SCALE_U64 as u128)
        .expect("amount * INDEX_SCALE_U64 overflow")
        .checked_div(index)
        .expect("amount * INDEX_SCALE_U64 / index underflow")
        .try_into()
        .expect("conversion overflow");

    principal
}

pub fn amount_to_principal_up(amount: u64, multiplier: f64) -> u64 {
    // We want to avoid precision errors with floating point numbers
    // Therefore, we use integer math.
    let index = (multiplier * INDEX_SCALE_F64).trunc() as u128;

    // Calculate the principal from the amount and index, rounding up
    let principal: u64 = (amount as u128)
        .checked_mul(INDEX_SCALE_U64 as u128)
        .expect("amount * INDEX_SCALE_U64 overflow")
        .checked_add(index.checked_sub(1u128).expect("index - 1 underflow"))
        .expect("amount * INDEX_SCALE_U64 + index overflow")
        .checked_div(index)
        .expect("amount * INDEX_SCALE_U64 + index / index underflow")
        .try_into()
        .expect("conversion overflow");

    principal
}

pub fn principal_to_amount_down(principal: u64, multiplier: f64) -> u64 {
    // We want to avoid precision errors with floating point numbers
    // Therefore, we use integer math.
    let index = (multiplier * INDEX_SCALE_F64).trunc() as u128;

    // Calculate the amount from the principal and index, rounding down
    let amount: u64 = index
        .checked_mul(principal as u128)
        .expect("index * principal overflow")
        .checked_div(INDEX_SCALE_U64 as u128)
        .expect("index * principal / INDEX_SCALE_U64 underflow")
        .try_into()
        .expect("conversion overflow");

    amount
}

pub fn principal_to_amount_up(principal: u64, multiplier: f64) -> u64 {
    // We want to avoid precision errors with floating point numbers
    // Therefore, we use integer math.
    let index = (multiplier * INDEX_SCALE_F64).trunc() as u128;

    // Calculate the amount from the principal and index, rounding up
    let amount: u64 = index
        .checked_mul(principal as u128)
        .expect("index * principal overflow")
        .checked_add(INDEX_SCALE_U64 as u128 - 1u128)
        .expect("index * principal + INDEX_SCALE_U64 - 1 overflow")
        .checked_div(INDEX_SCALE_U64 as u128)
        .expect("index * principal + INDEX_SCALE_U64 - 1 / INDEX_SCALE_U64 underflow")
        .try_into()
        .expect("conversion overflow");

    amount
}

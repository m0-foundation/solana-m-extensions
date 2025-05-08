use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};
use earn::state::Global as EarnGlobal;
use spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions};
use std::cmp::min;

#[cfg(feature = "scaled-ui")]
use spl_token_2022::extension::scaled_ui_amount::{PodF64, ScaledUiAmountConfig};

#[cfg(feature = "ibt")]
use anchor_spl::token_interface::spl_pod::primitives::PodI16;
#[cfg(feature = "ibt")]
use spl_token_2022::extension::interest_bearing_mint::{self, InterestBearingConfig};

use crate::{
    constants::{INDEX_SCALE_F64, INDEX_SCALE_U64},
    errors::ExtError,
    state::{ExtGlobal, MINT_AUTHORITY_SEED},
};

fn get_multiplier_and_timestamp<'info>(m_earn_global: &Account<'info, EarnGlobal>) -> (f64, i64) {
    (
        (m_earn_global.index as f64) / INDEX_SCALE_F64,
        m_earn_global.timestamp as i64,
    )
}

pub fn check_solvency<'info>(
    ext_mint: &InterfaceAccount<'info, Mint>,
    m_earn_global_account: &Account<'info, EarnGlobal>,
    vault_m_token_account: &InterfaceAccount<'info, TokenAccount>,
) -> Result<()> {
    // Get the current index and timestamp from the m_earn_global_account
    let (multiplier, _): (f64, i64) = get_multiplier_and_timestamp(m_earn_global_account);

    // Calculate the amount of tokens needed to be solvent
    // Reduce it by two to avoid rounding errors (there is an edge cases where the rounding error
    // from one index (down) to the next (up) can cause the difference to be 2)
    let mut required_amount = principal_to_amount_down(ext_mint.supply, multiplier);
    required_amount -= min(2, required_amount);

    // Check if the vault has enough tokens
    if vault_m_token_account.amount < required_amount {
        return err!(ExtError::InsufficientCollateral);
    }

    Ok(())
}

pub fn sync_mint_extension<'info>(
    ext_mint: &mut InterfaceAccount<'info, Mint>,
    m_earn_global_account: &Account<'info, EarnGlobal>,
    ext_global_account: &Account<'info, ExtGlobal>,
    authority: &AccountInfo<'info>,
) -> Result<()> {
    let authority_seeds: &[&[&[u8]]] = &[&[
        MINT_AUTHORITY_SEED,
        &[ext_global_account.ext_mint_authority_bump],
    ]];

    #[cfg(feature = "scaled-ui")]
    sync_multiplier(ext_mint, m_earn_global_account, authority, authority_seeds)?;

    #[cfg(feature = "ibt")]
    sync_rate(
        ext_mint,
        m_earn_global_account,
        ext_global_account,
        authority,
        authority_seeds,
    )?;

    Ok(())
}

#[cfg(feature = "scaled-ui")]
pub fn sync_multiplier<'info>(
    ext_mint: &mut InterfaceAccount<'info, Mint>,
    m_earn_global_account: &Account<'info, EarnGlobal>,
    authority: &AccountInfo<'info>,
    authority_seeds: &[&[&[u8]]],
) -> Result<f64> {
    // Get the current index and timestamp from the m_earn_global_account
    let (multiplier, timestamp): (f64, i64) = get_multiplier_and_timestamp(m_earn_global_account);

    let ext_account_info = &ext_mint.to_account_info();
    let ext_data = ext_account_info.try_borrow_data()?;
    let ext_mint_data = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&ext_data)?;
    let scaled_ui_config = ext_mint_data.get_extension::<ScaledUiAmountConfig>()?;

    if scaled_ui_config.new_multiplier == PodF64::from(multiplier) {
        return Ok(multiplier);
    }

    // Update the multiplier and timestamp in the mint account
    invoke_signed(
        &spl_token_2022::extension::scaled_ui_amount::instruction::update_multiplier(
            &Token2022::id(),
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

    return Ok(multiplier);
}

#[cfg(feature = "ibt")]
pub fn sync_rate<'info>(
    ext_mint: &mut InterfaceAccount<'info, Mint>,
    m_earn_global: &Account<'info, EarnGlobal>,
    ext_global: &Account<'info, ExtGlobal>,
    authority: &AccountInfo<'info>,
    authority_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Adjust the rate to include the yield fee
    let fee_pct = (m_earn_global.earner_rate as f64 * ext_global.yield_fee_bps as f64) / 10000.;
    let current_rate = m_earn_global.earner_rate - (fee_pct as u16);

    // Compare against the current rate
    let ext_account_info = &ext_mint.to_account_info();
    let ext_data = ext_account_info.try_borrow_data()?;
    let ext_mint_data = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&ext_data)?;
    let interest_bearing_config = ext_mint_data.get_extension::<InterestBearingConfig>()?;

    if interest_bearing_config.current_rate == PodI16::from(current_rate as i16) {
        return Ok(());
    }

    // Update the multiplier and timestamp in the mint account
    invoke_signed(
        &interest_bearing_mint::instruction::update_rate(
            &Token2022::id(),
            &ext_mint.key(),
            &authority.key(),
            &[],
            current_rate as i16,
        )?,
        &[ext_mint.to_account_info(), authority.clone()],
        authority_seeds,
    )?;

    // Reload the mint account so the new multiplier is reflected
    ext_mint.reload()?;

    return Ok(());
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

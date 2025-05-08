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
    constants::{INDEX_SCALE_F64, INDEX_SCALE_U64, ONE_IN_BASIS_POINTS, SECONDS_PER_YEAR},
    errors::ExtError,
    state::{ExtGlobal, MINT_AUTHORITY_SEED},
};

fn get_multiplier_and_timestamp<'info>(m_earn_global: &Account<'info, EarnGlobal>) -> (f64, i64) {
    let multiplier: f64 = (m_earn_global.index as f64) / INDEX_SCALE_F64;
    let timestamp: i64 = m_earn_global.timestamp as i64;

    (multiplier, timestamp)
}

#[cfg(feature = "ibt")]
fn get_ibt_multiplier<'info>(config: &InterestBearingConfig, latest_timestamp: i64) -> f64 {
    // Duration from initialization to the last update
    let pre_update_timespan = i64::from(config.last_update_timestamp)
        .checked_sub(config.initialization_timestamp.into())
        .unwrap();

    // Duration from the last update to the current time
    let post_update_timespan = latest_timestamp
        .checked_sub(config.last_update_timestamp.into())
        .unwrap();

    // - Take the average rate from initialization to last update
    // - Multiply by the time span in that period
    // - Convert to a continuous compound interest formula: e^(rate × time)
    // - Divide by SECONDS_PER_YEAR converts time units to years
    // - Divide by ONE_IN_BASIS_POINTS to scale rate from bps
    let pre_update_exp = {
        let numerator = (i16::from(config.pre_update_average_rate) as i128)
            .checked_mul(pre_update_timespan as i128)
            .expect("average_rate * timespan overflow") as f64;

        (numerator / SECONDS_PER_YEAR / ONE_IN_BASIS_POINTS).exp()
    };

    // Same as above, but for the period after the last update
    let post_update_exp = {
        let numerator = (i16::from(config.current_rate) as i128)
            .checked_mul(post_update_timespan as i128)
            .expect("current_rate * timespan overflow") as f64;

        (numerator / SECONDS_PER_YEAR / ONE_IN_BASIS_POINTS).exp()
    };

    // Multiplies the two exponential factors together (compound interest from both periods)
    pre_update_exp * post_update_exp
}

pub fn check_solvency<'info>(
    ext_mint: &InterfaceAccount<'info, Mint>,
    m_earn_global_account: &Account<'info, EarnGlobal>,
    vault_m_token_account: &InterfaceAccount<'info, TokenAccount>,
) -> Result<()> {
    let (multiplier, _) = get_multiplier_and_timestamp(m_earn_global_account);

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
    m_earn_global: &Account<'info, EarnGlobal>,
    ext_global: &Account<'info, ExtGlobal>,
    authority: &AccountInfo<'info>,
    authority_bump: u8,
) -> Result<f64> {
    let authority_seeds: &[&[&[u8]]] = &[&[MINT_AUTHORITY_SEED, &[authority_bump]]];

    #[cfg(feature = "scaled-ui")]
    let mult = sync_multiplier(ext_mint, m_earn_global, authority, authority_seeds)?;

    #[cfg(feature = "ibt")]
    let mult = sync_rate(
        ext_mint,
        m_earn_global,
        ext_global,
        authority,
        authority_seeds,
    )?;

    #[cfg(feature = "yield-crank")]
    let mult = 1.;

    Ok(mult)
}

#[cfg(feature = "scaled-ui")]
pub fn sync_multiplier<'info>(
    ext_mint: &mut InterfaceAccount<'info, Mint>,
    m_earn_global: &Account<'info, EarnGlobal>,
    authority: &AccountInfo<'info>,
    authority_seeds: &[&[&[u8]]],
) -> Result<f64> {
    let (multiplier, timestamp) = get_multiplier_and_timestamp(m_earn_global);

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
) -> Result<f64> {
    // Parse ibt config from mint
    let ext_account_info = &ext_mint.to_account_info();
    let ext_data = ext_account_info.try_borrow_data()?;
    let ext_mint_data = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&ext_data)?;
    let interest_bearing_config = ext_mint_data.get_extension::<InterestBearingConfig>()?;

    let multiplier = get_ibt_multiplier(
        interest_bearing_config,
        Clock::get().unwrap().unix_timestamp,
    );

    // Adjust the rate to include the yield fee
    let fee_pct = (m_earn_global.earner_rate as f64 * ext_global.yield_fee_bps as f64) / 10000.;
    let current_rate = m_earn_global.earner_rate - (fee_pct as u16);

    // Compare against the current rate
    if interest_bearing_config.current_rate == PodI16::from(current_rate as i16) {
        return Ok(multiplier);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "ibt")]
    mod ibt_tests {
        use super::*;
        use anchor_spl::token_interface::spl_pod::{
            optional_keys::OptionalNonZeroPubkey, primitives::PodI64,
        };

        fn create_test_config(
            init_timestamp: i64,
            last_update_timestamp: i64,
            pre_update_rate: i16,
            current_rate: i16,
        ) -> InterestBearingConfig {
            InterestBearingConfig {
                initialization_timestamp: PodI64::from(init_timestamp),
                last_update_timestamp: PodI64::from(last_update_timestamp),
                pre_update_average_rate: PodI16::from(pre_update_rate),
                current_rate: PodI16::from(current_rate),
                rate_authority: OptionalNonZeroPubkey::default(),
            }
        }

        #[test]
        fn test_get_ibt_multiplier_zero() {
            let init_ts = 1630000000;
            let ts = 1630000000 + SECONDS_PER_YEAR as i64 / 2;

            let config = create_test_config(init_ts, ts, 0, 0);
            let result = get_ibt_multiplier(&config, ts);
            assert!(result == 1.0);
        }

        #[test]
        fn test_get_ibt_multiplier_one_year() {
            let init_ts = 1630000000;
            let last_update_ts = 1630000000 + SECONDS_PER_YEAR as i64 / 2;
            let now = 1630000000 + SECONDS_PER_YEAR as i64;

            // 5% rate for entire year
            let config = create_test_config(init_ts, last_update_ts, 500, 500);
            let result = get_ibt_multiplier(&config, now);

            // 6 months at 5%, then 6 months at 5% = 5% for a year
            // Expected ≈ exp(0.05) ≈ 1.05127
            let expected = (0.05_f64).exp();
            assert!(result == expected);

            // Use multiplier to calculate principal and compare
            let amount = 100_000e6 as u64;
            let expected_tokens = principal_to_amount_down(amount, expected);
            let result_tokens = principal_to_amount_down(amount, result);
            assert!(result_tokens == expected_tokens);
            assert!(result_tokens == 105127109637);
        }
    }
}

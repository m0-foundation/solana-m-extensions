use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use cfg_if::cfg_if;

use crate::{
    constants::{INDEX_SCALE_F64, INDEX_SCALE_U64},
    errors::ExtError,
    state::ExtGlobal,
};

cfg_if! {
    if #[cfg(feature = "ibt")] {
        use anchor_lang::solana_program::program::invoke_signed;
        use anchor_spl::token_interface::Token2022;
        use spl_token_2022::extension::{interest_bearing_mint::InterestBearingConfig, BaseStateWithExtensions, StateWithExtensions};
        use crate::constants::{SECONDS_PER_YEAR, ONE_IN_BASIS_POINTS};
    }
}

pub fn get_multiplier<'info>(
    _ext_mint: &InterfaceAccount<'info, Mint>,
    _ext_global_account: &Account<'info, ExtGlobal>,
) -> Result<f64> {
    cfg_if! {
        if #[cfg(feature = "ibt")] {
            let ext_account_info = &_ext_mint.to_account_info();
            let ext_data = ext_account_info.try_borrow_data()?;
            let ext_mint_data = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&ext_data)?;
            let ibt_config = ext_mint_data.get_extension::<InterestBearingConfig>()?;
            Ok(get_ibt_multiplier(
                &ibt_config,
                Clock::get()?.unix_timestamp
            ))
        } else {
            // Ext tokens are 1:1 with M tokens
            return Ok(1.0);
        }
    }
}

pub fn amount_to_principal_down(amount: u64, multiplier: f64) -> Result<u64> {
    // If the multiplier is 1, return the amount directly
    if multiplier == 1.0 {
        return Ok(amount);
    }

    // We want to avoid precision errors with floating point numbers
    // Therefore, we use integer math.
    let index = (multiplier * INDEX_SCALE_F64).trunc() as u128;

    // Calculate the principal from the amount and index, rounding down
    let principal: u64 = (amount as u128)
        .checked_mul(INDEX_SCALE_U64 as u128)
        .ok_or(ExtError::MathOverflow)?
        .checked_div(index)
        .ok_or(ExtError::MathUnderflow)?
        .try_into()?;

    Ok(principal)
}

pub fn amount_to_principal_up(amount: u64, multiplier: f64) -> Result<u64> {
    // If the multiplier is 1, return the amount directly
    if multiplier == 1.0 {
        return Ok(amount);
    }

    // We want to avoid precision errors with floating point numbers
    // Therefore, we use integer math.
    let index = (multiplier * INDEX_SCALE_F64).trunc() as u128;

    // Calculate the principal from the amount and index, rounding up
    let principal: u64 = (amount as u128)
        .checked_mul(INDEX_SCALE_U64 as u128)
        .ok_or(ExtError::MathOverflow)?
        .checked_add(index.checked_sub(1u128).ok_or(ExtError::MathUnderflow)?)
        .ok_or(ExtError::MathOverflow)?
        .checked_div(index)
        .ok_or(ExtError::MathUnderflow)?
        .try_into()?;

    Ok(principal)
}

pub fn principal_to_amount_down(principal: u64, multiplier: f64) -> Result<u64> {
    // If the multiplier is 1, return the principal directly
    if multiplier == 1.0 {
        return Ok(principal);
    }

    // We want to avoid precision errors with floating point numbers
    // Therefore, we use integer math.
    let index = (multiplier * INDEX_SCALE_F64).trunc() as u128;

    // Calculate the amount from the principal and index, rounding down
    let amount: u64 = index
        .checked_mul(principal as u128)
        .ok_or(ExtError::MathOverflow)?
        .checked_div(INDEX_SCALE_U64 as u128)
        .ok_or(ExtError::MathUnderflow)?
        .try_into()?;

    Ok(amount)
}

pub fn principal_to_amount_up(principal: u64, multiplier: f64) -> Result<u64> {
    // If the multiplier is 1, return the principal directly
    if multiplier == 1.0 {
        return Ok(principal);
    }

    // We want to avoid precision errors with floating point numbers
    // Therefore, we use integer math.
    let index = (multiplier * INDEX_SCALE_F64).trunc() as u128;

    // Calculate the amount from the principal and index, rounding up
    let amount: u64 = index
        .checked_mul(principal as u128)
        .ok_or(ExtError::MathOverflow)?
        .checked_add(
            (INDEX_SCALE_U64 as u128)
                .checked_sub(1u128)
                .ok_or(ExtError::MathUnderflow)?,
        )
        .ok_or(ExtError::MathOverflow)?
        .checked_div(INDEX_SCALE_U64 as u128)
        .ok_or(ExtError::MathUnderflow)?
        .try_into()?;

    Ok(amount)
}

cfg_if! {
    if #[cfg(feature = "ibt")] {
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
            // TODO handle rounding
            pre_update_exp * post_update_exp
        }

        pub fn set_ibt_rate<'info>(
            ext_mint: &mut InterfaceAccount<'info, Mint>,
            ext_token_program: &Program<'info, Token2022>,
            authority: &AccountInfo<'info>,
            authority_seeds: &[&[&[u8]]],
            rate: i16
        ) -> Result<()> {
            // Set the rate on the ext mint
            invoke_signed(
                &spl_token_2022::extension::interest_bearing_mint::instruction::update_rate(
                    &ext_token_program.key(),
                    &ext_mint.key(),
                    &authority.key(),
                    &[],
                    rate,
                )?,
                &[
                    ext_mint.to_account_info(),
                    authority.clone(),
                ],
                authority_seeds,
            )?;

            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "ibt")]
    mod ibt_tests {
        use super::*;
        use anchor_spl::token_interface::spl_pod::{
            optional_keys::OptionalNonZeroPubkey,
            primitives::{PodI16, PodI64},
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
            let expected_tokens = principal_to_amount_down(amount, expected).unwrap();
            let result_tokens = principal_to_amount_down(amount, result).unwrap();
            assert!(result_tokens == expected_tokens);
            assert!(result_tokens == 105127109637);
        }
    }
}

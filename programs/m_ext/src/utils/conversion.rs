use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};
use cfg_if::cfg_if;
use earn::state::Earner;
use spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions};

use crate::{
    constants::{INDEX_SCALE_F64, INDEX_SCALE_U64},
    errors::ExtError,
    state::ExtGlobal,
};

cfg_if! {
    if #[cfg(feature = "scaled-ui")] {
        use anchor_lang::solana_program::program::invoke_signed;
        use spl_token_2022::extension::scaled_ui_amount::{PodF64, ScaledUiAmountConfig, UnixTimestamp};
        use crate::constants::ONE_HUNDRED_PERCENT_F64;
    }
}

#[allow(unused_variables)]
pub fn sync_multiplier<'info>(
    ext_mint: &mut InterfaceAccount<'info, Mint>,
    ext_global_account: &mut Account<'info, ExtGlobal>,
    m_earner_account: &Account<'info, Earner>,
    vault_m_token_account: &InterfaceAccount<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    authority_seeds: &[&[&[u8]]],
    token_program: &Program<'info, Token2022>,
) -> Result<f64> {
    cfg_if! {
        if #[cfg(feature = "scaled-ui")] {
            // Get the current index and timestamp from the m_earn_global_account and cached values
            let (multiplier, timestamp): (f64, i64) =
                get_latest_multiplier_and_timestamp(ext_global_account, m_earner_account)?;

            // Compare against the current multiplier
            // If the multiplier is the same, we don't need to update
            let scaled_ui_config = get_scaled_ui_config(ext_mint)?;

            if scaled_ui_config.new_multiplier == PodF64::from(multiplier)
                && scaled_ui_config.new_multiplier_effective_timestamp == UnixTimestamp::from(timestamp)
            {
                return Ok(multiplier);
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
            ext_global_account.yield_config.last_m_index = m_earner_account.last_claim_index;
            ext_global_account.yield_config.last_ext_index = (multiplier * INDEX_SCALE_F64).floor() as u64;

            // Note: This check should not be required anymore because we are using the vault's last claim index
            // however, we keep it here for now to continue testing
            //
            // Check solvency of the vault
            // i.e. that it holds enough M for each extension UI amount
            // after the multiplier has been updated
            if ext_mint.supply > 0 {
                // Calculate the amount of tokens in the vault
                let vault_m = vault_m_token_account.amount;

                // Calculate the amount of tokens needed to be solvent
                // Reduce it by two to avoid rounding errors (there is an edge cases where the rounding error
                // from one index (down) to the next (up) can cause the difference to be 2)
                let mut required_m = principal_to_amount_down(ext_mint.supply, multiplier)?;
                required_m -= std::cmp::min(2, required_m);

                // Check if the vault has enough tokens
                if vault_m < required_m {
                    return err!(ExtError::InsufficientCollateral);
                }
            }

            return Ok(multiplier);
        } else {
            // Ext tokens are 1:1 with M tokens and we don't need to sync this
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

pub fn get_mint_extensions<'info>(
    mint: &InterfaceAccount<'info, Mint>,
) -> Result<Vec<spl_token_2022::extension::ExtensionType>> {
    // Get the mint account data
    let account_info = mint.to_account_info();
    let mint_data = account_info.try_borrow_data()?;
    let mint_ext_data = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;

    let extensions = mint_ext_data.get_extension_types()?;

    Ok(extensions)
}

cfg_if! {
    if #[cfg(feature = "scaled-ui")] {
        pub fn get_scaled_ui_config<'info>(
            mint: &InterfaceAccount<'info, Mint>,
        ) -> Result<ScaledUiAmountConfig> {
            // Get the mint account data with extensions
            let account_info = mint.to_account_info();
            let mint_data = account_info.try_borrow_data()?;
            let mint_ext_data = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;

            // Get the scaled UI config extension
            let scaled_ui_config = mint_ext_data.get_extension::<ScaledUiAmountConfig>()?;

            Ok(*scaled_ui_config)
        }


        fn get_latest_multiplier_and_timestamp<'info>(
            ext_global_account: &Account<'info, ExtGlobal>,
            m_earner_account: &Account<'info, Earner>,
        ) -> Result<(f64, i64)> {
            let latest_m_multiplier = m_earner_account.last_claim_index as f64 / INDEX_SCALE_F64;
            let cached_m_multiplier = ext_global_account.yield_config.last_m_index as f64 / INDEX_SCALE_F64;
            let latest_timestamp: i64 = m_earner_account.last_claim_timestamp as i64;
            let cached_ext_multiplier =
                ext_global_account.yield_config.last_ext_index as f64 / INDEX_SCALE_F64;

            // If no change, return early
            if latest_m_multiplier == cached_m_multiplier {
                return Ok((cached_ext_multiplier, latest_timestamp));
            }

            // Calculate the new ext multiplier based on the latest m multiplier and timestamp
            let new_ext_multiplier = calculate_new_multiplier(
                cached_ext_multiplier,
                cached_m_multiplier,
                latest_m_multiplier,
                ext_global_account.yield_config.fee_bps
            )?;

            Ok((new_ext_multiplier, latest_timestamp))
        }

        fn calculate_new_multiplier(
            last_ext_multiplier: f64,
            last_m_multiplier: f64,
            new_m_multiplier: f64,
            fee_bps: u64,
        ) -> Result<f64> {
            // Confirm the inputs are in the expected domain.
            // These checks ensure that the resultant value is >= 1.0,
            // are allowable values to set as the Token2022 Scaled UI multiplier,
            // and the ext multiplier is monotonically increasing.
            // While having the last ext multiplier <= last m multiplier isn't strictly necessary,
            // it arises naturally from our construction and provides a good sanity check.
            if last_ext_multiplier < 1.0 ||
               last_m_multiplier < last_ext_multiplier ||
               new_m_multiplier < last_m_multiplier ||
               new_m_multiplier > 100.0 || // we set a high, but finite upper bound on the multiplier to ensure it (or the other multipliers) don't lead to overflow.
               fee_bps > 10000 {
                return err!(ExtError::InvalidInput);
            }

            // Calculate the new ext multiplier from the formula:
            // new_ext_multiplier = last_ext_multiplier * (new_m_multiplier / last_m_multiplier) ^ (1 - fee_on_yield)
            // The derivation of this formula is explained in this document: https://gist.github.com/Oighty/89dd1288a0a7fb53eb6f0314846cb746
            let m_increase_factor = new_m_multiplier / last_m_multiplier;

            // Calculate the increase factor for the ext index, if the fee is zero, then the increase factor is the same as M
            let ext_increase_factor = if fee_bps == 0 {
                m_increase_factor
            } else {
                // Calculate the increase factor for the ext index
                let fee_on_yield = fee_bps as f64 / ONE_HUNDRED_PERCENT_F64;
                // The precision of the powf operation is non-deterministic
                // However, the margin of error is ~10^-16, which is smaller than the 10^-12 precision
                // that we need for this use case. See: https://doc.rust-lang.org/std/primitive.f64.html#method.powf
                m_increase_factor.powf(1.0f64 - fee_on_yield)
            };

            // Calculate the new extension multiplier (index in f64 scaled down)
            let new_ext_multiplier = last_ext_multiplier * ext_increase_factor;

            // We need to round the new multiplier down and truncate at 10^-12
            // to return a consistent value
            Ok((new_ext_multiplier * INDEX_SCALE_F64).floor() / INDEX_SCALE_F64)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    cfg_if! {
        if #[cfg(feature = "scaled-ui")] {
            #[test]
            fn test_calculate_new_multiplier_no_fee() {
                // cases (starting from 1.0):
                // no rounding
                let expected = 1.125000000000;
                let result = calculate_new_multiplier(1.0, 1.0, 1.125, 0).unwrap();
                assert_eq!(result, expected);

                // would round up -> truncates
                let expected = 1.666666666666;
                let result = calculate_new_multiplier(1.0, 1.5, 2.5, 0).unwrap();
                assert_eq!(result, expected);

                // would round down -> truncates
                let expected = 1.333333333333;
                let result = calculate_new_multiplier(1.0, 1.5, 2.0, 0).unwrap();
                assert_eq!(result, expected);

                // cases (starting from truncated value that would have rounded up):
                // no rounding
                let expected = 1.749999999999; // off by one due to previous rounding
                let result = calculate_new_multiplier(1.666666666666, 2.0, 2.1, 0).unwrap();
                assert_eq!(result, expected);

                // would round up -> truncates
                let expected = 1.777777777777;
                let result = calculate_new_multiplier(1.666666666666, 3.0, 3.2, 0).unwrap();
                assert_eq!(result, expected);

                // would round down -> truncates
                let expected = 2.333333333332; // off by one due to previous rounding
                let result = calculate_new_multiplier(1.666666666666, 5.0, 7.0, 0).unwrap();
                assert_eq!(result, expected);

                // cases (starting from truncated value that would have rounded down)
                let expected = 1.499999999999; // off by one due to previous rounding
                let result = calculate_new_multiplier(1.333333333333, 2.0, 2.25, 0).unwrap();
                assert_eq!(result, expected);

                // would round up -> truncates
                let expected = 1.666666666666;
                let result = calculate_new_multiplier(1.333333333333, 2.0, 2.5, 0).unwrap();
                assert_eq!(result, expected);

                // would round down -> truncates
                let expected = 2.333333333332;
                let result = calculate_new_multiplier(1.333333333333, 4.0, 7.0, 0).unwrap();
                assert_eq!(result, expected);
            }

            // Helper function to trim the value to 12 decimal places after subtracting expected rounding error
            // This is needed to deal with imprecision in floating point arithmetic
            fn trim(value: f64) -> f64 {
                // Truncate the value to 12 decimal places
                (value * INDEX_SCALE_F64).ceil() / INDEX_SCALE_F64
            }

            #[test]
            fn test_calculate_new_multiplier_with_fee() {
                // there are three calculations here to test rounding behavior:
                // 1. m_increase_factor = new_m_multiplier / last_m_multiplier
                // 2. ext_increase_factor = m_increase_factor.powf(1.0 - fee_on_yield)
                // 3. new_ext_multiplier = last_ext_multiplier * ext_increase_factor
                // cases are listed with what the rounding behavior would be for each calculation
                // even though the rounding only happens when converting back to u64 for the final result
                // the basic expectation is that if there is a roundup anywhere in the sequence
                // the final result will be off by one to the downside due to truncation

                // cases:
                // Note: we can't reliably get examples that wouldn't round either direction for the 2nd equation since it is a fractional exponent
                // A
                //   1. no rounding
                //   2. rounds down
                //   3. no rounding
                let result = calculate_new_multiplier(1.0, 1.0, 1.125, 2500).unwrap();
                let expected_actual = 1.092356486341; // wolfram alpha: 1.092356486341477...
                let expected = expected_actual; // no error
                assert_eq!(result, expected);

                // B
                //   1. no rounding
                //   2. rounds down
                //   3. rounds down
                let result = calculate_new_multiplier(1.3, 1.5, 1.65, 1500).unwrap();
                let expected_actual = 1.409701411824; // wolfram alpha: 1.409701411824313...
                let expected = expected_actual; // no error
                assert_eq!(result, expected);

                // C
                //  1. no rounding
                //  2. rounds down
                //  3. would round up -> truncates
                let result = calculate_new_multiplier(1.2, 1.5, 1.65, 1500).unwrap();
                let expected_actual = 1.301262841684; // wolfram alpha: 1.301262841683981...
                let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
                assert_eq!(result, expected);

                // D
                //  1. no rounding
                //  2. would round up -> truncates
                //  3. no rounding
                let result = calculate_new_multiplier(1.0, 1.5, 1.65, 1000).unwrap();
                let expected_actual = 1.089565684036; // wolfram alpha: 1.089565684035973...
                let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
                assert_eq!(result, expected);

                // E
                //  1. no rounding
                //  2. would round up -> truncates
                //  3. rounds down
                let result = calculate_new_multiplier(1.2, 1.5, 1.65, 1000).unwrap();
                let expected_actual = 1.307478820843; // wolfram alpha: 1.307478820843168...
                let expected = expected_actual; // no error
                assert_eq!(result, expected);

                // F
                //  1. no rounding
                //  2. would round up -> truncates
                //  3. would round up -> truncates
                let result = calculate_new_multiplier(1.3, 1.5, 1.65, 1000).unwrap();
                let expected_actual = 1.416435389247; // wolfram alpha: 1.41643538924676614906538927073063715743660444837662580163175093387867947...
                let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
                assert_eq!(result, expected);

                // G
                //  1. rounds down
                //  2. rounds down
                //  3. no rounding
                let result = calculate_new_multiplier(1.0, 1.125, 1.25, 1000).unwrap();
                let expected_actual = 1.099465842451; // wolfram alpha: 1.099465842451349...
                let expected = expected_actual; // no error
                assert_eq!(result, expected);

                // H
                //  1. rounds down
                //  2. rounds down
                //  3. rounds down
                let result = calculate_new_multiplier(1.1, 1.125, 1.25, 1000).unwrap();
                let expected_actual = 1.209412426696; // wolfram alpha: 1.209412426696484...
                let expected = expected_actual; // no error
                assert_eq!(result, expected);

                // I
                //  1. rounds down
                //  2. rounds down
                //  3. would round up -> truncates
                let result = calculate_new_multiplier(1.2, 1.125, 1.25, 1000).unwrap();
                let expected_actual = 1.319359010942; // wolfram alpha: 1.319359010941619...
                let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
                assert_eq!(result, expected);

                // J
                //  1. rounds down
                //  2. would round up -> truncates
                //  3. no rounding
                let result = calculate_new_multiplier(1.0, 1.125, 1.25, 2000).unwrap();
                let expected_actual = 1.087942624846; // wolfram alpha: 1.087942624845529...
                let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
                assert_eq!(result, expected);

                // K
                //  1. rounds down
                //  2. would round up -> truncates
                //  3. rounds down
                let result = calculate_new_multiplier(1.3, 1.125, 1.25, 2000).unwrap();
                let expected_actual = 1.414325412299; // wolfram alpha: 1.414325412299188...
                let expected = expected_actual; // no error
                assert_eq!(result, expected);

                // L
                //  1. rounds down
                //  2. would round up -> truncates
                //  3. would round up -> truncates
                let result = calculate_new_multiplier(1.2, 1.125, 1.25, 2000).unwrap();
                let expected_actual = 1.305531149815; // wolfram alpha: 1.305531149814635...
                let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
                assert_eq!(result, expected);

                // M
                //  1. would round up -> truncates
                //  2. rounds down
                //  3. no rounding
                let result = calculate_new_multiplier(1.0, 3.0, 3.2, 1000).unwrap();
                let expected_actual = 1.059804724543; // wolfram alpha: 1.059804724543068...
                let expected = expected_actual; // no error
                assert_eq!(result, expected);

                // N
                //  1. would round up -> truncates
                //  2. rounds down
                //  3. rounds down
                let result = calculate_new_multiplier(1.4, 3.0, 3.2, 1000).unwrap();
                let expected_actual = 1.483726614360; // wolfram alpha: 1.483726614360295...
                let expected = expected_actual; // no error
                assert_eq!(result, expected);

                // O
                //  1. would round up -> truncates
                //  2. rounds down
                //  3. would round up -> truncates
                let result = calculate_new_multiplier(1.2, 3.0, 3.2, 1000).unwrap();
                let expected_actual = 1.271765669452; // wolfram alpha: 1.271765669451681...
                let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
                assert_eq!(result, expected);

                // P
                //  1. would round up -> truncates
                //  2. would round up -> truncates
                //  3. no rounding
                let result = calculate_new_multiplier(1.0, 3.0, 3.2, 2000).unwrap();
                let expected_actual = 1.052986925779; // wolfram alpha: 1.052986925778570...
                let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
                assert_eq!(result, expected);

                // Q
                //  1. would round up -> truncates
                //  2. would round up -> truncates
                //  3. rounds down
                let result = calculate_new_multiplier(1.2, 3.0, 3.2, 2000).unwrap();
                let expected_actual = 1.263584310934; // wolfram alpha: 1.263584310934284...
                let expected = expected_actual;
                assert_eq!(result, expected);

                // R
                //  1. would round up -> truncates
                //  2. would round up -> truncates
                //  3. would round up -> truncates
                let result = calculate_new_multiplier(1.4, 3.0, 3.2, 2000).unwrap();
                let expected_actual = 1.474181696090; // wolfram alpha: 1.474181696089998...
                let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
                assert_eq!(result, expected);
            }
        }
    }
}

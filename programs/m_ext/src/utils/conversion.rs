use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};
use cfg_if::cfg_if;
use earn::state::Global as EarnGlobal;

use crate::{
    constants::{INDEX_SCALE_F64, INDEX_SCALE_U64},
    errors::ExtError,
    state::ExtGlobal,
};

cfg_if! {
    if #[cfg(feature = "scaled-ui")] {
        use anchor_lang::solana_program::program::invoke_signed;
        use spl_token_2022::extension::{
            scaled_ui_amount::ScaledUiAmountConfig,
            BaseStateWithExtensions, StateWithExtensions,
        };
        use crate::constants::ONE_HUNDRED_PERCENT_F64;
    }
}

pub fn sync_multiplier<'info>(
    _ext_mint: &mut InterfaceAccount<'info, Mint>,
    _ext_global_account: &mut Account<'info, ExtGlobal>,
    _m_earn_global_account: &Account<'info, EarnGlobal>,
    _vault_m_token_account: &InterfaceAccount<'info, TokenAccount>,
    _authority: &AccountInfo<'info>,
    _authority_seeds: &[&[&[u8]]],
    _token_program: &Program<'info, Token2022>,
) -> Result<f64> {
    cfg_if! {
        if #[cfg(feature = "scaled-ui")] {
            // Steps:
            // 1. Calculate the UI amount of extension tokens outstanding (including fees) at the current multiplier
            // 2. Compare to the amount of M in the vault token account
            // 3. If M token amount higher, calculate the new multiplier, taking the fee into account
            // 4. Calculate fee principal and update on ext global
            // 5. Update the multiplier in the mint account
            // 6. Return multiplier

            let current_multiplier: f64 = {
                let ext_account_info = &_ext_mint.to_account_info();
                let ext_data = ext_account_info.try_borrow_data()?;
                let ext_mint_data = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&ext_data)?;
                let scaled_ui_config = ext_mint_data.get_extension::<ScaledUiAmountConfig>()?;

                // The effective timestamp for the multiplier is always set the to current timestamp so the new
                // multiplier is always effective
                scaled_ui_config.new_multiplier.into()
            };

            let total_ext_principal = _ext_mint.supply
                .checked_add(_ext_global_account.accrued_fee_principal)
                .unwrap();
            let total_ext_amount = principal_to_amount_up(
                total_ext_principal,
                current_multiplier
            )?;

            // TODO: think about rounding here, only reason vault m token account would be less is a rounding error
            if _vault_m_token_account.amount <= total_ext_amount {
                // No need to sync multiplier, return current multiplier
                return Ok(current_multiplier);
            }

            // Calculate the new multiplier based on amount of M in the vault vs. the outstanding UI amount of extension tokens
            let mut increase_factor: f64 = (_vault_m_token_account.amount as f64) / (total_ext_amount as f64);

            // Calculate the new multiplier, handling the fee if required
            let new_multiplier: f64 = if _ext_global_account.fee_bps > 0 {
                // Calculate the increase factor for the ext index
                let fee_on_yield = _ext_global_account.fee_bps as f64 / ONE_HUNDRED_PERCENT_F64;
                // The precision of the powf operation is non-deterministic
                // However, the margin of error is ~10^-16, which is smaller than the 10^-12 precision
                // that we need for this use case. See: https://doc.rust-lang.org/std/primitive.f64.html#method.powf
                increase_factor = increase_factor.powf(1.0f64 - fee_on_yield);

                // Calculate the new multiplier from the increase factor
                let new_multiplier = (current_multiplier * increase_factor * INDEX_SCALE_F64).floor() / INDEX_SCALE_F64;

                // Calculate the new fee principal
                let new_total_ext_amount = principal_to_amount_up(total_ext_principal, new_multiplier)?;
                let new_fee_principal = amount_to_principal_down(_vault_m_token_account.amount - new_total_ext_amount, new_multiplier)?;

                // Update the fee principal on the yield config
                _ext_global_account.accrued_fee_principal += new_fee_principal;

                new_multiplier
            } else {
                (current_multiplier * increase_factor * INDEX_SCALE_F64).floor() / INDEX_SCALE_F64
            };

            // Update the multiplier and timestamp in the mint account
            invoke_signed(
                &spl_token_2022::extension::scaled_ui_amount::instruction::update_multiplier(
                    &_token_program.key(),
                    &_ext_mint.key(),
                    &_authority.key(),
                    &[],
                    new_multiplier,
                    Clock::get()?.unix_timestamp as i64, // always set to current timestamp
                )?,
                &[_ext_mint.to_account_info(), _authority.clone()],
                _authority_seeds,
            )?;

            // Reload the mint account so the new multiplier is reflected
            _ext_mint.reload()?;

            return Ok(new_multiplier);
        } else {
            // Add any excess m to the accrued fee principal
            let total_ext_amount = _ext_mint.supply.checked_add(_ext_global_account.accrued_fee_principal).unwrap();
            _ext_global_account.accrued_fee_principal += _vault_m_token_account.amount.checked_sub(total_ext_amount).unwrap_or_default(); // adds zero if underflows

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

// cfg_if! {
//     if #[cfg(feature = "scaled-ui")] {
//         fn get_latest_multiplier_and_timestamp<'info>(
//             ext_global_account: &Account<'info, ExtGlobal>,
//             m_earn_global_account: &Account<'info, EarnGlobal>,
//         ) -> (f64, i64) {
//             let latest_m_multiplier = m_earn_global_account.index as f64 / INDEX_SCALE_F64;
//             let cached_m_multiplier = ext_global_account.yield_config.last_m_index as f64 / INDEX_SCALE_F64;
//             let latest_timestamp: i64 = m_earn_global_account.timestamp as i64;
//             let cached_ext_multiplier =
//                 ext_global_account.yield_config.last_ext_index as f64 / INDEX_SCALE_F64;

//             // If no change, return early
//             if latest_m_multiplier == cached_m_multiplier {
//                 return (cached_ext_multiplier, latest_timestamp);
//             }

//             // Calculate the new ext multiplier based on the latest m multiplier and timestamp
//             let new_ext_multiplier = calculate_new_multiplier(
//                 cached_ext_multiplier,
//                 cached_m_multiplier,
//                 latest_m_multiplier,
//                 ext_global_account.yield_config.fee_bps
//             );

//             (new_ext_multiplier, latest_timestamp)
//         }

//         fn calculate_new_multiplier(
//             last_ext_multiplier: f64,
//             last_m_multiplier: f64,
//             new_m_multiplier: f64,
//             fee_bps: u64,
//         ) -> f64 {
//             // Calculate the new ext multiplier from the formula:
//             // new_ext_multiplier = last_ext_multiplier * (new_m_multiplier / last_m_multiplier) ^ (1 - fee_on_yield)
//             // The derivation of this formula is explained in this document: https://gist.github.com/Oighty/89dd1288a0a7fb53eb6f0314846cb746
//             let m_increase_factor = new_m_multiplier / last_m_multiplier;

//             // Calculate the increase factor for the ext index, if the fee is zero, then the increase factor is the same as M
//             let ext_increase_factor = if fee_bps == 0 {
//                 m_increase_factor
//             } else {
//                 // Calculate the increase factor for the ext index
//                 let fee_on_yield = fee_bps as f64 / ONE_HUNDRED_PERCENT_F64;
//                 // The precision of the powf operation is non-deterministic
//                 // However, the margin of error is ~10^-16, which is smaller than the 10^-12 precision
//                 // that we need for this use case. See: https://doc.rust-lang.org/std/primitive.f64.html#method.powf
//                 m_increase_factor.powf(1.0f64 - fee_on_yield)
//             };

//             // Calculate the new extension multiplier (index in f64 scaled down)
//             let new_ext_multiplier = last_ext_multiplier * ext_increase_factor;

//             // We need to round the new multiplier down and truncate at 10^-12
//             // to return a consistent value
//             (new_ext_multiplier * INDEX_SCALE_F64).floor() / INDEX_SCALE_F64
//         }
//     }
// }

#[cfg(test)]
mod tests {
    // use super::*;

    // cfg_if! {
    //     if #[cfg(feature = "scaled-ui")] {
    //         #[test]
    //         fn test_calculate_new_multiplier_no_fee() {
    //             // cases (starting from 1.0):
    //             // no rounding
    //             let expected = 1.125000000000;
    //             let result = calculate_new_multiplier(1.0, 1.0, 1.125, 0);
    //             assert_eq!(result, expected);

    //             // would round up -> truncates
    //             let expected = 1.666666666666;
    //             let result = calculate_new_multiplier(1.0, 1.5, 2.5, 0);
    //             assert_eq!(result, expected);

    //             // would round down -> truncates
    //             let expected = 1.333333333333;
    //             let result = calculate_new_multiplier(1.0, 1.5, 2.0, 0);
    //             assert_eq!(result, expected);

    //             // cases (starting from truncated value that would have rounded up):
    //             // no rounding
    //             let expected = 1.749999999999; // off by one due to previous rounding
    //             let result = calculate_new_multiplier(1.666666666666, 2.0, 2.1, 0);
    //             assert_eq!(result, expected);

    //             // would round up -> truncates
    //             let expected = 1.777777777777;
    //             let result = calculate_new_multiplier(1.666666666666, 3.0, 3.2, 0);
    //             assert_eq!(result, expected);

    //             // would round down -> truncates
    //             let expected = 2.333333333332; // off by one due to previous rounding
    //             let result = calculate_new_multiplier(1.666666666666, 5.0, 7.0, 0);
    //             assert_eq!(result, expected);

    //             // cases (starting from truncated value that would have rounded down)
    //             let expected = 1.499999999999; // off by one due to previous rounding
    //             let result = calculate_new_multiplier(1.333333333333, 2.0, 2.25, 0);
    //             assert_eq!(result, expected);

    //             // would round up -> truncates
    //             let expected = 1.666666666666;
    //             let result = calculate_new_multiplier(1.333333333333, 2.0, 2.5, 0);
    //             assert_eq!(result, expected);

    //             // would round down -> truncates
    //             let expected = 2.333333333332;
    //             let result = calculate_new_multiplier(1.333333333333, 4.0, 7.0, 0);
    //             assert_eq!(result, expected);
    //         }

    //         // Helper function to trim the value to 12 decimal places after subtracting expected rounding error
    //         // This is needed to deal with imprecision in floating point arithmetic
    //         fn trim(value: f64) -> f64 {
    //             // Truncate the value to 12 decimal places
    //             (value * INDEX_SCALE_F64).ceil() / INDEX_SCALE_F64
    //         }

    //         #[test]
    //         fn test_calculate_new_multiplier_with_fee() {
    //             // there are three calculations here to test rounding behavior:
    //             // 1. m_increase_factor = new_m_multiplier / last_m_multiplier
    //             // 2. ext_increase_factor = m_increase_factor.powf(1.0 - fee_on_yield)
    //             // 3. new_ext_multiplier = last_ext_multiplier * ext_increase_factor
    //             // cases are listed with what the rounding behavior would be for each calculation
    //             // even though the rounding only happens when converting back to u64 for the final result
    //             // the basic expectation is that if there is a roundup anywhere in the sequence
    //             // the final result will be off by one to the downside due to truncation

    //             // cases:
    //             // Note: we can't reliably get examples that wouldn't round either direction for the 2nd equation since it is a fractional exponent
    //             // A
    //             //   1. no rounding
    //             //   2. rounds down
    //             //   3. no rounding
    //             let result = calculate_new_multiplier(1.0, 1.0, 1.125, 2500);
    //             let expected_actual = 1.092356486341; // wolfram alpha: 1.092356486341477...
    //             let expected = expected_actual; // no error
    //             assert_eq!(result, expected);

    //             // B
    //             //   1. no rounding
    //             //   2. rounds down
    //             //   3. rounds down
    //             let result = calculate_new_multiplier(1.3, 1.5, 1.65, 1500);
    //             let expected_actual = 1.409701411824; // wolfram alpha: 1.409701411824313...
    //             let expected = expected_actual; // no error
    //             assert_eq!(result, expected);

    //             // C
    //             //  1. no rounding
    //             //  2. rounds down
    //             //  3. would round up -> truncates
    //             let result = calculate_new_multiplier(1.2, 1.5, 1.65, 1500);
    //             let expected_actual = 1.301262841684; // wolfram alpha: 1.301262841683981...
    //             let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
    //             assert_eq!(result, expected);

    //             // D
    //             //  1. no rounding
    //             //  2. would round up -> truncates
    //             //  3. no rounding
    //             let result = calculate_new_multiplier(1.0, 1.5, 1.65, 1000);
    //             let expected_actual = 1.089565684036; // wolfram alpha: 1.089565684035973...
    //             let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
    //             assert_eq!(result, expected);

    //             // E
    //             //  1. no rounding
    //             //  2. would round up -> truncates
    //             //  3. rounds down
    //             let result = calculate_new_multiplier(1.2, 1.5, 1.65, 1000);
    //             let expected_actual = 1.307478820843; // wolfram alpha: 1.307478820843168...
    //             let expected = expected_actual; // no error
    //             assert_eq!(result, expected);

    //             // F
    //             //  1. no rounding
    //             //  2. would round up -> truncates
    //             //  3. would round up -> truncates
    //             let result = calculate_new_multiplier(1.3, 1.5, 1.65, 1000);
    //             let expected_actual = 1.416435389247; // wolfram alpha: 1.41643538924676614906538927073063715743660444837662580163175093387867947...
    //             let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
    //             assert_eq!(result, expected);

    //             // G
    //             //  1. rounds down
    //             //  2. rounds down
    //             //  3. no rounding
    //             let result = calculate_new_multiplier(1.0, 1.125, 1.25, 1000);
    //             let expected_actual = 1.099465842451; // wolfram alpha: 1.099465842451349...
    //             let expected = expected_actual; // no error
    //             assert_eq!(result, expected);

    //             // H
    //             //  1. rounds down
    //             //  2. rounds down
    //             //  3. rounds down
    //             let result = calculate_new_multiplier(1.1, 1.125, 1.25, 1000);
    //             let expected_actual = 1.209412426696; // wolfram alpha: 1.209412426696484...
    //             let expected = expected_actual; // no error
    //             assert_eq!(result, expected);

    //             // I
    //             //  1. rounds down
    //             //  2. rounds down
    //             //  3. would round up -> truncates
    //             let result = calculate_new_multiplier(1.2, 1.125, 1.25, 1000);
    //             let expected_actual = 1.319359010942; // wolfram alpha: 1.319359010941619...
    //             let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
    //             assert_eq!(result, expected);

    //             // J
    //             //  1. rounds down
    //             //  2. would round up -> truncates
    //             //  3. no rounding
    //             let result = calculate_new_multiplier(1.0, 1.125, 1.25, 2000);
    //             let expected_actual = 1.087942624846; // wolfram alpha: 1.087942624845529...
    //             let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
    //             assert_eq!(result, expected);

    //             // K
    //             //  1. rounds down
    //             //  2. would round up -> truncates
    //             //  3. rounds down
    //             let result = calculate_new_multiplier(1.3, 1.125, 1.25, 2000);
    //             let expected_actual = 1.414325412299; // wolfram alpha: 1.414325412299188...
    //             let expected = expected_actual; // no error
    //             assert_eq!(result, expected);

    //             // L
    //             //  1. rounds down
    //             //  2. would round up -> truncates
    //             //  3. would round up -> truncates
    //             let result = calculate_new_multiplier(1.2, 1.125, 1.25, 2000);
    //             let expected_actual = 1.305531149815; // wolfram alpha: 1.305531149814635...
    //             let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
    //             assert_eq!(result, expected);

    //             // M
    //             //  1. would round up -> truncates
    //             //  2. rounds down
    //             //  3. no rounding
    //             let result = calculate_new_multiplier(1.0, 3.0, 3.2, 1000);
    //             let expected_actual = 1.059804724543; // wolfram alpha: 1.059804724543068...
    //             let expected = expected_actual; // no error
    //             assert_eq!(result, expected);

    //             // N
    //             //  1. would round up -> truncates
    //             //  2. rounds down
    //             //  3. rounds down
    //             let result = calculate_new_multiplier(1.4, 3.0, 3.2, 1000);
    //             let expected_actual = 1.483726614360; // wolfram alpha: 1.483726614360295...
    //             let expected = expected_actual; // no error
    //             assert_eq!(result, expected);

    //             // O
    //             //  1. would round up -> truncates
    //             //  2. rounds down
    //             //  3. would round up -> truncates
    //             let result = calculate_new_multiplier(1.2, 3.0, 3.2, 1000);
    //             let expected_actual = 1.271765669452; // wolfram alpha: 1.271765669451681...
    //             let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
    //             assert_eq!(result, expected);

    //             // P
    //             //  1. would round up -> truncates
    //             //  2. would round up -> truncates
    //             //  3. no rounding
    //             let result = calculate_new_multiplier(1.0, 3.0, 3.2, 2000);
    //             let expected_actual = 1.052986925779; // wolfram alpha: 1.052986925778570...
    //             let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
    //             assert_eq!(result, expected);

    //             // Q
    //             //  1. would round up -> truncates
    //             //  2. would round up -> truncates
    //             //  3. rounds down
    //             let result = calculate_new_multiplier(1.2, 3.0, 3.2, 2000);
    //             let expected_actual = 1.263584310934; // wolfram alpha: 1.263584310934284...
    //             let expected = expected_actual;
    //             assert_eq!(result, expected);

    //             // R
    //             //  1. would round up -> truncates
    //             //  2. would round up -> truncates
    //             //  3. would round up -> truncates
    //             let result = calculate_new_multiplier(1.4, 3.0, 3.2, 2000);
    //             let expected_actual = 1.474181696090; // wolfram alpha: 1.474181696089998...
    //             let expected = trim(expected_actual - 0.000000000001); // off by one due to truncation
    //             assert_eq!(result, expected);
    //         }
    //     }
    // }
}

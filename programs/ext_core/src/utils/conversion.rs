use anchor_lang::prelude::*;

pub const MULTIPLIER_SCALE: u64 = 1_000_000_000_000u64;

pub fn amount_to_principal_down(amount: u64, multiplier: u64) -> Result<u64> {
    if multiplier == MULTIPLIER_SCALE {
        return Ok(amount);
    }

    // Calculate the principal from the amount and multiplier, rounding down
    let principal: u64 = (amount as u128)
        .checked_mul(MULTIPLIER_SCALE as u128)
        .expect("amount * MULTIPLIER_SCALE overflow")
        .checked_div(multiplier as u128)
        .expect("amount * MULTIPLIER_SCALE / multiplier underflow")
        .try_into()
        .expect("conversion overflow");

    Ok(principal)
}

pub fn amount_to_principal_up(amount: u64, multiplier: u64) -> Result<u64> {
    if multiplier == MULTIPLIER_SCALE {
        return Ok(amount);
    }

    // Calculate the principal from the amount and multiplier, rounding up
    let principal: u64 = (amount as u128)
        .checked_mul(MULTIPLIER_SCALE as u128)
        .expect("amount * MULTIPLIER_SCALE overflow")
        .checked_add(
            (multiplier as u128)
                .checked_sub(1u128)
                .expect("multiplier - 1 underflow"),
        )
        .expect("amount * MULTIPLIER + multiplier overflow")
        .checked_div(multiplier as u128)
        .expect("amount * MULTIPLIER_SCALE + multiplier / multiplier underflow")
        .try_into()
        .expect("conversion overflow");

    Ok(principal)
}

pub fn principal_to_amount_down(principal: u64, multiplier: u64) -> Result<u64> {
    if multiplier == MULTIPLIER_SCALE {
        return Ok(principal);
    }

    // Calculate the amount from the principal and multiplier, rounding down
    let amount: u64 = (multiplier as u128)
        .checked_mul(principal as u128)
        .expect("multiplier * principal overflow")
        .checked_div(MULTIPLIER_SCALE as u128)
        .expect("multiplier * principal / MULTIPLIER_SCALE underflow")
        .try_into()
        .expect("conversion overflow");

    Ok(amount)
}

pub fn principal_to_amount_up(principal: u64, multiplier: u64) -> Result<u64> {
    if multiplier == MULTIPLIER_SCALE {
        return Ok(principal);
    }

    // Calculate the amount from the principal and multiplier, rounding up
    let amount: u64 = (multiplier as u128)
        .checked_mul(principal as u128)
        .expect("multiplier * principal overflow")
        .checked_add(MULTIPLIER_SCALE as u128 - 1u128)
        .expect("multiplier * principal + MULTIPLIER_SCALE - 1 overflow")
        .checked_div(MULTIPLIER_SCALE as u128)
        .expect("multiplier * principal + MULTIPLIER_SCALE - 1 / MULTIPLIER_SCALE underflow")
        .try_into()
        .expect("conversion overflow");

    Ok(amount)
}

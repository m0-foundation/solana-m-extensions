use anchor_lang::{prelude::*, solana_program::program::invoke_signed};
use anchor_spl::token_interface::{spl_pod::primitives::PodI16, Mint, Token2022};
use earn::state::Global as EarnGlobal;
use spl_token_2022::extension::{
    interest_bearing_mint::{self, InterestBearingConfig},
    BaseStateWithExtensions, StateWithExtensions,
};

use crate::state::MINT_AUTH_SEED;

pub const SECONDS_PER_YEAR: f64 = 60. * 60. * 24. * 365.24;
pub const ONE_IN_BASIS_POINTS: f64 = 10_000.;
pub const INDEX_SCALE_F64: f64 = 1e12;
pub const INDEX_SCALE_U64: u64 = 1_000_000_000_000;

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

pub fn sync_rate<'info>(
    mint: &mut InterfaceAccount<'info, Mint>,
    m_earn_global: &Account<'info, EarnGlobal>,
    authority: &AccountInfo<'info>,
    mint_authority_bump: u8,
) -> Result<f64> {
    let authority_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, &[mint_authority_bump]]];

    // Parse ibt config from mint
    let multiplier: f64;
    {
        let ext_account_info = &mint.to_account_info();
        let ext_data = ext_account_info.try_borrow_data()?;
        let ext_mint_data = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&ext_data)?;
        let interest_bearing_config = ext_mint_data.get_extension::<InterestBearingConfig>()?;

        multiplier = get_ibt_multiplier(
            interest_bearing_config,
            Clock::get().unwrap().unix_timestamp,
        );

        // Compare against the current rate
        if interest_bearing_config.current_rate == PodI16::from(m_earn_global.earner_rate as i16) {
            return Ok(multiplier);
        }
    };

    // Update the multiplier and timestamp in the mint account
    invoke_signed(
        &interest_bearing_mint::instruction::update_rate(
            &Token2022::id(),
            &mint.key(),
            &authority.key(),
            &[],
            m_earn_global.earner_rate as i16,
        )?,
        &[mint.to_account_info(), authority.clone()],
        authority_seeds,
    )?;

    // Reload the mint account so the new multiplier is reflected
    mint.reload()?;

    return Ok(multiplier);
}

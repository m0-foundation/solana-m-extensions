use anchor_lang::prelude::{
    borsh::{BorshDeserialize, BorshSerialize},
    *,
};
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount, TokenInterface};

use crate::errors::ExtError;

use earn::state::Global as EarnGlobal;
use solana_program::program::invoke_signed;
use spl_token_2022::extension::{
    scaled_ui_amount::{PodF64, ScaledUiAmountConfig, UnixTimestamp},
    BaseStateWithExtensions, StateWithExtensions,
};

pub const INDEX_SCALE_F64: f64 = 1e12;
pub const INDEX_SCALE_U64: u64 = 1_000_000_000_000;
pub const ONE_HUNDRED_PERCENT_F64: f64 = 1e4;
pub const ONE_HUNDRED_PERCENT_U64: u64 = 100_00;

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub enum RebasingType {
    ScaledUiAmountExtension,
    InterestBearingExtension,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub struct RebasingConfig {
    pub rebasing_type: RebasingType,
    pub fee_bps: u64,
    pub last_m_index: u64,
    pub last_ext_index: u64,
}

impl<'info> RebasingConfig {
    pub fn sync(
        &mut self,
        ext_mint: &mut InterfaceAccount<'info, Mint>,
        m_earn_global_account: &Account<'info, EarnGlobal>,
        vault_m_token_account: &InterfaceAccount<'info, TokenAccount>,
        ext_mint_authority: &AccountInfo<'info>,
        ext_mint_authority_seeds: &[&[&[u8]]],
        token_program: &Interface<'info, TokenInterface>,
    ) -> Result<u64> {
        // Get the current index and timestamp from the m_earn_global_account and cached values
        let (multiplier, timestamp): (f64, i64) =
            get_latest_multiplier_and_timestamp(self, m_earn_global_account);

        // Compare against the current multiplier
        // If the multiplier is the same, we don't need to update
        {
            // explicit scope to drop the borrow at the end of the code block
            let ext_account_info = &ext_mint.to_account_info();
            let ext_data = ext_account_info.try_borrow_data()?;

            match self.rebasing_type {
                RebasingType::ScaledUiAmountExtension => {
                    // Validate the token program is token2022
                    if token_program.key() != Token2022::id() {
                        return err!(ExtError::InvalidTokenProgram);
                    }

                    let ext_mint_data =
                        StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&ext_data)?;
                    let scaled_ui_config = ext_mint_data.get_extension::<ScaledUiAmountConfig>()?;

                    if scaled_ui_config.new_multiplier == PodF64::from(multiplier)
                        && scaled_ui_config.new_multiplier_effective_timestamp
                            == UnixTimestamp::from(timestamp)
                    {
                        return Ok((multiplier * INDEX_SCALE_F64).floor() as u64);
                    }
                }
                RebasingType::InterestBearingExtension => {
                    // Validate the token program is token2022
                    if token_program.key() != Token2022::id() {
                        return err!(ExtError::InvalidTokenProgram);
                    }

                    panic!("Not implemented yet");
                }
            }
        }

        // Handle update of the multiplier if we have reached this point

        match self.rebasing_type {
            RebasingType::ScaledUiAmountExtension => {
                // Update the multiplier and timestamp in the mint account
                invoke_signed(
                    &spl_token_2022::extension::scaled_ui_amount::instruction::update_multiplier(
                        &token_program.key(),
                        &ext_mint.key(),
                        &ext_mint_authority.key(),
                        &[],
                        multiplier,
                        timestamp,
                    )?,
                    &[ext_mint.to_account_info(), ext_mint_authority.clone()],
                    ext_mint_authority_seeds,
                )?;

                // Reload the mint account so the new multiplier is reflected
                ext_mint.reload()?;
            }
            RebasingType::InterestBearingExtension => {
                panic!("Not implemented yet");
            }
        }

        // Update the last m index and last ext index in the rebasing config
        let ext_index = (multiplier * INDEX_SCALE_F64).floor() as u64;

        self.last_m_index = m_earn_global_account.index;
        self.last_ext_index = ext_index;

        // Check solvency of the vault
        // i.e. that it holds enough M for each extension UI amount
        // after the multiplier has been updated
        if ext_mint.supply > 0 {
            // Calculate the amount of tokens in the vault
            let vault_m = vault_m_token_account.amount;

            // Calculate the amount of tokens needed to be solvent
            // Reduce it by two to avoid rounding errors (there is an edge cases where the rounding error
            // from one index (down) to the next (up) can cause the difference to be 2)
            let mut required_m = principal_to_amount_down(ext_mint.supply, ext_index)?;
            required_m -= std::cmp::min(2, required_m);

            // Check if the vault has enough tokens
            if vault_m < required_m {
                return err!(ExtError::InsufficientCollateral);
            }
        }

        return Ok(ext_index);
    }

    fn get_latest_multiplier_and_timestamp(
        &self,
        m_earn_global_account: &Account<'info, EarnGlobal>,
    ) -> (f64, i64) {
        let latest_m_multiplier = m_earn_global_account.index as f64 / INDEX_SCALE_F64;
        let cached_m_multiplier = self.last_m_index as f64 / INDEX_SCALE_F64;
        let latest_timestamp: i64 = m_earn_global_account.timestamp as i64;
        let cached_ext_multiplier = self.last_ext_index as f64 / INDEX_SCALE_F64;

        // If no change, return early
        if latest_m_multiplier == cached_m_multiplier {
            return (cached_ext_multiplier, latest_timestamp);
        }

        // Calculate the new ext multiplier from the formula:
        // new_ext_multiplier = cached_ext_multiplier * (latest_m_multiplier / last_m_multiplier) ^ (1 - fee_on_yield)
        // The derivation of this formula is explained in this document: https://gist.github.com/Oighty/89dd1288a0a7fb53eb6f0314846cb746
        let m_increase_factor = latest_m_multiplier / cached_m_multiplier;

        // Calculate the increase factor for the ext index, if the fee is zero, then the increase factor is the same as M
        let ext_increase_factor = if self.fee_bps == 0 {
            m_increase_factor
        } else {
            // Calculate the increase factor for the ext index
            let fee_on_yield = self.fee_bps as f64 / ONE_HUNDRED_PERCENT_F64;
            // The precision of the powf operation is non-deterministic
            // However, the margin of error is ~10^-16, which is smaller than the 10^-12 precision
            // that we need for this use case. See: https://doc.rust-lang.org/std/primitive.f64.html#method.powf
            m_increase_factor.powf(1.0f64 - fee_on_yield)
        };

        // Calculate the new extension multiplier (index in f64 scaled down)
        let new_ext_multiplier = cached_ext_multiplier * ext_increase_factor;

        // We need to round the new multiplier down and truncate at 10^-12
        // to return a consistent value
        let new_ext_multiplier = (new_ext_multiplier * INDEX_SCALE_F64).floor() / INDEX_SCALE_F64;

        (new_ext_multiplier, latest_timestamp)
    }
}

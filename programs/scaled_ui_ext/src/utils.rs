// ext_earn/utils/token.rs

use core::f64;
use std::cmp::min;

// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, mint_to, transfer_checked, Burn, Mint, MintTo, Token2022, TokenAccount, TransferChecked,
};
use earn::state::Global;
use solana_program::program::invoke_signed;
use spl_token_2022::{
    extension::{
        scaled_ui_amount::{PodF64, ScaledUiAmountConfig, UnixTimestamp},
        BaseStateWithExtensions, StateWithExtensions,
    },
    state,
};

use crate::{
    constants::{INDEX_SCALE_F64, INDEX_SCALE_U64},
    errors::ExtError,
};

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

pub struct GlobalIndex {
    index: u128,
    timestamp: i64,
    multiplier: f64,
}

impl GlobalIndex {
    pub fn new(index: u128, timestamp: i64) -> Self {
        Self {
            index,
            timestamp,
            multiplier: (index as f64) / INDEX_SCALE_F64,
        }
    }

    pub fn check_solvency<'info>(
        &self,
        ext_mint: &InterfaceAccount<'info, Mint>,
        vault_m_token_account: &InterfaceAccount<'info, TokenAccount>,
    ) -> Result<()> {
        // Calculate the amount of tokens needed to be solvent
        // Reduce it by two to avoid rounding errors (there is an edge cases where the rounding error
        // from one index (down) to the next (up) can cause the difference to be 2)
        let mut required_amount = self.principal_to_amount_down(ext_mint.supply);
        required_amount -= min(2, required_amount);

        // Check if the vault has enough tokens
        if vault_m_token_account.amount < required_amount {
            return err!(ExtError::InsufficientCollateral);
        }

        Ok(())
    }

    pub fn sync_multiplier<'info>(
        &self,
        ext_mint: &mut InterfaceAccount<'info, Mint>,
        authority: &AccountInfo<'info>,
        authority_seeds: &[&[&[u8]]],
        token_program: &Program<'info, Token2022>,
    ) -> Result<()> {
        // If the multiplier is the same, we don't need to update
        if self.matches_mint_multiplier(&ext_mint.to_account_info()) {
            return Ok(());
        }

        // Update the multiplier and timestamp in the mint account
        invoke_signed(
            &spl_token_2022::extension::scaled_ui_amount::instruction::update_multiplier(
                &token_program.key(),
                &ext_mint.key(),
                &authority.key(),
                &[],
                self.multiplier,
                self.timestamp,
            )?,
            &[ext_mint.to_account_info(), authority.clone()],
            authority_seeds,
        )?;

        // Reload the mint account so the new multiplier is reflected
        ext_mint.reload()
    }

    pub fn amount_to_principal_down(&self, amount: u64) -> u64 {
        // Calculate the principal from the amount and index, rounding down
        (amount as u128)
            .checked_mul(INDEX_SCALE_U64 as u128)
            .and_then(|res| res.checked_div(self.index))
            .and_then(|res| res.try_into().ok())
            .expect("conversion underflow/overflow")
    }

    pub fn amount_to_principal_up(&self, amount: u64) -> u64 {
        // Calculate the principal from the amount and index, rounding up
        (amount as u128)
            .checked_mul(INDEX_SCALE_U64 as u128)
            .and_then(|res| res.checked_add(self.index))
            .and_then(|res| res.checked_sub(1u128))
            .and_then(|res| res.checked_div(self.index))
            .and_then(|res| res.try_into().ok())
            .expect("conversion underflow/overflow")
    }

    pub fn principal_to_amount_down(&self, principal: u64) -> u64 {
        // Calculate the amount from the principal and index, rounding down
        self.index
            .checked_mul(principal as u128)
            .and_then(|res| res.checked_div(INDEX_SCALE_U64 as u128))
            .and_then(|res| res.try_into().ok())
            .expect("conversion underflow/overflow")
    }

    pub fn principal_to_amount_up(&self, principal: u64) -> u64 {
        // Calculate the amount from the principal and index, rounding up
        self.index
            .checked_mul(principal as u128)
            .and_then(|res| res.checked_add(INDEX_SCALE_U64 as u128 - 1))
            .and_then(|res| res.checked_div(INDEX_SCALE_U64 as u128))
            .and_then(|res| res.try_into().ok())
            .expect("conversion underflow/overflow")
    }

    pub fn matches_mint_multiplier(&self, ext_mint_account_info: &AccountInfo<'_>) -> bool {
        let ext_data = ext_mint_account_info.try_borrow_data().unwrap();
        let ext_mint_data = StateWithExtensions::<state::Mint>::unpack(&ext_data).unwrap();

        let scaled_ui_config = ext_mint_data
            .get_extension::<ScaledUiAmountConfig>()
            .unwrap();

        scaled_ui_config.new_multiplier == PodF64::from(self.multiplier)
            && scaled_ui_config.new_multiplier_effective_timestamp
                == UnixTimestamp::from(self.timestamp)
    }
}

impl From<&Account<'_, Global>> for GlobalIndex {
    fn from(global: &Account<'_, Global>) -> Self {
        GlobalIndex::new(global.index as u128, global.timestamp as i64)
    }
}

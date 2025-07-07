use super::account_meta_for_swap::MExtSwap;
use anchor_lang::prelude::*;
use anyhow::{Error, Result};
use jupiter_amm_interface::{
    try_get_account_data, AccountMap, Amm, AmmContext, KeyedAccount, Quote, QuoteParams, Swap,
    SwapAndAccountMetas, SwapMode, SwapParams,
};
use m_ext::utils::conversion::{
    amount_to_principal_down, amount_to_principal_up, principal_to_amount_down,
};

use spl_token_2022::extension::{
    scaled_ui_amount::ScaledUiAmountConfig, BaseStateWithExtensions, ExtensionType,
    StateWithExtensions,
};
use std::collections::{HashMap, HashSet};

pub const MINTS: &[Pubkey] = &[
    // Add the mints that are supported by the M Extension Swap
    pubkey!("mzeroXDoBpRVhnEXBra27qzAMdxgpWVY3DzQW7xMVJp"), // wM
    pubkey!("usdkbee86pkLyRmxfFCdkyySpxRb5ndCxVsK2BkRXwX"), // USDK
    pubkey!("usdkyPPxgV7sfNyKb8eDz66ogPrkRXG3wS2FVb6LLUf"), // USDKY
];

#[derive(Clone)]
pub struct MExtSwapAmm {
    pub key: Pubkey,
    pub program_id: Pubkey,
    pub reserve_mints: Vec<Pubkey>,
    pub reserve_multipliers: HashMap<Pubkey, f64>,
    // TODO add more fields as necessary
}

impl Amm for MExtSwapAmm {
    // TODO can we require initial multipliers in the keyed_account.params input?
    fn from_keyed_account(keyed_account: &KeyedAccount, _amm_context: &AmmContext) -> Result<Self> {
        let mut reserve_mints = Vec::new();
        let mut reserve_multipliers = HashMap::new();
        for mint in MINTS {
            reserve_mints.push(*mint);
            // Set all multipliers to 1.0 by default, needs to be updated before quoting
            reserve_multipliers.insert(*mint, 1.0);
        }

        Ok(Self {
            key: keyed_account.key,
            program_id: keyed_account.account.owner,
            reserve_mints,
            reserve_multipliers,
        })
    }
    /// A human readable label of the underlying DEX
    fn label(&self) -> String {
        "M Extension Swap Facility".to_string()
    }
    fn program_id(&self) -> Pubkey {
        self.program_id
    }
    /// The pool state or market state address
    fn key(&self) -> Pubkey {
        self.key
    }
    /// The mints that can be traded
    fn get_reserve_mints(&self) -> Vec<Pubkey> {
        self.reserve_mints.clone()
    }
    /// The accounts necessary to produce a quote
    fn get_accounts_to_update(&self) -> Vec<Pubkey> {
        self.reserve_mints.clone()
    }
    /// Picks necessary accounts to update it's internal state
    /// Heavy deserialization and precomputation caching should be done in this function
    fn update(&mut self, account_map: &AccountMap) -> Result<()> {
        // Iterate through the reserve mints and update their multipliers
        for mint in &self.reserve_mints {
            let mint_account_data = try_get_account_data(account_map, &mint)?;

            let mint_ext_data =
                StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_account_data)?;

            let extensions = mint_ext_data.get_extension_types()?;

            if extensions.contains(&ExtensionType::ScaledUiAmount) {
                let scaled_ui_config = mint_ext_data.get_extension::<ScaledUiAmountConfig>()?;
                self.reserve_multipliers
                    .insert(*mint, f64::from(scaled_ui_config.multiplier));
            } else {
                self.reserve_multipliers.insert(*mint, 1.0);
            }
        }

        Ok(())
    }

    // TODO how do we handle situations where the extension mint is not synced?
    fn quote(&self, quote_params: &QuoteParams) -> Result<Quote> {
        // Check that the mints are supported
        if !(self.reserve_mints.contains(&quote_params.input_mint)
            || self.reserve_mints.contains(&quote_params.output_mint))
        {
            return Err(Error::msg("Unsupported mint"));
        }

        // Handle SwapModes
        // We assume that the quote "amount" is the raw token balance, not the UI amount used by the swap facility
        // The values returned here are the raw token amounts for both in/out
        let (in_amount, out_amount): (u64, u64) = if quote_params.swap_mode == SwapMode::ExactIn {
            // Get the multiplier for the input mint and convert the raw "principal" to a UI amount used by the swap facility
            let input_multiplier = self
                .reserve_multipliers
                .get(&quote_params.input_mint)
                .unwrap();

            let input_amount = principal_to_amount_down(quote_params.amount, *input_multiplier)?;

            // Get the multiplier for the output mint and convert the UI amount to output principal
            let output_multiplier = self
                .reserve_multipliers
                .get(&quote_params.output_mint)
                .unwrap();

            // This rounds down to be conservative
            let output_principal = amount_to_principal_down(input_amount, *output_multiplier)?;

            (quote_params.amount, output_principal)
        } else {
            // Get the multiplier for the output mint and convert the raw "principal" to a UI amount used by the swap facility
            let output_multiplier = self
                .reserve_multipliers
                .get(&quote_params.output_mint)
                .unwrap();

            let output_amount = principal_to_amount_down(quote_params.amount, *output_multiplier)?;

            // Get the multiplier for the input mint and convert the principal to input amount
            let input_multiplier = self
                .reserve_multipliers
                .get(&quote_params.input_mint)
                .unwrap();

            // This rounds up to be conservative
            let input_principal = amount_to_principal_up(output_amount, *input_multiplier)?;

            (input_principal, quote_params.amount)
        };

        // Construct the quote
        Ok(Quote {
            in_amount,
            out_amount,
            fee_amount: 0u64,
            fee_mint: Pubkey::default(),
            fee_pct: rust_decimal::Decimal::from(0),
        })
    }

    /// Indicates which Swap has to be performed along with all the necessary account metas
    fn get_swap_and_account_metas(&self, swap_params: &SwapParams) -> Result<SwapAndAccountMetas> {
        // Check that the mints are supported
        if !(self.reserve_mints.contains(&swap_params.source_mint)
            || self.reserve_mints.contains(&swap_params.destination_mint))
        {
            return Err(Error::msg("Unsupported mint"));
        }

        // TODO do we need to do anything with the amounts passed here?
        // They aren't going to match what is required to be passed to the swap instruction

        // Construct the SwapAndAccountMetas struct
        Ok(SwapAndAccountMetas {
            swap: Swap::TokenSwap, // TODO need to PR into the interface to add our own type
            account_metas: MExtSwap {
                signer: swap_params.token_transfer_authority,
                from_mint: swap_params.source_mint,
                to_mint: swap_params.destination_mint,
                from_token_account: swap_params.source_token_account,
                to_token_account: swap_params.destination_token_account,

                from_ext_program: Pubkey::default(), // Placeholder, replace with actual program ID if needed
                to_ext_program: Pubkey::default(), // Placeholder, replace with actual program ID if needed
                wrap_authority: None,              // assume this isn't used for now
                unwrap_authority: None,            // assume this isn't used for now
            }
            .into(),
        })
    }

    /// Indicates if get_accounts_to_update might return a non constant vec
    fn has_dynamic_accounts(&self) -> bool {
        true
    }

    /// Indicates whether `update` needs to be called before `get_reserve_mints`
    fn requires_update_for_reserve_mints(&self) -> bool {
        false
    }

    // Indicates that whether ExactOut mode is supported
    fn supports_exact_out(&self) -> bool {
        true
    }

    fn clone_amm(&self) -> Box<dyn Amm + Send + Sync> {
        Box::new(self.clone())
    }

    /// It can only trade in one direction from its first mint to second mint, assuming it is a two mint AMM
    fn unidirectional(&self) -> bool {
        false
    }

    /// For testing purposes, provide a mapping of dependency programs to function
    fn program_dependencies(&self) -> Vec<(Pubkey, String)> {
        vec![]
    }

    fn get_accounts_len(&self) -> usize {
        32 // Default to a near whole legacy transaction to penalize no implementation
    }

    /// The identifier of the underlying liquidity
    ///
    /// Example:
    /// For RaydiumAmm uses Openbook market A this will return Some(A)
    /// For Openbook market A, it will also return Some(A)
    fn underlying_liquidities(&self) -> Option<HashSet<Pubkey>> {
        None
    }

    /// Provides a shortcut to establish if the AMM can be used for trading
    /// If the market is active at all
    fn is_active(&self) -> bool {
        true
    }
}

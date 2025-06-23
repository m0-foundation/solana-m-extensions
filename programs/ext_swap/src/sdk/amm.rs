use jupiter_amm_interface::{
    try_get_account_data, AccountMap, Amm, AmmContext, KeyedAccount, Quote, QuoteParams, Swap,
    SwapAndAccountMetas, SwapParams,
};

pub struct MExtSwapAmm {
    pub key: Pubkey,
    pub program_id: Pubkey,
    pub reserve_mints: Vec<Pubkey>,
    // TODO add more fields as necessary
}

// TODO implement this trait
impl Amm for MExtSwapAmm {
    fn from_keyed_account(keyed_account: &KeyedAccount, amm_context: &AmmContext) -> Result<Self>
    where
        Self: Sized;
    /// A human readable label of the underlying DEX
    fn label(&self) -> String;
    fn program_id(&self) -> Pubkey;
    /// The pool state or market state address
    fn key(&self) -> Pubkey;
    /// The mints that can be traded
    fn get_reserve_mints(&self) -> Vec<Pubkey>;
    /// The accounts necessary to produce a quote
    fn get_accounts_to_update(&self) -> Vec<Pubkey>;
    /// Picks necessary accounts to update it's internal state
    /// Heavy deserialization and precomputation caching should be done in this function
    fn update(&mut self, account_map: &AccountMap) -> Result<()>;

    fn quote(&self, quote_params: &QuoteParams) -> Result<Quote>;

    /// Indicates which Swap has to be performed along with all the necessary account metas
    fn get_swap_and_account_metas(&self, swap_params: &SwapParams) -> Result<SwapAndAccountMetas>;

    /// Indicates if get_accounts_to_update might return a non constant vec
    fn has_dynamic_accounts(&self) -> bool {
        false
    }

    /// Indicates whether `update` needs to be called before `get_reserve_mints`
    fn requires_update_for_reserve_mints(&self) -> bool {
        false
    }

    // Indicates that whether ExactOut mode is supported
    fn supports_exact_out(&self) -> bool {
        false
    }

    fn get_user_setup(&self) -> Option<AmmUserSetup> {
        None
    }

    fn clone_amm(&self) -> Box<dyn Amm + Send + Sync>;

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

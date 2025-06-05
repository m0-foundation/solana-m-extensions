use anchor_lang::prelude::*;
use cfg_if::cfg_if;

#[constant]
pub const EXT_GLOBAL_SEED: &[u8] = b"global";

#[account]
#[derive(InitSpace)]
pub struct ExtGlobal {
    pub admin: Pubkey,                 // can update config values
    pub ext_mint: Pubkey,              // m extension mint
    pub m_mint: Pubkey,                // m mint
    pub m_earn_global_account: Pubkey, // m earn global account
    pub bump: u8,
    pub m_vault_bump: u8,
    pub ext_mint_authority_bump: u8,
    pub wrap_authorities: [Pubkey; 10], // wrap authorities
    pub yield_config: YieldConfig,      // yield config
}

#[constant]
pub const MINT_AUTHORITY_SEED: &[u8] = b"mint_authority";

#[constant]
pub const M_VAULT_SEED: &[u8] = b"m_vault";

cfg_if! {
    if #[cfg(feature = "scaled-ui")] {
        #[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
        pub struct YieldConfig {
            pub fee_bps: u64, // fee in basis points
            pub last_m_index: u64, // last m index
            pub last_ext_index: u64, // last ext index
            pub accrued_fee_principal: u64
        }
    } else {
        #[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
        pub struct YieldConfig {}
    }
}

use anchor_lang::prelude::*;

/// Per-asset configuration for JMI multi-asset backing
/// PDA seeds: [ASSET_CONFIG_SEED, global_account, asset_mint]
#[account]
#[derive(InitSpace)]
pub struct AssetConfig {
    /// Maximum balance allowed for this asset (in asset decimals, 0 = disabled)
    pub cap: u64,
    /// Current tracked balance (in asset decimals)
    pub balance: u64,
    /// Asset decimals (cached from mint)
    pub decimals: u8,
    /// PDA bump seed
    pub bump: u8,
}
// Size: 8 (discriminator) + 8 + 8 + 1 + 1 = 26 bytes

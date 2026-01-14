use anchor_lang::prelude::*;

/// Per-asset configuration for JMI multi-asset backing
/// PDA seeds: [ASSET_CONFIG_SEED, global_account, asset_mint]
/// Note: Only assets with 6 decimals are accepted (validated in set_asset_cap)
#[account]
#[derive(InitSpace)]
pub struct AssetConfig {
    /// Maximum balance allowed for this asset (in 6 decimals, 0 = disabled)
    pub cap: u64,
    /// PDA bump seed
    pub bump: u8,
}
// Size: 8 (discriminator) + 8 + 1 = 17 bytes

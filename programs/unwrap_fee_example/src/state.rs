use anchor_lang::prelude::*;

#[constant]
pub const WRAP_CONFIG_SEED: &[u8] = b"wrap_config";

#[constant]
pub const MINT_AUTH_SEED: &[u8] = b"wrap_config";

#[account]
#[derive(InitSpace)]
pub struct WrapConfig {
    pub fee_bps: u16,
    pub fee_exempt: [Pubkey; 10],
    pub bump: u8,
}

use anchor_lang::prelude::*;

pub const GLOBAL_SEED: &[u8] = b"global";
pub const POOL_CONFIG_SEED: &[u8] = b"pool_config";
pub const POOL_ACTOR: &[u8] = b"pool_actor";
pub const LP_MINT_SEED: &[u8] = b"lp_mint";

#[account]
#[derive(InitSpace)]
pub struct Global {
    pub admin: Pubkey,
    pub freeze_swaps: bool,
    pub freeze_liquidity: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub swap_mint_a: Pubkey,
    pub swap_mint_b: Pubkey,
    pub lp_receipt_mint: Pubkey,
    pub balance_a: u64,
    pub balance_b: u64,
    pub trade_fee_bps: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ApprovedPoolActor {
    pub owner: Pubkey,
    pub bump: u8,
}

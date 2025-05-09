#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub m_mint: Pubkey,
    pub m_earn_global_account: Pubkey,
    // TODO how to restrict unwraps to protocol-approved accounts? same as earner list?
    pub unwrap_authorities: [Pubkey; 32],
}

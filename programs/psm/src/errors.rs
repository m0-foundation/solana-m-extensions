use anchor_lang::prelude::*;

#[error_code]
pub enum PSMError {
    #[msg("Insufficient balance in pool")]
    InsufficientPoolBalance,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Cannot complete action until unfrozen")]
    Frozen,
    #[msg("Mint does not belong to pool")]
    InvalidMint,
}

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
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("No excess fees or yield in pool")]
    NoExcess,
    #[msg("The mint has an unsupported extension")]
    UnsupportedMint,
}

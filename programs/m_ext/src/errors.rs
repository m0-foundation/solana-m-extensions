use anchor_lang::prelude::*;

#[error_code]
pub enum ExtError {
    #[msg("Invalid signer.")]
    NotAuthorized,
    #[msg("Invalid parameter.")]
    InvalidParam,
    #[msg("Account does not match the expected key.")]
    InvalidAccount,
    #[msg("Account is currently active.")]
    Active,
    #[msg("Account is not currently active.")]
    NotActive,
    #[msg("Not enough M.")]
    InsufficientCollateral,
    #[msg("Invalid Mint.")]
    InvalidMint,
    #[msg("Math overflow error.")]
    MathOverflow,
    #[msg("Math underflow error.")]
    MathUnderflow,
    #[msg("Type conversion error.")]
    TypeConversionError,
    #[msg("Invalid value provided for calculation")]
    InvalidInput,
    #[msg("Invalid amount")]
    InvalidAmount,
}

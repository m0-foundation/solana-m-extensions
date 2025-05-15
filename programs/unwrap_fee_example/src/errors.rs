use anchor_lang::prelude::*;

#[error_code]
pub enum ExtError {
    #[msg("Invalid Mint")]
    InvalidMint,
    #[msg("Invalid instruction invocation")]
    InvalidInvocation,
}

use anchor_lang::prelude::*;

#[error_code]
pub enum ExtError {
    #[msg("Invalid Mint")]
    InvalidMint,
    #[msg("Invalid instruction invocation")]
    InvalidInvocation,
    #[msg("Only up to 10 extra accounts are supported")]
    TooManyAccounts,
}

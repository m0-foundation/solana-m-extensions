use anchor_lang::prelude::*;

#[error_code]
pub enum SwapError {
    #[msg("Extension is not whitelisted")]
    InvalidExtension,
    #[msg("Remaining accounts index is larger than the number of remaining accounts")]
    InvalidRemainingAccountsIndex,
}

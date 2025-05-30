use anchor_lang::prelude::*;

#[error_code]
pub enum SwapError {
    #[msg("Extension is not whitelisted")]
    InvalidExtension,
}

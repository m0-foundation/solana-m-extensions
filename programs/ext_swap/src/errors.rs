use anchor_lang::prelude::*;

#[error_code]
pub enum SwapError {
    #[msg("Extension is not whitelisted")]
    InvalidExtension,
    #[msg("Extension is already whitelisted")]
    AlreadyWhitelisted,
    #[msg("Index invalid for length of the array")]
    InvalidIndex,
    #[msg("Signer is not whitelisted")]
    UnauthorizedUnwrapper,
    #[msg("Signer is not authorized to perform this action")]
    NotAuthorized,
}

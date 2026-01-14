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
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Extensions must belong to the same extension group")]
    MixedExtensionGroups,
    #[msg("Token already exists")]
    BridgeableTokenAlreadyExists,
    #[msg("Token not found")]
    BridgeableTokenNotFound,
    #[msg("Invalid extension group name")]
    InvalidName,
}

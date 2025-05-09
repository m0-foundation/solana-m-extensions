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
    #[msg("Transfer hook called when not transferring.")]
    NotCurrentlyTransferring,
}

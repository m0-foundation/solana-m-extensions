use solana_program::{
    decode_error::DecodeError,
    msg,
    program_error::{PrintProgramError, ProgramError},
};

#[repr(u32)]
#[derive(Clone, Debug, Eq, thiserror::Error, num_derive::FromPrimitive, PartialEq)]
pub enum ExtensionError {
    #[error("Incorrect account provided")]
    IncorrectAccount = 2_110_272_652,
    #[error("Missing AccountMetas Account")]
    AccountMetasMissing,
}

impl From<ExtensionError> for ProgramError {
    fn from(e: ExtensionError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

impl<T> DecodeError<T> for ExtensionError {
    fn type_of() -> &'static str {
        "ExtensionError"
    }
}

impl PrintProgramError for ExtensionError {
    fn print<E>(&self)
    where
        E: 'static
            + std::error::Error
            + DecodeError<E>
            + PrintProgramError
            + num_traits::FromPrimitive,
    {
        match self {
            ExtensionError::IncorrectAccount => {
                msg!("Incorrect account provided")
            }
            ExtensionError::AccountMetasMissing => {
                msg!("Missing AccountMetas Account")
            }
        }
    }
}

use {
    solana_program::program_error::ProgramError,
    spl_discriminator::{ArrayDiscriminator, SplDiscriminate},
    spl_pod::{bytemuck::pod_slice_to_bytes, slice::PodSlice},
    spl_tlv_account_resolution::account::ExtraAccountMeta,
    std::convert::TryInto,
};

/// Instructions supported by the M extension interface.
#[repr(C)]
#[derive(Clone, Debug, PartialEq)]
pub enum MExtensionInstruction {
    /// Sync and return the token multiplier
    Sync {},

    /// Wrap M tokens to extension token
    Wrap { amount: u64 },

    /// Unwrap M tokens to extension token
    Unwrap { amount: u64 },

    /// Initializes the extra account metas on an account
    InitializeExtraAccountMetaList {
        extra_account_metas: Vec<ExtraAccountMeta>,
    },
}

#[derive(SplDiscriminate)]
#[discriminator_hash_input("m-extension-interface:sync")]
pub struct SyncInstruction;

#[derive(SplDiscriminate)]
#[discriminator_hash_input("m-extension-interface:wrap")]
pub struct WrapInstruction;

#[derive(SplDiscriminate)]
#[discriminator_hash_input("m-extension-interface:unwrap")]
pub struct UnwrapInstruction;

#[derive(SplDiscriminate)]
#[discriminator_hash_input("m-extension-interface:initialize-extra-account-metas")]
pub struct InitializeExtraAccountMetaListInstruction;

impl MExtensionInstruction {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        if input.len() < ArrayDiscriminator::LENGTH {
            return Err(ProgramError::InvalidInstructionData);
        }
        let (discriminator, rest) = input.split_at(ArrayDiscriminator::LENGTH);
        Ok(match discriminator {
            SyncInstruction::SPL_DISCRIMINATOR_SLICE => Self::Sync {},
            WrapInstruction::SPL_DISCRIMINATOR_SLICE => {
                let amount = rest
                    .get(..8)
                    .and_then(|slice| slice.try_into().ok())
                    .map(u64::from_le_bytes)
                    .ok_or(ProgramError::InvalidInstructionData)?;
                Self::Wrap { amount }
            }
            UnwrapInstruction::SPL_DISCRIMINATOR_SLICE => {
                let amount = rest
                    .get(..8)
                    .and_then(|slice| slice.try_into().ok())
                    .map(u64::from_le_bytes)
                    .ok_or(ProgramError::InvalidInstructionData)?;
                Self::Unwrap { amount }
            }
            InitializeExtraAccountMetaListInstruction::SPL_DISCRIMINATOR_SLICE => {
                let pod_slice = PodSlice::<ExtraAccountMeta>::unpack(rest)?;
                let extra_account_metas = pod_slice.data().to_vec();
                Self::InitializeExtraAccountMetaList {
                    extra_account_metas,
                }
            }
            _ => return Err(ProgramError::InvalidInstructionData),
        })
    }

    pub fn pack(&self) -> Vec<u8> {
        let mut buf = vec![];
        match self {
            Self::Sync {} => {
                buf.extend_from_slice(SyncInstruction::SPL_DISCRIMINATOR_SLICE);
            }
            Self::Wrap { amount } => {
                buf.extend_from_slice(WrapInstruction::SPL_DISCRIMINATOR_SLICE);
                buf.extend_from_slice(&amount.to_le_bytes());
            }
            Self::Unwrap { amount } => {
                buf.extend_from_slice(WrapInstruction::SPL_DISCRIMINATOR_SLICE);
                buf.extend_from_slice(&amount.to_le_bytes());
            }
            Self::InitializeExtraAccountMetaList {
                extra_account_metas,
            } => {
                buf.extend_from_slice(
                    InitializeExtraAccountMetaListInstruction::SPL_DISCRIMINATOR_SLICE,
                );
                buf.extend_from_slice(&(extra_account_metas.len() as u32).to_le_bytes());
                buf.extend_from_slice(pod_slice_to_bytes(extra_account_metas));
            }
        };
        buf
    }
}

use {
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program_error::ProgramError,
        pubkey::Pubkey,
    },
    spl_discriminator::{ArrayDiscriminator, SplDiscriminate},
    spl_pod::{bytemuck::pod_slice_to_bytes, slice::PodSlice},
    spl_tlv_account_resolution::account::ExtraAccountMeta,
    std::convert::TryInto,
};

const SYSTEM_PROGRAM_ID: Pubkey = Pubkey::from_str_const("11111111111111111111111111111111");

/// Instructions supported by the M extension interface.
#[repr(C)]
#[derive(Clone, Debug, PartialEq)]
pub enum MExtensionInstruction {
    /// Wrap M tokens to extension token
    ///
    /// Accounts expected by this instruction:
    ///
    ///   0. `[]` Source M token account
    ///   1. `[]` Destination extension token account
    ///   2. `[]` Validation account
    ///   3. ..`3+M` `[]` `M` optional additional accounts, written in validation account data
    Wrap { amount: u64 },

    /// Unwrap M tokens to extension token
    ///
    /// Accounts expected by this instruction:
    ///
    ///   0. `[]` Source extension token account
    ///   1. `[]` Destination M token account
    ///   2. `[]` Validation account
    ///   3. ..`3+M` `[]` `M` optional additional accounts, written in validation account data
    Unwrap { amount: u64 },

    /// Initializes the extra account metas on an account, writing into the
    /// first open TLV space.
    ///
    /// Accounts expected by this instruction:
    ///
    ///   0. `[w]` Account with extra account metas
    ///   1. `[]` Mint
    ///   2. `[s]` Mint authority
    ///   3. `[]` System program
    InitializeExtraAccountMetaList {
        /// List of `ExtraAccountMeta`s to write into the account
        extra_account_metas: Vec<ExtraAccountMeta>,
    },
    /// Updates the extra account metas on an account by overwriting the
    /// existing list.
    ///
    /// Accounts expected by this instruction:
    ///
    ///   0. `[w]` Account with extra account metas
    ///   1. `[]` Mint
    ///   2. `[s]` Mint authority
    UpdateExtraAccountMetaList {
        /// The new list of `ExtraAccountMetas` to overwrite the existing entry in the account.
        extra_account_metas: Vec<ExtraAccountMeta>,
    },
}

#[derive(SplDiscriminate)]
#[discriminator_hash_input("m-extension-interface:wrap")]
pub struct WrapInstruction;

#[derive(SplDiscriminate)]
#[discriminator_hash_input("m-extension-interface:unwrap")]
pub struct UnwrapInstruction;

#[derive(SplDiscriminate)]
#[discriminator_hash_input("m-extension-interface:initialize-extra-account-metas")]
pub struct InitializeExtraAccountMetaListInstruction;

#[derive(SplDiscriminate)]
#[discriminator_hash_input("m-extension-interface:update-extra-account-metas")]
pub struct UpdateExtraAccountMetaListInstruction;

impl MExtensionInstruction {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        if input.len() < ArrayDiscriminator::LENGTH {
            return Err(ProgramError::InvalidInstructionData);
        }
        let (discriminator, rest) = input.split_at(ArrayDiscriminator::LENGTH);
        Ok(match discriminator {
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
            UpdateExtraAccountMetaListInstruction::SPL_DISCRIMINATOR_SLICE => {
                let pod_slice = PodSlice::<ExtraAccountMeta>::unpack(rest)?;
                let extra_account_metas = pod_slice.data().to_vec();
                Self::UpdateExtraAccountMetaList {
                    extra_account_metas,
                }
            }
            _ => return Err(ProgramError::InvalidInstructionData),
        })
    }

    pub fn pack(&self) -> Vec<u8> {
        let mut buf = vec![];
        match self {
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
            Self::UpdateExtraAccountMetaList {
                extra_account_metas,
            } => {
                buf.extend_from_slice(
                    UpdateExtraAccountMetaListInstruction::SPL_DISCRIMINATOR_SLICE,
                );
                buf.extend_from_slice(&(extra_account_metas.len() as u32).to_le_bytes());
                buf.extend_from_slice(pod_slice_to_bytes(extra_account_metas));
            }
        };
        buf
    }
}

/// Creates an `Wrap` instruction, provided all of the additional required account metas
pub fn wrap_with_extra_account_metas(
    program_id: &Pubkey,
    source_pubkey: &Pubkey,
    mint_pubkey: &Pubkey,
    destination_pubkey: &Pubkey,
    authority_pubkey: &Pubkey,
    validate_state_pubkey: &Pubkey,
    additional_accounts: &[AccountMeta],
    amount: u64,
) -> Instruction {
    let data = MExtensionInstruction::Wrap { amount }.pack();
    let mut accounts = vec![
        AccountMeta::new_readonly(*source_pubkey, false),
        AccountMeta::new_readonly(*mint_pubkey, false),
        AccountMeta::new_readonly(*destination_pubkey, false),
        AccountMeta::new_readonly(*authority_pubkey, false),
        AccountMeta::new_readonly(*validate_state_pubkey, false),
    ];

    accounts.extend_from_slice(additional_accounts);

    Instruction {
        program_id: *program_id,
        accounts,
        data,
    }
}

/// Creates an `unwrap` instruction, provided all of the additional required account metas
pub fn unwrap_with_extra_account_metas(
    program_id: &Pubkey,
    source_pubkey: &Pubkey,
    mint_pubkey: &Pubkey,
    destination_pubkey: &Pubkey,
    authority_pubkey: &Pubkey,
    validate_state_pubkey: &Pubkey,
    additional_accounts: &[AccountMeta],
    amount: u64,
) -> Instruction {
    let data = MExtensionInstruction::Unwrap { amount }.pack();
    let mut accounts = vec![
        AccountMeta::new_readonly(*source_pubkey, false),
        AccountMeta::new_readonly(*mint_pubkey, false),
        AccountMeta::new_readonly(*destination_pubkey, false),
        AccountMeta::new_readonly(*authority_pubkey, false),
        AccountMeta::new_readonly(*validate_state_pubkey, false),
    ];

    accounts.extend_from_slice(additional_accounts);

    Instruction {
        program_id: *program_id,
        accounts,
        data,
    }
}

/// Creates a `InitializeExtraAccountMetaList` instruction.
pub fn initialize_extra_account_meta_list(
    program_id: &Pubkey,
    extra_account_metas_pubkey: &Pubkey,
    mint_pubkey: &Pubkey,
    authority_pubkey: &Pubkey,
    extra_account_metas: &[ExtraAccountMeta],
) -> Instruction {
    let data = MExtensionInstruction::InitializeExtraAccountMetaList {
        extra_account_metas: extra_account_metas.to_vec(),
    }
    .pack();

    let accounts = vec![
        AccountMeta::new(*extra_account_metas_pubkey, false),
        AccountMeta::new_readonly(*mint_pubkey, false),
        AccountMeta::new_readonly(*authority_pubkey, true),
        AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
    ];

    Instruction {
        program_id: *program_id,
        accounts,
        data,
    }
}

/// Creates a `UpdateExtraAccountMetaList` instruction.
pub fn update_extra_account_meta_list(
    program_id: &Pubkey,
    extra_account_metas_pubkey: &Pubkey,
    mint_pubkey: &Pubkey,
    authority_pubkey: &Pubkey,
    extra_account_metas: &[ExtraAccountMeta],
) -> Instruction {
    let data = MExtensionInstruction::UpdateExtraAccountMetaList {
        extra_account_metas: extra_account_metas.to_vec(),
    }
    .pack();

    let accounts = vec![
        AccountMeta::new(*extra_account_metas_pubkey, false),
        AccountMeta::new_readonly(*mint_pubkey, false),
        AccountMeta::new_readonly(*authority_pubkey, true),
    ];

    Instruction {
        program_id: *program_id,
        accounts,
        data,
    }
}

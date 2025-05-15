use spl_tlv_account_resolution::account::ExtraAccountMeta as SplExtraAccountMeta;
use {
    crate::{
        error::ExtensionError,
        instruction::{self, MExtensionInstruction},
        state::{ExtraAccountMeta, ExtraAccountMetas},
    },
    anchor_lang::AnchorDeserialize,
    solana_program::{
        account_info::AccountInfo,
        entrypoint::ProgramResult,
        instruction::{AccountMeta, Instruction},
        program::invoke,
        program_error::ProgramError,
        pubkey::Pubkey,
    },
    spl_discriminator::SplDiscriminate,
};

/// Helper to CPI into a M extension program, looking through the
/// additional account infos to create the proper instruction
pub fn invoke_wrap<'a>(
    program_id: &Pubkey,
    mint: AccountInfo<'a>,
    extra_account_metas: &AccountInfo<'a>,
    additional_accounts: &[AccountInfo<'a>],
    amount: u64,
) -> ProgramResult {
    let mut cpi_instruction = Instruction {
        program_id: *program_id,
        accounts: vec![AccountMeta::new_readonly(*mint.key, false)],
        data: MExtensionInstruction::Wrap { amount }.pack(),
    };

    let data = extra_account_metas.data.borrow();
    let extra_accounts = ExtraAccountMetas::try_from_slice(data.as_ref())?;

    // Start with accounts required for the CPI and add additional account below
    let mut cpi_account_infos = vec![mint];

    cpi_instruction
        .accounts
        .push(AccountMeta::new_readonly(*extra_account_metas.key, false));

    cpi_account_infos.push(extra_account_metas.clone());

    // Resolve the extra account metas for the instruction from the AccountMetas PDA
    add_to_cpi_instruction::<instruction::WrapInstruction>(
        &mut cpi_instruction,
        &mut cpi_account_infos,
        &extra_accounts.extra_accounts,
        additional_accounts,
    )?;

    invoke(&cpi_instruction, &cpi_account_infos)
}

/// Add the additional account metas and account infos for a CPI
pub fn add_to_cpi_instruction<'a, T: SplDiscriminate>(
    cpi_instruction: &mut Instruction,
    cpi_account_infos: &mut Vec<AccountInfo<'a>>,
    acount_metas: &[ExtraAccountMeta],
    account_infos: &[AccountInfo<'a>],
) -> Result<(), ProgramError> {
    for extra_meta in acount_metas.iter() {
        let spl_extra_meta: SplExtraAccountMeta = extra_meta.into();

        let meta = {
            let account_key_data_refs = cpi_account_infos
                .iter()
                .map(|info| {
                    let key = *info.key;
                    let data = info.try_borrow_data()?;
                    Ok((key, data))
                })
                .collect::<Result<Vec<_>, ProgramError>>()?;

            spl_extra_meta.resolve(
                &cpi_instruction.data,
                &cpi_instruction.program_id,
                |usize| {
                    account_key_data_refs
                        .get(usize)
                        .map(|(pubkey, opt_data)| (pubkey, Some(opt_data.as_ref())))
                },
            )?
        };

        let account_info = account_infos
            .iter()
            .find(|&x| *x.key == meta.pubkey)
            .ok_or(ExtensionError::IncorrectAccount)?
            .clone();

        cpi_instruction.accounts.push(meta);
        cpi_account_infos.push(account_info);
    }
    Ok(())
}

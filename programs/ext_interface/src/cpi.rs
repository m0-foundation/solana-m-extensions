use {
    crate::{
        error::ExtensionError,
        get_extra_account_metas_address,
        instruction::{self, MExtensionInstruction},
        state::ExtraAccountMetas,
    },
    solana_program::{
        account_info::AccountInfo,
        entrypoint::ProgramResult,
        instruction::{AccountMeta, Instruction},
        program::invoke,
        program_error::ProgramError,
        pubkey::Pubkey,
    },
    spl_discriminator::SplDiscriminate,
    spl_tlv_account_resolution::account::ExtraAccountMeta,
};

/// Helper to CPI into a M extension program, looking through the
/// additional account infos to create the proper instruction
pub fn invoke_wrap<'a>(
    program_id: &Pubkey,
    source_info: AccountInfo<'a>,
    mint_info: AccountInfo<'a>,
    destination_info: AccountInfo<'a>,
    authority_info: AccountInfo<'a>,
    additional_accounts: &[AccountInfo<'a>],
    amount: u64,
) -> ProgramResult {
    let mut cpi_instruction = Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new_readonly(*source_info.key, false),
            AccountMeta::new_readonly(*mint_info.key, false),
            AccountMeta::new_readonly(*destination_info.key, false),
            AccountMeta::new_readonly(*authority_info.key, false),
        ],
        data: MExtensionInstruction::Wrap { amount }.pack(),
    };

    let metas_pubkey = get_extra_account_metas_address(mint_info.key, program_id).0;

    // Start with accounts required for the CPI and add additional account below
    let mut cpi_account_infos = vec![source_info, mint_info, destination_info, authority_info];

    if let Some(metas_info) = additional_accounts.iter().find(|&x| *x.key == metas_pubkey) {
        cpi_instruction
            .accounts
            .push(AccountMeta::new_readonly(metas_pubkey, false));

        cpi_account_infos.push(metas_info.clone());

        let extra_account_metas = ExtraAccountMetas::unpack(&metas_info.try_borrow_data()?)?;

        // Resolve the extra account metas for the instruction from the AccountMetas PDA
        add_to_cpi_instruction::<instruction::WrapInstruction>(
            &mut cpi_instruction,
            &mut cpi_account_infos,
            extra_account_metas.extra_accounts,
            additional_accounts,
        )?;
    } else {
        return Err(ExtensionError::AccountMetasMissing.into());
    }

    invoke(&cpi_instruction, &cpi_account_infos)
}

/// Add the additional account metas and account infos for a CPI
pub fn add_to_cpi_instruction<'a, T: SplDiscriminate>(
    cpi_instruction: &mut Instruction,
    cpi_account_infos: &mut Vec<AccountInfo<'a>>,
    acount_metas: Vec<ExtraAccountMeta>,
    account_infos: &[AccountInfo<'a>],
) -> Result<(), ProgramError> {
    for extra_meta in acount_metas.iter() {
        let meta = {
            let account_key_data_refs = cpi_account_infos
                .iter()
                .map(|info| {
                    let key = *info.key;
                    let data = info.try_borrow_data()?;
                    Ok((key, data))
                })
                .collect::<Result<Vec<_>, ProgramError>>()?;

            extra_meta.resolve(
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

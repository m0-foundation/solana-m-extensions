use anchor_lang::prelude::{
    borsh::{BorshDeserialize, BorshSerialize},
    *,
};
use anchor_spl::token_interface::Mint;
declare_program!(custom_ext_interface);
use custom_ext_interface::cpi::accounts::{UnwrapHook, WrapHook};

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub struct CustomConfig {
    pub ext_program: Pubkey,
    pub wrap_hook: bool,
    pub unwrap_hook: bool,
}

impl<'info> CustomConfig {
    // TODO think about which accounts to pass in by default
    // and what can be moved to remaining_accounts
    pub fn wrap_hook(
        &self,
        ext_program: &Option<AccountInfo<'info>>,
        ext_mint: &InterfaceAccount<'info, Mint>,
        remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<u64> {
        let cpi_context = CpiContext::new(
            ext_program
                .as_ref()
                .ok_or(ProgramError::InvalidArgument)?
                .clone(),
            WrapHook {
                ext_mint: ext_mint.to_account_info(),
            },
        )
        .with_remaining_accounts(remaining_accounts.to_vec());

        custom_ext_interface::cpi::wrap_hook(cpi_context)?.get()
    }

    pub fn unwrap_hook(
        &self,
        ext_program: &Option<AccountInfo<'info>>,
        ext_mint: &InterfaceAccount<'info, Mint>,
        remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<u64> {
        let cpi_context = CpiContext::new(
            ext_program
                .as_ref()
                .ok_or(ProgramError::InvalidArgument)?
                .clone(),
            UnwrapHook {
                ext_mint: ext_mint.to_account_info(),
            },
        )
        .with_remaining_accounts(remaining_accounts.to_vec());

        custom_ext_interface::cpi::unwrap_hook(cpi_context)?.get()
    }
}

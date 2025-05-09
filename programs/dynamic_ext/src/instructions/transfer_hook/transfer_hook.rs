use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_token_2022::{extension::{BaseStateWithExtensions, transfer_hook::TransferHookAccount, PodStateWithExtensionsMut}, pod::PodAccount};

use crate::errors::ExtError;

use super::WhiteList;

#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(
        token::mint = mint, 
        token::authority = owner,
    )]
    pub source_token: InterfaceAccount<'info, TokenAccount>,
    
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: source token account owner
    pub owner: UncheckedAccount<'info>,

    /// CHECK: ExtraAccountMetaList Account
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()], 
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    #[cfg(feature = "transfer-whitelist")]
    #[account(seeds = [b"whitelist"], bump)]
    pub whitelist: Account<'info, WhiteList>,
}

impl TransferHook<'_> {
    fn validate(&self) -> Result<()> {
        let source_token_info = self.source_token.to_account_info();
        let mut account_data_ref = source_token_info.try_borrow_mut_data()?;
        let account = PodStateWithExtensionsMut::<PodAccount>::unpack(*account_data_ref)?;
        let account_extension = account.get_extension::<TransferHookAccount>()?;
    
        // Fail this instruction if it is not called from within a transfer hook 
        if !bool::from(account_extension.transferring) {
            return err!(ExtError::NotCurrentlyTransferring);
        }

        #[cfg(feature = "transfer-whitelist")]
        if !self.whitelist.keys.contains(&self.destination_token.key()) {
            return err!(ExtError::InvalidAccount);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<TransferHook>, _: u64) -> Result<()> {
        Ok(())
     }
}

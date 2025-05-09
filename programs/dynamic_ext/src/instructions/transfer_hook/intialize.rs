use anchor_lang::{
    prelude::*,
    system_program::{create_account, CreateAccount},
};
use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::{
    constants::ANCHOR_DISCRIMINATOR_SIZE, errors::ExtError, state::{ExtGlobal, EXT_GLOBAL_SEED}
};

use super::WhiteList;

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = admin @ ExtError::InvalidAccount,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    /// CHECK: ExtraAccountMetaList Account
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()], 
        bump
    )]
    pub extra_account_meta_list: AccountInfo<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,

    #[cfg(feature = "transfer-whitelist")]
    #[account(
        init_if_needed, 
        seeds = [b"whitelist"], 
        bump, 
        payer = admin, 
        space = ANCHOR_DISCRIMINATOR_SIZE + WhiteList::INIT_SPACE,
    )]
    pub whitelist: Account<'info, WhiteList>,
}

impl InitializeExtraAccountMetaList<'_> {
    // index 0-3 are the accounts required for token transfer (source, mint, destination, owner)
    // index 4 is address of ExtraAccountMetaList account
    // 5+ are the extra accounts required for the transfer hook
    pub fn handler(ctx: Context<InitializeExtraAccountMetaList>) -> Result<()> {
        // Extra accounts required for the transfer hook
        let mut extra_account_metas = vec![];

        #[cfg(feature = "transfer-whitelist")]
        extra_account_metas.push(ExtraAccountMeta::new_with_seeds(
            &[Seed::Literal {
                bytes: "whitelist".as_bytes().to_vec(),
            }],
            false, // is_signer
            true,  // is_writable
        )?);

        // Calculate account size
        let account_size = ExtraAccountMetaList::size_of(extra_account_metas.len())? as u64;

        // Calculate minimum required lamports
        let lamports = Rent::get()?.minimum_balance(account_size as usize);

        let mint = ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"extra-account-metas",
            &mint.as_ref(),
            &[ctx.bumps.extra_account_meta_list],
        ]];

        // Create ExtraAccountMetaList account
        create_account(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                CreateAccount {
                    from: ctx.accounts.admin.to_account_info(),
                    to: ctx.accounts.extra_account_meta_list.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            lamports,
            account_size,
            ctx.program_id,
        )?;

        // Initialize ExtraAccountMetaList account with extra accounts
        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &extra_account_metas,
        )?;

        Ok(())
    }
}

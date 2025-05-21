use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use m_ext_interface::state::{ExtraAccountMeta, ExtraAccountMetas};
use spl_tlv_account_resolution::{account::ExtraAccountMeta as SplExtraAccountMeta, seeds::Seed};

use crate::{
    errors::ExtError,
    state::{WrapConfig, WRAP_CONFIG_SEED},
};

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
        space = 8 + ExtraAccountMetas::INIT_SPACE,
    )]
    pub extra_account_meta_list: InterfaceAccount<'info, ExtraAccountMetas>,

    #[account(
        init,
        space = 8 + WrapConfig::INIT_SPACE,
        payer = admin,
        seeds = [WRAP_CONFIG_SEED],
        bump,
    )]
    pub wrap_config: Account<'info, WrapConfig>,

    pub system_program: Program<'info, System>,
}

impl InitializeExtraAccountMetaList<'_> {
    fn validate(&self) -> Result<()> {
        if self.extra_account_meta_list.extra_accounts.len() > 10 {
            return err!(ExtError::TooManyAccounts);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        let mut extra_accounts: [ExtraAccountMeta; 10] = Default::default();

        extra_accounts[0] = ExtraAccountMeta::from_spl(&SplExtraAccountMeta::new_with_seeds(
            &[Seed::Literal {
                bytes: WRAP_CONFIG_SEED.to_vec(),
            }],
            false,
            false,
        )?);

        ctx.accounts
            .extra_account_meta_list
            .set_inner(ExtraAccountMetas {
                mint: ctx.accounts.mint.key(),
                bump: ctx.bumps.extra_account_meta_list,
                extra_accounts: extra_accounts,
            });

        Ok(())
    }
}

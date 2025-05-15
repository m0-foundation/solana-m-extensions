use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    constants::{ANCHOR_DISCRIMINATOR_SIZE, ONE_HUNDRED_PERCENT_U64},
    errors::ExtError,
    state::{EarnManager, ExtConfig, EARN_MANAGER_SEED_PREFIX, EXT_CONFIG_SEED_PREFIX},
};

#[derive(Accounts)]
#[instruction(earn_manager: Pubkey)]
pub struct AddEarnManager<'info> {
    #[account(mut)]
    pub ext_authority: Signer<'info>,

    #[account(
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_config.ext_mint.as_ref()],
        bump = ext_config.bump,
        has_one = ext_authority @ ExtError::NotAuthorized,
    )]
    pub ext_config: Account<'info, ExtConfig>,

    #[account(
        init_if_needed,
        payer = ext_authority,
        space = ANCHOR_DISCRIMINATOR_SIZE + EarnManager::INIT_SPACE,
        seeds = [EARN_MANAGER_SEED_PREFIX, ext_config.ext_mint.as_ref(), earn_manager.as_ref()],
        bump
    )]
    pub earn_manager_account: Account<'info, EarnManager>,

    #[account(token::mint = ext_config.ext_mint)]
    pub fee_token_account: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

impl<'info> AddEarnManager<'info> {
    fn validate(&self) -> Result<()> {
        // Revert if extension does not support earner accounts
        match self.ext_config.yield_config {
            YieldConfig::Crank(_) => {}
            YieldConfig::MerkleClaims(_) => {}
            _ => {
                return err!(ExtError::InstructionNotSupported);
            }
        }

        Ok(())
    }
    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>, earn_manager: Pubkey, fee_bps: u64) -> Result<()> {
        if fee_bps > ONE_HUNDRED_PERCENT_U64 {
            return err!(ExtError::InvalidParam);
        }

        ctx.accounts.earn_manager_account.set_inner(EarnManager {
            earn_manager,
            is_active: true,
            fee_bps,
            fee_token_account: ctx.accounts.fee_token_account.key(),
            bump: ctx.bumps.earn_manager_account,
        });

        Ok(())
    }
}

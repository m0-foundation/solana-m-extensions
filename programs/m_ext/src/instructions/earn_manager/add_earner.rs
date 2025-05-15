// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

// local dependencies
use crate::{
    constants::ANCHOR_DISCRIMINATOR_SIZE,
    errors::ExtError,
    state::{
        EarnManager, Earner, ExtConfig, EARNER_SEED_PREFIX, EARN_MANAGER_SEED_PREFIX,
        EXT_CONFIG_SEED_PREFIX,
    },
};

#[derive(Accounts)]
#[instruction(user: Pubkey)]
pub struct AddEarner<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        constraint = earn_manager_account.is_active @ ExtError::NotActive,
        seeds = [EARN_MANAGER_SEED_PREFIX, ext_config.ext_mint.as_ref(), signer.key().as_ref()],
        bump = earn_manager_account.bump
    )]
    pub earn_manager_account: Account<'info, EarnManager>,

    #[account(
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_config.ext_mint.as_ref()],
        bump = ext_config.bump,
    )]
    pub ext_config: Account<'info, ExtConfig>,

    #[account(
        token::mint = ext_config.ext_mint,
        token::authority = user,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = signer,
        space = ANCHOR_DISCRIMINATOR_SIZE + Earner::INIT_SPACE,
        seeds = [EARNER_SEED_PREFIX, ext_config.ext_mint.as_ref(), user_token_account.key().as_ref()],
        bump
    )]
    pub earner_account: Account<'info, Earner>,

    pub system_program: Program<'info, System>,
}

impl<'info> AddEarner<'info> {
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
    pub fn handler(ctx: Context<Self>, user: Pubkey) -> Result<()> {
        let (start_index, start_timestamp) = match ctx.accounts.ext_config.yield_config {
            YieldConfig::Crank(config) => (config.last_ext_index, config.last_timestamp),
            YieldConfig::MerkleClaims(config) => (config.last_ext_index, config.last_timestamp),
            _ => unreachable!(),
        };

        ctx.accounts.earner_account.set_inner(Earner {
            earn_manager: ctx.accounts.signer.key(),
            recipient_token_account: None,
            last_claim_index: start_index,
            last_claim_timestamp: start_timestamp,
            bump: ctx.bumps.earner_account,
            user,
            user_token_account: ctx.accounts.user_token_account.key(),
        });

        Ok(())
    }
}

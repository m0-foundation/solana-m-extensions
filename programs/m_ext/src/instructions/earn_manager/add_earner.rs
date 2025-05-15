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
            YieldConfig::Manual(_) => {}
            _ => {
                return err!(ExtError::InstructionNotSupported);
            }
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>, user: Pubkey) -> Result<()> {
        // Construct the earner type data
        let earner_type = match ctx.accounts.ext_config.yield_config {
            YieldConfig::Manual(config) => match config.manual_type {
                ManualType::Crank => EarnerType::Crank {
                    last_claim_index: config.ext_index,
                    last_claim_timestamp: config.timestamp,
                },
                ManualType::MerkleClaims(_) => EarnerType::MerkleClaims {
                    claimed_amount: 0, // TODO need to think about how to handle situations where the earner account is closed and re-created
                    claim_delegate: None,
                },
            },
            _ => unreachable!(),
        };

        ctx.accounts.earner_account.set_inner(Earner {
            user,
            user_token_account: ctx.accounts.user_token_account.key(),
            earn_manager: ctx.accounts.signer.key(),
            earner_type,
            bump: ctx.bumps.earner_account,
            recipient_token_account: None,
        });

        Ok(())
    }
}

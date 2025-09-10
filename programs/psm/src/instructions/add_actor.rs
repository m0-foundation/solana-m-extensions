use anchor_lang::prelude::*;

use crate::state::{ApprovedPoolActor, Global, GLOBAL_SEED, POOL_ACTOR};

#[derive(Accounts)]
#[instruction(owner: Pubkey)]
pub struct AddActor<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [GLOBAL_SEED],
        bump = global.bump,
    )]
    pub global: Account<'info, Global>,

    #[account(
        init,
        seeds = [POOL_ACTOR, owner.key().as_ref()],
        space = 8 + ApprovedPoolActor::INIT_SPACE,
        payer = admin,
        bump,
    )]
    pub actor: Account<'info, ApprovedPoolActor>,

    pub system_program: Program<'info, System>,
}

impl AddActor<'_> {
    fn validate(&self) -> Result<()> {
        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>, owner: Pubkey) -> Result<()> {
        ctx.accounts.actor.set_inner(ApprovedPoolActor {
            owner: owner,
            bump: ctx.bumps.actor,
        });

        Ok(())
    }
}

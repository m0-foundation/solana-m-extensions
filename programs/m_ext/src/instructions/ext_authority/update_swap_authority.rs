use anchor_lang::prelude::*;

use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct UpdateSwapAuthority<'info> {
    pub ext_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_config.ext_mint.as_ref()],
        has_one = ext_authority @ ExtError::NotAuthorized,
        bump = ext_config.bump,
    )]
    pub ext_config: Account<'info, ExtConfig>,
}

pub fn handler(
    ctx: Context<UpdateSwapAuthority>,
    index: u8,
    new_swap_authority: Pubkey,
) -> Result<()> {
    let ext_config = &mut ctx.accounts.ext_config;

    // Validate that the new swap authority is not already in the list (if not the system program)
    if new_swap_authority != Pubkey::default()
        && ext_config.swap_authorities.contains(&new_swap_authority)
    {
        return err!(ExtError::InvalidParam);
    }

    // Validate that the index is within bounds
    if index as usize >= ext_config.swap_authorities.len() {
        return err!(ExtError::InvalidParam);
    }

    // Update the swap authority at the specified index
    ext_config.swap_authorities[index as usize] = new_swap_authority;

    Ok(())
}

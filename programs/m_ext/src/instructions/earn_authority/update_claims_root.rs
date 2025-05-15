use anchor_lang::prelude::*;

use crate::state::{manual, YieldConfig};

#[derive(Accounts)]
pub struct UpdateClaimsRoot<'info> {
    pub ext_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_config.ext_mint.as_ref()],
        bump = ext_config.bump,
        has_one = ext_authority @ ExtError::NotAuthorized,
    )]
    pub ext_config: Account<'info, ExtConfig>,
}

impl<'info> UpdateClaimsRoot<'info> {
    fn validate(&self, new_root_ext_index: u64, new_claimable_amount: u64) -> Result<()> {
        // Only supported by the MerkleClaims yield variant
        match self.ext_config.yield_config {
            YieldConfig::Manual(manual_config) => {
                match manual_config.manual_type {
                    ManualType::MerkleClaims(config) => {
                        // Check that the new_root_ext_index is greater than the existing root_ext_index
                        // and less than or equal to the current ext_index
                        if new_root_ext_index <= config.root_ext_index {
                            err!(ExtError::InvalidParam)
                        } else if new_root_ext_index > manual_config.ext_index {
                            err!(ExtError::InvalidParam)
                        } else {
                            Ok(())
                        }
                    }
                    _ => {
                        err!(ExtError::InstructionNotSupported)
                    }
                }
            }
            _ => err!(ExtError::InstructionNotSupported),
        }
    }

    #[access_control(ctx.accounts.validate(as_of_ext_index, new_claimable_amount))]
    pub fn handler(
        ctx: Context<Self>,
        merkle_root: [u8; 32],
        new_root_ext_index: u64,
        new_claimable_amount: u64,
    ) -> Result<()> {
        match &mut ctx.accounts.ext_config.yield_config {
            YieldConfig::Manual(manual_config) => {
                match &mut manual_config.manual_type {
                    ManualType::MerkleClaims(config) => {
                        // Update the claims root and root_ext_index
                        config.merkle_root = merkle_root;
                        config.root_ext_index = new_root_ext_index;
                        config.max_claimable_amount += new_claimable_amount as u128;
                    }
                    _ => unreachable!(),
                }
            }
            _ => unreachable!(),
        }

        Ok(())
    }
}

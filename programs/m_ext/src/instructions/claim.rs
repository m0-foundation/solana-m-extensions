use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        constraint = signer.key() == earner_account.user || if let Some(claim_delegate) = earner_account.claim_delegate {
            signer.key() == claim_delegate
        } else {
            false
        },
    )]
    pub signer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.bump,
        has_one = ext_mint @ ExtError::InvalidMint,
        has_one = ext_token_program @ ExtError::InvalidTokenProgram,
    )]
    pub ext_config: Account<'info, ExtConfig>,

    #[account(mut)]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.ext_mint_authority_bump,
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [EARNER_SEED_PREFIX, ext_mint.key().as_ref(), signer.key().as_ref()],
        bump = earner_account.bump,
    )]
    pub earner_account: Account<'info, EarnerAccount>,

    #[account(
        mut,
        address = if let Some(recipient_token_account) = earner_account.recipient_token_account {
            recipient_token_account
        } else {
            earner_account.user_token_account
        },
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    pub ext_token_program: Program<'info, TokenInterface>,
}

impl<'info> Claim<'info> {
    fn validate(&self, claimable_amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        match self.ext_config.yield_config {
            YieldConfig::Manual(manual_config) => {
                match manual_config.manual_type {
                    ManualType::MerkleClaims(config) => {
                        // Check that the claimable amount is greater than 0
                        if claimable_amount == 0 {
                            return err!(ExtError::InvalidParam);
                        }

                        let total_user_amount: u128 = match self.earner_account.earner_type {
                            EarnerType::MerkleClaims(data) => data
                                .claimed_amount
                                .checked_add(claimable_amount as u128)
                                .expect("Overflow"),
                            _ => return err!(ExtError::InvalidAccount),
                        };

                        // Check that the proof is valid
                        if !config.verify_proof(
                            self.earner_account.user_token_account,
                            total_user_amount,
                            &proof,
                        ) {
                            return err!(ExtError::InvalidParam);
                        }
                    }
                    _ => return err!(ExtError::InstructionNotSupported),
                }
            }
            _ => return err!(ExtError::InstructionNotSupported),
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(amount_claimable, proof))]
    pub fn handler(ctx: Context<Self>, claimable_amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        // Increment the total and earner claimed amounts by the claimable amount
        if let EarnerType::MerkleClaims(earner_data) = &mut ctx.accounts.earner_account.earner_type
        {
            earner_data.claimed_amount = earner_data
                .claimed_amount
                .checked_add(claimable_amount as u128)
                .expect("Overflow");
        } else {
            return err!(ExtError::InvalidAccount);
        }

        if let YieldConfig::Manual(manual_config) = &mut ctx.accounts.ext_config.yield_config {
            if let ManualType::MerkleClaims(config) = &mut manual_config.manual_type {
                let new_claimed_amount = config
                    .claimed_amount
                    .checked_add(claimable_amount as u128)
                    .expect("Overflow");

                if new_claimed_amount > config.max_claimable_amount {
                    return err!(ExtError::InvalidParam);
                }

                // Update the total claimed amount in the global account
                config.claimed_amount = new_claimed_amount;
            }
        } else {
            return err!(ExtError::InvalidAccount);
        }

        // Mint the claimable amount to the user's token account
        // The MerkleClaims yield variant has a 1:1 conversion ratio
        // so we can mint the amount directly
        mint_tokens(
            &ctx.accounts.recipient_token_account, // to
            claimable_amount,                      // amount
            &ctx.accounts.ext_mint,                // mint
            &ctx.accounts.ext_mint_authority,      // authority
            &[&[
                MINT_AUTHORITY_SEED_PREFIX,
                ctx.accounts.ext_mint.key().as_ref(),
                &[ctx.accounts.ext_config.ext_mint_authority_bump],
            ]],
            &ctx.accounts.ext_token_program, // token program
        )?;

        ctx.accounts.ext_mint.reload()?;

        // Check that the vault is solvent after the mint
        if ctx.accounts.ext_mint.supply > ctx.accounts.vault_m_token_account.amount {
            return err!(ExtError::InsufficientCollateral);
        }

        Ok(())
    }
}

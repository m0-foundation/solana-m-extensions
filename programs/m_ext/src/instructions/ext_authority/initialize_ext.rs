use crate::{
    constants::{ANCHOR_DISCRIMINATOR_SIZE, INDEX_SCALE_U64, ONE_HUNDRED_PERCENT_U64},
    errors::ExtError,
    state::{
        Config, CustomConfig, ExtConfig, RebasingType, CONFIG_SEED, EXT_CONFIG_SEED_PREFIX,
        MINT_AUTHORITY_SEED_PREFIX, M_VAULT_SEED_PREFIX,
    },
    utils::spl_multisig::SplMultisig,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use earn::state::Global as EarnGlobal;

#[derive(Accounts)]
pub struct InitializeExt<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = m_mint @ ExtError::InvalidMint,
        has_one = m_earn_global_account @ ExtError::InvalidAccount,
    )]
    pub config: Account<'info, Config>,

    pub m_mint: InterfaceAccount<'info, Mint>,

    pub m_earn_global_account: Account<'info, EarnGlobal>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED_PREFIX, ext_mint.key().as_ref()],
        bump
    )]
    pub m_vault: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = m_token_program,
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = signer,
        space = ANCHOR_DISCRIMINATOR_SIZE + ExtConfig::INIT_SPACE,
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_mint.key().as_ref()],
        bump
    )]
    pub ext_config: Account<'info, ExtConfig>,

    #[account(
        mut,
        mint::authority = ext_mint_authority_ms,
    )]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    pub ext_mint_authority_ms: InterfaceAccount<'info, SplMultisig>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED_PREFIX, ext_mint.key().as_ref()],
        bump
    )]
    pub ext_mint_authority_signer: AccountInfo<'info>,

    pub m_token_program: Interface<'info, TokenInterface>,

    pub ext_token_program: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,
}

pub enum YieldParams {
    None,
    Manual(ManualParams),
    Rebasing(RebasingParams),
    Custom(CustomConfig),
}

pub struct ManualParams {
    pub earn_authority: Pubkey,
    pub manual_type: ManualType,
}

pub struct RebasingParams {
    pub rebasing_type: RebasingType,
    pub fee_bps: u64,
}

pub enum AccessParams {
    None,
    Finite(Vec<Pubkey>), // wrap_authorities
}

impl<'info> InitializeExt<'info> {
    pub fn validate(&self, yield_params: YieldParams, access_params: Access_Params) -> Result<()> {
        // Validate the ext_mint_authority_ms is initialized and is a 1/N multisig
        if !self.ext_mint_authority_ms.is_initialized || self.ext_mint_authority_ms.m != 1 {
            return err!(ExtError::InvalidMintAuthority);
        }

        // Validate the pda ext mint authority signer is a signer on the multisig
        let ext_mint_authority_signer = self.ext_mint_authority_signer.key();
        if !self
            .ext_mint_authority_ms
            .signers
            .contains(&ext_mint_authority_signer)
        {
            return err!(ExtError::InvalidMintAuthority);
        }

        // Validate the yield params
        match yield_params {
            YieldParams::Rebasing(params) => {
                if params.fee_bps > ONE_HUNDRED_PERCENT_U64 {
                    return err!(ExtError::InvalidParam);
                }

                // Validate token2022 rebasing params
                // Condition used here since different rebasing types could be
                // added in the future.
                if params.rebasing_type == RebasingType::ScaledUiAmountExtension
                    || params.rebasing_type == RebasingType::InterestBearingExtension
                {
                    // Validate the token program is token2022
                    if self.ext_token_program.key() != Token2022::id() {
                        return err!(ExtError::InvalidTokenProgram);
                    }

                    // Validate that the ext mint has the ScaledUiAmount extension and
                    // that the ext mint authority signer is the extension authority
                    // The extension authority needs to be a single address controlled by
                    // this program to avoid external changes in the multiplier that would
                    // get it out of sync with the ext_config.yield_config values
                    let ext_account_info = self.ext_mint.to_account_info();
                    let ext_data = ext_account_info.try_borrow_data()?;
                    let ext_mint_data =
                        StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&ext_data)?;
                    let extensions = ext_mint_data.get_extension_types()?;

                    match params.rebasing_type {
                        RebasingType::ScaledUiAmountExtension => {
                            if !extensions.contains(&ExtensionType::ScaledUiAmount) {
                                return err!(ExtError::InvalidMint);
                            }

                            let scaled_ui_config =
                                ext_mint_data.get_extension::<ScaledUiAmountConfig>()?;
                            if scaled_ui_config.authority
                                != OptionalNonZeroPubkey(ext_mint_authority_signer)
                            {
                                return err!(ExtError::InvalidMint);
                            }
                        }
                        RebasingType::InterestBearingExtension => {
                            if !extensions.contains(&ExtensionType::InterestBearing) {
                                return err!(ExtError::InvalidMint);
                            }

                            let interest_bearing_config =
                                ext_mint_data.get_extension::<InterestBearingConfig>()?;
                            if interest_bearing_config.authority
                                != OptionalNonZeroPubkey(ext_mint_authority_signer)
                            {
                                return err!(ExtError::InvalidMint);
                            }
                        }
                    }
                }
            }
            YieldParams::Manual(params) => {
                // Validate the merkle claims params
                if let ManualParams::MerkleClaims(config) = params {
                    if config.max_claimable_amount > config.claimed_amount {
                        return err!(ExtError::InvalidParam);
                    }
                    // Because this is a new extension (to this program),
                    // the ext_index applicable to the root must be
                    // less than or equal to the starting ext_index
                    // which is 1e12 (aka 1.0)
                    if config.root_ext_index > INDEX_SCALE_U64 {
                        return err!(ExtError::InvalidParam);
                    }
                }
            }
            _ => {}
        }

        // Validate the access params
        match access_params {
            AccessParams::Finite(wrap_authorities) => {
                // Validate and create the wrap authorities array
                if wrap_authorities.len() > MAX_AUTHORITIES {
                    return err!(ExtError::InvalidParam);
                }
            }
            _ => {}
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(yield_params, access_params))]
    pub fn handler(
        ctx: Context<Self>,
        yield_params: YieldParams,
        access_params: AccessParams,
    ) -> Result<()> {
        // Construct the YieldConfig
        let yield_config = match yield_params {
            YieldParams::None => YieldConfig::None,
            YieldParams::Manual(params) => YieldConfig::Manual(CrankConfig {
                earn_authority,
                m_index: ctx.accounts.m_earn_global_account.index,
                ext_index: INDEX_SCALE_U64,
                timestamp: ctx.accounts.m_earn_global_account.timestamp,
                manual_type: params.manual_type,
            }),
            YieldParams::Rebasing(params) => YieldConfig::Rebasing(RebasingConfig {
                rebasing_type: params.rebasing_type,
                fee_bps: params.fee_bps,
                last_m_index: ctx.accounts.m_earn_global_account.index,
                last_ext_index: INDEX_SCALE_U64,
            }),
            // TODO do we need to validate anything on the custom config?
            YieldParams::Custom(custom_config) => YieldConfig::Custom(custom_config),
        };

        // Construct the AccessConfig
        let access_config = match access_params {
            AccessParams::None => AccessConfig::Open,
            AccessParams::Finite(wrap_authorities) => {
                let mut wrap_authorities_array = [Pubkey::default(); 10];
                for (i, authority) in wrap_authorities.iter().enumerate() {
                    if wrap_authorities_array.contains(authority) {
                        return err!(ExtError::InvalidParam);
                    }
                    wrap_authorities_array[i] = *authority;
                }
                AccessConfig::Finite(FiniteConfig { wrap_authorities })
            }
        };

        // Initialize the ExtGlobal account
        ctx.accounts.ext_config.set_inner(ExtConfig {
            ext_authority: signer.key(),
            ext_mint: ctx.accounts.ext_mint.key(),
            ext_token_program: ctx.accounts.ext_token_program.key(),
            bump: ctx.bumps.global_account,
            m_vault_bump: ctx.bumps.m_vault,
            ext_mint_authority_bump: ctx.bumps.ext_mint_authority,
            yield_config,
            access_config,
        });

        // Sync the extension to ensure it is solvent initially
        // Previous extensions required an initial supply of 0,
        // but we want to allow for an external extension to migrate
        // to this program without deploying a new mint
        // Therefore, we just require that the vault is solvent
        match ctx.accounts.ext_config.yield_config {
            YieldConfig::Rebasing(&mut rebasing_config) => {
                // This will ensure any external multipliers
                // (e.g. token2022 extensiosn) are synced
                // and checks collateralization if the supply is > 0
                rebasing_config.sync(
                    &mut ctx.accounts.ext_mint,
                    &ctx.accounts.m_earn_global_account,
                    &ctx.accounts.vault_m_token_account,
                    &ctx.accounts.ext_mint_authority_signer,
                    &[&[
                        MINT_AUTHORITY_SEED_PREFIX,
                        ctx.accounts.ext_mint.key().as_ref(),
                        &[ctx.bumps.ext_mint_authority],
                    ]],
                    &ctx.accounts.ext_token_program,
                )?;
            }
            YieldConfig::Custom(custom_config) => {
                // TODO we need to allow for a ratio different than 1:1
                // Therefore, we probably need to get the multiplier
                // from the custom ext program and check solvency
            }
            _ => {
                // No sync required for other yield configs and the
                // conversion rates are 1:1. Therefore, we just need
                // to compare the vault balance to the ext mint supply
                // We just check that the vault is solvent.
                // TODO what about pending yield? Do we just assume there is none?
                if ctx.accounts.ext_mint.supply > ctx.accounts.vault_m_token_account.amount {
                    return err!(ExtError::InsufficientCollateral);
                }
            }
        }

        Ok(())
    }
}

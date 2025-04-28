// scaled_ui_ext/instructions/initialize.rs

// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022};
use spl_token_2022::extension::{
    BaseStateWithExtensions, ExtensionType, StateWithExtensions,
    scaled_ui_amount::ScaledUiAmountConfig,
};

// local dependencies
use crate::{
    constants::ANCHOR_DISCRIMINATOR_SIZE,
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED}, 
    utils::sync_multiplier,
};
use earn::{
    state::{Global as EarnGlobal, GLOBAL_SEED as EARN_GLOBAL_SEED},
    ID as EARN_PROGRAM,
};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = ANCHOR_DISCRIMINATOR_SIZE + ExtGlobal::INIT_SPACE,
        seeds = [EXT_GLOBAL_SEED],
        bump
    )]
    pub global_account: Account<'info, ExtGlobal>,

    #[account(
        mint::token_program = token_2022,
        address = m_earn_global_account.mint,
    )]
    pub m_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mint::token_program = token_2022,
        mint::decimals = m_mint.decimals,
        constraint = ext_mint.supply == 0 @ ExtError::InvalidMint,
    )]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Validated by the seeds, stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        bump
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    #[account(
        seeds = [EARN_GLOBAL_SEED],
        seeds::program = EARN_PROGRAM,
        bump = m_earn_global_account.bump,
    )]
    pub m_earn_global_account: Account<'info, EarnGlobal>,

    pub token_2022: Program<'info, Token2022>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, earn_authority: Pubkey) -> Result<()> {
    let m_vault_bump = Pubkey::find_program_address(&[M_VAULT_SEED], ctx.program_id).1;

    // Validate the ext_mint_authority PDA is the mint authority for the ext mint
    let ext_mint_authority = ctx.accounts.ext_mint_authority.key();
    if ctx.accounts.ext_mint.mint_authority.unwrap_or_default() != ext_mint_authority {
        return err!(ExtError::InvalidMint);
    }

    // Validate that the ext mint has the ScaledUiAmount extension and
    // that the ext mint authority is the extension authority
    let ext_mint_data = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(
        &ctx.accounts.ext_mint.to_account_info().try_borrow_data()?
    )?;
    let extensions = ext_mint_data.get_extension_types()?;

    if !extensions.contains(&ExtensionType::ScaledUiAmount) {
        return err!(ExtError::InvalidMint);
    }

    let scaled_ui_config = ext_mint_data
        .get_extension::<ScaledUiAmountConfig>()?;
    if scaled_ui_config.authority != ext_mint_authority {
        return err!(ExtError::InvalidMint);
    }
    
    // Sync the ScaledUiAmount multiplier with the M Index
    sync_multiplier(
        &ctx.accounts.ext_mint,
        &ctx.accounts.m_earn_global_account,
        &ctx.accounts.ext_mint_authority,
    &[&[
            MINT_AUTHORITY_SEED,
            &[ctx.bumps.ext_mint_authority],
        ]],
        &ctx.accounts.token_2022
    )?;

    // Initialize the ExtGlobal account
    ctx.accounts.global_account.set_inner(ExtGlobal {
        admin: ctx.accounts.admin.key(),
        ext_mint: ctx.accounts.ext_mint.key(),
        m_mint: ctx.accounts.m_mint.key(),
        m_earn_global_account: ctx.accounts.m_earn_global_account.key(),
        bump: ctx.bumps.global_account,
        m_vault_bump,
        ext_mint_authority_bump: ctx.bumps.ext_mint_authority,
    });

    Ok(())
}

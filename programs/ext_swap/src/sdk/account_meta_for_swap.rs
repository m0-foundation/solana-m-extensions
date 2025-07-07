use crate::{state::GLOBAL_SEED as EXT_SWAP_GLOBAL_SEED, ID};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::AccountMeta, pubkey::Pubkey};
use anchor_spl::{
    associated_token::{get_associated_token_address_with_program_id, AssociatedToken},
    token_interface::Token2022,
};
use earn::state::EARNER_SEED;
use m_ext::state::{EXT_GLOBAL_SEED as M_EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED};

pub const M_MINT_ID: Pubkey = pubkey!("mzerokyEX9TNDoK4o2YZQBDmMzjokAeN6M2g2S3pLJo"); // Hardcode for now, may need to set conditionally for devnet/mainnet

#[derive(Copy, Clone, Debug)]
pub struct MExtSwap {
    pub signer: Pubkey,
    pub wrap_authority: Option<Pubkey>,
    pub unwrap_authority: Option<Pubkey>,

    pub from_mint: Pubkey,
    pub to_mint: Pubkey,

    pub from_token_account: Pubkey,
    pub to_token_account: Pubkey,

    pub from_ext_program: Pubkey,
    pub to_ext_program: Pubkey,
}

impl From<MExtSwap> for Vec<AccountMeta> {
    fn from(accounts: MExtSwap) -> Self {
        // Derive accounts from seeds as applicable

        // Set token programs to token2022 for now
        let from_token_program: Pubkey = Token2022::id();
        let to_token_program: Pubkey = Token2022::id();
        let m_token_program: Pubkey = Token2022::id();

        // ext_swap PDAs
        let swap_global: Pubkey = Pubkey::find_program_address(&[EXT_SWAP_GLOBAL_SEED], &ID).0;

        // from m_ext PDAs
        let from_global: Pubkey =
            Pubkey::find_program_address(&[M_EXT_GLOBAL_SEED], &accounts.from_ext_program).0;
        let from_m_vault_auth: Pubkey =
            Pubkey::find_program_address(&[M_VAULT_SEED], &accounts.from_ext_program).0;
        let from_mint_authority: Pubkey =
            Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], &accounts.from_ext_program).0;

        // to m_ext PDAs
        let to_global: Pubkey =
            Pubkey::find_program_address(&[M_EXT_GLOBAL_SEED], &accounts.to_ext_program).0;
        let to_m_vault_auth: Pubkey =
            Pubkey::find_program_address(&[M_VAULT_SEED], &accounts.to_ext_program).0;
        let to_mint_authority: Pubkey =
            Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], &accounts.to_ext_program).0;

        // ATAs
        let from_m_vault: Pubkey = get_associated_token_address_with_program_id(
            &from_m_vault_auth,
            &M_MINT_ID,
            &m_token_program,
        );
        let to_m_vault: Pubkey = get_associated_token_address_with_program_id(
            &to_m_vault_auth,
            &M_MINT_ID,
            &m_token_program,
        );
        let intermediate_m_account: Pubkey = get_associated_token_address_with_program_id(
            &accounts.signer,
            &M_MINT_ID,
            &m_token_program,
        );

        // earn PDAs
        let from_m_earner: Pubkey =
            Pubkey::find_program_address(&[EARNER_SEED, from_m_vault.as_ref()], &earn::ID).0;
        let to_m_earner: Pubkey =
            Pubkey::find_program_address(&[EARNER_SEED, to_m_vault.as_ref()], &earn::ID).0;

        vec![
            AccountMeta::new_readonly(ID, false),
            AccountMeta::new(accounts.signer, true),
            if let Some(authority) = accounts.wrap_authority {
                AccountMeta::new(authority, true)
            } else {
                AccountMeta::new_readonly(ID, false)
            },
            if let Some(authority) = accounts.unwrap_authority {
                AccountMeta::new(authority, true)
            } else {
                AccountMeta::new_readonly(ID, false)
            },
            AccountMeta::new_readonly(swap_global, false),
            AccountMeta::new(from_global, false),
            AccountMeta::new(to_global, false),
            AccountMeta::new_readonly(from_m_earner, false),
            AccountMeta::new_readonly(to_m_earner, false),
            AccountMeta::new(accounts.from_mint, false),
            AccountMeta::new(accounts.to_mint, false),
            AccountMeta::new_readonly(M_MINT_ID, false),
            AccountMeta::new(accounts.from_token_account, false),
            AccountMeta::new(accounts.to_token_account, false),
            AccountMeta::new(intermediate_m_account, false),
            AccountMeta::new_readonly(from_m_vault_auth, false),
            AccountMeta::new_readonly(to_m_vault_auth, false),
            AccountMeta::new_readonly(from_mint_authority, false),
            AccountMeta::new_readonly(to_mint_authority, false),
            AccountMeta::new(from_m_vault, false),
            AccountMeta::new(to_m_vault, false),
            AccountMeta::new_readonly(from_token_program, false),
            AccountMeta::new_readonly(to_token_program, false),
            AccountMeta::new_readonly(m_token_program, false),
            AccountMeta::new_readonly(accounts.from_ext_program, false),
            AccountMeta::new_readonly(accounts.to_ext_program, false),
            AccountMeta::new_readonly(AssociatedToken::id(), false),
            AccountMeta::new_readonly(System::id(), false),
        ]
    }
}

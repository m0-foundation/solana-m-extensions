use crate::{state::GLOBAL_SEED as EXT_SWAP_GLOBAL_SEED, ID};
use anchor_lang::solana_program::{
    instruction::AccountMeta, pubkey::Pubkey, System::ID as SYSTEM_PROGRAM_ID,
};
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    associated_token_program::AssociatedTokenProgram::ID as ASSOCIATED_TOKEN_PROGRAM_ID,
};
use earn::state::EARNER_SEED;
use m_ext::state::{GLOBAL_SEED as M_EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED};

#[derive(Copy, Clone, Debug)]
pub struct MExtSwap {
    pub signer: Pubkey,
    pub wrap_authority: Option<Pubkey>,
    pub unwrap_authority: Option<Pubkey>,

    pub from_mint: Pubkey,
    pub to_mint: Pubkey,
    pub m_mint: Pubkey,

    pub from_token_account: Pubkey,
    pub to_token_account: Pubkey,

    // TODO could make these all just the token2022 program since they are for now
    pub from_token_program: Pubkey,
    pub to_token_program: Pubkey,
    pub m_token_program: Pubkey,

    pub from_ext_program: Pubkey,
    pub to_ext_program: Pubkey,
}

impl From<MExtSwap> for Vec<AccountMeta> {
    fn from(accounts: MExtSwap) -> Self {
        // Derive accounts from seeds as applicable

        // ext_swap PDAs
        const swap_global: Pubkey = Pubkey::find_program_address(&[GLOBAL_SEED], &ID).0;

        // from m_ext PDAs
        const from_global: Pubkey =
            Pubkey::find_program_address(&[M_EXT_GLOBAL_SEED], accounts.from_ext_program).0;
        const from_m_vault_auth: Pubkey =
            Pubkey::find_program_address(&[M_VAULT_SEED], &accounts.from_ext_program).0;
        const from_mint_authority: Pubkey =
            Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], &accounts.from_ext_program).0;

        // to m_ext PDAs
        const to_global: Pubkey =
            Pubkey::find_program_address(&[M_EXT_GLOBAL_SEED], accounts.to_ext_program).0;
        const to_m_vault_auth: Pubkey =
            Pubkey::find_program_address(&[M_VAULT_SEED], &accounts.to_ext_program).0;
        const to_mint_authority: Pubkey =
            Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], &accounts.to_ext_program).0;

        // ATAs
        const from_m_vault: Pubkey = get_associated_token_address_with_program_id(
            &accounts.from_m_vault_auth,
            &accounts.m_mint,
            &accounts.m_token_program,
        );
        const to_m_vault: Pubkey = get_associated_token_address_with_program_id(
            &accounts.to_m_vault_auth,
            &accounts.m_mint,
            &accounts.m_token_program,
        );
        const intermediate_m_account: Pubkey = get_associated_token_address_with_program_id(
            &accounts.signer,
            &accounts.m_mint,
            &accounts.m_token_program,
        );

        // earn PDAs
        const from_m_earner: Pubkey =
            Pubkey::find_program_address(&[EARNER_SEED, accounts.from_m_vault.as_ref()], &earn::ID)
                .0;
        const to_m_earner: Pubkey =
            Pubkey::find_program_address(&[EARNER_SEED, accounts.to_m_vault.as_ref()], &earn::ID).0;

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
            AccountMeta::new_readonly(accounts.m_mint, false),
            AccountMeta::new(accounts.from_token_account, false),
            AccountMeta::new(accounts.to_token_account, false),
            AccountMeta::new(intermediate_m_account, false),
            AccountMeta::new_readonly(from_m_vault_auth, false),
            AccountMeta::new_readonly(to_m_vault_auth, false),
            AccountMeta::new_readonly(from_mint_authority, false),
            AccountMeta::new_readonly(to_mint_authority, false),
            AccountMeta::new(from_m_vault, false),
            AccountMeta::new(to_m_vault, false),
            AccountMeta::new_readonly(accounts.from_token_program, false),
            AccountMeta::new_readonly(accounts.to_token_program, false),
            AccountMeta::new_readonly(accounts.m_token_program, false),
            AccountMeta::new_readonly(accounts.from_ext_program, false),
            AccountMeta::new_readonly(accounts.to_ext_program, false),
            AccountMeta::new_readonly(ASSOCIATED_TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ]
    }
}

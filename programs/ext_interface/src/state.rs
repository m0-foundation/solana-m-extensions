use anchor_lang::prelude::*;
use solana_program::pubkey::Pubkey;
use spl_tlv_account_resolution::account::ExtraAccountMeta as SplExtraAccountMeta;

// Programs that follow the M extension interface
static IDS: [Pubkey; 1] = [pubkey!("FokZWSbq8zq8W75imoTJte3HkS2C9U1CsT71BV9rRbQC")];

#[derive(Clone, InitSpace, AnchorSerialize, AnchorDeserialize)]
pub struct ExtraAccountMetas {
    pub mint: Pubkey,
    pub bump: u8,
    pub extra_accounts: [ExtraAccountMeta; 10],
}

impl anchor_lang::AccountDeserialize for ExtraAccountMetas {
    fn try_deserialize_unchecked(buf: &mut &[u8]) -> anchor_lang::Result<Self> {
        ExtraAccountMetas::try_from_slice(buf).map_err(Into::into)
    }
}

impl anchor_lang::AccountSerialize for ExtraAccountMetas {}

impl anchor_lang::Owners for ExtraAccountMetas {
    fn owners() -> &'static [Pubkey] {
        &IDS
    }
}

impl Into<SplExtraAccountMeta> for &ExtraAccountMeta {
    fn into(self) -> SplExtraAccountMeta {
        SplExtraAccountMeta {
            discriminator: self.discriminator,
            address_config: self.address_config,
            is_signer: self.is_signer.into(),
            is_writable: self.is_writable.into(),
        }
    }
}

#[derive(Clone, InitSpace, AnchorSerialize, AnchorDeserialize)]
pub struct ExtraAccountMeta {
    pub discriminator: u8,
    pub address_config: [u8; 32],
    pub is_signer: bool,
    pub is_writable: bool,
}

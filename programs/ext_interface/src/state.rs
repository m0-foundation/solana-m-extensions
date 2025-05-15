use solana_program::{program_error::ProgramError, pubkey::Pubkey};
use spl_pod::slice::PodSlice;
use spl_tlv_account_resolution::account::ExtraAccountMeta;

#[repr(C)]
pub struct ExtraAccountMetas {
    pub mint: Pubkey,
    pub bump: u8,
    pub extra_accounts: Vec<ExtraAccountMeta>,
}

impl ExtraAccountMetas {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        let (mint, rest) = input.split_at(32);
        let (bump, rest) = rest.split_at(1);

        let pod_slice = PodSlice::<ExtraAccountMeta>::unpack(rest)?;
        let extra_accounts = pod_slice.data().to_vec();

        Ok(Self {
            mint: Pubkey::new_from_array(mint.try_into().unwrap()),
            bump: bump[0],
            extra_accounts,
        })
    }
}

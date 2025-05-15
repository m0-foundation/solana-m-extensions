use anchor_lang::prelude::{
    borsh::{BorshDeserialize, BorshSerialize},
    *,
};

use crate::constants::INDEX_SCALE_U64;

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub struct CrankConfig {
    pub earn_authority: Pubkey,
    pub last_m_index: u64,
    pub last_ext_index: u64,
    pub last_timestamp: u64,
}

impl<'info> CrankConfig {
    pub fn sync(&mut self, m_earn_global_account: &Account<'info, EarnGlobal>) -> Result<()> {
        if self.last_m_index == m_earn_global_account.index {
            return Ok(());
        }

        let m_increase_factor = (m_earn_global_account.index as u128)
            .checked_mul(INDEX_SCALE_U64 as u128)
            .expect("m_earn_global_account * INDEX_SCALE overflow")
            .checked_div(self.last_m_index as u128)
            .expect("m_earn_global_account * INDEX_SCALE / last_m_index underflow");

        // No fee is applied to the index since it is taken from the rewards when yield is claimed
        // This is because earn managers have different fees and we need the flexibility
        let new_ext_index: u64 = (self.last_ext_index as u128)
            .checked_mul(m_increase_factor)
            .expect("last_ext_index * m_increase_factor overflow")
            .checked_div(INDEX_SCALE_U64 as u128)
            .expect("last_ext_index * m_increase_factor / INDEX_SCALE underflow")
            .try_into()
            .expect("conversion overflow");

        // Update the local data
        self.last_ext_index = new_ext_index;
        self.last_m_index = m_earn_global_account.index;
        self.last_timestamp = m_earn_global_account.timestamp;

        emit!(SyncIndexUpdate {
            ext_index: self.last_ext_index,
            m_index: self.last_m_index,
            ts: self.last_timestamp,
        });

        Ok(())
    }
}

#[event]
pub struct SyncIndexUpdate {
    pub ext_index: u64,
    pub m_index: u64,
    pub ts: u64,
}

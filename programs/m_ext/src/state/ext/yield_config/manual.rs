use anchor_lang::{
    prelude::{
        borsh::{BorshDeserialize, BorshSerialize},
        *,
    },
    solana_program,
};

use crate::{constants::INDEX_SCALE_U64, utils::merkle_proof};

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub struct ManualConfig {
    pub earn_authority: Pubkey,
    pub m_index: u64,
    pub ext_index: u64,
    pub timestamp: u64,
    pub manual_type: ManualType,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub enum ManualType {
    Crank,
    MerkleClaims(MerkleClaimsConfig),
}

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub struct MerkleClaimsConfig {
    pub merkle_root: [u8; 32],
    pub root_ext_index: u64,
    pub max_claimable_amount: u128, // currently, this value is cumulative to have an easy way to reference the total yield over time, it could be reduced each time the root is updated if desired, but as a u128 it would take a very long time to overflow
    pub claimed_amount: u128,       // same as above
}

impl<'info> ManualConfig {
    pub fn sync(&mut self, m_earn_global_account: &Account<'info, EarnGlobal>) -> Result<()> {
        if self.m_index == m_earn_global_account.index {
            return Ok(());
        }

        let m_increase_factor = (m_earn_global_account.index as u128)
            .checked_mul(INDEX_SCALE_U64 as u128)
            .expect("new_m_index * INDEX_SCALE overflow")
            .checked_div(self.m_index as u128)
            .expect("new_m_index * INDEX_SCALE / last_m_index underflow");

        // No fee is applied to the index since it is taken from the rewards when yield is claimed
        // This is because earn managers have different fees and we need the flexibility
        let new_ext_index: u64 = (self.ext_index as u128)
            .checked_mul(m_increase_factor)
            .expect("last_ext_index * m_increase_factor overflow")
            .checked_div(INDEX_SCALE_U64 as u128)
            .expect("last_ext_index * m_increase_factor / INDEX_SCALE underflow")
            .try_into()
            .expect("conversion overflow");

        // Update the local data
        self.ext_index = new_ext_index;
        self.m_index = m_earn_global_account.index;
        self.timestamp = m_earn_global_account.timestamp;

        // TODO make a more generic event that can be used for all syncs
        // emit!(SyncIndexUpdate {
        //     ext_index: self.ext_index,
        //     m_index: self.m_index,
        //     ts: self.timestamp,
        // });

        Ok(())
    }
}

// #[event]
// pub struct SyncIndexUpdate {
//     pub ext_index: u64,
//     pub m_index: u64,
//     pub ts: u64,
// }-

impl<'info> MerkleClaimsConfig {
    pub fn verify_proof(
        &self,
        user_token_account: Pubkey,
        total_user_amount: u128,
        proof: Vec<[u8; 32]>,
    ) -> bool {
        // Construct the leaf node from the provided values
        let leaf = keccak::hashv(&[
            &user_token_account.to_bytes(),
            &total_user_amount.to_le_bytes(),
        ])
        .to_bytes();

        // Verify the proof against the stored merkle root
        merkle_proof::verify(proof, self.merkle_root, &leaf)
    }
}

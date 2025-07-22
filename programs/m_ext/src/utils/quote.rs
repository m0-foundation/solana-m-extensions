use crate::{
    state::ExtGlobal,
    utils::conversion::{
        amount_to_principal_down, amount_to_principal_up, get_latest_multiplier_and_timestamp,
        principal_to_amount_down, principal_to_amount_up,
    },
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum Op {
    Wrap,
    Unwrap,
}

pub struct Quoter {
    cached_m_multiplier: f64,
    cached_ext_multiplier: f64,
}

impl<'info> Quoter {
    pub fn new(
        ext_global_account: &Account<'info, ExtGlobal>,
        m_mint: &InterfaceAccount<'info, Mint>,
    ) -> Self {
        let (m_multiplier, ext_multiplier, _) =
            get_latest_multiplier_and_timestamp(ext_global_account, m_mint)
                .expect("Failed to get latest multiplier");

        Self {
            cached_m_multiplier: m_multiplier,
            cached_ext_multiplier: ext_multiplier,
        }
    }

    pub fn new_from_cache(m_multiplier: f64, ext_multiplier: f64) -> Self {
        Self {
            cached_m_multiplier: m_multiplier,
            cached_ext_multiplier: ext_multiplier,
        }
    }

    pub fn quote(&self, operation: Op, principal: u64, exact_out: bool) -> Result<u64> {
        match operation {
            Op::Wrap => {
                if exact_out {
                    // Calculate the m principal in based on the ext principal out
                    amount_to_principal_up(
                        principal_to_amount_up(principal, self.cached_ext_multiplier)?,
                        self.cached_m_multiplier,
                    )
                } else {
                    // Calculate the ext principal out based on the m principal in
                    amount_to_principal_down(
                        principal_to_amount_down(principal, self.cached_m_multiplier)?,
                        self.cached_ext_multiplier,
                    )
                }
            }
            Op::Unwrap => {
                if exact_out {
                    // Calculate the ext principal in based on the m principal out
                    amount_to_principal_up(
                        principal_to_amount_up(principal, self.cached_m_multiplier)?,
                        self.cached_ext_multiplier,
                    )
                } else {
                    // Calculate the m principal out based on the ext principal in
                    amount_to_principal_down(
                        principal_to_amount_down(principal, self.cached_ext_multiplier)?,
                        self.cached_m_multiplier,
                    )
                }
            }
        }
    }
}

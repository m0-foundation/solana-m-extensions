use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use m_ext::cpi::accounts::{Unwrap, Wrap};

use crate::{
    errors::SwapError,
    state::{Config, CONFIG_SEED},
};

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = m_mint,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub from_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = m_mint,
        associated_token::authority = signer,
        associated_token::token_program = m_token_program,
    )]
    pub intermediate_m_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub to_token_account: InterfaceAccount<'info, TokenAccount>,

    pub from_ext_program: UncheckedAccount<'info>,

    pub to_ext_program: UncheckedAccount<'info>,

    pub m_mint: InterfaceAccount<'info, Mint>,

    pub m_token_program: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,
}

impl Swap<'_> {
    fn validate(&self) -> Result<()> {
        for ext_program in [&self.from_ext_program, &self.to_ext_program] {
            if !self.config.whitelisted_extensions.contains(ext_program.key) {
                return err!(SwapError::InvalidExtension);
            }
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>, amount: u64) -> Result<()> {
        let Swap {
            from_token_account,
            intermediate_m_account,
            to_token_account,
            ..
        } = ctx.accounts;

        let m_pre_balance = intermediate_m_account.amount;
        let to_pre_balance = to_token_account.amount;

        m_ext::cpi::unwrap(
            CpiContext::new(
                ctx.accounts.from_ext_program.to_account_info(),
                Unwrap {
                    signer: todo!(),
                    m_mint: todo!(),
                    ext_mint: todo!(),
                    global_account: todo!(),
                    m_earn_global_account: todo!(),
                    m_vault: todo!(),
                    ext_mint_authority: todo!(),
                    to_m_token_account: todo!(),
                    vault_m_token_account: todo!(),
                    from_ext_token_account: todo!(),
                    m_token_program: todo!(),
                    ext_token_program: todo!(),
                },
            ),
            amount,
        )?;

        // Reload M balance and wrap difference
        intermediate_m_account.reload()?;
        let m_delta = intermediate_m_account.amount - m_pre_balance;

        m_ext::cpi::wrap(
            CpiContext::new(
                ctx.accounts.from_ext_program.to_account_info(),
                Wrap {
                    signer: todo!(),
                    m_mint: todo!(),
                    ext_mint: todo!(),
                    global_account: todo!(),
                    m_earn_global_account: todo!(),
                    m_vault: todo!(),
                    ext_mint_authority: todo!(),
                    from_m_token_account: todo!(),
                    vault_m_token_account: todo!(),
                    to_ext_token_account: todo!(),
                    m_token_program: todo!(),
                    ext_token_program: todo!(),
                },
            ),
            m_delta,
        )?;

        // Reload and log amounts
        to_token_account.reload()?;
        let received_amount = to_token_account.amount - to_pre_balance;
        msg!("{} -> {} M -> {}", amount, m_delta, received_amount);

        Ok(())
    }
}

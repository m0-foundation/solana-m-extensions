use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    errors::SwapError,
    state::{ExtensionGroup, SwapGlobal, WhitelistedExtension, GLOBAL_SEED, GROUP_SEED},
};

#[derive(Accounts)]
pub struct WhitelistExt<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ SwapError::NotAuthorized,
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
        realloc = SwapGlobal::size(
            swap_global.whitelisted_unwrappers.len(),
            swap_global.whitelisted_extensions.len() + 1,
        ),
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub swap_global: Account<'info, SwapGlobal>,

    #[account(
        seeds = [GROUP_SEED, extension_group.name.as_ref()],
        bump,
    )]
    pub extension_group: Account<'info, ExtensionGroup>,

    pub system_program: Program<'info, System>,

    /// CHECK: This account is validated in the `validate` function
    pub ext_program: AccountInfo<'info>,

    #[account(mut)]
    pub ext_mint: InterfaceAccount<'info, Mint>,
}

impl WhitelistExt<'_> {
    fn validate(&self) -> Result<()> {
        // Check if the extension program is already whitelisted
        if self
            .swap_global
            .is_extension_whitelisted(self.ext_program.key)
        {
            return err!(SwapError::AlreadyWhitelisted);
        }

        // Check that the extension program is a valid program
        if !self.ext_program.executable {
            return err!(SwapError::InvalidExtension);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        ctx.accounts
            .swap_global
            .whitelisted_extensions
            .push(WhitelistedExtension {
                program_id: ctx.accounts.ext_program.key(),
                mint: ctx.accounts.ext_mint.key(),
                token_program: *ctx.accounts.ext_mint.to_account_info().owner,
                group_key: ctx.accounts.extension_group.key(),
            });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct WhitelistUnwrapper<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ SwapError::NotAuthorized,
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
        realloc = SwapGlobal::size(
            swap_global.whitelisted_unwrappers.len() + 1,
            swap_global.whitelisted_extensions.len() ,
        ),
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub swap_global: Account<'info, SwapGlobal>,

    pub system_program: Program<'info, System>,
}

impl WhitelistUnwrapper<'_> {
    fn validate(&self, authority: &Pubkey) -> Result<()> {
        if self.swap_global.whitelisted_unwrappers.contains(authority) {
            return err!(SwapError::AlreadyWhitelisted);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&authority))]
    pub fn handler(ctx: Context<Self>, authority: Pubkey) -> Result<()> {
        ctx.accounts
            .swap_global
            .whitelisted_unwrappers
            .push(authority);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct RemoveWhitelistedExt<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ SwapError::NotAuthorized,
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
    )]
    pub swap_global: Account<'info, SwapGlobal>,
}

impl RemoveWhitelistedExt<'_> {
    fn validate(&self, ext_program: &Pubkey) -> Result<()> {
        if !self.swap_global.is_extension_whitelisted(ext_program) {
            return err!(SwapError::InvalidExtension);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ext_program))]
    pub fn handler(ctx: Context<Self>, ext_program: Pubkey) -> Result<()> {
        ctx.accounts
            .swap_global
            .whitelisted_extensions
            .retain(|ext| !ext.program_id.eq(&ext_program));

        Ok(())
    }
}

#[derive(Accounts)]
pub struct RemoveWhitelistedUnwrapper<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ SwapError::NotAuthorized,
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
    )]
    pub swap_global: Account<'info, SwapGlobal>,
}

impl RemoveWhitelistedUnwrapper<'_> {
    fn validate(&self, authority: &Pubkey) -> Result<()> {
        if !self.swap_global.whitelisted_unwrappers.contains(authority) {
            return err!(SwapError::UnauthorizedUnwrapper);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&authority))]
    pub fn handler(ctx: Context<Self>, authority: Pubkey) -> Result<()> {
        ctx.accounts
            .swap_global
            .whitelisted_unwrappers
            .retain(|&x| !x.eq(&authority));

        Ok(())
    }
}

#[cfg(feature = "migrate")]
#[derive(Accounts)]
pub struct ResetWhitelists<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [GLOBAL_SEED],
        bump,
    )]
    /// CHECK: validating manually then resetting
    pub swap_global: AccountInfo<'info>,
}

#[cfg(feature = "migrate")]
impl ResetWhitelists<'_> {
    fn validate(&self) -> Result<()> {
        let data = self.swap_global.try_borrow_data()?;
        let admin = Pubkey::new_from_array(data[9..41].try_into().unwrap());

        if !admin.eq(self.admin.key) {
            return err!(SwapError::NotAuthorized);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        let mut data = ctx.accounts.swap_global.try_borrow_mut_data()?;

        // zero out whitelist data
        data[41..].fill(0);

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct CreateExtensionGroup<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        has_one = admin @ SwapError::NotAuthorized,
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
    )]
    pub swap_global: Account<'info, SwapGlobal>,

    #[account(
        init,
        seeds = [GROUP_SEED, &to_fixed_bytes::<16>(&name)],
        bump,
        space = ExtensionGroup::size(0),
        payer = admin,
    )]
    pub extension_group: Account<'info, ExtensionGroup>,

    pub system_program: Program<'info, System>,
}

impl CreateExtensionGroup<'_> {
    fn validate(&self, name: &String) -> Result<()> {
        if name.bytes().len() > 16 {
            return err!(SwapError::InvalidName);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&name))]
    pub fn handler(ctx: Context<Self>, name: String) -> Result<()> {
        let name_arr = to_fixed_bytes(&name);

        ctx.accounts.extension_group.set_inner(ExtensionGroup {
            name: name_arr,
            bridgeable_tokens: vec![],
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct AddGroupBridgeableToken<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        has_one = admin @ SwapError::NotAuthorized,
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
    )]
    pub swap_global: Account<'info, SwapGlobal>,

    #[account(
        mut,
        seeds = [GROUP_SEED, extension_group.name.as_ref()],
        bump,
        realloc = ExtensionGroup::size(extension_group.bridgeable_tokens.len() + 1),
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub extension_group: Account<'info, ExtensionGroup>,

    pub system_program: Program<'info, System>,
}

impl AddGroupBridgeableToken<'_> {
    fn validate(&self, token: &[u8; 32]) -> Result<()> {
        if self.extension_group.bridgeable_tokens.contains(token) {
            return err!(SwapError::BridgeDestinationAlreadyExists);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&token))]
    pub fn handler(ctx: Context<Self>, token: [u8; 32]) -> Result<()> {
        ctx.accounts.extension_group.bridgeable_tokens.push(token);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct RemoveGroupBridgeableToken<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        has_one = admin @ SwapError::NotAuthorized,
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
    )]
    pub swap_global: Account<'info, SwapGlobal>,

    #[account(
        mut,
        seeds = [GROUP_SEED, extension_group.name.as_ref()],
        bump,
        realloc = ExtensionGroup::size(extension_group.bridgeable_tokens.len() - 1),
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub extension_group: Account<'info, ExtensionGroup>,

    pub system_program: Program<'info, System>,
}

impl RemoveGroupBridgeableToken<'_> {
    fn validate(&self, token: &[u8; 32]) -> Result<()> {
        if !self.extension_group.bridgeable_tokens.contains(token) {
            return err!(SwapError::BridgeDestinationNotFound);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&token))]
    pub fn handler(ctx: Context<Self>, token: [u8; 32]) -> Result<()> {
        ctx.accounts
            .extension_group
            .bridgeable_tokens
            .retain(|d| d != &token);

        Ok(())
    }
}

fn to_fixed_bytes<const N: usize>(s: &str) -> [u8; N] {
    let mut arr = [0u8; N];
    let bytes = s.as_bytes();
    let len = bytes.len().min(N);
    arr[..len].copy_from_slice(&bytes[..len]);
    arr
}

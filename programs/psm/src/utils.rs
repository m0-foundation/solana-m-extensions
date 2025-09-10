use anchor_lang::{accounts::interface_account::InterfaceAccount, prelude::*};
use anchor_spl::token_interface::Mint;
use spl_token_2022::{
    extension::{self, BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state,
};

pub fn get_extensions<'info>(
    mint: &InterfaceAccount<'info, Mint>,
) -> Result<Vec<extension::ExtensionType>> {
    let account_info = mint.to_account_info();
    let mint_data = account_info.try_borrow_data()?;
    let mint_ext_data = StateWithExtensions::<state::Mint>::unpack(&mint_data)?;

    Ok(mint_ext_data.get_extension_types()?)
}

pub fn has_scaled_extension(mint: &InterfaceAccount<'_, Mint>) -> Result<bool> {
    let extensions = get_extensions(mint)?;

    Ok(extensions.contains(&ExtensionType::ScaledUiAmount)
        || extensions.contains(&ExtensionType::InterestBearingConfig))
}

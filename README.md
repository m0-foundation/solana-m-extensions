# Solana M Extension Programs

The `m_ext` program in this repository implements different versions of an [M0 Extension](https://docs.m0.org/home/technical-documentations/extensions/), which is a stablecoin backed by `$M`. The versions have a shared codebase for the majority of the code and use Rust feature flags to implement version-specific logic. The program relies on the underlying yield distribution of the `$M` token on Solana, which can be found in the [solana-m repository](https://github.com/m0-foundation/solana-m).

## Extensions

The list of implemented extensions are:

- NoYield - all yield goes to an admin, no yield is distributed to extension holders
- ScaledUi - yield is distributed to all extension holders using the Token2022 Scaled-UI "rebasing" functionality.
- Crank - yield is distributed to whitelisted earners accounts using a crank

Additional extension features will be developed as needed. You are welcome to implement custom features to suit the specific requirements of your extension. All extensions and their implementations must be approved by governance before they can begin earning.

## Swap Facility

The `ext_swap` program creates a router that allows users to convert between any M extension that follows the `wrap` and `unwrap` interfaces specified in the `m_ext` program. Extensions need to be whitelisted in this program to enable swapping.

## Creating your own extension

To create your own extension, start by forking this repository and updating the Program ID in `programs/m_ext/src/lib.rs`. Next, build it using one of the provided feature flags—or define your own—and deploy the program.

Before initializing your extension, you must set up its `vault_m_token_account`. Since `$M` is permissioned, your extension must be approved before this account can be created. Once approved, you can create the token account and get your extension whitelisted on the Swap Facility, granting your token full access to all liquidity across the M0 ecosystem.

To learn more, see our [docs](https://docs.m0.org/build/overview/) or [contact us](https://www.m0.org/contact-us)

## Setting up your extension on Devnet

Support coming soon

## FAQs

- **How does an extension earn yield?** All `$M` originates from ethereum mainnet and is bridged to other chains via a hub and spoke model. All bridges contain an index that indicates how much yield has accrued to `$M`. When Solana receives bridge messages it will use this index to update the scaled-ui multiplier on `$M`. This increases the value of `$M` is each extensions `vault_m_token_account` and they distribute yield depending on their own implemenations. [Learn more](https://docs.m0.org/home/overview/).

- **How do I get my extension approved?** It will need to be approved as an earner through governance. Once approved, it will be added to a earners merkle root and bridged to Solana. The Earn program willl then thaw the designated `vault_m_token_account` so you can initalize your extension. [Become an earner](https://docs.m0.org/build/gaining-earner-approval/guide/).

- **Where do I get liquidity on my token?** Extension can be swapped or bridged 1:1 with any other M0 extension on any chain. This gives your extension access to any liquidity pools other extensions might have.

- **What are the requirements on my Extension's mint?** Your mint can use the legacy token program or Token 2022. Your token must have a freeze authority and cannot have token extensions that impact transfers like transfer hooks or transfer tax. We may support transfer hooks in the future so let us know if you need it.

## Addresses

- [Earn Program](https://github.com/m0-foundation/solana-m/tree/main/programs/earn): [mz2vDzjbQDUDXBH6FPF5s4odCJ4y8YLE5QWaZ8XdZ9Z](https://solscan.io/account/mz2vDzjbQDUDXBH6FPF5s4odCJ4y8YLE5QWaZ8XdZ9Z)
- [Wormhole Portal](https://github.com/m0-foundation/solana-m/tree/main/programs/portal): [mzp1q2j5Hr1QuLC3KFBCAUz5aUckT6qyuZKZ3WJnMmY](https://solscan.io/account/mzp1q2j5Hr1QuLC3KFBCAUz5aUckT6qyuZKZ3WJnMmY)
- [wM Extension](https://github.com/m0-foundation/solana-m-extensions/blob/main/programs/m_ext/Cargo.toml#L22): [wMXX1K1nca5W4pZr1piETe78gcAVVrEFi9f4g46uXko](https://solscan.io/account/wMXX1K1nca5W4pZr1piETe78gcAVVrEFi9f4g46uXko)
- wM Mint: [mzeroXDoBpRVhnEXBra27qzAMdxgpWVY3DzQW7xMVJp](https://solscan.io/token/mzeroXDoBpRVhnEXBra27qzAMdxgpWVY3DzQW7xMVJp)

## Development

The Solana programs in this repository are built using Anchor. The required toolchain is specified in the Anchor.toml file. See `Makefile` for build and testing commands. See `package.json` for pnpm commands for the cli.

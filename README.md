# Solana M Extension Programs
The programs in this repository implement different version of an "M Extension", which is a stablecoin backed by M.

## Extensions
The list of implemented extensions is:
- ScaledUiAmount - yield is distributed to all extension token holders using the Token2022 ScaledUiAmount "rebasing" functionality.

## Development
The Solana programs in this repository are built using Anchor. The required toolchain is specified in the Anchor.toml file.

Use [`agave-install`](https://docs.anza.xyz/cli/install) to install and initialize the correct Solana CLI & runtime (`2.1.0`).

Then, use [`avm`](https://www.anchor-lang.com/docs/installation) to install and initialize the correct Anchor CLI (`0.31.1`).

Finally, the tests are written in Typescript using the LiteSVM framework. The javascript package manager is `yarn`. Install the required dependencies with `yarn install`.

The programs can then be built with: `anchor build`

The tests can be run with `yarn test`. If editing programs between test runs, be sure to recompile as the test runner doesn't do so automatically, i.e. `anchor build && yarn test`.
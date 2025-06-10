# Solana M Extension Programs

The program (`m_ext`) in this repository implements different versions of an "M Extension", which is a stablecoin backed by $M. The versions have a shared codebase for the majority of the code and use Rust feature flags to implement version-specific logic. The program relies on the underlying yield distribution of the $M token on Solana, which can be found in the [solana-m repository](https://github.com/m0-foundation/solana-m).

## Extensions

The list of implemented extensions is:

- NoYield - no yield is distributed to extension holders.
- ScaledUiAmount - yield is distributed to all extension token holders using the Token2022 ScaledUiAmount "rebasing" functionality.

## Development

The Solana programs in this repository are built using Anchor. The required toolchain is specified in the Anchor.toml file.

Use [`agave-install`](https://docs.anza.xyz/cli/install) to install and initialize the correct Solana CLI & runtime (`2.1.0`).

Then, use [`avm`](https://www.anchor-lang.com/docs/installation) to install and initialize the correct Anchor CLI (`0.31.1`).

Finally, the tests are written in Typescript using the LiteSVM framework. The javascript package manager is `yarn`. Install the required dependencies with `yarn install`.

The programs can then be built with: `make build-programs`. This will compile each variant of the `m_ext` program and save the bytecode plus the IDL in the target folder with the name of the extension. Yield features are not compatible with each other and only one can be selected.

The tests can be run with `make test-programs`. If editing programs between test runs, be sure to recompile as the test runner doesn't do so automatically, i.e. `make build-programs && make test-programs`.

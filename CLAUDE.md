# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository implements M0 Extension programs for Solana - stablecoins backed by $M token. The programs are built using Anchor framework and use Rust feature flags to implement different yield distribution variants from a shared codebase.

## Build Commands

```bash
# Build all program variants
make build-programs
# or
pnpm build

# Build test programs (for local testing)
make build-test-programs
```

## Testing

```bash
# Run all tests (TypeScript + Rust)
pnpm test
# or
make test-programs

# Run TypeScript tests only
pnpm jest --preset ts-jest --verbose tests/unit/**.test.ts

# Run Rust tests only
cargo test

# Run a single test file
pnpm jest --preset ts-jest tests/unit/m_ext.test.ts
pnpm jest --preset ts-jest tests/unit/ext_swap.test.ts
```

## Linting

```bash
pnpm lint        # Check formatting
pnpm lint:fix    # Fix formatting
cargo fmt        # Format Rust code
```

## Architecture

### Programs

**m_ext** (`programs/m_ext/`) - The main extension program with yield distribution variants selected via feature flags:
- `no-yield` (default) - All yield goes to admin
- `scaled-ui` - Yield distributed via Token2022 scaled-UI rebasing
- `crank` - Yield distributed via manual crank mechanism with earn managers and earners

**ext_swap** (`programs/ext_swap/`) - Router for swapping between M extensions that follow the wrap/unwrap interface. Extensions must be whitelisted to enable swapping.

### Feature Flag System

Only one yield distribution feature can be enabled at a time. The build system produces separate artifacts:
- `scaled_ui.so` / `scaled_ui.json`
- `no_yield.so` / `no_yield.json`
- `crank.so` / `crank.json`

Special combinations:
- `migrate` - Adds migration instruction for V1 upgrades
- `wm` - Combines `crank` + `migrate` for wM extension

### Key State Structures

`ExtGlobalV2` - Main global state account containing:
- Admin and pending admin (two-step transfer)
- Extension mint and M mint addresses
- M earn global account reference
- YieldConfig (variant-specific: fee_bps for scaled-ui, earn_authority for crank)
- Wrap authorities list

### Instruction Flow

1. `initialize` - Create extension with mint, vault, and wrap authorities
2. `wrap` - Convert M tokens to extension tokens (requires wrap authority)
3. `unwrap` - Convert extension tokens back to M tokens (requires wrap authority)
4. `sync` - Update yield indices (scaled-ui and crank variants)
5. `claim_fees` - Admin claims accumulated fees

### CLI Service

Located at `services/cli/` - TypeScript CLI for deployment and management operations. Requires 1Password for secrets:
```bash
pnpm cli:dev   # Development environment
pnpm cli:prod  # Production environment
```

## Toolchain Requirements

- Anchor CLI: 0.31.1 (via avm)
- Solana CLI: 2.1.0
- pnpm for package management

## Testing Infrastructure

Tests use `litesvm` and `anchor-litesvm` for local Solana program testing. Test utilities are in `tests/test-utils.ts` and `tests/unit/ext_test_harness.ts`.

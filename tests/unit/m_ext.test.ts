import { BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createMintToCheckedInstruction,
  getMint,
} from "@solana/spl-token";
import { randomInt } from "crypto";

import { Comparison, ExtensionTest, Variant } from "./ext_test_harness";
import { padKeyArray } from "../test-utils";

// Unit tests for ext earn program

// Start parameters for M Earn
const initialSupply = new BN(100_000_000); // 100 tokens with 6 decimals
const initialIndex = new BN(1_100_000_000_000); // 1.1
const claimCooldown = new BN(0); // None

const VARIANTS: Variant[] = [Variant.ScaledUiAmount, Variant.NoYield];

// Implement test cases for all variants
// Most are the same, but allows conditional tests when required for different variants
for (const variant of VARIANTS) {
  let $: ExtensionTest<Variant>;

  describe(`${variant} unit tests`, () => {
    beforeEach(async () => {
      // Create new extenstion test harness and then initialize it
      $ = new ExtensionTest(variant, []);
      await $.init(initialSupply, initialIndex, claimCooldown);
    });

    describe("admin instruction tests", () => {
      describe("initialize unit tests", () => {
        // general test cases
        // [X] given the m_mint is not owned by the token2022 program
        //   [X] it reverts with a ConstraintAddress error
        // [X] given the ext_mint is not owned by the token2022 program
        //   [X] it reverts with a ConstraintMintTokenProgram error
        // [X] given the ext_mint decimals do not match the m_mint decimals
        //   [X] it reverts with a ConstraintMintDecimals error
        // [X] given the M earn global account does not match the PDA on the earn program
        //   [X] it reverts with a SeedsConstraint error
        // [X] given the m_earner_account is not the required PDA
        //   [X] it reverts with a SeedsConstraint error
        // [X] given the ext_mint_authority is not the required PDA
        //   [X] it reverts with a SeedsConstraint error
        // [X] given the ext_mint does not have a freeze authority
        //   [X] it reverts with a InvalidMint error
        // [X] given the wrap authorities are not unique
        //   [X] it reverts with an InvalidParam error

        // given the m_mint is not owned by the token2022 program
        // it reverts with a ConstraintAddress error -> actually get AccountNotInitialized error before this
        test("m_mint not owned by token2022 - reverts", async () => {
          // Create a mint owned by a different program
          const wrongMint = new Keypair();
          await $.createMint(wrongMint, $.nonAdmin.publicKey, false);

          // Create/get the m vault ATA for the wrong mint to avoid account not initialized error
          const vaultMTokenAccount = await $.getATA(
            wrongMint.publicKey,
            $.getMVault(),
            false
          );

          // Attempt to send the transaction
          // We get an AccountNotInitialized error here because it's impossible to create
          // a m earner account that matches the vaultATA for the wrong mint
          await $.expectAnchorError(
            (variant === Variant.NoYield
              ? $.ext.methods.initialize([])
              : $.ext.methods.initialize([], new BN(0))
            )
              .accountsPartial({
                admin: $.nonAdmin.publicKey,
                mMint: wrongMint.publicKey,
                extMint: $.extMint.publicKey,
                vaultMTokenAccount,
              })
              .signers([$.nonAdmin])
              .rpc(),
            "AccountNotInitialized"
          );
        });

        // given the ext_mint is not owned by the token2022 program
        // it reverts with a ConstraintMintTokenProgram error
        test("ext_mint not owned by token2022 - reverts", async () => {
          // Create a mint owned by a different program
          const wrongMint = new Keypair();
          await $.createMint(wrongMint, $.nonAdmin.publicKey, false);

          // Attempt to send the transaction
          await $.expectAnchorError(
            (variant === Variant.NoYield
              ? $.ext.methods.initialize([])
              : $.ext.methods.initialize([], new BN(0))
            )
              .accounts({
                admin: $.nonAdmin.publicKey,
                mMint: $.mMint.publicKey,
                extMint: wrongMint.publicKey,
              })
              .signers([$.nonAdmin])
              .rpc(),
            "ConstraintMintTokenProgram"
          );
        });

        // given the decimals on ext_mint do not match M
        // it reverts with a MintDecimals error
        test("ext_mint incorrect decimals - reverts", async () => {
          // Create a mint owned by a different program
          const badMint = new Keypair();
          await $.createMint(badMint, $.nonAdmin.publicKey, true, 9);

          // Attempt to send the transaction
          await $.expectAnchorError(
            (variant === Variant.NoYield
              ? $.ext.methods.initialize([])
              : $.ext.methods.initialize([], new BN(0))
            )
              .accounts({
                admin: $.nonAdmin.publicKey,
                mMint: $.mMint.publicKey,
                extMint: badMint.publicKey,
              })
              .signers([$.nonAdmin])
              .rpc(),
            "ConstraintMintDecimals"
          );
        });

        // given the M earn global account is invalid
        // it reverts with a seeds constraint (or other account error)
        test("m_earn_global_account is incorrect - reverts", async () => {
          // Change the m earn global account
          const mEarnGlobalAccount = PublicKey.unique();
          if (mEarnGlobalAccount == $.getEarnGlobalAccount()) return;

          // Attempt to send transaction
          // Expect error (could be one of several "SeedsConstraint", "AccountOwnedByWrongProgram", "AccountNotInitialized")
          await $.expectSystemError(
            (variant === Variant.NoYield
              ? $.ext.methods.initialize([])
              : $.ext.methods.initialize([], new BN(0))
            )
              .accountsPartial({
                admin: $.nonAdmin.publicKey,
                mMint: $.mMint.publicKey,
                extMint: $.extMint.publicKey,
                mEarnGlobalAccount: mEarnGlobalAccount,
              })
              .signers([$.nonAdmin])
              .rpc()
          );
        });

        // given the m_earner_account is not the required PDA
        // it reverts with a seeds constraint (or other account error)
        test("m_earner_account is incorrect - reverts", async () => {
          // Change the m earner account
          const mEarnerAccount = PublicKey.unique();
          if (
            mEarnerAccount.equals(
              $.getMEarnerAccount(
                await $.getATA($.mMint.publicKey, $.getMVault())
              )
            )
          )
            return;

          // Attempt to send transaction
          // Expect error (could be one of several "SeedsConstraint", "AccountOwnedByWrongProgram", "AccountNotInitialized")
          await $.expectSystemError(
            (variant === Variant.NoYield
              ? $.ext.methods.initialize([])
              : $.ext.methods.initialize([], new BN(0))
            )
              .accountsPartial({
                admin: $.nonAdmin.publicKey,
                mMint: $.mMint.publicKey,
                extMint: $.extMint.publicKey,
                mEarnerAccount: mEarnerAccount,
              })
              .signers([$.nonAdmin])
              .rpc()
          );
        });

        // given ext_mint_authority is not required PDA
        // it reverts with a seeds constraint
        test("ext_mint_authority is incorrect - reverts", async () => {
          // Change the ext mint authority
          const extMintAuthority = PublicKey.unique();
          if (extMintAuthority == $.getExtMintAuthority()) return;

          // Attempt to send transaction
          // Expect error (could be one of several "SeedsConstraint", "AccountOwnedByWrongProgram", "AccountNotInitialized")
          await $.expectSystemError(
            (variant === Variant.NoYield
              ? $.ext.methods.initialize([])
              : $.ext.methods.initialize([], new BN(0))
            )
              .accountsPartial({
                admin: $.nonAdmin.publicKey,
                mMint: $.mMint.publicKey,
                extMint: $.extMint.publicKey,
                extMintAuthority: extMintAuthority,
              })
              .signers([$.nonAdmin])
              .rpc()
          );
        });

        // given the ext_mint does not have a freeze authority
        // it reverts with a InvalidMint error
        test("ext_mint does not have a freeze authority - reverts", async () => {
          // Create a mint without a freeze authority
          const wrongMint = new Keypair();
          await $.createMint(wrongMint, $.nonAdmin.publicKey, true, 6, false);

          // Attempt to send the transaction
          await $.expectAnchorError(
            (variant === Variant.NoYield
              ? $.ext.methods.initialize([])
              : $.ext.methods.initialize([], new BN(0))
            )
              .accounts({
                admin: $.nonAdmin.publicKey,
                mMint: $.mMint.publicKey,
                extMint: wrongMint.publicKey,
              })
              .signers([$.nonAdmin])
              .rpc(),
            "InvalidMint"
          );
        });

        // given wrap authorities includes a duplicate, non-default public key
        // it reverts with an InvalidParam error
        test("wrap authorities includes a duplicate public key - reverts", async () => {
          // Change the wrap authorities
          const wrapAuthorities: PublicKey[] = $.createUniqueKeyArray(10);
          wrapAuthorities[0] = wrapAuthorities[1];

          // Attempt to send transaction
          await $.expectAnchorError(
            (variant === Variant.NoYield
              ? $.ext.methods.initialize(wrapAuthorities)
              : $.ext.methods.initialize(wrapAuthorities, new BN(0))
            )
              .accounts({
                admin: $.nonAdmin.publicKey,
                mMint: $.mMint.publicKey,
                extMint: $.extMint.publicKey,
              })
              .signers([$.nonAdmin])
              .rpc(),
            "InvalidParam"
          );
        });

        // no yield test cases
        // [X] given all accounts and params are correct
        //   [X] the global account is created
        //   [X] the admin is set to the signer
        //   [X] the m_mint is set correctly
        //   [X] the ext_mint is set correctly
        //   [X] the m_earn_global_account is set correctly
        //   [X] the bumps are set correctly
        //   [X] the wrap authorities are set correctly

        if (variant === Variant.NoYield) {
          // given accounts and params are correct
          // it creates the global account
          // it sets the admin to the signer
          // it sets the m_mint to the provided mint
          // it sets the ext_mint to the provided mint
          // it sets the m_earn_global_account to the provided account
          // it sets the scaled ui amount multiplier and timestamp to the values on the m earner account
          // it sets the bumps to the correct values
          test("initialize - success", async () => {
            // Get a random number of wrap authorities
            // We use the padded array to check the stored state after the call
            const numWrapAuthorities = randomInt(10);
            const wrapAuthorities: PublicKey[] =
              $.createUniqueKeyArray(numWrapAuthorities);

            // Derive PDA bumps
            const [, bump] = PublicKey.findProgramAddressSync(
              [Buffer.from("global")],
              $.ext.programId
            );
            const [, mVaultBump] = PublicKey.findProgramAddressSync(
              [Buffer.from("m_vault")],
              $.ext.programId
            );
            const [, extMintAuthorityBump] = PublicKey.findProgramAddressSync(
              [Buffer.from("mint_authority")],
              $.ext.programId
            );

            // Ensure the global account has not been created yet
            const globalAccount = $.getExtGlobalAccount();
            $.expectAccountEmpty(globalAccount);

            // Send the transaction
            await $.ext.methods
              .initialize(wrapAuthorities)
              .accounts({
                admin: $.admin.publicKey,
                mMint: $.mMint.publicKey,
                extMint: $.extMint.publicKey,
              })
              .signers([$.admin])
              .rpc();

            // Check the state of the global account
            await $.expectExtGlobalState({
              admin: $.admin.publicKey,
              extMint: $.extMint.publicKey,
              mMint: $.mMint.publicKey,
              mEarnGlobalAccount: $.getEarnGlobalAccount(),
              bump,
              mVaultBump,
              extMintAuthorityBump,
              yieldConfig: {},
              wrapAuthorities,
            });

            // Confirm the size of the global account based on the number of wrap authorities
            const expectedSize = 143 + wrapAuthorities.length * 32; // 143 bytes base size + 4 bytes for vector length + 32 bytes per wrap authority
            const extGlobalSize = await $.provider.connection
              .getAccountInfo(globalAccount)
              .then((info) => info?.data.length || 0);
            expect(extGlobalSize).toEqual(expectedSize);
          });
        }

        // scaled ui test cases
        // [X] given the ext_mint does not have the scaled ui amount extension
        //   [X] it reverts with a InvalidMint error
        // [X] given the ext_mint has the scaled ui amount extension, but the authority is not the mint authority PDA
        //   [X] it reverts with an InvalidMint error
        // [X] given all accounts and params are correct
        //   [X] the global account is created
        //   [X] the admin is set to the signer
        //   [X] the m_mint is set correctly
        //   [X] the ext_mint is set correctly
        //   [X] the m_earn_global_account is set correctly
        //   [X] the bumps are set correctly
        //   [X] the wrap authorities are set correctly
        //   [X] the multiplier on the ext mint is initialized to m index
        //   [X] the timestamp on the ext mint is set to the m timestamp

        if (variant === Variant.ScaledUiAmount) {
          // given the ext_mint does not have the scaled ui amount extension
          // it reverts with a InvalidMint error
          test("ext_mint does not have the scaled ui amount extension - reverts", async () => {
            // Create a mint without the scaled ui amount extension
            const wrongMint = new Keypair();
            await $.createMint(wrongMint, $.getExtMintAuthority(), true, 6); // valid otherwise

            // Attempt to send the transaction
            await $.expectAnchorError(
              $.ext.methods
                .initialize([], new BN(0))
                .accounts({
                  admin: $.nonAdmin.publicKey,
                  mMint: $.mMint.publicKey,
                  extMint: wrongMint.publicKey,
                })
                .signers([$.nonAdmin])
                .rpc(),
              "InvalidMint"
            );
          });

          // given the ext_mint has the scaled ui amount extension, but the authority is not the mint authority PDA
          // it reverts with an InvalidMint error
          test("ext_mint has the scaled ui amount extension, but the authority is not the mint authority PDA - reverts", async () => {
            // Create a mint with the scaled ui amount extension
            const wrongMint = new Keypair();
            await $.createScaledUiMint(wrongMint, $.nonAdmin.publicKey, 6);

            // Attempt to send the transaction
            await $.expectAnchorError(
              $.ext.methods
                .initialize([], new BN(0))
                .accounts({
                  admin: $.nonAdmin.publicKey,
                  mMint: $.mMint.publicKey,
                  extMint: wrongMint.publicKey,
                })
                .signers([$.nonAdmin])
                .rpc(),
              "InvalidMint"
            );
          });

          // given accounts and params are correct
          // it creates the global account
          // it sets the admin to the signer
          // it sets the m_mint to the provided mint
          // it sets the ext_mint to the provided mint
          // it sets the m_earn_global_account to the provided account
          // it sets the scalued ui amount multiplier and timestamp to the values on the m earn global account
          // it sets the bumps to the correct values
          test("initialize - success", async () => {
            // Get a random number of wrap authorities
            // We use the padded array to check the stored state after the call
            const numWrapAuthorities = randomInt(10);
            const wrapAuthorities: PublicKey[] =
              $.createUniqueKeyArray(numWrapAuthorities);

            // Derive PDA bumps
            const [, bump] = PublicKey.findProgramAddressSync(
              [Buffer.from("global")],
              $.ext.programId
            );
            const [, mVaultBump] = PublicKey.findProgramAddressSync(
              [Buffer.from("m_vault")],
              $.ext.programId
            );
            const [, extMintAuthorityBump] = PublicKey.findProgramAddressSync(
              [Buffer.from("mint_authority")],
              $.ext.programId
            );

            // Ensure the global account has not been created yet
            const globalAccount = $.getExtGlobalAccount();
            $.expectAccountEmpty(globalAccount);

            // Get a random fee bps
            const feeBps = new BN(randomInt(10000));

            // Send the transaction
            await $.ext.methods
              .initialize(wrapAuthorities, feeBps)
              .accounts({
                admin: $.admin.publicKey,
                mMint: $.mMint.publicKey,
                extMint: $.extMint.publicKey,
              })
              .signers([$.admin])
              .rpc();

            // Check the state of the global account
            await $.expectExtGlobalState({
              admin: $.admin.publicKey,
              extMint: $.extMint.publicKey,
              mMint: $.mMint.publicKey,
              mEarnGlobalAccount: $.getEarnGlobalAccount(),
              bump,
              mVaultBump,
              extMintAuthorityBump,
              wrapAuthorities,
              yieldConfig: {
                feeBps,
                lastMIndex: initialIndex,
                lastExtIndex: new BN(1e12),
              },
            });

            // Check the size of the global account based on the number of wrap authorities
            const expectedSize = 143 + 24 + wrapAuthorities.length * 32; // 143 bytes base size + 24 yield config size + 32 bytes per wrap authority
            const extGlobalSize = await $.provider.connection
              .getAccountInfo(globalAccount)
              .then((info) => info?.data.length || 0);
            expect(extGlobalSize).toEqual(expectedSize);

            // Check the state of the mint
            await $.expectScaledUiAmountConfig($.extMint.publicKey, {
              authority: $.getExtMintAuthority(),
              multiplier: 1.0,
              newMultiplierEffectiveTimestamp: BigInt(
                $.currentTime().toString()
              ),
              newMultiplier: 1.0,
            });
          });
        }
      });

      describe("add_wrap_authority unit tests", () => {
        let wrapAuthorities: PublicKey[];

        beforeEach(async () => {
          wrapAuthorities = [$.admin.publicKey, $.wrapAuthority.publicKey];

          const feeBps =
            variant === Variant.NoYield ? new BN(0) : new BN(randomInt(10000));
          // Initialize the extension program
          await $.initializeExt(wrapAuthorities, feeBps);
        });

        // test cases
        // [X] given the admin does not sign the transaction
        //   [X] it reverts with a NotAuthorized error
        // [X] given the admin signs the transaction
        //   [X] given the new wrap authority is already in the list
        //     [X] it reverts with a InvalidParam error
        //   [X] given the new wrap authority is not in the list
        //     [X] it adds the new wrap authority to the list
        //     [X] it resizes the ext global account to accommodate the new wrap authority

        // given the admin does not sign the transaction
        // it reverts with a NotAuthorized error
        test("admin does not sign - reverts", async () => {
          // Attempt to send the transaction
          await $.expectAnchorError(
            $.ext.methods
              .addWrapAuthority($.nonWrapAuthority.publicKey)
              .accounts({
                admin: $.nonAdmin.publicKey,
              })
              .signers([$.nonAdmin])
              .rpc(),
            "NotAuthorized"
          );
        });

        // given the admin signs the transaction
        // given the new wrap authority is already in the list
        // it reverts with a InvalidParam error
        test("new wrap authority already in the list - reverts", async () => {
          // Attempt to send the transaction
          await $.expectAnchorError(
            $.ext.methods
              .addWrapAuthority($.wrapAuthority.publicKey)
              .accounts({ admin: $.admin.publicKey })
              .signers([$.admin])
              .rpc(),
            "InvalidParam"
          );
        });

        // given the admin signs the transaction
        // given the new wrap authority is not in the list
        // it adds the new wrap authority to the list
        // it resizes the ext global account to accommodate the new wrap authority
        test("new wrap authority is not in the list - success", async () => {
          // Cache the size of the ext global account
          const extGlobalAccount = $.getExtGlobalAccount();
          const extGlobalSize = await $.provider.connection
            .getAccountInfo(extGlobalAccount)
            .then((info) => info?.data.length || 0);

          // Send the transaction
          await $.ext.methods
            .addWrapAuthority($.nonWrapAuthority.publicKey)
            .accounts({
              admin: $.admin.publicKey,
            })
            .signers([$.admin])
            .rpc();

          // Check that the wrap authority was added
          wrapAuthorities.push($.nonWrapAuthority.publicKey);

          await $.expectExtGlobalState({
            wrapAuthorities,
          });

          // Check that the ext global account was resized
          const newExtGlobalSize = await $.provider.connection
            .getAccountInfo(extGlobalAccount)
            .then((info) => info?.data.length || 0);
          expect(newExtGlobalSize).toEqual(extGlobalSize + 32); // 32 bytes for the new wrap authority
        });
      });

      describe("remove_wrap_authority unit tests", () => {
        let wrapAuthorities: PublicKey[];

        beforeEach(async () => {
          wrapAuthorities = [$.admin.publicKey, $.wrapAuthority.publicKey];

          const feeBps =
            variant === Variant.NoYield ? new BN(0) : new BN(randomInt(10000));
          // Initialize the extension program
          await $.initializeExt(wrapAuthorities, feeBps);
        });

        // test cases
        // [X] given the admin does not sign the transaction
        //   [X] it reverts with a NotAuthorized error
        // [X] given the admin signs the transaction
        //   [X] given the wrap authority is not in the list
        //     [X] it reverts with a InvalidParam error
        //   [X] given the wrap authority is in the list
        //     [X] it removes the wrap authority from the list
        //     [X] it resizes the ext global account down to accommodate the removed wrap authority

        // given the admin does not sign the transaction
        // it reverts with a NotAuthorized error
        test("admin does not sign - reverts", async () => {
          // Attempt to send the transaction
          await $.expectAnchorError(
            $.ext.methods
              .removeWrapAuthority($.wrapAuthority.publicKey)
              .accounts({
                admin: $.nonAdmin.publicKey,
              })
              .signers([$.nonAdmin])
              .rpc(),
            "NotAuthorized"
          );
        });

        // given the admin signs the transaction
        // given the wrap authority is not in the list
        // it reverts with a InvalidParam error
        test("wrap authority not in the list - reverts", async () => {
          // Attempt to send the transaction
          await $.expectAnchorError(
            $.ext.methods
              .removeWrapAuthority($.nonWrapAuthority.publicKey)
              .accounts({ admin: $.admin.publicKey })
              .signers([$.admin])
              .rpc(),
            "InvalidParam"
          );
        });

        // given the admin signs the transaction
        // given the wrap authority is in the list
        // it removes the wrap authority from the list
        // it resizes the ext global account down to accommodate the removed wrap authority
        test("wrap authority is in the list - success", async () => {
          // Cache the size of the ext global account
          const extGlobalAccount = $.getExtGlobalAccount();
          const extGlobalSize = await $.provider.connection
            .getAccountInfo(extGlobalAccount)
            .then((info) => info?.data.length || 0);

          // Send the transaction
          await $.ext.methods
            .removeWrapAuthority($.wrapAuthority.publicKey)
            .accounts({
              admin: $.admin.publicKey,
            })
            .signers([$.admin])
            .rpc();

          // Check that the wrap authority was added
          wrapAuthorities.pop();

          await $.expectExtGlobalState({
            wrapAuthorities,
          });

          // Check that the ext global account was resized
          const newExtGlobalSize = await $.provider.connection
            .getAccountInfo(extGlobalAccount)
            .then((info) => info?.data.length || 0);
          expect(newExtGlobalSize).toEqual(extGlobalSize - 32); // remove 32 bytes
        });
      });

      describe("claim_fees unit tests", () => {
        // general test cases
        // [X] given the admin does not sign the transaction
        //   [X] it reverts with a NotAuthorized error
        // [X] given the admin signs the transaction
        //   [X] given the m vault is not the m vault PDA
        //     [X] it reverts with a ConstraintSeeds error
        //   [X] given the m vault token account is not the m vault PDA's ATA
        //     [X] it reverts with a ConstraintAssociated error
        //   [X] given the ext mint does not match the one on the global account
        //     [X] it reverts with an InvalidMint error
        //   [X] given the ext mint authority is not the ext mint authority PDA
        //     [X] it reverts with a ConstraintSeeds error
        //   [X] given the m earn global account does not match the derived PDA
        //     [X] it reverts with a ConstraintSeeds error
        //   [X] given the recipient token account is not a token account for the m mint
        //     [X] it reverts with a ConstraintTokenMint error

        const initialWrappedAmount = new BN(10_000_000); // 10 with 6 decimals
        let wrapAuthorities: PublicKey[];
        const feeBps = new BN(randomInt(1, 10000)); // non-zero
        const startIndex = new BN(randomInt(initialIndex.toNumber() + 1, 2e12));

        beforeEach(async () => {
          wrapAuthorities = [$.admin.publicKey, $.wrapAuthority.publicKey];
          // Initialize the extension program
          await $.initializeExt(wrapAuthorities, feeBps);

          // Wrap some tokens from the admin to make the m vault's balance non-zero
          await $.wrap($.admin, initialWrappedAmount);

          // Propagate the start index
          await $.propagateIndex(startIndex);

          // Claim yield for the m vault and complete the claim cycle
          const mVault = $.getMVault();
          const mVaultATA = await $.getATA($.mMint.publicKey, mVault);
          await $.mClaimFor(mVault, await $.getTokenBalance(mVaultATA));
          await $.mCompleteClaims();

          if (variant !== Variant.NoYield) {
            // Sync the multiplier
            await $.sync();
          }
          // Reset the blockhash to avoid issues with duplicate transactions
          $.svm.expireBlockhash();
        });

        // given the admin does not sign the transaction
        // it reverts with a NotAuthorized error
        test("admin does not sign - reverts", async () => {
          const recipientExtTokenAccount = await $.getATA(
            $.extMint.publicKey,
            $.nonAdmin.publicKey
          );

          // Attempt to send the transaction
          await $.expectAnchorError(
            $.ext.methods
              .claimFees()
              .accountsPartial({
                admin: $.nonAdmin.publicKey,
                recipientExtTokenAccount,
              })
              .signers([$.nonAdmin])
              .rpc(),
            "NotAuthorized"
          );
        });

        // given the m vault is not the m vault PDA
        // it reverts with a ConstraintSeeds error
        test("m vault is not the m vault PDA - reverts", async () => {
          // Change the m vault
          const mVault = PublicKey.unique();
          if (mVault === $.getMVault()) return;

          // Create the ATA for the fake m vault so we avoid account not initialized errors
          const mVaultATA = await $.getATA($.mMint.publicKey, mVault);

          const recipientExtTokenAccount = await $.getATA(
            $.extMint.publicKey,
            $.admin.publicKey
          );

          // Attempt to send the transaction
          await $.expectAnchorError(
            $.ext.methods
              .claimFees()
              .accountsPartial({
                admin: $.admin.publicKey,
                mVault,
                vaultMTokenAccount: mVaultATA,
                recipientExtTokenAccount,
              })
              .signers([$.admin])
              .rpc(),
            "ConstraintSeeds"
          );
        });

        // given the m vault token account is not the m vault PDA's ATA
        // it reverts with a ConstraintAssociated error
        test("m vault token account is not the m vault PDA's ATA - reverts", async () => {
          // Create a token account for the M vault that is not the ATA
          const mVault = $.getMVault();
          const { tokenAccount: nonAtaAccount } = await $.createTokenAccount(
            $.mMint.publicKey,
            mVault,
            true,
            true
          );

          const recipientExtTokenAccount = await $.getATA(
            $.extMint.publicKey,
            $.admin.publicKey
          );

          // Attempt to send the transaction
          await $.expectAnchorError(
            $.ext.methods
              .claimFees()
              .accountsPartial({
                admin: $.admin.publicKey,
                vaultMTokenAccount: nonAtaAccount,
                recipientExtTokenAccount,
              })
              .signers([$.admin])
              .rpc(),
            "ConstraintAssociated"
          );
        });

        // given the ext mint does not match the one on the global account
        // it reverts with an InvalidMint error
        test("ext mint does not match global account - reverts", async () => {
          // Create a new mint
          const wrongMint = new Keypair();
          await $.createMint(wrongMint, $.nonAdmin.publicKey, true, 6);

          const recipientExtTokenAccount = await $.getATA(
            wrongMint.publicKey,
            $.admin.publicKey
          );

          // Attempt to send the transaction
          await $.expectAnchorError(
            $.ext.methods
              .claimFees()
              .accountsPartial({
                admin: $.admin.publicKey,
                extMint: wrongMint.publicKey,
                recipientExtTokenAccount,
              })
              .signers([$.admin])
              .rpc(),
            "InvalidMint"
          );
        });

        // given the ext mint authority is not the ext mint authority PDA
        // it reverts with a ConstraintSeeds error
        test("ext mint authority is not the ext mint authority PDA - reverts", async () => {
          // Change the ext mint authority
          const extMintAuthority = PublicKey.unique();
          if (extMintAuthority === $.getExtMintAuthority()) return;

          const recipientExtTokenAccount = await $.getATA(
            $.extMint.publicKey,
            $.admin.publicKey
          );
          // Attempt to send the transaction
          await $.expectAnchorError(
            $.ext.methods
              .claimFees()
              .accountsPartial({
                admin: $.admin.publicKey,
                extMintAuthority,
                recipientExtTokenAccount,
              })
              .signers([$.admin])
              .rpc(),
            "ConstraintSeeds"
          );
        });

        // given the m earner account does not match the derived one
        // it reverts with a ConstraintSeeds / AccountNotInitialized error
        test("m earn global account does not match derived pubkey - reverts", async () => {
          // Change the m earn global account
          const mEarnGlobalAccount = PublicKey.unique();
          if (mEarnGlobalAccount.equals($.getEarnGlobalAccount())) return;

          const recipientExtTokenAccount = await $.getATA(
            $.extMint.publicKey,
            $.admin.publicKey
          );

          // Attempt to send the transaction
          await $.expectSystemError(
            $.ext.methods
              .claimFees()
              .accountsPartial({
                admin: $.admin.publicKey,
                mEarnGlobalAccount,
                recipientExtTokenAccount,
              })
              .signers([$.admin])
              .rpc()
          );
        });

        // given the recipient token account is not a token account for the ext mint
        // it reverts with a ConstraintTokenMint error
        test("recipient token account is not for ext mint - reverts", async () => {
          // Create a token account for the m mint
          const wrongTokenAccount = await $.getATA(
            $.mMint.publicKey,
            $.admin.publicKey
          );

          // Attempt to send the transaction
          await $.expectAnchorError(
            $.ext.methods
              .claimFees()
              .accountsPartial({
                admin: $.admin.publicKey,
                recipientExtTokenAccount: wrongTokenAccount,
              })
              .signers([$.admin])
              .rpc(),
            "ConstraintTokenMint"
          );
        });

        // yield variant test cases
        //   [X] given all the accounts are correct
        //     [X] given the multiplier is not synced
        //       [X] it syncs the multiplier to the current
        //       [X] given the m vault has excess collateral
        //         [X] it transfers the excess collateral to the recipient token account
        //       [X] given the m vault does not have excess collateral
        //         [X] it reverts with an InsufficientCollateral error
        //     [X] given the multiplier is already synced
        //       [X] given the m vault has excess collateral
        //         [X] it transfers the excess collateral to the recipient token account
        //       [X] given the m vault does not have excess collateral
        //         [X] it completes but doesn't transfer any tokens

        if (variant === Variant.ScaledUiAmount) {
          // given all accounts are correct
          // given the multiplier is not synced
          // it syncs the multiplier to the current
          // given the m vault has excess collateral
          // it transfers the excess collateral to the recipient token account
          test("multiplier not synced, excess collateral exists - success", async () => {
            // warp forward in time slightly
            $.warp(new BN(60), true);

            // Propagate a new index to create a situation where multiplier needs sync
            const newIndex = new BN(randomInt(startIndex.toNumber() + 1, 2e12));
            await $.propagateIndex(newIndex);

            // Claim yield to ensure vault has enough collateral
            const mVault = $.getMVault();
            const mVaultATA = await $.getATA($.mMint.publicKey, mVault);
            await $.mClaimFor(mVault, await $.getTokenBalance(mVaultATA));
            await $.mCompleteClaims();

            // Cache balances before claim excess
            const initialVaultBalance = await $.getTokenBalance(mVaultATA);
            const recipientATA = await $.getATA(
              $.extMint.publicKey,
              $.admin.publicKey
            );

            // Get the new multiplier calculate the expected excess
            const multiplier = await $.getNewMultiplier(newIndex);

            const initialRecipientPrincipal = await $.getTokenBalance(
              recipientATA
            );
            const initialRecipientBalance = await $.getTokenUiBalance(
              recipientATA,
              multiplier
            );

            const extSupply = await getMint(
              $.provider.connection,
              $.extMint.publicKey,
              undefined,
              TOKEN_2022_PROGRAM_ID
            ).then((mint) => mint.supply);

            const requiredCollateral = new BN(
              Math.ceil(Number(extSupply) * multiplier)
            );

            const expectedExcess = initialVaultBalance.sub(requiredCollateral);
            const expectedExcessPrincipal = new BN(
              Math.floor(Number(expectedExcess) / multiplier)
            );

            // Setup and execute the instruction
            await $.ext.methods
              .claimFees()
              .accountsPartial({
                admin: $.admin.publicKey,
                recipientExtTokenAccount: recipientATA,
              })
              .signers([$.admin])
              .rpc();

            // Verify multiplier was updated

            $.expectScaledUiAmountConfig($.extMint.publicKey, {
              authority: $.getExtMintAuthority(),
              multiplier,
              newMultiplier: multiplier,
              newMultiplierEffectiveTimestamp: BigInt(
                $.currentTime().toString()
              ),
            });

            // Verify excess tokens were transferred

            $.expectTokenBalance(mVaultATA, initialVaultBalance);
            $.expectTokenUiBalance(
              recipientATA,
              initialRecipientBalance.add(expectedExcess),
              Comparison.LessThanOrEqual,
              new BN(1)
            );
            $.expectTokenBalance(
              recipientATA,
              initialRecipientPrincipal.add(expectedExcessPrincipal)
            );
          });

          // given all accounts are correct
          // given the multiplier is already synced
          // given the m vault has excess collateral
          // it transfers the excess collateral to the recipient token account
          test("multiplier already synced, excess collateral exists - success", async () => {
            // Cache balances before claim excess
            const mVaultATA = await $.getATA($.mMint.publicKey, $.getMVault());
            const initialVaultBalance = await $.getTokenBalance(mVaultATA);
            const recipientATA = await $.getATA(
              $.extMint.publicKey,
              $.admin.publicKey
            );

            // Get the current multiplier and calculate the $.expected excess
            const multiplier = await $.getCurrentMultiplier();
            const initialRecipientBalance = await $.getTokenUiBalance(
              recipientATA,
              multiplier
            );
            const initialRecipientPrincipal = await $.getTokenBalance(
              recipientATA
            );

            const extSupply = await getMint(
              $.provider.connection,
              $.extMint.publicKey,
              undefined,
              TOKEN_2022_PROGRAM_ID
            ).then((mint) => mint.supply);

            const requiredCollateral = new BN(
              Math.ceil(Number(extSupply) * multiplier)
            );

            const expectedExcess = initialVaultBalance.sub(requiredCollateral);
            const expectedExcessPrincipal = new BN(
              Math.floor(Number(expectedExcess) / multiplier)
            );

            await $.ext.methods
              .claimFees()
              .accountsPartial({
                admin: $.admin.publicKey,
                recipientExtTokenAccount: recipientATA,
              })
              .signers([$.admin])
              .rpc();

            // Verify excess tokens were transferred
            $.expectTokenBalance(mVaultATA, initialVaultBalance);
            $.expectTokenUiBalance(
              recipientATA,
              initialRecipientBalance.add(expectedExcess),
              Comparison.LessThanOrEqual,
              new BN(1)
            );
            $.expectTokenBalance(
              recipientATA,
              initialRecipientPrincipal.add(expectedExcessPrincipal)
            );
          });

          // given all accounts are correct
          // given the multiplier is already synced
          // given the m vault does not have excess collateral
          // it completes successfully and does not transfer any tokens
          test("multiplier already synced, no excess collateral - success", async () => {
            // claim the existing excess so there isn't extra
            await $.claimFees();
            $.svm.expireBlockhash();

            // Cache balances before claim excess
            const mVaultATA = await $.getATA($.mMint.publicKey, $.getMVault());
            const initialVaultBalance = await $.getTokenBalance(mVaultATA);
            const recipientATA = await $.getATA(
              $.extMint.publicKey,
              $.admin.publicKey
            );
            const initialRecipientBalance = await $.getTokenBalance(
              recipientATA
            );

            // Attempt to send the transaction
            await $.ext.methods
              .claimFees()
              .accountsPartial({
                admin: $.admin.publicKey,
                recipientExtTokenAccount: recipientATA,
              })
              .signers([$.admin])
              .rpc();

            // Verify no tokens were transferred
            $.expectTokenBalance(mVaultATA, initialVaultBalance);
            $.expectTokenBalance(recipientATA, initialRecipientBalance);
          });
        }

        // no yield test cases
        //   [X] given all the accounts are correct
        //     [X] given the m vault has excess collateral
        //       [X] it transfers the excess collateral to the recipient token account
        //     [X] given the m vault does not have excess collateral
        //       [X] it completes but doesn't transfer any tokens
        if (variant === Variant.NoYield) {
          // given all accounts are correct
          // given the m vault has excess collateral
          // it transfers the excess collateral to the recipient token account
          test("excess collateral exists - success", async () => {
            // Cache balances before claim excess
            const mVaultATA = await $.getATA($.mMint.publicKey, $.getMVault());
            const initialVaultBalance = await $.getTokenBalance(mVaultATA);
            const recipientATA = await $.getATA(
              $.extMint.publicKey,
              $.admin.publicKey
            );
            const initialRecipientBalance = await $.getTokenBalance(
              recipientATA
            );

            const extSupply = await getMint(
              $.provider.connection,
              $.extMint.publicKey,
              undefined,
              TOKEN_2022_PROGRAM_ID
            ).then((mint) => mint.supply);

            const expectedExcess = initialVaultBalance.sub(
              new BN(extSupply.toString())
            );

            await $.ext.methods
              .claimFees()
              .accountsPartial({
                admin: $.admin.publicKey,
                recipientExtTokenAccount: recipientATA,
              })
              .signers([$.admin])
              .rpc();

            // Verify excess tokens were transferred
            $.expectTokenBalance(mVaultATA, initialVaultBalance);
            $.expectTokenBalance(
              recipientATA,
              initialRecipientBalance.add(expectedExcess)
            );
          });

          // given all accounts are correct
          // given the m vault does not have excess collateral
          // it completes successfully and does not transfer any tokens
          test("no excess collateral - success", async () => {
            // claim the existing excess so there isn't extra
            await $.claimFees();
            $.svm.expireBlockhash();

            // Cache balances before claim excess
            const mVaultATA = await $.getATA($.mMint.publicKey, $.getMVault());
            const initialVaultBalance = await $.getTokenBalance(mVaultATA);
            const recipientATA = await $.getATA(
              $.extMint.publicKey,
              $.admin.publicKey
            );
            const initialRecipientBalance = await $.getTokenBalance(
              recipientATA
            );

            // Attempt to send the transaction
            await $.ext.methods
              .claimFees()
              .accountsPartial({
                admin: $.admin.publicKey,
                recipientExtTokenAccount: recipientATA,
              })
              .signers([$.admin])
              .rpc();

            // Verify no tokens were transferred
            $.expectTokenBalance(mVaultATA, initialVaultBalance);
            $.expectTokenBalance(recipientATA, initialRecipientBalance);
          });
        }
      });

      if (variant !== Variant.NoYield) {
        describe("set_fee unit tests", () => {
          // yield variant test cases
          // [X] given the admin does not sign the transaction
          //   [X] it reverts with a NotAuthorized error
          // [X] given the admin signs the transaction
          //   [X] given the ext mint does not match the one on the global account
          //     [X] it reverts with an InvalidMint error
          //   [X] given the ext mint authority is not the ext mint authority PDA
          //     [X] it reverts with a ConstraintSeeds error
          //   [X] given all the accounts are correct
          //     [X] given the multiplier is not synced
          //       [X] it syncs the multiplier to the last claimed index
          //       [X] it updates the fee bps
          //     [X] given the multiplier is already synced
          //       [X] it updates the fee bps

          const initialWrappedAmount = new BN(10_000_000); // 10 with 6 decimals
          let wrapAuthorities: PublicKey[];
          const feeBps = new BN(randomInt(1, 10000)); // non-zero
          const startIndex = new BN(
            randomInt(initialIndex.toNumber() + 1, 2e12)
          );

          beforeEach(async () => {
            wrapAuthorities = [$.admin.publicKey, $.wrapAuthority.publicKey];
            // Initialize the extension program
            await $.initializeExt(wrapAuthorities, feeBps);

            // Wrap some tokens from the admin to make the m vault's balance non-zero
            await $.wrap($.admin, initialWrappedAmount);

            // Propagate the start index
            await $.propagateIndex(startIndex);

            // Claim yield for the m vault and complete the claim cycle
            const mVault = $.getMVault();
            const mVaultATA = await $.getATA($.mMint.publicKey, mVault);
            await $.mClaimFor(mVault, await $.getTokenBalance(mVaultATA));
            await $.mCompleteClaims();

            // Sync the multiplier
            await $.sync();

            // Reset the blockhash to avoid issues with duplicate transactions
            $.svm.expireBlockhash();
          });

          // given the admin does not sign the transaction
          // it reverts with a NotAuthorized error
          test("admin does not sign - reverts", async () => {
            // Attempt to send the transaction
            await $.expectAnchorError(
              $.ext.methods
                .setFee(new BN(randomInt(10000)))
                .accountsPartial({
                  admin: $.nonAdmin.publicKey,
                })
                .signers([$.nonAdmin])
                .rpc(),
              "NotAuthorized"
            );
          });

          // given the admin signs the transaction

          // given the ext mint does not match the one on the global account
          // it reverts with an InvalidMint error
          test("ext mint does not match global account - reverts", async () => {
            // Create a new mint
            const wrongMint = new Keypair();
            await $.createMint(wrongMint, $.nonAdmin.publicKey, true, 6);

            // Attempt to send the transaction
            await $.expectAnchorError(
              $.ext.methods
                .setFee(new BN(randomInt(10000)))
                .accountsPartial({
                  admin: $.admin.publicKey,
                  extMint: wrongMint.publicKey,
                })
                .signers([$.admin])
                .rpc(),
              "InvalidMint"
            );
          });

          // given the ext mint authority is not the ext mint authority PDA
          // it reverts with a ConstraintSeeds error
          test("ext mint authority is not the ext mint authority PDA - reverts", async () => {
            // Change the ext mint authority
            const extMintAuthority = PublicKey.unique();
            if (extMintAuthority === $.getExtMintAuthority()) return;

            // Attempt to send the transaction
            await $.expectAnchorError(
              $.ext.methods
                .setFee(new BN(randomInt(10000)))
                .accountsPartial({
                  admin: $.admin.publicKey,
                  extMintAuthority,
                })
                .signers([$.admin])
                .rpc(),
              "ConstraintSeeds"
            );
          });

          // given all the accounts are correct
          // given the multiplier is not synced
          // it syncs the multiplier to the last claimed index
          // it updates the fee bps
          test("multiplier not synced - success", async () => {
            // warp forward in time slightly
            $.warp(new BN(60), true);

            // Propagate a new index to create a situation where multiplier needs sync
            const newIndex = new BN(randomInt(startIndex.toNumber() + 1, 2e12));
            await $.propagateIndex(newIndex);

            // Claim yield to ensure vault has enough collateral
            const mVault = $.getMVault();
            const mVaultATA = await $.getATA($.mMint.publicKey, mVault);
            await $.mClaimFor(mVault, await $.getTokenBalance(mVaultATA));
            await $.mCompleteClaims();

            // Get the new multiplier
            const multiplier = await $.getNewMultiplier(newIndex);

            // Setup and execute the instruction
            const newFee = new BN(randomInt(10000));
            await $.ext.methods
              .setFee(newFee)
              .accountsPartial({
                admin: $.admin.publicKey,
              })
              .signers([$.admin])
              .rpc();

            // Verify multiplier was updated
            $.expectScaledUiAmountConfig($.extMint.publicKey, {
              authority: $.getExtMintAuthority(),
              multiplier,
              newMultiplier: multiplier,
              newMultiplierEffectiveTimestamp: BigInt(
                $.currentTime().toString()
              ),
            });

            // Verify fee bps was updated
            await $.expectExtGlobalState({
              yieldConfig: {
                feeBps: newFee,
                lastExtIndex: new BN(Math.floor(multiplier * 1e12)),
                lastMIndex: newIndex,
              },
            });
          });

          // given all the accounts are correct
          // given the multiplier is already synced
          // it updates the fee bps
          test("multiplier already synced - success", async () => {
            // Cache the current multiplier
            const multiplier = await $.getCurrentMultiplier();

            // Setup and execute the instruction
            const newFee = new BN(randomInt(10000));
            await $.ext.methods
              .setFee(newFee)
              .accountsPartial({
                admin: $.admin.publicKey,
              })
              .signers([$.admin])
              .rpc();

            // Verify fee bps was updated
            await $.expectExtGlobalState({
              yieldConfig: {
                feeBps: newFee,
                lastExtIndex: new BN(Math.floor(multiplier * 1e12)),
                lastMIndex: startIndex,
              },
            });
          });
        });
      }
    });

    describe("wrap_authority instruction tests", () => {
      const mintAmount = new BN(100_000_000); // 100 with 6 decimals
      const initialWrappedAmount = new BN(100_000_000); // 100 with 6 decimals

      let wrapAuthorities: PublicKey[];
      const feeBps = new BN(randomInt(10000));

      const startIndex = new BN(randomInt(initialIndex.toNumber() + 1, 2e12));

      let vaultMTokenAccount: PublicKey;

      // Setup accounts with M tokens so we can test wrapping and unwrapping
      beforeEach(async () => {
        wrapAuthorities = [$.admin.publicKey, $.wrapAuthority.publicKey];
        vaultMTokenAccount = await $.getATA($.mMint.publicKey, $.getMVault());

        // Initialize the extension program
        await $.initializeExt(wrapAuthorities, feeBps);

        // Mint M tokens to a wrap authority and a non-wrap authority
        await $.mintM($.wrapAuthority.publicKey, mintAmount);
        await $.mintM($.nonWrapAuthority.publicKey, mintAmount);

        // Wrap some tokens from the admin to the make the m vault's balance non-zero
        await $.wrap($.admin, initialWrappedAmount);

        // Propagate the start index
        await $.propagateIndex(startIndex);

        // Claim yield for the m vault and complete the claim cycle
        // so that the m vault is collateralized to start
        await $.mClaimFor(
          $.getMVault(),
          await $.getTokenBalance(vaultMTokenAccount)
        );
        await $.mCompleteClaims();

        // Sync the scaled ui multiplier with the m index
        if (variant !== Variant.NoYield) {
          await $.sync();
        }

        // Claim excess tokens to make it easier to test collateral checks
        try {
          await $.claimFees();
        } catch (e) {
          // Ignore the error if there are no excess tokens
        }
      });

      describe("wrap unit tests", () => {
        let fromMTokenAccount: PublicKey;
        let toExtTokenAccount: PublicKey;

        beforeEach(async () => {
          fromMTokenAccount = await $.getATA(
            $.mMint.publicKey,
            $.wrapAuthority.publicKey
          );
          toExtTokenAccount = await $.getATA(
            $.extMint.publicKey,
            $.wrapAuthority.publicKey
          );
        });

        describe("index same as start", () => {
          // test cases
          // [X] given the m mint account does not match the one stored in the global account
          //   [X] it reverts with an InvalidAccount error
          // [X] given the ext mint account does not match the one stored in the global account
          //   [X] it reverts with an InvalidAccount error
          // [X] given the signer is not the authority on the from m token account and is not delegated by the owner
          //   [X] it reverts with a ConstraintTokenOwner error
          // [X] given the vault M token account is not the M Vaults ATA for the M token mint
          //   [X] it reverts with a ConstraintAssociated error
          // [X] given the from m token account is for the wrong mint
          //   [X] it reverts with a ConstraintTokenMint error
          // [X] given the to ext token account is for the wrong mint
          //   [X] it reverts with a ConstraintTokenMint error
          // [X] given a wrap authority is not provided
          //   [X] given the token authority is not in the wrap authorities list
          //     [X] it reverts with a NotAuthorized error
          //   [X] given the token authority is on the wrap authorities list
          //     [X] given the user does not have enough M tokens
          //       [X] it reverts with a ? error
          //     [X] given the user has enough M tokens
          //       [X] given the token authority is not the owner of the from M token account, but is delegated
          //         [X] it transfers the amount of M tokens from the user's M token account to the M vault token account
          //       [X] given the token authority is the owner of the from M token account
          //         [X] it transfers the amount of M tokens from the user's M token account to the M vault token account
          //       [X] it mints the amount of ext tokens to the user's ext token account
          //       [X] given the user wraps and then unwraps (roundtrip)
          //         [X] the starting balance and ending balance of the user's M token account are the same (within rounding error)
          // [X] given a wrap authority is provided
          //   [X] given the wrap authority is not in the wrap authorities list
          //     [X] it reverts with a NotAuthorized error
          //   [X] given the wrap authority is in the wrap authorities list
          //     [X] given the user does not have enough M tokens
          //       [X] it reverts with a ? error
          //     [X] given the user has enough M tokens
          //       [X] given the token authority is not the owner of the from M token account, but is delegated
          //         [X] it transfers the amount of M tokens from the user's M token account to the M vault token account
          //       [X] given the token authority is the owner of the from M token account
          //         [X] it transfers the amount of M tokens from the user's M token account to the M vault token account
          //       [X] it mints the amount of ext tokens to the user's ext token account
          //       [X] given the user wraps and then unwraps (roundtrip)
          //         [X] the starting balance and ending balance of the user's M token account are the same (within rounding error)

          // given the m mint account does not match the one stored in the global account
          // it reverts with an InvalidAccount error
          test("M mint account does not match global account - reverts", async () => {
            const wrongMint = Keypair.generate();
            await $.createMint(wrongMint, $.wrapAuthority.publicKey, true, 6);

            fromMTokenAccount = await $.getATA(
              wrongMint.publicKey,
              $.wrapAuthority.publicKey
            );
            vaultMTokenAccount = await $.getATA(
              wrongMint.publicKey,
              $.getMVault()
            );

            // Attempt to send the transaction
            // Expect an invalid account error
            await $.expectAnchorError(
              $.ext.methods
                .wrap(mintAmount)
                .accountsPartial({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  mMint: wrongMint.publicKey,
                  fromMTokenAccount,
                  toExtTokenAccount,
                  vaultMTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc(),
              "InvalidAccount"
            );
          });

          // given the ext mint account does not match the one stored in the global account
          // it reverts with an InvalidAccount error
          test("Ext mint account does not match global account - reverts", async () => {
            const wrongMint = Keypair.generate();
            await $.createMint(wrongMint, $.wrapAuthority.publicKey, true, 6);

            toExtTokenAccount = await $.getATA(
              wrongMint.publicKey,
              $.wrapAuthority.publicKey
            );

            // Attempt to send the transaction
            // Expect an invalid account error
            await $.expectAnchorError(
              $.ext.methods
                .wrap(mintAmount)
                .accountsPartial({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  extMint: wrongMint.publicKey,
                  fromMTokenAccount,
                  toExtTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc(),
              "InvalidAccount"
            );
          });

          // given the signer is not the authority on the user M token account and is not delegated
          // it reverts with a ConstraintTokenOwner error
          test("Token authority is not the authority on the from M token account and is not delegated - reverts", async () => {
            // Get the ATA for another user
            fromMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.nonWrapAuthority.publicKey
            );

            // Attempt to send the transaction
            // Expect revert with TokenOwner error
            await $.expectSystemError(
              $.ext.methods
                .wrap(mintAmount)
                .accounts({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  fromMTokenAccount,
                  toExtTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc()
            );
          });

          // given the M vault token account is not the M vault PDA's ATA
          // it reverts with a ConstraintAssociated error
          test("M Vault Token account is the the M Vault PDA's ATA (other token account) - reverts", async () => {
            // Create a token account for the M vault that is not the ATA
            const mVault = $.getMVault();
            const { tokenAccount: vaultMTokenAccount } =
              await $.createTokenAccount($.mMint.publicKey, mVault, true, true);

            // Attempt to send the transaction
            // Expect revert with a ConstraintAssociated error
            await $.expectAnchorError(
              $.ext.methods
                .wrap(mintAmount)
                .accountsPartial({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  fromMTokenAccount,
                  toExtTokenAccount,
                  vaultMTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc(),
              "ConstraintAssociated"
            );
          });

          // given the from m token account is for the wrong mint
          // it reverts with a ConstraintTokenMint error
          test("From M token account is for wrong mint - reverts", async () => {
            // Attempt to send the transaction
            // Expect revert with a ConstraintTokenMint error
            await $.expectAnchorError(
              $.ext.methods
                .wrap(mintAmount)
                .accounts({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  fromMTokenAccount: toExtTokenAccount,
                  toExtTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc(),
              "ConstraintTokenMint"
            );
          });

          // given the to ext token account is for the wrong mint
          // it reverts with a ConstraintTokenMint error
          test("To Ext token account is for the wrong mint - reverts", async () => {
            // Attempt to send the transaction
            // Expect revert with a ConstraintTokenMint error
            await $.expectAnchorError(
              $.ext.methods
                .wrap(mintAmount)
                .accounts({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  toExtTokenAccount: fromMTokenAccount,
                  fromMTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc(),
              "ConstraintTokenMint"
            );
          });

          // given a wrap authority is not provided
          // given the token authority is not in the wrap authorities list
          // it reverts with a NotAuthorized error
          test("Token authority is not in the wrap authorities list - reverts", async () => {
            fromMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.nonWrapAuthority.publicKey
            );
            toExtTokenAccount = await $.getATA(
              $.extMint.publicKey,
              $.nonWrapAuthority.publicKey
            );

            // Attempt to send the transaction
            // Expect revert with a NotAuthorized error
            await $.expectAnchorError(
              $.ext.methods
                .wrap(mintAmount)
                .accounts({
                  tokenAuthority: $.nonWrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  fromMTokenAccount,
                  toExtTokenAccount,
                })
                .signers([$.nonWrapAuthority])
                .rpc(),
              "NotAuthorized"
            );
          });

          // given a wrap authority is not provided
          // given the token authority is on the wrap authorities list
          // given the user does not have enough M tokens
          // it reverts
          test("Not enough M - reverts", async () => {
            const wrapAmount = new BN(
              randomInt(mintAmount.toNumber() + 1, 2 ** 48 - 1)
            );

            // Attempt to send the transaction
            // Expect an error
            await $.expectSystemError(
              $.ext.methods
                .wrap(wrapAmount)
                .accounts({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  fromMTokenAccount,
                  toExtTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc()
            );
          });

          // given a wrap authority is not provided
          // given the token authority is on the wrap authorities list
          // given the from token account has enough M tokens
          // given the token authority is not the owner of the from M token account, but is delegated
          // it transfers the amount of M tokens from the user's M token account to the M vault token account
          // it mints the amount of ext tokens to the to ext token account
          test("Wrap with delegated authority - success", async () => {
            const wrapAmount = new BN(randomInt(1, mintAmount.toNumber() + 1));

            // Approve (delegate) the wrap authority to spend the non-wrap authority's M tokens
            const { sourceATA: fromMTokenAccount } = await $.approve(
              $.nonWrapAuthority,
              $.wrapAuthority.publicKey,
              $.mMint.publicKey,
              wrapAmount
            );

            // Setup the instruction
            const toExtTokenAccount = await $.getATA(
              $.extMint.publicKey,
              $.nonWrapAuthority.publicKey
            );

            // Cache initial balances
            const fromMTokenAccountBalance = await $.getTokenBalance(
              fromMTokenAccount
            );
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(toExtTokenAccount)
                : await $.getTokenBalance(toExtTokenAccount);

            // Send the instruction
            await $.ext.methods
              .wrap(wrapAmount)
              .accounts({
                tokenAuthority: $.wrapAuthority.publicKey,
                wrapAuthority: $.ext.programId,
                fromMTokenAccount,
                toExtTokenAccount,
              })
              .signers([$.wrapAuthority])
              .rpc();

            // Confirm updated balances
            await $.expectTokenBalance(
              fromMTokenAccount,
              fromMTokenAccountBalance.sub(wrapAmount)
            );
            await $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.add(wrapAmount)
            );
            variant === Variant.ScaledUiAmount
              ? await $.expectTokenUiBalance(
                  toExtTokenAccount,
                  toExtTokenAccountBalance.add(wrapAmount),
                  Comparison.LessThanOrEqual,
                  new BN(2)
                )
              : await $.expectTokenBalance(
                  toExtTokenAccount,
                  toExtTokenAccountBalance.add(wrapAmount)
                );
          });

          // given a wrap authority is not provided
          // given the token authority is on the wrap authorities list
          // given the from token account has enough M tokens
          // given the token authority is the owner of the from M token account
          // it transfers the amount of M tokens from the user's M token account to the M vault token account
          // it mints the amount of wM tokens to the user's wM token account
          test("Wrap to wrap authority account - success", async () => {
            // Cache initial balances
            const fromMTokenAccountBalance = await $.getTokenBalance(
              fromMTokenAccount
            );
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(toExtTokenAccount)
                : await $.getTokenBalance(toExtTokenAccount);

            const wrapAmount = new BN(randomInt(1, mintAmount.toNumber() + 1));

            // Send the instruction
            await $.ext.methods
              .wrap(wrapAmount)
              .accountsPartial({
                tokenAuthority: $.wrapAuthority.publicKey,
                wrapAuthority: $.ext.programId,
                fromMTokenAccount,
                toExtTokenAccount,
              })
              .signers([$.wrapAuthority])
              .rpc();

            // Confirm updated balances
            await $.expectTokenBalance(
              fromMTokenAccount,
              fromMTokenAccountBalance.sub(wrapAmount)
            );
            await $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.add(wrapAmount)
            );
            variant === Variant.ScaledUiAmount
              ? await $.expectTokenUiBalance(
                  toExtTokenAccount,
                  toExtTokenAccountBalance.add(wrapAmount),
                  Comparison.LessThanOrEqual,
                  new BN(2)
                )
              : await $.expectTokenBalance(
                  toExtTokenAccount,
                  toExtTokenAccountBalance.add(wrapAmount)
                );
          });

          // given a wrap authority is not provided
          // given the token authority is on the wrap authorities list
          // given the from token account has enough M tokens
          // given the token authority is the owner of the from M token account
          // given the signer does not own the to ext token account
          // it transfers the amount of M tokens from the user's M token account to the M vault token account
          // it mints the amount of wM tokens to the user's wM token account
          test("Wrap to different account - success", async () => {
            toExtTokenAccount = await $.getATA(
              $.extMint.publicKey,
              $.nonWrapAuthority.publicKey
            );

            // Cache initial balances
            const fromMTokenAccountBalance = await $.getTokenBalance(
              fromMTokenAccount
            );
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(toExtTokenAccount)
                : await $.getTokenBalance(toExtTokenAccount);

            const wrapAmount = new BN(randomInt(1, mintAmount.toNumber() + 1));

            // Send the instruction
            await $.ext.methods
              .wrap(wrapAmount)
              .accountsPartial({
                tokenAuthority: $.wrapAuthority.publicKey,
                wrapAuthority: $.ext.programId,
                fromMTokenAccount,
                toExtTokenAccount,
              })
              .signers([$.wrapAuthority])
              .rpc();

            // Confirm updated balances
            await $.expectTokenBalance(
              fromMTokenAccount,
              fromMTokenAccountBalance.sub(wrapAmount)
            );
            await $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.add(wrapAmount)
            );
            variant === Variant.ScaledUiAmount
              ? await $.expectTokenUiBalance(
                  toExtTokenAccount,
                  toExtTokenAccountBalance.add(wrapAmount),
                  Comparison.LessThanOrEqual,
                  new BN(2)
                )
              : await $.expectTokenBalance(
                  toExtTokenAccount,
                  toExtTokenAccountBalance.add(wrapAmount)
                );
          });

          // given a wrap authority is not provided
          // given the token authority is on the wrap authorities list
          // given the from token account enough M tokens
          // given the token authority is the owner of the from token account
          // round-trip (wrap / unwrap)
          test("Wrap / unwrap roundtrip - success", async () => {
            // Cache the starting balance of M
            const startingBalance = await $.getTokenBalance(fromMTokenAccount);

            // Wrap some tokens
            const wrapAmount = new BN(
              randomInt(1, startingBalance.toNumber() + 1)
            );
            await $.wrap($.wrapAuthority, wrapAmount);

            // Unwrap the same amount
            await $.unwrap($.wrapAuthority, wrapAmount);

            // Confirm the final balance is the same as the starting balance
            $.expectTokenBalance(
              fromMTokenAccount,
              startingBalance,
              Comparison.LessThanOrEqual,
              new BN(2)
            );
          });

          // given a wrap authority is provided
          // given the wrap authority is not in the wrap authorities list
          // it reverts with a NotAuthorized error
          test("Wrap authority is not in the wrap authorities list - reverts", async () => {
            // Attempt to send the transaction
            // Expect revert with a NotAuthorized error
            await $.expectAnchorError(
              $.ext.methods
                .wrap(mintAmount)
                .accounts({
                  tokenAuthority: $.nonWrapAuthority.publicKey,
                  wrapAuthority: $.nonWrapAuthority.publicKey,
                  fromMTokenAccount,
                  toExtTokenAccount,
                })
                .signers([$.nonWrapAuthority])
                .rpc(),
              "NotAuthorized"
            );
          });

          // given a wrap authority is provided
          // given the wrap authority is in the wrap authorities list
          // given the from token account does not have enough M tokens
          // it reverts with a ? error
          test("Not enough M - wrap authority - reverts", async () => {
            const wrapAmount = new BN(
              randomInt(mintAmount.toNumber() + 1, 2 ** 48 - 1)
            );

            // Attempt to send the transaction
            // Expect an error
            await $.expectSystemError(
              $.ext.methods
                .wrap(wrapAmount)
                .accounts({
                  tokenAuthority: $.nonWrapAuthority.publicKey,
                  wrapAuthority: $.wrapAuthority.publicKey,
                  fromMTokenAccount,
                  toExtTokenAccount,
                })
                .signers([$.nonWrapAuthority, $.wrapAuthority])
                .rpc()
            );
          });

          // given a wrap authority is provided
          // given the wrap authority is in the wrap authorities list
          // given the from token account has enough M tokens
          // given the token authority is not the owner of the from M token account, but is delegated
          // it transfers the amount of M tokens from the user's M token account to the M vault token account
          // it mints the amount of ext tokens to the user's ext token account
          test("Wrap with delegated authority - wrap authority - success", async () => {
            const wrapAmount = new BN(randomInt(1, mintAmount.toNumber() + 1));

            // Approve (delegate) the wrap authority to spend the non-wrap authority's M tokens
            const { sourceATA: fromMTokenAccount } = await $.approve(
              $.nonWrapAuthority,
              $.nonAdmin.publicKey,
              $.mMint.publicKey,
              wrapAmount
            );

            // Setup the instruction
            const toExtTokenAccount = await $.getATA(
              $.extMint.publicKey,
              $.nonWrapAuthority.publicKey
            );

            // Cache initial balances
            const fromMTokenAccountBalance = await $.getTokenBalance(
              fromMTokenAccount
            );
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(toExtTokenAccount)
                : await $.getTokenBalance(toExtTokenAccount);

            // Send the instruction
            await $.ext.methods
              .wrap(wrapAmount)
              .accounts({
                tokenAuthority: $.nonAdmin.publicKey,
                wrapAuthority: $.wrapAuthority.publicKey,
                fromMTokenAccount,
                toExtTokenAccount,
              })
              .signers([$.nonAdmin, $.wrapAuthority])
              .rpc();

            // Confirm updated balances
            await $.expectTokenBalance(
              fromMTokenAccount,
              fromMTokenAccountBalance.sub(wrapAmount)
            );
            await $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.add(wrapAmount)
            );
            variant === Variant.ScaledUiAmount
              ? await $.expectTokenUiBalance(
                  toExtTokenAccount,
                  toExtTokenAccountBalance.add(wrapAmount),
                  Comparison.LessThanOrEqual,
                  new BN(2)
                )
              : await $.expectTokenBalance(
                  toExtTokenAccount,
                  toExtTokenAccountBalance.add(wrapAmount)
                );
          });

          // given a wrap authority is provided
          // given the wrap authority is in the wrap authorities list
          // given the from token account has enough M tokens
          // given the token authority is the owner of the from M token account
          // it transfers the amount of M tokens from the user's M token account to the M vault token account
          // it mints the amount of ext tokens to the user's ext token account
          test("Wrap to differenct account - wrap authority - success", async () => {
            fromMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.nonWrapAuthority.publicKey
            );

            toExtTokenAccount = await $.getATA(
              $.extMint.publicKey,
              $.nonAdmin.publicKey
            );

            // Cache initial balances
            const fromMTokenAccountBalance = await $.getTokenBalance(
              fromMTokenAccount
            );
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(toExtTokenAccount)
                : await $.getTokenBalance(toExtTokenAccount);

            const wrapAmount = new BN(randomInt(1, mintAmount.toNumber() + 1));

            // Send the instruction
            await $.ext.methods
              .wrap(wrapAmount)
              .accountsPartial({
                tokenAuthority: $.nonWrapAuthority.publicKey,
                wrapAuthority: $.wrapAuthority.publicKey,
                fromMTokenAccount,
                toExtTokenAccount,
              })
              .signers([$.nonWrapAuthority, $.wrapAuthority])
              .rpc();

            // Confirm updated balances
            await $.expectTokenBalance(
              fromMTokenAccount,
              fromMTokenAccountBalance.sub(wrapAmount)
            );
            await $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.add(wrapAmount)
            );
            variant === Variant.ScaledUiAmount
              ? await $.expectTokenUiBalance(
                  toExtTokenAccount,
                  toExtTokenAccountBalance.add(wrapAmount),
                  Comparison.LessThanOrEqual,
                  new BN(2)
                )
              : await $.expectTokenBalance(
                  toExtTokenAccount,
                  toExtTokenAccountBalance.add(wrapAmount)
                );
          });

          // given a wrap authority is provided
          // given the wrap authority is in the wrap authorities list
          // given the from token account has enough M tokens
          // given the token authority is the owner of the from M token account
          // round-trip (wrap / unwrap)
          test("Wrap / unwrap roundtrip - wrap authority - success", async () => {
            // Cache the starting balance of M
            const startingBalance = await $.getTokenBalance(fromMTokenAccount);

            // Wrap some tokens
            const wrapAmount = new BN(
              randomInt(1, startingBalance.toNumber() + 1)
            );
            await $.wrap($.nonWrapAuthority, wrapAmount, $.wrapAuthority);

            // Unwrap the same amount
            await $.unwrap($.nonWrapAuthority, wrapAmount, $.wrapAuthority);

            // Confirm the final balance is the same as the starting balance
            $.expectTokenBalance(
              fromMTokenAccount,
              startingBalance,
              Comparison.LessThanOrEqual,
              new BN(2)
            );
          });
        });

        describe("index different from start (sync required)", () => {
          // M Index is strictly increasing
          const newIndex = new BN(
            randomInt(startIndex.toNumber() + 1, 2e12 + 1)
          );
          let vaultBalanceAtNewIndex: BN;

          beforeEach(async () => {
            // Reset the blockhash to avoid issues with duplicate transactions from multiple claim cycles
            $.svm.expireBlockhash();

            // Propagate the new index
            await $.propagateIndex(newIndex);

            // Cache the vault balance at the new index
            vaultBalanceAtNewIndex = await $.getTokenBalance(
              vaultMTokenAccount
            );
          });

          // test cases
          // [x] given the user has no ext tokens to start with
          //   [X] given no flows before the yield is distributed
          //     [X] it wraps the amount of M tokens from the user's M token account to the M vault token account
          //     [X] the user receives the correct amount of ext tokens
          //     [X] the extension is solvent
          //   [X] given there are net inflows before the yield is distributed
          //     [X] it wraps the amount of M tokens from the user's M token account to the M vault token account
          //     [X] the user receives the correct amount of ext tokens
          //     [X] the extension is solvent
          //   [X] given there are net outflows before the yield is distributed
          //     [X] it wraps the amount of M tokens from the user's M token account to the M vault token account
          //     [X] the user receives the correct amount of ext tokens
          //     [X] the extension is solvent
          // [X] given the user has ext tokens to start with
          //   [X] given no flows before the yield is distributed
          //     [X] it wraps the amount of M tokens from the user's M token account to the M vault token account
          //     [X] it adjusts the user's existing balance for the new index and then adds the wrap amount
          //     [X] the extension is solvent
          //   [X] given there are net inflows before the yield is distributed
          //     [X] it wraps the amount of M tokens from the user's M token account to the M vault token account
          //     [X] it adjusts the user's existing balance for the new index and then adds the wrap amount
          //     [X] the extension is solvent
          //   [X] given there are net outflows before the yield is distributed
          //     [X] it wraps the amount of M tokens from the user's M token account to the M vault token account
          //     [X] it adjusts the user's existing balance for the new index and then adds the wrap amount
          //     [X] the extension is solvent

          describe("user has no starting balance", () => {
            // given no flows before the yield is distributed
            // it wraps the amount of M tokens from the user's M token account to the M vault token account
            // the extension is solvent
            test("Wrap with new index - no flows - success", async () => {
              // Mint yield to the m vault for the new index
              await $.mClaimFor($.getMVault(), vaultBalanceAtNewIndex);
              await $.mCompleteClaims();

              // Cache initial balances
              const fromMTokenAccountBalance = await $.getTokenBalance(
                fromMTokenAccount
              );
              const vaultMTokenAccountBalance = await $.getTokenBalance(
                vaultMTokenAccount
              );
              const toExtTokenAccountBalance =
                variant === Variant.ScaledUiAmount
                  ? await $.getTokenUiBalance(toExtTokenAccount)
                  : await $.getTokenBalance(toExtTokenAccount);

              const wrapAmount = new BN(
                randomInt(1, fromMTokenAccountBalance.toNumber() + 1)
              );

              // Send the instruction
              await $.ext.methods
                .wrap(wrapAmount)
                .accounts({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  fromMTokenAccount,
                  toExtTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc();

              // Confirm updated balances
              await $.expectTokenBalance(
                fromMTokenAccount,
                fromMTokenAccountBalance.sub(wrapAmount)
              );
              await $.expectTokenBalance(
                vaultMTokenAccount,
                vaultMTokenAccountBalance.add(wrapAmount)
              );
              variant === Variant.ScaledUiAmount
                ? await $.expectTokenUiBalance(
                    toExtTokenAccount,
                    toExtTokenAccountBalance.add(wrapAmount),
                    Comparison.LessThanOrEqual,
                    new BN(2)
                  )
                : await $.expectTokenBalance(
                    toExtTokenAccount,
                    toExtTokenAccountBalance.add(wrapAmount)
                  );

              // Confirm the extension is solvent
              await $.expectExtSolvent();
            });

            // given the extension has net inflows before the yield is distributed
            // it wraps the amount of M tokens from the user's M token account to the M vault token account
            // the extension is solvent
            test("Wrap - extension has inflows - success", async () => {
              // Mint and wrap additional tokens prior to claim
              const inflows = new BN(randomInt(100, mintAmount.toNumber() + 1));
              await $.mintM($.admin.publicKey, inflows);
              await $.wrap($.admin, inflows);

              // Mint yield to the m vault for the new index
              await $.mClaimFor($.getMVault(), vaultBalanceAtNewIndex);
              await $.mCompleteClaims();

              // Cache initial balances
              const fromMTokenAccountBalance = await $.getTokenBalance(
                fromMTokenAccount
              );
              const vaultMTokenAccountBalance = await $.getTokenBalance(
                vaultMTokenAccount
              );
              const toExtTokenAccountBalance =
                variant === Variant.ScaledUiAmount
                  ? await $.getTokenUiBalance(toExtTokenAccount)
                  : await $.getTokenBalance(toExtTokenAccount);

              const wrapAmount = new BN(
                randomInt(1, fromMTokenAccountBalance.toNumber() + 1)
              );

              // Send the instruction
              await $.ext.methods
                .wrap(wrapAmount)
                .accounts({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  fromMTokenAccount,
                  toExtTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc();

              // Confirm updated balances
              await $.expectTokenBalance(
                fromMTokenAccount,
                fromMTokenAccountBalance.sub(wrapAmount)
              );
              await $.expectTokenBalance(
                vaultMTokenAccount,
                vaultMTokenAccountBalance.add(wrapAmount)
              );
              variant === Variant.ScaledUiAmount
                ? await $.expectTokenUiBalance(
                    toExtTokenAccount,
                    toExtTokenAccountBalance.add(wrapAmount),
                    Comparison.LessThanOrEqual,
                    new BN(2)
                  )
                : await $.expectTokenBalance(
                    toExtTokenAccount,
                    toExtTokenAccountBalance.add(wrapAmount)
                  );
              // Confirm the extension is solvent
              await $.expectExtSolvent();
            });

            // given the extension has net outflows before the yield is distributed
            // it wraps the amount of M tokens from the user's M token account to the M vault token account
            // the extension is solvent
            test("Wrap - extension has outflows - success", async () => {
              // Mint and wrap additional tokens
              const outflows = new BN(
                randomInt(100, initialWrappedAmount.toNumber() + 1)
              );
              await $.unwrap($.admin, outflows);

              // Mint yield to the m vault for the new index
              await $.mClaimFor($.getMVault(), vaultBalanceAtNewIndex);
              await $.mCompleteClaims();

              // Cache initial balances
              const fromMTokenAccountBalance = await $.getTokenBalance(
                fromMTokenAccount
              );
              const vaultMTokenAccountBalance = await $.getTokenBalance(
                vaultMTokenAccount
              );
              const toExtTokenAccountBalance =
                variant === Variant.ScaledUiAmount
                  ? await $.getTokenUiBalance(toExtTokenAccount)
                  : await $.getTokenBalance(toExtTokenAccount);

              const wrapAmount = new BN(
                randomInt(1, fromMTokenAccountBalance.toNumber() + 1)
              );

              // Send the instruction
              await $.ext.methods
                .wrap(wrapAmount)
                .accounts({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  fromMTokenAccount,
                  toExtTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc();

              // Confirm updated balances
              await $.expectTokenBalance(
                fromMTokenAccount,
                fromMTokenAccountBalance.sub(wrapAmount)
              );
              await $.expectTokenBalance(
                vaultMTokenAccount,
                vaultMTokenAccountBalance.add(wrapAmount)
              );
              variant === Variant.ScaledUiAmount
                ? await $.expectTokenUiBalance(
                    toExtTokenAccount,
                    toExtTokenAccountBalance.add(wrapAmount),
                    Comparison.LessThanOrEqual,
                    new BN(2)
                  )
                : await $.expectTokenBalance(
                    toExtTokenAccount,
                    toExtTokenAccountBalance.add(wrapAmount)
                  );
              // Confirm the extension is solvent
              await $.expectExtSolvent();
            });
          });

          describe("user has starting balance", () => {
            beforeEach(async () => {
              // Give the wrap authority some initial tokens
              const initialAmount = new BN(
                randomInt(1, mintAmount.toNumber() + 1)
              );
              await $.mintM($.wrapAuthority.publicKey, initialAmount);
              await $.wrap($.wrapAuthority, initialAmount);
            });

            // given no flows before the yield is distributed
            // it adjusts the user's existing balance correctly and then adds the new wrapped amount
            // the extension is solvent
            test("Wrap with new index - no flows - success", async () => {
              const startMultiplier = new BN(
                Math.floor((await $.getCurrentMultiplier()) * 1e12)
              );

              // Mint yield to the m vault for the new index
              await $.mClaimFor($.getMVault(), vaultBalanceAtNewIndex);
              await $.mCompleteClaims();

              // Cache initial balances
              const fromMTokenAccountBalance = await $.getTokenBalance(
                fromMTokenAccount
              );
              const vaultMTokenAccountBalance = await $.getTokenBalance(
                vaultMTokenAccount
              );
              const toExtTokenAccountBalance =
                variant === Variant.ScaledUiAmount
                  ? await $.getTokenUiBalance(toExtTokenAccount)
                  : await $.getTokenBalance(toExtTokenAccount);

              const wrapAmount = new BN(
                randomInt(1, fromMTokenAccountBalance.toNumber() + 1)
              );

              // Send the instruction
              await $.ext.methods
                .wrap(wrapAmount)
                .accounts({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  fromMTokenAccount,
                  toExtTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc();

              // Get new multiplier
              const newMultiplier = new BN(
                Math.floor((await $.getCurrentMultiplier()) * 1e12)
              );

              // Confirm updated balances
              await $.expectTokenBalance(
                fromMTokenAccount,
                fromMTokenAccountBalance.sub(wrapAmount)
              );
              await $.expectTokenBalance(
                vaultMTokenAccount,
                vaultMTokenAccountBalance.add(wrapAmount)
              );
              variant === Variant.ScaledUiAmount
                ? await $.expectTokenUiBalance(
                    toExtTokenAccount,
                    toExtTokenAccountBalance
                      .mul(newMultiplier)
                      .div(startMultiplier)
                      .add(wrapAmount),
                    Comparison.Equal,
                    new BN(2)
                  )
                : await $.expectTokenBalance(
                    toExtTokenAccount,
                    toExtTokenAccountBalance.add(wrapAmount)
                  );

              // Confirm the extension is solvent
              await $.expectExtSolvent();
            });

            // given the extension has net inflows before the yield is distributed
            // it adjusts the user's existing balance correctly and then adds the new wrapped amount
            // the extension is solvent
            test("Wrap - extension has inflows - success", async () => {
              const startMultiplier = new BN(
                Math.floor((await $.getCurrentMultiplier()) * 1e12)
              );

              // Mint and wrap additional tokens prior to claim
              const inflows = new BN(randomInt(100, mintAmount.toNumber() + 1));
              await $.mintM($.admin.publicKey, inflows);
              await $.wrap($.admin, inflows);

              // Mint yield to the m vault for the new index
              await $.mClaimFor($.getMVault(), vaultBalanceAtNewIndex);
              await $.mCompleteClaims();

              // Cache initial balances
              const fromMTokenAccountBalance = await $.getTokenBalance(
                fromMTokenAccount
              );
              const vaultMTokenAccountBalance = await $.getTokenBalance(
                vaultMTokenAccount
              );
              const toExtTokenAccountBalance =
                variant === Variant.ScaledUiAmount
                  ? await $.getTokenUiBalance(toExtTokenAccount)
                  : await $.getTokenBalance(toExtTokenAccount);

              const wrapAmount = new BN(
                randomInt(1, fromMTokenAccountBalance.toNumber() + 1)
              );

              // Send the instruction
              await $.ext.methods
                .wrap(wrapAmount)
                .accounts({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  fromMTokenAccount,
                  toExtTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc();

              // Get new multiplier
              const newMultiplier = new BN(
                Math.floor((await $.getCurrentMultiplier()) * 1e12)
              );

              // Confirm updated balances
              await $.expectTokenBalance(
                fromMTokenAccount,
                fromMTokenAccountBalance.sub(wrapAmount)
              );
              await $.expectTokenBalance(
                vaultMTokenAccount,
                vaultMTokenAccountBalance.add(wrapAmount)
              );
              variant === Variant.ScaledUiAmount
                ? await $.expectTokenUiBalance(
                    toExtTokenAccount,
                    toExtTokenAccountBalance
                      .mul(newMultiplier)
                      .div(startMultiplier)
                      .add(wrapAmount),
                    Comparison.Equal,
                    new BN(2)
                  )
                : await $.expectTokenBalance(
                    toExtTokenAccount,
                    toExtTokenAccountBalance.add(wrapAmount)
                  );
              // Confirm the extension is solvent
              await $.expectExtSolvent();
            });

            // given the extension has net outflows before the yield is distributed
            // it wraps the amount of M tokens from the user's M token account to the M vault token account
            // the extension is solvent
            test("Wrap - extension has outflows - success", async () => {
              const startMultiplier = new BN(
                Math.floor((await $.getCurrentMultiplier()) * 1e12)
              );

              // Mint and wrap additional tokens
              const outflows = new BN(
                randomInt(100, initialWrappedAmount.toNumber() + 1)
              );
              await $.unwrap($.admin, outflows);

              // Mint yield to the m vault for the new index
              await $.mClaimFor($.getMVault(), vaultBalanceAtNewIndex);
              await $.mCompleteClaims();

              // Cache initial balances
              const fromMTokenAccountBalance = await $.getTokenBalance(
                fromMTokenAccount
              );
              const vaultMTokenAccountBalance = await $.getTokenBalance(
                vaultMTokenAccount
              );
              const toExtTokenAccountBalance =
                variant === Variant.ScaledUiAmount
                  ? await $.getTokenUiBalance(toExtTokenAccount)
                  : await $.getTokenBalance(toExtTokenAccount);

              const wrapAmount = new BN(
                randomInt(1, fromMTokenAccountBalance.toNumber() + 1)
              );

              // Send the instruction
              await $.ext.methods
                .wrap(wrapAmount)
                .accounts({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  wrapAuthority: $.ext.programId,
                  fromMTokenAccount,
                  toExtTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc();

              // Get new multiplier
              const newMultiplier = new BN(
                Math.floor((await $.getCurrentMultiplier()) * 1e12)
              );

              // Confirm updated balances
              await $.expectTokenBalance(
                fromMTokenAccount,
                fromMTokenAccountBalance.sub(wrapAmount)
              );
              await $.expectTokenBalance(
                vaultMTokenAccount,
                vaultMTokenAccountBalance.add(wrapAmount)
              );
              variant === Variant.ScaledUiAmount
                ? await $.expectTokenUiBalance(
                    toExtTokenAccount,
                    toExtTokenAccountBalance
                      .mul(newMultiplier)
                      .div(startMultiplier)
                      .add(wrapAmount),
                    Comparison.Equal,
                    new BN(2)
                  )
                : await $.expectTokenBalance(
                    toExtTokenAccount,
                    toExtTokenAccountBalance.add(wrapAmount)
                  );
              // Confirm the extension is solvent
              await $.expectExtSolvent();
            });
          });
        });
      });

      describe("unwrap unit tests", () => {
        const wrappedAmount = new BN(25_000_000);

        let fromExtTokenAccount: PublicKey;
        let toMTokenAccount: PublicKey;

        beforeEach(async () => {
          fromExtTokenAccount = await $.getATA(
            $.extMint.publicKey,
            $.wrapAuthority.publicKey
          );
          toMTokenAccount = await $.getATA(
            $.mMint.publicKey,
            $.wrapAuthority.publicKey
          );

          // Wrap tokens for the users so we can test unwrapping
          await $.wrap($.wrapAuthority, wrappedAmount);
          await $.wrap($.nonWrapAuthority, wrappedAmount, $.wrapAuthority);
        });
        describe("index same as start", () => {
          // test cases
          // [X] given the m mint account does not match the one stored in the global account
          //   [X] it reverts with an InvalidAccount error
          // [X] given the ext mint account does not match the one stored in the global account
          //   [X] it reverts with an InvalidAccount error
          // [X] given the token authority is not the authority on the from ext token account and is not delegated by the owner
          //   [X] it reverts with a Token program error
          // [X] given the vault M token account is not the M Vaults ATA for the M token mint
          //   [X] it reverts with a ConstraintAssociated error
          // [X] given the to m token account is for the wrong mint
          //   [X] it reverts with a ConstraintTokenMint error
          // [X] given the from ext token account is for the wrong mint
          //   [X] it reverts with a ConstraintTokenMint error
          // [X] given a wrap authority is not provided
          //   [X] given the token authority is not in the wrap authorities list
          //     [X] it reverts with a NotAuthorized error
          //   [X] given the token authority is in the wrap authorities list
          //     [X] given the from token account does not have enough ext tokens
          //       [X] it unwraps the from token accounts whole balance
          //     [X] given the from token account has enough ext tokens
          //       [X] given the token authority is not the owner of the from ext token account, but is delegated
          //         [X] it burns the amount of ext tokens from the from's ext token account
          //       [X] given the token authority is the owner of the from ext token account
          //         [X] it burns the amount of ext tokens from the from's ext token account
          //       [X] it transfers the amount of M tokens from the M vault token account to the to's M token account
          // [X] given a wrap authority is provided
          //   [X] given the wrap authority does not sign the transaction
          //     [X] it reverts
          //   [X] given the wrap authority is not on the wrap authorities list
          //     [X] it reverts with a NotAuthorized error
          //   [X] given the wrap authority is on the wrap authorities list
          //     [X] given the from token account does not have enough ext tokens
          //       [X] it reverts
          //     [X] given the from token account has enough ext tokens
          //       [X] given the token authority is not the owner of the from ext token account, but is delegated
          //         [X] it burns the amount of ext tokens from the from's ext token account
          //       [X] given the token authority is the owner of the from ext token account
          //         [X] it burns the amount of ext tokens from the from's ext token account
          //       [X] it transfers the amount of M tokens from the M vault token account to the to's M token account

          // given the m mint account does not match the one stored in the global account
          // it reverts with an InvalidAccount error
          test("M mint account does not match global account - reverts", async () => {
            const wrongMint = Keypair.generate();
            await $.createMint(wrongMint, $.wrapAuthority.publicKey, true, 6);

            // Update the M token accounts
            toMTokenAccount = await $.getATA(
              wrongMint.publicKey,
              $.wrapAuthority.publicKey
            );
            vaultMTokenAccount = await $.getATA(
              wrongMint.publicKey,
              $.getMVault()
            );

            // Attempt to send the transaction
            // Expect an invalid account error
            await $.expectAnchorError(
              $.ext.methods
                .unwrap(wrappedAmount)
                .accountsPartial({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  unwrapAuthority: $.ext.programId,
                  mMint: wrongMint.publicKey,
                  fromExtTokenAccount,
                  toMTokenAccount,
                  vaultMTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc(),
              "InvalidAccount"
            );
          });

          // given the ext mint account does not match the one stored in the global account
          // it reverts with an InvalidAccount error
          test("Ext mint account does not match global account - reverts", async () => {
            const wrongMint = Keypair.generate();
            await $.createMint(wrongMint, $.wrapAuthority.publicKey, true, 6);

            // Update the ext token accounts
            fromExtTokenAccount = await $.getATA(
              wrongMint.publicKey,
              $.wrapAuthority.publicKey
            );

            // Attempt to send the transaction
            // Expect an invalid account error
            await $.expectAnchorError(
              $.ext.methods
                .unwrap(wrappedAmount)
                .accountsPartial({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  unwrapAuthority: $.ext.programId,
                  extMint: wrongMint.publicKey,
                  fromExtTokenAccount,
                  toMTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc(),
              "InvalidAccount"
            );
          });

          // given the token authority is not the authority on the from ext token account and not delegated
          // it reverts with a ConstraintTokenOwner error
          test("Token authority is not the authority on the from Ext token account and not delegated - reverts", async () => {
            // Get the ATA for another user
            fromExtTokenAccount = await $.getATA(
              $.extMint.publicKey,
              $.nonWrapAuthority.publicKey
            );

            // Attempt to send the transaction
            // Expect revert with TokenOwner error
            await $.expectSystemError(
              $.ext.methods
                .unwrap(wrappedAmount)
                .accounts({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  unwrapAuthority: $.ext.programId,
                  fromExtTokenAccount,
                  toMTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc()
            );
          });

          // given the M vault token account is not the M vault PDA's ATA
          // it reverts with a ConstraintAssociated error
          test("M Vault Token account is the the M Vault PDA's ATA (other token account) - reverts", async () => {
            // Create a token account for the M vault that is not the ATA
            const mVault = $.getMVault();
            const { tokenAccount: vaultMTokenAccount } =
              await $.createTokenAccount(
                $.mMint.publicKey,
                $.getMVault(),
                true,
                true
              );

            // Attempt to send the transaction
            // Expect revert with a ConstraintAssociated error
            await $.expectAnchorError(
              $.ext.methods
                .unwrap(wrappedAmount)
                .accountsPartial({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  unwrapAuthority: $.ext.programId,
                  fromExtTokenAccount,
                  toMTokenAccount,
                  vaultMTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc(),
              "ConstraintAssociated"
            );
          });

          // given the user m token account is for the wrong mint
          // it reverts with a ConstraintTokenMint error
          test("To M token account is for wrong mint - reverts", async () => {
            // Attempt to send the transaction
            // Expect revert with a ConstraintTokenMint error
            await $.expectAnchorError(
              $.ext.methods
                .unwrap(wrappedAmount)
                .accounts({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  unwrapAuthority: $.ext.programId,
                  toMTokenAccount: fromExtTokenAccount,
                  fromExtTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc(),
              "ConstraintTokenMint"
            );
          });

          // given the user ext token account is for the wrong mint
          // it reverts with a ConstraintTokenMint error
          test("From Ext token account is for the wrong mint - reverts", async () => {
            // Attempt to send the transaction
            // Expect revert with a ConstraintTokenMint error
            await $.expectAnchorError(
              $.ext.methods
                .unwrap(wrappedAmount)
                .accounts({
                  tokenAuthority: $.wrapAuthority.publicKey,
                  unwrapAuthority: $.ext.programId,
                  fromExtTokenAccount: toMTokenAccount,
                  toMTokenAccount,
                })
                .signers([$.wrapAuthority])
                .rpc(),
              "ConstraintTokenMint"
            );
          });
          // given a wrap authority is not provided
          // given the token authority is not in the wrap authorities list
          // it reverts with a NotAuthorized error
          test("Token authority is not in the wrap authorities list - reverts", async () => {
            fromExtTokenAccount = await $.getATA(
              $.extMint.publicKey,
              $.nonWrapAuthority.publicKey
            );
            toMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.nonWrapAuthority.publicKey
            );
            // Attempt to send the transaction
            // Expect revert with a NotAuthorized error
            await $.expectAnchorError(
              $.ext.methods
                .unwrap(wrappedAmount)
                .accounts({
                  tokenAuthority: $.nonWrapAuthority.publicKey,
                  unwrapAuthority: $.ext.programId,
                  fromExtTokenAccount,
                  toMTokenAccount,
                })
                .signers([$.nonWrapAuthority])
                .rpc(),
              "NotAuthorized"
            );
          });

          // given a wrap authority is not provided
          // given the token authority is in the wrap authorities list
          // give the from token account does not have enough ext tokens
          // it unwraps the from token account's total balance of ext tokens
          test("Not enough ext tokens, unwraps user's total balance - success", async () => {
            // Get the balance of the from ext token account
            const fromExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(
                    fromExtTokenAccount,
                    await $.getCurrentMultiplier()
                  )
                : await $.getTokenBalance(fromExtTokenAccount);

            vaultMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.getMVault()
            );
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toMTokenAccountBalance = await $.getTokenBalance(
              toMTokenAccount
            );

            // Create a random amount to unwrap that is greater than the balance
            const unwrapAmount = new BN(
              randomInt(fromExtTokenAccountBalance.toNumber() + 1, 2 ** 48 - 1)
            );

            // Send the unwrap
            await $.ext.methods
              .unwrap(unwrapAmount)
              .accounts({
                tokenAuthority: $.wrapAuthority.publicKey,
                unwrapAuthority: $.ext.programId,
                fromExtTokenAccount,
                toMTokenAccount,
              })
              .signers([$.wrapAuthority])
              .rpc();

            $.expectTokenBalance(fromExtTokenAccount, new BN(0));
            $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.sub(fromExtTokenAccountBalance),
              Comparison.GreaterThanOrEqual,
              new BN(2)
            );
            $.expectTokenBalance(
              toMTokenAccount,
              toMTokenAccountBalance.add(fromExtTokenAccountBalance),
              Comparison.LessThanOrEqual,
              new BN(2)
            );
          });

          // given a wrap authority is not provided
          // given the token authority is in the wrap authorities list
          // given the from token account has enough ext tokens
          // given the token authority is not the owner of the from ext token account, but is delegated
          // it burns the amount of ext tokens from the from's ext token account
          // it transfers the amount of M tokens from the M vault token account to the to's M token account
          test("Unwrap with delegated authority - success", async () => {
            const unwrapAmount = new BN(
              randomInt(1, wrappedAmount.toNumber() + 1)
            );

            // Approve (delegate) the wrap authority to spend the non-wrap authority's ext tokens
            const { sourceATA: fromExtTokenAccount } = await $.approve(
              $.nonWrapAuthority,
              $.wrapAuthority.publicKey,
              $.extMint.publicKey,
              unwrapAmount
            );
            toMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.nonWrapAuthority.publicKey
            );

            // Cache initial balances
            const fromExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(fromExtTokenAccount)
                : await $.getTokenBalance(fromExtTokenAccount);
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toMTokenAccountBalance = await $.getTokenBalance(
              toMTokenAccount
            );

            // Send the instruction
            await $.ext.methods
              .unwrap(unwrapAmount)
              .accounts({
                tokenAuthority: $.wrapAuthority.publicKey,
                unwrapAuthority: $.ext.programId,
                fromExtTokenAccount,
                toMTokenAccount,
              })
              .signers([$.wrapAuthority])
              .rpc();

            // Confirm updated balances
            variant === Variant.ScaledUiAmount
              ? await $.expectTokenUiBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount),
                  Comparison.LessThanOrEqual,
                  new BN(2)
                )
              : await $.expectTokenBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount)
                );
            await $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.sub(unwrapAmount),
              Comparison.GreaterThanOrEqual,
              new BN(2)
            );
            await $.expectTokenBalance(
              toMTokenAccount,
              toMTokenAccountBalance.add(unwrapAmount),
              Comparison.LessThanOrEqual,
              new BN(2)
            );
          });

          // given a wrap authority is not provided
          // given the token authority is in the wrap authorities list
          // given the from token account has enough ext tokens
          // it transfers the amount of M tokens from the M vault token account to the user's M token account
          // it burns the amount of ext tokens from the user's ext token account
          test("Unwrap to wrap authority account - success", async () => {
            // Cache initial balances
            const fromExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(fromExtTokenAccount)
                : await $.getTokenBalance(fromExtTokenAccount);
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toMTokenAccountBalance = await $.getTokenBalance(
              toMTokenAccount
            );

            const unwrapAmount = new BN(
              randomInt(1, wrappedAmount.toNumber() + 1)
            );

            // Send the instruction
            await $.ext.methods
              .unwrap(unwrapAmount)
              .accountsPartial({
                tokenAuthority: $.wrapAuthority.publicKey,
                unwrapAuthority: $.ext.programId,
                fromExtTokenAccount,
                toMTokenAccount,
              })
              .signers([$.wrapAuthority])
              .rpc();

            // Confirm updated balances
            await $.expectTokenBalance(
              toMTokenAccount,
              toMTokenAccountBalance.add(unwrapAmount),
              Comparison.LessThanOrEqual,
              new BN(2)
            );
            await $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.sub(unwrapAmount),
              Comparison.GreaterThanOrEqual,
              new BN(2)
            );
            variant === Variant.ScaledUiAmount
              ? await $.expectTokenUiBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount),
                  Comparison.LessThanOrEqual,
                  new BN(2)
                )
              : await $.expectTokenBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount)
                );
          });

          // given a wrap authority is not provided
          // given the token authority is in the wrap authorities list
          // given the from token account has enough ext tokens
          // it transfers the amount of M tokens from the M vault token account to the to M token account
          // it burns the amount of ext tokens from the from ext token account
          test("Unwrap to different account - success", async () => {
            toMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.nonWrapAuthority.publicKey
            );

            // Cache initial balances
            const fromExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(fromExtTokenAccount)
                : await $.getTokenBalance(fromExtTokenAccount);
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toMTokenAccountBalance = await $.getTokenBalance(
              toMTokenAccount
            );

            const unwrapAmount = new BN(
              randomInt(1, wrappedAmount.toNumber() + 1)
            );

            // Send the instruction
            await $.ext.methods
              .unwrap(unwrapAmount)
              .accounts({
                tokenAuthority: $.wrapAuthority.publicKey,
                unwrapAuthority: $.ext.programId,
                fromExtTokenAccount,
                toMTokenAccount,
              })
              .signers([$.wrapAuthority])
              .rpc();

            // Confirm updated balances
            await $.expectTokenBalance(
              toMTokenAccount,
              toMTokenAccountBalance.add(unwrapAmount),
              Comparison.LessThanOrEqual,
              new BN(2)
            );
            await $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.sub(unwrapAmount),
              Comparison.GreaterThanOrEqual,
              new BN(2)
            );
            variant === Variant.ScaledUiAmount
              ? await $.expectTokenUiBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount),
                  Comparison.LessThanOrEqual,
                  new BN(2)
                )
              : await $.expectTokenBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount)
                );
          });

          // given a wrap authority is provided
          // given the wrap authority does not sign the transaction
          // it reverts
          test("Wrap authority does not sign - reverts", async () => {
            fromExtTokenAccount = await $.getATA(
              $.extMint.publicKey,
              $.nonWrapAuthority.publicKey
            );
            toMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.nonWrapAuthority.publicKey
            );

            // Attempt to send the transaction
            // Expect revert
            await $.expectSystemError(
              $.ext.methods
                .unwrap(wrappedAmount)
                .accounts({
                  tokenAuthority: $.nonWrapAuthority.publicKey,
                  unwrapAuthority: $.wrapAuthority.publicKey,
                  fromExtTokenAccount,
                  toMTokenAccount,
                })
                .signers([$.nonWrapAuthority])
                .rpc()
            );
          });

          // given a wrap authority is provided
          // given the wrap authority is not on the wrap authorities list
          // it reverts with a NotAuthorized error
          test("Wrap authority not on wrap authorities list - reverts", async () => {
            fromExtTokenAccount = await $.getATA(
              $.extMint.publicKey,
              $.nonWrapAuthority.publicKey
            );
            toMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.nonWrapAuthority.publicKey
            );

            // Attempt to send the transaction
            // Expect revert with a NotAuthorized error
            await $.expectAnchorError(
              $.ext.methods
                .unwrap(wrappedAmount)
                .accounts({
                  tokenAuthority: $.nonWrapAuthority.publicKey,
                  unwrapAuthority: $.nonAdmin.publicKey,
                  fromExtTokenAccount,
                  toMTokenAccount,
                })
                .signers([$.nonWrapAuthority, $.nonAdmin])
                .rpc(),
              "NotAuthorized"
            );
          });

          // given a wrap authority is provided
          // given the wrap authority is on the wrap authorities list
          // given the from token account does not have enough ext tokens
          // it unwraps the from token account's total balance of ext tokens
          test("Not enough ext tokens, unwraps user's total balance - wrap authority - success", async () => {
            fromExtTokenAccount = await $.getATA(
              $.extMint.publicKey,
              $.nonWrapAuthority.publicKey
            );
            toMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.nonWrapAuthority.publicKey
            );
            vaultMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.getMVault()
            );

            // Get the balance of the from ext token account
            const fromExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(
                    fromExtTokenAccount,
                    await $.getCurrentMultiplier()
                  )
                : await $.getTokenBalance(fromExtTokenAccount);
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toMTokenAccountBalance = await $.getTokenBalance(
              toMTokenAccount
            );

            const unwrapAmount = new BN(
              randomInt(fromExtTokenAccountBalance.toNumber() + 1, 2 ** 48 - 1)
            );

            // Send the unwrap
            await $.ext.methods
              .unwrap(unwrapAmount)
              .accounts({
                tokenAuthority: $.nonWrapAuthority.publicKey,
                unwrapAuthority: $.wrapAuthority.publicKey,
                fromExtTokenAccount,
                toMTokenAccount,
              })
              .signers([$.nonWrapAuthority, $.wrapAuthority])
              .rpc();

            $.expectTokenBalance(fromExtTokenAccount, new BN(0));
            $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.sub(fromExtTokenAccountBalance),
              Comparison.GreaterThanOrEqual,
              new BN(2)
            );
            $.expectTokenBalance(
              toMTokenAccount,
              toMTokenAccountBalance.add(fromExtTokenAccountBalance),
              Comparison.LessThanOrEqual,
              new BN(2)
            );
          });

          // given a wrap authority is provided
          // given the wrap authority is on the wrap authorities list
          // given the from token account has enough ext tokens
          // given the token authority is not the owner of the from ext token account, but is delegated
          // it burns the amount of ext tokens from the from's ext token account
          // it transfers the amount of M tokens from the M vault token account to the to's M token account
          test("Unwrap with delegated authority - wrap authority - success", async () => {
            vaultMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.getMVault()
            );
            toMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.nonWrapAuthority.publicKey
            );

            // Approve (delegate) the nonAdmin to spend the non-wrap authority's ext tokens
            const { sourceATA: fromExtTokenAccount } = await $.approve(
              $.nonWrapAuthority,
              $.nonAdmin.publicKey,
              $.extMint.publicKey,
              wrappedAmount
            );

            // Cache initial balances
            const fromExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(fromExtTokenAccount)
                : await $.getTokenBalance(fromExtTokenAccount);
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toMTokenAccountBalance = await $.getTokenBalance(
              toMTokenAccount
            );

            const unwrapAmount = new BN(
              randomInt(1, wrappedAmount.toNumber() + 1)
            );

            // Send the instruction
            await $.ext.methods
              .unwrap(unwrapAmount)
              .accounts({
                tokenAuthority: $.nonAdmin.publicKey,
                unwrapAuthority: $.wrapAuthority.publicKey,
                fromExtTokenAccount,
                toMTokenAccount,
              })
              .signers([$.nonAdmin, $.wrapAuthority])
              .rpc();
          });

          // given a wrap authority is provided
          // given the wrap authority is on the wrap authorities list
          // given the from token account has enough ext tokens
          // given the token authority is the owner of the from ext token account
          // it burns the amount of ext tokens from the from's ext token account
          // it transfers the amount of M tokens from the M vault token account to the to's M token account
          test("Unwrap with owner authority - wrap authority - success", async () => {
            fromExtTokenAccount = await $.getATA(
              $.extMint.publicKey,
              $.nonWrapAuthority.publicKey
            );
            toMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.nonWrapAuthority.publicKey
            );
            vaultMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.getMVault()
            );

            // Cache initial balances
            const fromExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(fromExtTokenAccount)
                : await $.getTokenBalance(fromExtTokenAccount);
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toMTokenAccountBalance = await $.getTokenBalance(
              toMTokenAccount
            );

            const unwrapAmount = new BN(
              randomInt(1, wrappedAmount.toNumber() + 1)
            );

            // Send the instruction
            await $.ext.methods
              .unwrap(unwrapAmount)
              .accounts({
                tokenAuthority: $.nonWrapAuthority.publicKey,
                unwrapAuthority: $.wrapAuthority.publicKey,
                fromExtTokenAccount,
                toMTokenAccount,
              })
              .signers([$.nonWrapAuthority, $.wrapAuthority])
              .rpc();

            // Confirm updated balances
            await $.expectTokenBalance(
              toMTokenAccount,
              toMTokenAccountBalance.add(unwrapAmount),
              Comparison.LessThanOrEqual,
              new BN(2)
            );
            await $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.sub(unwrapAmount),
              Comparison.GreaterThanOrEqual,
              new BN(2)
            );
            variant === Variant.ScaledUiAmount
              ? await $.expectTokenUiBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount),
                  Comparison.LessThanOrEqual,
                  new BN(2)
                )
              : await $.expectTokenBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount)
                );
          });
        });

        describe("index different from start", () => {
          const newIndex = new BN(
            randomInt(startIndex.toNumber() + 1, 2e12 + 1)
          );
          let newMultiplier: number = 1.0;
          let vaultBalanceAtNewIndex: BN;

          beforeEach(async () => {
            // Reset the blockhash to avoid issues with duplicate transactions from multiple claim cycles
            $.svm.expireBlockhash();

            // Propagate the new index
            await $.propagateIndex(newIndex);

            // Get the vault balance at the new index
            vaultBalanceAtNewIndex = await $.getTokenBalance(
              vaultMTokenAccount
            );

            // Calculate the expected multipler after the new index push
            if (variant === Variant.ScaledUiAmount) {
              newMultiplier = await $.getNewMultiplier(newIndex);
            }
          });

          // test cases
          // [X] given there are no flows before the yield is distributed
          //   [X] it unwraps the amount of M tokens from the M vault token account to the user's M token account
          //   [X] it burns the correct amount of ext tokens from the user's ext token account
          //   [X] the extension is solvent
          // [X] given there are net inflows before the yield is distributed
          //   [X] it unwraps the amount of M tokens from the M vault token account to the user's M token account
          //   [X] it unwraps the correct amount of ext tokens from the user's ext token account
          //   [X] the extension is solvent
          // [X] given there are net outflows before the yield is distributed
          //   [X] it unwraps the amount of M tokens from the M vault token account to the user's M token account
          //   [X] it unwraps the correct amount of ext tokens from the user's ext token account
          //   [X] the extension is solvent

          // given yield has been minted to the m vault for the new index
          // it unwraps the amount of M tokens from the M vault token account to the user's M token account
          test("Unwrap with new index - no flows - success", async () => {
            // Mint yield to the m vault for the new index
            await $.mClaimFor($.getMVault(), vaultBalanceAtNewIndex);
            await $.mCompleteClaims();

            // Cache initial balances
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toMTokenAccountBalance = await $.getTokenBalance(
              toMTokenAccount
            );
            const fromExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(fromExtTokenAccount, newMultiplier)
                : await $.getTokenBalance(fromExtTokenAccount);

            const unwrapAmount = new BN(
              randomInt(1, fromExtTokenAccountBalance.toNumber() + 1)
            );

            // Send the instruction
            await $.ext.methods
              .unwrap(unwrapAmount)
              .accounts({
                tokenAuthority: $.wrapAuthority.publicKey,
                unwrapAuthority: $.ext.programId,
                fromExtTokenAccount,
                toMTokenAccount,
              })
              .signers([$.wrapAuthority])
              .rpc();

            // Confirm updated balances
            await $.expectTokenBalance(
              toMTokenAccount,
              toMTokenAccountBalance.add(unwrapAmount),
              Comparison.LessThanOrEqual,
              new BN(2)
            );
            await $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.sub(unwrapAmount),
              Comparison.GreaterThanOrEqual,
              new BN(2)
            );
            variant === Variant.ScaledUiAmount
              ? await $.expectTokenUiBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount),
                  Comparison.LessThanOrEqual,
                  new BN(2)
                )
              : await $.expectTokenBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount)
                );

            // Confirm the extension is solvent
            await $.expectExtSolvent();
          });

          // given there are net inflows before the yield is distributed
          // it unwraps the amount of M tokens from the M vault token account to the user's M token account
          // it unwraps the correct amount of ext tokens from the user's ext token account
          // the extension is solvent
          test("Unwrap - extension has inflows - success", async () => {
            // Mint and wrap additional tokens prior to claim
            const inflows = new BN(
              randomInt(100, wrappedAmount.toNumber() + 1)
            );
            await $.mintM($.admin.publicKey, inflows);
            await $.wrap($.admin, inflows);

            // Mint yield to the m vault for the new index
            await $.mClaimFor($.getMVault(), vaultBalanceAtNewIndex);
            await $.mCompleteClaims();

            // Cache initial balances
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toMTokenAccountBalance = await $.getTokenBalance(
              toMTokenAccount
            );
            const fromExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(fromExtTokenAccount, newMultiplier)
                : await $.getTokenBalance(fromExtTokenAccount);

            const unwrapAmount = new BN(
              randomInt(1, fromExtTokenAccountBalance.toNumber() + 1)
            );

            // Send the instruction
            await $.ext.methods
              .unwrap(unwrapAmount)
              .accounts({
                tokenAuthority: $.wrapAuthority.publicKey,
                unwrapAuthority: $.ext.programId,
                fromExtTokenAccount,
                toMTokenAccount,
              })
              .signers([$.wrapAuthority])
              .rpc();

            // Confirm updated balances
            await $.expectTokenBalance(
              toMTokenAccount,
              toMTokenAccountBalance.add(unwrapAmount),
              Comparison.LessThanOrEqual,
              new BN(2)
            );
            await $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.sub(unwrapAmount),
              Comparison.GreaterThanOrEqual,
              new BN(2)
            );
            variant === Variant.ScaledUiAmount
              ? await $.expectTokenUiBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount),
                  Comparison.LessThanOrEqual,
                  new BN(2)
                )
              : await $.expectTokenBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount)
                );

            // Confirm the extension is solvent
            await $.expectExtSolvent();
          });

          // given there are net outflows before the yield is distributed
          // it unwraps the amount of M tokens from the M vault token account to the user's M token account
          // it unwraps the correct amount of ext tokens from the user's ext token account
          // the extension is solvent
          test("Unwrap - extension has outflows - success", async () => {
            // Unwrap tokens prior to claim
            const outflows = new BN(
              randomInt(100, initialWrappedAmount.toNumber() + 1)
            );
            await $.unwrap($.admin, outflows);

            // Mint yield to the m vault for the new index
            await $.mClaimFor($.getMVault(), vaultBalanceAtNewIndex);
            await $.mCompleteClaims();

            // Cache initial balances
            const vaultMTokenAccountBalance = await $.getTokenBalance(
              vaultMTokenAccount
            );
            const toMTokenAccountBalance = await $.getTokenBalance(
              toMTokenAccount
            );
            const fromExtTokenAccountBalance =
              variant === Variant.ScaledUiAmount
                ? await $.getTokenUiBalance(fromExtTokenAccount, newMultiplier)
                : await $.getTokenBalance(fromExtTokenAccount);

            const unwrapAmount = new BN(
              randomInt(1, fromExtTokenAccountBalance.toNumber() + 1)
            );

            // Send the instruction
            await $.ext.methods
              .unwrap(unwrapAmount)
              .accounts({
                tokenAuthority: $.wrapAuthority.publicKey,
                unwrapAuthority: $.ext.programId,
                fromExtTokenAccount,
                toMTokenAccount,
              })
              .signers([$.wrapAuthority])
              .rpc();

            // Confirm updated balances
            await $.expectTokenBalance(
              toMTokenAccount,
              toMTokenAccountBalance.add(unwrapAmount),
              Comparison.LessThanOrEqual,
              new BN(2)
            );
            await $.expectTokenBalance(
              vaultMTokenAccount,
              vaultMTokenAccountBalance.sub(unwrapAmount),
              Comparison.GreaterThanOrEqual,
              new BN(2)
            );
            variant === Variant.ScaledUiAmount
              ? await $.expectTokenUiBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount),
                  Comparison.LessThanOrEqual,
                  new BN(2)
                )
              : await $.expectTokenBalance(
                  fromExtTokenAccount,
                  fromExtTokenAccountBalance.sub(unwrapAmount)
                );

            // Confirm the extension is solvent
            await $.expectExtSolvent();
          });
        });
      });
    });

    if (variant !== Variant.NoYield) {
      describe("open instruction tests", () => {
        describe("sync unit tests", () => {
          const initialWrappedAmount = new BN(10_000_000); // 10 with 6 decimals

          let wrapAuthorities: PublicKey[];
          let vaultMTokenAccount: PublicKey;
          const feeBps = new BN(randomInt(10000));

          const startIndex = new BN(
            randomInt(initialIndex.toNumber() + 1, 2e12)
          );

          // Setup accounts with M tokens so we can test wrapping and unwrapping
          beforeEach(async () => {
            wrapAuthorities = [$.admin.publicKey, $.wrapAuthority.publicKey];
            vaultMTokenAccount = await $.getATA(
              $.mMint.publicKey,
              $.getMVault()
            );

            // Initialize the extension program
            await $.initializeExt(wrapAuthorities, feeBps);

            // Wrap some tokens from the admin to the make the m vault's balance non-zero
            await $.wrap($.admin, initialWrappedAmount);

            // Warp ahead slightly to change the timestamp of the new index
            $.warp(new BN(60), true);

            // Propagate the start index
            await $.propagateIndex(startIndex);

            // Claim yield for the m vault and complete the claim cycle
            // so that the m vault is collateralized to start
            await $.mClaimFor(
              $.getMVault(),
              await $.getTokenBalance(vaultMTokenAccount)
            );
            await $.mCompleteClaims();

            // Reset the blockhash to avoid issues with duplicate transactions from multiple claim cycles
            $.svm.expireBlockhash();
          });

          // test cases
          // [X] given m earner account does not match the derived PDA
          //   [X] it reverts with an InvalidAccount error
          // [X] given the ext mint account does not match the one stored in the global account
          //   [X] it reverts with an InvalidMint error
          // [X] given the ext mint authority account does match the derived PDA
          //   [X] it reverts with a ConstraintSeeds error
          // [X] given the multiplier is already up to date
          //   [X] it remains the same
          // [X] given the multiplier is not up to date
          //   [X] given the m vault has not received yield to match the latest M index
          //     [X] it reverts with an InsufficientCollateral error
          //   [X] given the m vault has received yield to match the latest M index
          //     [X] it updates the scaled ui config on the ext mint to match the m index

          // given m earner account does not match the derived PDA
          // it reverts with an ConstraintSeeds / AccountNotInitialized error
          test("M earn global account does not match derived account - reverts", async () => {
            // Change the m earn global account
            const mEarnGlobalAccount = PublicKey.unique();
            if (mEarnGlobalAccount.equals($.getEarnGlobalAccount())) {
              return;
            }

            // Attempt to send the transaction
            // Expect an invalid account error (though could be others like not initialized)
            await $.expectSystemError(
              $.ext.methods
                .sync()
                .accountsPartial({
                  mEarnGlobalAccount,
                })
                .signers([])
                .rpc()
            );
          });

          // given the ext mint account does not match the one stored in the global account
          // it reverts with an InvalidMint error
          test("Ext mint account does not match global account - reverts", async () => {
            // Create a new mint
            const newMint = Keypair.generate();
            await $.createMint(newMint, $.nonAdmin.publicKey, true, 6);

            // Attempt to send the transaction
            // Expect an invalid account error
            await $.expectAnchorError(
              $.ext.methods
                .sync()
                .accountsPartial({
                  extMint: newMint.publicKey,
                })
                .signers([])
                .rpc(),
              "InvalidMint"
            );
          });

          // given the ext mint authority account does match the derived PDA
          // it reverts with a ConstraintSeeds error
          test("Ext mint authority account does not match derived PDA - reverts", async () => {
            // Change the ext mint authority account
            const extMintAuthority = PublicKey.unique();
            if (extMintAuthority.equals($.getExtMintAuthority())) {
              return;
            }

            // Attempt to send the transaction
            // Expect an invalid account error
            await $.expectAnchorError(
              $.ext.methods
                .sync()
                .accountsPartial({
                  extMintAuthority,
                })
                .signers([])
                .rpc(),
              "ConstraintSeeds"
            );
          });

          // given the multiplier is already up to date
          // it remains the same
          // the extension is solvent
          test("Multiplier is already up to date - success", async () => {
            // Sync the multiplier to the start index
            await $.sync();

            // Load the scaled ui config
            const scaledUiAmountConfig = await $.getScaledUiAmountConfig(
              $.extMint.publicKey
            );

            $.svm.expireBlockhash();

            // Sync again
            await $.sync();

            // Confirm the scaled ui config on the ext mint is the same
            $.expectScaledUiAmountConfig(
              $.extMint.publicKey,
              scaledUiAmountConfig
            );

            await $.expectExtSolvent();
          });

          // given the m vault has received yield to match the latest M index
          // it updates the scaled ui config on the ext mint to match the m index
          // the extension is solvent
          test("M vault has had yield claimed for the latest M index - success", async () => {
            // Cache the scaled ui amount config
            const scaledUiAmountConfig = await $.getScaledUiAmountConfig(
              $.extMint.publicKey
            );

            // Send the instruction
            await $.ext.methods.sync().accounts({}).signers([]).rpc();

            // Confirm the scaled ui config on the ext mint matches the m index
            const multiplier = await $.getCurrentMultiplier();

            await $.expectScaledUiAmountConfig($.extMint.publicKey, {
              authority: scaledUiAmountConfig.authority,
              multiplier,
              newMultiplier: multiplier,
              newMultiplierEffectiveTimestamp: BigInt(
                $.currentTime().toString()
              ),
            });

            await $.expectExtSolvent();
          });

          // given the m vault has not received yield to match the latest M index
          // it updates the scaled ui config on the ext mint to match the m index
          // the extension doesn't need to be solvent, but should be later
          test("M vault has not had yield claimed for the latest M index - success", async () => {
            // Propagate a new index that is greater than the start index
            const newIndex = new BN(
              randomInt(startIndex.toNumber() + 1, 2e12 + 1)
            );
            const newMultiplier = await $.getNewMultiplier(newIndex);
            await $.propagateIndex(newIndex);

            // Cache the scaled ui amount config
            const scaledUiAmountConfig = await $.getScaledUiAmountConfig(
              $.extMint.publicKey
            );

            // Send the instruction
            await $.ext.methods.sync().accounts({}).signers([]).rpc();

            // Confirm the scaled ui config on the ext mint matches the m index
            await $.expectScaledUiAmountConfig($.extMint.publicKey, {
              authority: scaledUiAmountConfig.authority,
              multiplier: newMultiplier,
              newMultiplier: newMultiplier,
              newMultiplierEffectiveTimestamp: BigInt(
                $.currentTime().toString()
              ),
            });
          });
        });
      });
    }
  });
}

import { BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { ExtensionSwapTest } from "./ext_test_harness";

describe("extension swap tests (new)", () => {
  let $: ExtensionSwapTest;

  beforeAll(async () => {
    // Initialize the test harness
    $ = new ExtensionSwapTest();

    // Initialize with 1M initial supply and 1T initial earn index
    // Handles setting up of swapper keypair
    await $.init(new BN(1_000_000), new BN(1_000_000_000_000));
  });

  // Helper function to get token account addresses
  const getTokenAccounts = async () => ({
    ataA: await $.getATA(
      $.getExtensionMint("mintA"),
      $.swapperKeypair.publicKey
    ),
    ataB: await $.getATA(
      $.getExtensionMint("mintB"),
      $.swapperKeypair.publicKey
    ),
    ataC: await $.getATA(
      $.getExtensionMint("mintC"),
      $.swapperKeypair.publicKey
    ),
    ataM: await $.getATA($.mMint.publicKey, $.swapperKeypair.publicKey),
  });

  describe("configure swap program", () => {
    it("should whitelist extension programs", async () => {
      // Whitelist all extension programs
      await $.whitelistExtension(
        $.getExtensionProgramId("extA"),
        $.getExtensionMint("mintA")
      );
      await $.whitelistExtension(
        $.getExtensionProgramId("extB"),
        $.getExtensionMint("mintB")
      );
      await $.whitelistExtension(
        $.getExtensionProgramId("extC"),
        $.getExtensionMint("mintC")
      );

      // Verify extensions are whitelisted
      const swapGlobal = await $.swapProgram.account.swapGlobal.fetch(
        $.getSwapGlobalAccount()
      );
      expect(swapGlobal.whitelistedExtensions).toHaveLength(3);
    });

    it("should fail to re-initialize config", async () => {
      await expect(
        $.swapProgram.methods
          .initializeGlobal()
          .accounts({
            admin: $.swapperKeypair.publicKey,
          })
          .signers([$.swapperKeypair])
          .rpc()
      ).rejects.toThrow();
    });

    it("should whitelist unwrapper", async () => {
      await $.whitelistUnwrapper($.swapperKeypair.publicKey);

      const swapGlobal = await $.swapProgram.account.swapGlobal.fetch(
        $.getSwapGlobalAccount()
      );
      expect(swapGlobal.whitelistedUnwrappers).toHaveLength(1);
      expect(swapGlobal.whitelistedUnwrappers[0].toBase58()).toBe(
        $.swapperKeypair.publicKey.toBase58()
      );
    });

    it("should fail to remove non-existent extension", async () => {
      const randomKey = new Keypair().publicKey;
      await expect(
        $.swapProgram.methods
          .removeWhitelistedExtension(randomKey)
          .accounts({
            admin: $.admin.publicKey,
          })
          .signers([$.admin])
          .rpc()
      ).rejects.toThrow();
    });

    it("should remove from unwrap whitelist", async () => {
      await $.swapProgram.methods
        .removeWhitelistedUnwrapper($.swapperKeypair.publicKey)
        .accounts({
          admin: $.admin.publicKey,
        })
        .signers([$.admin])
        .rpc();

      const swapGlobal = await $.swapProgram.account.swapGlobal.fetch(
        $.getSwapGlobalAccount()
      );
      expect(swapGlobal.whitelistedUnwrappers).toHaveLength(0);

      // Expire the blockhash before re-adding
      $.svm.expireBlockhash();

      // Re-add for later tests
      await $.whitelistUnwrapper($.swapperKeypair.publicKey);
    });

    it("should remove from ext whitelist", async () => {
      await $.swapProgram.methods
        .removeWhitelistedExtension($.getExtensionProgramId("extA"))
        .accounts({
          admin: $.admin.publicKey,
        })
        .signers([$.admin])
        .rpc();

      const swapGlobal = await $.swapProgram.account.swapGlobal.fetch(
        $.getSwapGlobalAccount()
      );
      expect(swapGlobal.whitelistedExtensions).toHaveLength(2);

      // Expire the blockhash before re-adding
      $.svm.expireBlockhash();

      // Re-add for later tests
      await $.whitelistExtension(
        $.getExtensionProgramId("extA"),
        $.getExtensionMint("mintA")
      );
    });

    it("should reset whitelists", async () => {
      let swapGlobal = await $.swapProgram.account.swapGlobal.fetch(
        $.getSwapGlobalAccount()
      );
      expect(swapGlobal.whitelistedExtensions).toHaveLength(3);
      expect(swapGlobal.whitelistedUnwrappers).toHaveLength(1);

      // Reset whitelists
      await $.swapProgram.methods
        .resetWhitelists()
        .accounts({
          admin: $.admin.publicKey,
        })
        .signers([$.admin])
        .rpc();

      swapGlobal = await $.swapProgram.account.swapGlobal.fetch(
        $.getSwapGlobalAccount()
      );
      expect(swapGlobal.whitelistedExtensions).toHaveLength(0);
      expect(swapGlobal.whitelistedUnwrappers).toHaveLength(0);

      // Expire the blockhash before re-adding
      $.svm.expireBlockhash();

      // Re-add for later tests
      await $.whitelistExtension(
        $.getExtensionProgramId("extA"),
        $.getExtensionMint("mintA")
      );
      await $.whitelistExtension(
        $.getExtensionProgramId("extB"),
        $.getExtensionMint("mintB")
      );
      await $.whitelistExtension(
        $.getExtensionProgramId("extC"),
        $.getExtensionMint("mintC")
      );
      await $.whitelistUnwrapper($.swapperKeypair.publicKey);

      swapGlobal = await $.swapProgram.account.swapGlobal.fetch(
        $.getSwapGlobalAccount()
      );
      expect(swapGlobal.whitelistedExtensions).toHaveLength(3);
      expect(swapGlobal.whitelistedUnwrappers).toHaveLength(1);

      $.svm.expireBlockhash();
    });

    it("should add wrap authorities to extensions", async () => {
      const swapGlobal = $.getSwapGlobalAccount();

      // Add swap program as wrap authority to all extensions
      await $.addWrapAuthorityToExtension("extA", swapGlobal);
      await $.addWrapAuthorityToExtension("extB", swapGlobal);
      await $.addWrapAuthorityToExtension("extC", swapGlobal);
    });
  });

  describe("basic swapping operations", () => {
    it("should wrap M to extension token A", async () => {
      const accounts = await getTokenAccounts();

      await $.swapProgram.methods
        .wrap(new BN(10_000))
        .accounts({
          signer: $.swapperKeypair.publicKey,
          wrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
          mMint: $.mMint.publicKey,
          mTokenAccount: accounts.ataM,
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          toExtProgram: $.getExtensionProgramId("extA"),
          toMint: $.getExtensionMint("mintA"),
          toTokenAccount: accounts.ataA,
          toTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([$.swapperKeypair])
        .rpc();

      // Verify token balances
      await $.expectTokenBalance(accounts.ataM, new BN(990_000));
      await $.expectTokenBalance(accounts.ataA, new BN(10_000));
    });

    it("should unwrap extension token A back to M", async () => {
      const accounts = await getTokenAccounts();

      await $.swapProgram.methods
        .unwrap(new BN(1_000))
        .accounts({
          signer: $.swapperKeypair.publicKey, // must be a whitelisted unwrapper on the swap program
          unwrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority on CPI
          mMint: $.mMint.publicKey,
          mTokenAccount: accounts.ataM,
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          fromExtProgram: $.getExtensionProgramId("extA"),
          fromTokenAccount: accounts.ataA,
          fromMint: $.getExtensionMint("mintA"),
          fromTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([$.swapperKeypair])
        .rpc();

      // Verify token balances
      await $.expectTokenBalance(accounts.ataM, new BN(991_000));
      await $.expectTokenBalance(accounts.ataA, new BN(9_000));
    });

    it("should swap extension token A to extension token B", async () => {
      const accounts = await getTokenAccounts();

      await $.swapProgram.methods
        .swap(new BN(1_000), 0)
        .accounts({
          signer: $.swapperKeypair.publicKey,
          unwrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
          wrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
          mMint: $.mMint.publicKey,
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          fromExtProgram: $.getExtensionProgramId("extA"),
          toExtProgram: $.getExtensionProgramId("extB"),
          fromMint: $.getExtensionMint("mintA"),
          toMint: $.getExtensionMint("mintB"),
          fromTokenAccount: accounts.ataA,
          toTokenAccount: accounts.ataB,
          toTokenProgram: TOKEN_2022_PROGRAM_ID,
          fromTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([$.swapperKeypair])
        .rpc();

      // Verify token balances
      await $.expectTokenBalance(accounts.ataM, new BN(991_000));
      await $.expectTokenBalance(accounts.ataA, new BN(8_000));
      await $.expectTokenBalance(accounts.ataB, new BN(1_000));
    });
  });

  describe("error cases", () => {
    // [x] given extension is not whitelisted
    //   [x] it reverts
    // [x] given swap amount is 0
    //   [x] it reverts
    // [x] given swapping to same extension
    //   [x] it reverts with constraint violation

    it("should fail when extension is not whitelisted", async () => {
      // Remove extension C from whitelist first
      await $.swapProgram.methods
        .removeWhitelistedExtension($.getExtensionProgramId("extC"))
        .accounts({
          admin: $.admin.publicKey,
        })
        .signers([$.admin])
        .rpc();

      const accounts = await getTokenAccounts();

      // Try to wrap to non-whitelisted extension
      await expect(
        $.swapProgram.methods
          .wrap(new BN(100))
          .accounts({
            signer: $.swapperKeypair.publicKey,
            wrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
            mMint: $.mMint.publicKey,
            mTokenAccount: accounts.ataM,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: $.getExtensionProgramId("extC"),
            toMint: $.getExtensionMint("mintC"),
            toTokenAccount: accounts.ataC,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair])
          .rpc()
      ).rejects.toThrow();
    });

    it("should fail with invalid swap amount", async () => {
      const accounts = await getTokenAccounts();

      await expect(
        $.swapProgram.methods
          .swap(new BN(0), 0)
          .accounts({
            signer: $.swapperKeypair.publicKey,
            unwrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
            wrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
            mMint: $.mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: $.getExtensionProgramId("extA"),
            toExtProgram: $.getExtensionProgramId("extB"),
            fromMint: $.getExtensionMint("mintA"),
            toMint: $.getExtensionMint("mintB"),
            fromTokenAccount: accounts.ataA,
            toTokenAccount: accounts.ataB,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair])
          .rpc()
      ).rejects.toThrow();
    });

    it("should fail when swapping to same extension", async () => {
      const accounts = await getTokenAccounts();

      await expect(
        $.swapProgram.methods
          .swap(new BN(100), 0)
          .accounts({
            signer: $.swapperKeypair.publicKey,
            unwrapAuthority: $.swapProgram.programId,
            wrapAuthority: $.swapProgram.programId,
            mMint: $.mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: $.getExtensionProgramId("extA"),
            toExtProgram: $.getExtensionProgramId("extA"), // Same as from
            fromMint: $.getExtensionMint("mintA"),
            toMint: $.getExtensionMint("mintA"),
            fromTokenAccount: accounts.ataA,
            toTokenAccount: accounts.ataA,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair])
          .rpc()
      ).rejects.toThrow(); // Anchor constraint violation
    });
  });

  describe("remaining accounts tests", () => {
    it("should fail with invalid remaining account index", async () => {
      const accounts = await getTokenAccounts();

      await expect(
        $.swapProgram.methods
          .swap(new BN(100), 1) // Invalid index for 0 remaining accounts
          .accounts({
            signer: $.swapperKeypair.publicKey,
            unwrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
            wrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
            mMint: $.mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: $.getExtensionProgramId("extA"),
            toExtProgram: $.getExtensionProgramId("extB"),
            fromMint: $.getExtensionMint("mintA"),
            toMint: $.getExtensionMint("mintB"),
            fromTokenAccount: accounts.ataA,
            toTokenAccount: accounts.ataB,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair])
          .rpc()
      ).rejects.toThrow();
    });

    it("should handle swap with unneeded remaining accounts", async () => {
      const accounts = await getTokenAccounts();

      try {
        await $.swapProgram.methods
          .swap(new BN(1_000), 1)
          .accounts({
            signer: $.swapperKeypair.publicKey,
            unwrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
            wrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
            mMint: $.mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: $.getExtensionProgramId("extA"),
            toExtProgram: $.getExtensionProgramId("extB"),
            fromMint: $.getExtensionMint("mintA"),
            toMint: $.getExtensionMint("mintB"),
            fromTokenAccount: accounts.ataA,
            toTokenAccount: accounts.ataB,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .remainingAccounts([
            {
              pubkey: new Keypair().publicKey,
              isSigner: false,
              isWritable: false,
            },
            {
              pubkey: new Keypair().publicKey,
              isSigner: false,
              isWritable: false,
            },
          ])
          .signers([$.swapperKeypair])
          .rpc();
      } catch (error) {
        console.error("Swap failed with error:", error);
        throw error;
      }

      // Verify token balances changed correctly
      await $.expectTokenBalance(accounts.ataA, new BN(7_000));
      await $.expectTokenBalance(accounts.ataB, new BN(2_000));
    });

    it("should fail when ext_c expects remaining account but none provided", async () => {
      // Ensure extension C is whitelisted
      await $.whitelistExtension(
        $.getExtensionProgramId("extC"),
        $.getExtensionMint("mintC")
      );

      const accounts = await getTokenAccounts();

      await $.expectSystemError(
        $.swapProgram.methods
          .swap(new BN(1_000), 0)
          .accounts({
            signer: $.swapperKeypair.publicKey,
            unwrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
            wrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
            mMint: $.mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: $.getExtensionProgramId("extA"),
            toExtProgram: $.getExtensionProgramId("extC"),
            fromMint: $.getExtensionMint("mintA"),
            toMint: $.getExtensionMint("mintC"),
            fromTokenAccount: accounts.ataA,
            toTokenAccount: accounts.ataC,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair])
          .rpc()
      );
    });

    it("should fail when ext_c gets incorrect remaining account", async () => {
      const accounts = await getTokenAccounts();

      await $.expectSystemError(
        $.swapProgram.methods
          .swap(new BN(1_000), 0)
          .accounts({
            signer: $.swapperKeypair.publicKey,
            unwrapAuthority: $.swapProgram.programId,
            wrapAuthority: $.swapProgram.programId,
            mMint: $.mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: $.getExtensionProgramId("extA"),
            toExtProgram: $.getExtensionProgramId("extC"),
            fromMint: $.getExtensionMint("mintA"),
            toMint: $.getExtensionMint("mintC"),
            fromTokenAccount: accounts.ataA,
            toTokenAccount: accounts.ataC,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .remainingAccounts([
            {
              pubkey: new Keypair().publicKey,
              isSigner: false,
              isWritable: false,
            },
          ])
          .signers([$.swapperKeypair])
          .rpc()
      );
    });

    it("should succeed when ext_c gets expected remaining account", async () => {
      const accounts = await getTokenAccounts();

      await $.swapProgram.methods
        .swap(new BN(1_000), 0)
        .accounts({
          signer: $.swapperKeypair.publicKey,
          unwrapAuthority: $.swapProgram.programId,
          wrapAuthority: $.swapProgram.programId,
          mMint: $.mMint.publicKey,
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          fromExtProgram: $.getExtensionProgramId("extA"),
          toExtProgram: $.getExtensionProgramId("extC"),
          fromMint: $.getExtensionMint("mintA"),
          toMint: $.getExtensionMint("mintC"),
          fromTokenAccount: accounts.ataA,
          toTokenAccount: accounts.ataC,
          toTokenProgram: TOKEN_2022_PROGRAM_ID,
          fromTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts([
          {
            pubkey: TOKEN_2022_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
        ])
        .signers([$.swapperKeypair])
        .rpc();

      // Verify token balances changed correctly
      await $.expectTokenBalance(accounts.ataA, new BN(6_000));
      await $.expectTokenBalance(accounts.ataC, new BN(1_000));
    });
  });

  describe("remove extension", () => {
    it("should fail to swap to extension that was removed", async () => {
      // Remove extension A from whitelist first
      $.svm.expireBlockhash();

      await $.swapProgram.methods
        .removeWhitelistedExtension($.getExtensionProgramId("extA"))
        .accounts({
          admin: $.admin.publicKey,
        })
        .signers([$.admin])
        .rpc();

      const accounts = await getTokenAccounts();

      await $.expectAnchorError(
        $.swapProgram.methods
          .swap(new BN(1_000), 0)
          .accounts({
            signer: $.swapperKeypair.publicKey,
            unwrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
            wrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
            mMint: $.mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: $.getExtensionProgramId("extB"),
            toExtProgram: $.getExtensionProgramId("extA"),
            fromMint: $.getExtensionMint("mintB"),
            toMint: $.getExtensionMint("mintA"),
            fromTokenAccount: accounts.ataB,
            toTokenAccount: accounts.ataA,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair])
          .rpc(),
        "InvalidExtension"
      );

      // Re-add for later tests
      await $.whitelistExtension(
        $.getExtensionProgramId("extA"),
        $.getExtensionMint("mintA")
      );
    });
  });

  describe("swap program authority management", () => {
    it("should fail to wrap without proper ext wrap authority on swap program", async () => {
      // Remove swap program as wrap authority from extension A
      const swapGlobal = $.getSwapGlobalAccount();
      await $.extensionPrograms.extA.methods
        .removeWrapAuthority(swapGlobal)
        .accounts({
          admin: $.admin.publicKey,
        })
        .signers([$.admin])
        .rpc();

      const accounts = await getTokenAccounts();

      // Try to wrap (should fail)
      await $.expectAnchorError(
        $.swapProgram.methods
          .wrap(new BN(10))
          .accounts({
            signer: $.swapperKeypair.publicKey,
            wrapAuthority: $.swapProgram.programId,
            mMint: $.mMint.publicKey,
            mTokenAccount: accounts.ataM,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: $.getExtensionProgramId("extA"),
            toMint: $.getExtensionMint("mintA"),
            toTokenAccount: accounts.ataA,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair])
          .rpc(),
        "NotAuthorized"
      );

      // re-add swap program as wrap authority for later tests
      $.svm.expireBlockhash();
      await $.addWrapAuthorityToExtension("extA", swapGlobal);
    });

    it("should fail to wrap with invalid external ext wrap authority co-signer", async () => {
      const accounts = await getTokenAccounts();

      await $.expectAnchorError(
        $.swapProgram.methods
          .wrap(new BN(10))
          .accounts({
            signer: $.swapperKeypair.publicKey,
            wrapAuthority: $.nonAdmin.publicKey,
            mMint: $.mMint.publicKey,
            mTokenAccount: accounts.ataM,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: $.getExtensionProgramId("extA"),
            toMint: $.getExtensionMint("mintA"),
            toTokenAccount: accounts.ataA,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair, $.nonAdmin])
          .rpc(),
        "NotAuthorized"
      );
    });

    it("should wrap with valid wrap authority co-signer", async () => {
      // Add admin as wrap authority
      await $.addWrapAuthorityToExtension("extA", $.nonAdmin.publicKey);

      const accounts = await getTokenAccounts();

      await $.swapProgram.methods
        .wrap(new BN(100))
        .accounts({
          signer: $.swapperKeypair.publicKey,
          wrapAuthority: $.nonAdmin.publicKey,
          mMint: $.mMint.publicKey,
          mTokenAccount: accounts.ataM,
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          toExtProgram: $.getExtensionProgramId("extA"),
          toMint: $.getExtensionMint("mintA"),
          toTokenAccount: accounts.ataA,
          toTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([$.swapperKeypair, $.nonAdmin])
        .rpc();
    });

    it("should fail swap with mismatched authorities", async () => {
      const accounts = await getTokenAccounts();

      // Remove swap program as wrap authority from extension A
      const swapGlobal = $.getSwapGlobalAccount();
      await $.extensionPrograms.extA.methods
        .removeWrapAuthority(swapGlobal)
        .accounts({
          admin: $.admin.publicKey,
        })
        .signers([$.admin])
        .rpc();

      await expect(
        $.swapProgram.methods
          .swap(new BN(15), 0)
          .accounts({
            signer: $.swapperKeypair.publicKey,
            wrapAuthority: $.swapProgram.programId,
            unwrapAuthority: $.admin.publicKey,
            mMint: $.mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: $.getExtensionProgramId("extB"),
            toExtProgram: $.getExtensionProgramId("extA"),
            fromMint: $.getExtensionMint("mintB"),
            toMint: $.getExtensionMint("mintA"),
            fromTokenAccount: accounts.ataB,
            toTokenAccount: accounts.ataA,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair, $.admin])
          .rpc()
      ).rejects.toThrow();

      // re-add swap program as wrap authority for later tests
      $.svm.expireBlockhash();
      await $.addWrapAuthorityToExtension("extA", swapGlobal);
    });

    it("should swap with valid wrap authority", async () => {
      const accounts = await getTokenAccounts();

      await $.swapProgram.methods
        .swap(new BN(15), 0)
        .accounts({
          signer: $.swapperKeypair.publicKey,
          unwrapAuthority: $.admin.publicKey,
          wrapAuthority: $.admin.publicKey,
          mMint: $.mMint.publicKey,
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          fromExtProgram: $.getExtensionProgramId("extB"),
          toExtProgram: $.getExtensionProgramId("extA"),
          fromMint: $.getExtensionMint("mintB"),
          toMint: $.getExtensionMint("mintA"),
          fromTokenAccount: accounts.ataB,
          toTokenAccount: accounts.ataA,
          toTokenProgram: TOKEN_2022_PROGRAM_ID,
          fromTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([$.swapperKeypair, $.admin])
        .rpc();
    });
  });

  describe("unwrapping permissions", () => {
    const cosigner = new Keypair();

    it("should fail when co-signer is not authorized", async () => {
      const accounts = await getTokenAccounts();

      await $.expectAnchorError(
        $.swapProgram.methods
          .unwrap(new BN(100))
          .accounts({
            signer: $.swapperKeypair.publicKey,
            unwrapAuthority: cosigner.publicKey,
            fromExtProgram: $.getExtensionProgramId("extA"),
            fromTokenAccount: accounts.ataA,
            fromMint: $.getExtensionMint("mintA"),
            mMint: $.mMint.publicKey,
            mTokenAccount: accounts.ataM,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair, cosigner])
          .rpc(),
        "UnauthorizedUnwrapper"
      );
    });

    it("should whitelist co-signer", async () => {
      // Fund the cosigner
      $.svm.airdrop(cosigner.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

      await $.whitelistUnwrapper(cosigner.publicKey);

      const swapGlobal = await $.swapProgram.account.swapGlobal.fetch(
        $.getSwapGlobalAccount()
      );

      // Validate the cosigner was added
      expect(swapGlobal.whitelistedUnwrappers).toHaveLength(2);
      expect(swapGlobal.whitelistedUnwrappers[1].toBase58()).toBe(
        cosigner.publicKey.toBase58()
      );

      // Whitelist on extension program
      await $.addWrapAuthorityToExtension("extA", cosigner.publicKey);
    });

    it("should succeed when co-signer is authorized", async () => {
      const accounts = await getTokenAccounts();

      await $.swapProgram.methods
        .unwrap(new BN(1_000))
        .accounts({
          signer: $.swapperKeypair.publicKey,
          unwrapAuthority: cosigner.publicKey,
          fromExtProgram: $.getExtensionProgramId("extA"),
          fromTokenAccount: accounts.ataA,
          fromMint: $.getExtensionMint("mintA"),
          mMint: $.mMint.publicKey,
          mTokenAccount: accounts.ataM,
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          fromTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([$.swapperKeypair, cosigner])
        .rpc();
    });
  });

  describe("wrap authority management", () => {
    it("should manage wrap authorities correctly", async () => {
      // Remove admin as wrap authority from extension A
      await $.extensionPrograms.extA.methods
        .removeWrapAuthority($.admin.publicKey)
        .accounts({
          admin: $.admin.publicKey,
        })
        .signers([$.admin])
        .rpc();

      const accounts = await getTokenAccounts();

      // Try to wrap with removed authority (should fail)
      await expect(
        $.swapProgram.methods
          .wrap(new BN(100))
          .accounts({
            signer: $.swapperKeypair.publicKey,
            wrapAuthority: $.admin.publicKey,
            mMint: $.mMint.publicKey,
            mTokenAccount: accounts.ataM,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: $.getExtensionProgramId("extA"),
            toMint: $.getExtensionMint("mintA"),
            toTokenAccount: accounts.ataA,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair, $.admin])
          .rpc()
      ).rejects.toThrow();

      // Expire the blockhash
      $.svm.expireBlockhash();

      // Add admin back as wrap authority
      await $.addWrapAuthorityToExtension("extA", $.admin.publicKey);

      // Now wrapping with admin authority should work
      await $.swapProgram.methods
        .wrap(new BN(100))
        .accounts({
          signer: $.swapperKeypair.publicKey,
          wrapAuthority: $.admin.publicKey,
          mMint: $.mMint.publicKey,
          mTokenAccount: accounts.ataM,
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          toExtProgram: $.getExtensionProgramId("extA"),
          toMint: $.getExtensionMint("mintA"),
          toTokenAccount: accounts.ataA,
          toTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([$.swapperKeypair, $.admin])
        .rpc();
    });
  });

  // ==========================================================================
  // JMI (Just Mint It) Test Cases
  // ==========================================================================

  describe("wrap_asset operations", () => {
    // ext_swap level validation
    // [x] given the extension is not whitelisted
    //   [x] it reverts with an InvalidExtension error
    // [x] given amount is 0
    //   [x] it reverts with an InvalidAmount error
    // [x] given the caller is not authorized (not in wrap_authorities)
    //   [x] it reverts with a NotAuthorized error
    // [x] given the asset is M (not a stablecoin)
    //   [x] it reverts with an AssetNotAllowed error
    // [x] given the asset_config.cap is 0 (asset not whitelisted)
    //   [x] it reverts with an AccountNotInitialized error
    // [x] given new_balance would exceed asset_config.cap
    //   [x] it reverts with an AssetCapExceeded error
    // [x] given replace_authority is not provided (None)
    //   [x] it uses the fallback_replace_authority PDA
    //   [x] it transfers asset from user to vault
    //   [x] it mints ext tokens 1:1 to user
    //   [x] it increments total_assets on the global account
    // [x] given replace_authority is provided (Some)
    //   [x] it uses the external replace_authority signer
    // [x] given external replace_authority is provided but does not sign
    //   [x] it reverts with Signer constraint violation

    let assetMint: Keypair;
    const wrapAssetCap = new BN(1_000_000_000);
    const wrapAssetAmount = new BN(100_000);

    beforeAll(async () => {
      // Create asset mint (stablecoin)
      assetMint = await $.createAssetMint();

      // Set asset cap on JMI extension (extA)
      await $.setAssetCapOnExtension("extA", assetMint.publicKey, wrapAssetCap);

      // Whitelist replace authority PDA on extension's replace_authorities
      await $.addReplaceAuthorityToExtension("extA", $.getReplaceAuthorityPda());

      // Mint asset tokens to swapper
      await $.mintAssetTokensTo(
        assetMint,
        $.swapperKeypair.publicKey,
        wrapAssetAmount.mul(new BN(10))
      );
    });

    it("should fail when extension is not whitelisted", async () => {
      // Create a new asset mint that's not whitelisted on ext_swap
      const newAssetMint = await $.createAssetMint();
      await $.setAssetCapOnExtension("extA", newAssetMint.publicKey, wrapAssetCap);
      await $.mintAssetTokensTo(newAssetMint, $.swapperKeypair.publicKey, wrapAssetAmount);

      // Remove extA from swap whitelist
      await $.swapProgram.methods
        .removeWhitelistedExtension($.getExtensionProgramId("extA"))
        .accounts({ admin: $.admin.publicKey })
        .signers([$.admin])
        .rpc();

      await $.expectAnchorError(
        $.wrapAssetViaSwap("extA", newAssetMint.publicKey, wrapAssetAmount, $.swapperKeypair),
        "InvalidExtension"
      );

      // Re-add for later tests
      $.svm.expireBlockhash();
      await $.whitelistExtension($.getExtensionProgramId("extA"), $.getExtensionMint("mintA"));
    });

    it("should fail when amount is zero", async () => {
      await $.expectAnchorError(
        $.wrapAssetViaSwap("extA", assetMint.publicKey, new BN(0), $.swapperKeypair),
        "InvalidAmount"
      );
    });

    it("should fail when fallback_replace_authority is not authorized", async () => {
      // Remove fallback_replace_authority PDA from extA's replace_authorities
      await $.extensionPrograms.extA.methods
        .removeReplaceAuthority($.getReplaceAuthorityPda())
        .accounts({ admin: $.admin.publicKey })
        .signers([$.admin])
        .rpc();

      await $.expectAnchorError(
        $.wrapAssetViaSwap("extA", assetMint.publicKey, wrapAssetAmount, $.swapperKeypair),
        "NotAuthorized"
      );

      // Re-add for later tests
      $.svm.expireBlockhash();
      await $.addReplaceAuthorityToExtension("extA", $.getReplaceAuthorityPda());
    });

    it("should fail when asset is M token", async () => {
      // Attempt to use M mint as asset - this should fail because M is not a valid asset
      // The CPI to wrap_asset will fail with AssetNotAllowed since asset_config doesn't exist for M
      await $.expectSystemError(
        $.wrapAssetViaSwap("extA", $.mMint.publicKey, wrapAssetAmount, $.swapperKeypair)
      );
    });

    it("should fail when asset cap is zero", async () => {
      // Create new asset without setting cap (or set cap to 0)
      const uncappedAsset = await $.createAssetMint();
      await $.mintAssetTokensTo(uncappedAsset, $.swapperKeypair.publicKey, wrapAssetAmount);

      // Asset config doesn't exist, so this should fail
      await $.expectAnchorError(
        $.wrapAssetViaSwap("extA", uncappedAsset.publicKey, wrapAssetAmount, $.swapperKeypair),
        "AccountNotInitialized"
      );

    });

    it("should fail when asset cap would be exceeded", async () => {
      // Create asset with low cap
      const lowCapAsset = await $.createAssetMint();
      await $.setAssetCapOnExtension("extA", lowCapAsset.publicKey, new BN(1000));
      await $.mintAssetTokensTo(lowCapAsset, $.swapperKeypair.publicKey, new BN(2000));

      await $.expectAnchorError(
        $.wrapAssetViaSwap("extA", lowCapAsset.publicKey, new BN(1500), $.swapperKeypair),
        "AssetCapExceeded"
      );
    });

    it("should wrap asset with fallback replace authority", async () => {
      const userAssetAta = await $.getATA(assetMint.publicKey, $.swapperKeypair.publicKey, false);
      const userExtAta = await $.getATA($.getExtensionMint("mintA"), $.swapperKeypair.publicKey);
      const mVault = $.getMVaultForExtension($.getExtensionProgramId("extA"));
      const vaultAssetAta = await $.getATA(assetMint.publicKey, mVault, false);

      const initialUserAssetBalance = await $.getTokenBalance(userAssetAta, false);
      const initialVaultAssetBalance = await $.getTokenBalance(vaultAssetAta, false);

      await $.wrapAssetViaSwap("extA", assetMint.publicKey, wrapAssetAmount, $.swapperKeypair);

      // Verify asset transferred from user to vault
      await $.expectTokenBalance(userAssetAta, initialUserAssetBalance.sub(wrapAssetAmount), undefined, undefined, false);
      await $.expectTokenBalance(vaultAssetAta, initialVaultAssetBalance.add(wrapAssetAmount), undefined, undefined, false);

      // Verify ext tokens minted to user (1:1)
      const userExtBalance = await $.getTokenBalance(userExtAta);
      expect(userExtBalance.gte(wrapAssetAmount)).toBe(true);
    });

    it("should wrap asset with external replace authority", async () => {
      const userAssetAta = await $.getATA(assetMint.publicKey, $.swapperKeypair.publicKey, false);
      const initialUserAssetBalance = await $.getTokenBalance(userAssetAta, false);

      await $.wrapAssetViaSwap(
        "extA",
        assetMint.publicKey,
        wrapAssetAmount,
        $.swapperKeypair,
        $.admin // external replace authority
      );

      // Verify wrap succeeded
      await $.expectTokenBalance(userAssetAta, initialUserAssetBalance.sub(wrapAssetAmount), undefined, undefined, false);
    });

    it("should increment total_assets on wrap_asset", async () => {
      // Fetch initial total_assets from extA global account
      const jmiGlobalPda = $.getExtGlobalAccountFor("extA");
      const initialGlobal = await $.extensionPrograms.extA.account.extGlobalV2.fetch(jmiGlobalPda);
      const initialTotalAssets = (initialGlobal.yieldConfig as any).totalAssets as BN;

      // Wrap asset
      const wrapAmount = new BN(5_000);
      await $.wrapAssetViaSwap("extA", assetMint.publicKey, wrapAmount, $.swapperKeypair);

      // Verify total_assets incremented by exact amount
      const finalGlobal = await $.extensionPrograms.extA.account.extGlobalV2.fetch(jmiGlobalPda);
      const finalTotalAssets = (finalGlobal.yieldConfig as any).totalAssets as BN;
      expect(finalTotalAssets.eq(initialTotalAssets.add(wrapAmount))).toBe(true);
    });

    it("should fail when external replace_authority does not sign", async () => {
      const userAssetAta = await $.getATA(assetMint.publicKey, $.swapperKeypair.publicKey, false);
      const userExtAta = await $.getATA($.getExtensionMint("mintA"), $.swapperKeypair.publicKey);
      const mVault = $.getMVaultForExtension($.getExtensionProgramId("extA"));
      const vaultAssetAta = await $.getATA(assetMint.publicKey, mVault, false);
      const toMintAuthority = PublicKey.findProgramAddressSync(
        [Buffer.from("mint_authority")],
        $.getExtensionProgramId("extA")
      )[0];

      // Try to use admin as replace_authority but don't include them as signer
      await expect(
        $.swapProgram.methods
          .wrapAsset(wrapAssetAmount)
          .accountsPartial({
            signer: $.swapperKeypair.publicKey,
            replaceAuthority: $.admin.publicKey, // External authority provided
            fallbackReplaceAuthority: $.getReplaceAuthorityPda(),
            swapGlobal: $.getSwapGlobalAccount(),
            toGlobal: $.getExtGlobalAccountFor("extA"),
            toMint: $.getExtensionMint("mintA"),
            assetMint: assetMint.publicKey,
            assetConfig: $.getAssetConfigAccount("extA", assetMint.publicKey),
            assetTokenAccount: userAssetAta,
            toTokenAccount: userExtAta,
            toVaultAuth: mVault,
            toMintAuthority: toMintAuthority,
            toAssetVault: vaultAssetAta,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            assetTokenProgram: TOKEN_PROGRAM_ID,
            toExtProgram: $.getExtensionProgramId("extA"),
          })
          .signers([$.swapperKeypair]) // Note: $.admin NOT included as signer
          .rpc()
      ).rejects.toThrow(); // Anchor Signer constraint violation
    });
  });

  describe("replace_asset_with_m operations", () => {
    // ext_swap level validation
    // [x] given the source extension (from_ext) is not whitelisted
    //   [x] it reverts with an InvalidExtension error
    // [x] given the JMI extension (jmi_ext) is not whitelisted
    //   [x] it reverts with an InvalidExtension error
    // [x] given from_principal is 0
    //   [x] it reverts with an InvalidAmount error
    // [x] given the caller is not authorized on source extension
    //   [x] it reverts with a NotAuthorized error
    // [x] given the caller is not authorized (not in wrap_authorities)
    //   [x] it reverts with a NotAuthorized error
    // [x] given the vault has insufficient asset backing for the conversion
    //   [x] it reverts with an InsufficientAssetBacking error
    // [x] given valid inputs
    //   [x] it burns ext tokens from user (via unwrap)
    //   [x] it converts M amount to asset amount using M index (rounds down)
    //   [x] it transfers M from swap_m_account to JMI M vault
    //   [x] it transfers asset from JMI asset vault to user
    //   [x] it decrements total_assets on the JMI global account

    let unwrapAssetMint: Keypair;
    const unwrapAssetCap = new BN(1_000_000_000);
    const unwrapAssetAmount = new BN(50_000);

    beforeAll(async () => {
      // Setup for replace_asset_with_m tests:
      // 1. Create and configure asset on JMI extension (extA)
      unwrapAssetMint = await $.createAssetMint();
      await $.setAssetCapOnExtension("extA", unwrapAssetMint.publicKey, unwrapAssetCap);

      // 2. Mint assets and wrap them to populate JMI vault
      await $.mintAssetTokensTo(unwrapAssetMint, $.swapperKeypair.publicKey, unwrapAssetAmount.mul(new BN(5)));
      await $.wrapAssetViaSwap("extA", unwrapAssetMint.publicKey, unwrapAssetAmount.mul(new BN(3)), $.swapperKeypair);

      // 3. Give swapper some extB tokens (wrap M to extB)
      const accounts = await getTokenAccounts();
      await $.swapProgram.methods
        .wrap(unwrapAssetAmount)
        .accounts({
          signer: $.swapperKeypair.publicKey,
          wrapAuthority: $.swapProgram.programId,
          mMint: $.mMint.publicKey,
          mTokenAccount: accounts.ataM,
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          toExtProgram: $.getExtensionProgramId("extB"),
          toMint: $.getExtensionMint("mintB"),
          toTokenAccount: accounts.ataB,
          toTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([$.swapperKeypair])
        .rpc();

      // 4. Add replace authority to extB for replace_asset_with_m tests
      await $.addWrapAuthorityToExtension("extB", $.getReplaceAuthorityPda());
    });

    it("should fail when source extension is not whitelisted", async () => {
      // Remove source extension from whitelist
      await $.swapProgram.methods
        .removeWhitelistedExtension($.getExtensionProgramId("extB"))
        .accounts({ admin: $.admin.publicKey })
        .signers([$.admin])
        .rpc();

      await $.expectAnchorError(
        $.replaceAssetWithMViaSwap("extB", "extA", unwrapAssetMint.publicKey, unwrapAssetAmount, $.swapperKeypair),
        "InvalidExtension"
      );

      // Re-add for later tests
      $.svm.expireBlockhash();
      await $.whitelistExtension($.getExtensionProgramId("extB"), $.getExtensionMint("mintB"));
    });

    it("should fail when JMI extension is not whitelisted", async () => {
      // Remove JMI extension from whitelist
      await $.swapProgram.methods
        .removeWhitelistedExtension($.getExtensionProgramId("extA"))
        .accounts({ admin: $.admin.publicKey })
        .signers([$.admin])
        .rpc();

      await $.expectAnchorError(
        $.replaceAssetWithMViaSwap("extB", "extA", unwrapAssetMint.publicKey, unwrapAssetAmount, $.swapperKeypair),
        "InvalidExtension"
      );

      // Re-add for later tests
      $.svm.expireBlockhash();
      await $.whitelistExtension($.getExtensionProgramId("extA"), $.getExtensionMint("mintA"));
    });

    it("should fail when from_principal is zero", async () => {
      await $.expectAnchorError(
        $.replaceAssetWithMViaSwap("extB", "extA", unwrapAssetMint.publicKey, new BN(0), $.swapperKeypair),
        "InvalidAmount"
      );
    });

    it("should fail when fallback_replace_authority not authorized on source extension", async () => {
      // Remove fallback_replace_authority PDA from source extension's wrap_authorities
      await $.extensionPrograms.extB.methods
        .removeWrapAuthority($.getReplaceAuthorityPda())
        .accounts({ admin: $.admin.publicKey })
        .signers([$.admin])
        .rpc();

      await $.expectAnchorError(
        $.replaceAssetWithMViaSwap("extB", "extA", unwrapAssetMint.publicKey, unwrapAssetAmount, $.swapperKeypair),
        "NotAuthorized"
      );

      // Re-add for later tests
      $.svm.expireBlockhash();
      await $.addWrapAuthorityToExtension("extB", $.getReplaceAuthorityPda());
    });

    it("should fail when fallback_replace_authority not authorized on JMI extension", async () => {
      // Remove fallback_replace_authority PDA from JMI extension's replace_authorities
      await $.extensionPrograms.extA.methods
        .removeReplaceAuthority($.getReplaceAuthorityPda())
        .accounts({ admin: $.admin.publicKey })
        .signers([$.admin])
        .rpc();

      await $.expectAnchorError(
        $.replaceAssetWithMViaSwap("extB", "extA", unwrapAssetMint.publicKey, unwrapAssetAmount, $.swapperKeypair),
        "NotAuthorized"
      );

      // Re-add for later tests
      $.svm.expireBlockhash();
      await $.addReplaceAuthorityToExtension("extA", $.getReplaceAuthorityPda());
    });

    it("should fail when insufficient asset backing", async () => {
      // Create a new asset with minimal backing in vault
      const lowBackingAsset = await $.createAssetMint();
      await $.setAssetCapOnExtension("extA", lowBackingAsset.publicKey, unwrapAssetCap);
      await $.mintAssetTokensTo(lowBackingAsset, $.swapperKeypair.publicKey, new BN(100));
      // Wrap only a small amount
      await $.wrapAssetViaSwap("extA", lowBackingAsset.publicKey, new BN(50), $.swapperKeypair);

      // Try to unwrap more than what's backed (vault only has 50 assets)
      await $.expectAnchorError(
        $.replaceAssetWithMViaSwap("extB", "extA", lowBackingAsset.publicKey, unwrapAssetAmount, $.swapperKeypair),
        "InsufficientAssetBacking"
      );
    });

    it("should unwrap asset successfully", async () => {
      const userAssetAta = await $.getATA(unwrapAssetMint.publicKey, $.swapperKeypair.publicKey, false);
      const userExtBAta = await $.getATA($.getExtensionMint("mintB"), $.swapperKeypair.publicKey);
      const jmiMVault = $.getMVaultForExtension($.getExtensionProgramId("extA"));
      const jmiAssetVault = await $.getATA(unwrapAssetMint.publicKey, jmiMVault, false);

      const initialUserAssetBalance = await $.getTokenBalance(userAssetAta, false);
      const initialUserExtBBalance = await $.getTokenBalance(userExtBAta);
      const initialVaultAssetBalance = await $.getTokenBalance(jmiAssetVault, false);

      const unwrapAmount = new BN(1_000);
      await $.replaceAssetWithMViaSwap("extB", "extA", unwrapAssetMint.publicKey, unwrapAmount, $.swapperKeypair);

      // Verify ext tokens burned from user
      const finalUserExtBBalance = await $.getTokenBalance(userExtBAta);
      expect(finalUserExtBBalance.lt(initialUserExtBBalance)).toBe(true);

      // Verify asset transferred to user
      const finalUserAssetBalance = await $.getTokenBalance(userAssetAta, false);
      expect(finalUserAssetBalance.gt(initialUserAssetBalance)).toBe(true);

      // Verify asset removed from vault
      const finalVaultAssetBalance = await $.getTokenBalance(jmiAssetVault, false);
      expect(finalVaultAssetBalance.lt(initialVaultAssetBalance)).toBe(true);
    });

    it("should transfer M to JMI M vault", async () => {
      // Get JMI M vault token account
      const jmiMVaultAuth = $.getMVaultForExtension($.getExtensionProgramId("extA"));
      const jmiMVaultAta = await $.getATA($.mMint.publicKey, jmiMVaultAuth);

      // Get initial balance
      const initialJmiMVaultBalance = await $.getTokenBalance(jmiMVaultAta);

      // Perform replace_asset_with_m (extB → asset via extA's JMI)
      const unwrapAmount = new BN(500);
      await $.replaceAssetWithMViaSwap("extB", "extA", unwrapAssetMint.publicKey, unwrapAmount, $.swapperKeypair);

      // Verify M transferred to JMI vault
      const finalJmiMVaultBalance = await $.getTokenBalance(jmiMVaultAta);
      expect(finalJmiMVaultBalance.gt(initialJmiMVaultBalance)).toBe(true);
    });
  });

  describe("wrap_asset and replace_asset_with_m integration", () => {
    // [x] given M backing is insufficient on source extension
    //    [x] it reverts with an InsufficientMBacking error
    // [x] given valid signer and inputs and sufficent backing
    //    [x] users m_ext bal less than before
    //    [x] users asset bal greater than before
    // [x] should correctly track total_assets through multiple operations
    //    [x] verifies vault balance decreases correctly
    //    [x] verifies total_assets decreases by exact asset amount transferred
    //    [x] confirms total_assets stays consistent with actual vault holdings

    let integrationAssetMint: Keypair;
    const integrationCap = new BN(10_000_000);
    const integrationAmount = new BN(100_000);

    beforeAll(async () => {
      // Setup for integration tests
      integrationAssetMint = await $.createAssetMint();
      await $.setAssetCapOnExtension("extA", integrationAssetMint.publicKey, integrationCap);
      // Add fallback_replace_authority to extA's wrap_authorities for same-extension unwrap
      await $.addWrapAuthorityToExtension("extA", $.getReplaceAuthorityPda());
      await $.mintAssetTokensTo(integrationAssetMint, $.swapperKeypair.publicKey, integrationAmount.mul(new BN(10)));
    });

    it("should revert replace_asset_with_m when M backing is insufficient (same-extension)", async () => {
      const userAssetAta = await $.getATA(integrationAssetMint.publicKey, $.swapperKeypair.publicKey, false);
      const userExtAAta = await $.getATA($.getExtensionMint("mintA"), $.swapperKeypair.publicKey);

      // Wrap asset to get extA tokens (these are asset-backed, no M in vault)
      await $.wrapAssetViaSwap("extA", integrationAssetMint.publicKey, integrationAmount, $.swapperKeypair);

      // Verify ext tokens received
      const extABalance = await $.getTokenBalance(userExtAAta);
      expect(extABalance.gte(integrationAmount)).toBe(true);

      // Attempt to replace_asset_with_m with same extension (extA → extA)
      // Should fail because asset-backed tokens have no M backing
      // This matches EVM behavior where totalAssets == totalSupply means M backing = 0
      const unwrapAmount = integrationAmount.div(new BN(2));

      await expect(
        $.replaceAssetWithMViaSwap(
          "extA",  // from extension
          "extA",  // JMI extension (same)
          integrationAssetMint.publicKey,
          unwrapAmount,
          $.swapperKeypair
        )
      ).rejects.toThrow(/insufficient funds/i);
    });

    it("should replace_asset_with_m when source extension has sufficient M backing", async () => {
      // Setup: Give swapper M-backed extB tokens (wrap M → extB)
      const accounts = await getTokenAccounts();
      const wrapMAmount = new BN(50_000);

      await $.swapProgram.methods
        .wrap(wrapMAmount)
        .accounts({
          signer: $.swapperKeypair.publicKey,
          wrapAuthority: $.swapProgram.programId,
          mMint: $.mMint.publicKey,
          mTokenAccount: accounts.ataM,
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          toExtProgram: $.getExtensionProgramId("extB"),
          toMint: $.getExtensionMint("mintB"),
          toTokenAccount: accounts.ataB,
          toTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([$.swapperKeypair])
        .rpc();

      // Now extB has M backing. Unwrap extB → get assets from extA's JMI vault
      const userAssetAta = await $.getATA(integrationAssetMint.publicKey, $.swapperKeypair.publicKey, false);
      const initialAssetBalance = await $.getTokenBalance(userAssetAta, false);
      const userExtBBalance = await $.getTokenBalance(accounts.ataB);

      const unwrapAmount = wrapMAmount.div(new BN(2));

      await $.replaceAssetWithMViaSwap(
        "extB",  // from extension (has M backing)
        "extA",  // JMI extension (has assets in vault from previous wrap_asset)
        integrationAssetMint.publicKey,
        unwrapAmount,
        $.swapperKeypair
      );

      // Verify: extB tokens burned, assets received
      const finalExtBBalance = await $.getTokenBalance(accounts.ataB);
      expect(finalExtBBalance.lt(userExtBBalance)).toBe(true);

      const finalAssetBalance = await $.getTokenBalance(userAssetAta, false);
      expect(finalAssetBalance.gt(initialAssetBalance)).toBe(true);
    });

    it("should correctly track total_assets through multiple operations", async () => {
      // Create a fresh asset for clean tracking
      const trackingAsset = await $.createAssetMint();
      await $.setAssetCapOnExtension("extA", trackingAsset.publicKey, integrationCap);
      await $.mintAssetTokensTo(trackingAsset, $.swapperKeypair.publicKey, integrationAmount.mul(new BN(5)));

      const jmiMVault = $.getMVaultForExtension($.getExtensionProgramId("extA"));
      const vaultAssetAta = await $.getATA(trackingAsset.publicKey, jmiMVault, false);
      const jmiGlobalPda = $.getExtGlobalAccountFor("extA");

      // Get initial vault balance and total_assets
      const initialVaultBalance = await $.getTokenBalance(vaultAssetAta, false);
      const initialGlobalAccount = await $.extensionPrograms.extA.account.extGlobalV2.fetch(jmiGlobalPda);
      const initialTotalAssets = (initialGlobalAccount.yieldConfig as any).totalAssets as BN;

      // Wrap multiple times
      const wrapAmount1 = new BN(10_000);
      const wrapAmount2 = new BN(20_000);

      await $.wrapAssetViaSwap("extA", trackingAsset.publicKey, wrapAmount1, $.swapperKeypair);
      $.svm.expireBlockhash();
      await $.wrapAssetViaSwap("extA", trackingAsset.publicKey, wrapAmount2, $.swapperKeypair);

      // Verify vault balance increased correctly
      const afterWrapsBalance = await $.getTokenBalance(vaultAssetAta, false);
      const expectedAfterWraps = initialVaultBalance.add(wrapAmount1).add(wrapAmount2);
      expect(afterWrapsBalance.eq(expectedAfterWraps)).toBe(true);

      // Verify total_assets increased correctly
      const afterWrapsGlobalAccount = await $.extensionPrograms.extA.account.extGlobalV2.fetch(jmiGlobalPda);
      const afterWrapsTotalAssets = (afterWrapsGlobalAccount.yieldConfig as any).totalAssets as BN;
      expect(afterWrapsTotalAssets.eq(initialTotalAssets.add(wrapAmount1).add(wrapAmount2))).toBe(true);

      // Confirm total_assets increase matches vault balance increase
      const vaultBalanceIncrease = afterWrapsBalance.sub(initialVaultBalance);
      const totalAssetsIncrease = afterWrapsTotalAssets.sub(initialTotalAssets);
      expect(totalAssetsIncrease.eq(vaultBalanceIncrease)).toBe(true);

      // Now unwrap some via replace_asset_with_m (need extB tokens first)
      const accounts = await getTokenAccounts();
      const userExtBAta = accounts.ataB;
      const extBBalance = await $.getTokenBalance(userExtBAta);

      if (extBBalance.gt(new BN(0))) {
        const unwrapAmount = BN.min(extBBalance, new BN(5_000));
        await $.replaceAssetWithMViaSwap("extB", "extA", trackingAsset.publicKey, unwrapAmount, $.swapperKeypair);

        // Verify vault balance decreased
        const finalVaultBalance = await $.getTokenBalance(vaultAssetAta, false);
        expect(finalVaultBalance.lt(afterWrapsBalance)).toBe(true);

        // Verify total_assets decreases by exact asset amount transferred
        const finalGlobalAccount = await $.extensionPrograms.extA.account.extGlobalV2.fetch(jmiGlobalPda);
        const finalTotalAssets = (finalGlobalAccount.yieldConfig as any).totalAssets as BN;
        const assetsTransferred = afterWrapsBalance.sub(finalVaultBalance);
        expect(finalTotalAssets.eq(afterWrapsTotalAssets.sub(assetsTransferred))).toBe(true);

        // Confirm total_assets decrease matches vault balance decrease
        const vaultBalanceDecrease = afterWrapsBalance.sub(finalVaultBalance);
        const totalAssetsDecrease = afterWrapsTotalAssets.sub(finalTotalAssets);
        expect(totalAssetsDecrease.eq(vaultBalanceDecrease)).toBe(true);
      }
     });
  });
});

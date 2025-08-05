import { BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
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
      await $.whitelistExtension($.getExtensionProgramId("extA"));
      await $.whitelistExtension($.getExtensionProgramId("extB"));
      await $.whitelistExtension($.getExtensionProgramId("extC"));

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
      await $.svm.expireBlockhash();

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
      await $.svm.expireBlockhash();

      // Re-add for later tests
      await $.whitelistExtension($.getExtensionProgramId("extA"));
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
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          toExtProgram: $.getExtensionProgramId("extA"),
          toMint: $.getExtensionMint("mintA"),
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
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          fromExtProgram: $.getExtensionProgramId("extA"),
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
    it("should fail when extension is not whitelisted", async () => {
      // Remove extension C from whitelist first
      await $.swapProgram.methods
        .removeWhitelistedExtension($.getExtensionProgramId("extC"))
        .accounts({
          admin: $.admin.publicKey,
        })
        .signers([$.admin])
        .rpc();

      // Try to wrap to non-whitelisted extension
      await expect(
        $.swapProgram.methods
          .wrap(new BN(100))
          .accounts({
            signer: $.swapperKeypair.publicKey,
            wrapAuthority: $.swapProgram.programId, // placeholder for None -> use swap program authority
            mMint: $.mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: $.getExtensionProgramId("extC"),
            toMint: $.getExtensionMint("mintC"),
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
      await $.whitelistExtension($.getExtensionProgramId("extC"));

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
      await $.svm.expireBlockhash();

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
      await $.whitelistExtension($.getExtensionProgramId("extA"));
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

      // Try to wrap (should fail)
      await $.expectAnchorError(
        $.swapProgram.methods
          .wrap(new BN(10))
          .accounts({
            signer: $.swapperKeypair.publicKey,
            wrapAuthority: $.swapProgram.programId,
            mMint: $.mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: $.getExtensionProgramId("extA"),
            toMint: $.getExtensionMint("mintA"),
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair])
          .rpc(),
        "NotAuthorized"
      );
    });

    it("should fail to wrap with invalid external ext wrap authority co-signer", async () => {
      await $.expectAnchorError(
        $.swapProgram.methods
          .wrap(new BN(10))
          .accounts({
            signer: $.swapperKeypair.publicKey,
            wrapAuthority: $.nonAdmin.publicKey,
            mMint: $.mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: $.getExtensionProgramId("extA"),
            toMint: $.getExtensionMint("mintA"),
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

      await $.swapProgram.methods
        .wrap(new BN(100))
        .accounts({
          signer: $.swapperKeypair.publicKey,
          wrapAuthority: $.nonAdmin.publicKey,
          mMint: $.mMint.publicKey,
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          toExtProgram: $.getExtensionProgramId("extA"),
          toMint: $.getExtensionMint("mintA"),
          toTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([$.swapperKeypair, $.nonAdmin])
        .rpc();
    });

    it("should fail swap with mismatched authorities", async () => {
      const accounts = await getTokenAccounts();

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
    });

    it("should swap with correct wrap authority", async () => {
      const accounts = await getTokenAccounts();

      await $.swapProgram.methods
        .swap(new BN(15), 0)
        .accounts({
          signer: $.swapperKeypair.publicKey,
          unwrapAuthority: $.swapperKeypair.publicKey,
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
      await expect(
        $.swapProgram.methods
          .unwrap(new BN(100))
          .accounts({
            signer: $.swapperKeypair.publicKey,
            unwrapAuthority: cosigner.publicKey,
            fromExtProgram: $.getExtensionProgramId("extA"),
            fromMint: $.getExtensionMint("mintA"),
            mMint: $.mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair, cosigner])
          .rpc()
      ).rejects.toThrow();
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
      await $.swapProgram.methods
        .unwrap(new BN(1_000))
        .accounts({
          signer: $.swapperKeypair.publicKey,
          unwrapAuthority: cosigner.publicKey,
          fromExtProgram: $.getExtensionProgramId("extA"),
          fromMint: $.getExtensionMint("mintA"),
          mMint: $.mMint.publicKey,
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

      // Try to wrap with removed authority (should fail)
      await expect(
        $.swapProgram.methods
          .wrap(new BN(100))
          .accounts({
            signer: $.swapperKeypair.publicKey,
            wrapAuthority: $.admin.publicKey,
            mMint: $.mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: $.getExtensionProgramId("extA"),
            toMint: $.getExtensionMint("mintA"),
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([$.swapperKeypair, $.admin])
          .rpc()
      ).rejects.toThrow();

      // Add admin back as wrap authority
      await $.addWrapAuthorityToExtension("extA", $.admin.publicKey);

      // Now wrapping with admin authority should work
      await $.swapProgram.methods
        .wrap(new BN(100))
        .accounts({
          signer: $.swapperKeypair.publicKey,
          wrapAuthority: $.admin.publicKey,
          mMint: $.mMint.publicKey,
          mTokenProgram: TOKEN_2022_PROGRAM_ID,
          toExtProgram: $.getExtensionProgramId("extA"),
          toMint: $.getExtensionMint("mintA"),
          toTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([$.swapperKeypair, $.admin])
        .rpc();
    });
  });
});

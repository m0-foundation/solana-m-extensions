import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createInitializeScaledUiAmountConfigInstruction,
  createMintToInstruction,
  ExtensionType,
  getAccount,
  getAssociatedTokenAddressSync,
  getMintLen,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import {
  PROGRAM_ID as EARN_PROGRAM_ID,
  MerkleTree,
} from "@m0-foundation/solana-m-sdk";
import { Earn } from "../../tests/programs/earn";
import EARN from "../../tests/programs/earn.json";
import EXT_SWAP from "../../target/idl/ext_swap.json";
import M_EXT from "../../target/idl/scaled_ui.json";
import { BN, Program } from "@coral-xyz/anchor";
import { ExtSwap } from "../../target/types/ext_swap";
import { TransactionMetadata } from "litesvm";
import { MExt } from "../../target/types/scaled_ui";

describe("extension swap tests", () => {
  const {
    admin,
    swapper,
    mMint,
    extProgramA,
    extProgramB,
    mintA,
    mintB,
    multisig,
    extProgramC,
    mintC,
  } = loadKeypairs();

  const svm = fromWorkspace("").withSplPrograms();
  svm.airdrop(admin.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
  svm.airdrop(swapper.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

  // M Earn program
  svm.addProgramFromFile(EARN_PROGRAM_ID, "tests/programs/earn.so");

  // Sample extension programs for swapping
  svm.addProgramFromFile(extProgramA.publicKey, "tests/programs/ext_a.so");
  svm.addProgramFromFile(extProgramB.publicKey, "tests/programs/ext_b.so");
  svm.addProgramFromFile(extProgramC.publicKey, "tests/programs/ext_c.so");

  // Replace the default token2022 program with updated one
  svm.addProgramFromFile(
    TOKEN_2022_PROGRAM_ID,
    "tests/programs/spl_token_2022.so"
  );

  // Anchor providers and programs
  const provider = new LiteSVMProvider(svm, new NodeWallet(admin));
  const program = new Program<ExtSwap>(EXT_SWAP, provider);
  const earn = new Program<Earn>(EARN, provider);

  const [extensionA, extensionB, extensionC] = [
    extProgramA,
    extProgramB,
    extProgramC,
  ].map((p) => new Program<MExt>({ ...M_EXT, address: p.publicKey }, provider));

  // Common accounts
  const accounts = {
    ataA: getAssociatedTokenAddressSync(
      mintA.publicKey,
      swapper.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    ),
    ataB: getAssociatedTokenAddressSync(
      mintB.publicKey,
      swapper.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    ),
    ataM: getAssociatedTokenAddressSync(
      mMint.publicKey,
      swapper.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    ),
  };

  // Helper for sending transactions and checking errors
  const sendTransaction = async (
    txn: Transaction | Promise<Transaction>,
    signers: Keypair[],
    expectedErrorMessage?: RegExp
  ): Promise<TransactionMetadata | null> => {
    if (txn instanceof Promise) {
      txn = await txn;
    }

    txn.feePayer = signers[0].publicKey;
    txn.recentBlockhash = svm.latestBlockhash();
    txn.sign(...signers);

    const result = svm.sendTransaction(txn);

    if ("err" in result) {
      if (expectedErrorMessage) {
        for (const log of result.meta().logs()) {
          if (log.match(expectedErrorMessage)) return null;
        }

        console.error(result.toString());
        throw new Error("Did not find expected error message in logs");
      }

      console.error(result.toString());
      throw new Error("Transaction failed");
    }
    if (expectedErrorMessage) {
      console.error(result.toString());
      throw new Error("Expected transaction to fail, but it succeeded");
    }

    return result;
  };

  const getTokenBalance = async (ata: PublicKey) => {
    const act = await getAccount(
      provider.connection,
      ata,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    return Number(act.amount);
  };

  describe("initialize swap programs", () => {
    it("create mints", async () => {
      // Mint auth for each program
      const [mintAuthA, mintAuthB, mintAuthC] = [
        extensionA,
        extensionB,
        extensionC,
      ].map(
        (p) =>
          PublicKey.findProgramAddressSync(
            [Buffer.from("mint_authority")],
            p.programId
          )[0]
      );

      // Create all mints
      for (const [mint, mintAuth] of [
        [mMint, admin.publicKey],
        [mintA, mintAuthA],
        [mintB, mintAuthB],
        [mintC, mintAuthC],
      ] as [Keypair, PublicKey][]) {
        await sendTransaction(
          await buildMintTxn(
            provider.connection,
            admin.publicKey,
            mint,
            mintAuth
          ),
          [admin, mint]
        );
      }

      // Mint M to swapper
      const transaction = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          admin.publicKey,
          accounts.ataM,
          swapper.publicKey,
          mMint.publicKey,
          TOKEN_2022_PROGRAM_ID
        ),
        createMintToInstruction(
          mMint.publicKey,
          accounts.ataM,
          admin.publicKey,
          1e6,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      await sendTransaction(transaction, [admin]);
    });
    it("initialize earn program", async () => {
      await sendTransaction(
        earn.methods
          .initialize(multisig.publicKey, new BN(1_000_000_000_000), new BN(0))
          .accounts({
            mint: mMint.publicKey,
          })
          .transaction(),
        [admin]
      );

      const getVault = (p: PublicKey) =>
        PublicKey.findProgramAddressSync([Buffer.from("m_vault")], p)[0];

      // Add all vaults as earners
      const earnerMerkleTree = new MerkleTree([
        getVault(extensionA.programId),
        getVault(extensionB.programId),
        getVault(extensionC.programId),
      ]);

      await earn.methods
        .propagateIndex(new BN(1_000_000_000_001), earnerMerkleTree.getRoot())
        .accountsPartial({
          mint: mMint.publicKey,
        })
        .rpc();

      for (const p of [extensionA, extensionB, extensionC]) {
        const vault = getVault(p.programId);

        const ata = await getAssociatedTokenAddressSync(
          mMint.publicKey,
          vault,
          true,
          TOKEN_2022_PROGRAM_ID
        );

        // Create ata
        await sendTransaction(
          new Transaction().add(
            createAssociatedTokenAccountInstruction(
              admin.publicKey,
              ata,
              vault,
              mMint.publicKey,
              TOKEN_2022_PROGRAM_ID
            )
          ),
          [admin]
        );

        // Create earner account
        const { proof } = earnerMerkleTree.getInclusionProof(vault);
        await earn.methods
          .addRegistrarEarner(vault, proof)
          .accounts({
            userTokenAccount: ata,
          })
          .rpc();
      }
    });
    it("initialize extension programs", async () => {
      for (const [i, p] of [extensionA, extensionB, extensionC].entries()) {
        await sendTransaction(
          p.methods
            .initialize([], new BN(0))
            .accounts({
              mMint: mMint.publicKey,
              extMint: [mintA, mintB, mintC][i].publicKey,
            })
            .transaction(),
          [admin]
        );
      }
    });
  });

  // Tests
  describe("configure", () => {
    it("initialize config", async () => {
      await sendTransaction(
        program.methods.initializeGlobal().accounts({}).transaction(),
        [admin]
      );
    });

    it("re-initialize config revert", async () => {
      await sendTransaction(
        program.methods
          .initializeGlobal()
          .accounts({ admin: swapper.publicKey })
          .transaction(),
        [swapper],
        /Allocate: account Address .* already in use/
      );
    });

    it("add to ext whitelist", async () => {
      await sendTransaction(
        program.methods
          .whitelistExtension()
          .accounts({
            extProgram: earn.programId,
          })
          .transaction(),
        [admin]
      );

      const { whitelistedExtensions } = await program.account.swapGlobal.fetch(
        PublicKey.findProgramAddressSync(
          [Buffer.from("global")],
          program.programId
        )[0]
      );

      // Validate the extension was added
      expect(whitelistedExtensions).toHaveLength(1);
      expect(whitelistedExtensions[0].toBase58()).toBe(
        earn.programId.toBase58()
      );
    });

    it("add to unwrap whitelist", async () => {
      await sendTransaction(
        program.methods
          .whitelistUnwrapper(admin.publicKey)
          .accounts({})
          .transaction(),
        [admin]
      );

      const { whitelistedExtensions, whitelistedUnwrappers } =
        await program.account.swapGlobal.fetch(
          PublicKey.findProgramAddressSync(
            [Buffer.from("global")],
            program.programId
          )[0]
        );

      // Validate whitelists
      expect(whitelistedExtensions).toHaveLength(1);
      expect(whitelistedExtensions[0].toBase58()).toBe(
        earn.programId.toBase58()
      );
      expect(whitelistedUnwrappers).toHaveLength(1);
      expect(whitelistedUnwrappers[0].toBase58()).toBe(
        admin.publicKey.toBase58()
      );
    });

    it("remove non-existent entry", async () => {
      await sendTransaction(
        program.methods
          .removeWhitelistedExtension(new Keypair().publicKey)
          .accounts({})
          .transaction(),
        [admin],
        /Error Message: Extension is not whitelisted/
      );
    });

    it("remove from unwrap whitelist", async () => {
      await sendTransaction(
        program.methods
          .removeWhitelistedUnwrapper(admin.publicKey)
          .accounts({})
          .transaction(),
        [admin]
      );

      const { whitelistedExtensions, whitelistedUnwrappers } =
        await program.account.swapGlobal.fetch(
          PublicKey.findProgramAddressSync(
            [Buffer.from("global")],
            program.programId
          )[0]
        );

      // Validate whitelists
      expect(whitelistedExtensions).toHaveLength(1);
      expect(whitelistedExtensions[0].toBase58()).toBe(
        earn.programId.toBase58()
      );
      expect(whitelistedUnwrappers).toHaveLength(0);
    });

    it("remove from ext whitelist", async () => {
      await sendTransaction(
        program.methods
          .removeWhitelistedExtension(earn.programId)
          .accounts({})
          .transaction(),
        [admin]
      );

      const { whitelistedExtensions } = await program.account.swapGlobal.fetch(
        PublicKey.findProgramAddressSync(
          [Buffer.from("global")],
          program.programId
        )[0]
      );

      // Validate the extension was removed
      expect(whitelistedExtensions).toHaveLength(0);
    });
  });

  describe("swapping", () => {
    it("extension not whitelisted", async () => {
      await sendTransaction(
        program.methods
          .wrap(new BN(1e2))
          .accounts({
            signer: swapper.publicKey,
            wrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: extProgramA.publicKey,
            toMint: mintA.publicKey,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper],
        /Error Message: Extension is not whitelisted/
      );

      // Whitelist both extensions
      for (const pid of [extProgramA, extProgramB, extProgramC]) {
        await sendTransaction(
          program.methods
            .whitelistExtension()
            .accounts({
              extProgram: pid.publicKey,
            })
            .transaction(),
          [admin]
        );
      }
    });

    it("swap program not whitelisted for wrapping", async () => {
      await sendTransaction(
        program.methods
          .wrap(new BN(1e3))
          .accounts({
            signer: swapper.publicKey,
            wrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: extProgramA.publicKey,
            toMint: mintA.publicKey,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper],
        /Error Message: Invalid signer/
      );

      // Whitelist swap program signer
      for (const p of [extensionA, extensionB, extensionC]) {
        const [global] = PublicKey.findProgramAddressSync(
          [Buffer.from("global")],
          program.programId
        );

        await sendTransaction(
          p.methods.addWrapAuthority(global).accounts({}).transaction(),
          [admin]
        );
      }
    });

    it("wrap M", async () => {
      await sendTransaction(
        program.methods
          .wrap(new BN(1e4))
          .accounts({
            signer: swapper.publicKey,
            wrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: extProgramA.publicKey,
            toMint: mintA.publicKey,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper]
      );

      // Validate amounts
      expect(await getTokenBalance(accounts.ataM)).toBe(0.99e6);
      expect(await getTokenBalance(accounts.ataA)).toBe(0.01e6);
    });

    it("unauthorized unwrap to M", async () => {
      await sendTransaction(
        program.methods
          .unwrap(new BN(1e1))
          .accounts({
            signer: swapper.publicKey,
            unwrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: extProgramA.publicKey,
            fromMint: mintA.publicKey,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper],
        /Error Message: Signer is not whitelisted/
      );
    });

    it("unwrap to M", async () => {
      // add swapper
      await sendTransaction(
        program.methods
          .whitelistUnwrapper(swapper.publicKey)
          .accounts({})
          .transaction(),
        [admin]
      );

      await sendTransaction(
        program.methods
          .unwrap(new BN(1e3))
          .accounts({
            signer: swapper.publicKey,
            unwrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: extProgramA.publicKey,
            fromMint: mintA.publicKey,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper]
      );

      // Validate amounts
      expect(await getTokenBalance(accounts.ataM)).toBe(0.991e6);
      expect(await getTokenBalance(accounts.ataA)).toBe(0.009e6);
    });

    it("swap extension tokens", async () => {
      await sendTransaction(
        program.methods
          .swap(new BN(1e3), 0)
          .accounts({
            signer: swapper.publicKey,
            unwrapAuthority: program.programId,
            wrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: extProgramA.publicKey,
            toExtProgram: extProgramB.publicKey,
            fromMint: mintA.publicKey,
            toMint: mintB.publicKey,
            fromTokenAccount: accounts.ataA,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper]
      );

      // Validate amounts
      expect(await getTokenBalance(accounts.ataM)).toBe(0.991e6);
      expect(await getTokenBalance(accounts.ataA)).toBe(0.008e6);
      expect(await getTokenBalance(accounts.ataB)).toBe(0.001e6);
    });

    it("swap invalid amount", async () => {
      await sendTransaction(
        program.methods
          .swap(new BN(0), 0)
          .accounts({
            signer: swapper.publicKey,
            unwrapAuthority: program.programId,
            wrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: extProgramA.publicKey,
            toExtProgram: extProgramB.publicKey,
            fromMint: mintA.publicKey,
            toMint: mintB.publicKey,
            fromTokenAccount: accounts.ataA,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper],
        /Error Message: Invalid amount/
      );
    });
  });

  describe("remaining accounts", () => {
    it("invalid index", async () => {
      await sendTransaction(
        program.methods
          .swap(new BN(1e2), 1)
          .accounts({
            signer: swapper.publicKey,
            unwrapAuthority: program.programId,
            wrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: extProgramA.publicKey,
            toExtProgram: extProgramB.publicKey,
            fromMint: mintA.publicKey,
            toMint: mintB.publicKey,
            fromTokenAccount: accounts.ataA,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper],
        /Error Message: Index invalid for length of the array/
      );
    });

    it("swap with unneeded remaining accounts", async () => {
      await sendTransaction(
        program.methods
          .swap(new BN(1e3), 1)
          .accounts({
            signer: swapper.publicKey,
            unwrapAuthority: program.programId,
            wrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: extProgramA.publicKey,
            toExtProgram: extProgramB.publicKey,
            fromMint: mintA.publicKey,
            toMint: mintB.publicKey,
            fromTokenAccount: accounts.ataA,
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
          .transaction(),
        [swapper]
      );

      // Validate amounts
      expect(await getTokenBalance(accounts.ataM)).toBe(0.991e6);
      expect(await getTokenBalance(accounts.ataA)).toBe(0.007e6);
      expect(await getTokenBalance(accounts.ataB)).toBe(0.002e6);
    });

    it("wrap expects remaining account", async () => {
      await sendTransaction(
        program.methods
          .swap(new BN(1e3), 0)
          .accounts({
            signer: swapper.publicKey,
            unwrapAuthority: program.programId,
            wrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: extProgramA.publicKey,
            toExtProgram: extProgramC.publicKey,
            fromMint: mintA.publicKey,
            toMint: mintC.publicKey,
            fromTokenAccount: accounts.ataA,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper],
        /Error Message: Not enough account keys given to the instruction/
      );
    });

    it("wrap gets incorrect remaining account", async () => {
      await sendTransaction(
        program.methods
          .swap(new BN(1e3), 0)
          .accounts({
            signer: swapper.publicKey,
            unwrapAuthority: program.programId,
            wrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: extProgramA.publicKey,
            toExtProgram: extProgramC.publicKey,
            fromMint: mintA.publicKey,
            toMint: mintC.publicKey,
            fromTokenAccount: accounts.ataA,
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
          .transaction(),
        [swapper],
        /Error Message: Program ID was not as expected/
      );
    });

    it("wrap gets expected remaining account", async () => {
      await sendTransaction(
        program.methods
          .swap(new BN(1e3), 0)
          .accounts({
            signer: swapper.publicKey,
            unwrapAuthority: program.programId,
            wrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: extProgramA.publicKey,
            toExtProgram: extProgramC.publicKey,
            fromMint: mintA.publicKey,
            toMint: mintC.publicKey,
            fromTokenAccount: accounts.ataA,
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
          .transaction(),
        [swapper]
      );
    });
  });

  describe("remove extension", () => {
    it("remove from ext whitelist", async () => {
      await sendTransaction(
        program.methods
          .removeWhitelistedExtension(extProgramC.publicKey)
          .accounts({})
          .transaction(),
        [admin]
      );
    });

    it("swap to extension that was removed", async () => {
      await sendTransaction(
        program.methods
          .swap(new BN(1e3), 0)
          .accounts({
            signer: swapper.publicKey,
            unwrapAuthority: program.programId,
            wrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: extProgramB.publicKey,
            toExtProgram: extProgramC.publicKey,
            fromMint: mintB.publicKey,
            toMint: mintC.publicKey,
            fromTokenAccount: accounts.ataB,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper],
        /Error Message: Extension is not whitelisted/
      );
    });
  });

  describe("swap program not whitelisted", () => {
    it("attempt wrap without authority", async () => {
      // Remove swap program as wrap authority
      const [global] = PublicKey.findProgramAddressSync(
        [Buffer.from("global")],
        program.programId
      );

      await sendTransaction(
        extensionA.methods
          .removeWrapAuthority(global)
          .accounts({})
          .transaction(),
        [admin]
      );

      // Try to wrap
      await sendTransaction(
        program.methods
          .wrap(new BN(1e1))
          .accounts({
            signer: swapper.publicKey,
            wrapAuthority: program.programId,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: extProgramA.publicKey,
            toMint: mintA.publicKey,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper],
        /Error Message: Invalid signer/
      );
    });

    it("attempt wrap with invalid authority", async () => {
      // Try to wrap
      await sendTransaction(
        program.methods
          .wrap(new BN(1e1))
          .accounts({
            signer: swapper.publicKey,
            wrapAuthority: admin.publicKey,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: extProgramA.publicKey,
            toMint: mintA.publicKey,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper, admin],
        /Error Message: Invalid signer/
      );
    });

    it("wrap with wrap authority", async () => {
      // add wrap authority
      await sendTransaction(
        extensionA.methods
          .addWrapAuthority(admin.publicKey)
          .accounts({})
          .transaction(),
        [admin]
      );

      await sendTransaction(
        program.methods
          .wrap(new BN(1e2))
          .accounts({
            signer: swapper.publicKey,
            wrapAuthority: admin.publicKey,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            toExtProgram: extProgramA.publicKey,
            toMint: mintA.publicKey,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper, admin]
      );
    });

    it("unwrap authority set instead of wrap", async () => {
      await sendTransaction(
        program.methods
          .swap(new BN(15), 0)
          .accounts({
            signer: swapper.publicKey,
            wrapAuthority: program.programId,
            unwrapAuthority: admin.publicKey,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: extProgramB.publicKey,
            toExtProgram: extProgramA.publicKey,
            fromMint: mintB.publicKey,
            toMint: mintA.publicKey,
            fromTokenAccount: accounts.ataB,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper, admin],
        /Error Message: Invalid signer/
      );
    });

    it("swap with wrap authority", async () => {
      await sendTransaction(
        program.methods
          .swap(new BN(15), 0)
          .accounts({
            signer: swapper.publicKey,
            unwrapAuthority: program.programId,
            wrapAuthority: admin.publicKey,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromExtProgram: extProgramB.publicKey,
            toExtProgram: extProgramA.publicKey,
            fromMint: mintB.publicKey,
            toMint: mintA.publicKey,
            fromTokenAccount: accounts.ataB,
            toTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper, admin]
      );
    });
  });

  describe("unwrapping permissions", () => {
    const cosigner = Keypair.generate();

    it("co-signer is not authorized", async () => {
      await sendTransaction(
        program.methods
          .unwrap(new BN(1e2))
          .accounts({
            signer: swapper.publicKey,
            unwrapAuthority: cosigner.publicKey,
            fromExtProgram: extProgramA.publicKey,
            fromMint: mintA.publicKey,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper, cosigner],
        /Error Message: Signer is not whitelisted/
      );
    });

    it("whitelist co-signer", async () => {
      await sendTransaction(
        program.methods
          .whitelistUnwrapper(cosigner.publicKey)
          .accounts({ admin: admin.publicKey })
          .transaction(),
        [admin]
      );

      const { whitelistedUnwrappers } = await program.account.swapGlobal.fetch(
        PublicKey.findProgramAddressSync(
          [Buffer.from("global")],
          program.programId
        )[0]
      );

      // Validate the cosigner was added
      expect(whitelistedUnwrappers).toHaveLength(2);
      expect(whitelistedUnwrappers[1].toBase58()).toBe(
        cosigner.publicKey.toBase58()
      );

      // Whitelist on extension program
      await sendTransaction(
        extensionA.methods
          .addWrapAuthority(cosigner.publicKey)
          .accounts({ admin: admin.publicKey })
          .transaction(),
        [admin]
      );
    });

    it("co-signer is authorized", async () => {
      await sendTransaction(
        program.methods
          .unwrap(new BN(1e3))
          .accounts({
            signer: swapper.publicKey,
            unwrapAuthority: cosigner.publicKey,
            fromExtProgram: extProgramA.publicKey,
            fromMint: mintA.publicKey,
            mMint: mMint.publicKey,
            mTokenProgram: TOKEN_2022_PROGRAM_ID,
            fromTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .transaction(),
        [swapper, cosigner]
      );
    });
  });
});

async function buildMintTxn(
  connection: Connection,
  creator: PublicKey,
  mint: Keypair,
  mintAuthority: PublicKey
) {
  const mintLen = getMintLen([ExtensionType.ScaledUiAmountConfig]);
  const mintLamports = await connection.getMinimumBalanceForRentExemption(
    mintLen
  );

  const createMintAccount = SystemProgram.createAccount({
    fromPubkey: creator,
    newAccountPubkey: mint.publicKey,
    space: mintLen,
    lamports: mintLamports,
    programId: TOKEN_2022_PROGRAM_ID,
  });

  const initializeScaledUiAmountConfig =
    createInitializeScaledUiAmountConfigInstruction(
      mint.publicKey,
      mintAuthority,
      1.0,
      TOKEN_2022_PROGRAM_ID
    );

  const initializeMint = createInitializeMintInstruction(
    mint.publicKey,
    6,
    mintAuthority,
    mintAuthority,
    TOKEN_2022_PROGRAM_ID
  );

  let tx = new Transaction();
  tx.add(createMintAccount, initializeScaledUiAmountConfig, initializeMint);
  return tx;
}

function loadKeypairs() {
  const key = (k: string) => Keypair.fromSecretKey(Buffer.from(k, "base64"));

  return {
    admin: key(
      // BnqzwtopjSGB9nHfMFYEa5p1kgeDBthfRP8yiLW9U7Kz
      "6iMOkgS4ZAfVxUWOdzo8y+MDoRLfuX4oPbzQf8D2RuigU2i7DwWQ+x304o+/2aa0K695awmnbv1JfL+WWnDcPQ=="
    ),
    swapper: key(
      // 8b3XbqeN3VrrNH3u1WvjK5BasW5hKWKVpDGz5tsq5CbL
      "WmvqEmS7IwLjuBIMML4UY6d+VND9BnbG7B7Z4coApDdwumn5E6LBAS07RctOhxM5FXNEOizdNGuQwabX3Y/88w=="
    ),
    mMint: key(
      // DfaRRLLVGYpfu33QdGHGLNKv2G4MyyMbmvGVpLQgFeeF
      "VIC7l0xRw067AiX75WtZ2ehN3+1wIpGmH6gWvS4jvx+8LhpnI+sGHFi+6tair18K2nd6yr2IR97C5qZZYkkl5A=="
    ),
    extProgramA: key(
      // 3joDhmLtHLrSBGfeAe1xQiv3gjikes3x8S4N3o6Ld8zB
      "XVFfL68OjRO5g+DZxbQHXVqEtoU976BAS6y5RP905ZIorgcghvm5mrP60XsmiUAp4aSIBadFzWUK/bbBmqweYA=="
    ),
    extProgramB: key(
      // HSMnbWEkB7sEQAGSzBPeACNUCXC9FgNeeESLnHtKfoy3
      "1y1p2+YND+xDi/CbPGRN7fiE08xzoD9Fd2vsLvH9r930OgOUua+nXoCRzIl9SRyiM5GyHki7EtaTGXT8mi3qmg=="
    ),
    mintA: key(
      // GbfuJZa4zLNgxHCrXNTXzVZ3CPUCe5RYWPBq9bU9qekP
      "UeJL1Qx6czzbwDTUjOHjKLJ7Ao4XJUGXlDC5vkbPC+znwQmrzy6AxwYGUH2VX4vVZHX8DQAq/sWauL1ucUZUaA=="
    ),
    mintB: key(
      // 55H5CfmBxyaYnUhXxbToqT3FWhKMWmBJFrbd3WfuFy9u
      "XmidpDRbKR+D56M2trCoiPRzi1yxKy8aUnO+p3PuLxA8hz59ZTmu51Bn9qFsZHxaIWi1tCUd5ibpOj4pBKqTVA=="
    ),
    multisig: key(
      // FYvCWxAdFQYyJJPSXNKv2dzsdKq98EwmdRiu6rpY65gT
      "CXioALq/oVhI/8QWp7AphKgZiJB1haG5kPomzHJ+n2jYMMYbLiWQ5knEMn9iu3T+5rn/YEs+M78sq5vOSwISWA=="
    ),
    extProgramC: key(
      // 81gYpXqg8ZT9gdkFSe35eqiitqBWqVfYwDwVfXuk8Xfw
      "YPIMBm2ykzl4I7GHdQyWqKwR9RJjiwNhDyOyWTHBjqdoLoa322EZkMKDzwDeycwd0vq3KrIs1ga19ecjWSJS0g=="
    ),
    mintC: key(
      // H6V2ShFqjRaHyewiqaHN6E6ok1XRH2xv4Zwy3JpL8Cxb
      "m+OGOQSbwMu+Io83qHWOFdPZsWxnFhaz0zwzFS6C0TDvIpUrxJFh8CBFOCAHmTJpK+I/1Zv1FOeqsykz2BPgDA=="
    ),
  };
}

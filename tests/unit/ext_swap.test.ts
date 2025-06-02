import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  createInitializeMintInstruction,
  createInitializeMultisigInstruction,
  createInitializeScaledUiAmountConfigInstruction,
  ExtensionType,
  getMinimumBalanceForRentExemptMultisig,
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
import { PROGRAM_ID as EARN_PROGRAM_ID } from "@m0-foundation/solana-m-sdk";
import { Earn } from "../../tests/programs/earn";
import EARN from "../../tests/programs/earn.json";
import EXT_SWAP from "../../target/idl/ext_swap.json";
import M_EXT from "../../target/idl/m_ext.json";
import { BN, Program } from "@coral-xyz/anchor";
import { ExtSwap } from "../../target/types/ext_swap";
import { TransactionMetadata } from "litesvm";
import { MExt } from "../../target/types/m_ext";

describe("extension swap tests", () => {
  const [
    admin,
    swaper,
    mMint,
    extProgramA,
    extProgramB,
    mintA,
    mintB,
    multisig,
  ] = loadKeypairs(
    "6iMOkgS4ZAfVxUWOdzo8y+MDoRLfuX4oPbzQf8D2RuigU2i7DwWQ+x304o+/2aa0K695awmnbv1JfL+WWnDcPQ==", // BnqzwtopjSGB9nHfMFYEa5p1kgeDBthfRP8yiLW9U7Kz
    "WmvqEmS7IwLjuBIMML4UY6d+VND9BnbG7B7Z4coApDdwumn5E6LBAS07RctOhxM5FXNEOizdNGuQwabX3Y/88w==", // 8b3XbqeN3VrrNH3u1WvjK5BasW5hKWKVpDGz5tsq5CbL
    "VIC7l0xRw067AiX75WtZ2ehN3+1wIpGmH6gWvS4jvx+8LhpnI+sGHFi+6tair18K2nd6yr2IR97C5qZZYkkl5A==", // DfaRRLLVGYpfu33QdGHGLNKv2G4MyyMbmvGVpLQgFeeF
    "XVFfL68OjRO5g+DZxbQHXVqEtoU976BAS6y5RP905ZIorgcghvm5mrP60XsmiUAp4aSIBadFzWUK/bbBmqweYA==", // 3joDhmLtHLrSBGfeAe1xQiv3gjikes3x8S4N3o6Ld8zB
    "1y1p2+YND+xDi/CbPGRN7fiE08xzoD9Fd2vsLvH9r930OgOUua+nXoCRzIl9SRyiM5GyHki7EtaTGXT8mi3qmg==", // HSMnbWEkB7sEQAGSzBPeACNUCXC9FgNeeESLnHtKfoy3
    "UeJL1Qx6czzbwDTUjOHjKLJ7Ao4XJUGXlDC5vkbPC+znwQmrzy6AxwYGUH2VX4vVZHX8DQAq/sWauL1ucUZUaA==", // GbfuJZa4zLNgxHCrXNTXzVZ3CPUCe5RYWPBq9bU9qekP
    "XmidpDRbKR+D56M2trCoiPRzi1yxKy8aUnO+p3PuLxA8hz59ZTmu51Bn9qFsZHxaIWi1tCUd5ibpOj4pBKqTVA==", // 55H5CfmBxyaYnUhXxbToqT3FWhKMWmBJFrbd3WfuFy9u
    "CXioALq/oVhI/8QWp7AphKgZiJB1haG5kPomzHJ+n2jYMMYbLiWQ5knEMn9iu3T+5rn/YEs+M78sq5vOSwISWA==", // FYvCWxAdFQYyJJPSXNKv2dzsdKq98EwmdRiu6rpY65gT
    "YPIMBm2ykzl4I7GHdQyWqKwR9RJjiwNhDyOyWTHBjqdoLoa322EZkMKDzwDeycwd0vq3KrIs1ga19ecjWSJS0g==", // 81gYpXqg8ZT9gdkFSe35eqiitqBWqVfYwDwVfXuk8Xfw
    "m+OGOQSbwMu+Io83qHWOFdPZsWxnFhaz0zwzFS6C0TDvIpUrxJFh8CBFOCAHmTJpK+I/1Zv1FOeqsykz2BPgDA==" // H6V2ShFqjRaHyewiqaHN6E6ok1XRH2xv4Zwy3JpL8Cxb
  );

  const svm = fromWorkspace("").withSplPrograms();
  svm.airdrop(admin.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
  svm.airdrop(swaper.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

  // M Earn program
  svm.addProgramFromFile(EARN_PROGRAM_ID, "tests/programs/earn.so");

  // Sample extension programs for swapping
  svm.addProgramFromFile(extProgramA.publicKey, "tests/programs/ext_a.so");
  svm.addProgramFromFile(extProgramB.publicKey, "tests/programs/ext_b.so");

  // Replace the default token2022 program with updated one
  svm.addProgramFromFile(
    TOKEN_2022_PROGRAM_ID,
    "tests/programs/spl_token_2022.so"
  );

  // Anchor providers and programs
  const provider = new LiteSVMProvider(svm, new NodeWallet(admin));
  const program = new Program<ExtSwap>(EXT_SWAP, provider);
  const earn = new Program<Earn>(EARN, provider);
  const swapProgramA = new Program<MExt>(
    { ...M_EXT, address: extProgramA.publicKey },
    provider
  );
  const swapProgramB = new Program<MExt>(
    { ...M_EXT, address: extProgramB.publicKey },
    provider
  );

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

  describe("initialize swap programs", () => {
    it("create mints", async () => {
      // Mint auth for each program
      const [mMintAuth] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_authority")],
        EARN_PROGRAM_ID
      );
      const [mintAuthA] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint_authority")],
        swapProgramA.programId
      );
      const [mintAuthB] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint_authority")],
        swapProgramB.programId
      );

      // Create mint multisig
      const initializeMultisig = buildMutisigTxn(
        provider.connection,
        multisig,
        admin.publicKey,
        [admin.publicKey, mintAuthA, mintAuthB, mMintAuth]
      );
      await sendTransaction(initializeMultisig, [admin, multisig]);

      // Create all mints
      for (const [mint, mintAuth] of [
        [mMint, admin.publicKey],
        [mintA, mintAuthA],
        [mintB, mintAuthB],
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
    });
    it("initialize extension program A", async () => {
      await sendTransaction(
        swapProgramA.methods
          .initialize([program.programId], new BN(0))
          .accountsPartial({
            mMint: mMint.publicKey,
            extMint: mintA.publicKey,
          })
          .transaction(),
        [admin]
      );
    });
    it("initialize extension program B", async () => {
      await sendTransaction(
        swapProgramB.methods
          .initialize([program.programId], new BN(0))
          .accounts({
            mMint: mMint.publicKey,
            extMint: mintB.publicKey,
          })
          .transaction(),
        [admin]
      );
    });
  });

  // Tests
  describe("configure", () => {
    it("initialize config", async () => {
      await sendTransaction(
        program.methods
          .initializeGlobal(mMint.publicKey)
          .accounts({})
          .transaction(),
        [admin]
      );
    });

    it("re-initialize config revert", async () => {
      await sendTransaction(
        program.methods
          .initializeGlobal(mMint.publicKey)
          .accounts({ admin: swaper.publicKey })
          .signers([swaper])
          .transaction(),
        [swaper],
        /Allocate: account Address .* already in use/
      );
    });

    it("add to whitelist", async () => {
      await sendTransaction(
        program.methods
          .whitelistExt(new Keypair().publicKey, 0)
          .accounts({})
          .transaction(),
        [admin]
      );
    });

    it("remove from whitelist", async () => {
      const [global] = PublicKey.findProgramAddressSync(
        [Buffer.from("global")],
        program.programId
      );

      const globalAccount = await program.account.swapGlobal.fetch(global);
      const firstWhitelisted = globalAccount.whitelistedExtensions[0];

      const result = await sendTransaction(
        program.methods
          .whitelistExt(PublicKey.default, 0)
          .accounts({})
          .transaction(),
        [admin]
      );
      expect(result!.logs()[2]).toMatch(
        `Program log: ${firstWhitelisted.toBase58()} -> 11111111111111111111111111111111`
      );
    });

    it("invalid whitelist index", async () => {
      await sendTransaction(
        program.methods
          .whitelistExt(new Keypair().publicKey, 99)
          .accounts({})
          .transaction(),
        [admin],
        /Error Message: Index invalid for length of the array/
      );
    });
  });

  describe("swap", () => {});
});

function loadKeypairs(...keys: string[]): Keypair[] {
  return keys.map((k) => Keypair.fromSecretKey(Buffer.from(k, "base64")));
}

async function buildMutisigTxn(
  connection: Connection,
  ms: Keypair,
  creator: PublicKey,
  authorities: PublicKey[]
) {
  const multisigLamports = await getMinimumBalanceForRentExemptMultisig(
    connection
  );

  const createMultisigAccount = SystemProgram.createAccount({
    fromPubkey: creator,
    newAccountPubkey: ms.publicKey,
    space: 355,
    lamports: multisigLamports,
    programId: TOKEN_2022_PROGRAM_ID,
  });

  const initializeMultisig = createInitializeMultisigInstruction(
    ms.publicKey,
    authorities,
    1,
    TOKEN_2022_PROGRAM_ID
  );

  let tx = new Transaction();
  tx.add(createMultisigAccount, initializeMultisig);

  return tx;
}

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

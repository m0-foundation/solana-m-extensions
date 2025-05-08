import { BN, Program } from "@coral-xyz/anchor";
import { DynamicExt } from "../../target/types/dynamic_ext";
import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeInterestBearingMintInstruction,
  createInitializeMintInstruction,
  createInitializeScaledUiAmountConfigInstruction,
  createMintToCheckedInstruction,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getMintLen,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { Earn } from "../programs/earn";
import { TransactionMetadata } from "litesvm";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";

const EARN_IDL = require("../programs/earn.json");
const EXT_IDL = require("../../target/idl/dynamic_ext.json");

const EARN_PROGRAM_ID = new PublicKey(
  "MzeRokYa9o1ZikH6XHRiSS5nD8mNjZyHpLCBRTBSY4c"
);
const PROGRAM_ID = new PublicKey(
  "4yXxi6sRvWpYUUUx3CTnVKuKLYegooLoNakrePLLVoV4"
);

describe("dynamic ext tests", () => {
  const admin = new Keypair();
  const mMint: Keypair = new Keypair();
  const extMint: Keypair = new Keypair();

  for (const featuresSet of ["scaled-ui", "ibt", "yield-crank", "no-yield"]) {
    const svm = fromWorkspace("")
      .withSplPrograms()
      .withBuiltins()
      .withSysvars()
      .withBlockhashCheck(false);

    // Add the feature specific program
    svm.addProgramFromFile(PROGRAM_ID, `target/deploy/${featuresSet}.so`);

    // M Earn program
    svm.addProgramFromFile(EARN_PROGRAM_ID, "tests/programs/earn.so");

    // Replace the default token2022 program with the (newer) one from the workspace
    svm.addProgramFromFile(
      TOKEN_2022_PROGRAM_ID,
      "tests/programs/spl_token_2022.so"
    );

    svm.airdrop(admin.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const provider = new LiteSVMProvider(svm, new NodeWallet(admin));
    const program = new Program<DynamicExt>(EXT_IDL, provider);

    describe(`${featuresSet} tests`, () => {
      it("initialize", async () => {
        const initialIndex = new BN(1_000_000_000_000); // 1.0
        const claimCooldown = new BN(0); // None
        const initialEarnerRate = 415;

        const targetExt =
          featuresSet === "ibt"
            ? ExtensionType.InterestBearingConfig
            : ExtensionType.ScaledUiAmountConfig;

        // Create both mints
        const [extMintAuthority] = PublicKey.findProgramAddressSync(
          [Buffer.from("mint_authority")],
          PROGRAM_ID
        );
        await createMint(provider, admin, mMint, extMintAuthority, targetExt);
        await createMint(provider, admin, extMint, extMintAuthority, targetExt);

        const earn = new Program<Earn>(EARN_IDL, provider);
        const [mEarnGlobalAccount] = PublicKey.findProgramAddressSync(
          [Buffer.from("global")],
          EARN_PROGRAM_ID
        );

        // Initialize the earn program
        await earn.methods
          .initialize(
            admin.publicKey,
            initialIndex,
            initialEarnerRate,
            claimCooldown
          )
          .accountsPartial({
            admin: admin.publicKey,
            globalAccount: mEarnGlobalAccount,
            mint: mMint.publicKey,
          })
          .signers([admin])
          .rpc();

        const [globalAccount] = PublicKey.findProgramAddressSync(
          [Buffer.from("global")],
          PROGRAM_ID
        );

        // Initialize the dynamic extension program
        await program.methods
          .initialize(10, [])
          .accountsPartial({
            admin: admin.publicKey,
            globalAccount,
            mMint: mMint.publicKey,
            extMint: extMint.publicKey,
            extMintAuthority,
            mEarnGlobalAccount,
            token2022: TOKEN_2022_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();
      });
    });
  }
});

async function createMint(
  provider: LiteSVMProvider,
  admin: Keypair,
  mint: Keypair,
  mintAuthority: PublicKey,
  extensionType: ExtensionType,
  decimals = 6
) {
  let tx = new Transaction();

  const mintLen = getMintLen([extensionType]);

  tx.add(
    SystemProgram.createAccount({
      fromPubkey: admin.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(
        mintLen
      ),
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );

  if (extensionType === ExtensionType.ScaledUiAmountConfig) {
    tx.add(
      createInitializeScaledUiAmountConfigInstruction(
        mint.publicKey,
        mintAuthority,
        1.0,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }

  if (extensionType === ExtensionType.InterestBearingConfig) {
    tx.add(
      createInitializeInterestBearingMintInstruction(
        mint.publicKey,
        mintAuthority,
        1.0415,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }

  tx.add(
    createInitializeMintInstruction(
      mint.publicKey,
      decimals,
      mintAuthority, // mint authority
      mintAuthority, // freeze authority
      TOKEN_2022_PROGRAM_ID
    )
  );

  await provider.sendAndConfirm!(tx, [admin, mint]);
}

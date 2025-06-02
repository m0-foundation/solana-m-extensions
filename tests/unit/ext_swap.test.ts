import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import EXT_SWAP from "../../target/idl/ext_swap.json";
import { Program } from "@coral-xyz/anchor";
import { ExtSwap } from "../../target/types/ext_swap";
import { TransactionMetadata } from "litesvm";

const programIds = {
  EARN_PROGRAM_ID: new PublicKey("MzeRokYa9o1ZikH6XHRiSS5nD8mNjZyHpLCBRTBSY4c"),
};

describe("extension swap tests", () => {
  const [admin, swaper, mint] = loadKeypairs(
    "6iMOkgS4ZAfVxUWOdzo8y+MDoRLfuX4oPbzQf8D2RuigU2i7DwWQ+x304o+/2aa0K695awmnbv1JfL+WWnDcPQ==", // BnqzwtopjSGB9nHfMFYEa5p1kgeDBthfRP8yiLW9U7Kz
    "WmvqEmS7IwLjuBIMML4UY6d+VND9BnbG7B7Z4coApDdwumn5E6LBAS07RctOhxM5FXNEOizdNGuQwabX3Y/88w==", // 8b3XbqeN3VrrNH3u1WvjK5BasW5hKWKVpDGz5tsq5CbL
    "VIC7l0xRw067AiX75WtZ2ehN3+1wIpGmH6gWvS4jvx+8LhpnI+sGHFi+6tair18K2nd6yr2IR97C5qZZYkkl5A==",
    "XVFfL68OjRO5g+DZxbQHXVqEtoU976BAS6y5RP905ZIorgcghvm5mrP60XsmiUAp4aSIBadFzWUK/bbBmqweYA==",
    "1y1p2+YND+xDi/CbPGRN7fiE08xzoD9Fd2vsLvH9r930OgOUua+nXoCRzIl9SRyiM5GyHki7EtaTGXT8mi3qmg==",
    "UeJL1Qx6czzbwDTUjOHjKLJ7Ao4XJUGXlDC5vkbPC+znwQmrzy6AxwYGUH2VX4vVZHX8DQAq/sWauL1ucUZUaA=="
  );

  const svm = fromWorkspace("").withSplPrograms();
  svm.airdrop(admin.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
  svm.airdrop(swaper.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

  // M Earn program
  svm.addProgramFromFile(programIds.EARN_PROGRAM_ID, "tests/programs/earn.so");

  // Replace the default token2022 program with updated one
  svm.addProgramFromFile(
    TOKEN_2022_PROGRAM_ID,
    "tests/programs/spl_token_2022.so"
  );

  const provider = new LiteSVMProvider(svm, new NodeWallet(admin));
  const program = new Program<ExtSwap>(EXT_SWAP, provider);

  // Helper for sending transactions and checking errors
  const sendTransaction = async (
    builder: {
      transaction(): Promise<Transaction>;
    },
    ...signers: Keypair[]
  ): Promise<TransactionMetadata> => {
    const txn = await builder.transaction();

    txn.feePayer = admin.publicKey;
    txn.recentBlockhash = svm.latestBlockhash();
    txn.sign(...signers);

    const result = svm.sendTransaction(txn);

    if ("err" in result) {
      console.error(result.toString());
      throw new Error("Transaction failed");
    }

    return result;
  };

  // Tests
  describe("configure", () => {
    it("initialize config", async () => {
      const result = await sendTransaction(
        program.methods.initializeGlobal(mint.publicKey).accounts({}),
        admin
      );

      console.log(result);
    });
  });
});

function loadKeypairs(...keys: string[]): Keypair[] {
  return keys.map((k) => Keypair.fromSecretKey(Buffer.from(k, "base64")));
}

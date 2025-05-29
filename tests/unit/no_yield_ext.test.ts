import { Program, AnchorError, BN } from "@coral-xyz/anchor";
import { LiteSVM } from "litesvm";
import { LiteSVMProvider } from "anchor-litesvm";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  getAccount,
  getAccountLen,
  getMint,
  getMintLen,
  getMinimumBalanceForRentExemptMultisig,
  getAssociatedTokenAddressSync,
  createInitializeAccountInstruction,
  createInitializeMultisigInstruction,
  createMintToCheckedInstruction,
  ExtensionType,
  createInitializeImmutableOwnerInstruction,
  createApproveCheckedInstruction,
} from "@solana/spl-token";
import { randomInt } from "crypto";

import { MExt as NoYieldExt } from "../../target/types/no_yield";
const NO_YIELD_EXT_IDL = require("../../target/idl/no_yield.json");

import {
  Earn,
  EARN_IDL,
  PROGRAM_ID as EARN_PROGRAM_ID,
  MerkleTree,
  ProofElement,
} from "@m0-foundation/solana-m-sdk";

const PROGRAM_ID = new PublicKey(
  "3C865D264L4NkAm78zfnDzQJJvXuU3fMjRUvRxyPi5da"
);

// Unit tests for ext earn program

const ZERO_WORD = new Array(32).fill(0);

// Setup wallets once at the beginning of the test suite
const admin: Keypair = new Keypair();
const portal: Keypair = admin; // make the same since admin is allowed to push indices
const mMint: Keypair = new Keypair();
const extMint: Keypair = new Keypair();
const earnAuthority: Keypair = new Keypair();
const mMintAuthority: Keypair = new Keypair();
const wrapAuthority: Keypair = new Keypair();
const nonAdmin: Keypair = new Keypair();

// Create random addresses for testing
const nonWrapAuthority: Keypair = new Keypair();

let svm: LiteSVM;
let provider: LiteSVMProvider;
let accounts: Record<string, PublicKey | null> = {};
let earn: Program<Earn>;
let ext: Program<NoYieldExt>;

// Start parameters for M Earn
const initialSupply = new BN(100_000_000); // 100 tokens with 6 decimals
const initialIndex = new BN(1_100_000_000_000); // 1.1
const claimCooldown = new BN(0); // None

// Token Helper functions
const expectTokenBalance = async (
  tokenAccount: PublicKey,
  expectedBalance: BN
) => {
  const balance = (
    await getAccount(
      provider.connection,
      tokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    )
  ).amount;

  expect(balance.toString()).toEqual(expectedBalance.toString());
};

const createATA = async (
  mint: PublicKey,
  owner: PublicKey,
  use2022: boolean = true
) => {
  const tokenAccount = getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const createATA = createAssociatedTokenAccountInstruction(
    admin.publicKey, // payer
    tokenAccount, // ata
    owner, // owner
    mint, // mint
    use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  let tx = new Transaction().add(createATA);

  await provider.sendAndConfirm!(tx, [admin]);

  return tokenAccount;
};

const getATA = async (
  mint: PublicKey,
  owner: PublicKey,
  use2022: boolean = true
) => {
  // Check to see if the ATA already exists, if so return its key
  const tokenAccount = getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const tokenAccountInfo = svm.getAccount(tokenAccount);

  if (!tokenAccountInfo) {
    await createATA(mint, owner, use2022);
  }

  return tokenAccount;
};

const createTokenAccount = async (
  mint: PublicKey,
  owner: PublicKey,
  use2022: boolean = true
) => {
  // We want to create a token account that is not the ATA
  const tokenAccount = new Keypair();

  let tx = new Transaction();
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: admin.publicKey,
      newAccountPubkey: tokenAccount.publicKey,
      space: ACCOUNT_SIZE,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(
        ACCOUNT_SIZE
      ),
      programId: use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      tokenAccount.publicKey,
      mint,
      owner,
      TOKEN_2022_PROGRAM_ID
    )
  );

  await provider.sendAndConfirm!(tx, [admin, tokenAccount]);

  return { tokenAccount: tokenAccount.publicKey };
};

const closeTokenAccount = async (owner: Keypair, tokenAccount: PublicKey) => {
  const closeIx = createCloseAccountInstruction(
    tokenAccount,
    owner.publicKey,
    owner.publicKey,
    [],
    TOKEN_2022_PROGRAM_ID
  );

  let tx = new Transaction().add(closeIx);

  await provider.sendAndConfirm!(tx, [owner]);
};

const createMint = async (
  mint: Keypair,
  mintAuthority: PublicKey,
  use2022: boolean = true,
  decimals = 6
) => {
  // Create and initialize mint account

  const tokenProgram = use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  const mintLen = getMintLen([]);
  const mintLamports =
    await provider.connection.getMinimumBalanceForRentExemption(mintLen);
  const createMintAccount = SystemProgram.createAccount({
    fromPubkey: admin.publicKey,
    newAccountPubkey: mint.publicKey,
    space: mintLen,
    lamports: mintLamports,
    programId: tokenProgram,
  });

  const initializeMint = createInitializeMintInstruction(
    mint.publicKey,
    decimals, // decimals
    mintAuthority, // mint authority
    mintAuthority, // freeze authority
    tokenProgram
  );

  let tx = new Transaction();
  tx.add(createMintAccount, initializeMint);

  await provider.sendAndConfirm!(tx, [admin, mint]);

  // Verify the mint was created properly
  const mintInfo = await provider.connection.getAccountInfo(mint.publicKey);
  if (!mintInfo) {
    throw new Error("Mint account was not created");
  }

  return mint.publicKey;
};

const createMintWithMultisig = async (
  mint: Keypair,
  mintAuthority: Keypair
) => {
  // Create and initialize multisig mint authority on the token program
  const multisigLen = 355;
  // const multisigLamports = await provider.connection.getMinimumBalanceForRentExemption(multisigLen);
  const multisigLamports = await getMinimumBalanceForRentExemptMultisig(
    provider.connection
  );

  const createMultisigAccount = SystemProgram.createAccount({
    fromPubkey: admin.publicKey,
    newAccountPubkey: mintAuthority.publicKey,
    space: multisigLen,
    lamports: multisigLamports,
    programId: TOKEN_2022_PROGRAM_ID,
  });

  const earnTokenAuthority = getEarnTokenAuthority();

  const initializeMultisig = createInitializeMultisigInstruction(
    mintAuthority.publicKey, // account
    [portal, earnTokenAuthority],
    1,
    TOKEN_2022_PROGRAM_ID
  );

  let tx = new Transaction();
  tx.add(createMultisigAccount, initializeMultisig);

  await provider.sendAndConfirm!(tx, [admin, mintAuthority]);

  // Create and initialize mint account

  const mintLen = getMintLen([]);
  const mintLamports =
    await provider.connection.getMinimumBalanceForRentExemption(mintLen);
  const createMintWithMultisigAccount = SystemProgram.createAccount({
    fromPubkey: admin.publicKey,
    newAccountPubkey: mint.publicKey,
    space: mintLen,
    lamports: mintLamports,
    programId: TOKEN_2022_PROGRAM_ID,
  });

  const initializeMint = createInitializeMintInstruction(
    mint.publicKey,
    6, // decimals
    mintAuthority.publicKey, // mint authority
    null, // freeze authority
    TOKEN_2022_PROGRAM_ID
  );

  tx = new Transaction();
  tx.add(createMintWithMultisigAccount, initializeMint);

  await provider.sendAndConfirm!(tx, [admin, mint]);

  // Verify the mint was created properly
  const mintInfo = await provider.connection.getAccountInfo(mint.publicKey);
  if (!mintInfo) {
    throw new Error("Mint account was not created");
  }

  return mint.publicKey;
};

const mintM = async (to: PublicKey, amount: BN) => {
  const toATA: PublicKey = await getATA(mMint.publicKey, to);

  const mintToInstruction = createMintToCheckedInstruction(
    mMint.publicKey,
    toATA,
    mMintAuthority.publicKey,
    BigInt(amount.toString()),
    6,
    [portal],
    TOKEN_2022_PROGRAM_ID
  );

  let tx = new Transaction();
  tx.add(mintToInstruction);
  await provider.sendAndConfirm!(tx, [portal]);
};

const getTokenBalance = async (tokenAccount: PublicKey) => {
  const tokenAccountInfo = await getAccount(
    provider.connection,
    tokenAccount,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  if (!tokenAccountInfo) {
    throw new Error("Account not created");
  }

  return new BN(tokenAccountInfo.amount.toString());
};

const approve = async (
  source: Keypair,
  delegate: PublicKey,
  mint: PublicKey,
  amount: BN
) => {
  const sourceATA: PublicKey = await getATA(mint, source.publicKey);

  const approveIx = createApproveCheckedInstruction(
    sourceATA,
    mint,
    delegate,
    source.publicKey,
    BigInt(amount.toString()),
    6, // decimals
    [],
    TOKEN_2022_PROGRAM_ID
  );

  let tx = new Transaction();
  tx.add(approveIx);
  await provider.sendAndConfirm!(tx, [source]);

  return { sourceATA };
};

const warp = (seconds: BN, increment: boolean) => {
  const clock = svm.getClock();
  clock.unixTimestamp = increment
    ? clock.unixTimestamp + BigInt(seconds.toString())
    : BigInt(seconds.toString());
  svm.setClock(clock);
};

// Type definitions for accounts to make it easier to do comparisons

interface YieldConfig {}

interface ExtGlobal {
  admin?: PublicKey;
  extMint?: PublicKey;
  mMint?: PublicKey;
  mEarnGlobalAccount?: PublicKey;
  bump?: number;
  mVaultBump?: number;
  extMintAuthorityBump?: number;
  wrapAuthorities?: PublicKey[];
  yieldConfig?: YieldConfig;
}

const getEarnGlobalAccount = () => {
  const [globalAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    earn.programId
  );

  return globalAccount;
};

const getEarnTokenAuthority = () => {
  const [earnTokenAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_authority")],
    earn.programId
  );

  return earnTokenAuthority;
};

const getExtGlobalAccount = () => {
  const [globalAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    ext.programId
  );

  return globalAccount;
};

const getExtMintAuthority = () => {
  const [extMintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    ext.programId
  );

  return extMintAuthority;
};

const getMVault = () => {
  const [mVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("m_vault")],
    ext.programId
  );

  return mVault;
};

const getMEarnerAccount = (tokenAccount: PublicKey) => {
  const [earnerAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("earner"), tokenAccount.toBuffer()],
    earn.programId
  );

  return earnerAccount;
};

// Utility functions for the tests
const expectAccountEmpty = (account: PublicKey) => {
  const accountInfo = svm.getAccount(account);

  if (accountInfo) {
    expect(accountInfo.lamports).toBe(0);
    expect(accountInfo.data.length).toBe(0);
    expect(accountInfo.owner).toStrictEqual(SystemProgram.programId);
  }
};

const expectAnchorError = async (
  txResult: Promise<string>,
  errCode: string
) => {
  try {
    await txResult;
    throw new Error("Transaction should have reverted");
  } catch (e) {
    if (!(e instanceof AnchorError))
      throw new Error(`Expected AnchorError, got ${e}`);
    const err: AnchorError = e;
    expect(err.error.errorCode.code).toStrictEqual(errCode);
  }
};

const expectSystemError = async (txResult: Promise<string>) => {
  let reverted = false;
  try {
    await txResult;
  } catch (e) {
    // console.log(e.transactionMessage);
    // console.log(e.logs);
    reverted = true;
  } finally {
    expect(reverted).toBe(true);
  }
};

const expectExtGlobalState = async (
  globalAccount: PublicKey,
  expected: ExtGlobal
) => {
  const state = await ext.account.extGlobal.fetch(globalAccount);

  if (expected.admin) expect(state.admin).toEqual(expected.admin);
  if (expected.extMint) expect(state.extMint).toEqual(expected.extMint);
  if (expected.mMint) expect(state.mMint).toEqual(expected.mMint);
  if (expected.mEarnGlobalAccount)
    expect(state.mEarnGlobalAccount).toEqual(expected.mEarnGlobalAccount);
  if (expected.yieldConfig)
    expect(state.yieldConfig).toEqual(expected.yieldConfig);
  if (expected.bump) expect(state.bump).toEqual(expected.bump);
  if (expected.mVaultBump)
    expect(state.mVaultBump).toEqual(expected.mVaultBump);
  if (expected.extMintAuthorityBump)
    expect(state.extMintAuthorityBump).toEqual(expected.extMintAuthorityBump);
};

const createUniqueKeyArray = (size: number) => {
  return new Array(size).fill(PublicKey.default).map((_, i, arr) => {
    let key = PublicKey.unique();
    while (key.equals(PublicKey.default) || arr.includes(key)) {
      key = PublicKey.unique();
    }
    return key;
  });
};

const padKeyArray = (array: PublicKey[], desiredLen: number) => {
  const currentLen = array.length;

  if (currentLen > desiredLen) {
    throw new Error("Array is too long");
  }

  const padding = new Array(desiredLen - currentLen).fill(PublicKey.default);
  return array.concat(padding);
};

// instruction convenience functions for earn program
const prepEarnInitialize = (signer: Keypair, mint: PublicKey) => {
  // Get the global PDA
  const globalAccount = getEarnGlobalAccount();

  // Populate accounts for the instruction
  accounts = {};
  accounts.admin = signer.publicKey;
  accounts.globalAccount = globalAccount;
  accounts.mint = mint;
  accounts.systemProgram = SystemProgram.programId;

  return { globalAccount };
};

const initializeEarn = async (
  mint: PublicKey,
  earnAuthority: PublicKey,
  initialIndex: BN,
  claimCooldown: BN
) => {
  // Setup the instruction
  const { globalAccount } = prepEarnInitialize(admin, mint);

  // Send the transaction
  try {
    await earn.methods
      .initialize(earnAuthority, initialIndex, claimCooldown)
      .accountsPartial({ ...accounts })
      .signers([admin])
      .rpc();
  } catch (e) {
    console.log(e);
    throw e;
  }

  return globalAccount;
};

const prepPropagateIndex = (signer: Keypair) => {
  // Get the global PDA
  const globalAccount = getEarnGlobalAccount();

  // Populate accounts
  accounts = {};
  accounts.signer = signer.publicKey;
  accounts.globalAccount = globalAccount;
  accounts.mint = mMint.publicKey;

  return { globalAccount };
};

const propagateIndex = async (
  newIndex: BN,
  earnerMerkleRoot: number[] = ZERO_WORD
) => {
  // Setup the instruction
  const { globalAccount } = prepPropagateIndex(portal);

  // Send the instruction
  await earn.methods
    .propagateIndex(newIndex, earnerMerkleRoot)
    .accountsPartial({ ...accounts })
    .signers([portal])
    .rpc();

  // We don't check state here because it depends on the circumstances

  return { globalAccount };
};

const prepMClaimFor = async (
  signer: Keypair,
  mint: PublicKey,
  earner: PublicKey
) => {
  // Get the global and token authority PDAs
  const globalAccount = getEarnGlobalAccount();
  const earnTokenAuthority = getEarnTokenAuthority();

  // Get the earner ATA
  const earnerATA = await getATA(mint, earner);

  // Get the earner account
  const earnerAccount = getMEarnerAccount(earnerATA);

  // Populate accounts
  accounts = {};
  accounts.earnAuthority = signer.publicKey;
  accounts.globalAccount = globalAccount;
  accounts.earnerAccount = earnerAccount;
  accounts.mint = mint;
  accounts.mintMultisig = mMintAuthority.publicKey;
  accounts.tokenAuthorityAccount = earnTokenAuthority;
  accounts.userTokenAccount = earnerATA;
  accounts.tokenProgram = TOKEN_2022_PROGRAM_ID;

  return { globalAccount, earnerAccount, earnerATA };
};

const mClaimFor = async (earner: PublicKey, balance?: BN) => {
  // Setup the instruction
  const { globalAccount, earnerAccount, earnerATA } = await prepMClaimFor(
    earnAuthority,
    mMint.publicKey,
    earner
  );

  const snapshotBalance = balance ?? (await getTokenBalance(earnerATA));

  // Send the instruction
  await earn.methods
    .claimFor(snapshotBalance)
    .accountsPartial({ ...accounts })
    .signers([earnAuthority])
    .rpc();

  return { globalAccount, earnerAccount, earnerATA };
};

const prepCompleteClaims = (signer: Keypair) => {
  // Get the global PDA
  const globalAccount = getEarnGlobalAccount();

  // Populate accounts
  accounts = {};
  accounts.earnAuthority = signer.publicKey;
  accounts.globalAccount = globalAccount;

  return { globalAccount };
};

const completeClaims = async () => {
  // Setup the instruction
  prepCompleteClaims(earnAuthority);

  // Send the instruction
  await earn.methods
    .completeClaims()
    .accountsPartial({ ...accounts })
    .signers([earnAuthority])
    .rpc();
};

const prepAddRegistrarEarner = (signer: Keypair, earnerATA: PublicKey) => {
  // Get the global PDA
  const globalAccount = getEarnGlobalAccount();

  // Get the earner account
  const earnerAccount = getMEarnerAccount(earnerATA);

  // Populate accounts
  accounts = {};
  accounts.signer = signer.publicKey;
  accounts.userTokenAccount = earnerATA;
  accounts.globalAccount = globalAccount;
  accounts.earnerAccount = earnerAccount;
  accounts.systemProgram = SystemProgram.programId;

  return { globalAccount, earnerAccount };
};

const addRegistrarEarner = async (earner: PublicKey, proof: ProofElement[]) => {
  // Get the earner ATA
  const earnerATA = await getATA(mMint.publicKey, earner);

  // Setup the instruction
  prepAddRegistrarEarner(nonAdmin, earnerATA);

  // Send the instruction
  await earn.methods
    .addRegistrarEarner(earner, proof)
    .accountsPartial({ ...accounts })
    .signers([nonAdmin])
    .rpc();
};

// Helper functions for preparing and executing NoYieldExt instructions

const prepExtInitialize = async (signer: Keypair) => {
  // Get the global PDA
  const globalAccount = getExtGlobalAccount();

  // Populate accounts for the instruction
  accounts = {};
  accounts.admin = signer.publicKey;
  accounts.globalAccount = globalAccount;
  accounts.mMint = mMint.publicKey;
  accounts.extMint = extMint.publicKey;
  accounts.extMintAuthority = getExtMintAuthority();
  accounts.mEarnGlobalAccount = getEarnGlobalAccount();
  accounts.mVault = getMVault();
  accounts.vaultMTokenAccount = await getATA(mMint.publicKey, accounts.mVault);
  accounts.systemProgram = SystemProgram.programId;
  accounts.mTokenProgram = TOKEN_2022_PROGRAM_ID;
  accounts.extTokenProgramn = TOKEN_2022_PROGRAM_ID;

  return { globalAccount };
};

const initializeExt = async (wrapAuthorities: PublicKey[]) => {
  // Setup the instruction
  const { globalAccount } = await prepExtInitialize(admin);

  // Send the transaction
  await ext.methods
    .initialize(wrapAuthorities)
    .accountsPartial({ ...accounts })
    .signers([admin])
    .rpc();

  return globalAccount;
};

const prepSetMMint = async (
  signer: Keypair,
  mint: PublicKey,
  newVaultMTokenAccount?: PublicKey
) => {
  // Get the global PDA
  const globalAccount = getExtGlobalAccount();

  // Populate accounts for the instruction
  accounts = {};
  accounts.admin = signer.publicKey;
  accounts.globalAccount = globalAccount;
  accounts.mVault = getMVault();
  accounts.mMint = mMint.publicKey;
  accounts.vaultMTokenAccount = await getATA(mMint.publicKey, accounts.mVault);
  accounts.newMMint = mint;
  accounts.newVaultMTokenAccount =
    newVaultMTokenAccount ?? (await getATA(mint, accounts.mVault));

  return { globalAccount };
};

const setMMint = async (mint: PublicKey) => {
  // Setup the instruction
  const { globalAccount } = await prepSetMMint(admin, mint);

  // Send the instruction
  await ext.methods
    .setMMint()
    .accountsPartial({ ...accounts })
    .signers([admin])
    .rpc();

  return globalAccount;
};

const prepUpdateWrapAuthority = (signer: Keypair) => {
  // Get the global PDA
  const globalAccount = getExtGlobalAccount();

  // Populate accounts for the instruction
  accounts = {};
  accounts.admin = signer.publicKey;
  accounts.globalAccount = globalAccount;

  return { globalAccount };
};

const prepWrap = async (
  from: Keypair,
  to?: PublicKey,
  fromMTokenAccount?: PublicKey,
  toExtTokenAccount?: PublicKey,
  vaultMTokenAccount?: PublicKey
) => {
  // Get the M vault pda
  const mVault = getMVault();

  // Populate accounts
  accounts = {};
  accounts.signer = from.publicKey;
  accounts.mMint = mMint.publicKey;
  accounts.extMint = extMint.publicKey;
  accounts.globalAccount = getExtGlobalAccount();
  accounts.mEarnGlobalAccount = getEarnGlobalAccount();
  accounts.mVault = mVault;
  accounts.extMintAuthority = getExtMintAuthority();
  accounts.fromMTokenAccount =
    fromMTokenAccount ?? (await getATA(mMint.publicKey, from.publicKey));
  accounts.toExtTokenAccount =
    toExtTokenAccount ??
    (await getATA(extMint.publicKey, to ?? from.publicKey));
  accounts.vaultMTokenAccount =
    vaultMTokenAccount ?? (await getATA(mMint.publicKey, mVault));
  accounts.mTokenProgram = TOKEN_2022_PROGRAM_ID;
  accounts.extTokenProgram = TOKEN_2022_PROGRAM_ID;

  return {
    vaultMTokenAccount: accounts.vaultMTokenAccount,
    fromMTokenAccount: accounts.fromMTokenAccount,
    toExtTokenAccount: accounts.toExtTokenAccount,
  };
};

const wrap = async (from: Keypair, amount: BN, to?: PublicKey) => {
  // Setup the instruction
  const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } =
    await prepWrap(from, to);

  // Send the instruction
  await ext.methods
    .wrap(amount)
    .accountsPartial({ ...accounts })
    .signers([from])
    .rpc();

  return { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount };
};

const prepUnwrap = async (
  from: Keypair,
  to?: PublicKey,
  toMTokenAccount?: PublicKey,
  fromExtTokenAccount?: PublicKey,
  vaultMTokenAccount?: PublicKey
) => {
  // Get m vault pda
  const mVault = getMVault();

  // Populate accounts
  accounts = {};
  accounts.signer = from.publicKey;
  accounts.mMint = mMint.publicKey;
  accounts.extMint = extMint.publicKey;
  accounts.globalAccount = getExtGlobalAccount();
  accounts.mEarnGlobalAccount = getEarnGlobalAccount();
  accounts.mVault = mVault;
  accounts.extMintAuthority = getExtMintAuthority();
  accounts.toMTokenAccount =
    toMTokenAccount ?? (await getATA(mMint.publicKey, to ?? from.publicKey));
  accounts.fromExtTokenAccount =
    fromExtTokenAccount ?? (await getATA(extMint.publicKey, from.publicKey));
  accounts.vaultMTokenAccount =
    vaultMTokenAccount ?? (await getATA(mMint.publicKey, mVault));
  accounts.mTokenProgram = TOKEN_2022_PROGRAM_ID;
  accounts.extTokenProgram = TOKEN_2022_PROGRAM_ID;

  return {
    vaultMTokenAccount: accounts.vaultMTokenAccount,
    toMTokenAccount: accounts.toMTokenAccount,
    fromExtTokenAccount: accounts.fromExtTokenAccount,
  };
};

const unwrap = async (from: Keypair, amount: BN, to?: PublicKey) => {
  // Setup the instruction
  const { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount } =
    await prepUnwrap(from, to);

  // Send the instruction
  await ext.methods
    .unwrap(amount)
    .accountsPartial({ ...accounts })
    .signers([from])
    .rpc();

  return { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount };
};

const prepClaimFees = async (signer: Keypair, toTokenAccount?: PublicKey) => {
  // Get the global PDA
  const globalAccount = getExtGlobalAccount();

  // Populate accounts for the instruction
  accounts = {};
  accounts.admin = signer.publicKey;
  accounts.globalAccount = globalAccount;
  accounts.mEarnGlobalAccount = getEarnGlobalAccount();
  accounts.extMint = extMint.publicKey;
  accounts.extMintAuthority = getExtMintAuthority();
  accounts.mVault = getMVault();
  accounts.vaultMTokenAccount = await getATA(
    mMint.publicKey,
    accounts.mVault,
    true
  );
  accounts.recipientExtTokenAccount =
    toTokenAccount ?? (await getATA(extMint.publicKey, signer.publicKey, true));
  accounts.mTokenProgram = TOKEN_2022_PROGRAM_ID;
  accounts.extTokenProgram = TOKEN_2022_PROGRAM_ID;

  return { globalAccount };
};

const claimFees = async (toTokenAccount?: PublicKey) => {
  // Setup the instruction
  const { globalAccount } = await prepClaimFees(admin, toTokenAccount);

  // Send the instruction
  await ext.methods
    .claimFees()
    .accountsPartial({ ...accounts })
    .signers([admin])
    .rpc();

  return globalAccount;
};

describe("NoYieldExt unit tests", () => {
  let currentTime: () => BN;

  beforeEach(async () => {
    // Initialize the SVM instance with all necessary configurations
    svm = new LiteSVM()
      .withSplPrograms() // Add SPL programs (including token programs)
      .withBuiltins() // Add builtin programs
      .withSysvars() // Setup standard sysvars
      .withPrecompiles() // Add standard precompiles
      .withBlockhashCheck(true); // Optional: disable blockhash checking for tests

    // Add the earn program to the SVM instance
    svm.addProgramFromFile(EARN_PROGRAM_ID, "tests/programs/earn.so");

    // Replace the default token2022 program with the (newer) one from the workspace
    svm.addProgramFromFile(
      TOKEN_2022_PROGRAM_ID,
      "tests/programs/spl_token_2022.so"
    );

    // Add the no_yield_ext program to the SVM instance
    svm.addProgramFromFile(PROGRAM_ID, "target/deploy/no_yield.so");

    // Create an anchor provider from the liteSVM instance
    provider = new LiteSVMProvider(svm);

    // Create program instances
    earn = new Program<Earn>(EARN_IDL, provider);
    ext = new Program<NoYieldExt>(NO_YIELD_EXT_IDL, provider);

    // Fund the wallets
    svm.airdrop(admin.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    svm.airdrop(earnAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    svm.airdrop(nonAdmin.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    svm.airdrop(wrapAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    svm.airdrop(nonWrapAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    currentTime = () => {
      return new BN(svm.getClock().unixTimestamp.toString());
    };

    // Create the M token mint
    await createMintWithMultisig(mMint, mMintAuthority);

    // Create the Ext token mint
    await createMint(extMint, getExtMintAuthority());

    // Mint some m tokens to have a non-zero supply
    await mintM(admin.publicKey, initialSupply);

    // Initialize the earn program
    await initializeEarn(
      mMint.publicKey,
      earnAuthority.publicKey,
      initialIndex,
      claimCooldown
    );

    // Add the m vault as an M earner
    const mVault = getMVault();
    const earnerMerkleTree = new MerkleTree([admin.publicKey, mVault]);

    // Propagate the merkle root
    await propagateIndex(initialIndex, earnerMerkleTree.getRoot());

    // Add the earner account for the vault
    const { proof } = earnerMerkleTree.getInclusionProof(mVault);
    await addRegistrarEarner(mVault, proof);
  });

  describe("admin instruction tests", () => {
    describe("initialize unit tests", () => {
      // test cases
      // [X] given the m_mint is not owned by the token2022 program
      //   [X] it reverts with a ConstraintAddress error
      // [X] given the ext_mint is not owned by the token2022 program
      //   [X] it reverts with a ConstraintMintTokenProgram error
      // [X] given the ext_mint decimals do not match the m_mint decimals
      //   [X] it reverts with a ConstraintMintDecimals error
      // [X] given the M earn global account does not match the PDA on the earn program
      //   [X] it reverts with a SeedsConstraint error
      // [X] given the ext_mint_authority is not the required PDA
      //   [X] it reverts with a SeedsConstraint error
      // [X] given more than 10 wrap authorities are provided
      //   [X] it reverts with an InvalidParam error
      // [X] given wrap authorities includes the system program id (default public key)
      //   [X] it reverts with an InvalidParam error
      // [X] given the wrap authorities are not unique
      //   [X] it reverts with an InvalidParam error
      // [X] given all accounts and params are correct
      //   [X] the global account is created
      //   [X] the admin is set to the signer
      //   [X] the m_mint is set correctly
      //   [X] the ext_mint is set correctly
      //   [X] the m_earn_global_account is set correctly
      //   [X] the bumps are set correctly
      //   [X] the wrap authorities are set correctly

      // given the m_mint is not owned by the token2022 program
      // it reverts with a ConstraintAddress error
      test("m_mint not owned by token2022 - reverts", async () => {
        // Create a mint owned by a different program
        const wrongMint = new Keypair();
        await createMint(wrongMint, nonAdmin.publicKey, false);

        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the M mint and vault token account
        accounts.mMint = wrongMint.publicKey;
        accounts.vaultMTokenAccount = await getATA(
          wrongMint.publicKey,
          getMVault(),
          false
        );

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .initialize([])
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          "ConstraintAddress"
        );
      });

      // given the ext_mint is not owned by the token2022 program
      // it reverts with a ConstraintMintTokenProgram error
      test("ext_mint not owned by token2022 - reverts", async () => {
        // Create a mint owned by a different program
        const wrongMint = new Keypair();
        await createMint(wrongMint, nonAdmin.publicKey, false);

        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the Ext Mint
        accounts.extMint = wrongMint.publicKey;

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .initialize([])
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          "ConstraintMintTokenProgram"
        );
      });

      // given the decimals on ext_mint do not match M
      // it reverts with a MintDecimals error
      test("ext_mint incorrect decimals - reverts", async () => {
        // Create a mint owned by a different program
        const badMint = new Keypair();
        await createMint(badMint, nonAdmin.publicKey, true, 9);

        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the Ext Mint
        accounts.extMint = badMint.publicKey;

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .initialize([])
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          "ConstraintMintDecimals"
        );
      });

      // given the M earn global account is invalid
      // it reverts with a seeds constraint
      test("m_earn_global_account is incorrect - reverts", async () => {
        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the m earn global account
        accounts.mEarnGlobalAccount = PublicKey.unique();
        if (accounts.mEarnGlobalAccount == getEarnGlobalAccount()) return;

        // Attempt to send transaction
        // Expect error (could be one of several "SeedsConstraint", "AccountOwnedByWrongProgram", "AccountNotInitialized")
        await expectSystemError(
          ext.methods
            .initialize([])
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc()
        );
      });

      // given ext_mint_authority is not required PDA
      // it reverts with a seeds constraint
      test("ext_mint_authority is incorrect - reverts", async () => {
        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the ext mint authority
        accounts.extMintAuthority = PublicKey.unique();
        if (accounts.extMintAuthority == getExtMintAuthority()) return;

        // Attempt to send transaction
        // Expect error (could be one of several "SeedsConstraint", "AccountOwnedByWrongProgram", "AccountNotInitialized")
        await expectSystemError(
          ext.methods
            .initialize([])
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc()
        );
      });

      // given more than 10 wrap authorities are provided
      // it reverts with an InvalidParam error
      test("more than 10 wrap authorities provided - reverts", async () => {
        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the wrap authorities
        const wrapAuthorities: PublicKey[] = createUniqueKeyArray(11);

        // Attempt to send transaction
        await expectAnchorError(
          ext.methods
            .initialize(wrapAuthorities)
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          "InvalidParam"
        );
      });

      // given wrap authorities includes the system program id (default public key)
      // it reverts with an InvalidParam error
      test("wrap authorities includes the system program id - reverts", async () => {
        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the wrap authorities
        const wrapAuthorities: PublicKey[] = createUniqueKeyArray(10);
        wrapAuthorities[0] = SystemProgram.programId;

        // Attempt to send transaction
        await expectAnchorError(
          ext.methods
            .initialize(wrapAuthorities)
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          "InvalidParam"
        );
      });

      // given wrap authorities includes a duplicate, non-default public key
      // it reverts with an InvalidParam error
      test("wrap authorities includes a duplicate, non-default public key - reverts", async () => {
        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the wrap authorities
        const wrapAuthorities: PublicKey[] = createUniqueKeyArray(10);
        wrapAuthorities[0] = wrapAuthorities[1];

        // Attempt to send transaction
        await expectAnchorError(
          ext.methods
            .initialize(wrapAuthorities)
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          "InvalidParam"
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
        // Setup the instruction call
        prepExtInitialize(admin);

        // Get a random number of wrap authorities
        // We use the padded array to check the stored state after the call
        const numWrapAuthorities = randomInt(10);
        const wrapAuthorities: PublicKey[] =
          createUniqueKeyArray(numWrapAuthorities);
        const paddedWrapAuthorities = padKeyArray(wrapAuthorities, 10);

        // Derive PDA bumps
        const [, bump] = PublicKey.findProgramAddressSync(
          [Buffer.from("global")],
          ext.programId
        );
        const [, mVaultBump] = PublicKey.findProgramAddressSync(
          [Buffer.from("m_vault")],
          ext.programId
        );
        const [, extMintAuthorityBump] = PublicKey.findProgramAddressSync(
          [Buffer.from("mint_authority")],
          ext.programId
        );

        // Ensure the global account has not been created yet
        const globalAccount = getExtGlobalAccount();
        expectAccountEmpty(globalAccount);

        // Send the transaction
        await ext.methods
          .initialize(wrapAuthorities)
          .accountsPartial({ ...accounts })
          .signers([admin])
          .rpc();

        // Check the state of the global account
        await expectExtGlobalState(globalAccount, {
          admin: admin.publicKey,
          extMint: extMint.publicKey,
          mMint: mMint.publicKey,
          mEarnGlobalAccount: getEarnGlobalAccount(),
          bump,
          mVaultBump,
          extMintAuthorityBump,
          wrapAuthorities: paddedWrapAuthorities,
          yieldConfig: {},
        });
      });
    });

    describe("set_m_mint unit tests", () => {
      beforeEach(async () => {
        // Initialize the extension program
        await initializeExt([admin.publicKey, wrapAuthority.publicKey]);

        // wrap some tokens to the make the m vault's balance non-zero
        await wrap(admin, initialSupply);
      });

      // test cases
      // [X] given the admin does not sign the transaction
      //   [X] it reverts with a NotAuthorized error
      // [X] given the admin signs the transaction
      //   [X] given the new m mint is not owned by the token2022 program
      //     [X] it reverts with a ConstraintMintTokenProgram error
      //   [X] given the new m mint has a different number of decimals than the existing m mint
      //     [X] it reverts with a ConstraintMintDecimals error
      //   [X] given the m vault is not the m vault PDA
      //     [X] it reverts with a ConstraintSeeds error
      //   [X] given the m vault token account for the current m mint is not the m vault PDA's ATA
      //     [X] it reverts with a ConstraintAssociated error
      //   [X] given the m vault token account for the new m mint is not the m vault PDA's ATA
      //     [X] it reverts with a ConstraintAssociated error
      //   [X] given the m vault token account for the new m mint has fewer tokens than the m vault token account for the current m mint
      //     [X] it reverts with an InsufficientCollateral error
      //   [X] given all the accounts are correct
      //     [X] it sets the m mint to the new mint

      // given the admin does not sign the transaction
      // it reverts with a NotAuthorized error
      test("admin does not sign - reverts", async () => {
        // Create a new m mint that is valid
        const newMint = new Keypair();
        await createMint(newMint, nonAdmin.publicKey, true, 6);

        // Setup the instruction
        await prepSetMMint(nonAdmin, newMint.publicKey);

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .setMMint()
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          "NotAuthorized"
        );
      });

      // given the admin signs the transaction
      // given the new m mint is not owned by the token2022 program
      // it reverts with a ConstraintAddress error
      test("new m mint not owned by token2022 - reverts", async () => {
        // Create a new m mint that is valid
        const newMint = new Keypair();
        await createMint(newMint, nonAdmin.publicKey, false);

        // Setup the instruction
        const newVaultATA = await getATA(newMint.publicKey, getMVault(), false);
        await prepSetMMint(admin, newMint.publicKey, newVaultATA);

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .setMMint()
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc(),
          "ConstraintMintTokenProgram"
        );
      });

      // given the new m mint has a different number of decimals than the existing m mint
      // it reverts with a ConstraintMintDecimals error
      test("new m mint incorrect decimals - reverts", async () => {
        // Create a new m mint that is valid
        const newMint = new Keypair();
        await createMint(newMint, nonAdmin.publicKey, true, 9);

        // Setup the instruction
        await prepSetMMint(admin, newMint.publicKey);

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .setMMint()
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc(),
          "ConstraintMintDecimals"
        );
      });

      // given the m vault is not the m vault PDA
      // it reverts with a SeedsConstraint error
      test("m vault is not the m vault PDA - reverts", async () => {
        // Create a new m mint that is valid
        const newMint = new Keypair();
        await createMint(newMint, nonAdmin.publicKey, true, 6);

        // Setup the instruction
        await prepSetMMint(admin, newMint.publicKey);

        // Change the m vault
        accounts.mVault = PublicKey.unique();

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .setMMint()
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc(),
          "ConstraintSeeds"
        );
      });

      // given the m vault token account for the current m mint is not the m vault PDA's ATA
      // it reverts with a ConstraintAssociated error
      test("m vault token account for current m mint is not the m vault PDA's ATA - reverts", async () => {
        // Create a new m mint that is valid
        const newMint = new Keypair();
        await createMint(newMint, nonAdmin.publicKey, true, 6);

        // Setup the instruction
        await prepSetMMint(admin, newMint.publicKey);

        // Change the m vault token account
        const { tokenAccount: nonAtaAccount } = await createTokenAccount(
          mMint.publicKey,
          getMVault()
        );
        accounts.vaultMTokenAccount = nonAtaAccount;

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .setMMint()
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc(),
          "ConstraintAssociated"
        );
      });

      // given the m vault token account for the new m mint is not the m vault PDA's ATA
      // it reverts with a ConstraintAssociated error
      test("m vault token account for new m mint is not the m vault PDA's ATA - reverts", async () => {
        // Create a new m mint that is valid
        const newMint = new Keypair();
        await createMint(newMint, nonAdmin.publicKey, true, 6);

        // Setup the instruction
        await prepSetMMint(admin, newMint.publicKey);

        // Change the m vault token account
        const { tokenAccount: nonAtaAccount } = await createTokenAccount(
          newMint.publicKey,
          getMVault()
        );
        accounts.newVaultMTokenAccount = nonAtaAccount;

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .setMMint()
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc(),
          "ConstraintAssociated"
        );
      });

      // given the m vault token account for the new m mint has fewer tokens than the m vault token account for the current m mint
      // it reverts with an InsufficientCollateral error
      test("new m mint vault token account has fewer tokens than current m mint vault token account - reverts", async () => {
        // Create a new m mint that is valid
        const newMint = new Keypair();
        await createMint(newMint, nonAdmin.publicKey, true, 6);

        // Create the ATA for the m vault for the new mint and mint some tokens to it
        const mVaultATA: PublicKey = await getATA(
          newMint.publicKey,
          getMVault()
        );

        const amount = BigInt(randomInt(initialSupply.toNumber()));

        const mintToInstruction = createMintToCheckedInstruction(
          newMint.publicKey,
          mVaultATA,
          nonAdmin.publicKey,
          amount,
          6,
          [],
          TOKEN_2022_PROGRAM_ID
        );

        let tx = new Transaction();
        tx.add(mintToInstruction);
        await provider.sendAndConfirm!(tx, [nonAdmin]);

        // Setup the instruction
        await prepSetMMint(admin, newMint.publicKey);

        // Send the transaction
        // Expect an insufficient collateral error
        await expectAnchorError(
          ext.methods
            .setMMint()
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc(),
          "InsufficientCollateral"
        );
      });

      // given all the accounts are correct
      // it sets the m mint to the new mint
      // Create a new m mint that is valid
      test("set m mint - success", async () => {
        const newMint = new Keypair();
        await createMint(newMint, nonAdmin.publicKey, true, 6);

        // Create the ATA for the m vault for the new mint and mint some tokens to it
        const mVaultATA: PublicKey = await getATA(
          newMint.publicKey,
          getMVault()
        );

        const amount = BigInt(initialSupply.toString());

        const mintToInstruction = createMintToCheckedInstruction(
          newMint.publicKey,
          mVaultATA,
          nonAdmin.publicKey,
          amount,
          6,
          [],
          TOKEN_2022_PROGRAM_ID
        );

        let tx = new Transaction();
        tx.add(mintToInstruction);
        await provider.sendAndConfirm!(tx, [nonAdmin]);

        // Setup the instruction
        const { globalAccount } = await prepSetMMint(admin, newMint.publicKey);

        // Send the transaction
        await ext.methods
          .setMMint()
          .accountsPartial({ ...accounts })
          .signers([admin])
          .rpc();

        // Check that the m mint was updated
        expectExtGlobalState(globalAccount, {
          mMint: newMint.publicKey,
        });
      });
    });

    describe("update_wrap_authority unit tests", () => {
      const wrapAuthorities = [admin.publicKey, wrapAuthority.publicKey];
      const paddedWrapAuthorities = padKeyArray(wrapAuthorities, 10);

      beforeEach(async () => {
        // Initialize the extension program
        await initializeExt(wrapAuthorities);
      });

      // test cases
      // [X] given the admin does not sign the transaction
      //   [X] it reverts with a NotAuthorized error
      // [X] given the admin signs the transaction
      //   [X] given the index is out of bounds
      //     [X] it reverts with a InvalidParam error
      //   [X] given the new wrap authority is already in the list (and not the default public key)
      //     [X] it reverts with a InvalidParam error
      //   [X] given the new wrap authority is the default public key
      //     [X] it removes the wrap authority at the given index
      //   [X] given the new wrap authority is not the default public key and not in the list
      //     [X] it adds the new wrap authority to the list at the provided index

      // given the admin does not sign the transaction
      // it reverts with a NotAuthorized error
      test("admin does not sign - reverts", async () => {
        // Setup the instruction
        await prepUpdateWrapAuthority(nonAdmin);

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .updateWrapAuthority(0, nonWrapAuthority.publicKey)
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          "NotAuthorized"
        );
      });

      // given the admin signs the transaction
      // given the index is out of bounds
      // it reverts with a InvalidParam error
      test("index out of bounds - reverts", async () => {
        // Setup the instruction
        await prepUpdateWrapAuthority(admin);

        const index = randomInt(11, 256);

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .updateWrapAuthority(index, nonWrapAuthority.publicKey)
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc(),
          "InvalidParam"
        );
      });

      // given the admin signs the transaction
      // given the new wrap authority is already in the list (and not the default public key)
      // it reverts with a InvalidParam error
      test("new wrap authority already in the list - reverts", async () => {
        // Setup the instruction
        await prepUpdateWrapAuthority(admin);

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .updateWrapAuthority(0, wrapAuthority.publicKey)
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc(),
          "InvalidParam"
        );
      });

      // given the admin signs the transaction
      // given the new wrap authority is the default public key
      // it removes the wrap authority at the given index
      test("new wrap authority is the default public key - success", async () => {
        // Setup the instruction
        const { globalAccount } = await prepUpdateWrapAuthority(admin);

        // Send the transaction
        await ext.methods
          .updateWrapAuthority(0, SystemProgram.programId)
          .accountsPartial({ ...accounts })
          .signers([admin])
          .rpc();

        // Check that the wrap authority was removed
        const updatedWrapAuthorities = paddedWrapAuthorities.slice(0);
        updatedWrapAuthorities[0] = SystemProgram.programId;

        await expectExtGlobalState(globalAccount, {
          wrapAuthorities: updatedWrapAuthorities,
        });
      });

      // given the admin signs the transaction
      // given the new wrap authority is not the default public key and not in the list
      // it adds the new wrap authority to the list at the provided index
      test("new wrap authority is not the default public key and not in the list - success", async () => {
        // Setup the instruction
        const { globalAccount } = await prepUpdateWrapAuthority(admin);

        // Send the transaction
        await ext.methods
          .updateWrapAuthority(2, nonWrapAuthority.publicKey)
          .accountsPartial({ ...accounts })
          .signers([admin])
          .rpc();

        // Check that the wrap authority was added
        const updatedWrapAuthorities = paddedWrapAuthorities.slice(0);
        updatedWrapAuthorities[2] = nonWrapAuthority.publicKey;

        await expectExtGlobalState(globalAccount, {
          wrapAuthorities: updatedWrapAuthorities,
        });
      });
    });

    describe("claim_fees unit tests", () => {
      // test cases
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
      //   [X] given the m earn global account does not match the one on the global account
      //     [X] it reverts with a InvalidAccount error
      //   [X] given the recipient token account is not a token account for the m mint
      //     [X] it reverts with a ConstraintTokenMint error
      //   [X] given all the accounts are correct
      //     [X] given the m vault has excess collateral
      //       [X] it transfers the excess collateral to the recipient token account
      //     [X] given the m vault does not have excess collateral
      //       [X] it completes but doesn't transfer any tokens

      const initialWrappedAmount = new BN(10_000_000); // 10 with 6 decimals
      const wrapAuthorities = [admin.publicKey, wrapAuthority.publicKey];
      const startIndex = new BN(randomInt(initialIndex.toNumber() + 1, 2e12));

      beforeEach(async () => {
        // Initialize the extension program
        await initializeExt(wrapAuthorities);

        // Wrap some tokens from the admin to make the m vault's balance non-zero
        await wrap(admin, initialWrappedAmount);

        // Propagate the start index
        await propagateIndex(startIndex);

        // Claim yield for the m vault and complete the claim cycle
        const mVault = getMVault();
        const mVaultATA = await getATA(mMint.publicKey, mVault);
        await mClaimFor(mVault, await getTokenBalance(mVaultATA));
        await completeClaims();

        // Reset the blockhash to avoid issues with duplicate transactions
        svm.expireBlockhash();
      });

      // given the admin does not sign the transaction
      // it reverts with a NotAuthorized error
      test("admin does not sign - reverts", async () => {
        // Setup the instruction
        await prepClaimFees(nonAdmin);

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .claimFees()
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          "NotAuthorized"
        );
      });

      // given the m vault is not the m vault PDA
      // it reverts with a ConstraintSeeds error
      test("m vault is not the m vault PDA - reverts", async () => {
        // Setup the instruction
        await prepClaimFees(admin);

        // Change the m vault
        accounts.mVault = PublicKey.unique();

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .claimFees()
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc(),
          "ConstraintSeeds"
        );
      });

      // given the m vault token account is not the m vault PDA's ATA
      // it reverts with a ConstraintAssociated error
      test("m vault token account is not the m vault PDA's ATA - reverts", async () => {
        // Create a token account for the M vault that is not the ATA
        const { tokenAccount: nonAtaAccount } = await createTokenAccount(
          mMint.publicKey,
          getMVault()
        );

        // Setup the instruction
        await prepClaimFees(admin);
        accounts.vaultMTokenAccount = nonAtaAccount;

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .claimFees()
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc(),
          "ConstraintAssociated"
        );
      });

      // given the ext mint does not match the one on the global account
      // it reverts with an InvalidMint error
      test("ext mint does not match global account - reverts", async () => {
        // Create a new mint
        const wrongMint = new Keypair();
        await createMint(wrongMint, nonAdmin.publicKey, true, 6);

        // Setup the instruction
        await prepClaimFees(admin);
        accounts.extMint = wrongMint.publicKey;

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .claimFees()
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc(),
          "InvalidMint"
        );
      });

      // given the ext mint authority is not the ext mint authority PDA
      // it reverts with a ConstraintSeeds error
      test("ext mint authority is not the ext mint authority PDA - reverts", async () => {
        // Setup the instruction
        await prepClaimFees(admin);

        // Change the ext mint authority
        accounts.extMintAuthority = PublicKey.unique();

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .claimFees()
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc(),
          "ConstraintSeeds"
        );
      });

      // given the m earn global account does not match the one on the global account
      // it reverts with a InvalidAccount error
      test("m earn global account does not match global account - reverts", async () => {
        // Setup the instruction
        await prepClaimFees(admin);

        // Change the m earn global account
        accounts.mEarnGlobalAccount = PublicKey.unique();

        // Attempt to send the transaction
        await expectSystemError(
          ext.methods
            .claimFees()
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc()
        );
      });

      // given the recipient token account is not a token account for the ext mint
      // it reverts with a ConstraintTokenMint error
      test("recipient token account is not for ext mint - reverts", async () => {
        // Create a token account for the m mint
        const wrongTokenAccount = await getATA(
          mMint.publicKey,
          admin.publicKey
        );

        // Setup the instruction
        await prepClaimFees(admin, wrongTokenAccount);

        // Attempt to send the transaction
        await expectAnchorError(
          ext.methods
            .claimFees()
            .accountsPartial({ ...accounts })
            .signers([admin])
            .rpc(),
          "ConstraintTokenMint"
        );
      });

      // given all accounts are correct
      // given the m vault has excess collateral
      // it transfers the excess collateral to the recipient token account
      test("excess collateral exists - success", async () => {
        // Cache balances before claim excess
        const mVaultATA = await getATA(mMint.publicKey, getMVault());
        const initialVaultBalance = await getTokenBalance(mVaultATA);
        const recipientATA = await getATA(extMint.publicKey, admin.publicKey);
        const initialRecipientBalance = await getTokenBalance(recipientATA);

        const extSupply = await getMint(
          provider.connection,
          extMint.publicKey,
          undefined,
          TOKEN_2022_PROGRAM_ID
        ).then((mint) => mint.supply);

        const expectedExcess = initialVaultBalance.sub(
          new BN(extSupply.toString())
        );

        // Setup and execute the instruction
        await prepClaimFees(admin);
        await ext.methods
          .claimFees()
          .accountsPartial({ ...accounts })
          .signers([admin])
          .rpc();

        // Verify excess tokens were transferred
        expectTokenBalance(mVaultATA, initialVaultBalance);
        expectTokenBalance(
          recipientATA,
          initialRecipientBalance.add(expectedExcess)
        );
      });

      // given all accounts are correct
      // given the m vault does not have excess collateral
      // it completes successfully and does not transfer any tokens
      test("no excess collateral - success", async () => {
        // claim the existing excess so there isn't extra
        await claimFees();
        svm.expireBlockhash();

        // Cache balances before claim excess
        const mVaultATA = await getATA(mMint.publicKey, getMVault());
        const initialVaultBalance = await getTokenBalance(mVaultATA);
        const recipientATA = await getATA(extMint.publicKey, admin.publicKey);
        const initialRecipientBalance = await getTokenBalance(recipientATA);

        // Setup the instruction
        await prepClaimFees(admin);

        // Attempt to send the transaction
        await ext.methods
          .claimFees()
          .accountsPartial({ ...accounts })
          .signers([admin])
          .rpc();

        // Verify no tokens were transferred
        expectTokenBalance(mVaultATA, initialVaultBalance);
        expectTokenBalance(recipientATA, initialRecipientBalance);
      });
    });
  });

  describe("wrap_authority instruction tests", () => {
    const mintAmount = new BN(100_000_000); // 100 with 6 decimals
    const initialWrappedAmount = new BN(10_000_000); // 10 with 6 decimals

    const wrapAuthorities = [admin.publicKey, wrapAuthority.publicKey];

    const startIndex = new BN(randomInt(initialIndex.toNumber() + 1, 2e12));

    // Setup accounts with M tokens so we can test wrapping and unwrapping
    beforeEach(async () => {
      // Initialize the extension program
      await initializeExt(wrapAuthorities);

      // Mint M tokens to a wrap authority and a non-wrap authority
      await mintM(wrapAuthority.publicKey, mintAmount);
      await mintM(nonWrapAuthority.publicKey, mintAmount);

      // Wrap some tokens from the admin to the make the m vault's balance non-zero
      await wrap(admin, initialWrappedAmount);

      // Propagate the start index
      await propagateIndex(startIndex);

      // Claim yield for the m vault and complete the claim cycle
      // so that the m vault is collateralized to start
      const mVault = getMVault();
      const mVaultATA = await getATA(mMint.publicKey, mVault);
      await mClaimFor(mVault, await getTokenBalance(mVaultATA));
      await completeClaims();

      // Claim excess tokens to make it easier to test collateral checks
      try {
        await claimFees();
      } catch (e) {
        // Ignore the error if there are no excess tokens
      }
    });

    describe("wrap unit tests", () => {
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
        // [X] given the signer is not in the wrap authorities list
        //   [X] it reverts with a ConstraintAuthority error
        // [X] given all the accounts are correct
        //   [X] given the user does not have enough M tokens
        //     [X] it reverts with a ? error
        //   [X] given the user has enough M tokens
        //     [X] given the signer is not the owner of the from M token account, but is delegated
        //       [X] it transfers the amount of M tokens from the user's M token account to the M vault token account
        //     [X] given the signer is the owner of the from M token account
        //       [X] it transfers the amount of M tokens from the user's M token account to the M vault token account
        //     [X] it mints the amount of ext tokens to the user's ext token account
        //     [X] given the user wraps and then unwraps (roundtrip)
        //       [X] the starting balance and ending balance of the user's M token account are the same

        // given the m mint account does not match the one stored in the global account
        // it reverts with an InvalidAccount error
        test("M mint account does not match global account - reverts", async () => {
          // Setup the instruction
          await prepWrap(wrapAuthority);

          // Change the m mint account
          accounts.mMint = extMint.publicKey;

          // Attempt to send the transaction
          // Expect an invalid account error
          await expectAnchorError(
            ext.methods
              .wrap(mintAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc(),
            "InvalidAccount"
          );
        });

        // given the ext mint account does not match the one stored in the global account
        // it reverts with an InvalidAccount error
        test("Ext mint account does not match global account - reverts", async () => {
          // Setup the instruction
          await prepWrap(wrapAuthority);

          // Change the ext mint account
          accounts.extMint = mMint.publicKey;

          // Attempt to send the transaction
          // Expect an invalid account error
          await expectAnchorError(
            ext.methods
              .wrap(mintAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc(),
            "InvalidAccount"
          );
        });

        // given the signer is not the authority on the user M token account and is not delegated
        // it reverts with a ConstraintTokenOwner error
        test("Signer is not the authority on the from M token account and is not delegated - reverts", async () => {
          // Get the ATA for another user
          const wrongATA = await getATA(
            mMint.publicKey,
            nonWrapAuthority.publicKey
          );

          // Setup the instruction with the wrong user M token account
          await prepWrap(wrapAuthority, undefined, wrongATA);

          // Attempt to send the transaction
          // Expect revert with TokenOwner error
          await expectSystemError(
            ext.methods
              .wrap(mintAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc()
          );
        });

        // given the M vault token account is not the M vault PDA's ATA
        // it reverts with a ConstraintAssociated error
        test("M Vault Token account is the the M Vault PDA's ATA (other token account) - reverts", async () => {
          // Create a token account for the M vault that is not the ATA
          const tokenAccountKeypair = Keypair.generate();
          const tokenAccountLen = getAccountLen([ExtensionType.ImmutableOwner]);
          const lamports =
            await provider.connection.getMinimumBalanceForRentExemption(
              tokenAccountLen
            );

          const mVault = getMVault();

          // Create token account with the immutable owner extension
          const transaction = new Transaction().add(
            SystemProgram.createAccount({
              fromPubkey: admin.publicKey,
              newAccountPubkey: tokenAccountKeypair.publicKey,
              space: tokenAccountLen,
              lamports,
              programId: TOKEN_2022_PROGRAM_ID,
            }),
            createInitializeImmutableOwnerInstruction(
              tokenAccountKeypair.publicKey,
              TOKEN_2022_PROGRAM_ID
            ),
            createInitializeAccountInstruction(
              tokenAccountKeypair.publicKey,
              mMint.publicKey,
              mVault,
              TOKEN_2022_PROGRAM_ID
            )
          );

          await provider.send!(transaction, [admin, tokenAccountKeypair]);

          // Setup the instruction with the non-ATA vault m token account
          await prepWrap(
            wrapAuthority,
            undefined,
            undefined,
            undefined,
            tokenAccountKeypair.publicKey
          );

          // Attempt to send the transaction
          // Expect revert with a ConstraintAssociated error
          await expectAnchorError(
            ext.methods
              .wrap(mintAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc(),
            "ConstraintAssociated"
          );
        });

        // given the from m token account is for the wrong mint
        // it reverts with a ConstraintTokenMint error
        test("From M token account is for wrong mint - reverts", async () => {
          // Get the user's ATA for the ext mint and pass it as the user M token account
          const wrongUserATA = await getATA(
            extMint.publicKey,
            wrapAuthority.publicKey
          );

          // Setup the instruction
          await prepWrap(wrapAuthority, undefined, wrongUserATA);

          // Attempt to send the transaction
          // Expect revert with a ConstraintTokenMint error
          await expectAnchorError(
            ext.methods
              .wrap(mintAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc(),
            "ConstraintTokenMint"
          );
        });

        // given the to ext token account is for the wrong mint
        // it reverts with a ConstraintTokenMint error
        test("To Ext token account is for the wrong mint - reverts", async () => {
          // Get the user's ATA for the m mint and pass it as the user ext token account
          const wrongUserATA = await getATA(
            mMint.publicKey,
            wrapAuthority.publicKey
          );

          // Setup the instruction
          await prepWrap(wrapAuthority, undefined, undefined, wrongUserATA);

          // Attempt to send the transaction
          // Expect revert with a ConstraintTokenMint error
          await expectAnchorError(
            ext.methods
              .wrap(mintAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc(),
            "ConstraintTokenMint"
          );
        });

        // given the signer is not in the wrap authorities list
        // it reverts with a NotAuthorized error
        test("Signer is not in the wrap authorities list - reverts", async () => {
          // Setup the instruction
          await prepWrap(nonWrapAuthority);

          // Attempt to send the transaction
          // Expect revert with a NotAuthorized error
          await expectAnchorError(
            ext.methods
              .wrap(mintAmount)
              .accountsPartial({ ...accounts })
              .signers([nonWrapAuthority])
              .rpc(),
            "NotAuthorized"
          );
        });

        // given all accounts are correct
        // give the user does not have enough M tokens
        // it reverts
        test("Not enough M - reverts", async () => {
          // Setup the instruction
          await prepWrap(wrapAuthority);

          const wrapAmount = new BN(
            randomInt(mintAmount.toNumber() + 1, 2 ** 48 - 1)
          );

          // Attempt to send the transaction
          // Expect an error
          await expectSystemError(
            ext.methods
              .wrap(wrapAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc()
          );
        });

        // given all accounts are correct
        // given the from token account has enough M tokens
        // given the signer is not the owner of the from M token account, but is delegated
        // it transfers the amount of M tokens from the user's M token account to the M vault token account
        // it mints the amount of ext tokens to the to ext token account
        test("Wrap with delegated authority - success", async () => {
          const wrapAmount = new BN(randomInt(1, mintAmount.toNumber() + 1));

          // Approve (delegate) the wrap authority to spend the non-wrap authority's M tokens
          const { sourceATA: fromATA } = await approve(
            nonWrapAuthority,
            wrapAuthority.publicKey,
            mMint.publicKey,
            wrapAmount
          );

          // Setup the instruction
          const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } =
            await prepWrap(wrapAuthority, nonWrapAuthority.publicKey, fromATA);

          // Cache initial balances
          const fromMTokenAccountBalance = await getTokenBalance(
            fromMTokenAccount
          );
          const vaultMTokenAccountBalance = await getTokenBalance(
            vaultMTokenAccount
          );
          const toExtTokenAccountBalance = await getTokenBalance(
            toExtTokenAccount
          );

          // Send the instruction
          await ext.methods
            .wrap(wrapAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc();

          // Confirm updated balances
          await expectTokenBalance(
            fromMTokenAccount,
            fromMTokenAccountBalance.sub(wrapAmount)
          );
          await expectTokenBalance(
            vaultMTokenAccount,
            vaultMTokenAccountBalance.add(wrapAmount)
          );
          await expectTokenBalance(
            toExtTokenAccount,
            toExtTokenAccountBalance.add(wrapAmount)
          );
        });

        // given all accounts are correct
        // given the user has enough M tokens
        // it transfers the amount of M tokens from the user's M token account to the M vault token account
        // it mints the amount of wM tokens to the user's wM token account
        test("Wrap to wrap authority account - success", async () => {
          // Setup the instruction
          const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } =
            await prepWrap(wrapAuthority);

          // Cache initial balances
          const fromMTokenAccountBalance = await getTokenBalance(
            fromMTokenAccount
          );
          const vaultMTokenAccountBalance = await getTokenBalance(
            vaultMTokenAccount
          );
          const toExtTokenAccountBalance = await getTokenBalance(
            toExtTokenAccount
          );

          const wrapAmount = new BN(randomInt(1, mintAmount.toNumber() + 1));

          // Send the instruction
          await ext.methods
            .wrap(wrapAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc();

          // Confirm updated balances
          await expectTokenBalance(
            fromMTokenAccount,
            fromMTokenAccountBalance.sub(wrapAmount)
          );
          await expectTokenBalance(
            vaultMTokenAccount,
            vaultMTokenAccountBalance.add(wrapAmount)
          );
          await expectTokenBalance(
            toExtTokenAccount,
            toExtTokenAccountBalance.add(wrapAmount)
          );
        });

        // given all accounts are correct
        // given the user has enough M tokens
        // given the signer does not own the to ext token account
        // it transfers the amount of M tokens from the user's M token account to the M vault token account
        // it mints the amount of wM tokens to the user's wM token account
        test("Wrap to different account - success", async () => {
          // Setup the instruction
          const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } =
            await prepWrap(wrapAuthority, nonWrapAuthority.publicKey);

          // Cache initial balances
          const fromMTokenAccountBalance = await getTokenBalance(
            fromMTokenAccount
          );
          const vaultMTokenAccountBalance = await getTokenBalance(
            vaultMTokenAccount
          );
          const toExtTokenAccountBalance = await getTokenBalance(
            toExtTokenAccount
          );

          const wrapAmount = new BN(randomInt(1, mintAmount.toNumber() + 1));

          // Send the instruction
          await ext.methods
            .wrap(wrapAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc();

          // Confirm updated balances
          await expectTokenBalance(
            fromMTokenAccount,
            fromMTokenAccountBalance.sub(wrapAmount)
          );
          await expectTokenBalance(
            vaultMTokenAccount,
            vaultMTokenAccountBalance.add(wrapAmount)
          );
          await expectTokenBalance(
            toExtTokenAccount,
            toExtTokenAccountBalance.add(wrapAmount)
          );
        });

        // given all accounts are correct
        // given the user has enough M tokens
        // round-trip (wrap / unwrap)
        test("Wrap / unwrap roundtrip - success", async () => {
          // Cache the starting balance of M
          const wrapAuthorityATA = await getATA(
            mMint.publicKey,
            wrapAuthority.publicKey
          );
          const startingBalance = await getTokenBalance(wrapAuthorityATA);

          // Wrap some tokens
          const wrapAmount = new BN(randomInt(1, mintAmount.toNumber() + 1));
          await wrap(wrapAuthority, wrapAmount);

          // Unwrap the same amount
          await unwrap(wrapAuthority, wrapAmount);

          // Confirm the final balance is the same as the starting balance
          expectTokenBalance(wrapAuthorityATA, startingBalance);
        });
      });

      describe("index different from start (sync required)", () => {
        // M Index is strictly increasing
        const newIndex = new BN(randomInt(startIndex.toNumber() + 1, 2e12 + 1));

        // console.log("new index", newIndex.toString());
        // console.log("start index", startIndex.toString());

        beforeEach(async () => {
          // Reset the blockhash to avoid issues with duplicate transactions from multiple claim cycles
          svm.expireBlockhash();

          // Propagate the new index
          await propagateIndex(newIndex);
        });

        // test cases
        // [X] given yield has not been minted to the m vault for the new index
        //   [X] it wraps the amount of M tokens from the user's M token account to the M vault token account
        // [X] given yield has been minted to the m vault for the new index
        //   [X] it wraps the amount of M tokens from the user's M token account to the M vault token account

        // given yield has not been minted to the m vault for the new index
        // it wraps the amount of M tokens from the user's M token account to the M vault token account
        test("Yield not minted for new index - success", async () => {
          // Setup the instruction
          const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } =
            await prepWrap(wrapAuthority);

          // Cache initial balances
          const fromMTokenAccountBalance = await getTokenBalance(
            fromMTokenAccount
          );
          const vaultMTokenAccountBalance = await getTokenBalance(
            vaultMTokenAccount
          );
          const toExtTokenAccountBalance = await getTokenBalance(
            toExtTokenAccount
          );

          const wrapAmount = new BN(
            randomInt(1, fromMTokenAccountBalance.toNumber() + 1)
          );

          // Send the instruction
          await ext.methods
            .wrap(wrapAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc();

          // Confirm updated balances
          await expectTokenBalance(
            fromMTokenAccount,
            fromMTokenAccountBalance.sub(wrapAmount)
          );
          await expectTokenBalance(
            vaultMTokenAccount,
            vaultMTokenAccountBalance.add(wrapAmount)
          );
          await expectTokenBalance(
            toExtTokenAccount,
            toExtTokenAccountBalance.add(wrapAmount)
          );
        });

        // given yield has been minted to the m vault for the new index
        // it wraps the amount of M tokens from the user's M token account to the M vault token account
        test("Wrap with new index - success", async () => {
          // Mint yield to the m vault for the new index
          const mVault = getMVault();
          const mVaultATA = await getATA(mMint.publicKey, mVault);
          await mClaimFor(mVault, await getTokenBalance(mVaultATA));
          await completeClaims();

          // Setup the instruction
          const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } =
            await prepWrap(wrapAuthority);

          // Cache initial balances
          const fromMTokenAccountBalance = await getTokenBalance(
            fromMTokenAccount
          );
          const vaultMTokenAccountBalance = await getTokenBalance(
            vaultMTokenAccount
          );
          const toExtTokenAccountBalance = await getTokenBalance(
            toExtTokenAccount
          );

          const wrapAmount = new BN(
            randomInt(1, fromMTokenAccountBalance.toNumber() + 1)
          );

          // Send the instruction
          await ext.methods
            .wrap(wrapAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc();

          // Confirm updated balances
          await expectTokenBalance(
            fromMTokenAccount,
            fromMTokenAccountBalance.sub(wrapAmount)
          );
          await expectTokenBalance(
            vaultMTokenAccount,
            vaultMTokenAccountBalance.add(wrapAmount)
          );
          await expectTokenBalance(
            toExtTokenAccount,
            toExtTokenAccountBalance.add(wrapAmount)
          );
        });
      });
    });

    describe("unwrap unit tests", () => {
      const wrappedAmount = new BN(25_000_000);
      beforeEach(async () => {
        // Wrap tokens for the users so we can test unwrapping
        await wrap(wrapAuthority, wrappedAmount);
        await wrap(wrapAuthority, wrappedAmount, nonWrapAuthority.publicKey);
      });
      describe("index same as start", () => {
        // test cases
        // [X] given the m mint account does not match the one stored in the global account
        //   [X] it reverts with an InvalidAccount error
        // [X] given the ext mint account does not match the one stored in the global account
        //   [X] it reverts with an InvalidAccount error
        // [X] given the signer is not the authority on the from ext token account and is not delegated by the owner
        //   [X] it reverts with a Token program error
        // [X] given the vault M token account is not the M Vaults ATA for the M token mint
        //   [X] it reverts with a ConstraintAssociated error
        // [X] given the to m token account is for the wrong mint
        //   [X] it reverts with a ConstraintTokenMint error
        // [X] given the from ext token account is for the wrong mint
        //   [X] it reverts with a ConstraintTokenMint error
        // [X] given the signer is not in the wrap authorities list
        //   [X] it reverts with a ConstraintAuthority error
        // [X] given all the accounts are correct
        //   [X] given the user does not have enough ext tokens
        //     [X] it reverts
        //   [X] given the user has enough ext tokens
        //     [X] given the signer is not the owner of the from ext token account, but is delegated
        //       [X] it burns the amount of ext tokens from the from's ext token account
        //     [X] given the signer is the owner of the from ext token account
        //       [X] it burns the amount of ext tokens from the user's ext token account
        //     [X] it transfers the amount of M tokens from the M vault token account to the to's M token account

        // given the m mint account does not match the one stored in the global account
        // it reverts with an InvalidAccount error
        test("M mint account does not match global account - reverts", async () => {
          // Setup the instruction
          await prepUnwrap(wrapAuthority);

          // Change the m mint account
          accounts.mMint = extMint.publicKey;

          // Attempt to send the transaction
          // Expect an invalid account error
          await expectAnchorError(
            ext.methods
              .unwrap(wrappedAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc(),
            "InvalidAccount"
          );
        });

        // given the ext mint account does not match the one stored in the global account
        // it reverts with an InvalidAccount error
        test("Ext mint account does not match global account - reverts", async () => {
          // Setup the instruction
          await prepUnwrap(wrapAuthority);

          // Change the ext mint account
          accounts.extMint = mMint.publicKey;

          // Attempt to send the transaction
          // Expect an invalid account error
          await expectAnchorError(
            ext.methods
              .unwrap(wrappedAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc(),
            "InvalidAccount"
          );
        });

        // given the signer is not the authority on the user ext token account and not delegated
        // it reverts with a ConstraintTokenOwner error
        test("Signer is not the authority on the from Ext token account and not delegated - reverts", async () => {
          // Get the ATA for another user
          const mATA = await getATA(mMint.publicKey, wrapAuthority.publicKey);
          const wrongExtATA = await getATA(
            extMint.publicKey,
            nonWrapAuthority.publicKey
          );

          // Setup the instruction with the wrong user M token account
          await prepUnwrap(wrapAuthority, undefined, mATA, wrongExtATA);

          // Attempt to send the transaction
          // Expect revert with TokenOwner error
          await expectSystemError(
            ext.methods
              .unwrap(wrappedAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc()
          );
        });

        // given the M vault token account is not the M vault PDA's ATA
        // it reverts with a ConstraintAssociated error
        test("M Vault Token account is the the M Vault PDA's ATA (other token account) - reverts", async () => {
          // Create a token account for the M vault that is not the ATA
          const tokenAccountKeypair = Keypair.generate();
          const tokenAccountLen = getAccountLen([ExtensionType.ImmutableOwner]);
          const lamports =
            await provider.connection.getMinimumBalanceForRentExemption(
              tokenAccountLen
            );

          const mVault = getMVault();

          // Create token account with the immutable owner extension
          const transaction = new Transaction().add(
            SystemProgram.createAccount({
              fromPubkey: admin.publicKey,
              newAccountPubkey: tokenAccountKeypair.publicKey,
              space: tokenAccountLen,
              lamports,
              programId: TOKEN_2022_PROGRAM_ID,
            }),
            createInitializeImmutableOwnerInstruction(
              tokenAccountKeypair.publicKey,
              TOKEN_2022_PROGRAM_ID
            ),
            createInitializeAccountInstruction(
              tokenAccountKeypair.publicKey,
              mMint.publicKey,
              mVault,
              TOKEN_2022_PROGRAM_ID
            )
          );

          await provider.send!(transaction, [admin, tokenAccountKeypair]);

          // Setup the instruction with the non-ATA vault m token account
          await prepUnwrap(
            wrapAuthority,
            undefined,
            undefined,
            undefined,
            tokenAccountKeypair.publicKey
          );

          // Attempt to send the transaction
          // Expect revert with a ConstraintAssociated error
          await expectAnchorError(
            ext.methods
              .unwrap(wrappedAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc(),
            "ConstraintAssociated"
          );
        });

        // given the user m token account is for the wrong mint
        // it reverts with a ConstraintTokenMint error
        test("To M token account is for wrong mint - reverts", async () => {
          // Get the user's ATA for the ext mint and pass it as the user M token account
          const wrongUserATA = await getATA(
            extMint.publicKey,
            wrapAuthority.publicKey
          );

          // Setup the instruction
          await prepUnwrap(wrapAuthority, undefined, wrongUserATA);

          // Attempt to send the transaction
          // Expect revert with a ConstraintTokenMint error
          await expectAnchorError(
            ext.methods
              .unwrap(wrappedAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc(),
            "ConstraintTokenMint"
          );
        });

        // given the user ext token account is for the wrong mint
        // it reverts with a ConstraintTokenMint error
        test("From Ext token account is for the wrong mint - reverts", async () => {
          // Get the user's ATA for the m mint and pass it as the user ext token account
          const wrongUserATA = await getATA(
            mMint.publicKey,
            wrapAuthority.publicKey
          );

          // Setup the instruction
          await prepUnwrap(wrapAuthority, undefined, undefined, wrongUserATA);

          // Attempt to send the transaction
          // Expect revert with a ConstraintTokenMint error
          await expectAnchorError(
            ext.methods
              .unwrap(wrappedAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc(),
            "ConstraintTokenMint"
          );
        });

        // given the signer is not in the wrap authorities list
        // it reverts with a NotAuthorized error
        test("Signer is not in the wrap authorities list - reverts", async () => {
          // Setup the instruction
          await prepUnwrap(nonWrapAuthority);

          // Attempt to send the transaction
          // Expect revert with a NotAuthorized error
          await expectAnchorError(
            ext.methods
              .unwrap(wrappedAmount)
              .accountsPartial({ ...accounts })
              .signers([nonWrapAuthority])
              .rpc(),
            "NotAuthorized"
          );
        });

        // given all accounts are correct
        // give the user does not have enough ext tokens
        // it reverts
        test("Not enough ext tokens - reverts", async () => {
          // Setup the instruction
          await prepUnwrap(wrapAuthority);

          const unwrapAmount = new BN(
            randomInt(wrappedAmount.toNumber() + 1, 2 ** 48 - 1)
          );

          // Attempt to send the transaction
          // Expect an error
          await expectSystemError(
            ext.methods
              .unwrap(unwrapAmount)
              .accountsPartial({ ...accounts })
              .signers([wrapAuthority])
              .rpc()
          );
        });

        // given all accounts are correct
        // given the from token account has enough ext tokens
        // given the signer is not the owner of the from ext token account, but is delegated
        // it burns the amount of ext tokens from the from's ext token account
        // it transfers the amount of M tokens from the M vault token account to the to's M token account
        test("Unwrap with delegated authority - success", async () => {
          const unwrapAmount = new BN(
            randomInt(1, wrappedAmount.toNumber() + 1)
          );

          // Approve (delegate) the wrap authority to spend the non-wrap authority's ext tokens
          const { sourceATA: fromExtTokenAccount } = await approve(
            nonWrapAuthority,
            wrapAuthority.publicKey,
            extMint.publicKey,
            unwrapAmount
          );

          // Setup the instruction
          const { vaultMTokenAccount, toMTokenAccount } = await prepUnwrap(
            wrapAuthority,
            nonWrapAuthority.publicKey,
            undefined,
            fromExtTokenAccount
          );

          // Cache initial balances
          const fromExtTokenAccountBalance = await getTokenBalance(
            fromExtTokenAccount
          );
          const vaultMTokenAccountBalance = await getTokenBalance(
            vaultMTokenAccount
          );
          const toMTokenAccountBalance = await getTokenBalance(toMTokenAccount);

          // Send the instruction
          await ext.methods
            .unwrap(unwrapAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc();

          // Confirm updated balances
          await expectTokenBalance(
            fromExtTokenAccount,
            fromExtTokenAccountBalance.sub(unwrapAmount)
          );
          await expectTokenBalance(
            vaultMTokenAccount,
            vaultMTokenAccountBalance.sub(unwrapAmount)
          );
          await expectTokenBalance(
            toMTokenAccount,
            toMTokenAccountBalance.add(unwrapAmount)
          );
        });

        // given all accounts are correct
        // given the user has enough ext tokens
        // it transfers the amount of M tokens from the M vault token account to the user's M token account
        // it burns the amount of ext tokens from the user's ext token account
        test("Unwrap to wrap authority account - success", async () => {
          // Setup the instruction
          const { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount } =
            await prepUnwrap(wrapAuthority);

          // Cache initial balances
          const fromExtTokenAccountBalance = await getTokenBalance(
            fromExtTokenAccount
          );
          const vaultMTokenAccountBalance = await getTokenBalance(
            vaultMTokenAccount
          );
          const toMTokenAccountBalance = await getTokenBalance(toMTokenAccount);

          const unwrapAmount = new BN(
            randomInt(1, wrappedAmount.toNumber() + 1)
          );

          // Send the instruction
          await ext.methods
            .unwrap(unwrapAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc();

          // Confirm updated balances
          await expectTokenBalance(
            toMTokenAccount,
            toMTokenAccountBalance.add(unwrapAmount)
          );
          await expectTokenBalance(
            vaultMTokenAccount,
            vaultMTokenAccountBalance.sub(unwrapAmount)
          );
          await expectTokenBalance(
            fromExtTokenAccount,
            fromExtTokenAccountBalance.sub(unwrapAmount)
          );
        });

        // given all accounts are correct
        // given the user has enough ext tokens
        // it transfers the amount of M tokens from the M vault token account to the user's M token account
        // it burns the amount of ext tokens from the user's ext token account
        test("Unwrap to different account - success", async () => {
          // Setup the instruction
          const { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount } =
            await prepUnwrap(wrapAuthority, nonWrapAuthority.publicKey);

          // Cache initial balances
          const fromExtTokenAccountBalance = await getTokenBalance(
            fromExtTokenAccount
          );
          const vaultMTokenAccountBalance = await getTokenBalance(
            vaultMTokenAccount
          );
          const toMTokenAccountBalance = await getTokenBalance(toMTokenAccount);

          const unwrapAmount = new BN(
            randomInt(1, wrappedAmount.toNumber() + 1)
          );

          // Send the instruction
          await ext.methods
            .unwrap(unwrapAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc();

          // Confirm updated balances
          await expectTokenBalance(
            toMTokenAccount,
            toMTokenAccountBalance.add(unwrapAmount)
          );
          await expectTokenBalance(
            vaultMTokenAccount,
            vaultMTokenAccountBalance.sub(unwrapAmount)
          );
          await expectTokenBalance(
            fromExtTokenAccount,
            fromExtTokenAccountBalance.sub(unwrapAmount)
          );
        });
      });

      describe("index different from start (sync required)", () => {
        const newIndex = new BN(randomInt(startIndex.toNumber() + 1, 2e12 + 1));

        beforeEach(async () => {
          // Reset the blockhash to avoid issues with duplicate transactions from multiple claim cycles
          svm.expireBlockhash();

          // Propagate the new index
          await propagateIndex(newIndex);
        });

        // test cases
        // [X] given yield has not been minted to the m vault for the new index
        //   [X] it unwraps the amount of M tokens from the M vault token account to the user's M token account
        // [X] given yield has been minted to the m vault for the new index
        //   [X] it unwraps the amount of M tokens from the M vault token account to the user's M token account

        // given yield has not been minted to the m vault for the new index
        // it unwraps the amount of M tokens from the M vault token account to the user's M token account
        test("Yield not minted for new index - reverts", async () => {
          // Setup the instruction
          const { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount } =
            await prepUnwrap(wrapAuthority);

          // Cache initial balances
          const vaultMTokenAccountBalance = await getTokenBalance(
            vaultMTokenAccount
          );
          const toMTokenAccountBalance = await getTokenBalance(toMTokenAccount);
          const fromExtTokenAccountBalance = await getTokenBalance(
            fromExtTokenAccount
          );

          const unwrapAmount = new BN(
            randomInt(1, fromExtTokenAccountBalance.toNumber() + 1)
          );

          // Send the instruction
          await ext.methods
            .unwrap(unwrapAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc();

          // Confirm updated balances
          await expectTokenBalance(
            toMTokenAccount,
            toMTokenAccountBalance.add(unwrapAmount)
          );
          await expectTokenBalance(
            vaultMTokenAccount,
            vaultMTokenAccountBalance.sub(unwrapAmount)
          );
          await expectTokenBalance(
            fromExtTokenAccount,
            fromExtTokenAccountBalance.sub(unwrapAmount)
          );
        });

        // given yield has been minted to the m vault for the new index
        // it unwraps the amount of M tokens from the M vault token account to the user's M token account
        test("Unwrap with new index - success", async () => {
          // Mint yield to the m vault for the new index
          const mVault = getMVault();
          const mVaultATA = await getATA(mMint.publicKey, mVault);
          await mClaimFor(mVault, await getTokenBalance(mVaultATA));
          await completeClaims();

          // Setup the instruction
          const { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount } =
            await prepUnwrap(wrapAuthority);

          // Cache initial balances
          const vaultMTokenAccountBalance = await getTokenBalance(
            vaultMTokenAccount
          );
          const toMTokenAccountBalance = await getTokenBalance(toMTokenAccount);
          const fromExtTokenAccountBalance = await getTokenBalance(
            fromExtTokenAccount
          );

          const unwrapAmount = new BN(
            randomInt(1, fromExtTokenAccountBalance.toNumber() + 1)
          );

          // Send the instruction
          await ext.methods
            .unwrap(unwrapAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc();

          // Confirm updated balances
          await expectTokenBalance(
            toMTokenAccount,
            toMTokenAccountBalance.add(unwrapAmount)
          );
          await expectTokenBalance(
            vaultMTokenAccount,
            vaultMTokenAccountBalance.sub(unwrapAmount)
          );
          await expectTokenBalance(
            fromExtTokenAccount,
            fromExtTokenAccountBalance.sub(unwrapAmount)
          );
        });
      });
    });
  });
});

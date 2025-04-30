import { Program, AnchorError, BN } from '@coral-xyz/anchor';
import { LiteSVM } from 'litesvm';
import { fromWorkspace, LiteSVMProvider } from 'anchor-litesvm';
import { PublicKey, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  ACCOUNT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  getAccount,
  getMintLen,
  getMinimumBalanceForRentExemptMultisig,
  getAssociatedTokenAddressSync,
  createInitializeAccountInstruction,
  createInitializeMultisigInstruction,
  createMintToCheckedInstruction,
  getAccountLen,
  createInitializeImmutableOwnerInstruction,
  ExtensionType,
} from '@solana/spl-token';
import { struct, u8, f64 } from '@solana/buffer-layout';
import { publicKey, u64 } from '@solana/buffer-layout-utils';

import { ScaledUiExt } from '../../target/types/scaled_ui_ext';
const SCALED_UI_EXT_IDL = require('../../target/idl/scaled_ui_ext.json');

import { Earn, EARN_IDL, PROGRAM_ID as EARN_PROGRAM_ID, MerkleTree, ProofElement } from '@m0-foundation/solana-m-sdk';

// Unit tests for ext earn program

const ZERO_WORD = new Array(32).fill(0);

// Setup wallets once at the beginning of the test suite
const admin: Keypair = new Keypair();
const portal: Keypair = admin; // make the same since admin is allowed to push indices
const mMint: Keypair = new Keypair();
const extMint: Keypair = new Keypair();
const earnAuthority: Keypair = new Keypair();
const mMintAuthority: Keypair = new Keypair();
const nonAdmin: Keypair = new Keypair();

// Create random addresses for testing
const earnerOne: Keypair = new Keypair();
const earnerTwo: Keypair = new Keypair();

let svm: LiteSVM;
let provider: LiteSVMProvider;
let accounts: Record<string, PublicKey | null> = {};
let earn: Program<Earn>;
let scaledUiExt: Program<ScaledUiExt>;

// Start parameters for M Earn
const initialSupply = new BN(100_000_000); // 100 tokens with 6 decimals
const initialIndex = new BN(1_000_000_000_000); // 1.0
const claimCooldown = new BN(0); // None

// Token Helper functions
const expectTokenBalance = async (tokenAccount: PublicKey, expectedBalance: BN) => {
  const balance = (await getAccount(provider.connection, tokenAccount, undefined, TOKEN_2022_PROGRAM_ID)).amount;

  expect(balance.toString()).toEqual(expectedBalance.toString());
};

const createATA = async (mint: PublicKey, owner: PublicKey) => {
  const tokenAccount = getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const createATA = createAssociatedTokenAccountInstruction(
    admin.publicKey, // payer
    tokenAccount, // ata
    owner, // owner
    mint, // mint
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  let tx = new Transaction().add(createATA);

  await provider.sendAndConfirm!(tx, [admin]);

  return tokenAccount;
};

const getATA = async (mint: PublicKey, owner: PublicKey) => {
  // Check to see if the ATA already exists, if so return its key
  const tokenAccount = getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const tokenAccountInfo = svm.getAccount(tokenAccount);

  if (!tokenAccountInfo) {
    await createATA(mint, owner);
  }

  return tokenAccount;
};

const createTokenAccount = async (mint: PublicKey, owner: PublicKey) => {
  // We want to create a token account that is not the ATA
  const tokenAccount = new Keypair();

  let tx = new Transaction();
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: admin.publicKey,
      newAccountPubkey: tokenAccount.publicKey,
      space: ACCOUNT_SIZE,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE),
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(tokenAccount.publicKey, mint, owner, TOKEN_2022_PROGRAM_ID),
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
    TOKEN_2022_PROGRAM_ID,
  );

  let tx = new Transaction().add(closeIx);

  await provider.sendAndConfirm!(tx, [owner]);
};

const createMint = async (mint: Keypair, mintAuthority: PublicKey, use2022: boolean = true, decimals = 6) => {
  // Create and initialize mint account

  const tokenProgram = use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  const mintLen = getMintLen([]);
  const mintLamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);
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
    tokenProgram,
  );

  console.log('initialize mint instruction', initializeMint);

  let tx = new Transaction();
  tx.add(createMintAccount, initializeMint);

  await provider.sendAndConfirm!(tx, [admin, mint]);

  // Verify the mint was created properly
  const mintInfo = await provider.connection.getAccountInfo(mint.publicKey);
  if (!mintInfo) {
    throw new Error('Mint account was not created');
  }

  return mint.publicKey;
};

// Scaled UI Amount Config Extension Types and Functions since not supported in spl-token library yet
interface InitializeScaledUiAmountConfigData {
  instruction: 43;
  scaledUiAmountInstruction: 0;
  authority: PublicKey | null;
  multiplier: number;
}

const initializeScaledUiAmountConfigInstructionData = struct<InitializeScaledUiAmountConfigData>([
  u8('instruction'),
  u8('scaledUiAmountInstruction'),
  publicKey('authority'),
  f64('multiplier'),
]);

const createInitializeScaledUiAmountConfigInstruction = (
  mint: PublicKey,
  authority: PublicKey | null,
  multiplier: number,
  programId: PublicKey = TOKEN_2022_PROGRAM_ID,
): TransactionInstruction => {
  const keys = [{ pubkey: mint, isSigner: false, isWritable: true }];

  const data = Buffer.alloc(initializeScaledUiAmountConfigInstructionData.span);
  initializeScaledUiAmountConfigInstructionData.encode(
      {
          instruction: 43, // scaled ui amount extension
          scaledUiAmountInstruction: 0, // initialize
          authority: authority ?? PublicKey.default,
          multiplier: multiplier,
      },
      data,
  );

  return new TransactionInstruction({ keys, programId, data });
}

const createScaledUiMint = async (mint: Keypair, mintAuthority: PublicKey, decimals = 6) => {
  // Create and initialize mint account

  const tokenProgram = TOKEN_2022_PROGRAM_ID;

  const mintLen = getMintLen([ExtensionType.ScaledUiAmountConfig]);
  const mintLamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);
  const createMintAccount = SystemProgram.createAccount({
    fromPubkey: admin.publicKey,
    newAccountPubkey: mint.publicKey,
    space: mintLen,
    lamports: mintLamports,
    programId: tokenProgram,
  });

  const initializeScaledUiAmountConfig = createInitializeScaledUiAmountConfigInstruction(
    mint.publicKey,
    mintAuthority,
    1.0,
    tokenProgram,
  );

  const initializeMint = createInitializeMintInstruction(
    mint.publicKey,
    decimals, // decimals
    mintAuthority, // mint authority
    mintAuthority, // freeze authority
    tokenProgram,
  );

  let tx = new Transaction();
  tx.add(createMintAccount, initializeScaledUiAmountConfig, initializeMint);

  await provider.sendAndConfirm!(tx, [admin, mint]);

  // Verify the mint was created properly
  const mintInfo = await provider.connection.getAccountInfo(mint.publicKey);
  if (!mintInfo) {
    throw new Error('Mint account was not created');
  }

  return mint.publicKey;
};

const createMintWithMultisig = async (mint: Keypair, mintAuthority: Keypair) => {
  // Create and initialize multisig mint authority on the token program
  const multisigLen = 355;
  // const multisigLamports = await provider.connection.getMinimumBalanceForRentExemption(multisigLen);
  const multisigLamports = await getMinimumBalanceForRentExemptMultisig(provider.connection);

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
    TOKEN_2022_PROGRAM_ID,
  );

  let tx = new Transaction();
  tx.add(createMultisigAccount, initializeMultisig);

  await provider.sendAndConfirm!(tx, [admin, mintAuthority]);

  // Create and initialize mint account

  const mintLen = getMintLen([]);
  const mintLamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);
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
    TOKEN_2022_PROGRAM_ID,
  );

  tx = new Transaction();
  tx.add(createMintWithMultisigAccount, initializeMint);

  await provider.sendAndConfirm!(tx, [admin, mint]);

  // Verify the mint was created properly
  const mintInfo = await provider.connection.getAccountInfo(mint.publicKey);
  if (!mintInfo) {
    throw new Error('Mint account was not created');
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
    TOKEN_2022_PROGRAM_ID,
  );

  let tx = new Transaction();
  tx.add(mintToInstruction);
  await provider.sendAndConfirm!(tx, [portal]);
};

const getTokenBalance = async (tokenAccount: PublicKey) => {
  const tokenAccountInfo = await getAccount(provider.connection, tokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
  if (!tokenAccountInfo) {
    throw new Error('Account not created');
  }

  return new BN(tokenAccountInfo.amount.toString());
};

// Type definitions for accounts to make it easier to do comparisons

interface EarnGlobal {
  admin?: PublicKey;
  earnAuthority?: PublicKey;
  mint?: PublicKey;
  index?: BN;
  timestamp?: BN;
  claimCooldown?: BN;
  maxSupply?: BN;
  maxYield?: BN;
  distributed?: BN;
  claimComplete?: boolean;
  earnerMerkleRoot?: number[];
}

interface ExtGlobal {
  admin?: PublicKey;
  earnAuthority?: PublicKey;
  extMint?: PublicKey;
  mMint?: PublicKey;
  mEarnGlobalAccount?: PublicKey;
  index?: BN;
  timestamp?: BN;
  bump?: number;
  mVaultBump?: number;
  extMintAuthorityBump?: number;
}

const getEarnGlobalAccount = () => {
  const [globalAccount] = PublicKey.findProgramAddressSync([Buffer.from('global')], earn.programId);

  return globalAccount;
};

const getEarnTokenAuthority = () => {
  const [earnTokenAuthority] = PublicKey.findProgramAddressSync([Buffer.from('token_authority')], earn.programId);

  return earnTokenAuthority;
};

const getExtGlobalAccount = () => {
  const [globalAccount] = PublicKey.findProgramAddressSync([Buffer.from('global')], scaledUiExt.programId);

  return globalAccount;
};

const getExtMintAuthority = () => {
  const [extMintAuthority] = PublicKey.findProgramAddressSync([Buffer.from('mint_authority')], scaledUiExt.programId);

  return extMintAuthority;
};

const getMVault = () => {
  const [mVault] = PublicKey.findProgramAddressSync([Buffer.from('m_vault')], scaledUiExt.programId);

  return mVault;
};

const getMEarnerAccount = (tokenAccount: PublicKey) => {
  const [earnerAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('earner'), tokenAccount.toBuffer()],
    earn.programId,
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

const expectAnchorError = async (txResult: Promise<string>, errCode: string) => {
  try {
    await txResult;
    throw new Error('Transaction should have reverted');
  } catch (e) {
    if (!(e instanceof AnchorError)) throw new Error(`Expected AnchorError, got ${e}`);
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

const expectEarnGlobalState = async (globalAccount: PublicKey, expected: EarnGlobal) => {
  const state = await earn.account.global.fetch(globalAccount);

  if (expected.earnAuthority) expect(state.earnAuthority).toEqual(expected.earnAuthority);
  if (expected.index) expect(state.index.toString()).toEqual(expected.index.toString());
  if (expected.timestamp) expect(state.timestamp.toString()).toEqual(expected.timestamp.toString());
  if (expected.claimCooldown) expect(state.claimCooldown.toString()).toEqual(expected.claimCooldown.toString());
  if (expected.maxSupply) expect(state.maxSupply.toString()).toEqual(expected.maxSupply.toString());
  if (expected.maxYield) expect(state.maxYield.toString()).toEqual(expected.maxYield.toString());
  if (expected.distributed) expect(state.distributed.toString()).toEqual(expected.distributed.toString());
  if (expected.claimComplete !== undefined) expect(state.claimComplete).toEqual(expected.claimComplete);
  if (expected.earnerMerkleRoot) expect(state.earnerMerkleRoot).toEqual(expected.earnerMerkleRoot);
};

const expectExtGlobalState = async (globalAccount: PublicKey, expected: ExtGlobal) => {
  const state = await scaledUiExt.account.extGlobal.fetch(globalAccount);

  if (expected.admin) expect(state.admin).toEqual(expected.admin);
  if (expected.extMint) expect(state.extMint).toEqual(expected.extMint);
  if (expected.mMint) expect(state.mMint).toEqual(expected.mMint);
  if (expected.mEarnGlobalAccount) expect(state.mEarnGlobalAccount).toEqual(expected.mEarnGlobalAccount);
  if (expected.bump) expect(state.bump).toEqual(expected.bump);
  if (expected.mVaultBump) expect(state.mVaultBump).toEqual(expected.mVaultBump);
  if (expected.extMintAuthorityBump) expect(state.extMintAuthorityBump).toEqual(expected.extMintAuthorityBump);
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

const initializeEarn = async (mint: PublicKey, earnAuthority: PublicKey, initialIndex: BN, claimCooldown: BN) => {
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

const propagateIndex = async (newIndex: BN, earnerMerkleRoot: number[] = ZERO_WORD) => {
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

const prepMClaimFor = async (signer: Keypair, mint: PublicKey, earner: PublicKey) => {
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
  const { globalAccount, earnerAccount, earnerATA } = await prepMClaimFor(earnAuthority, mMint.publicKey, earner);

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

describe('ScaledUiExt unit tests', () => {
  let currentTime: () => BN;

  beforeEach(async () => {
    // Initialize the SVM instance with all necessary configurations
    svm = fromWorkspace('')
      .withSplPrograms() // Add SPL programs (including token programs)
      .withBuiltins() // Add builtin programs
      .withSysvars() // Setup standard sysvars
      .withPrecompiles() // Add standard precompiles
      .withBlockhashCheck(true)  // Optional: disable blockhash checking for tests

    // Add the earn program to the SVM instance
    svm.addProgramFromFile(EARN_PROGRAM_ID, 'tests/programs/earn.so');

    // Replace the default token2022 program with the (newer) one from the workspace
    svm.addProgramFromFile(TOKEN_2022_PROGRAM_ID, 'tests/programs/spl_token_2022.so');

    // Create an anchor provider from the liteSVM instance
    provider = new LiteSVMProvider(svm);

    // Create program instances
    earn = new Program<Earn>(EARN_IDL, provider);
    scaledUiExt = new Program<ScaledUiExt>(SCALED_UI_EXT_IDL, provider);

    // Fund the wallets
    svm.airdrop(admin.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    svm.airdrop(earnAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    svm.airdrop(nonAdmin.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    currentTime = () => {
      return new BN(svm.getClock().unixTimestamp.toString());
    };

    // Create the M token mint
    await createMintWithMultisig(mMint, mMintAuthority);

    // Create the Ext token mint
    await createScaledUiMint(extMint, getExtMintAuthority());

    // Mint some m tokens to have a non-zero supply
    await mintM(admin.publicKey, initialSupply);

    // Initialize the earn program
    await initializeEarn(mMint.publicKey, earnAuthority.publicKey, initialIndex, claimCooldown);

    // Add the m vault as an M earner
    const mVault = getMVault();
    const earnerMerkleTree = new MerkleTree([admin.publicKey, mVault]);

    // Propagate the merkle root
    await propagateIndex(initialIndex, earnerMerkleTree.getRoot());

    // Add the earner account for the vault
    const { proof } = earnerMerkleTree.getInclusionProof(mVault);
    await addRegistrarEarner(mVault, proof);
  });

  describe('admin instruction tests', () => {
    describe('initialize unit tests', () => {
     test('placeholder', async () => { 
        
     });
    });
  });


});
  
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
  getAccountLen,
  getMint,
  getMintLen,
  getMinimumBalanceForRentExemptMultisig,
  getAssociatedTokenAddressSync,
  createInitializeAccountInstruction,
  createInitializeMultisigInstruction,
  createMintToCheckedInstruction,
  ExtensionType,
  getExtensionData,
  createInitializeImmutableOwnerInstruction
} from '@solana/spl-token';
import { struct, u8, f64 } from '@solana/buffer-layout';
import { publicKey, u64 } from '@solana/buffer-layout-utils';
import { randomInt } from 'crypto';

import { ScaledUiExt } from '../../target/types/scaled_ui_ext';
const SCALED_UI_EXT_IDL = require('../../target/idl/scaled_ui_ext.json');

import { Earn, EARN_IDL, PROGRAM_ID as EARN_PROGRAM_ID, MerkleTree, ProofElement } from '@m0-foundation/solana-m-sdk';
import { token } from '@coral-xyz/anchor/dist/cjs/utils';

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

const expectTokenUiBalance = async (tokenAccount: PublicKey, expectedBalance: BN) => {
  const rawBalance = (await getAccount(provider.connection, tokenAccount, undefined, TOKEN_2022_PROGRAM_ID)).amount;

  const multiplier = (await getScaledUiAmountConfig(extMint.publicKey)).multiplier;

  const scale = 1e12;

  const uiBalance = (rawBalance * BigInt(Math.floor(multiplier * scale))) / BigInt(scale);

  expect(uiBalance.toString()).toEqual(expectedBalance.toString());
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

interface ScaledUiAmountConfig {
  authority: PublicKey;
  multiplier: number;
  newMultiplierEffectiveTimestamp: bigint;
  newMultiplier: number;
}

const ScaledUiAmountConfigLayout = struct<ScaledUiAmountConfig>([
  publicKey('authority'),
  f64('multiplier'),
  u64('newMultiplierEffectiveTimestamp'),
  f64('newMultiplier'),
]);

const getScaledUiAmountConfig = async (mint: PublicKey): Promise<ScaledUiAmountConfig> => {
  const mintAccount = await getMint(provider.connection, mint, undefined, TOKEN_2022_PROGRAM_ID);
  const extensionData = getExtensionData(ExtensionType.ScaledUiAmountConfig, mintAccount.tlvData);
  if (extensionData === null) {
    throw new Error('Extension data not found');
  }

  return ScaledUiAmountConfigLayout.decode(extensionData);
}

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
  extMint?: PublicKey;
  mMint?: PublicKey;
  mEarnGlobalAccount?: PublicKey;
  bump?: number;
  mVaultBump?: number;
  extMintAuthorityBump?: number;
  wrapAuthorities?: PublicKey[];
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

const expectScaledUiAmountConfig = async (mint: PublicKey, expected: ScaledUiAmountConfig) => {
  const state = await getScaledUiAmountConfig(mint);

  if (expected.authority) expect(state.authority).toEqual(expected.authority);
  if (expected.multiplier) expect(state.multiplier).toEqual(expected.multiplier);
  if (expected.newMultiplierEffectiveTimestamp) expect(state.newMultiplierEffectiveTimestamp.toString()).toEqual(expected.newMultiplierEffectiveTimestamp.toString());
  if (expected.newMultiplier) expect(state.newMultiplier).toEqual(expected.newMultiplier);
};

const createUniqueKeyArray = (size: number) => {
  return new Array(size)
    .fill(PublicKey.default)
    .map((_, i, arr) => {
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
    throw new Error('Array is too long');
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

// Helper functions for preparing and executing ScaledUiExt instructions

const prepExtInitialize = (signer: Keypair) => {
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
  accounts.systemProgram = SystemProgram.programId;
  accounts.token2022 = TOKEN_2022_PROGRAM_ID;

  return { globalAccount };
};

const initializeExt = async (wrapAuthorities: PublicKey[]) => {
  // Setup the instruction
  const { globalAccount } = prepExtInitialize(admin);

  // Send the transaction
  await scaledUiExt.methods
    .initialize(wrapAuthorities)
    .accountsPartial({ ...accounts })
    .signers([admin])
    .rpc();

  return globalAccount;
};

const prepWrap = async (
  from: Keypair,
  to?: PublicKey,
  fromMTokenAccount?: PublicKey,
  toExtTokenAccount?: PublicKey,
  vaultMTokenAccount?: PublicKey,
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
  accounts.fromMTokenAccount = fromMTokenAccount ?? (await getATA(mMint.publicKey, from.publicKey));
  accounts.toExtTokenAccount = toExtTokenAccount ?? (await getATA(extMint.publicKey, to ?? from.publicKey));
  accounts.vaultMTokenAccount = vaultMTokenAccount ?? (await getATA(mMint.publicKey, mVault));
  accounts.token2022 = TOKEN_2022_PROGRAM_ID;

  return {
    vaultMTokenAccount: accounts.vaultMTokenAccount,
    fromMTokenAccount: accounts.fromMTokenAccount,
    toExtTokenAccount: accounts.toExtTokenAccount,
  };
};

const wrap = async (from: Keypair, amount: BN, to?: PublicKey) => {
  // Setup the instruction
  const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } = await prepWrap(from, to);

  // Send the instruction
  await scaledUiExt.methods
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
  vaultMTokenAccount?: PublicKey,
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
  accounts.toMTokenAccount = toMTokenAccount ?? (await getATA(mMint.publicKey, to ?? from.publicKey));
  accounts.fromExtTokenAccount = fromExtTokenAccount ?? (await getATA(extMint.publicKey, from.publicKey));
  accounts.vaultMTokenAccount = vaultMTokenAccount ?? (await getATA(mMint.publicKey, mVault));
  accounts.token2022 = TOKEN_2022_PROGRAM_ID;

  return {
    vaultMTokenAccount: accounts.vaultMTokenAccount,
    toMTokenAccount: accounts.toMTokenAccount,
    fromExtTokenAccount: accounts.fromExtTokenAccount,
  };
};

const unwrap = async (from: Keypair, amount: BN, to?: PublicKey) => {
  // Setup the instruction
  const { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount } = await prepUnwrap(from, to);

  // Send the instruction
  await scaledUiExt.methods
    .unwrap(amount)
    .accountsPartial({ ...accounts })
    .signers([from])
    .rpc();

  return { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount };
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
    svm.airdrop(wrapAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    svm.airdrop(nonWrapAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

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
      // test cases
      // [X] given the m_mint is not owned by the token2022 program
      //   [X] it reverts with a ConstraintAddress error
      // [X] given the ext_mint is not owned by the token2022 program
      //   [X] it reverts with a ConstraintMintTokenProgram error
      // [X] given the ext_mint does not have the scaled ui amount extension
      //   [X] it reverts with a InvalidMint error
      // [X] given the ext_mint has the scaled ui amount extension, but the authority is not the mint authority PDA
      //   [X] it reverts with an InvalidMint error
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
      //   [ ] the global account is created
      //   [ ] the admin is set to the signer
      //   [ ] the m_mint is set correctly
      //   [ ] the ext_mint is set correctly
      //   [ ] the m_earn_global_account is set correctly
      //   [ ] the bumps are set correctly
      //   [ ] the wrap authorities are set correctly
      //   [ ] the multiplier on the ext mint is initialized to m index
      //   [ ] the timestamp on the ext mint is set to the m timestamp

      // given the m_mint is not owned by the token2022 program
      // it reverts with a ConstraintAddress error
      test('m_mint not owned by token2022 - reverts', async () => {
        // Create a mint owned by a different program
        const wrongMint = new Keypair();
        await createMint(wrongMint, nonAdmin.publicKey, false);

        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the M mint
        accounts.mMint = wrongMint.publicKey;

        // Attempt to send the transaction
        await expectAnchorError(
          scaledUiExt.methods
            .initialize([])
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          'ConstraintAddress',
        );
      });

      // given the ext_mint is not owned by the token2022 program
      // it reverts with a ConstraintMintTokenProgram error
      test('ext_mint not owned by token2022 - reverts', async () => {
        // Create a mint owned by a different program
        const wrongMint = new Keypair();
        await createMint(wrongMint, nonAdmin.publicKey, false);

        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the Ext Mint
        accounts.extMint = wrongMint.publicKey;

        // Attempt to send the transaction
        await expectAnchorError(
          scaledUiExt.methods
            .initialize([])
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          'ConstraintMintTokenProgram',
        );
      });

      // given the ext_mint does not have the scaled ui amount extension
      // it reverts with a InvalidMint error
      test('ext_mint does not have the scaled ui amount extension - reverts', async () => {
        // Create a mint without the scaled ui amount extension
        const wrongMint = new Keypair();
        await createMint(wrongMint, getExtMintAuthority(), true, 6); // valid otherwise

        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the Ext Mint
        accounts.extMint = wrongMint.publicKey;

        // Attempt to send the transaction
        await expectAnchorError(
          scaledUiExt.methods
            .initialize([])
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          'InvalidMint',
        );
      });

      // given the ext_mint has the scaled ui amount extension, but the authority is not the mint authority PDA
      // it reverts with an InvalidMint error
      test('ext_mint has the scaled ui amount extension, but the authority is not the mint authority PDA - reverts', async () => {
        // Create a mint with the scaled ui amount extension
        const wrongMint = new Keypair();
        await createScaledUiMint(wrongMint, nonAdmin.publicKey, 6);

        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the Ext Mint
        accounts.extMint = wrongMint.publicKey;

        // Attempt to send the transaction
        await expectAnchorError(
          scaledUiExt.methods
            .initialize([])
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          'InvalidMint',
        );
      });

      // given the decimals on ext_mint do not match M
      // it reverts with a MintDecimals error
      test('ext_mint incorrect decimals - reverts', async () => {
        // Create a mint owned by a different program
        const badMint = new Keypair();
        await createMint(badMint, nonAdmin.publicKey, true, 9);

        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the Ext Mint
        accounts.extMint = badMint.publicKey;

        // Attempt to send the transaction
        await expectAnchorError(
          scaledUiExt.methods
            .initialize([])
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          'ConstraintMintDecimals',
        );
      });

      // given the M earn global account is invalid
      // it reverts with a seeds constraint
      test('m_earn_global_account is incorrect - reverts', async () => {
        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the m earn global account
        accounts.mEarnGlobalAccount = PublicKey.unique();
        if (accounts.mEarnGlobalAccount == getEarnGlobalAccount()) return;

        // Attempt to send transaction
        // Expect error (could be one of several "SeedsConstraint", "AccountOwnedByWrongProgram", "AccountNotInitialized")
        await expectSystemError(
          scaledUiExt.methods
            .initialize([])
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
        );
      });

      // given ext_mint_authority is not required PDA
      // it reverts with a seeds constraint
      test('ext_mint_authority is incorrect - reverts', async () => {
        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the ext mint authority
        accounts.extMintAuthority = PublicKey.unique();
        if (accounts.extMintAuthority == getExtMintAuthority()) return;

        // Attempt to send transaction
        // Expect error (could be one of several "SeedsConstraint", "AccountOwnedByWrongProgram", "AccountNotInitialized")
        await expectSystemError(
          scaledUiExt.methods
            .initialize([])
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
        );
      });

      // given more than 10 wrap authorities are provided
      // it reverts with an InvalidParam error
      test('more than 10 wrap authorities provided - reverts', async () => {
        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the wrap authorities
        const wrapAuthorities: PublicKey[] = createUniqueKeyArray(11);

        // Attempt to send transaction
        await expectAnchorError(
          scaledUiExt.methods
            .initialize(wrapAuthorities)
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          'InvalidParam',
        );
      });

      // given wrap authorities includes the system program id (default public key)
      // it reverts with an InvalidParam error
      test('wrap authorities includes the system program id - reverts', async () => {
        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the wrap authorities
        const wrapAuthorities: PublicKey[] = createUniqueKeyArray(10);
        wrapAuthorities[0] = SystemProgram.programId;

        // Attempt to send transaction
        await expectAnchorError(
          scaledUiExt.methods
            .initialize(wrapAuthorities)
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          'InvalidParam',
        );
      });

      // given wrap authorities includes a duplicate, non-default public key
      // it reverts with an InvalidParam error
      test('wrap authorities includes a duplicate, non-default public key - reverts', async () => {
        // Setup the instruction call
        prepExtInitialize(nonAdmin);

        // Change the wrap authorities
        const wrapAuthorities: PublicKey[] = createUniqueKeyArray(10);
        wrapAuthorities[0] = wrapAuthorities[1];

        // Attempt to send transaction
        await expectAnchorError(
          scaledUiExt.methods
            .initialize(wrapAuthorities)
            .accountsPartial({ ...accounts })
            .signers([nonAdmin])
            .rpc(),
          'InvalidParam',
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
      test('initialize - success', async () => {
        // Setup the instruction call
        prepExtInitialize(admin);

        // Get a random number of wrap authorities
        // We use the padded array to check the stored state after the call
        const numWrapAuthorities = randomInt(10);
        const wrapAuthorities: PublicKey[] = createUniqueKeyArray(numWrapAuthorities);
        const paddedWrapAuthorities = padKeyArray(wrapAuthorities, 10);

        // Ensure the global account has not been created yet
        const globalAccount = getExtGlobalAccount();
        expectAccountEmpty(globalAccount);

        // Send the transaction
        await scaledUiExt.methods
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
          bump: 0,
          mVaultBump: 0,
          extMintAuthorityBump: 0,
          wrapAuthorities: paddedWrapAuthorities,
        });

        // Check the state of the mint
        const multiplier = initialIndex.toNumber() / 1e12;
        await expectScaledUiAmountConfig(extMint.publicKey, {
          authority: getExtMintAuthority(),
          multiplier,
          newMultiplierEffectiveTimestamp: BigInt(currentTime().toString()),
          newMultiplier: multiplier,
        });
      });
    });
  });

  describe('wrap_authority instruction tests', () => {
    const mintAmount = new BN(100_000_000); // 100 with 6 decimals

    const wrapAuthorities = [wrapAuthority.publicKey];

    // Setup accounts with M tokens so we can test wrapping and unwrapping
    beforeEach(async () => {
      // Initialize the extension program
      await initializeExt(wrapAuthorities);

      // Mint M tokens to the extension earner and a non-earner
      await mintM(wrapAuthority.publicKey, mintAmount);

      // Propagate a random index to test the conversion to/from principal values
      const newIndex = new BN(randomInt(1e12, 2e12));
      await propagateIndex(newIndex);
    });

    describe('wrap unit tests', () => {
      // test cases
      // [X] given the m mint account does not match the one stored in the global account
      //   [X] it reverts with an InvalidAccount error
      // [X] given the ext mint account does not match the one stored in the global account
      //   [X] it reverts with an InvalidAccount error
      // [X] given the signer is not the authority on the from m token account
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
      //     [X] it transfers the amount of M tokens from the user's M token account to the M vault token account
      //     [X] it mints the amount of ext tokens to the user's ext token account

      // given the m mint account does not match the one stored in the global account
      // it reverts with an InvalidAccount error
      test('M mint account does not match global account - reverts', async () => {
        // Setup the instruction
        await prepWrap(wrapAuthority);

        // Change the m mint account
        accounts.mMint = extMint.publicKey;

        // Attempt to send the transaction
        // Expect an invalid account error
        await expectAnchorError(
          scaledUiExt.methods
            .wrap(mintAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
          'InvalidAccount',
        );
      });

      // given the ext mint account does not match the one stored in the global account
      // it reverts with an InvalidAccount error
      test('Ext mint account does not match global account - reverts', async () => {
        // Setup the instruction
        await prepWrap(wrapAuthority);

        // Change the ext mint account
        accounts.extMint = mMint.publicKey;

        // Attempt to send the transaction
        // Expect an invalid account error
        await expectAnchorError(
          scaledUiExt.methods
            .wrap(mintAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
          'InvalidAccount',
        );
      });

      // given the signer is not the authority on the user M token account
      // it reverts with a ConstraintTokenOwner error
      // TODO should we allow from ATAs where the token account owner is not the signer as long as the wrap authority also signs the transaction?
      test('Signer is not the authority on the from M token account - reverts', async () => {
        // Get the ATA for another user
        const wrongATA = await getATA(mMint.publicKey, nonWrapAuthority.publicKey);

        // Setup the instruction with the wrong user M token account
        await prepWrap(wrapAuthority, undefined, wrongATA);

        // Attempt to send the transaction
        // Expect revert with TokenOwner error
        await expectAnchorError(
          scaledUiExt.methods
            .wrap(mintAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
          'ConstraintTokenOwner',
        );
      });

            // given the M vault token account is not the M vault PDA's ATA
      // it reverts with a ConstraintAssociated error
      test("M Vault Token account is the the M Vault PDA's ATA (other token account) - reverts", async () => {
        // Create a token account for the M vault that is not the ATA
        const tokenAccountKeypair = Keypair.generate();
        const tokenAccountLen = getAccountLen([ExtensionType.ImmutableOwner]);
        const lamports = await provider.connection.getMinimumBalanceForRentExemption(tokenAccountLen);

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
          createInitializeImmutableOwnerInstruction(tokenAccountKeypair.publicKey, TOKEN_2022_PROGRAM_ID),
          createInitializeAccountInstruction(
            tokenAccountKeypair.publicKey,
            mMint.publicKey,
            mVault,
            TOKEN_2022_PROGRAM_ID,
          ),
        );

        await provider.send!(transaction, [admin, tokenAccountKeypair]);

        // Setup the instruction with the non-ATA vault m token account
        await prepWrap(wrapAuthority, undefined, undefined, undefined, tokenAccountKeypair.publicKey);

        // Attempt to send the transaction
        // Expect revert with a ConstraintAssociated error
        await expectAnchorError(
          scaledUiExt.methods
            .wrap(mintAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
          'ConstraintAssociated',
        );
      });

      // given the from m token account is for the wrong mint
      // it reverts with a ConstraintTokenMint error
      test('From M token account is for wrong mint - reverts', async () => {
        // Get the user's ATA for the ext mint and pass it as the user M token account
        const wrongUserATA = await getATA(extMint.publicKey, wrapAuthority.publicKey);

        // Setup the instruction
        await prepWrap(wrapAuthority, undefined, wrongUserATA);

        // Attempt to send the transaction
        // Expect revert with a ConstraintTokenMint error
        await expectAnchorError(
          scaledUiExt.methods
            .wrap(mintAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
          'ConstraintTokenMint',
        );
      });

      // given the to ext token account is for the wrong mint
      // it reverts with a ConstraintTokenMint error
      test('To Ext token account is for the wrong mint - reverts', async () => {
        // Get the user's ATA for the m mint and pass it as the user ext token account
        const wrongUserATA = await getATA(mMint.publicKey, wrapAuthority.publicKey);

        // Setup the instruction
        await prepWrap(wrapAuthority, undefined, undefined, wrongUserATA);

        // Attempt to send the transaction
        // Expect revert with a ConstraintTokenMint error
        await expectAnchorError(
          scaledUiExt.methods
            .wrap(mintAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
          'ConstraintTokenMint',
        );
      });

      // given the signer is not in the wrap authorities list
      // it reverts with a NotAuthorized error
      test('Signer is not in the wrap authorities list - reverts', async () => {
        // Setup the instruction
        await prepWrap(nonWrapAuthority);
        
        // Attempt to send the transaction
        // Expect revert with a NotAuthorized error
        await expectAnchorError(
          scaledUiExt.methods
            .wrap(mintAmount)
            .accountsPartial({ ...accounts })
            .signers([nonWrapAuthority])
            .rpc(),
          'NotAuthorized',
        );

      });

      // given all accounts are correct
      // give the user does not have enough M tokens
      // it reverts
      test('Not enough M - reverts', async () => {
        // Setup the instruction
        await prepWrap(wrapAuthority);

        const wrapAmount = new BN(randomInt(mintAmount.toNumber() + 1, 2 ** 48 - 1));

        // Attempt to send the transaction
        // Expect an error
        await expectSystemError(
          scaledUiExt.methods
            .wrap(wrapAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
        );
      });

      // given all accounts are correct
      // given the user has enough M tokens
      // it transfers the amount of M tokens from the user's M token account to the M vault token account
      // it mints the amount of wM tokens to the user's wM token account
      test('Wrap to wrap authority account - success', async () => {
        // Setup the instruction
        const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } = await prepWrap(wrapAuthority);

        // Confirm initial balances
        await expectTokenBalance(fromMTokenAccount, mintAmount);
        await expectTokenBalance(vaultMTokenAccount, new BN(0));
        await expectTokenUiBalance(toExtTokenAccount, new BN(0));

        const wrapAmount = new BN(randomInt(1, mintAmount.toNumber()));

        // Send the instruction
        await scaledUiExt.methods
          .wrap(wrapAmount)
          .accountsPartial({ ...accounts })
          .signers([wrapAuthority])
          .rpc();

        // Confirm updated balances
        await expectTokenBalance(fromMTokenAccount, mintAmount.sub(wrapAmount));
        await expectTokenBalance(vaultMTokenAccount, wrapAmount);
        await expectTokenUiBalance(toExtTokenAccount, wrapAmount);
      });

      // given all accounts are correct
      // given the user has enough M tokens
      // given the signer does not own the to ext token account
      // it transfers the amount of M tokens from the user's M token account to the M vault token account
      // it mints the amount of wM tokens to the user's wM token account
      test('Wrap to different account - success', async () => {
        // Setup the instruction
        const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } = await prepWrap(wrapAuthority, nonWrapAuthority.publicKey);

        // Confirm initial balances
        await expectTokenBalance(fromMTokenAccount, mintAmount);
        await expectTokenBalance(vaultMTokenAccount, new BN(0));
        await expectTokenUiBalance(toExtTokenAccount, new BN(0));

        const wrapAmount = new BN(randomInt(1, mintAmount.toNumber()));

        // Send the instruction
        await scaledUiExt.methods
          .wrap(wrapAmount)
          .accountsPartial({ ...accounts })
          .signers([wrapAuthority])
          .rpc();

        // Confirm updated balances
        await expectTokenBalance(fromMTokenAccount, mintAmount.sub(wrapAmount));
        await expectTokenBalance(vaultMTokenAccount, wrapAmount);
        await expectTokenUiBalance(toExtTokenAccount, wrapAmount);
      });
    });

    describe('unwrap unit tests', () => {
      const wrappedAmount = new BN(25_000_000);
      beforeEach(async () => {
        // Wrap tokens for the users so we can test unwrapping
        await wrap(wrapAuthority, wrappedAmount);
        await wrap(wrapAuthority, wrappedAmount, nonWrapAuthority.publicKey);
      });

      // test cases
      // [X] given the m mint account does not match the one stored in the global account
      //   [X] it reverts with an InvalidAccount error
      // [X] given the ext mint account does not match the one stored in the global account
      //   [X] it reverts with an InvalidAccount error
      // [X] given the signer is not the authority on the from ext token account
      //   [X] it reverts with a ConstraintTokenOwner error
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
      //     [X] it transfers the amount of M tokens from the M vault token account to the user's M token account
      //     [X] it burns the amount of ext tokens from the user's ext token account

      // given the m mint account does not match the one stored in the global account
      // it reverts with an InvalidAccount error
      test('M mint account does not match global account - reverts', async () => {
        // Setup the instruction
        await prepUnwrap(wrapAuthority);

        // Change the m mint account
        accounts.mMint = extMint.publicKey;

        // Attempt to send the transaction
        // Expect an invalid account error
        await expectAnchorError(
          scaledUiExt.methods
            .unwrap(wrappedAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
          'InvalidAccount',
        );
      });

      // given the ext mint account does not match the one stored in the global account
      // it reverts with an InvalidAccount error
      test('Ext mint account does not match global account - reverts', async () => {
        // Setup the instruction
        await prepUnwrap(wrapAuthority);

        // Change the ext mint account
        accounts.extMint = mMint.publicKey;

        // Attempt to send the transaction
        // Expect an invalid account error
        await expectAnchorError(
          scaledUiExt.methods
            .unwrap(wrappedAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
          'InvalidAccount',
        );
      });

      // given the signer is not the authority on the user ext token account
      // it reverts with a ConstraintTokenOwner error
      test('Signer is not the authority on the from Ext token account - reverts', async () => {
        // Get the ATA for another user
        const mATA = await getATA(mMint.publicKey, wrapAuthority.publicKey);
        const wrongExtATA = await getATA(extMint.publicKey, nonWrapAuthority.publicKey);

        // Setup the instruction with the wrong user M token account
        await prepUnwrap(wrapAuthority, undefined, mATA, wrongExtATA);

        // Attempt to send the transaction
        // Expect revert with TokenOwner error
        await expectAnchorError(
          scaledUiExt.methods
            .unwrap(wrappedAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
          'ConstraintTokenOwner',
        );
      });

      // given the M vault token account is not the M vault PDA's ATA
      // it reverts with a ConstraintAssociated error
      test("M Vault Token account is the the M Vault PDA's ATA (other token account) - reverts", async () => {
        // Create a token account for the M vault that is not the ATA
        const tokenAccountKeypair = Keypair.generate();
        const tokenAccountLen = getAccountLen([ExtensionType.ImmutableOwner]);
        const lamports = await provider.connection.getMinimumBalanceForRentExemption(tokenAccountLen);

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
          createInitializeImmutableOwnerInstruction(tokenAccountKeypair.publicKey, TOKEN_2022_PROGRAM_ID),
          createInitializeAccountInstruction(
            tokenAccountKeypair.publicKey,
            mMint.publicKey,
            mVault,
            TOKEN_2022_PROGRAM_ID,
          ),
        );

        await provider.send!(transaction, [admin, tokenAccountKeypair]);

        // Setup the instruction with the non-ATA vault m token account
        await prepUnwrap(wrapAuthority, undefined, undefined, undefined, tokenAccountKeypair.publicKey);

        // Attempt to send the transaction
        // Expect revert with a ConstraintAssociated error
        await expectAnchorError(
          scaledUiExt.methods
            .unwrap(wrappedAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
          'ConstraintAssociated',
        );
      });

      // given the user m token account is for the wrong mint
      // it reverts with a ConstraintTokenMint error
      test('To M token account is for wrong mint - reverts', async () => {
        // Get the user's ATA for the ext mint and pass it as the user M token account
        const wrongUserATA = await getATA(extMint.publicKey, wrapAuthority.publicKey);

        // Setup the instruction
        await prepUnwrap(wrapAuthority, undefined, wrongUserATA);

        // Attempt to send the transaction
        // Expect revert with a ConstraintTokenMint error
        await expectAnchorError(
          scaledUiExt.methods
            .unwrap(wrappedAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
          'ConstraintTokenMint',
        );
      });

      // given the user ext token account is for the wrong mint
      // it reverts with a ConstraintTokenMint error
      test('From Ext token account is for the wrong mint - reverts', async () => {
        // Get the user's ATA for the m mint and pass it as the user ext token account
        const wrongUserATA = await getATA(mMint.publicKey, wrapAuthority.publicKey);

        // Setup the instruction
        await prepUnwrap(wrapAuthority, undefined, undefined, wrongUserATA);

        // Attempt to send the transaction
        // Expect revert with a ConstraintTokenMint error
        await expectAnchorError(
          scaledUiExt.methods
            .unwrap(wrappedAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
          'ConstraintTokenMint',
        );
      });
      
      // given the signer is not in the wrap authorities list
      // it reverts with a NotAuthorized error
      test('Signer is not in the wrap authorities list - reverts', async () => {
        // Setup the instruction
        await prepUnwrap(nonWrapAuthority);

        // Attempt to send the transaction
        // Expect revert with a NotAuthorized error
        await expectAnchorError(
          scaledUiExt.methods
            .unwrap(wrappedAmount)
            .accountsPartial({ ...accounts })
            .signers([nonWrapAuthority])
            .rpc(),
          'NotAuthorized',
        );
      });

      // given all accounts are correct
      // give the user does not have enough ext tokens
      // it reverts
      test('Not enough ext tokens - reverts', async () => {
        // Setup the instruction
        await prepUnwrap(wrapAuthority);

        const unwrapAmount = new BN(randomInt(wrappedAmount.toNumber() + 1, 2 ** 48 - 1));

        // Attempt to send the transaction
        // Expect an error
        await expectSystemError(
          scaledUiExt.methods
            .unwrap(unwrapAmount)
            .accountsPartial({ ...accounts })
            .signers([wrapAuthority])
            .rpc(),
        );
      });

      // given all accounts are correct
      // given the user has enough ext tokens
      // it transfers the amount of M tokens from the M vault token account to the user's M token account
      // it burns the amount of ext tokens from the user's ext token account
      test('Unwrap to wrap authority account - success', async () => {
        // Setup the instruction
        const { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount } = await prepUnwrap(wrapAuthority);

        // Confirm initial balances
        await expectTokenBalance(toMTokenAccount, mintAmount.sub(wrappedAmount.mul(new BN(2))));
        await expectTokenBalance(vaultMTokenAccount, wrappedAmount.add(wrappedAmount));
        await expectTokenUiBalance(fromExtTokenAccount, wrappedAmount);

        const unwrapAmount = new BN(randomInt(1, wrappedAmount.toNumber()));

        // Send the instruction
        await scaledUiExt.methods
          .unwrap(unwrapAmount)
          .accountsPartial({ ...accounts })
          .signers([wrapAuthority])
          .rpc();

        // Confirm updated balances
        await expectTokenBalance(toMTokenAccount, mintAmount.sub(wrappedAmount.mul(new BN(2))).add(unwrapAmount));
        await expectTokenBalance(vaultMTokenAccount, wrappedAmount.add(wrappedAmount).sub(unwrapAmount));
        await expectTokenUiBalance(fromExtTokenAccount, wrappedAmount.sub(unwrapAmount));
      });

      // given all accounts are correct
      // given the user has enough ext tokens
      // it transfers the amount of M tokens from the M vault token account to the user's M token account
      // it burns the amount of ext tokens from the user's ext token account
      test('Unwrap to different account - success', async () => {
        // Setup the instruction
        const { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount } = await prepUnwrap(wrapAuthority, nonWrapAuthority.publicKey);

        // Confirm initial balances
        await expectTokenBalance(toMTokenAccount, new BN(0));
        await expectTokenBalance(vaultMTokenAccount, wrappedAmount.add(wrappedAmount));
        await expectTokenUiBalance(fromExtTokenAccount, wrappedAmount);

        const unwrapAmount = new BN(randomInt(1, wrappedAmount.toNumber()));

        // Send the instruction
        await scaledUiExt.methods
          .unwrap(unwrapAmount)
          .accountsPartial({ ...accounts })
          .signers([wrapAuthority])
          .rpc();

        // Confirm updated balances
        await expectTokenBalance(toMTokenAccount, unwrapAmount);
        await expectTokenBalance(vaultMTokenAccount, wrappedAmount.add(wrappedAmount).sub(unwrapAmount));
        await expectTokenUiBalance(fromExtTokenAccount, wrappedAmount.sub(unwrapAmount));
      });
    });
  });
});
  
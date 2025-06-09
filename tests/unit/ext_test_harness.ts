import { Program, AnchorError, BN } from "@coral-xyz/anchor";
import { LiteSVM } from "litesvm";
import { LiteSVMProvider } from "anchor-litesvm";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  TransactionInstruction,
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
  getMint,
  getMintLen,
  getMinimumBalanceForRentExemptMultisig,
  getAssociatedTokenAddressSync,
  createInitializeAccountInstruction,
  createInitializeMultisigInstruction,
  createMintToCheckedInstruction,
  ExtensionType,
  getExtensionData,
  createApproveCheckedInstruction,
  createInitializeInterestBearingMintInstruction,
  InterestBearingMintConfigState,
  InterestBearingMintConfigStateLayout,
} from "@solana/spl-token";
import {
  Earn,
  EARN_IDL,
  PROGRAM_ID as EARN_PROGRAM_ID,
  MerkleTree,
  ProofElement,
} from "@m0-foundation/solana-m-sdk";
import { ZERO_WORD } from "../test-utils";

const SECONDS_PER_YEAR: number = 6 * 6 * 24 * 36524;
const ONE_IN_BASIS_POINTS: number = 10000;

import { MExt as IBTExt } from "../../target/types/ibt";
import { MExt as NoYieldExt } from "../../target/types/no_yield";

export enum Comparison {
  Equal,
  GreaterThan,
  GreaterThanOrEqual,
  LessThan,
  LessThanOrEqual,
}

// Type definitions for accounts to make it easier to do comparisons

export enum Variant {
  InterestBearingToken = "ibt",
  NoYield = "no_yield",
}

type MExt = IBTExt | NoYieldExt;

export type ExtGlobal = {
  admin?: PublicKey;
  extMint?: PublicKey;
  mMint?: PublicKey;
  mEarnGlobalAccount?: PublicKey;
  bump?: number;
  mVaultBump?: number;
  extMintAuthorityBump?: number;
  wrapAuthorities?: PublicKey[];
};

const PROGRAM_ID = new PublicKey(
  "3C865D264L4NkAm78zfnDzQJJvXuU3fMjRUvRxyPi5da"
);

// Test harness for the MExt program that encapsulates all the necessary setup and helper functions to test a given program variant
export class ExtensionTest<V extends Variant = Variant.InterestBearingToken> {
  public variant: V;
  public svm: LiteSVM;
  public provider: LiteSVMProvider;
  public accounts: Record<string, PublicKey | null> = {};
  public earn: Program<Earn>;
  public ext: Program<MExt>;
  public admin: Keypair;
  public mMint: Keypair;
  public extMint: Keypair;
  public mMintAuthority: Keypair;
  public earnAuthority: Keypair;
  public wrapAuthority: Keypair;
  public nonAdmin: Keypair;
  public nonWrapAuthority: Keypair;

  // internal M index calculations (reference)
  public lastIndex: BN = new BN(1e12); // 1.0 index
  public lastIndexTimestamp: BN = new BN(0); // last index update timestamp
  public rate: number = 0;

  constructor(variant: V, addresses: PublicKey[]) {
    this.variant = variant;
    const M_EXT_IDL = require(`../../target/idl/${variant}.json`);

    // Initialize the SVM instance with all necessary configurations
    this.svm = new LiteSVM()
      .withSplPrograms() // Add SPL programs (including token programs)
      .withBuiltins() // Add builtin programs
      .withSysvars() // Setup standard sysvars
      .withPrecompiles() // Add standard precompiles
      .withBlockhashCheck(true); // Optional: disable blockhash checking for tests

    // Add the earn program to the SVM instance
    this.svm.addProgramFromFile(EARN_PROGRAM_ID, "tests/programs/earn.so");

    // Replace the default token2022 program with the (newer) one from the workspace
    this.svm.addProgramFromFile(
      TOKEN_2022_PROGRAM_ID,
      "tests/programs/spl_token_2022.so"
    );

    // Add the ext program to the SVM instance
    this.svm.addProgramFromFile(PROGRAM_ID, `target/deploy/${variant}.so`);

    // Create an anchor provider from the liteSVM instance
    this.provider = new LiteSVMProvider(this.svm);

    // Create program instances
    this.earn = new Program<Earn>(EARN_IDL, this.provider);
    this.ext = new Program<MExt>(M_EXT_IDL, this.provider);

    // Generate keypairs for various roles and fund them
    this.admin = new Keypair();
    this.mMint = new Keypair();
    this.extMint = new Keypair();
    this.mMintAuthority = new Keypair();
    this.earnAuthority = new Keypair();
    this.wrapAuthority = new Keypair();
    this.nonAdmin = new Keypair();
    this.nonWrapAuthority = new Keypair();

    addresses = addresses.concat([
      this.admin.publicKey,
      this.earnAuthority.publicKey,
      this.wrapAuthority.publicKey,
      this.nonAdmin.publicKey,
      this.nonWrapAuthority.publicKey,
    ]);

    for (const address of addresses) {
      this.svm.airdrop(address, BigInt(10 * LAMPORTS_PER_SOL));
    }
  }

  public async init(
    initialSupply: BN,
    initialIndex: BN,
    claimCooldown: BN,
    mRateBps: number,
    extRateBps?: number
  ) {
    // Set values for internal M index calculations
    this.rate = mRateBps;
    this.lastIndexTimestamp = this.currentTime();
    this.lastIndex = initialIndex;

    // Create the M token mint
    await this.createMintWithMultisig(this.mMint, this.mMintAuthority);

    // Create the Ext token mint
    switch (this.variant) {
      case Variant.InterestBearingToken:
        if (!extRateBps) {
          throw new Error("extRateBps is required for IBT variant");
        }

        await this.createIbtMint(
          this.extMint,
          this.getExtMintAuthority(),
          extRateBps
        );
        break;
      case Variant.NoYield:
        await this.createMint(this.extMint, this.getExtMintAuthority());
        break;
      default:
        throw new Error("Unsupported variant for MExt");
    }

    // Mint some m tokens to have a non-zero supply
    await this.mintM(this.admin.publicKey, initialSupply);

    // Initialize the earn program
    await this.initializeEarn(
      this.mMint.publicKey,
      this.earnAuthority.publicKey,
      initialIndex,
      claimCooldown
    );

    // Add the m vault as an M earner
    const mVault = this.getMVault();
    const earnerMerkleTree = new MerkleTree([this.admin.publicKey, mVault]);

    // Create the m vault ATA for the m token
    await this.createATA(this.mMint.publicKey, mVault);

    // Propagate the merkle root
    await this.propagateIndex(initialIndex, earnerMerkleTree.getRoot());

    // Add the earner account for the vault
    const { proof } = earnerMerkleTree.getInclusionProof(mVault);
    await this.addRegistrarEarner(mVault, proof);
  }

  // Helper functions for token operations and checks on the SVM instance
  public async expectTokenBalance(
    tokenAccount: PublicKey,
    expectedBalance: BN
  ) {
    const balance = (
      await getAccount(
        this.provider.connection,
        tokenAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      )
    ).amount;

    expect(balance.toString()).toEqual(expectedBalance.toString());
  }

  public async expectTokenUiBalance(
    tokenAccount: PublicKey,
    expectedBalance: BN,
    op: Comparison = Comparison.Equal,
    tolerance?: BN
  ) {
    const rawBalance = (
      await getAccount(
        this.provider.connection,
        tokenAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      )
    ).amount;

    const multiplier = await this.getCurrentMultiplier();

    const scale = 1e12;

    const uiBalance =
      (rawBalance * BigInt(Math.floor(multiplier * scale))) / BigInt(scale);

    switch (op) {
      case Comparison.GreaterThan:
        expect(uiBalance).toBeGreaterThan(BigInt(expectedBalance.toString()));
        if (tolerance) {
          expect(uiBalance).toBeLessThanOrEqual(
            BigInt(expectedBalance.add(tolerance).toString())
          );
        }
        break;
      case Comparison.GreaterThanOrEqual:
        expect(uiBalance).toBeGreaterThanOrEqual(
          BigInt(expectedBalance.toString())
        );
        if (tolerance) {
          expect(uiBalance).toBeLessThanOrEqual(
            BigInt(expectedBalance.add(tolerance).toString())
          );
        }
        break;
      case Comparison.LessThan:
        expect(uiBalance).toBeLessThan(BigInt(expectedBalance.toString()));
        if (tolerance) {
          expect(uiBalance).toBeGreaterThanOrEqual(
            BigInt(expectedBalance.sub(tolerance).toString())
          );
        }
        break;
      case Comparison.LessThanOrEqual:
        expect(uiBalance).toBeLessThanOrEqual(
          BigInt(expectedBalance.toString())
        );
        if (tolerance) {
          expect(uiBalance).toBeGreaterThanOrEqual(
            BigInt(expectedBalance.sub(tolerance).toString())
          );
        }
        break;
      default:
        if (tolerance) {
          expect(uiBalance).toBeGreaterThanOrEqual(
            BigInt(expectedBalance.sub(tolerance).toString())
          );
          expect(uiBalance).toBeLessThanOrEqual(
            BigInt(expectedBalance.add(tolerance).toString())
          );
        } else {
          expect(uiBalance).toEqual(BigInt(expectedBalance.toString()));
        }
        break;
    }
  }

  public async createATA(
    mint: PublicKey,
    owner: PublicKey,
    use2022: boolean = true
  ) {
    const tokenAccount = getAssociatedTokenAddressSync(
      mint,
      owner,
      true,
      use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const createATA = createAssociatedTokenAccountInstruction(
      this.admin.publicKey, // payer
      tokenAccount, // ata
      owner, // owner
      mint, // mint
      use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    let tx = new Transaction().add(createATA);

    await this.provider.sendAndConfirm!(tx, [this.admin]);

    return tokenAccount;
  }

  public async getATA(
    mint: PublicKey,
    owner: PublicKey,
    use2022: boolean = true
  ) {
    // Check to see if the ATA already exists, if so return its key
    const tokenAccount = getAssociatedTokenAddressSync(
      mint,
      owner,
      true,
      use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const tokenAccountInfo = this.svm.getAccount(tokenAccount);

    if (!tokenAccountInfo) {
      await this.createATA(mint, owner, use2022);
    }

    return tokenAccount;
  }

  public async createTokenAccount(
    mint: PublicKey,
    owner: PublicKey,
    use2022: boolean = true
  ) {
    // We want to create a token account that is not the ATA
    const tokenAccount = new Keypair();

    let tx = new Transaction();
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: this.admin.publicKey,
        newAccountPubkey: tokenAccount.publicKey,
        space: ACCOUNT_SIZE,
        lamports:
          await this.provider.connection.getMinimumBalanceForRentExemption(
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

    await this.provider.sendAndConfirm!(tx, [this.admin, tokenAccount]);

    return { tokenAccount: tokenAccount.publicKey };
  }

  public async closeTokenAccount(owner: Keypair, tokenAccount: PublicKey) {
    const closeIx = createCloseAccountInstruction(
      tokenAccount,
      owner.publicKey,
      owner.publicKey,
      [],
      TOKEN_2022_PROGRAM_ID
    );

    let tx = new Transaction().add(closeIx);

    await this.provider.sendAndConfirm!(tx, [owner]);
  }

  public async createMint(
    mint: Keypair,
    mintAuthority: PublicKey,
    use2022: boolean = true,
    decimals = 6,
    freezeAuthority: boolean = true
  ) {
    // Create and initialize mint account

    const tokenProgram = use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

    const mintLen = getMintLen([]);
    const mintLamports =
      await this.provider.connection.getMinimumBalanceForRentExemption(mintLen);
    const createMintAccount = SystemProgram.createAccount({
      fromPubkey: this.admin.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports: mintLamports,
      programId: tokenProgram,
    });

    const initializeMint = createInitializeMintInstruction(
      mint.publicKey,
      decimals, // decimals
      mintAuthority, // mint authority
      freezeAuthority ? mintAuthority : null, // freeze authority
      tokenProgram
    );

    let tx = new Transaction();
    tx.add(createMintAccount, initializeMint);

    await this.provider.sendAndConfirm!(tx, [this.admin, mint]);

    // Verify the mint was created properly
    const mintInfo = await this.provider.connection.getAccountInfo(
      mint.publicKey
    );
    if (!mintInfo) {
      throw new Error("Mint account was not created");
    }

    return mint.publicKey;
  }

  public async getInterestBearingConfig(
    mint: PublicKey
  ): Promise<InterestBearingMintConfigState> {
    const mintAccount = await getMint(
      this.provider.connection,
      mint,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const extensionData = getExtensionData(
      ExtensionType.InterestBearingConfig,
      mintAccount.tlvData
    );
    if (extensionData === null) {
      throw new Error("Extension data not found");
    }

    return InterestBearingMintConfigStateLayout.decode(extensionData);
  }

  public async createMintWithMultisig(mint: Keypair, mintAuthority: Keypair) {
    // Create and initialize multisig mint authority on the token program
    const multisigLen = 355;
    // const multisigLamports = await provider.connection.getMinimumBalanceForRentExemption(multisigLen);
    const multisigLamports = await getMinimumBalanceForRentExemptMultisig(
      this.provider.connection
    );

    const createMultisigAccount = SystemProgram.createAccount({
      fromPubkey: this.admin.publicKey,
      newAccountPubkey: mintAuthority.publicKey,
      space: multisigLen,
      lamports: multisigLamports,
      programId: TOKEN_2022_PROGRAM_ID,
    });

    const earnTokenAuthority = this.getEarnTokenAuthority();

    const initializeMultisig = createInitializeMultisigInstruction(
      mintAuthority.publicKey, // account
      [this.admin, earnTokenAuthority],
      1,
      TOKEN_2022_PROGRAM_ID
    );

    let tx = new Transaction();
    tx.add(createMultisigAccount, initializeMultisig);

    await this.provider.sendAndConfirm!(tx, [this.admin, mintAuthority]);

    // Create and initialize mint account

    const mintLen = getMintLen([]);
    const mintLamports =
      await this.provider.connection.getMinimumBalanceForRentExemption(mintLen);
    const createMintWithMultisigAccount = SystemProgram.createAccount({
      fromPubkey: this.admin.publicKey,
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

    await this.provider.sendAndConfirm!(tx, [this.admin, mint]);

    // Verify the mint was created properly
    const mintInfo = await this.provider.connection.getAccountInfo(
      mint.publicKey
    );
    if (!mintInfo) {
      throw new Error("Mint account was not created");
    }

    return mint.publicKey;
  }

  public async createIbtMint(
    mint: Keypair,
    mintAuthority: PublicKey,
    interestRateBps: number,
    decimals = 6
  ) {
    // Create and initialize mint account

    const tokenProgram = TOKEN_2022_PROGRAM_ID;

    const mintLen = getMintLen([ExtensionType.InterestBearingConfig]);
    const mintLamports =
      await this.provider.connection.getMinimumBalanceForRentExemption(mintLen);
    const createMintAccount = SystemProgram.createAccount({
      fromPubkey: this.admin.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports: mintLamports,
      programId: tokenProgram,
    });

    const initializeInterestBearingMint =
      createInitializeInterestBearingMintInstruction(
        mint.publicKey,
        mintAuthority,
        interestRateBps,
        tokenProgram
      );

    const initializeMint = createInitializeMintInstruction(
      mint.publicKey,
      decimals, // decimals
      mintAuthority, // mint authority
      mintAuthority, // freeze authority
      tokenProgram
    );

    let tx = new Transaction();
    tx.add(createMintAccount, initializeInterestBearingMint, initializeMint);

    await this.provider.sendAndConfirm!(tx, [this.admin, mint]);

    // Verify the mint was created properly
    const mintInfo = await this.provider.connection.getAccountInfo(
      mint.publicKey
    );
    if (!mintInfo) {
      throw new Error("Mint account was not created");
    }

    return mint.publicKey;
  }

  public async mintM(to: PublicKey, amount: BN) {
    const toATA: PublicKey = await this.getATA(this.mMint.publicKey, to);

    const mintToInstruction = createMintToCheckedInstruction(
      this.mMint.publicKey,
      toATA,
      this.mMintAuthority.publicKey,
      BigInt(amount.toString()),
      6,
      [this.admin],
      TOKEN_2022_PROGRAM_ID
    );

    let tx = new Transaction();
    tx.add(mintToInstruction);
    await this.provider.sendAndConfirm!(tx, [this.admin]);
  }

  public async getTokenBalance(tokenAccount: PublicKey) {
    const tokenAccountInfo = await getAccount(
      this.provider.connection,
      tokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    if (!tokenAccountInfo) {
      throw new Error("Account not created");
    }

    return new BN(tokenAccountInfo.amount.toString());
  }

  public async getTokenUiBalance(tokenAccount: PublicKey, multiplier?: number) {
    const tokenAccountInfo = await getAccount(
      this.provider.connection,
      tokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    if (!tokenAccountInfo) {
      throw new Error("Account not created");
    }

    const mp = multiplier ?? (await this.getCurrentMultiplier());

    const scale = 1e12;

    const uiBalance =
      (tokenAccountInfo.amount * BigInt(Math.floor(mp * scale))) /
      BigInt(scale);

    return new BN(uiBalance.toString());
  }

  public async approve(
    source: Keypair,
    delegate: PublicKey,
    mint: PublicKey,
    amount: BN
  ) {
    const sourceATA: PublicKey = await this.getATA(mint, source.publicKey);

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
    await this.provider.sendAndConfirm!(tx, [source]);

    return { sourceATA };
  }

  // general SVM cheat functions
  public warp(seconds: BN, increment: boolean) {
    const clock = this.svm.getClock();
    clock.unixTimestamp = increment
      ? clock.unixTimestamp + BigInt(seconds.toString())
      : BigInt(seconds.toString());
    this.svm.setClock(clock);
  }

  public currentTime(): BN {
    return new BN(this.svm.getClock().unixTimestamp.toString());
  }

  // Helper functions for Earn and MExt program PDAs
  public getEarnGlobalAccount(): PublicKey {
    const [globalAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("global")],
      this.earn.programId
    );

    return globalAccount;
  }

  public getEarnTokenAuthority(): PublicKey {
    const [earnTokenAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_authority")],
      this.earn.programId
    );

    return earnTokenAuthority;
  }

  public getExtGlobalAccount(): PublicKey {
    const [globalAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("global")],
      this.ext.programId
    );

    return globalAccount;
  }

  public getExtMintAuthority(): PublicKey {
    const [extMintAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_authority")],
      this.ext.programId
    );

    return extMintAuthority;
  }

  public getMVault(): PublicKey {
    const [mVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("m_vault")],
      this.ext.programId
    );

    return mVault;
  }

  public getMEarnerAccount(tokenAccount: PublicKey): PublicKey {
    const [earnerAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("earner"), tokenAccount.toBuffer()],
      this.earn.programId
    );

    return earnerAccount;
  }

  private calculateIbtMultiplier(
    config: InterestBearingMintConfigState,
    atTime: number
  ): number {
    if (atTime < Number(config.lastUpdateTimestamp)) {
      throw new Error(
        "Cannot calculate multiplier for time before last update"
      );
    }

    let pre_update_timespan =
      Number(config.lastUpdateTimestamp) -
      Number(config.initializationTimestamp);
    let post_update_timespan = atTime - Number(config.lastUpdateTimestamp);

    let pre_update_accrual = config.preUpdateAverageRate * pre_update_timespan;
    let post_update_accrual = config.currentRate * post_update_timespan;

    return Math.exp(
      (pre_update_accrual + post_update_accrual) /
        SECONDS_PER_YEAR /
        ONE_IN_BASIS_POINTS
    );
  }

  public async getMultiplierAt(atTime: BN): Promise<number> {
    if (this.variant === Variant.NoYield) {
      return 1.0;
    }

    const interestBearingConfig = await this.getInterestBearingConfig(
      this.extMint.publicKey
    );

    return this.calculateIbtMultiplier(
      interestBearingConfig,
      Number(atTime.toString())
    );
  }

  // returns the ratio of ext tokens to m tokens
  public async getCurrentMultiplier(): Promise<number> {
    if (this.variant === Variant.NoYield) {
      return 1.0;
    }

    const interestBearingConfig = await this.getInterestBearingConfig(
      this.extMint.publicKey
    );

    return this.calculateIbtMultiplier(
      interestBearingConfig,
      Number(this.currentTime().toString())
    );
  }

  // returns the calculated M index based on the previously cached index, timestamp, and the last set rate on the test harness
  // the point of this is to mimic the behavior of the EVM implementation of the index calculation
  // from continously compounding yield (without some of the extra features related to safety against the minter rate)
  public getCurrentIndex(): BN {
    let increaseFactor = Math.exp(
      (this.rate *
        (this.currentTime().toNumber() - this.lastIndexTimestamp.toNumber())) /
        SECONDS_PER_YEAR /
        ONE_IN_BASIS_POINTS
    );
    return new BN(Math.floor(this.lastIndex.toNumber() * increaseFactor));
  }

  public getIndexAt(timestamp: BN): BN {
    if (timestamp.lt(this.lastIndexTimestamp)) {
      throw new Error("Cannot get index for a timestamp before last update");
    }

    let increaseFactor = Math.exp(
      (this.rate *
        (timestamp.toNumber() - this.lastIndexTimestamp.toNumber())) /
        SECONDS_PER_YEAR /
        ONE_IN_BASIS_POINTS
    );

    return new BN(Math.floor(this.lastIndex.toNumber() * increaseFactor));
  }

  // Utility functions for the tests
  public expectAccountEmpty(account: PublicKey) {
    const accountInfo = this.svm.getAccount(account);

    if (accountInfo) {
      expect(accountInfo.lamports).toBe(0);
      expect(accountInfo.data.length).toBe(0);
      expect(accountInfo.owner).toStrictEqual(SystemProgram.programId);
    }
  }

  public async expectAnchorError(txResult: Promise<string>, errCode: string) {
    try {
      await txResult;
      throw new Error("Transaction should have reverted");
    } catch (e) {
      if (!(e instanceof AnchorError))
        throw new Error(`Expected AnchorError, got ${e}`);
      const err: AnchorError = e;
      expect(err.error.errorCode.code).toStrictEqual(errCode);
    }
  }

  public async expectSystemError(txResult: Promise<string>) {
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
  }

  public async expectExtGlobalState(expected: ExtGlobal) {
    const state = await this.ext.account.extGlobal.fetch(
      this.getExtGlobalAccount()
    );

    if (expected.admin) expect(state.admin).toEqual(expected.admin);
    if (expected.extMint) expect(state.extMint).toEqual(expected.extMint);
    if (expected.mMint) expect(state.mMint).toEqual(expected.mMint);
    if (expected.mEarnGlobalAccount)
      expect(state.mEarnGlobalAccount).toEqual(expected.mEarnGlobalAccount);

    if (expected.bump) expect(state.bump).toEqual(expected.bump);
    if (expected.mVaultBump)
      expect(state.mVaultBump).toEqual(expected.mVaultBump);
    if (expected.extMintAuthorityBump)
      expect(state.extMintAuthorityBump).toEqual(expected.extMintAuthorityBump);
  }

  public async expectInterestBearingConfig(
    mint: PublicKey,
    expected: InterestBearingMintConfigState
  ) {
    const state = await this.getInterestBearingConfig(mint);

    if (expected.initializationTimestamp)
      expect(state.initializationTimestamp.toString()).toEqual(
        expected.initializationTimestamp.toString()
      );
    if (expected.lastUpdateTimestamp)
      expect(state.lastUpdateTimestamp.toString()).toEqual(
        expected.lastUpdateTimestamp.toString()
      );
    if (expected.currentRate)
      expect(state.currentRate.toString()).toEqual(
        expected.currentRate.toString()
      );
    if (expected.preUpdateAverageRate)
      expect(state.preUpdateAverageRate.toString()).toEqual(
        expected.preUpdateAverageRate.toString()
      );
  }

  createUniqueKeyArray = (size: number) => {
    return new Array(size).fill(PublicKey.default).map((_, i, arr) => {
      let key = PublicKey.unique();
      while (key.equals(PublicKey.default) || arr.includes(key)) {
        key = PublicKey.unique();
      }
      return key;
    });
  };

  padKeyArray = (array: PublicKey[], desiredLen: number) => {
    const currentLen = array.length;

    if (currentLen > desiredLen) {
      throw new Error("Array is too long");
    }

    const padding = new Array(desiredLen - currentLen).fill(PublicKey.default);
    return array.concat(padding);
  };

  // instruction convenience functions for earn program

  public async initializeEarn(
    mint: PublicKey,
    earnAuthority: PublicKey,
    initialIndex: BN,
    claimCooldown: BN
  ) {
    // Send the transaction
    try {
      await this.earn.methods
        .initialize(earnAuthority, initialIndex, claimCooldown)
        .accounts({
          admin: this.admin.publicKey,
          mint,
        })
        .signers([this.admin])
        .rpc();
    } catch (e) {
      console.log(e);
      throw e;
    }
  }

  public async propagateIndex(
    newIndex: BN,
    earnerMerkleRoot: number[] = ZERO_WORD
  ) {
    // Send the instruction
    await this.earn.methods
      .propagateIndex(newIndex, earnerMerkleRoot)
      .accounts({
        signer: this.admin.publicKey,
      })
      .signers([this.admin])
      .rpc();

    // Update our local values to ensure the values remain the same
    this.lastIndex = newIndex;
    this.lastIndexTimestamp = this.currentTime();
  }

  public async mClaimFor(earner: PublicKey, balance?: BN) {
    const earnerATA = await this.getATA(this.mMint.publicKey, earner);
    const earnerAccount = this.getMEarnerAccount(earnerATA);
    const snapshotBalance = balance ?? (await this.getTokenBalance(earnerATA));

    // Send the instruction
    await this.earn.methods
      .claimFor(snapshotBalance)
      .accounts({
        earnAuthority: this.earnAuthority.publicKey,
        mint: this.mMint.publicKey,
        mintMultisig: this.mMintAuthority.publicKey,
        userTokenAccount: earnerATA,
        earnerAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([this.earnAuthority])
      .rpc();
  }

  public async mCompleteClaims() {
    // Send the instruction
    await this.earn.methods
      .completeClaims()
      .accounts({
        earnAuthority: this.earnAuthority.publicKey,
      })
      .signers([this.earnAuthority])
      .rpc();
  }

  public async addRegistrarEarner(earner: PublicKey, proof: ProofElement[]) {
    // Get the earner ATA
    const earnerATA = await this.getATA(this.mMint.publicKey, earner);

    // Send the instruction
    await this.earn.methods
      .addRegistrarEarner(earner, proof)
      .accountsPartial({
        signer: this.nonAdmin.publicKey,
        userTokenAccount: earnerATA,
      })
      .signers([this.nonAdmin])
      .rpc();
  }

  // Helper functions for executing MExt instructions

  public async initializeExt(
    wrapAuthorities: PublicKey[],
    initial_rate?: number
  ) {
    switch (this.variant) {
      case Variant.InterestBearingToken:
        if (!initial_rate) {
          throw new Error("initial_rate is required for IBT variant");
        }
        // Send the transaction
        await this.ext.methods
          .initialize(wrapAuthorities, initial_rate)
          .accounts({
            admin: this.admin.publicKey,
            mMint: this.mMint.publicKey,
            extMint: this.extMint.publicKey,
          })
          .signers([this.admin])
          .rpc();
        break;
      case Variant.NoYield:
        // Send the transaction
        await this.ext.methods
          .initialize(wrapAuthorities)
          .accounts({
            admin: this.admin.publicKey,
            mMint: this.mMint.publicKey,
            extMint: this.extMint.publicKey,
          })
          .signers([this.admin])
          .rpc();
        break;
      default:
        throw new Error("Unsupported variant for initializeExt");
    }
  }

  public async setMMint(mint: PublicKey) {
    // Send the instruction
    await this.ext.methods
      .setMMint()
      .accounts({
        newMMint: mint,
      })
      .signers([this.admin])
      .rpc();
  }

  public async updateWrapAuthority(index: number, newWrapAuthority: PublicKey) {
    // Send the instruction
    await this.ext.methods
      .updateWrapAuthority(index, newWrapAuthority)
      .accounts({})
      .signers([this.admin])
      .rpc();
  }

  public async prepWrap(
    from: Keypair,
    to?: PublicKey,
    fromMTokenAccount?: PublicKey,
    toExtTokenAccount?: PublicKey,
    vaultMTokenAccount?: PublicKey
  ): Promise<{
    vaultMTokenAccount: PublicKey;
    fromMTokenAccount: PublicKey;
    toExtTokenAccount: PublicKey;
  }> {
    // Get m vault pda
    const mVault = this.getMVault();

    // Create accounts if needed
    fromMTokenAccount =
      fromMTokenAccount ??
      (await this.getATA(this.mMint.publicKey, from.publicKey));
    toExtTokenAccount =
      toExtTokenAccount ??
      (await this.getATA(this.extMint.publicKey, to ?? from.publicKey));
    vaultMTokenAccount =
      vaultMTokenAccount ?? (await this.getATA(this.mMint.publicKey, mVault));

    return {
      vaultMTokenAccount,
      fromMTokenAccount,
      toExtTokenAccount,
    };
  }

  public async wrap(
    from: Keypair,
    amount: BN,
    to?: PublicKey
  ): Promise<{
    vaultMTokenAccount: PublicKey;
    fromMTokenAccount: PublicKey;
    toExtTokenAccount: PublicKey;
  }> {
    // Setup the instruction
    const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } =
      await this.prepWrap(from, to);

    // Send the instruction
    await this.ext.methods
      .wrap(amount)
      .accounts({
        signer: from.publicKey,
        fromMTokenAccount,
        toExtTokenAccount,
      })
      .signers([from])
      .rpc();

    return { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount };
  }

  public async prepUnwrap(
    from: Keypair,
    to?: PublicKey,
    toMTokenAccount?: PublicKey,
    fromExtTokenAccount?: PublicKey,
    vaultMTokenAccount?: PublicKey
  ): Promise<{
    vaultMTokenAccount: PublicKey;
    toMTokenAccount: PublicKey;
    fromExtTokenAccount: PublicKey;
  }> {
    // Get m vault pda
    const mVault = this.getMVault();

    toMTokenAccount =
      toMTokenAccount ??
      (await this.getATA(this.mMint.publicKey, to ?? from.publicKey));
    fromExtTokenAccount =
      fromExtTokenAccount ??
      (await this.getATA(this.extMint.publicKey, from.publicKey));
    vaultMTokenAccount =
      vaultMTokenAccount ?? (await this.getATA(this.mMint.publicKey, mVault));

    return {
      vaultMTokenAccount,
      toMTokenAccount,
      fromExtTokenAccount,
    };
  }

  public async unwrap(
    from: Keypair,
    amount: BN,
    to?: PublicKey
  ): Promise<{
    vaultMTokenAccount: PublicKey;
    toMTokenAccount: PublicKey;
    fromExtTokenAccount: PublicKey;
  }> {
    // Setup the instruction
    const { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount } =
      await this.prepUnwrap(from, to);

    // Send the instruction
    await this.ext.methods
      .unwrap(amount)
      .accounts({
        signer: from.publicKey,
        toMTokenAccount,
        fromExtTokenAccount,
      })
      .signers([from])
      .rpc();

    return { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount };
  }

  public async claimFees(
    toTokenAccount?: PublicKey
  ): Promise<{ recipientExtTokenAccount: PublicKey }> {
    const recipientExtTokenAccount =
      toTokenAccount ??
      (await this.getATA(this.extMint.publicKey, this.admin.publicKey, true));

    // Send the instruction
    await this.ext.methods
      .claimFees()
      .accountsPartial({
        admin: this.admin.publicKey,
        recipientExtTokenAccount,
      })
      .signers([this.admin])
      .rpc();

    return { recipientExtTokenAccount };
  }
}

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
  createInitializeImmutableOwnerInstruction,
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
  createApproveCheckedInstruction,
} from "@solana/spl-token";
import {
  Earn,
  EARN_IDL,
  PROGRAM_ID as EARN_PROGRAM_ID,
  MerkleTree,
  ProofElement,
} from "@m0-foundation/solana-m-sdk";
import {
  ZERO_WORD,
  InitializeScaledUiAmountConfigInstructionData,
  ScaledUiAmountConfig,
  ScaledUiAmountConfigLayout,
} from "../test-utils";
import { MExt as ScaledUIExt } from "../../target/types/scaled_ui";
import { MExt as NoYieldExt } from "../../target/types/no_yield";
import { MExt as CrankExt } from "../../target/types/crank";

export enum Comparison {
  Equal,
  GreaterThan,
  GreaterThanOrEqual,
  LessThan,
  LessThanOrEqual,
}

// Type definitions for accounts to make it easier to do comparisons

export enum Variant {
  NoYield = "no_yield",
  ScaledUi = "scaled_ui",
  Crank = "crank",
}

type MExt = NoYieldExt | ScaledUIExt | CrankExt;

type YieldVariant = "noYield" | "scaledUi" | "crank";

export type YieldConfig<V extends Variant> = V extends Variant.ScaledUi
  ? {
      yieldVariant: YieldVariant;
      feeBps?: BN;
      lastMIndex?: BN;
      lastExtIndex?: BN;
    }
  : V extends Variant.Crank
  ? {
      yieldVariant: YieldVariant;
      earnAuthority?: PublicKey;
      index?: BN;
      timestamp?: BN;
    }
  : {
      yieldVariant: YieldVariant;
    };

export type ExtGlobal<V extends Variant> = {
  admin?: PublicKey;
  extMint?: PublicKey;
  mMint?: PublicKey;
  mEarnGlobalAccount?: PublicKey;
  bump?: number;
  mVaultBump?: number;
  extMintAuthorityBump?: number;
  wrapAuthorities?: PublicKey[];
  yieldConfig?: YieldConfig<V>;
};

const PROGRAM_ID = new PublicKey(
  "3C865D264L4NkAm78zfnDzQJJvXuU3fMjRUvRxyPi5da"
);

// Test harness for the MExt program that encapsulates all the necessary setup and helper functions to test a given program variant
export class ExtensionTest<V extends Variant = Variant.ScaledUi> {
  public variant: V;
  public svm: LiteSVM;
  public provider: LiteSVMProvider;
  public accounts: Record<string, PublicKey | null> = {};
  public earn: Program<Earn>;
  public ext: Program<MExt>;
  public admin: Keypair;
  public mMint: Keypair;
  public extMint: Keypair;
  public extTokenProgram: PublicKey;
  public mMintAuthority: Keypair;
  public earnAuthority: Keypair;
  public wrapAuthority: Keypair;
  public nonAdmin: Keypair;
  public nonWrapAuthority: Keypair;
  public mEarnerList: PublicKey[] = [];

  constructor(variant: V, addresses: PublicKey[], use2022: boolean = true) {
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
    this.extTokenProgram = use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
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

  public async init(initialSupply: BN, initialIndex: BN, claimCooldown: BN) {
    // Create the M token mint
    await this.createMintWithMultisig(this.mMint, this.mMintAuthority);

    // Create the Ext token mint
    switch (this.variant) {
      case Variant.NoYield:
        await this.createMint(
          this.extMint,
          this.getExtMintAuthority(),
          this.extTokenProgram === TOKEN_2022_PROGRAM_ID
        );
        break;
      case Variant.ScaledUi:
        await this.createScaledUiMint(this.extMint, this.getExtMintAuthority());
        break;
      case Variant.Crank:
        await this.createMint(
          this.extMint,
          this.getExtMintAuthority(),
          this.extTokenProgram === TOKEN_2022_PROGRAM_ID
        );
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
    await this.addMEarner(mVault);
  }

  // Helper functions for token operations and checks on the SVM instance
  public async expectTokenBalance(
    tokenAccount: PublicKey,
    expectedBalance: BN,
    op: Comparison = Comparison.Equal,
    tolerance?: BN
  ) {
    const balance = (
      await getAccount(
        this.provider.connection,
        tokenAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      )
    ).amount;

    switch (op) {
      case Comparison.GreaterThan:
        expect(balance).toBeGreaterThan(BigInt(expectedBalance.toString()));
        if (tolerance) {
          expect(balance).toBeLessThanOrEqual(
            BigInt(expectedBalance.add(tolerance).toString())
          );
        }
        break;
      case Comparison.GreaterThanOrEqual:
        expect(balance).toBeGreaterThanOrEqual(
          BigInt(expectedBalance.toString())
        );
        if (tolerance) {
          expect(balance).toBeLessThanOrEqual(
            BigInt(expectedBalance.add(tolerance).toString())
          );
        }
        break;
      case Comparison.LessThan:
        expect(balance).toBeLessThan(BigInt(expectedBalance.toString()));
        if (tolerance) {
          expect(balance).toBeGreaterThanOrEqual(
            BigInt(expectedBalance.sub(tolerance).toString())
          );
        }
        break;
      case Comparison.LessThanOrEqual:
        expect(balance).toBeLessThanOrEqual(BigInt(expectedBalance.toString()));
        if (tolerance) {
          expect(balance).toBeGreaterThanOrEqual(
            BigInt(expectedBalance.sub(tolerance).toString())
          );
        }
        break;
      default:
        if (tolerance) {
          expect(balance).toBeGreaterThanOrEqual(
            BigInt(expectedBalance.sub(tolerance).toString())
          );
          expect(balance).toBeLessThanOrEqual(
            BigInt(expectedBalance.add(tolerance).toString())
          );
        } else {
          expect(balance).toEqual(BigInt(expectedBalance.toString()));
        }
        break;
    }
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

    const multiplier = (
      await this.getScaledUiAmountConfig(this.extMint.publicKey)
    ).multiplier;

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
    use2022: boolean = true,
    immutableOwner: boolean = false
  ) {
    // We want to create a token account that is not the ATA
    const tokenAccount = new Keypair();
    const tokenAccountLen =
      use2022 && immutableOwner
        ? getAccountLen([ExtensionType.ImmutableOwner])
        : ACCOUNT_SIZE;

    let ixs: TransactionInstruction[] = [];
    ixs.push(
      SystemProgram.createAccount({
        fromPubkey: this.admin.publicKey,
        newAccountPubkey: tokenAccount.publicKey,
        space: tokenAccountLen,
        lamports:
          await this.provider.connection.getMinimumBalanceForRentExemption(
            tokenAccountLen
          ),
        programId: use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      })
    );
    if (use2022 && immutableOwner) {
      ixs.push(
        createInitializeImmutableOwnerInstruction(
          tokenAccount.publicKey,
          TOKEN_2022_PROGRAM_ID
        )
      );
    }
    ixs.push(
      createInitializeAccountInstruction(
        tokenAccount.publicKey,
        mint,
        owner,
        use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
      )
    );

    let tx = new Transaction();
    tx.add(...ixs);

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

  public createInitializeScaledUiAmountConfigInstruction(
    mint: PublicKey,
    authority: PublicKey | null,
    multiplier: number,
    programId: PublicKey = TOKEN_2022_PROGRAM_ID
  ): TransactionInstruction {
    const keys = [{ pubkey: mint, isSigner: false, isWritable: true }];

    const data = Buffer.alloc(
      InitializeScaledUiAmountConfigInstructionData.span
    );
    InitializeScaledUiAmountConfigInstructionData.encode(
      {
        instruction: 43, // scaled ui amount extension
        scaledUiAmountInstruction: 0, // initialize
        authority: authority ?? PublicKey.default,
        multiplier: multiplier,
      },
      data
    );

    return new TransactionInstruction({ keys, programId, data });
  }

  public async createScaledUiMint(
    mint: Keypair,
    mintAuthority: PublicKey,
    decimals = 6
  ) {
    // Create and initialize mint account

    const tokenProgram = TOKEN_2022_PROGRAM_ID;

    const mintLen = getMintLen([ExtensionType.ScaledUiAmountConfig]);
    const mintLamports =
      await this.provider.connection.getMinimumBalanceForRentExemption(mintLen);
    const createMintAccount = SystemProgram.createAccount({
      fromPubkey: this.admin.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports: mintLamports,
      programId: tokenProgram,
    });

    const initializeScaledUiAmountConfig =
      this.createInitializeScaledUiAmountConfigInstruction(
        mint.publicKey,
        mintAuthority,
        1.0,
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
    tx.add(createMintAccount, initializeScaledUiAmountConfig, initializeMint);

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

  public async getScaledUiAmountConfig(
    mint: PublicKey
  ): Promise<ScaledUiAmountConfig> {
    const mintAccount = await getMint(
      this.provider.connection,
      mint,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const extensionData = getExtensionData(
      ExtensionType.ScaledUiAmountConfig,
      mintAccount.tlvData
    );
    if (extensionData === null) {
      throw new Error("Extension data not found");
    }

    return ScaledUiAmountConfigLayout.decode(extensionData);
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

    const mp =
      multiplier ??
      (await this.getScaledUiAmountConfig(tokenAccountInfo.mint)).multiplier;

    const scale = 1e12;

    const uiBalance =
      (tokenAccountInfo.amount * BigInt(Math.floor(mp * scale))) /
      BigInt(scale);

    return new BN(uiBalance.toString());
  }

  public async getTokenSupply(mint: PublicKey) {
    const mintInfo = await getMint(
      this.provider.connection,
      mint,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    if (!mintInfo) {
      throw new Error("Mint not found");
    }

    return new BN(
      Math.floor(Number(mintInfo.supply) * (await this.getCurrentMultiplier()))
    );
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

  public async getNewMultiplier(newIndex: BN): Promise<number> {
    if (this.variant !== Variant.ScaledUi) {
      return 1.0;
    }

    const yieldConfig: YieldConfig<Variant.ScaledUi> = (
      await this.ext.account.extGlobalV2.fetch(this.getExtGlobalAccount())
    ).yieldConfig;

    return (
      (yieldConfig.lastExtIndex!.toNumber() / 1e12) *
      (newIndex.toNumber() / yieldConfig.lastMIndex!.toNumber()) **
        (1 - yieldConfig.feeBps!.toNumber() / 1e4)
    );
  }

  public async getCurrentMultiplier(): Promise<number> {
    if (this.variant !== Variant.ScaledUi) {
      return 1.0;
    }

    const yieldConfig: YieldConfig<Variant.ScaledUi> = (
      await this.ext.account.extGlobalV2.fetch(this.getExtGlobalAccount())
    ).yieldConfig;

    return yieldConfig.lastExtIndex!.toNumber() / 1e12;
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

  public async expectExtGlobalState(expected: ExtGlobal<V>) {
    const state = await this.ext.account.extGlobalV2.fetch(
      this.getExtGlobalAccount()
    );

    if (expected.admin) expect(state.admin).toEqual(expected.admin);
    if (expected.extMint) expect(state.extMint).toEqual(expected.extMint);
    if (expected.mMint) expect(state.mMint).toEqual(expected.mMint);
    if (expected.mEarnGlobalAccount)
      expect(state.mEarnGlobalAccount).toEqual(expected.mEarnGlobalAccount);

    if (expected.yieldConfig) {
      switch (this.variant) {
        case Variant.NoYield:
          expect(state.yieldConfig).toEqual({
            yieldVariant: "noYield",
          });
          break;
        case Variant.ScaledUi:
          this.expectScaledUiYieldConfig(
            state.yieldConfig,
            expected.yieldConfig
          );
          break;
        case Variant.Crank:
          this.expectCrankYieldConfig(state.yieldConfig, expected.yieldConfig);
          break;
        default:
          throw new Error("Unsupported variant for yield config");
      }
    }
    if (expected.bump) expect(state.bump).toEqual(expected.bump);
    if (expected.mVaultBump)
      expect(state.mVaultBump).toEqual(expected.mVaultBump);
    if (expected.extMintAuthorityBump)
      expect(state.extMintAuthorityBump).toEqual(expected.extMintAuthorityBump);
  }

  private expectScaledUiYieldConfig<V extends Variant.ScaledUi>(
    actual: YieldConfig<V>,
    expected: YieldConfig<V>
  ) {
    expect(actual.yieldVariant!).toEqual("scaledUi"); // scaled ui amount variant
    if (expected.feeBps) {
      expect(actual.feeBps!.toString()).toEqual(expected.feeBps.toString());
    }
    if (expected.lastMIndex) {
      expect(actual.lastMIndex!.toString()).toEqual(
        expected.lastMIndex.toString()
      );
    }
    if (expected.lastExtIndex) {
      expect(actual.lastExtIndex!.toString()).toEqual(
        expected.lastExtIndex.toString()
      );
    }
  }

  private expectCrankYieldConfig<V extends Variant.Crank>(
    actual: YieldConfig<V>,
    expected: YieldConfig<V>
  ) {
    expect(actual.yieldVariant!).toEqual("crank"); // crank variant

    if (expected.earnAuthority) {
      expect(actual.earnAuthority!).toEqual(expected.earnAuthority);
    }
    if (expected.index) {
      expect(actual.index!.toString()).toEqual(expected.index.toString());
    }
    if (expected.timestamp) {
      expect(actual.timestamp!.toString()).toEqual(
        expected.timestamp.toString()
      );
    }
  }

  public async expectScaledUiAmountConfig(
    mint: PublicKey,
    expected: ScaledUiAmountConfig
  ) {
    const state = await this.getScaledUiAmountConfig(mint);

    if (expected.authority) expect(state.authority).toEqual(expected.authority);
    if (expected.multiplier) {
      // account for javascript vs. rust floating point precision differences
      const exp_high = (Math.floor(expected.multiplier * 1e12) + 1) / 1e12;
      const exp_low = (Math.floor(expected.multiplier * 1e12) - 1) / 1e12;

      expect(state.multiplier).toBeGreaterThanOrEqual(exp_low);
      expect(state.multiplier).toBeLessThanOrEqual(exp_high);
    }
    if (expected.newMultiplierEffectiveTimestamp)
      expect(state.newMultiplierEffectiveTimestamp.toString()).toEqual(
        expected.newMultiplierEffectiveTimestamp.toString()
      );
    if (expected.newMultiplier) {
      // account for javascript vs. rust floating point precision differences
      const exp_high = (Math.floor(expected.newMultiplier * 1e12) + 1) / 1e12;
      const exp_low = (Math.floor(expected.newMultiplier * 1e12) - 1) / 1e12;

      expect(state.newMultiplier).toBeGreaterThanOrEqual(exp_low);
      expect(state.newMultiplier).toBeLessThanOrEqual(exp_high);
    }
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

  public async expectExtSolvent() {
    const extSupply = await this.getTokenSupply(this.extMint.publicKey);
    const mVaultBalance = await this.getTokenBalance(
      await this.getATA(this.mMint.publicKey, this.getMVault())
    );

    this.variant === Variant.ScaledUi
      ? expect(BigInt(mVaultBalance.toString())).toBeGreaterThan(
          BigInt(extSupply.sub(BN.min(new BN(2), extSupply)).toString())
        ) // allow for a rounding error of 2 for scaled ui due to precision issues
      : expect(BigInt(mVaultBalance.toString())).toBeGreaterThanOrEqual(
          BigInt(extSupply.toString())
        );
  }

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

  async addRegistrarEarner(
    earner: PublicKey,
    proof: ProofElement[],
    earnerTokenAccount?: PublicKey
  ) {
    // Get the earner ATA
    const tokenAccount =
      earnerTokenAccount ?? (await this.getATA(this.mMint.publicKey, earner));

    // Send the instruction
    await this.earn.methods
      .addRegistrarEarner(earner, proof)
      .accountsPartial({
        signer: this.nonAdmin.publicKey,
        userTokenAccount: tokenAccount,
      })
      .signers([this.nonAdmin])
      .rpc();
  }

  async removeRegistrarEarner(
    earner: PublicKey,
    proofs: ProofElement[][],
    neighbors: PublicKey[],
    earnerTokenAccount?: PublicKey
  ) {
    // Get the earner ATA
    const tokenAccount =
      earnerTokenAccount ?? (await this.getATA(this.mMint.publicKey, earner));
    const earnerAccount = this.getMEarnerAccount(tokenAccount);

    // Send the instruction
    await this.earn.methods
      .removeRegistrarEarner(proofs, neighbors)
      .accountsPartial({
        signer: this.nonAdmin.publicKey,
        userTokenAccount: tokenAccount,
        earnerAccount,
      })
      .signers([this.nonAdmin])
      .rpc();
  }

  public async addMEarner(
    earner: PublicKey,
    earnerTokenAccount?: PublicKey
  ): Promise<PublicKey> {
    // Check that the earner is not already in the list
    if (this.mEarnerList.map((e) => e.toBase58()).includes(earner.toBase58())) {
      throw new Error("Earner already exists in the list");
    }

    // Add the earner to the list and get the merkle tree
    this.mEarnerList.push(earner);
    const earnerMerkleTree = new MerkleTree(this.mEarnerList);

    // Get the current index to reuse
    const currentIndex = (
      await this.earn.account.global.fetch(this.getEarnGlobalAccount())
    ).index;

    // Propagate the merkle root
    await this.propagateIndex(currentIndex, earnerMerkleTree.getRoot());

    // Create the earner token for the m token
    const tokenAccount =
      earnerTokenAccount ?? (await this.getATA(this.mMint.publicKey, earner));

    // Add the earner to the earn program
    const { proof } = earnerMerkleTree.getInclusionProof(earner);
    await this.addRegistrarEarner(earner, proof, tokenAccount);

    // Get the earner account address
    const earnerAccount = this.getMEarnerAccount(tokenAccount);

    return earnerAccount;
  }

  public async removeMEarner(
    earner: PublicKey,
    earnerTokenAccount?: PublicKey
  ): Promise<void> {
    // Check that the earner is in the list
    if (
      !this.mEarnerList.map((e) => e.toBase58()).includes(earner.toBase58())
    ) {
      throw new Error("Earner does not exist in the list");
    }

    // Remove the earner from the list and get the merkle tree
    this.mEarnerList = this.mEarnerList.filter((e) => !e.equals(earner));
    const earnerMerkleTree = new MerkleTree(this.mEarnerList);

    // Get the current index to reuse
    const currentIndex = (
      await this.earn.account.global.fetch(this.getEarnGlobalAccount())
    ).index;

    // Propagate the merkle root
    await this.propagateIndex(currentIndex, earnerMerkleTree.getRoot());

    // Get the earner token account
    const tokenAccount =
      earnerTokenAccount ?? (await this.getATA(this.mMint.publicKey, earner));

    // Remove the earner from the earn program
    const { proofs, neighbors } = earnerMerkleTree.getExclusionProof(earner);
    await this.removeRegistrarEarner(earner, proofs, neighbors, tokenAccount);
  }
  // Helper functions for executing MExt instructions

  public async initializeExt(
    wrapAuthorities: PublicKey[],
    feeBps?: BN,
    earnAuthority?: PublicKey
  ) {
    switch (this.variant) {
      case Variant.ScaledUi:
        if (!feeBps) {
          throw new Error("fee_bps is required for Scaled UI variant");
        }
        // Send the transaction
        await this.ext.methods
          .initialize(wrapAuthorities, feeBps)
          .accounts({
            admin: this.admin.publicKey,
            mMint: this.mMint.publicKey,
            extMint: this.extMint.publicKey,
            extTokenProgram: this.extTokenProgram,
          })
          .signers([this.admin])
          .rpc();
        break;
      case Variant.Crank:
        if (!earnAuthority) {
          throw new Error("earnAuthority is required for Crank variant");
        }

        await this.ext.methods
          .initialize(wrapAuthorities, earnAuthority)
          .accounts({
            admin: this.admin.publicKey,
            mMint: this.mMint.publicKey,
            extMint: this.extMint.publicKey,
            extTokenProgram: this.extTokenProgram,
          })
          .signers([this.admin])
          .rpc();
      case Variant.NoYield:
        // Send the transaction
        await this.ext.methods
          .initialize(wrapAuthorities)
          .accounts({
            admin: this.admin.publicKey,
            mMint: this.mMint.publicKey,
            extMint: this.extMint.publicKey,
            extTokenProgram: this.extTokenProgram,
          })
          .signers([this.admin])
          .rpc();
        break;
      default:
        throw new Error("Unsupported variant for initializeExt");
    }
  }

  public async addWrapAuthority(newWrapAuthority: PublicKey) {
    // Send the instruction
    await this.ext.methods
      .addWrapAuthority(newWrapAuthority)
      .accounts({})
      .signers([this.admin])
      .rpc();
  }

  public async removeWrapAuthority(oldWrapAuthority: PublicKey) {
    // Send the instruction
    await this.ext.methods
      .removeWrapAuthority(oldWrapAuthority)
      .accounts({})
      .signers([this.admin])
      .rpc();
  }

  public async prepWrap(
    from: PublicKey,
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
      fromMTokenAccount ?? (await this.getATA(this.mMint.publicKey, from));
    toExtTokenAccount =
      toExtTokenAccount ??
      (await this.getATA(this.extMint.publicKey, to ?? from));
    vaultMTokenAccount =
      vaultMTokenAccount ?? (await this.getATA(this.mMint.publicKey, mVault));

    return {
      vaultMTokenAccount,
      fromMTokenAccount,
      toExtTokenAccount,
    };
  }

  public async wrap(
    tokenAuthority: Keypair,
    amount: BN,
    wrapAuthority?: Keypair | null,
    from?: PublicKey,
    to?: PublicKey
  ): Promise<{
    vaultMTokenAccount: PublicKey;
    fromMTokenAccount: PublicKey;
    toExtTokenAccount: PublicKey;
  }> {
    // Setup the instruction
    const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } =
      await this.prepWrap(from ?? tokenAuthority.publicKey, to);

    // Send the instruction
    await this.ext.methods
      .wrap(amount)
      .accounts({
        tokenAuthority: tokenAuthority.publicKey,
        wrapAuthority: wrapAuthority
          ? wrapAuthority.publicKey
          : this.ext.programId,
        fromMTokenAccount,
        toExtTokenAccount,
        extTokenProgram: this.extTokenProgram,
      })
      .signers(
        wrapAuthority ? [tokenAuthority, wrapAuthority] : [tokenAuthority]
      )
      .rpc();

    return { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount };
  }

  public async prepUnwrap(
    from: PublicKey,
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
      toMTokenAccount ?? (await this.getATA(this.mMint.publicKey, to ?? from));
    fromExtTokenAccount =
      fromExtTokenAccount ?? (await this.getATA(this.extMint.publicKey, from));
    vaultMTokenAccount =
      vaultMTokenAccount ?? (await this.getATA(this.mMint.publicKey, mVault));

    return {
      vaultMTokenAccount,
      toMTokenAccount,
      fromExtTokenAccount,
    };
  }

  public async unwrap(
    tokenAuthority: Keypair,
    amount: BN,
    wrapAuthority?: Keypair | null,
    from?: PublicKey,
    to?: PublicKey
  ): Promise<{
    vaultMTokenAccount: PublicKey;
    toMTokenAccount: PublicKey;
    fromExtTokenAccount: PublicKey;
  }> {
    // Setup the instruction
    const { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount } =
      await this.prepUnwrap(from ?? tokenAuthority.publicKey, to);

    // Send the instruction
    await this.ext.methods
      .unwrap(amount)
      .accounts({
        tokenAuthority: tokenAuthority.publicKey,
        unwrapAuthority: wrapAuthority
          ? wrapAuthority.publicKey
          : this.ext.programId,
        toMTokenAccount,
        fromExtTokenAccount,
        extTokenProgram: this.extTokenProgram,
      })
      .signers(
        wrapAuthority ? [tokenAuthority, wrapAuthority] : [tokenAuthority]
      )
      .rpc();

    return { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount };
  }

  public async sync(): Promise<PublicKey> {
    switch (this.variant) {
      case Variant.NoYield:
        throw new Error("sync is not supported for No Yield variant");
        break;
      case Variant.ScaledUi:
        // Sync is open to any address
        await this.ext.methods
          .sync()
          .accounts({
            extTokenProgram: this.extTokenProgram,
          })
          .signers([])
          .rpc();
        break;
      case Variant.Crank:
        // For Crank variant, we have to use the earn authority to sync
        await this.ext.methods
          .sync()
          .accounts({
            earnAuthority: this.earnAuthority.publicKey,
            extTokenProgram: this.extTokenProgram,
          })
          .signers([this.earnAuthority])
          .rpc();
        break;
      default:
        throw new Error("Unsupported variant for sync");
    }

    return this.getExtGlobalAccount();
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

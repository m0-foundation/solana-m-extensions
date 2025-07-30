// import { Program, AnchorError, BN } from "@coral-xyz/anchor";
// import { LiteSVM } from "litesvm";
// import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
// import {
//   PublicKey,
//   Keypair,
//   LAMPORTS_PER_SOL,
//   SystemProgram,
//   Transaction,
// } from "@solana/web3.js";
// import {
//   ACCOUNT_SIZE,
//   ASSOCIATED_TOKEN_PROGRAM_ID,
//   TOKEN_PROGRAM_ID,
//   TOKEN_2022_PROGRAM_ID,
//   createInitializeMintInstruction,
//   createAssociatedTokenAccountInstruction,
//   createCloseAccountInstruction,
//   getAccount,
//   getMintLen,
//   getMinimumBalanceForRentExemptMultisig,
//   getAssociatedTokenAddressSync,
//   createInitializeAccountInstruction,
//   createInitializeMultisigInstruction,
//   createMintToCheckedInstruction,
//   getAccountLen,
//   createInitializeImmutableOwnerInstruction,
//   ExtensionType,
// } from "@solana/spl-token";
// import { randomInt } from "crypto";

// import { loadKeypair } from "../test-utils";
// import { Earn } from "../../target/types/earn";
// import { ExtEarn } from "../../target/types/ext_earn";
// import { ExtSwap } from "../programs/ext_swap";
// import { MerkleTree, ProofElement } from "../../sdk/src/merkle";

// const EARN_IDL = require("../../target/idl/earn.json");
// const EXT_EARN_IDL = require("../../target/idl/ext_earn.json");
// const SWAP_IDL = require("../programs/ext_swap.json");

// const EARN_PROGRAM_ID = new PublicKey(
//   "MzeRokYa9o1ZikH6XHRiSS5nD8mNjZyHpLCBRTBSY4c"
// );
// const EXT_EARN_PROGRAM_ID = new PublicKey(
//   "wMXX1K1nca5W4pZr1piETe78gcAVVrEFi9f4g46uXko"
// );
// // Unit tests for ext earn program

// const ZERO_WORD = new Array(32).fill(0);

// // Setup wallets once at the beginning of the test suite
// const admin: Keypair = loadKeypair("keys/admin.json");
// const portal: Keypair = loadKeypair("keys/admin.json");
// const mMint: Keypair = loadKeypair("keys/mint.json");
// const extMint: Keypair = new Keypair();
// const earnAuthority: Keypair = new Keypair();
// const mMintAuthority: Keypair = new Keypair();
// const nonAdmin: Keypair = new Keypair();

// // Create random addresses for testing
// const earnerOne: Keypair = new Keypair();
// const earnerTwo: Keypair = new Keypair();
// const earnManagerOne: Keypair = new Keypair();
// const earnManagerTwo: Keypair = new Keypair();
// const nonEarnerOne: Keypair = new Keypair();
// const nonEarnManagerOne: Keypair = new Keypair();
// const yieldRecipient: Keypair = new Keypair();

// let svm: LiteSVM;
// let provider: LiteSVMProvider;
// let accounts: Record<string, PublicKey | null> = {};
// let earn: Program<Earn>;
// let extEarn: Program<ExtEarn>;
// let swapProgram: Program<ExtSwap>;

// // Start parameters
// const initialSupply = new BN(100_000_000); // 100 tokens with 6 decimals
// const initialIndex = new BN(1_000_000_000_000); // 1.0
// const claimCooldown = new BN(0); // None

// // Type definitions for accounts to make it easier to do comparisons

// interface EarnGlobal {
//   admin?: PublicKey;
//   earnAuthority?: PublicKey;
//   mint?: PublicKey;
//   index?: BN;
//   timestamp?: BN;
//   claimCooldown?: BN;
//   maxSupply?: BN;
//   maxYield?: BN;
//   distributed?: BN;
//   claimComplete?: boolean;
//   earnerMerkleRoot?: number[];
// }

// interface ExtGlobal {
//   admin?: PublicKey;
//   earnAuthority?: PublicKey;
//   extMint?: PublicKey;
//   mMint?: PublicKey;
//   mEarnGlobalAccount?: PublicKey;
//   index?: BN;
//   timestamp?: BN;
//   bump?: number;
//   mVaultBump?: number;
//   extMintAuthorityBump?: number;
// }

// interface Earner {
//   earnManager?: PublicKey;
//   recipientTokenAccount?: PublicKey;
//   lastClaimIndex?: BN;
//   lastClaimTimestamp?: BN;
//   user?: PublicKey;
//   userTokenAccount?: PublicKey;
//   bump?: number;
// }

// interface EarnManager {
//   earnManager?: PublicKey;
//   isActive?: boolean;
//   feeBps?: BN;
//   feeTokenAccount?: PublicKey | null;
//   bump?: number;
// }

// const getEarnGlobalAccount = () => {
//   const [globalAccount] = PublicKey.findProgramAddressSync(
//     [Buffer.from("global")],
//     earn.programId
//   );

//   return globalAccount;
// };

// const getEarnTokenAuthority = () => {
//   const [earnTokenAuthority] = PublicKey.findProgramAddressSync(
//     [Buffer.from("token_authority")],
//     earn.programId
//   );

//   return earnTokenAuthority;
// };

// const getExtGlobalAccount = () => {
//   const [globalAccount] = PublicKey.findProgramAddressSync(
//     [Buffer.from("global")],
//     extEarn.programId
//   );

//   return globalAccount;
// };

// const getExtMintAuthority = () => {
//   const [extMintAuthority] = PublicKey.findProgramAddressSync(
//     [Buffer.from("mint_authority")],
//     extEarn.programId
//   );

//   return extMintAuthority;
// };

// const getMVault = () => {
//   const [mVault] = PublicKey.findProgramAddressSync(
//     [Buffer.from("m_vault")],
//     extEarn.programId
//   );

//   return mVault;
// };

// const getMEarnerAccount = (tokenAccount: PublicKey) => {
//   const [earnerAccount] = PublicKey.findProgramAddressSync(
//     [Buffer.from("earner"), tokenAccount.toBuffer()],
//     earn.programId
//   );

//   return earnerAccount;
// };

// const getExtEarnerAccount = (tokenAccount: PublicKey) => {
//   const [earnerAccount] = PublicKey.findProgramAddressSync(
//     [Buffer.from("earner"), tokenAccount.toBuffer()],
//     extEarn.programId
//   );

//   return earnerAccount;
// };

// const getEarnManagerAccount = (earnManager: PublicKey) => {
//   const [earnManagerAccount] = PublicKey.findProgramAddressSync(
//     [Buffer.from("earn_manager"), earnManager.toBuffer()],
//     extEarn.programId
//   );

//   return earnManagerAccount;
// };

// // Utility functions for the tests
// const expectAccountEmpty = (account: PublicKey) => {
//   const accountInfo = svm.getAccount(account);

//   if (accountInfo) {
//     expect(accountInfo.lamports).toBe(0);
//     expect(accountInfo.data.length).toBe(0);
//     expect(accountInfo.owner).toStrictEqual(SystemProgram.programId);
//   }
// };

// const expectAnchorError = async (
//   txResult: Promise<string>,
//   errCode: string
// ) => {
//   try {
//     await txResult;
//     throw new Error("Transaction should have reverted");
//   } catch (e) {
//     if (!(e instanceof AnchorError))
//       throw new Error(`Expected AnchorError, got ${e}`);
//     const err: AnchorError = e;
//     expect(err.error.errorCode.code).toStrictEqual(errCode);
//   }
// };

// const expectSystemError = async (txResult: Promise<string>) => {
//   let reverted = false;
//   try {
//     await txResult;
//   } catch (e) {
//     // console.log(e.transactionMessage);
//     // console.log(e.logs);
//     reverted = true;
//   } finally {
//     expect(reverted).toBe(true);
//   }
// };

// const expectEarnGlobalState = async (
//   globalAccount: PublicKey,
//   expected: EarnGlobal
// ) => {
//   const state = await earn.account.global.fetch(globalAccount);

//   if (expected.earnAuthority)
//     expect(state.earnAuthority).toEqual(expected.earnAuthority);
//   if (expected.index)
//     expect(state.index.toString()).toEqual(expected.index.toString());
//   if (expected.timestamp)
//     expect(state.timestamp.toString()).toEqual(expected.timestamp.toString());
//   if (expected.claimCooldown)
//     expect(state.claimCooldown.toString()).toEqual(
//       expected.claimCooldown.toString()
//     );
//   if (expected.maxSupply)
//     expect(state.maxSupply.toString()).toEqual(expected.maxSupply.toString());
//   if (expected.maxYield)
//     expect(state.maxYield.toString()).toEqual(expected.maxYield.toString());
//   if (expected.distributed)
//     expect(state.distributed.toString()).toEqual(
//       expected.distributed.toString()
//     );
//   if (expected.claimComplete !== undefined)
//     expect(state.claimComplete).toEqual(expected.claimComplete);
//   if (expected.earnerMerkleRoot)
//     expect(state.earnerMerkleRoot).toEqual(expected.earnerMerkleRoot);
// };

// const expectExtGlobalState = async (
//   globalAccount: PublicKey,
//   expected: ExtGlobal
// ) => {
//   const state = await extEarn.account.extGlobal.fetch(globalAccount);

//   if (expected.admin) expect(state.admin).toEqual(expected.admin);
//   if (expected.earnAuthority)
//     expect(state.earnAuthority).toEqual(expected.earnAuthority);
//   if (expected.extMint) expect(state.extMint).toEqual(expected.extMint);
//   if (expected.mMint) expect(state.mMint).toEqual(expected.mMint);
//   if (expected.mEarnGlobalAccount)
//     expect(state.mEarnGlobalAccount).toEqual(expected.mEarnGlobalAccount);
//   if (expected.index)
//     expect(state.index.toString()).toEqual(expected.index.toString());
//   if (expected.timestamp)
//     expect(state.timestamp.toString()).toEqual(expected.timestamp.toString());
//   if (expected.bump) expect(state.bump).toEqual(expected.bump);
//   if (expected.mVaultBump)
//     expect(state.mVaultBump).toEqual(expected.mVaultBump);
//   if (expected.extMintAuthorityBump)
//     expect(state.extMintAuthorityBump).toEqual(expected.extMintAuthorityBump);
// };

// const expectEarnerState = async (
//   earnerAccount: PublicKey,
//   expected: Earner
// ) => {
//   const state = await extEarn.account.earner.fetch(earnerAccount);

//   if (expected.earnManager)
//     expect(state.earnManager).toEqual(expected.earnManager);
//   if (expected.recipientTokenAccount)
//     expect(state.recipientTokenAccount).toEqual(expected.recipientTokenAccount);
//   if (expected.lastClaimIndex)
//     expect(state.lastClaimIndex.toString()).toEqual(
//       expected.lastClaimIndex.toString()
//     );
//   if (expected.lastClaimTimestamp)
//     expect(state.lastClaimTimestamp.toString()).toEqual(
//       expected.lastClaimTimestamp.toString()
//     );
//   if (expected.user) expect(state.user).toEqual(expected.user);
//   if (expected.userTokenAccount)
//     expect(state.userTokenAccount).toEqual(expected.userTokenAccount);
// };

// const expectEarnManagerState = async (
//   earnManagerAccount: PublicKey,
//   expected: EarnManager
// ) => {
//   const state = await extEarn.account.earnManager.fetch(earnManagerAccount);

//   if (expected.earnManager)
//     expect(state.earnManager).toEqual(expected.earnManager);
//   if (expected.isActive !== undefined)
//     expect(state.isActive).toEqual(expected.isActive);
//   if (expected.feeBps)
//     expect(state.feeBps.toString()).toEqual(expected.feeBps.toString());
//   if (expected.feeTokenAccount)
//     expect(state.feeTokenAccount).toEqual(expected.feeTokenAccount);
// };

// const expectTokenBalance = async (
//   tokenAccount: PublicKey,
//   expectedBalance: BN
// ) => {
//   const balance = (
//     await getAccount(
//       provider.connection,
//       tokenAccount,
//       undefined,
//       TOKEN_2022_PROGRAM_ID
//     )
//   ).amount;

//   expect(balance.toString()).toEqual(expectedBalance.toString());
// };

// const createATA = async (mint: PublicKey, owner: PublicKey) => {
//   const tokenAccount = getAssociatedTokenAddressSync(
//     mint,
//     owner,
//     true,
//     TOKEN_2022_PROGRAM_ID,
//     ASSOCIATED_TOKEN_PROGRAM_ID
//   );

//   const createATA = createAssociatedTokenAccountInstruction(
//     admin.publicKey, // payer
//     tokenAccount, // ata
//     owner, // owner
//     mint, // mint
//     TOKEN_2022_PROGRAM_ID,
//     ASSOCIATED_TOKEN_PROGRAM_ID
//   );

//   let tx = new Transaction().add(createATA);

//   await provider.sendAndConfirm!(tx, [admin]);

//   return tokenAccount;
// };

// const getATA = async (mint: PublicKey, owner: PublicKey) => {
//   // Check to see if the ATA already exists, if so return its key
//   const tokenAccount = getAssociatedTokenAddressSync(
//     mint,
//     owner,
//     true,
//     TOKEN_2022_PROGRAM_ID,
//     ASSOCIATED_TOKEN_PROGRAM_ID
//   );

//   const tokenAccountInfo = svm.getAccount(tokenAccount);

//   if (!tokenAccountInfo) {
//     await createATA(mint, owner);
//   }

//   return tokenAccount;
// };

// const createTokenAccount = async (mint: PublicKey, owner: PublicKey) => {
//   // We want to create a token account that is not the ATA
//   const tokenAccount = new Keypair();

//   let tx = new Transaction();
//   tx.add(
//     SystemProgram.createAccount({
//       fromPubkey: admin.publicKey,
//       newAccountPubkey: tokenAccount.publicKey,
//       space: ACCOUNT_SIZE,
//       lamports: await provider.connection.getMinimumBalanceForRentExemption(
//         ACCOUNT_SIZE
//       ),
//       programId: TOKEN_2022_PROGRAM_ID,
//     }),
//     createInitializeAccountInstruction(
//       tokenAccount.publicKey,
//       mint,
//       owner,
//       TOKEN_2022_PROGRAM_ID
//     )
//   );

//   await provider.sendAndConfirm!(tx, [admin, tokenAccount]);

//   return { tokenAccount: tokenAccount.publicKey };
// };

// const closeTokenAccount = async (owner: Keypair, tokenAccount: PublicKey) => {
//   const closeIx = createCloseAccountInstruction(
//     tokenAccount,
//     owner.publicKey,
//     owner.publicKey,
//     [],
//     TOKEN_2022_PROGRAM_ID
//   );

//   let tx = new Transaction().add(closeIx);

//   await provider.sendAndConfirm!(tx, [owner]);
// };

// const createMint = async (
//   mint: Keypair,
//   mintAuthority: PublicKey,
//   use2022: boolean = true,
//   decimals = 6
// ) => {
//   // Create and initialize mint account

//   const tokenProgram = use2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

//   const mintLen = getMintLen([]);
//   const mintLamports =
//     await provider.connection.getMinimumBalanceForRentExemption(mintLen);
//   const createMintAccount = SystemProgram.createAccount({
//     fromPubkey: admin.publicKey,
//     newAccountPubkey: mint.publicKey,
//     space: mintLen,
//     lamports: mintLamports,
//     programId: tokenProgram,
//   });

//   const initializeMint = createInitializeMintInstruction(
//     mint.publicKey,
//     decimals, // decimals
//     mintAuthority, // mint authority
//     mintAuthority, // freeze authority
//     tokenProgram
//   );

//   let tx = new Transaction();
//   tx.add(createMintAccount, initializeMint);

//   await provider.sendAndConfirm!(tx, [admin, mint]);

//   // Verify the mint was created properly
//   const mintInfo = await provider.connection.getAccountInfo(mint.publicKey);
//   if (!mintInfo) {
//     throw new Error("Mint account was not created");
//   }

//   return mint.publicKey;
// };

// const createMintWithMultisig = async (
//   mint: Keypair,
//   mintAuthority: Keypair
// ) => {
//   // Create and initialize multisig mint authority on the token program
//   const multisigLen = 355;
//   // const multisigLamports = await provider.connection.getMinimumBalanceForRentExemption(multisigLen);
//   const multisigLamports = await getMinimumBalanceForRentExemptMultisig(
//     provider.connection
//   );

//   const createMultisigAccount = SystemProgram.createAccount({
//     fromPubkey: admin.publicKey,
//     newAccountPubkey: mintAuthority.publicKey,
//     space: multisigLen,
//     lamports: multisigLamports,
//     programId: TOKEN_2022_PROGRAM_ID,
//   });

//   const earnTokenAuthority = getEarnTokenAuthority();

//   const initializeMultisig = createInitializeMultisigInstruction(
//     mintAuthority.publicKey, // account
//     [portal, earnTokenAuthority],
//     1,
//     TOKEN_2022_PROGRAM_ID
//   );

//   let tx = new Transaction();
//   tx.add(createMultisigAccount, initializeMultisig);

//   await provider.sendAndConfirm!(tx, [admin, mintAuthority]);

//   // Create and initialize mint account

//   const mintLen = getMintLen([]);
//   const mintLamports =
//     await provider.connection.getMinimumBalanceForRentExemption(mintLen);
//   const createMintWithMultisigAccount = SystemProgram.createAccount({
//     fromPubkey: admin.publicKey,
//     newAccountPubkey: mint.publicKey,
//     space: mintLen,
//     lamports: mintLamports,
//     programId: TOKEN_2022_PROGRAM_ID,
//   });

//   const initializeMint = createInitializeMintInstruction(
//     mint.publicKey,
//     6, // decimals
//     mintAuthority.publicKey, // mint authority
//     null, // freeze authority
//     TOKEN_2022_PROGRAM_ID
//   );

//   tx = new Transaction();
//   tx.add(createMintWithMultisigAccount, initializeMint);

//   await provider.sendAndConfirm!(tx, [admin, mint]);

//   // Verify the mint was created properly
//   const mintInfo = await provider.connection.getAccountInfo(mint.publicKey);
//   if (!mintInfo) {
//     throw new Error("Mint account was not created");
//   }

//   return mint.publicKey;
// };

// const mintM = async (to: PublicKey, amount: BN) => {
//   const toATA: PublicKey = await getATA(mMint.publicKey, to);

//   const mintToInstruction = createMintToCheckedInstruction(
//     mMint.publicKey,
//     toATA,
//     mMintAuthority.publicKey,
//     BigInt(amount.toString()),
//     6,
//     [portal],
//     TOKEN_2022_PROGRAM_ID
//   );

//   let tx = new Transaction();
//   tx.add(mintToInstruction);
//   await provider.sendAndConfirm!(tx, [portal]);
// };

// const getTokenBalance = async (tokenAccount: PublicKey) => {
//   const tokenAccountInfo = await getAccount(
//     provider.connection,
//     tokenAccount,
//     undefined,
//     TOKEN_2022_PROGRAM_ID
//   );
//   if (!tokenAccountInfo) {
//     throw new Error("Account not created");
//   }

//   return new BN(tokenAccountInfo.amount.toString());
// };

// const warp = (seconds: BN, increment: boolean) => {
//   const clock = svm.getClock();
//   clock.unixTimestamp = increment
//     ? clock.unixTimestamp + BigInt(seconds.toString())
//     : BigInt(seconds.toString());
//   svm.setClock(clock);
// };

// // instruction convenience functions for earn program
// const prepEarnInitialize = (signer: Keypair, mint: PublicKey) => {
//   // Get the global PDA
//   const globalAccount = getEarnGlobalAccount();

//   // Populate accounts for the instruction
//   accounts = {};
//   accounts.admin = signer.publicKey;
//   accounts.globalAccount = globalAccount;
//   accounts.mint = mint;
//   accounts.systemProgram = SystemProgram.programId;

//   return { globalAccount };
// };

// const initializeEarn = async (
//   mint: PublicKey,
//   earnAuthority: PublicKey,
//   initialIndex: BN,
//   claimCooldown: BN
// ) => {
//   // Setup the instruction
//   const { globalAccount } = prepEarnInitialize(admin, mint);

//   // Send the transaction
//   await earn.methods
//     .initialize(earnAuthority, initialIndex, claimCooldown)
//     .accountsPartial({ ...accounts })
//     .signers([admin])
//     .rpc();

//   return globalAccount;
// };

// const prepPropagateIndex = (signer: Keypair) => {
//   // Get the global PDA
//   const globalAccount = getEarnGlobalAccount();

//   // Populate accounts
//   accounts = {};
//   accounts.signer = signer.publicKey;
//   accounts.globalAccount = globalAccount;
//   accounts.mint = mMint.publicKey;

//   return { globalAccount };
// };

// const propagateIndex = async (
//   newIndex: BN,
//   earnerMerkleRoot: number[] = ZERO_WORD
// ) => {
//   // Setup the instruction
//   const { globalAccount } = prepPropagateIndex(portal);

//   // Send the instruction
//   await earn.methods
//     .propagateIndex(newIndex, earnerMerkleRoot)
//     .accountsPartial({ ...accounts })
//     .signers([portal])
//     .rpc();

//   // We don't check state here because it depends on the circumstances

//   return { globalAccount };
// };

// const prepMClaimFor = async (
//   signer: Keypair,
//   mint: PublicKey,
//   earner: PublicKey
// ) => {
//   // Get the global and token authority PDAs
//   const globalAccount = getEarnGlobalAccount();
//   const earnTokenAuthority = getEarnTokenAuthority();

//   // Get the earner ATA
//   const earnerATA = await getATA(mint, earner);

//   // Get the earner account
//   const earnerAccount = getMEarnerAccount(earnerATA);

//   // Populate accounts
//   accounts = {};
//   accounts.earnAuthority = signer.publicKey;
//   accounts.globalAccount = globalAccount;
//   accounts.earnerAccount = earnerAccount;
//   accounts.mint = mint;
//   accounts.mintMultisig = mMintAuthority.publicKey;
//   accounts.tokenAuthorityAccount = earnTokenAuthority;
//   accounts.userTokenAccount = earnerATA;
//   accounts.tokenProgram = TOKEN_2022_PROGRAM_ID;

//   return { globalAccount, earnerAccount, earnerATA };
// };

// const mClaimFor = async (earner: PublicKey, balance?: BN) => {
//   // Setup the instruction
//   const { globalAccount, earnerAccount, earnerATA } = await prepMClaimFor(
//     earnAuthority,
//     mMint.publicKey,
//     earner
//   );

//   const snapshotBalance = balance ?? (await getTokenBalance(earnerATA));

//   // Send the instruction
//   await earn.methods
//     .claimFor(snapshotBalance)
//     .accountsPartial({ ...accounts })
//     .signers([earnAuthority])
//     .rpc();

//   return { globalAccount, earnerAccount, earnerATA };
// };

// const prepCompleteClaims = (signer: Keypair) => {
//   // Get the global PDA
//   const globalAccount = getEarnGlobalAccount();

//   // Populate accounts
//   accounts = {};
//   accounts.earnAuthority = signer.publicKey;
//   accounts.globalAccount = globalAccount;

//   return { globalAccount };
// };

// const completeClaims = async () => {
//   // Setup the instruction
//   prepCompleteClaims(earnAuthority);

//   // Send the instruction
//   await earn.methods
//     .completeClaims()
//     .accountsPartial({ ...accounts })
//     .signers([earnAuthority])
//     .rpc();
// };

// const prepAddRegistrarEarner = (signer: Keypair, earnerATA: PublicKey) => {
//   // Get the global PDA
//   const globalAccount = getEarnGlobalAccount();

//   // Get the earner account
//   const earnerAccount = getMEarnerAccount(earnerATA);

//   // Populate accounts
//   accounts = {};
//   accounts.signer = signer.publicKey;
//   accounts.userTokenAccount = earnerATA;
//   accounts.globalAccount = globalAccount;
//   accounts.earnerAccount = earnerAccount;
//   accounts.systemProgram = SystemProgram.programId;

//   return { globalAccount, earnerAccount };
// };

// const addRegistrarEarner = async (earner: PublicKey, proof: ProofElement[]) => {
//   // Get the earner ATA
//   const earnerATA = await getATA(mMint.publicKey, earner);

//   // Setup the instruction
//   prepAddRegistrarEarner(nonAdmin, earnerATA);

//   // Send the instruction
//   await earn.methods
//     .addRegistrarEarner(earner, proof)
//     .accountsPartial({ ...accounts })
//     .signers([nonAdmin])
//     .rpc();
// };

// const prepRemoveRegistrarEarner = (signer: Keypair, earnerATA: PublicKey) => {
//   // Get the global PDA
//   const globalAccount = getEarnGlobalAccount();

//   // Get the earner account
//   const earnerAccount = getMEarnerAccount(earnerATA);

//   // Populate accounts
//   accounts = {};
//   accounts.signer = signer.publicKey;
//   accounts.globalAccount = globalAccount;
//   accounts.userTokenAccount = earnerATA;
//   accounts.earnerAccount = earnerAccount;

//   return { globalAccount, earnerAccount };
// };

// // instruction convenience functions for the ExtEarn program

// const prepExtInitialize = (signer: Keypair) => {
//   // Get the global PDA
//   const globalAccount = getExtGlobalAccount();

//   // Populate accounts for the instruction
//   accounts = {};
//   accounts.admin = signer.publicKey;
//   accounts.globalAccount = globalAccount;
//   accounts.mMint = mMint.publicKey;
//   accounts.extMint = extMint.publicKey;
//   accounts.mEarnGlobalAccount = getEarnGlobalAccount();
//   accounts.token2022 = TOKEN_2022_PROGRAM_ID;
//   accounts.systemProgram = SystemProgram.programId;

//   return { globalAccount };
// };

// const initializeExt = async (earnAuthority: PublicKey) => {
//   // Setup the instruction
//   const { globalAccount } = prepExtInitialize(admin);

//   // Send the transaction
//   await extEarn.methods
//     .initialize(earnAuthority)
//     .accountsPartial({ ...accounts })
//     .signers([admin])
//     .rpc();

//   // Whitelist wrap authorities
//   for (const auth of [admin, earnerOne, earnerTwo, nonEarnerOne]) {
//     await extEarn.methods
//       .addWrapAuthority(auth.publicKey)
//       .accounts({ admin: admin.publicKey })
//       .signers([admin])
//       .rpc();
//   }

//   return globalAccount;
// };

// const prepSetEarnAuthority = (signer: Keypair) => {
//   // Get the global PDA
//   const globalAccount = getExtGlobalAccount();

//   // Populate accounts for the instruction
//   accounts = {};
//   accounts.admin = signer.publicKey;
//   accounts.globalAccount = globalAccount;

//   return { globalAccount };
// };

// const prepAddEarnManager = async (
//   signer: Keypair,
//   earnManager: PublicKey,
//   feeTokenAccount?: PublicKey
// ) => {
//   // Cache the earn manager account so it can be returned
//   const earnManagerAccount = getEarnManagerAccount(earnManager);

//   // Populate accounts for the instruction
//   accounts = {};
//   accounts.admin = signer.publicKey;
//   accounts.globalAccount = getExtGlobalAccount();
//   accounts.earnManagerAccount = earnManagerAccount;
//   // If a fee token account is provided, use that
//   // Otherwise get the earnManager's ATA from the extMint
//   accounts.feeTokenAccount =
//     feeTokenAccount ?? (await getATA(extMint.publicKey, earnManager));

//   return { earnManagerAccount };
// };

// const addEarnManager = async (
//   earnManager: PublicKey,
//   feeBps: BN,
//   feeTokenAccount?: PublicKey
// ) => {
//   // Setup the instruction
//   const { earnManagerAccount } = await prepAddEarnManager(
//     admin,
//     earnManager,
//     feeTokenAccount
//   );

//   // Send the instruction
//   await extEarn.methods
//     .addEarnManager(earnManager, feeBps)
//     .accountsPartial({ ...accounts })
//     .signers([admin])
//     .rpc();

//   return { earnManagerAccount };
// };

// const prepRemoveEarnManager = (signer: Keypair, earnManager: PublicKey) => {
//   // Cache the earn manager account
//   const earnManagerAccount = getEarnManagerAccount(earnManager);

//   // Populate the accounts for the instruction
//   accounts = {};
//   accounts.admin = signer.publicKey;
//   accounts.globalAccount = getExtGlobalAccount();
//   accounts.earnManagerAccount = earnManagerAccount;

//   return { earnManagerAccount };
// };

// const removeEarnManager = async (earnManager: PublicKey) => {
//   // Setup the instruction
//   const { earnManagerAccount } = prepRemoveEarnManager(admin, earnManager);

//   // Send the instruction
//   await extEarn.methods
//     .removeEarnManager()
//     .accountsPartial({ ...accounts })
//     .signers([admin])
//     .rpc();

//   return { earnManagerAccount };
// };

// const prepSync = (signer: Keypair) => {
//   // Cache the global account
//   const globalAccount = getExtGlobalAccount();

//   // Populate the accounts
//   accounts = {};
//   accounts.earnAuthority = signer.publicKey;
//   accounts.mEarnGlobalAccount = getEarnGlobalAccount();
//   accounts.globalAccount = globalAccount;

//   return { globalAccount };
// };

// const sync = async () => {
//   // Setup the instruction
//   prepSync(earnAuthority);

//   // Send the instruction
//   await extEarn.methods
//     .sync()
//     .accountsPartial({ ...accounts })
//     .signers([earnAuthority])
//     .rpc();
// };

// const prepClaimFor = async (
//   signer: Keypair,
//   earner: PublicKey,
//   earnManager: PublicKey,
//   earnerTA?: PublicKey,
//   earnManagerTA?: PublicKey
// ) => {
//   const earnerATA = await getATA(extMint.publicKey, earner);
//   const userTokenAccount = earnerTA ?? earnerATA;
//   const earnManagerTokenAccount =
//     earnManagerTA ?? (await getATA(extMint.publicKey, earnManager));
//   const mVault = getMVault();
//   const earnerAccount = getExtEarnerAccount(earnerATA);

//   // Populate accounts
//   accounts = {};
//   accounts.earnAuthority = signer.publicKey;
//   accounts.globalAccount = getExtGlobalAccount();
//   accounts.extMint = extMint.publicKey;
//   accounts.extMintAuthority = getExtMintAuthority();
//   accounts.mVaultAccount = mVault;
//   accounts.vaultMTokenAccount = await getATA(mMint.publicKey, mVault);
//   accounts.userTokenAccount = userTokenAccount;
//   accounts.earnerAccount = earnerAccount;
//   accounts.earnManagerAccount = getEarnManagerAccount(earnManager);
//   accounts.earnManagerTokenAccount = earnManagerTokenAccount;
//   accounts.token2022 = TOKEN_2022_PROGRAM_ID;

//   return { earnerAccount, userTokenAccount, earnManagerTokenAccount };
// };

// const claimFor = async (
//   earner: PublicKey,
//   earnManager: PublicKey,
//   balance?: BN
// ) => {
//   const earnerATA = await getATA(extMint.publicKey, earner);
//   const earnerAccount = getExtEarnerAccount(earnerATA);
//   const earnerState = await extEarn.account.earner.fetch(earnerAccount);

//   const earnManagerAccount = getEarnManagerAccount(earnManager);
//   const earnManagerState = await extEarn.account.earnManager.fetch(
//     earnManagerAccount
//   );

//   const snapshotBalance = balance ?? (await getTokenBalance(earnerATA));

//   // Setup the instruction
//   await prepClaimFor(
//     earnAuthority,
//     earner,
//     earnManager,
//     earnerState.recipientTokenAccount ?? earnerATA,
//     earnManagerState.feeTokenAccount
//   );

//   // Send the transaction
//   await extEarn.methods
//     .claimFor(snapshotBalance)
//     .accountsPartial({ ...accounts })
//     .signers([earnAuthority])
//     .rpc();
// };

// const prepConfigureEarnManager = async (
//   signer: Keypair,
//   earnManager: PublicKey,
//   feeTokenAccount?: PublicKey
// ) => {
//   // Get the global PDA
//   const globalAccount = getExtGlobalAccount();

//   // Get the earn manager PDA
//   const earnManagerAccount = getEarnManagerAccount(earnManager);

//   // Populate accounts
//   accounts = {};
//   accounts.signer = signer.publicKey;
//   accounts.globalAccount = globalAccount;
//   accounts.earnManagerAccount = earnManagerAccount;
//   if (feeTokenAccount) {
//     accounts.feeTokenAccount = feeTokenAccount;
//   } else {
//     accounts.feeTokenAccount = null;
//   }

//   return { globalAccount, earnManagerAccount };
// };

// const configureEarnManager = async (
//   earnManager: Keypair,
//   feeBps?: BN,
//   feeTokenAccount?: PublicKey
// ) => {
//   // Setup the instruction
//   prepConfigureEarnManager(earnManager, earnManager.publicKey, feeTokenAccount);

//   // Send the instruction
//   await extEarn.methods
//     .configureEarnManager(feeBps ?? null)
//     .accountsPartial({ ...accounts })
//     .signers([earnManager])
//     .rpc();
// };

// const prepAddEarner = (
//   signer: Keypair,
//   earnManager: PublicKey,
//   earnerATA: PublicKey
// ) => {
//   // Get the global PDA
//   const globalAccount = getExtGlobalAccount();

//   // Get the earn manager account
//   const earnManagerAccount = getEarnManagerAccount(earnManager);

//   // Get the earner account
//   const earnerAccount = getExtEarnerAccount(earnerATA);

//   // Populate accounts
//   accounts = {};
//   accounts.signer = signer.publicKey;
//   accounts.earnManagerAccount = earnManagerAccount;
//   accounts.globalAccount = globalAccount;
//   accounts.userTokenAccount = earnerATA;
//   accounts.earnerAccount = earnerAccount;
//   accounts.systemProgram = SystemProgram.programId;

//   return { globalAccount, earnManagerAccount, earnerAccount };
// };

// const addEarner = async (earnManager: Keypair, earner: PublicKey) => {
//   // Get the earner ATA
//   const earnerATA = await getATA(extMint.publicKey, earner);

//   // Setup the instruction
//   prepAddEarner(earnManager, earnManager.publicKey, earnerATA);

//   // Send the instruction
//   await extEarn.methods
//     .addEarner(earner)
//     .accountsPartial({ ...accounts })
//     .signers([earnManager])
//     .rpc();
// };

// const prepRemoveEarner = (
//   signer: Keypair,
//   earnManager: PublicKey,
//   earnerATA: PublicKey
// ) => {
//   // Get the earn manager account
//   const earnManagerAccount = getEarnManagerAccount(earnManager);

//   // Get the earner account
//   const earnerAccount = getExtEarnerAccount(earnerATA);

//   // Populate accounts
//   accounts = {};
//   accounts.signer = signer.publicKey;
//   accounts.userTokenAccount = earnerATA;
//   accounts.earnManagerAccount = earnManagerAccount;
//   accounts.earnerAccount = earnerAccount;

//   return { earnManagerAccount, earnerAccount };
// };

// const removeEarner = async (earnManager: Keypair, earner: PublicKey) => {
//   // Get the earner ATA
//   const earnerATA = await getATA(extMint.publicKey, earner);

//   // Setup the instruction
//   prepRemoveEarner(earnManager, earnManager.publicKey, earnerATA);

//   // Send the instruction
//   await extEarn.methods
//     .removeEarner()
//     .accountsPartial({ ...accounts })
//     .signers([earnManager])
//     .rpc();
// };

// const prepTransferEarner = (
//   signer: Keypair,
//   fromEarnManager: PublicKey,
//   toEarnManager: PublicKey,
//   earnerATA: PublicKey
// ) => {
//   // Cache the earner account
//   const earnerAccount = getExtEarnerAccount(earnerATA);

//   // Populate the accounts
//   accounts = {};
//   accounts.signer = signer.publicKey;
//   accounts.earnerAccount = earnerAccount;
//   accounts.fromEarnManagerAccount = getEarnManagerAccount(fromEarnManager);
//   accounts.toEarnManagerAccount = getEarnManagerAccount(toEarnManager);

//   return { earnerAccount };
// };

// const transferEarner = async (
//   fromEarnManager: Keypair,
//   toEarnManager: PublicKey,
//   earner: PublicKey
// ) => {
//   const earnerATA = await getATA(extMint.publicKey, earner);

//   // Setup the instruction
//   prepTransferEarner(
//     fromEarnManager,
//     fromEarnManager.publicKey,
//     toEarnManager,
//     earnerATA
//   );

//   // Send the instruction
//   await extEarn.methods
//     .transferEarner(toEarnManager)
//     .accountsPartial({ ...accounts })
//     .signers([fromEarnManager])
//     .rpc();
// };

// const prepSetRecipient = async (
//   signer: Keypair,
//   earner: PublicKey,
//   recipientTokenAccount: PublicKey | null
// ) => {
//   const earnerATA = await getATA(extMint.publicKey, earner);
//   const earnerAccount = getExtEarnerAccount(earnerATA);

//   // Populate accounts
//   accounts = {};
//   accounts.signer = signer.publicKey;
//   accounts.globalAccount = getExtGlobalAccount();
//   accounts.earnerAccount = earnerAccount;

//   if (recipientTokenAccount)
//     accounts.recipientTokenAccount = recipientTokenAccount;
//   else accounts.recipientTokenAccount = null;

//   return { earnerAccount };
// };

// const setRecipient = async (
//   earner: Keypair,
//   recipientTokenAccount: PublicKey | null
// ) => {
//   // Setup the instruction
//   const { earnerAccount } = await prepSetRecipient(
//     earner,
//     earner.publicKey,
//     recipientTokenAccount
//   );

//   // Send the instruction
//   await extEarn.methods
//     .setRecipient()
//     .accountsPartial({ ...accounts })
//     .signers([earner])
//     .rpc();

//   return { earnerAccount };
// };

// const prepWrap = async (
//   signer: Keypair,
//   fromMTokenAccount?: PublicKey,
//   toExtTokenAccount?: PublicKey,
//   vaultMTokenAccount?: PublicKey
// ) => {
//   // Get the M vault pda
//   const mVault = getMVault();

//   // Populate accounts
//   accounts = {};
//   accounts.tokenAuthority = signer.publicKey;
//   accounts.programAuthority = extEarn.programId;
//   accounts.mMint = mMint.publicKey;
//   accounts.extMint = extMint.publicKey;
//   accounts.globalAccount = getExtGlobalAccount();
//   accounts.mEarnGlobalAccount = extEarn.programId;
//   accounts.mVault = mVault;
//   accounts.extMintAuthority = getExtMintAuthority();
//   accounts.fromMTokenAccount =
//     fromMTokenAccount ?? (await getATA(mMint.publicKey, signer.publicKey));
//   accounts.toExtTokenAccount =
//     toExtTokenAccount ?? (await getATA(extMint.publicKey, signer.publicKey));
//   accounts.vaultMTokenAccount =
//     vaultMTokenAccount ?? (await getATA(mMint.publicKey, mVault));
//   accounts.token2022 = TOKEN_2022_PROGRAM_ID;

//   return {
//     vaultMTokenAccount: accounts.vaultMTokenAccount,
//     fromMTokenAccount: accounts.fromMTokenAccount,
//     toExtTokenAccount: accounts.toExtTokenAccount,
//   };
// };

// const wrap = async (user: Keypair, amount: BN) => {
//   // Setup the instruction
//   const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } =
//     await prepWrap(user);

//   // Send the instruction
//   await extEarn.methods
//     .wrap(amount)
//     .accountsPartial({ ...accounts })
//     .signers([user])
//     .rpc();

//   return { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount };
// };

// const prepUnwrap = async (
//   signer: Keypair,
//   toMTokenAccount?: PublicKey,
//   fromExtTokenAccount?: PublicKey,
//   vaultMTokenAccount?: PublicKey
// ) => {
//   // Get m vault pda
//   const mVault = getMVault();

//   // Populate accounts
//   accounts = {};
//   accounts.tokenAuthority = signer.publicKey;
//   accounts.programAuthority = extEarn.programId;
//   accounts.mMint = mMint.publicKey;
//   accounts.extMint = extMint.publicKey;
//   accounts.globalAccount = getExtGlobalAccount();
//   accounts.mEarnGlobalAccount = extEarn.programId;
//   accounts.mVault = mVault;
//   accounts.extMintAuthority = getExtMintAuthority();
//   accounts.toMTokenAccount =
//     toMTokenAccount ?? (await getATA(mMint.publicKey, signer.publicKey));
//   accounts.fromExtTokenAccount =
//     fromExtTokenAccount ?? (await getATA(extMint.publicKey, signer.publicKey));
//   accounts.vaultMTokenAccount =
//     vaultMTokenAccount ?? (await getATA(mMint.publicKey, mVault));
//   accounts.token2022 = TOKEN_2022_PROGRAM_ID;

//   return {
//     vaultMTokenAccount: accounts.vaultMTokenAccount,
//     toMTokenAccount: accounts.toMTokenAccount,
//     fromExtTokenAccount: accounts.fromExtTokenAccount,
//   };
// };

// const unwrap = async (user: Keypair, amount: BN) => {
//   // Setup the instruction
//   const { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount } =
//     await prepUnwrap(user);

//   // Send the instruction
//   await extEarn.methods
//     .unwrap(amount)
//     .accountsPartial({ ...accounts })
//     .signers([user])
//     .rpc();

//   return { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount };
// };

// const prepRemoveOrphanedEarner = (
//   signer: Keypair,
//   earnerATA: PublicKey,
//   earnManager: PublicKey
// ) => {
//   // Get the earner account
//   const earnerAccount = getExtEarnerAccount(earnerATA);

//   // Populate accounts
//   accounts = {};
//   accounts.signer = signer.publicKey;
//   accounts.globalAccount = getExtGlobalAccount();
//   accounts.earnerAccount = earnerAccount;

//   // Get the earn manager account
//   const earnManagerAccount = getEarnManagerAccount(earnManager);
//   accounts.earnManagerAccount = earnManagerAccount;
//   accounts.systemProgram = SystemProgram.programId;

//   return { earnerAccount, earnManagerAccount };
// };

// describe("ExtEarn unit tests", () => {
//   let currentTime: () => BN;

//   beforeEach(async () => {
//     // Initialize the SVM instance with all necessary configurations
//     svm = fromWorkspace("../")
//       .withSplPrograms() // Add SPL programs (including token programs)
//       .withBuiltins() // Add builtin programs
//       .withSysvars() // Setup standard sysvars
//       .withPrecompiles() // Add standard precompiles
//       .withBlockhashCheck(true); // Optional: disable blockhash checking for tests

//     // Create an anchor provider from the liteSVM instance
//     provider = new LiteSVMProvider(svm);

//     // Create program instances
//     earn = new Program<Earn>(EARN_IDL, provider);
//     extEarn = new Program<ExtEarn>(EXT_EARN_IDL, provider);
//     swapProgram = new Program<ExtSwap>(SWAP_IDL, provider);

//     svm.addProgramFromFile(swapProgram.programId, "programs/ext_swap.so");

//     // Fund the wallets
//     svm.airdrop(admin.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
//     svm.airdrop(portal.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
//     svm.airdrop(earnAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
//     svm.airdrop(nonAdmin.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
//     svm.airdrop(earnManagerOne.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
//     svm.airdrop(earnManagerTwo.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
//     svm.airdrop(nonEarnManagerOne.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

//     currentTime = () => {
//       return new BN(svm.getClock().unixTimestamp.toString());
//     };

//     // Create the M token mint
//     await createMintWithMultisig(mMint, mMintAuthority);

//     // Create the Ext token mint
//     await createMint(extMint, getExtMintAuthority());

//     // Mint some m tokens to have a non-zero supply
//     await mintM(admin.publicKey, initialSupply);

//     // Initialize the earn program
//     await initializeEarn(
//       mMint.publicKey,
//       earnAuthority.publicKey,
//       initialIndex,
//       claimCooldown
//     );

//     // Add the m vault as an M earner
//     const mVault = getMVault();
//     const earnerMerkleTree = new MerkleTree([admin.publicKey, mVault]);

//     // Propagate the merkle root
//     await propagateIndex(initialIndex, earnerMerkleTree.getRoot());

//     // Add the earner account for the vault
//     const { proof } = earnerMerkleTree.getInclusionProof(mVault);
//     await addRegistrarEarner(mVault, proof);
//   });

//   describe("admin instruction unit tests", () => {
//     describe("initialize unit tests", () => {
//       // test cases
//       // [X] given the m_mint is not owned by the token2022 program
//       //   [X] it reverts with a TokenProgram error
//       // [X] given the ext_mint is not owned by the token2022 program
//       //   [X] it reverts with a TokenProgram error
//       // [X] given the M earn global account does not match the PDA on the earn program
//       //   [X] it reverts with a SeedsConstraint error
//       // [X] given all accounts are correct
//       //   [X] the global account is created
//       //   [X] the admin is set to the signer
//       //   [X] the m_mint is set correctly
//       //   [X] the ext_mint is set correctly
//       //   [X] the m_earn_global_account is set correctly
//       //   [X] the earn authority is set correctly
//       //   [X] the initial index is set correctly
//       //   [X] the bumps are set correctly

//       // given the m_mint is not owned by the token2022 program
//       // it reverts with a TokenProgram error
//       test("m_mint not owned by token2022 - reverts", async () => {
//         // Create a mint owned by a different program
//         const wrongMint = new Keypair();
//         await createMint(wrongMint, nonAdmin.publicKey, false);

//         // Setup the instruction call
//         prepExtInitialize(nonAdmin);

//         // Change the M mint
//         accounts.mMint = wrongMint.publicKey;

//         // Attempt to send the transaction
//         await expectAnchorError(
//           extEarn.methods
//             .initialize(earnAuthority.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "ConstraintAddress"
//         );
//       });

//       // given the ext_mint is not owned by the token2022 program
//       // it reverts with a TokenProgram error
//       test("ext_mint not owned by token2022 - reverts", async () => {
//         // Create a mint owned by a different program
//         const wrongMint = new Keypair();
//         await createMint(wrongMint, nonAdmin.publicKey, false);

//         // Setup the instruction call
//         prepExtInitialize(nonAdmin);

//         // Change the Ext Mint
//         accounts.extMint = wrongMint.publicKey;

//         // Attempt to send the transaction
//         await expectAnchorError(
//           extEarn.methods
//             .initialize(earnAuthority.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "ConstraintMintTokenProgram"
//         );
//       });

//       // given the decimals on ext_mint do not match M
//       // it reverts with a MintDecimals error
//       test("ext_mint incorrect decimals - reverts", async () => {
//         // Create a mint owned by a different program
//         const badMint = new Keypair();
//         await createMint(badMint, nonAdmin.publicKey, true, 9);

//         // Setup the instruction call
//         prepExtInitialize(nonAdmin);

//         // Change the Ext Mint
//         accounts.extMint = badMint.publicKey;

//         // Attempt to send the transaction
//         await expectAnchorError(
//           extEarn.methods
//             .initialize(earnAuthority.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "ConstraintMintDecimals"
//         );
//       });

//       // given the M earn global account is invalid
//       // it reverts with a seeds constraint
//       test("m_earn_global_account is incorrect - reverts", async () => {
//         // Setup the instruction call
//         prepExtInitialize(nonAdmin);

//         // Change the m earn global account
//         accounts.mEarnGlobalAccount = PublicKey.unique();
//         if (accounts.mEarnGlobalAccount == getEarnGlobalAccount()) return;

//         // Attempt to send transaction
//         // Expect error (could be one of several "SeedsConstraint", "AccountOwnedByWrongProgram", "AccountNotInitialized")
//         await expectSystemError(
//           extEarn.methods
//             .initialize(earnAuthority.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc()
//         );
//       });

//       // given all the accounts are correct
//       // the global account is created and configured correctly
//       test("initialize - success", async () => {
//         // Setup the instruction call
//         const { globalAccount } = prepExtInitialize(admin);

//         // Create and send the transaction
//         await extEarn.methods
//           .initialize(earnAuthority.publicKey)
//           .accountsPartial({ ...accounts })
//           .signers([admin])
//           .rpc();

//         // Calculate the expected bumps
//         const [, globalBump] = PublicKey.findProgramAddressSync(
//           [Buffer.from("global")],
//           EXT_EARN_PROGRAM_ID
//         );
//         const [, mVaultBump] = PublicKey.findProgramAddressSync(
//           [Buffer.from("m_vault")],
//           EXT_EARN_PROGRAM_ID
//         );
//         const [, extMintAuthorityBump] = PublicKey.findProgramAddressSync(
//           [Buffer.from("mint_authority")],
//           EXT_EARN_PROGRAM_ID
//         );

//         await expectExtGlobalState(globalAccount, {
//           admin: admin.publicKey,
//           mMint: mMint.publicKey,
//           extMint: extMint.publicKey,
//           earnAuthority: earnAuthority.publicKey,
//           index: initialIndex,
//           timestamp: new BN(svm.getClock().unixTimestamp.toString()),
//           bump: globalBump,
//           mVaultBump,
//           extMintAuthorityBump,
//         });
//       });
//     });

//     describe("set_earn_authority unit tests", () => {
//       // test cases
//       //   [X] given the admin signs the transaction
//       //      [X] the earn authority is updated
//       //   [X] given a non-admin signs the transaction
//       //      [X] the transaction reverts with a not authorized error

//       beforeEach(async () => {
//         // Initialize the program
//         await initializeExt(earnAuthority.publicKey);
//       });

//       test("Admin can set new earn authority", async () => {
//         // Setup new earn authority
//         const newEarnAuthority = new Keypair();

//         // Setup the instruction
//         const { globalAccount } = prepSetEarnAuthority(admin);

//         // Send the transaction
//         await extEarn.methods
//           .setEarnAuthority(newEarnAuthority.publicKey)
//           .accountsPartial({ ...accounts })
//           .signers([admin])
//           .rpc();

//         // Verify the global state was updated
//         await expectExtGlobalState(globalAccount, {
//           earnAuthority: newEarnAuthority.publicKey,
//         });
//       });

//       test("Non-admin cannot set earn authority", async () => {
//         // Attempt to set new earn authority with non-admin
//         const newEarnAuthority = new Keypair();

//         prepSetEarnAuthority(nonAdmin);

//         await expectAnchorError(
//           extEarn.methods
//             .setEarnAuthority(newEarnAuthority.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "NotAuthorized"
//         );
//       });
//     });

//     describe("add_earn_manager unit tests", () => {
//       // test cases
//       // [X] given the admin doesn't sign the transaction
//       //   [X] it reverts with a NotAuthorized error
//       // [X] given the admin does sign the transaction
//       //   [X] given the fee token account is for the wrong mint
//       //     [X] it reverts with a ConstraintTokenMint error
//       //   [X] given the fee is higher than 100%
//       //     [X] it reverts with an InvalidParam error
//       //   [X] given all the accounts and inputs are correct
//       //     [X] it initializes an EarnManager account with
//       //       [X] the earn manager key
//       //       [X] is_active flag set to true
//       //       [X] fee_bps that was input
//       //       [X] fee_token_account that was provided
//       //       [X] the account's bump
//       //   [X] given the account already exists
//       //     [X] it sets the account data again

//       beforeEach(async () => {
//         // Initialize the program
//         await initializeExt(earnAuthority.publicKey);
//       });

//       // given the admin does not sign the transaction
//       // it reverts with a NotAuthorized error
//       test("admin does not sign transaction - reverts", async () => {
//         // Setup the instruction with a non-admin signer
//         await prepAddEarnManager(nonAdmin, earnManagerOne.publicKey);

//         // Attempt to send the transaction
//         // expect a NotAuthorized error
//         await expectAnchorError(
//           extEarn.methods
//             .addEarnManager(earnManagerOne.publicKey, new BN(0))
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "NotAuthorized"
//         );
//       });

//       // given the admin does sign the transaction
//       // given the fee token account is for the wrong mint
//       // it reverts with a ConstraintTokenMint error
//       test("fee_token_account is for the wrong mint - reverts", async () => {
//         // Create an ATA for the wrong mint
//         const earnManagerMATA = await getATA(
//           mMint.publicKey,
//           earnManagerOne.publicKey
//         );

//         // Setup the instruction
//         await prepAddEarnManager(
//           admin,
//           earnManagerOne.publicKey,
//           earnManagerMATA
//         );

//         // Attempt to send the transaction
//         // expect a ConstraintTokenMint error
//         await expectAnchorError(
//           extEarn.methods
//             .addEarnManager(earnManagerOne.publicKey, new BN(0))
//             .accountsPartial({ ...accounts })
//             .signers([admin])
//             .rpc(),
//           "ConstraintTokenMint"
//         );
//       });

//       // given the admin does sign the transaction
//       // given the fee is higher than 100% (in basis points)
//       // it reverts with an InvalidParam error
//       test("fee higher than 100% - reverts", async () => {
//         // Setup the instruction
//         await prepAddEarnManager(admin, earnManagerOne.publicKey);

//         const feeBps = new BN(randomInt(10001, 2 ** 48 - 1));

//         // Attempt to send the instruction
//         await expectAnchorError(
//           extEarn.methods
//             .addEarnManager(earnManagerOne.publicKey, feeBps)
//             .accountsPartial({ ...accounts })
//             .signers([admin])
//             .rpc(),
//           "InvalidParam"
//         );
//       });

//       // given the admin does sign the transaction
//       // given all the accounts are correct
//       // it initializes the earn manager account and sets its data
//       test("add_earn_manager - success", async () => {
//         // Setup the instruction
//         const { earnManagerAccount } = await prepAddEarnManager(
//           admin,
//           earnManagerOne.publicKey
//         );

//         const feeBps = new BN(randomInt(0, 10000));

//         // Send the transaction
//         await extEarn.methods
//           .addEarnManager(earnManagerOne.publicKey, feeBps)
//           .accountsPartial({ ...accounts })
//           .signers([admin])
//           .rpc();

//         const [, bump] = PublicKey.findProgramAddressSync(
//           [Buffer.from("earn_manager"), earnManagerOne.publicKey.toBuffer()],
//           EXT_EARN_PROGRAM_ID
//         );

//         // Check that the state has been updated
//         expectEarnManagerState(earnManagerAccount, {
//           earnManager: earnManagerOne.publicKey,
//           isActive: true,
//           feeBps,
//           feeTokenAccount: accounts.feeTokenAccount,
//           bump,
//         });
//       });

//       // given admin does sign the transaction
//       // given the account already exists
//       // it sets the data again
//       test("add_earn_manager again - success", async () => {
//         // Add earn manager initially
//         await addEarnManager(earnManagerOne.publicKey, new BN(0));

//         // Add the earn manager again with a new fee and fee token account
//         const newFeeTokenAccount = await getATA(
//           extMint.publicKey,
//           earnManagerTwo.publicKey
//         );
//         const feeBps = new BN(10);
//         const { earnManagerAccount } = await addEarnManager(
//           earnManagerOne.publicKey,
//           feeBps
//         );

//         expectEarnManagerState(earnManagerAccount, {
//           earnManager: earnManagerOne.publicKey,
//           isActive: true,
//           feeBps,
//           feeTokenAccount: accounts.feeTokenAccount,
//         });
//       });
//     });

//     describe("remove_earn_manager unit tests", () => {
//       // test cases
//       // [X] given the admin does not sign the transaction
//       //   [X] it reverts with a NotAuthorized error
//       // [X] given the admin does sign the transaction
//       //   [X] it sets the is_active flag on the earn manager account to false

//       beforeEach(async () => {
//         // Initialize the program
//         await initializeExt(earnAuthority.publicKey);

//         // Add an earn manager that can be removed
//         await addEarnManager(earnManagerOne.publicKey, new BN(0));
//       });

//       // given the admin does not sign the transaction
//       // it reverts with a NotAuthorized error
//       test("admin does not sign the transaction - reverts", async () => {
//         // Setup the instruction
//         await prepRemoveEarnManager(nonAdmin, earnManagerOne.publicKey);

//         // Attempt to send the transaction
//         // Expect a NotAuthorized error
//         await expectAnchorError(
//           extEarn.methods
//             .removeEarnManager()
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "NotAuthorized"
//         );
//       });

//       // given the admin does sign the transaction
//       // given the earn manager account is not initialized
//       // it reverts with an AccountNotInitialized error
//       test("earn_manager_account not initialized - reverts", async () => {
//         // Setup the instruction
//         await prepRemoveEarnManager(admin, earnManagerTwo.publicKey);

//         // Attempt to send the transaction
//         // Expect an AccountNotInitialized error
//         await expectAnchorError(
//           extEarn.methods
//             .removeEarnManager()
//             .accountsPartial({ ...accounts })
//             .signers([admin])
//             .rpc(),
//           "AccountNotInitialized"
//         );
//       });

//       // given the admin does sign the transaction
//       // it sets the is_active flag on the earn manager account to false
//       test("remove_earn_manager - success", async () => {
//         // Setup the instruction
//         const { earnManagerAccount } = prepRemoveEarnManager(
//           admin,
//           earnManagerOne.publicKey
//         );

//         // Confirm that the account is currently active
//         expectEarnManagerState(earnManagerAccount, {
//           isActive: true,
//         });

//         // Send the instruction
//         await extEarn.methods
//           .removeEarnManager()
//           .accountsPartial({ ...accounts })
//           .signers([admin])
//           .rpc();

//         // Confirm the account is not active
//         expectEarnManagerState(earnManagerAccount, {
//           isActive: false,
//         });
//       });
//     });

//     describe("add_wrap_authority tests", () => {
//       const randomWrapAuthority = new Keypair().publicKey;

//       beforeEach(async () => {
//         await initializeExt(earnAuthority.publicKey);
//       });

//       test("whitelist - success", async () => {
//         await extEarn.methods
//           .addWrapAuthority(randomWrapAuthority)
//           .accounts({ admin: admin.publicKey })
//           .signers([admin])
//           .rpc();

//         const global = await extEarn.account.extGlobal.fetch(
//           getExtGlobalAccount()
//         );
//         expect(
//           global.wrapAuthorities[global.wrapAuthorities.length - 1].toBase58()
//         ).toBe(randomWrapAuthority.toBase58());
//       });

//       test("whitelisted item does not exist - revert", async () => {
//         await expectAnchorError(
//           extEarn.methods
//             .removeWrapAuthority(randomWrapAuthority)
//             .accounts({ admin: admin.publicKey })
//             .signers([admin])
//             .rpc(),
//           "InvalidParam"
//         );
//       });

//       test("remove whitelisted item - success", async () => {
//         await extEarn.methods
//           .addWrapAuthority(randomWrapAuthority)
//           .accounts({ admin: admin.publicKey })
//           .signers([admin])
//           .rpc();

//         await extEarn.methods
//           .removeWrapAuthority(randomWrapAuthority)
//           .accounts({ admin: admin.publicKey })
//           .signers([admin])
//           .rpc();

//         const global = await extEarn.account.extGlobal.fetch(
//           getExtGlobalAccount()
//         );
//         expect(
//           global.wrapAuthorities[global.wrapAuthorities.length - 1].toBase58()
//         ).not.toBe(randomWrapAuthority.toBase58());
//       });

//       test("whitelist from previous config layout - success", async () => {
//         const randomWrapAuthority = new Keypair().publicKey;

//         // Global account from devent without whitelisted authorities support
//         const data = Buffer.from(
//           "nT0aSBDxU4yz3HtcE1xihhozJWJpdvNsPnG5FAKFUFeJ7wZJIrxP9iO8K5T0ASjYhJ0tk6FGBzNvB/wA8HJXQK2ngVbIwAUqC4a+ZrwfmLR9IKO+YVpJBagluCaGTioPTJSEZ9M+5wkLhr5mv860wdfpJ7zE0BS+Dyhjq534X9phCFG2Tb0K5eRoMAbaMvJBTyQcLMmsnaDkH0FwZa+QwkrYCQghj/MV7VA90usAAAARsjxoAAAAAP/+/A==",
//           "base64"
//         );

//         // Set admin (first 32 bytes after discriminator)
//         admin.publicKey.toBuffer().copy(data, 8);

//         svm.setAccount(getExtGlobalAccount(), {
//           executable: false,
//           owner: extEarn.programId,
//           lamports: 2192400,
//           data,
//         });

//         // Account should fail to parse
//         await expectAnchorError(
//           extEarn.methods
//             .removeWrapAuthority(new Keypair().publicKey)
//             .accounts({ admin: admin.publicKey })
//             .signers([admin])
//             .rpc(),
//           "AccountDidNotDeserialize"
//         );

//         // Add authority and fix account layout
//         await extEarn.methods
//           .addWrapAuthority(randomWrapAuthority)
//           .accounts({ admin: admin.publicKey })
//           .signers([admin])
//           .rpc();

//         let global = await extEarn.account.extGlobal.fetch(
//           getExtGlobalAccount()
//         );
//         expect(
//           global.wrapAuthorities[global.wrapAuthorities.length - 1].toBase58()
//         ).toBe(randomWrapAuthority.toBase58());

//         // Can now call removeWrapAuthority
//         await extEarn.methods
//           .removeWrapAuthority(randomWrapAuthority)
//           .accounts({ admin: admin.publicKey })
//           .signers([admin])
//           .rpc();

//         global = await extEarn.account.extGlobal.fetch(getExtGlobalAccount());
//         expect(global.wrapAuthorities.length).toBe(0);
//       });
//     });
//   });

//   describe("earn_authority instruction tests", () => {
//     const newIndex = new BN(1_100_000_000_000); // 1.1
//     let startTime: BN;
//     const mintAmount = new BN(100_000_000);

//     beforeEach(async () => {
//       // Initialize the program
//       await initializeExt(earnAuthority.publicKey);

//       // Add an earn manager to create earner accounts
//       // Set the fee to zero initially
//       await addEarnManager(earnManagerOne.publicKey, new BN(0));

//       // Mint M tokens to the earners and then wrap it to Ext tokens
//       await mintM(earnerOne.publicKey, mintAmount);
//       await mintM(earnerTwo.publicKey, mintAmount);

//       // Propagate the initial index again to update the max M supply during the interval so max yield is sufficient
//       // Under normal operation, this happens on any bridge transaction and when yield is distributed
//       // However, we are minting tokens here for testing so it is not reflected, therefore, we have to pretend this is a bridge.
//       await propagateIndex(initialIndex);

//       // Add earner one as an ext earner so there is outstanding yield once it is synced
//       await addEarner(earnManagerOne, earnerOne.publicKey);

//       // Wrap the M tokens to Ext tokens to deposit them in the M vault
//       await wrap(earnerOne, mintAmount);
//       await wrap(earnerTwo, mintAmount);

//       startTime = currentTime();

//       // Warp time forward an hour
//       warp(new BN(3600), true);

//       // Update the index on the Earn program to start a claim cycle
//       await propagateIndex(newIndex);
//     });

//     describe("sync unit tests", () => {
//       // test cases
//       // [X] given the earn authority does not sign the transaction
//       //   [X] it reverts with a NotAuthorized error
//       // [X] given the earn authority does sign the transaction
//       //   [X] given the m_earn_global_account does not match the stored key
//       //     [X] it reverts with an InvalidAccount error
//       //   [X] given all accounts are correct
//       //     [X] it updates the ExtGlobal index and timestamp to the current index and timestamp on the M Earn Global account

//       // given the earn authority does not sign the transaction
//       // it reverts with a NotAuthorized error
//       test("earn_authority does not sign - reverts", async () => {
//         // Setup the instruction
//         prepSync(nonAdmin);

//         // Attempt to send the transaction
//         // Expect it to revert with a NotAuthorized error
//         await expectAnchorError(
//           extEarn.methods
//             .sync()
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "NotAuthorized"
//         );
//       });

//       // given the earn authority does sign the transaction
//       // given the m_earn_global_account does not match the stored key
//       // it reverts with a variety of errors (AccountNotInitialized, AccountOwnedByWrongProgram, InvalidAccount)
//       test("m_earn_global_account is invalid - reverts", async () => {
//         // Setup the instruction
//         prepSync(earnAuthority);

//         // Use an incorrect account
//         const wrongAccount = PublicKey.unique();
//         if (accounts.mEarnGlobalAccount == wrongAccount) return;
//         accounts.mEarnGlobalAccount = wrongAccount;

//         // Attempt to send the transaction
//         // Expect it to revert with an error
//         await expectSystemError(
//           extEarn.methods
//             .sync()
//             .accountsPartial({ ...accounts })
//             .signers([earnAuthority])
//             .rpc()
//         );
//       });

//       // given the earn authority does sign the transaction
//       // given all the accounts are correct
//       // it updates the index and timestamp of the ExtGlobal account
//       test("sync - success", async () => {
//         // Setup the instruction
//         const { globalAccount } = prepSync(earnAuthority);

//         // Confirm the state of the ExtGlobal account before the sync
//         await expectExtGlobalState(globalAccount, {
//           index: initialIndex,
//           timestamp: startTime,
//         });

//         // Confirm the state of the EarnGlobal account before the sync
//         await expectEarnGlobalState(getEarnGlobalAccount(), {
//           index: newIndex,
//           timestamp: currentTime(),
//         });

//         // Send the transaction
//         await extEarn.methods
//           .sync()
//           .accountsPartial({ ...accounts })
//           .signers([earnAuthority])
//           .rpc();

//         // Expect the ExtGlobal state to be updated
//         await expectExtGlobalState(globalAccount, {
//           index: newIndex,
//           timestamp: currentTime(),
//         });
//       });
//     });

//     describe("claim_for unit tests", () => {
//       // test cases
//       // [X] given the earn authority does not sign the transaction
//       //   [X] it reverts with a NotAuthorized error
//       // [X] given the earn authority does sign the transaction
//       //   [X] given the wrong ext_mint account is provided
//       //     [X] it reverts with an error (could be various depending on the account)
//       //   [X] given the wrong earn manager account is provided for an earner
//       //     [X] it reverts with a ConstraintSeeds error
//       //   [X] given the wrong token account is provided for the M vault
//       //     [X] it reverts with a ConstraintAssociated error
//       //   [X] given the earn manager token account does not match the token account stored on the earn manager account
//       //     [X] it reverts with an InvalidAccount error
//       //   [X] given the earner does not have a recipient token account defined
//       //     [X] given the user token account does not match the one defined on the earner account
//       //       [X] it reverts with an InvalidAccount error
//       //     [X] given the user token account matches the one defined on the earner account
//       //       [X] it mints yield to the user token account
//       //   [X] given the earner does have a recipient token account defined
//       //     [X] given the user token account does not match the recipient token account
//       //       [X] it reverts with an InvalidAccount error
//       //     [X] given the user token account matches the recipient token account
//       //       [X] it mints yield to the recipient token account
//       //   [X] given the accounts are all correct
//       //     [X] given the earner's last claim index is greater than or equal to the current global index
//       //       [X] it reverts with an AlreadyClaimed error
//       //     [X] given the M vault does not have enough M to mint the rewards against
//       //        (e.g. the yield for the vault hasn't been claimed yet or the provided balance is too high)
//       //       [X] it reverts with an InsufficientCollateral error
//       //     [X] given the earn manager has zero fee
//       //       [X] it mints all of the rewards to the earner's token account
//       //     [X] given the earn manager is not active and has a non-zero fee
//       //       [X] it mints all of the rewards to the earner's token account
//       //     [X] given the earn manager is active and has a non-zero fee
//       //       [ ] given the earn manager's fee token account is closed
//       //         [X] it mints all of the rewards to the earner's token account
//       //       [X] given the fee on the current yield rounds to zero
//       //         [X] it mints all of the rewards to the earner's token account
//       //       [X] given the fee does not round to zero
//       //         [X] it mints the fee to the earn manager's token account and the remaining rewards
//       //             to the earner's token account

//       beforeEach(async () => {
//         // Push the M yield to the M vault ATA
//         await mClaimFor(getMVault());

//         // Sync the latest index from the M earn program to have yield to claim
//         await sync();

//         // Add earner two as an earner after the sync so it does not have any yield to claim
//         await addEarner(earnManagerOne, earnerTwo.publicKey);
//       });

//       // given the earn authority does not sign the transaction
//       // it reverts with a NotAuthorized error
//       test("Earn authority does not sign the transaction - reverts", async () => {
//         // Setup the instruction to claim for earner one
//         await prepClaimFor(
//           nonAdmin,
//           earnerOne.publicKey,
//           earnManagerOne.publicKey
//         );

//         const balance = await getTokenBalance(
//           await getATA(extMint.publicKey, earnerOne.publicKey)
//         );

//         // Attempt to send the transaction
//         // Expect a NotAuthorized error
//         await expectAnchorError(
//           extEarn.methods
//             .claimFor(balance)
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "NotAuthorized"
//         );
//       });

//       // given the wrong ext mint account is provided
//       // it reverts with a InvalidAccount error
//       test("Ext mint account is invalid - reverts", async () => {
//         // Setup the instruction
//         await prepClaimFor(
//           earnAuthority,
//           earnerOne.publicKey,
//           earnManagerOne.publicKey
//         );

//         // Change the mint account
//         accounts.extMint = mMint.publicKey;

//         // Attempt to send the transaction
//         // Expect revert
//         await expectAnchorError(
//           extEarn.methods
//             .claimFor(
//               await getTokenBalance(
//                 await getATA(extMint.publicKey, earnerOne.publicKey)
//               )
//             )
//             .accountsPartial({ ...accounts })
//             .signers([earnAuthority])
//             .rpc(),
//           "InvalidAccount"
//         );
//       });

//       // given the wrong earn manager account is provided for an earner
//       // it reverts with a ConstraintSeeds error
//       test("Earn manager account is invalid - reverts", async () => {
//         // Add another earn manager
//         await addEarnManager(earnManagerTwo.publicKey, new BN(0));

//         // Setup the instruction
//         await prepClaimFor(
//           earnAuthority,
//           earnerOne.publicKey,
//           earnManagerTwo.publicKey
//         );

//         // Attempt send the transaction
//         // Expect revert
//         await expectAnchorError(
//           extEarn.methods
//             .claimFor(
//               await getTokenBalance(
//                 await getATA(extMint.publicKey, earnerOne.publicKey)
//               )
//             )
//             .accountsPartial({ ...accounts })
//             .signers([earnAuthority])
//             .rpc(),
//           "ConstraintSeeds"
//         );
//       });

//       // given the M vault token account is not the M vault's ATA
//       // it reverts with a ConstraintAssociated error
//       test("M Vault token account is invalid - reverts", async () => {
//         // Setup the instruction
//         await prepClaimFor(
//           earnAuthority,
//           earnerOne.publicKey,
//           earnManagerOne.publicKey
//         );

//         // Create a non-ATA token account for the M vault
//         const { tokenAccount: invalidMVaultTokenAccount } =
//           await createTokenAccount(mMint.publicKey, getMVault());

//         // Replace the M vault token account with the invalid one
//         accounts.vaultMTokenAccount = invalidMVaultTokenAccount;

//         // Attempt to send the transaction
//         // Expect revert with a ConstraintAssociated error
//         await expectAnchorError(
//           extEarn.methods
//             .claimFor(
//               await getTokenBalance(
//                 await getATA(extMint.publicKey, earnerOne.publicKey)
//               )
//             )
//             .accountsPartial({ ...accounts })
//             .signers([earnAuthority])
//             .rpc(),
//           "ConstraintAssociated"
//         );
//       });

//       // given the earn manager token account does not match token account stored on the earn manager account
//       // it reverts with an InvalidAccount error
//       test("Earn manager token account is invalid - reverts", async () => {
//         // Create a new token account for the earn manager that doesn't match the one stored
//         const { tokenAccount: invalidEarnManagerTokenAccount } =
//           await createTokenAccount(extMint.publicKey, earnManagerOne.publicKey);

//         // Setup the instruction
//         await prepClaimFor(
//           earnAuthority,
//           earnerOne.publicKey,
//           earnManagerOne.publicKey,
//           undefined,
//           invalidEarnManagerTokenAccount
//         );

//         // Attempt to send the transaction
//         // Expect revert with an InvalidAccount error
//         await expectAnchorError(
//           extEarn.methods
//             .claimFor(
//               await getTokenBalance(
//                 await getATA(extMint.publicKey, earnerOne.publicKey)
//               )
//             )
//             .accountsPartial({ ...accounts })
//             .signers([earnAuthority])
//             .rpc(),
//           "InvalidAccount"
//         );
//       });

//       // given the earner does not have a recipient token account defined
//       // given the user token account does not match the user token account on the earner account
//       // it reverts with an InvalidAccount error
//       test("Earner has no recipient account, token account doesn't match - reverts", async () => {
//         // Create a new token account for the earner that doesn't match the one stored
//         const { tokenAccount: invalidUserTokenAccount } =
//           await createTokenAccount(extMint.publicKey, earnerOne.publicKey);

//         // Setup the instruction with the invalid user token account
//         await prepClaimFor(
//           earnAuthority,
//           earnerOne.publicKey,
//           earnManagerOne.publicKey,
//           invalidUserTokenAccount
//         );

//         // Attempt to send the transaction
//         // Expect revert with an InvalidAccount error
//         await expectAnchorError(
//           extEarn.methods
//             .claimFor(await getTokenBalance(invalidUserTokenAccount))
//             .accountsPartial({ ...accounts })
//             .signers([earnAuthority])
//             .rpc(),
//           "InvalidAccount"
//         );
//       });

//       // given the earner does not have a recipient token account defined
//       // given the user token account matches
//       // it mints the yield to the user token account
//       test("Earner has no recipient account, token account matches - success", async () => {
//         // Setup the instruction
//         const { earnerAccount } = await prepClaimFor(
//           earnAuthority,
//           earnerOne.publicKey,
//           earnManagerOne.publicKey
//         );
//         const earnerATA = await getATA(extMint.publicKey, earnerOne.publicKey);

//         // Check that the last claim index and the last claim timestamp are the initial values
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: initialIndex,
//           lastClaimTimestamp: startTime,
//         });

//         // Get the initial balance for the earner ata
//         const initialBalance = await getTokenBalance(earnerATA);

//         // Calculate the expected new balance
//         // Note: earn manager fee is 0, so it all goes to the earner
//         const expectedBalance = initialBalance.mul(newIndex).div(initialIndex);

//         // Send the instruction
//         await extEarn.methods
//           .claimFor(initialBalance)
//           .accountsPartial({ ...accounts })
//           .signers([earnAuthority])
//           .rpc();

//         // Check the new balance matches the expected balance
//         await expectTokenBalance(earnerATA, expectedBalance);

//         // Check the earner account is updated
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: newIndex,
//           lastClaimTimestamp: currentTime(),
//         });
//       });

//       test("Earner has recipient account, token account does not match - reverts", async () => {
//         // Set the earner's recipient account to the yield recipients ATA
//         const yieldRecipientATA = await getATA(
//           extMint.publicKey,
//           yieldRecipient.publicKey
//         );
//         await setRecipient(earnerOne, yieldRecipientATA);

//         // Setup the instruction with the earner's ATA as the user token account
//         const earnerATA = await getATA(extMint.publicKey, earnerOne.publicKey);
//         await prepClaimFor(
//           earnAuthority,
//           earnerOne.publicKey,
//           earnManagerOne.publicKey,
//           earnerATA
//         );

//         // Attempt to send the transaction
//         // Expect revert with an InvalidAccount error
//         await expectAnchorError(
//           extEarn.methods
//             .claimFor(await getTokenBalance(earnerATA))
//             .accountsPartial({ ...accounts })
//             .signers([earnAuthority])
//             .rpc(),
//           "InvalidAccount"
//         );
//       });

//       test("Earner has recipient account, token account matches - success", async () => {
//         // Set the earner's recipient account to the yield recipients ATA
//         const yieldRecipientATA = await getATA(
//           extMint.publicKey,
//           yieldRecipient.publicKey
//         );
//         await setRecipient(earnerOne, yieldRecipientATA);

//         // Setup the instruction
//         const { earnerAccount } = await prepClaimFor(
//           earnAuthority,
//           earnerOne.publicKey,
//           earnManagerOne.publicKey,
//           yieldRecipientATA
//         );
//         const earnerATA = await getATA(extMint.publicKey, earnerOne.publicKey);

//         // Check that the last claim index and the last claim timestamp are the initial values
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: initialIndex,
//           lastClaimTimestamp: startTime,
//         });

//         // Get the initial balance for the earner ata
//         const initialBalance = await getTokenBalance(earnerATA);

//         // Calculate the expected yield
//         // Note: earn manager fee is 0, so it all goes to the yield recipient
//         const expectedYield = initialBalance
//           .mul(newIndex)
//           .div(initialIndex)
//           .sub(initialBalance);

//         // Send the instruction
//         await extEarn.methods
//           .claimFor(initialBalance)
//           .accountsPartial({ ...accounts })
//           .signers([earnAuthority])
//           .rpc();

//         // Check the ata balance didn't change but the yield recipient received the yield
//         await expectTokenBalance(earnerATA, initialBalance);
//         await expectTokenBalance(yieldRecipientATA, expectedYield);

//         // Check the earner account is updated
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: newIndex,
//           lastClaimTimestamp: currentTime(),
//         });
//       });

//       // given all accounts are correct
//       // given the earner's yield has been claimed up to the current index
//       // it reverts with an AlreadyClaimed error
//       test("Earner yield already claimed up to current index - reverts", async () => {
//         // Setup the instruction to claim for earner two
//         // earnerTwo was added after the sync, so its lastClaimIndex should equal the current index
//         const { earnerAccount } = await prepClaimFor(
//           earnAuthority,
//           earnerTwo.publicKey,
//           earnManagerOne.publicKey
//         );
//         const balance = await getTokenBalance(
//           await getATA(extMint.publicKey, earnerTwo.publicKey)
//         );

//         // Verify that the earner's last claim index is equal to the current global index
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: newIndex,
//           lastClaimTimestamp: currentTime(),
//         });

//         // Attempt to send the transaction
//         // Expect an AlreadyClaimed error
//         await expectAnchorError(
//           extEarn.methods
//             .claimFor(balance)
//             .accountsPartial({ ...accounts })
//             .signers([earnAuthority])
//             .rpc(),
//           "AlreadyClaimed"
//         );
//       });

//       // given all the accounts are correct
//       // given the M vault doesn't have enough M collateral to mint the yield against
//       // it reverts with an InsufficientCollateral error
//       test("Insufficient M collateral to mint yield - reverts", async () => {
//         // Setup the instruction to claim for earner one
//         const { earnerAccount } = await prepClaimFor(
//           earnAuthority,
//           earnerOne.publicKey,
//           earnManagerOne.publicKey
//         );

//         // Get the actual balance of the earner's token account
//         const actualBalance = await getTokenBalance(
//           await getATA(extMint.publicKey, earnerOne.publicKey)
//         );

//         // Use a balance 4x greater than the actual balance to try and mint more ext tokens than M available
//         const inflatedBalance = actualBalance.mul(new BN(4));

//         // Attempt to send the transaction with the inflated balance
//         // Expect an InsufficientCollateral error
//         await expectAnchorError(
//           extEarn.methods
//             .claimFor(inflatedBalance)
//             .accountsPartial({ ...accounts })
//             .signers([earnAuthority])
//             .rpc(),
//           "InsufficientCollateral"
//         );
//       });

//       // given all the accounts are correct
//       // given the earn manager has zero fee
//       // it mints all the yield to the earner's recipient account
//       test("Earn manager fee is zero - success", async () => {
//         // Setup the instruction to claim for earner one
//         const { earnerAccount, userTokenAccount, earnManagerTokenAccount } =
//           await prepClaimFor(
//             earnAuthority,
//             earnerOne.publicKey,
//             earnManagerOne.publicKey
//           );

//         // Get the current balance of the earner's token account
//         const earnerStartBalance = await getTokenBalance(userTokenAccount);

//         // Get the current balance of the earn manager's token account
//         const earnManagerStartBalance = await getTokenBalance(
//           earnManagerTokenAccount
//         );

//         // Confirm the earn manager fee is zero
//         await expectEarnManagerState(
//           getEarnManagerAccount(earnManagerOne.publicKey),
//           {
//             feeBps: new BN(0),
//           }
//         );

//         // Confirm the starting earner account state
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: initialIndex,
//           lastClaimTimestamp: startTime,
//         });

//         // Send the transaction
//         await extEarn.methods
//           .claimFor(earnerStartBalance)
//           .accountsPartial({ ...accounts })
//           .signers([earnAuthority])
//           .rpc();

//         // Calculate expected rewards (balance * (global_index / last_claim_index) - balance)
//         const expectedRewards = earnerStartBalance
//           .mul(newIndex)
//           .div(initialIndex)
//           .sub(earnerStartBalance);

//         // Verify the expected token balance changes
//         await expectTokenBalance(
//           userTokenAccount,
//           earnerStartBalance.add(expectedRewards)
//         );
//         await expectTokenBalance(
//           earnManagerTokenAccount,
//           earnManagerStartBalance
//         );

//         // Verify the earner account was updated with the new claim index and claim timestamp
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: newIndex,
//           lastClaimTimestamp: currentTime(),
//         });
//       });

//       // given all the accounts are correct
//       // given the earn manager fee is not zero and earn manager is not active
//       // it mints all the yield to the earner's recipient account
//       test("Earn manager fee is non-zero, earn manager inactive - success", async () => {
//         // Set the earn manager fee to a non-zero value
//         await configureEarnManager(earnManagerOne, new BN(1000));

//         // Remove the earn manager
//         await removeEarnManager(earnManagerOne.publicKey);

//         // Setup the instruction to claim for earner one
//         const { earnerAccount, userTokenAccount, earnManagerTokenAccount } =
//           await prepClaimFor(
//             earnAuthority,
//             earnerOne.publicKey,
//             earnManagerOne.publicKey
//           );

//         // Get the current balance of the earner's token account
//         const earnerStartBalance = await getTokenBalance(userTokenAccount);

//         // Get the current balance of the earn manager's token account
//         const earnManagerStartBalance = await getTokenBalance(
//           earnManagerTokenAccount
//         );

//         // Confirm the earn manager fee is non-zero and inactive
//         await expectEarnManagerState(
//           getEarnManagerAccount(earnManagerOne.publicKey),
//           {
//             feeBps: new BN(1000),
//             isActive: false,
//           }
//         );

//         // Confirm the starting earner account state
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: initialIndex,
//           lastClaimTimestamp: startTime,
//         });

//         // Send the transaction
//         await extEarn.methods
//           .claimFor(earnerStartBalance)
//           .accountsPartial({ ...accounts })
//           .signers([earnAuthority])
//           .rpc();

//         // Calculate expected rewards (balance * (global_index / last_claim_index) - balance)
//         const expectedRewards = earnerStartBalance
//           .mul(newIndex)
//           .div(initialIndex)
//           .sub(earnerStartBalance);

//         // Verify the expected token balance changes
//         await expectTokenBalance(
//           userTokenAccount,
//           earnerStartBalance.add(expectedRewards)
//         );
//         await expectTokenBalance(
//           earnManagerTokenAccount,
//           earnManagerStartBalance
//         );

//         // Verify the earner account was updated with the new claim index and claim timestamp
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: newIndex,
//           lastClaimTimestamp: currentTime(),
//         });
//       });

//       // given all the accounts are correct
//       // given the earn manager fee is not zero and earn manager is active
//       // given the earn manager token account is closed
//       // it mints all the yield to the earner's recipient account
//       test("Earn manager fee is non-zero, earn manager active, earn manager token account closed - success", async () => {
//         // Set the earn manager fee to a non-zero value
//         await configureEarnManager(earnManagerOne, new BN(1000));

//         // Setup the instruction to claim for earner one
//         const { earnerAccount, userTokenAccount, earnManagerTokenAccount } =
//           await prepClaimFor(
//             earnAuthority,
//             earnerOne.publicKey,
//             earnManagerOne.publicKey
//           );

//         // Close the earn manager token account
//         await closeTokenAccount(earnManagerOne, earnManagerTokenAccount);

//         // Get the current balance of the earner's token account
//         const earnerStartBalance = await getTokenBalance(userTokenAccount);

//         // Confirm the earn manager fee is non-zero and inactive
//         await expectEarnManagerState(
//           getEarnManagerAccount(earnManagerOne.publicKey),
//           {
//             feeBps: new BN(1000),
//             isActive: true,
//           }
//         );

//         // Confirm the starting earner account state
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: initialIndex,
//           lastClaimTimestamp: startTime,
//         });

//         // Send the transaction
//         await extEarn.methods
//           .claimFor(earnerStartBalance)
//           .accountsPartial({ ...accounts })
//           .signers([earnAuthority])
//           .rpc();

//         // Calculate expected rewards (balance * (global_index / last_claim_index) - balance)
//         const expectedRewards = earnerStartBalance
//           .mul(newIndex)
//           .div(initialIndex)
//           .sub(earnerStartBalance);

//         // Verify the expected token balance changes
//         await expectTokenBalance(
//           userTokenAccount,
//           earnerStartBalance.add(expectedRewards)
//         );

//         // Verify the earner account was updated with the new claim index and claim timestamp
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: newIndex,
//           lastClaimTimestamp: currentTime(),
//         });
//       });

//       // given all the accounts are correct
//       // given the earn manager fee is not zero and earn manager is active
//       // given the fee amount rounds to zero
//       // it mints all the yield to the earner's recipient account
//       test("Earn manager fee is non-zero, earn manager active, fee amount rounds to zero - success", async () => {
//         // Set a very small fee (1 bps = 0.01%)
//         await configureEarnManager(earnManagerOne, new BN(1));

//         // Setup the accounts
//         const { earnerAccount, userTokenAccount, earnManagerTokenAccount } =
//           await prepClaimFor(
//             earnAuthority,
//             earnerOne.publicKey,
//             earnManagerOne.publicKey
//           );

//         // Get the earner starting balance (this is used to compare later)
//         const earnerStartBalance = await getTokenBalance(userTokenAccount);

//         // Get the earn manager token account starting balance
//         const earnManagerStartBalance = await getTokenBalance(
//           earnManagerTokenAccount
//         );

//         // Confirm the earn manager fee is non-zero and active
//         await expectEarnManagerState(
//           getEarnManagerAccount(earnManagerOne.publicKey),
//           {
//             feeBps: new BN(1),
//             isActive: true,
//           }
//         );

//         // Confirm the starting earner account state
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: initialIndex,
//           lastClaimTimestamp: startTime,
//         });

//         // Send the transaction
//         // We use a smaller balance for the yield calculation here to make the fee round to zero
//         const snapshotBalance = new BN(10000);
//         await extEarn.methods
//           .claimFor(snapshotBalance)
//           .accountsPartial({ ...accounts })
//           .signers([earnAuthority])
//           .rpc();

//         // Calculate expected rewards (balance * (global_index / last_claim_index) - balance)
//         const expectedRewards = snapshotBalance
//           .mul(newIndex)
//           .div(initialIndex)
//           .sub(snapshotBalance);

//         // Verify the expected token balance changes
//         // Since fee rounds to zero, all rewards go to the earner
//         await expectTokenBalance(
//           userTokenAccount,
//           earnerStartBalance.add(expectedRewards)
//         );
//         await expectTokenBalance(
//           earnManagerTokenAccount,
//           earnManagerStartBalance
//         );

//         // Verify the earner account was updated with the new claim index and claim timestamp
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: newIndex,
//           lastClaimTimestamp: currentTime(),
//         });
//       });

//       // given all the accounts are correct
//       // given the earn manager fee is not zero and earn manager is active
//       // given the fee amount is not zero
//       // it mints the fee amount to the earn manager token account
//       // it mints the yield minus the fee amount to the earner's recipient account
//       test("Earn manager fee is non-zero, earn manager active, fee amount not zero - success", async () => {
//         // Configure the earn manager account with a 1% fee
//         const feeBps = new BN(100);
//         await configureEarnManager(earnManagerOne, feeBps);

//         // Setup the instruction to claim for earner one
//         const { earnerAccount, userTokenAccount, earnManagerTokenAccount } =
//           await prepClaimFor(
//             earnAuthority,
//             earnerOne.publicKey,
//             earnManagerOne.publicKey
//           );

//         // Get the current balance of the earner's token account
//         const earnerStartBalance = await getTokenBalance(userTokenAccount);

//         // Get the current balance of the earn manager's token account
//         const earnManagerStartBalance = await getTokenBalance(
//           earnManagerTokenAccount
//         );

//         // Confirm the earn manager fee is 1%
//         await expectEarnManagerState(
//           getEarnManagerAccount(earnManagerOne.publicKey),
//           {
//             feeBps,
//             isActive: true,
//           }
//         );

//         // Confirm the starting earner account state
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: initialIndex,
//           lastClaimTimestamp: startTime,
//         });

//         // Send the transaction
//         const snapshotBalance = await getTokenBalance(
//           await getATA(extMint.publicKey, earnerOne.publicKey)
//         );
//         await extEarn.methods
//           .claimFor(snapshotBalance)
//           .accountsPartial({ ...accounts })
//           .signers([earnAuthority])
//           .rpc();

//         // Calculate expected rewards (balance * (global_index / last_claim_index) - balance)
//         const expectedRewards = snapshotBalance
//           .mul(newIndex)
//           .div(initialIndex)
//           .sub(snapshotBalance);

//         // Calculate the fee amount (1% of rewards)
//         const feeAmount = expectedRewards.mul(feeBps).div(new BN(10000));

//         // Calculate the amount that should go to the earner
//         const earnerAmount = expectedRewards.sub(feeAmount);

//         // Verify the expected token balance changes
//         await expectTokenBalance(
//           userTokenAccount,
//           earnerStartBalance.add(earnerAmount)
//         );
//         await expectTokenBalance(
//           earnManagerTokenAccount,
//           earnManagerStartBalance.add(feeAmount)
//         );

//         // Verify the earner account was updated with the new claim index and claim timestamp
//         await expectEarnerState(earnerAccount, {
//           lastClaimIndex: newIndex,
//           lastClaimTimestamp: currentTime(),
//         });
//       });
//     });
//   });

//   describe("earn_manager instruction tests", () => {
//     beforeEach(async () => {
//       // Initialize the program
//       await initializeExt(earnAuthority.publicKey);

//       // Add an earn manager
//       await addEarnManager(earnManagerOne.publicKey, new BN(0));

//       // Add an earner
//       await addEarner(earnManagerOne, earnerOne.publicKey);
//     });

//     describe("add_earner unit tests", () => {
//       // test cases
//       // [X] given signer does not have an earn manager account initialized
//       //   [X] it reverts with an account not initialized error
//       // [X] given signer has an earn manager account initialized
//       //   [X] given earn manager account is not active
//       //     [X] it reverts with a NotAuthorized error
//       //   [X] given earn manager account is active
//       //     [X] given the earner already has an earner account
//       //       [X] it reverts with an account already initialized error
//       //     [X] given the earner does not already have an earner account
//       //       [X] given user token account is for the wrong token mint
//       //         [X] it reverts with an address constraint error
//       //       [X] given user token account authority does not match the user pubkey
//       //         [X] it reverts with an address constraint error
//       //       [X] given the user token account is for the correct token mint and the authority is the user pubkey
//       //         [X] it creates the earner account
//       //         [X] it sets the user to the provided pubkey
//       //         [X] it sets the user_token_account to the provided token account
//       //         [X] it sets the earner is_active flag to true
//       //         [X] it sets the earn_manager to the provided earn manager pubkey
//       //         [X] it sets the last_claim_index to the current index
//       //         [X] it sets the last_claim_timestamp to the current timestamp

//       // given signer does not have an earn manager account initialized
//       // it reverts with an account not initialized error
//       test("Signer earn manager account not initialized - reverts", async () => {
//         // Get the ATA for earner two
//         const earnerTwoATA = await getATA(
//           extMint.publicKey,
//           earnerTwo.publicKey
//         );

//         // Setup the instruction
//         prepAddEarner(
//           nonEarnManagerOne,
//           nonEarnManagerOne.publicKey,
//           earnerTwoATA
//         );

//         // Attempt to add earner without an initialized earn manager account
//         await expectAnchorError(
//           extEarn.methods
//             .addEarner(nonEarnerOne.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([nonEarnManagerOne])
//             .rpc(),
//           "AccountNotInitialized"
//         );
//       });

//       // given signer has an earn manager account initialized
//       // given earn manager account is not active
//       // it reverts with a NotActive error
//       test("Signer's earn manager account not active - reverts", async () => {
//         // Get the ATA for earner two
//         const earnerTwoATA = await getATA(
//           extMint.publicKey,
//           earnerTwo.publicKey
//         );

//         // Remove the earn manager one's account (set it to inactive)
//         await removeEarnManager(earnManagerOne.publicKey);

//         // Setup the instruction
//         prepAddEarner(earnManagerOne, earnManagerOne.publicKey, earnerTwoATA);

//         // Attempt to add earner with an inactive earn manager account
//         await expectAnchorError(
//           extEarn.methods
//             .addEarner(earnerTwo.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([earnManagerOne])
//             .rpc(),
//           "NotActive"
//         );
//       });

//       // given signer has an earn manager account initialized
//       // given earn manager account is active
//       // given earner already has an earner account
//       // it reverts with an account already initialized error
//       test("Earner account already initialized - reverts", async () => {
//         // Get the ATA for earner one
//         const earnerOneATA = await getATA(
//           extMint.publicKey,
//           earnerOne.publicKey
//         );

//         // Setup the instruction
//         prepAddEarner(earnManagerOne, earnManagerOne.publicKey, earnerOneATA);

//         // Attempt to add earner with an already initialized earner account
//         await expectSystemError(
//           extEarn.methods
//             .addEarner(earnerOne.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([earnManagerOne])
//             .rpc()
//         );
//       });

//       // given signer has an earn manager account initialized
//       // given earn manager account is active
//       // given the earner does not already have an earner account
//       // given user token account is for the wrong token mint
//       // it reverts with an token mint constraint error
//       test("User token account is for the wrong token mint - reverts", async () => {
//         // Create a new mint for the user token account
//         const wrongMint = new Keypair();
//         await createMint(wrongMint, nonAdmin.publicKey);

//         // Get the ATA for earner two on the wrong mint
//         const earnerTwoATA = await getATA(
//           wrongMint.publicKey,
//           earnerTwo.publicKey
//         );

//         // Setup the instruction
//         prepAddEarner(earnManagerOne, earnManagerOne.publicKey, earnerTwoATA);

//         // Attempt to add earner with user token account for wrong token mint
//         await expectAnchorError(
//           extEarn.methods
//             .addEarner(earnerTwo.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([earnManagerOne])
//             .rpc(),
//           "ConstraintTokenMint"
//         );
//       });

//       // given signer has an earn manager account initialized
//       // given earn manager account is active
//       // given the earner does not already have an earner account
//       // given user token account authority does not match the user pubkey
//       // it reverts with an address constraint error
//       test("User token account authority does not match user pubkey - reverts", async () => {
//         // Get the ATA for random user (not the same as the user)
//         const randomATA = await getATA(extMint.publicKey, nonAdmin.publicKey);

//         // Setup the instruction
//         prepAddEarner(earnManagerOne, earnManagerOne.publicKey, randomATA);

//         // Attempt to add earner with user token account for wrong token mint
//         await expectAnchorError(
//           extEarn.methods
//             .addEarner(earnerTwo.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([earnManagerOne])
//             .rpc(),
//           "ConstraintTokenOwner"
//         );
//       });

//       test("Add earner - success", async () => {
//         const tokenAccountKeypair = Keypair.generate();
//         const tokenAccountLen = getAccountLen([ExtensionType.ImmutableOwner]);
//         const lamports =
//           await provider.connection.getMinimumBalanceForRentExemption(
//             tokenAccountLen
//           );

//         // Create token account with the immutable owner extension
//         const transaction = new Transaction().add(
//           SystemProgram.createAccount({
//             fromPubkey: earnManagerOne.publicKey,
//             newAccountPubkey: tokenAccountKeypair.publicKey,
//             space: tokenAccountLen,
//             lamports,
//             programId: TOKEN_2022_PROGRAM_ID,
//           }),
//           createInitializeImmutableOwnerInstruction(
//             tokenAccountKeypair.publicKey,
//             TOKEN_2022_PROGRAM_ID
//           ),
//           createInitializeAccountInstruction(
//             tokenAccountKeypair.publicKey,
//             extMint.publicKey,
//             earnerTwo.publicKey,
//             TOKEN_2022_PROGRAM_ID
//           )
//         );

//         await provider.send!(transaction, [
//           earnManagerOne,
//           tokenAccountKeypair,
//         ]);

//         // Setup the instruction
//         const { earnerAccount } = prepAddEarner(
//           earnManagerOne,
//           earnManagerOne.publicKey,
//           tokenAccountKeypair.publicKey
//         );

//         // Add earner two to the earn manager's list
//         await extEarn.methods
//           .addEarner(earnerTwo.publicKey)
//           .accountsPartial({ ...accounts })
//           .signers([earnManagerOne])
//           .rpc();

//         // Verify the earner account was initialized correctly
//         await expectEarnerState(earnerAccount, {
//           earnManager: earnManagerOne.publicKey,
//           lastClaimIndex: initialIndex,
//           lastClaimTimestamp: currentTime(),
//           user: earnerTwo.publicKey,
//           userTokenAccount: tokenAccountKeypair.publicKey,
//         });
//       });

//       // given signer has an earn manager account initialized
//       // given earn manager account is active
//       // given the earner does not already have an earner account
//       // given user token account is for the correct token mint and the authority is the signer
//       // it creates the earner account
//       // it sets the earner is_active flag to true
//       // it sets the earn_manager to the provided earn manager pubkey
//       // it sets the last_claim_index to the current index
//       // it sets the last_claim_timestamp to the current time
//       test("Add earner ata - success", async () => {
//         // Get the ATA for earner two
//         const earnerTwoATA = await getATA(
//           extMint.publicKey,
//           earnerTwo.publicKey
//         );

//         // Setup the instruction
//         const { earnerAccount } = prepAddEarner(
//           earnManagerOne,
//           earnManagerOne.publicKey,
//           earnerTwoATA
//         );

//         // Add earner one to the earn manager's list
//         await extEarn.methods
//           .addEarner(earnerTwo.publicKey)
//           .accountsPartial({ ...accounts })
//           .signers([earnManagerOne])
//           .rpc();

//         // Verify the earner account was initialized correctly
//         await expectEarnerState(earnerAccount, {
//           earnManager: earnManagerOne.publicKey,
//           lastClaimIndex: initialIndex,
//           lastClaimTimestamp: currentTime(),
//           user: earnerTwo.publicKey,
//           userTokenAccount: earnerTwoATA,
//         });
//       });
//     });

//     describe("configure_earn_manager unit tests", () => {});

//     describe("remove_earner unit tests", () => {
//       // test cases
//       // [X] given signer does not have an earn manager account initialized
//       //   [X] it reverts with an account not initialized error
//       // [X] given signer has an earn manager account initialized
//       //   [X] given earn manager account is not active
//       //     [X] it reverts with a NotAuthorized error
//       //   [X] given earn manager account is active
//       //     [X] given the earner account does not have an earn manager
//       //       [X] it reverts with a NotAuthorized error
//       //     [X] given the earner account has an earn manager
//       //       [X] given the earner's earn manager is not the signer
//       //         [X] it reverts with a NotAuthorized error
//       //       [X] given the earner's earn manager is the signer
//       //         [X] the earner account is closed and the signer refunded the rent

//       // given signer does not have an earn manager account initialized
//       // it reverts with an account not initialized error
//       test("Signer earn manager account not initialized - reverts", async () => {
//         // Get the ATA for earner one
//         const earnerOneATA = await getATA(
//           extMint.publicKey,
//           earnerOne.publicKey
//         );

//         // Setup the instruction
//         prepRemoveEarner(
//           nonEarnManagerOne,
//           nonEarnManagerOne.publicKey,
//           earnerOneATA
//         );

//         // Attempt to remove earner without an initialized earn manager account
//         await expectAnchorError(
//           extEarn.methods
//             .removeEarner()
//             .accountsPartial({ ...accounts })
//             .signers([nonEarnManagerOne])
//             .rpc(),
//           "AccountNotInitialized"
//         );
//       });

//       // given signer has an earn manager account initialized
//       // given earn manager account is not active
//       // it reverts with a NotActive error
//       test("Signer's earn manager account not active - reverts", async () => {
//         // Get the ATA for earner one
//         const earnerOneATA = await getATA(
//           extMint.publicKey,
//           earnerOne.publicKey
//         );

//         // Remove the earn manager account (set it to inactive)
//         await removeEarnManager(earnManagerOne.publicKey);

//         // Setup the instruction
//         prepRemoveEarner(
//           earnManagerOne,
//           earnManagerOne.publicKey,
//           earnerOneATA
//         );

//         // Attempt to remove earner with an inactive earn manager account
//         await expectAnchorError(
//           extEarn.methods
//             .removeEarner()
//             .accountsPartial({ ...accounts })
//             .signers([earnManagerOne])
//             .rpc(),
//           "NotActive"
//         );
//       });

//       // given signer has an earn manager account initialized
//       // given earn manager account is active
//       // given the earner account has an earn manager
//       // given the earner's earn manager is not the signer
//       // it reverts with a NotAuthorized error
//       test("Earner's earn manager is not signer - reverts", async () => {
//         // Add earner manager two
//         await addEarnManager(earnManagerTwo.publicKey, new BN(100));

//         // Get the ATA for earner one
//         const earnerOneATA = await getATA(
//           extMint.publicKey,
//           earnerOne.publicKey
//         );

//         // Setup the instruction
//         prepRemoveEarner(
//           earnManagerTwo,
//           earnManagerTwo.publicKey,
//           earnerOneATA
//         );

//         // Attempt to remove earner with the wrong earn manager
//         await expectAnchorError(
//           extEarn.methods
//             .removeEarner()
//             .accountsPartial({ ...accounts })
//             .signers([earnManagerTwo])
//             .rpc(),
//           "NotAuthorized"
//         );
//       });

//       // given signer has an earn manager account initialized
//       // given earn manager account is active
//       // given the earner account has an earn manager
//       // given the earner's earn manager is the signer
//       // it closes the earner account and refunds the rent
//       test("Earner's earn manager is signer - success", async () => {
//         // Get the ATA for earner one
//         const earnerOneATA = await getATA(
//           extMint.publicKey,
//           earnerOne.publicKey
//         );

//         // Setup the instruction
//         const { earnerAccount } = prepRemoveEarner(
//           earnManagerOne,
//           earnManagerOne.publicKey,
//           earnerOneATA
//         );

//         // Remove the earner account
//         await extEarn.methods
//           .removeEarner()
//           .accountsPartial({ ...accounts })
//           .signers([earnManagerOne])
//           .rpc();

//         // Verify the earner account was closed
//         expectAccountEmpty(earnerAccount);
//       });
//     });

//     describe("transfer_earner unit tests", () => {
//       // test cases
//       // [X] given the earner does not have an account initialized
//       //   [X] it reverts with an AccountNotInitialized error
//       // [X] given the to earn manager does not have an account initialized
//       //   [X] it reverts with an AccountNotInitialized error
//       // [X] given the from earn manager does not sign the transaction
//       //   [X] it reverts with a NotAuthorized error
//       // [X] given the from earn manager does sign the transaction
//       //   [X] given the from earn manager is not active
//       //     [X] it reverts with a NotActive error
//       //   [X] given the to earn manager is not active
//       //     [X] it reverts with a NotActive error
//       //   [X] given all the accounts are correct and earn managers are active
//       //     [X] it updates the earner's earn manager to the "to earn manager"

//       beforeEach(async () => {
//         // Add second earn manager to have someone to transfer to
//         await addEarnManager(earnManagerTwo.publicKey, new BN(100));
//       });

//       // given the earner does not have an account initialized
//       // it reverts with an AccounbtNotInitialized error
//       test("earner account not initialized - reverts", async () => {
//         const nonEarnerOneATA = await getATA(
//           extMint.publicKey,
//           nonEarnerOne.publicKey
//         );

//         // Setup the instruction
//         prepTransferEarner(
//           earnManagerOne,
//           earnManagerOne.publicKey,
//           earnManagerTwo.publicKey,
//           nonEarnerOneATA
//         );

//         // Attempt to transfer earner without an initialized account
//         await expectAnchorError(
//           extEarn.methods
//             .transferEarner(earnManagerTwo.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([earnManagerOne])
//             .rpc(),
//           "AccountNotInitialized"
//         );
//       });

//       // given the to earn manager does not have an account initialized
//       // it reverts with an AccountNotInitialized error
//       test("to_earn_manager account not initialized - reverts", async () => {
//         const earnerOneATA = await getATA(
//           extMint.publicKey,
//           earnerOne.publicKey
//         );

//         // Setup the instruction
//         prepTransferEarner(
//           earnManagerOne,
//           earnManagerOne.publicKey,
//           nonEarnManagerOne.publicKey,
//           earnerOneATA
//         );

//         // Attempt to transfer earner to a non-initialized earn manager account
//         await expectAnchorError(
//           extEarn.methods
//             .transferEarner(nonEarnManagerOne.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([earnManagerOne])
//             .rpc(),
//           "AccountNotInitialized"
//         );
//       });

//       // given the from earn manager does not sign the transaction
//       // it reverts with a NotAuthorized error
//       test("from earn manager does not sign transaction - reverts", async () => {
//         const earnerOneATA = await getATA(
//           extMint.publicKey,
//           earnerOne.publicKey
//         );

//         // Setup the instruction
//         prepTransferEarner(
//           nonAdmin,
//           earnManagerOne.publicKey,
//           earnManagerTwo.publicKey,
//           earnerOneATA
//         );

//         // Attempt to transfer earner with a non-authorized signer
//         await expectAnchorError(
//           extEarn.methods
//             .transferEarner(earnManagerTwo.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "NotAuthorized"
//         );
//       });

//       // given the from earn manager does sign the transaction
//       // given the from earn manager is not active
//       // it reverts with a NotActive
//       test("from earn manager is not active - reverts", async () => {
//         const earnerOneATA = await getATA(
//           extMint.publicKey,
//           earnerOne.publicKey
//         );

//         // Remove the earn manager account (set it to inactive)
//         await removeEarnManager(earnManagerOne.publicKey);

//         // Setup the instruction
//         prepTransferEarner(
//           earnManagerOne,
//           earnManagerOne.publicKey,
//           earnManagerTwo.publicKey,
//           earnerOneATA
//         );

//         // Attempt to transfer earner with an inactive earn manager account
//         await expectAnchorError(
//           extEarn.methods
//             .transferEarner(earnManagerTwo.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([earnManagerOne])
//             .rpc(),
//           "NotActive"
//         );
//       });

//       // given the from earn manager signs the transaction
//       // given the to earn manager is not active
//       // it reverts with a NotActive error
//       test("to earn manager is not active - reverts", async () => {
//         const earnerOneATA = await getATA(
//           extMint.publicKey,
//           earnerOne.publicKey
//         );

//         // Remove the to earn manager account (set it to inactive)
//         await removeEarnManager(earnManagerTwo.publicKey);

//         // Setup the instruction
//         prepTransferEarner(
//           earnManagerOne,
//           earnManagerOne.publicKey,
//           earnManagerTwo.publicKey,
//           earnerOneATA
//         );

//         // Attempt to transfer earner with an inactive to earn manager account
//         await expectAnchorError(
//           extEarn.methods
//             .transferEarner(earnManagerTwo.publicKey)
//             .accountsPartial({ ...accounts })
//             .signers([earnManagerOne])
//             .rpc(),
//           "NotActive"
//         );
//       });

//       // given the from earn manager signs the transaction
//       // given the accounts are correct and the earn managers are active
//       // it updates the earner's earn manager to the "to earn manager"
//       test("transfer_earner - success", async () => {
//         const earnerOneATA = await getATA(
//           extMint.publicKey,
//           earnerOne.publicKey
//         );

//         // Setup the instruction
//         const { earnerAccount } = prepTransferEarner(
//           earnManagerOne,
//           earnManagerOne.publicKey,
//           earnManagerTwo.publicKey,
//           earnerOneATA
//         );

//         // Confirm the earner's earn manager is currently earnManagerOne
//         await expectEarnerState(earnerAccount, {
//           earnManager: earnManagerOne.publicKey,
//         });

//         // Transfer the earner from earn manager one to earn manager two
//         await extEarn.methods
//           .transferEarner(earnManagerTwo.publicKey)
//           .accountsPartial({ ...accounts })
//           .signers([earnManagerOne])
//           .rpc();

//         // Verify the earner account was updated
//         await expectEarnerState(earnerAccount, {
//           earnManager: earnManagerTwo.publicKey,
//         });
//       });
//     });

//     describe("configure_earn_manager unit tests", () => {
//       // test cases
//       // [X] given the earn manager account does not match the signer
//       //   [X] it reverts with an address constraint error
//       // [X] given the earn manager account matches the signer
//       //   [X] given the fee basis points is greater than 100_00
//       //     [X] it reverts with an InvalidParam error
//       //   [X] given the fee basis points is less than or equal to 100_00
//       //     [X] given the fee_token_account is for the wrong token mint
//       //       [X] it reverts with an address constraint error
//       //     [X] given the fee_token_account is for the correct token mint
//       //       [X] given the earn manager account has not been initialized
//       //         [X] it reverts with an AccountNotInitialized error
//       //       [X] given the earn manager account has been initialized
//       //         [X] given the fee_bps is null and the fee_token_account is null
//       //           [X] nothing is updated
//       //         [X] given the fee_bps is null and the fee_token_account is not null
//       //           [X] it updates the fee_token_account to the provided token account
//       //         [X] given the fee_bps is not null and the fee_token_account is null
//       //           [X] it updates the fee_bps to the provided value
//       //         [X] given the fee_bps is not null and the fee_token_account is not null
//       //           [X] it updates the fee_bps to the provided value
//       //           [X] it updates the fee_token_account to the provided token account

//       // given the earn manager account does not match the signer
//       // it reverts with a seeds constraint error
//       test("Earn manager account does not match signer - reverts", async () => {
//         // Get the ATA for earn manager one
//         const earnManagerOneATA = await getATA(
//           extMint.publicKey,
//           earnManagerOne.publicKey
//         );

//         // Setup the instruction
//         await prepConfigureEarnManager(
//           nonEarnManagerOne,
//           earnManagerOne.publicKey,
//           earnManagerOneATA
//         );

//         // Attempt to configure earn manager with non-matching account
//         await expectAnchorError(
//           extEarn.methods
//             .configureEarnManager(new BN(100))
//             .accountsPartial({ ...accounts })
//             .signers([nonEarnManagerOne])
//             .rpc(),
//           "ConstraintSeeds"
//         );
//       });

//       // given the earn manager account matches the signer
//       // given the earn manager account is not initialized
//       // it reverts with an AccountNotInitialized error
//       test("Earn manager account not initialized - reverts", async () => {
//         // Get the ATA for earn manager two
//         const earnManagerTwoATA = await getATA(
//           extMint.publicKey,
//           earnManagerTwo.publicKey
//         );

//         // Setup the instruction
//         await prepConfigureEarnManager(
//           earnManagerTwo,
//           earnManagerTwo.publicKey,
//           earnManagerTwoATA
//         );

//         // Attempt to configure earn manager that hasn't been initialized
//         await expectAnchorError(
//           extEarn.methods
//             .configureEarnManager(new BN(0))
//             .accountsPartial({ ...accounts })
//             .signers([earnManagerTwo])
//             .rpc(),
//           "AccountNotInitialized"
//         );
//       });

//       // given the earn manager account matches the signer
//       // given the fee basis points is greater than 100_00
//       // it reverts with an InvalidParam error
//       test("Fee basis points > 10000 - reverts", async () => {
//         // Get the ATA for earn manager one
//         const earnManagerOneATA = await getATA(
//           extMint.publicKey,
//           earnManagerOne.publicKey
//         );

//         // Setup the instruction
//         await prepConfigureEarnManager(
//           earnManagerOne,
//           earnManagerOne.publicKey,
//           earnManagerOneATA
//         );

//         const feeBps = new BN(randomInt(10001, 2 ** 48 - 1));

//         // Attempt to configure earn manager with invalid fee basis points
//         await expectAnchorError(
//           extEarn.methods
//             .configureEarnManager(feeBps)
//             .accountsPartial({ ...accounts })
//             .signers([earnManagerOne])
//             .rpc(),
//           "InvalidParam"
//         );
//       });

//       // given the earn manager account matches the signer
//       // given the provided merkle proof for the signer is valid
//       // given the fee basis points is less than or equal to 100_00
//       // given the fee_token_account is for the wrong token mint
//       // it reverts with a constraint token mint error
//       test("Fee token account for wrong mint - reverts", async () => {
//         // Create a new token mint
//         const wrongMint = new Keypair();
//         await createMint(wrongMint, nonAdmin.publicKey);

//         // Get the ATA for earn manager one with the wrong mint
//         const wrongATA = await getATA(
//           wrongMint.publicKey,
//           earnManagerOne.publicKey
//         );

//         // Setup the instruction
//         await prepConfigureEarnManager(
//           earnManagerOne,
//           earnManagerOne.publicKey,
//           wrongATA
//         );

//         // Attempt to configure earn manager with invalid fee token account
//         await expectAnchorError(
//           extEarn.methods
//             .configureEarnManager(new BN(100))
//             .accountsPartial({ ...accounts })
//             .signers([earnManagerOne])
//             .rpc(),
//           "ConstraintTokenMint"
//         );
//       });

//       // given the earn manager account matches the signer
//       // given the earn manager account already exists
//       // given both the fee_bps and fee_token_account are null
//       // nothing is updated
//       test("Both fee bps and fee token account are null - success", async () => {
//         // Get the ATA for earn manager one
//         const earnManagerOneATA = await getATA(
//           extMint.publicKey,
//           earnManagerOne.publicKey
//         );

//         // Setup the instruction
//         const { earnManagerAccount } = await prepConfigureEarnManager(
//           earnManagerOne,
//           earnManagerOne.publicKey
//         );

//         // Confirm the earn manager account has already been created
//         await expectEarnManagerState(earnManagerAccount, {
//           isActive: true,
//           feeBps: new BN(0),
//           feeTokenAccount: earnManagerOneATA,
//         });

//         // Send the instruction
//         await extEarn.methods
//           .configureEarnManager(null)
//           .accountsPartial({ ...accounts })
//           .signers([earnManagerOne])
//           .rpc();

//         // Verify the earn manager account is created and updated
//         await expectEarnManagerState(earnManagerAccount, {
//           isActive: true,
//           feeBps: new BN(0),
//           feeTokenAccount: earnManagerOneATA,
//         });
//       });

//       // given the earn manager account matches the signer
//       // given the earn manager account already exists
//       // given the fee_bps is not null and the fee_token_account is null
//       // it updates the fee_bps to the provided value
//       test("Fee bps not null, fee token account null - success", async () => {
//         // Get the ATA for earn manager one
//         const earnManagerOneATA = await getATA(
//           extMint.publicKey,
//           earnManagerOne.publicKey
//         );

//         // Setup the instruction
//         const { earnManagerAccount } = await prepConfigureEarnManager(
//           earnManagerOne,
//           earnManagerOne.publicKey
//         );

//         // Confirm the earn manager account has already been created
//         await expectEarnManagerState(earnManagerAccount, {
//           isActive: true,
//           feeBps: new BN(0),
//           feeTokenAccount: earnManagerOneATA,
//         });

//         const newFee = new BN(randomInt(0, 10000));

//         // Send the instruction
//         await extEarn.methods
//           .configureEarnManager(newFee)
//           .accountsPartial({ ...accounts })
//           .signers([earnManagerOne])
//           .rpc();

//         // Verify the earn manager account is created and updated
//         await expectEarnManagerState(earnManagerAccount, {
//           isActive: true,
//           feeBps: newFee,
//           feeTokenAccount: earnManagerOneATA,
//         });
//       });

//       // given the earn manager account matches the signer
//       // given the earn manager account already exists
//       // given the fee_bps is null and the fee_token_account is not null
//       // it updates the fee_token_account to the provided token account
//       test("Fee bps null, fee token account not null - success", async () => {
//         // Get the ATA for earn manager one
//         const earnManagerOneATA = await getATA(
//           extMint.publicKey,
//           earnManagerOne.publicKey
//         );

//         // Use the ATA for a different address to change the fee token account to
//         // it's easier than creating a manual token account
//         const newFeeTokenAccount = await getATA(
//           extMint.publicKey,
//           nonEarnManagerOne.publicKey
//         );

//         // Setup the instruction
//         const { earnManagerAccount } = await prepConfigureEarnManager(
//           earnManagerOne,
//           earnManagerOne.publicKey,
//           newFeeTokenAccount
//         );

//         // Confirm the earn manager account has already been created
//         await expectEarnManagerState(earnManagerAccount, {
//           isActive: true,
//           feeBps: new BN(0),
//           feeTokenAccount: earnManagerOneATA,
//         });

//         // Send the instruction
//         await extEarn.methods
//           .configureEarnManager(null)
//           .accountsPartial({ ...accounts })
//           .signers([earnManagerOne])
//           .rpc();

//         // Verify the earn manager account is created and updated
//         await expectEarnManagerState(earnManagerAccount, {
//           isActive: true,
//           feeBps: new BN(0),
//           feeTokenAccount: newFeeTokenAccount,
//         });
//       });

//       // given the earn manager account matches the signer
//       // given the earn manager account already exists
//       // given both the fee_bps and fee_token_account are not null
//       // it updates the fee_bps to the provided value
//       // it updates the fee_token_account to the provided token account
//       test("Both fee bps and fee token account are not null - success", async () => {
//         // Get the ATA for earn manager one
//         const earnManagerOneATA = await getATA(
//           extMint.publicKey,
//           earnManagerOne.publicKey
//         );

//         // Use the ATA for a different address to change the fee token account to
//         // it's easier than creating a manual token account
//         const newFeeTokenAccount = await getATA(
//           extMint.publicKey,
//           nonEarnManagerOne.publicKey
//         );

//         // Setup the instruction
//         const { earnManagerAccount } = await prepConfigureEarnManager(
//           earnManagerOne,
//           earnManagerOne.publicKey,
//           newFeeTokenAccount
//         );

//         // Confirm the earn manager account has already been created
//         await expectEarnManagerState(earnManagerAccount, {
//           isActive: true,
//           feeBps: new BN(0),
//           feeTokenAccount: earnManagerOneATA,
//         });

//         const newFee = new BN(randomInt(0, 10000));

//         // Send the instruction
//         await extEarn.methods
//           .configureEarnManager(newFee)
//           .accountsPartial({ ...accounts })
//           .signers([earnManagerOne])
//           .rpc();

//         // Verify the earn manager account is created and updated
//         await expectEarnManagerState(earnManagerAccount, {
//           isActive: true,
//           feeBps: newFee,
//           feeTokenAccount: newFeeTokenAccount,
//         });
//       });
//     });
//   });

//   describe("earner instruction tests", () => {
//     let startRecipientAccount: PublicKey;

//     beforeEach(async () => {
//       // Initialize the program
//       await initializeExt(earnAuthority.publicKey);

//       // Add an earn manager
//       await addEarnManager(earnManagerOne.publicKey, new BN(0));

//       // Add an earner under the earn manager
//       await addEarner(earnManagerOne, earnerOne.publicKey);

//       // Set the earners recipient token account initially to the non earner one ATA
//       // This way we can tell when we set it back to None
//       startRecipientAccount = await getATA(
//         extMint.publicKey,
//         nonEarnerOne.publicKey
//       );
//       await setRecipient(earnerOne, startRecipientAccount);
//     });

//     describe("set_recipient unit tests", () => {
//       // test cases
//       // [X] given neither the earner or earn manager signs the transaction
//       //   [X] it reverts with a NotAuthorized error
//       // [X] given the recipient token account is None
//       //   [X] given the earner signs the transaction
//       //     [X] it updates the earner's recipient token account to None (defaults to user token account)
//       //   [X] given the earn manager signs the transaction
//       //     [X] it updates the earner's recipient token account to None (defaults to user token account)
//       // [X] given a recipient token account is provided
//       //   [X] given the recipient token account is for the wrong mint
//       //     [X] it reverts with a ConstraintTokenMint error
//       //   [X] given the recipient token account is valid
//       //     [X] given the earner signs the transaction
//       //       [X] it updates the earner's recipient token account to the provided value
//       //     [X] given the earn manager signs the transaction
//       //       [X] it updates the earner's recipient token account to the provided value

//       // given the new recipient token account is None
//       // given the earner signers the transaction
//       // it updates the recipient account to None
//       test("Earner signs, new recipient token account is None (default) - success", async () => {
//         // Setup the instruction
//         const { earnerAccount } = await prepSetRecipient(
//           earnerOne,
//           earnerOne.publicKey,
//           null
//         );

//         // Check the starting value
//         await expectEarnerState(earnerAccount, {
//           recipientTokenAccount: startRecipientAccount,
//         });

//         // Send the instruction
//         await extEarn.methods
//           .setRecipient()
//           .accountsPartial({ ...accounts })
//           .signers([earnerOne])
//           .rpc();

//         // Check that the recipient token account was updated
//         await expectEarnerState(earnerAccount, {
//           recipientTokenAccount: undefined,
//         });
//       });

//       // given the new recipient token account is None
//       // given the earn manager signs the transaction
//       // it updates the recipient account to None
//       test("Earn manager signs, new recipient tokenaccount is None (default) - success", async () => {
//         // Setup the instruction
//         const { earnerAccount } = await prepSetRecipient(
//           earnManagerOne,
//           earnerOne.publicKey,
//           null
//         );

//         // Check the starting value
//         await expectEarnerState(earnerAccount, {
//           recipientTokenAccount: startRecipientAccount,
//         });

//         // Send the instruction
//         await extEarn.methods
//           .setRecipient()
//           .accountsPartial({ ...accounts })
//           .signers([earnManagerOne])
//           .rpc();

//         // Check that the recipient token account was updated
//         await expectEarnerState(earnerAccount, {
//           recipientTokenAccount: undefined,
//         });
//       });

//       // given the transaction is not signed by the earner or the earn manager
//       // it reverts with a NotAuthorized error
//       test("Neither earner nor earn manager signs the transaction - reverts", async () => {
//         // Setup the instruction to change the recipient account back to the default
//         await prepSetRecipient(nonAdmin, earnerOne.publicKey, null);

//         // Send the instruction
//         // Expect revert with a NotAuthorized error
//         await expectAnchorError(
//           extEarn.methods
//             .setRecipient()
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "NotAuthorized"
//         );
//       });

//       // given a recipient token account is provided
//       // given the recipient token account is for the wrong mint
//       // it reverts with a ConstraintTokenMint error
//       test("Recipient token account is for the wrong mint - reverts", async () => {
//         // Create an ATA for the wrong mint (M mint instead of EXT mint)
//         const wrongMintATA = await getATA(mMint.publicKey, earnerOne.publicKey);

//         // Setup the instruction
//         await prepSetRecipient(earnerOne, earnerOne.publicKey, wrongMintATA);

//         // Attempt to send the transaction
//         // Expect a ConstraintTokenMint error
//         await expectAnchorError(
//           extEarn.methods
//             .setRecipient()
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc(),
//           "ConstraintTokenMint"
//         );
//       });

//       // given a recipient token account is provided
//       // given the recipient token account is valid
//       // given the earner signs the transaction
//       // it updates the earner's recipient token account to the provided token account
//       test("Earner signs, new recipient token account provided - success", async () => {
//         // Get the ATA for the recipient (use yieldRecipient as the recipient)
//         const recipientATA = await getATA(
//           extMint.publicKey,
//           yieldRecipient.publicKey
//         );

//         // Setup the instruction
//         const { earnerAccount } = await prepSetRecipient(
//           earnerOne,
//           earnerOne.publicKey,
//           recipientATA
//         );

//         // Send the instruction
//         await extEarn.methods
//           .setRecipient()
//           .accountsPartial({ ...accounts })
//           .signers([earnerOne])
//           .rpc();

//         // Check that the recipient token account was updated correctly
//         await expectEarnerState(earnerAccount, {
//           recipientTokenAccount: recipientATA,
//         });
//       });

//       // given a recipient token account is provided
//       // given the recipient token account is validr
//       // given the earn manager signs the transaction
//       // it updates the earner's recipient token account to the provided token account
//       test("Earn manager signs, new recipient token account provided - success", async () => {
//         // Get the ATA for the recipient (using yieldRecipient as the recipient)
//         const recipientATA = await getATA(
//           extMint.publicKey,
//           yieldRecipient.publicKey
//         );

//         // Setup the instruction
//         const { earnerAccount } = await prepSetRecipient(
//           earnManagerOne,
//           earnerOne.publicKey,
//           recipientATA
//         );

//         // Send the instruction
//         await extEarn.methods
//           .setRecipient()
//           .accountsPartial({ ...accounts })
//           .signers([earnManagerOne])
//           .rpc();

//         // Check that the recipient token account was updated correctly
//         await expectEarnerState(earnerAccount, {
//           recipientTokenAccount: recipientATA,
//         });
//       });
//     });
//   });

//   describe("open instruction tests", () => {
//     const mintAmount = new BN(100_000_000);

//     // Setup accounts with M tokens so we can test wrapping and unwrapping
//     beforeEach(async () => {
//       // Initialize the extension program
//       await initializeExt(earnAuthority.publicKey);

//       // Add an earn manager on the extension
//       await addEarnManager(earnManagerOne.publicKey, new BN(0));

//       // Add an earner on the extension under the earn manager
//       await addEarner(earnManagerOne, earnerOne.publicKey);

//       // Mint M tokens to the extension earner and a non-earner
//       await mintM(earnerOne.publicKey, mintAmount);
//       await mintM(nonEarnerOne.publicKey, mintAmount);
//     });

//     describe("wrap unit tests", () => {
//       // test cases
//       // [X] given the m mint account does not match the one stored in the global account
//       //   [X] it reverts with an InvalidAccount error
//       // [X] given the ext mint account does not match the one stored in the global account
//       //   [X] it reverts with an InvalidAccount error
//       // [X] given the signer is not the authority on the from m token account
//       //   [X] it reverts with a ConstraintTokenOwner error
//       // [X] given the vault M token account is not the M Vaults ATA for the M token mint
//       //   [X] it reverts with a ConstraintAssociated error
//       // [X] given the from m token account is for the wrong mint
//       //   [X] it reverts with a ConstraintTokenMint error
//       // [X] given the to ext token account is for the wrong mint
//       //   [X] it reverts with a ConstraintTokenMint error
//       // [X] given all the accounts are correct
//       //   [X] given the user does not have enough M tokens
//       //     [X] it reverts with a ? error
//       //   [X] given the user has enough M tokens
//       //     [X] it transfers the amount of M tokens from the user's M token account to the M vault token account
//       //     [X] it mints the amount of wM tokens to the user's wM token account
//       // TODO there are a couple other account constraints that can be tested

//       // given the m mint account does not match the one stored in the global account
//       // it reverts with an InvalidAccount error
//       test("M mint account does not match global account - reverts", async () => {
//         // Setup the instruction
//         await prepWrap(earnerOne);

//         // Change the m mint account
//         accounts.mMint = extMint.publicKey;

//         // Attempt to send the transaction
//         // Expect an invalid account error
//         await expectAnchorError(
//           extEarn.methods
//             .wrap(mintAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc(),
//           "InvalidAccount"
//         );
//       });

//       // given the ext mint account does not match the one stored in the global account
//       // it reverts with an InvalidAccount error
//       test("Ext mint account does not match global account - reverts", async () => {
//         // Setup the instruction
//         await prepWrap(earnerOne);

//         // Change the ext mint account
//         accounts.extMint = mMint.publicKey;

//         // Attempt to send the transaction
//         // Expect an invalid account error
//         await expectAnchorError(
//           extEarn.methods
//             .wrap(mintAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc(),
//           "InvalidAccount"
//         );
//       });

//       // given the signer is not the authority on the user M token account
//       // it reverts with a ConstraintTokenOwner error
//       test("Signer is not the authority on the from M token account - reverts", async () => {
//         // Get the ATA for another user
//         const wrongATA = await getATA(mMint.publicKey, nonEarnerOne.publicKey);

//         // Setup the instruction with the wrong user M token account
//         await prepWrap(earnerOne, wrongATA);

//         // Attempt to send the transaction
//         // Expect revert on the token program due to permissions
//         await expectSystemError(
//           extEarn.methods
//             .wrap(mintAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc()
//         );
//       });

//       // given the M vault token account is not the M vault PDA's ATA
//       // it reverts with a ConstraintAssociated error
//       test("M Vault Token account is the the M Vault PDA's ATA (other token account) - reverts", async () => {
//         // Create a token account for the M vault that is not the ATA
//         const tokenAccountKeypair = Keypair.generate();
//         const tokenAccountLen = getAccountLen([ExtensionType.ImmutableOwner]);
//         const lamports =
//           await provider.connection.getMinimumBalanceForRentExemption(
//             tokenAccountLen
//           );

//         const mVault = getMVault();

//         // Create token account with the immutable owner extension
//         const transaction = new Transaction().add(
//           SystemProgram.createAccount({
//             fromPubkey: admin.publicKey,
//             newAccountPubkey: tokenAccountKeypair.publicKey,
//             space: tokenAccountLen,
//             lamports,
//             programId: TOKEN_2022_PROGRAM_ID,
//           }),
//           createInitializeImmutableOwnerInstruction(
//             tokenAccountKeypair.publicKey,
//             TOKEN_2022_PROGRAM_ID
//           ),
//           createInitializeAccountInstruction(
//             tokenAccountKeypair.publicKey,
//             mMint.publicKey,
//             mVault,
//             TOKEN_2022_PROGRAM_ID
//           )
//         );

//         await provider.send!(transaction, [admin, tokenAccountKeypair]);

//         // Setup the instruction with the non-ATA vault m token account
//         await prepWrap(
//           earnerOne,
//           undefined,
//           undefined,
//           tokenAccountKeypair.publicKey
//         );

//         // Attempt to send the transaction
//         // Expect revert with a ConstraintAssociated error
//         await expectAnchorError(
//           extEarn.methods
//             .wrap(mintAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc(),
//           "ConstraintAssociated"
//         );
//       });

//       // given the from m token account is for the wrong mint
//       // it reverts with a ConstraintTokenMint error
//       test("From M token account is for wrong mint - reverts", async () => {
//         // Get the user's ATA for the ext mint and pass it as the user M token account
//         const wrongUserATA = await getATA(
//           extMint.publicKey,
//           earnerOne.publicKey
//         );

//         // Setup the instruction
//         await prepWrap(earnerOne, wrongUserATA);

//         // Attempt to send the transaction
//         // Expect revert with a ConstraintTokenMint error
//         await expectAnchorError(
//           extEarn.methods
//             .wrap(mintAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc(),
//           "ConstraintTokenMint"
//         );
//       });

//       // given the to ext token account is for the wrong mint
//       // it reverts with a ConstraintTokenMint error
//       test("To Ext token account is for the wrong mint - reverts", async () => {
//         // Get the user's ATA for the m mint and pass it as the user ext token account
//         const wrongUserATA = await getATA(mMint.publicKey, earnerOne.publicKey);

//         // Setup the instruction
//         await prepWrap(earnerOne, undefined, wrongUserATA);

//         // Attempt to send the transaction
//         // Expect revert with a ConstraintTokenMint error
//         await expectAnchorError(
//           extEarn.methods
//             .wrap(mintAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc(),
//           "ConstraintTokenMint"
//         );
//       });

//       // given all accounts are correct
//       // give the user does not have enough M tokens
//       // it reverts
//       test("Not enough M - reverts", async () => {
//         // Setup the instruction
//         await prepWrap(earnerOne);

//         const wrapAmount = new BN(
//           randomInt(mintAmount.toNumber() + 1, 2 ** 48 - 1)
//         );

//         // Attempt to send the transaction
//         // Expect an error
//         await expectSystemError(
//           extEarn.methods
//             .wrap(wrapAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc()
//         );
//       });

//       // given all accounts are correct
//       // given the user has enough M tokens
//       // it transfers the amount of M tokens from the user's M token account to the M vault token account
//       // it mints the amount of wM tokens to the user's wM token account
//       test("Wrap as wM earner - success", async () => {
//         // Setup the instruction
//         const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } =
//           await prepWrap(earnerOne);

//         // Confirm initial balances
//         await expectTokenBalance(fromMTokenAccount, mintAmount);
//         await expectTokenBalance(vaultMTokenAccount, new BN(0));
//         await expectTokenBalance(toExtTokenAccount, new BN(0));

//         const wrapAmount = new BN(randomInt(1, mintAmount.toNumber()));

//         // Send the instruction
//         await extEarn.methods
//           .wrap(wrapAmount)
//           .accountsPartial({ ...accounts })
//           .signers([earnerOne])
//           .rpc();

//         // Confirm updated balances
//         await expectTokenBalance(fromMTokenAccount, mintAmount.sub(wrapAmount));
//         await expectTokenBalance(vaultMTokenAccount, wrapAmount);
//         await expectTokenBalance(toExtTokenAccount, wrapAmount);
//       });

//       // given all accounts are correct
//       // given the user has enough M tokens
//       // it transfers the amount of M tokens from the user's M token account to the M vault token account
//       // it mints the amount of wM tokens to the user's wM token account
//       test("Wrap as non-earner - success", async () => {
//         // Setup the instruction
//         const { vaultMTokenAccount, fromMTokenAccount, toExtTokenAccount } =
//           await prepWrap(nonEarnerOne);

//         // Confirm initial balances
//         await expectTokenBalance(fromMTokenAccount, mintAmount);
//         await expectTokenBalance(vaultMTokenAccount, new BN(0));
//         await expectTokenBalance(toExtTokenAccount, new BN(0));

//         const wrapAmount = new BN(randomInt(1, mintAmount.toNumber()));

//         // Send the instruction
//         await extEarn.methods
//           .wrap(wrapAmount)
//           .accountsPartial({ ...accounts })
//           .signers([nonEarnerOne])
//           .rpc();

//         // Confirm updated balances
//         await expectTokenBalance(fromMTokenAccount, mintAmount.sub(wrapAmount));
//         await expectTokenBalance(vaultMTokenAccount, wrapAmount);
//         await expectTokenBalance(toExtTokenAccount, wrapAmount);
//       });
//     });

//     describe("unwrap unit tests", () => {
//       const wrappedAmount = new BN(50_000_000);
//       beforeEach(async () => {
//         // Wrap tokens for the users so we can test unwrapping
//         await wrap(earnerOne, wrappedAmount);
//         await wrap(nonEarnerOne, wrappedAmount);
//       });

//       // test cases
//       // [X] given the m mint account does not match the one stored in the global account
//       //   [X] it reverts with an InvalidAccount error
//       // [X] given the ext mint account does not match the one stored in the global account
//       //   [X] it reverts with an InvalidAccount error
//       // [X] given the signer is not the authority on the from ext token account
//       //   [X] it reverts with a ConstraintTokenOwner error
//       // [X] given the vault M token account is not the M Vaults ATA for the M token mint
//       //   [X] it reverts with a ConstraintAssociated error
//       // [X] given the to m token account is for the wrong mint
//       //   [X] it reverts with a ConstraintTokenMint error
//       // [X] given the from ext token account is for the wrong mint
//       //   [X] it reverts with a ConstraintTokenMint error
//       // [X] given all the accounts are correct
//       //   [X] given the user does not have enough ext tokens
//       //     [X] it reverts
//       //   [X] given the user has enough ext tokens
//       //     [X] it transfers the amount of M tokens from the M vault token account to the user's M token account
//       //     [X] it burns the amount of ext tokens from the user's ext token account
//       // TODO there are a couple other account constraints that can be tested

//       // given the m mint account does not match the one stored in the global account
//       // it reverts with an InvalidAccount error
//       test("M mint account does not match global account - reverts", async () => {
//         // Setup the instruction
//         await prepUnwrap(earnerOne);

//         // Change the m mint account
//         accounts.mMint = extMint.publicKey;

//         // Attempt to send the transaction
//         // Expect an invalid account error
//         await expectAnchorError(
//           extEarn.methods
//             .unwrap(wrappedAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc(),
//           "InvalidAccount"
//         );
//       });

//       // given the ext mint account does not match the one stored in the global account
//       // it reverts with an InvalidAccount error
//       test("Ext mint account does not match global account - reverts", async () => {
//         // Setup the instruction
//         await prepUnwrap(earnerOne);

//         // Change the ext mint account
//         accounts.extMint = mMint.publicKey;

//         // Attempt to send the transaction
//         // Expect an invalid account error
//         await expectAnchorError(
//           extEarn.methods
//             .unwrap(wrappedAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc(),
//           "InvalidAccount"
//         );
//       });

//       // given the signer is not the authority on the user M token account
//       // it reverts with an error on the token program
//       test("Signer is not the authority on the from Ext token account - reverts", async () => {
//         // Get the ATA for another user
//         const mATA = await getATA(mMint.publicKey, earnerOne.publicKey);
//         const wrongExtATA = await getATA(
//           extMint.publicKey,
//           nonEarnerOne.publicKey
//         );

//         // Setup the instruction with the wrong user M token account
//         await prepUnwrap(earnerOne, mATA, wrongExtATA);

//         // Attempt to send the transaction
//         // Expect revert in token program due to permissions error
//         await expectSystemError(
//           extEarn.methods
//             .unwrap(wrappedAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc()
//         );
//       });

//       // given the M vault token account is not the M vault PDA's ATA
//       // it reverts with a ConstraintAssociated error
//       test("M Vault Token account is the the M Vault PDA's ATA (other token account) - reverts", async () => {
//         // Create a token account for the M vault that is not the ATA
//         const tokenAccountKeypair = Keypair.generate();
//         const tokenAccountLen = getAccountLen([ExtensionType.ImmutableOwner]);
//         const lamports =
//           await provider.connection.getMinimumBalanceForRentExemption(
//             tokenAccountLen
//           );

//         const mVault = getMVault();

//         // Create token account with the immutable owner extension
//         const transaction = new Transaction().add(
//           SystemProgram.createAccount({
//             fromPubkey: admin.publicKey,
//             newAccountPubkey: tokenAccountKeypair.publicKey,
//             space: tokenAccountLen,
//             lamports,
//             programId: TOKEN_2022_PROGRAM_ID,
//           }),
//           createInitializeImmutableOwnerInstruction(
//             tokenAccountKeypair.publicKey,
//             TOKEN_2022_PROGRAM_ID
//           ),
//           createInitializeAccountInstruction(
//             tokenAccountKeypair.publicKey,
//             mMint.publicKey,
//             mVault,
//             TOKEN_2022_PROGRAM_ID
//           )
//         );

//         await provider.send!(transaction, [admin, tokenAccountKeypair]);

//         // Setup the instruction with the non-ATA vault m token account
//         await prepUnwrap(
//           earnerOne,
//           undefined,
//           undefined,
//           tokenAccountKeypair.publicKey
//         );

//         // Attempt to send the transaction
//         // Expect revert with a ConstraintAssociated error
//         await expectAnchorError(
//           extEarn.methods
//             .unwrap(wrappedAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc(),
//           "ConstraintAssociated"
//         );
//       });

//       // given the user m token account is for the wrong mint
//       // it reverts with a ConstraintTokenMint error
//       test("To M token account is for wrong mint - reverts", async () => {
//         // Get the user's ATA for the ext mint and pass it as the user M token account
//         const wrongUserATA = await getATA(
//           extMint.publicKey,
//           earnerOne.publicKey
//         );

//         // Setup the instruction
//         await prepUnwrap(earnerOne, wrongUserATA);

//         // Attempt to send the transaction
//         // Expect revert with a ConstraintTokenMint error
//         await expectAnchorError(
//           extEarn.methods
//             .unwrap(wrappedAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc(),
//           "ConstraintTokenMint"
//         );
//       });

//       // given the user ext token account is for the wrong mint
//       // it reverts with a ConstraintTokenMint error
//       test("From Ext token account is for the wrong mint - reverts", async () => {
//         // Get the user's ATA for the m mint and pass it as the user ext token account
//         const wrongUserATA = await getATA(mMint.publicKey, earnerOne.publicKey);

//         // Setup the instruction
//         await prepUnwrap(earnerOne, undefined, wrongUserATA);

//         // Attempt to send the transaction
//         // Expect revert with a ConstraintTokenMint error
//         await expectAnchorError(
//           extEarn.methods
//             .unwrap(wrappedAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc(),
//           "ConstraintTokenMint"
//         );
//       });

//       // given all accounts are correct
//       // give the user does not have enough ext tokens
//       // it reverts
//       test("Not enough ext tokens - reverts", async () => {
//         // Setup the instruction
//         await prepUnwrap(earnerOne);

//         const unwrapAmount = new BN(
//           randomInt(wrappedAmount.toNumber() + 1, 2 ** 48 - 1)
//         );

//         // Attempt to send the transaction
//         // Expect an error
//         await expectSystemError(
//           extEarn.methods
//             .unwrap(unwrapAmount)
//             .accountsPartial({ ...accounts })
//             .signers([earnerOne])
//             .rpc()
//         );
//       });

//       // given all accounts are correct
//       // given the user has enough ext tokens
//       // it transfers the amount of M tokens from the M vault token account to the user's M token account
//       // it burns the amount of ext tokens from the user's ext token account
//       test("Unwrap as ext earner - success", async () => {
//         // Setup the instruction
//         const { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount } =
//           await prepUnwrap(earnerOne);

//         // Confirm initial balances
//         await expectTokenBalance(
//           toMTokenAccount,
//           mintAmount.sub(wrappedAmount)
//         );
//         await expectTokenBalance(
//           vaultMTokenAccount,
//           wrappedAmount.add(wrappedAmount)
//         );
//         await expectTokenBalance(fromExtTokenAccount, wrappedAmount);

//         const unwrapAmount = new BN(randomInt(1, wrappedAmount.toNumber()));

//         // Send the instruction
//         await extEarn.methods
//           .unwrap(unwrapAmount)
//           .accountsPartial({ ...accounts })
//           .signers([earnerOne])
//           .rpc();

//         // Confirm updated balances
//         await expectTokenBalance(
//           toMTokenAccount,
//           mintAmount.sub(wrappedAmount).add(unwrapAmount)
//         );
//         await expectTokenBalance(
//           vaultMTokenAccount,
//           wrappedAmount.add(wrappedAmount).sub(unwrapAmount)
//         );
//         await expectTokenBalance(
//           fromExtTokenAccount,
//           wrappedAmount.sub(unwrapAmount)
//         );
//       });

//       // given all accounts are correct
//       // given the user has enough ext tokens
//       // it transfers the amount of M tokens from the M vault token account to the user's M token account
//       // it burns the amount of ext tokens from the user's ext token account
//       test("Unwrap as non-earner - success", async () => {
//         // Setup the instruction
//         const { vaultMTokenAccount, toMTokenAccount, fromExtTokenAccount } =
//           await prepUnwrap(nonEarnerOne);

//         // Confirm initial balances
//         await expectTokenBalance(
//           toMTokenAccount,
//           mintAmount.sub(wrappedAmount)
//         );
//         await expectTokenBalance(
//           vaultMTokenAccount,
//           wrappedAmount.add(wrappedAmount)
//         );
//         await expectTokenBalance(fromExtTokenAccount, wrappedAmount);

//         const unwrapAmount = new BN(randomInt(1, wrappedAmount.toNumber()));

//         // Send the instruction
//         await extEarn.methods
//           .unwrap(unwrapAmount)
//           .accountsPartial({ ...accounts })
//           .signers([nonEarnerOne])
//           .rpc();

//         // Confirm updated balances
//         await expectTokenBalance(
//           toMTokenAccount,
//           mintAmount.sub(wrappedAmount).add(unwrapAmount)
//         );
//         await expectTokenBalance(
//           vaultMTokenAccount,
//           wrappedAmount.add(wrappedAmount).sub(unwrapAmount)
//         );
//         await expectTokenBalance(
//           fromExtTokenAccount,
//           wrappedAmount.sub(unwrapAmount)
//         );
//       });
//     });

//     describe("remove_orphaned_earner unit tests", () => {
//       // test cases
//       // [X] given the earner account is not initialized
//       //   [X] it reverts with an account not initialized error
//       // [X] given the earn manager account is not initialized
//       //   [X] it reverts with an account not initialized error
//       // [X] given the earn manager account does not match the one on the earner account
//       //   [X] it reverts with a ConstraintSeeds error
//       // [X] given all the accounts are valid
//       //   [X] given the earner has an earn manager
//       //     [X] given the earn manager account is active
//       //       [X] it reverts with a Active error
//       //     [X] given the earn manager account is not active
//       //       [X] it closes the earner account and refunds the rent to the signer

//       beforeEach(async () => {
//         // Add another earn manager
//         await addEarnManager(earnManagerTwo.publicKey, new BN(0));

//         // Add an earner under the new earn manager
//         await addEarner(earnManagerTwo, earnerTwo.publicKey);

//         // Remove earn manager two so that earner two is orphaned
//         await removeEarnManager(earnManagerTwo.publicKey);
//       });

//       // given the earner account is not initialized
//       // it reverts with an account not initialized error
//       test("Earner account is not initialized - reverts", async () => {
//         // Calculate the ATA for non earner one, but don't create it
//         const nonInitATA = getAssociatedTokenAddressSync(
//           extMint.publicKey,
//           nonEarnerOne.publicKey,
//           true,
//           TOKEN_2022_PROGRAM_ID,
//           ASSOCIATED_TOKEN_PROGRAM_ID
//         );

//         // Setup the instruction
//         prepRemoveOrphanedEarner(
//           nonAdmin,
//           nonInitATA,
//           earnManagerOne.publicKey
//         );

//         // Attempt to remove orphaned earner with uninitialized token account
//         await expectAnchorError(
//           extEarn.methods
//             .removeOrphanedEarner()
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "AccountNotInitialized"
//         );
//       });

//       // given the earn manager account is not initialized
//       // it reverts with an account not initialized error
//       test("Earn manager account is not initialized - reverts", async () => {
//         // Get the ATA for earner two
//         const earnerTwoATA = await getATA(
//           extMint.publicKey,
//           earnerTwo.publicKey
//         );

//         // Prepare the instruction
//         prepRemoveOrphanedEarner(
//           nonAdmin,
//           earnerTwoATA,
//           nonEarnManagerOne.publicKey
//         );

//         // Attempt to remove orphaned earner with uninitialized earn manager account
//         await expectAnchorError(
//           extEarn.methods
//             .removeOrphanedEarner()
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "AccountNotInitialized"
//         );
//       });

//       // given all the accounts are valid
//       // given the earner has an earn manager
//       // given the earn manager account is active
//       // it reverts with an Active error
//       test("Earn manager account is active - reverts", async () => {
//         // Get the ATA for earner one
//         const earnerOneATA = await getATA(
//           extMint.publicKey,
//           earnerOne.publicKey
//         );

//         // Setup the instruction
//         prepRemoveOrphanedEarner(
//           nonAdmin,
//           earnerOneATA,
//           earnManagerOne.publicKey
//         );

//         // Attempt to remove orphaned earner with an active earn manager
//         await expectAnchorError(
//           extEarn.methods
//             .removeOrphanedEarner()
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "Active"
//         );
//       });

//       // given the earn manager account does not match the earner's earn manager
//       // it reverts with a ConstraintSeeds error
//       test("Invalid earn manager account - reverts", async () => {
//         const earnerTwoATA = await getATA(
//           extMint.publicKey,
//           earnerTwo.publicKey
//         );

//         // Setup the instruction
//         await prepRemoveOrphanedEarner(
//           nonAdmin,
//           earnerTwoATA,
//           earnManagerOne.publicKey
//         );

//         // Attempt to remove orphaned earner with the wrong earn manager account
//         // expect revert with ConstraintSeeds error
//         await expectAnchorError(
//           extEarn.methods
//             .removeOrphanedEarner()
//             .accountsPartial({ ...accounts })
//             .signers([nonAdmin])
//             .rpc(),
//           "ConstraintSeeds"
//         );
//       });

//       // given all the accounts are valid
//       // given the earner has an earn manager
//       // given the earn manager account is not active
//       // it closes the earner account and refunds the rent to the signer
//       test("Remove orphaned earner - success", async () => {
//         // Get the ATA for earnerTwo
//         const earnerTwoATA = await getATA(
//           extMint.publicKey,
//           earnerTwo.publicKey
//         );

//         // Setup the instruction
//         const { earnerAccount, earnManagerAccount } = prepRemoveOrphanedEarner(
//           nonAdmin,
//           earnerTwoATA,
//           earnManagerTwo.publicKey
//         );

//         // Confirm that the account is active and has the correct earn manager
//         await expectEarnerState(earnerAccount, {
//           earnManager: earnManagerTwo.publicKey,
//         });

//         // Confirm that the earn manager account is not active
//         await expectEarnManagerState(earnManagerAccount, {
//           isActive: false,
//         });

//         // Remove the orphaned earner
//         await extEarn.methods
//           .removeOrphanedEarner()
//           .accountsPartial({ ...accounts })
//           .signers([nonAdmin])
//           .rpc();

//         // Verify the earner account was closed
//         expectAccountEmpty(earnerAccount);
//       });
//     });

//     describe("test against swap program", () => {
//       test("wrap and unwrap", async () => {
//         // Initialize the swap program and add the extension
//         await swapProgram.methods
//           .initializeGlobal(mMint.publicKey)
//           .accounts({ admin: admin.publicKey })
//           .signers([admin])
//           .rpc();

//         await swapProgram.methods
//           .whitelistExtension(extEarn.programId)
//           .accounts({ admin: admin.publicKey })
//           .signers([admin])
//           .rpc();

//         // Add swap program as authority
//         await extEarn.methods
//           .addWrapAuthority(
//             PublicKey.findProgramAddressSync(
//               [Buffer.from("global")],
//               swapProgram.programId
//             )[0]
//           )
//           .accounts({ admin: admin.publicKey })
//           .signers([admin])
//           .rpc();

//         await mintM(earnerOne.publicKey, new BN(1000));

//         // Wrap
//         await swapProgram.methods
//           .wrap(new BN(100))
//           .accountsPartial({
//             signer: earnerOne.publicKey,
//             wrapAuthority: admin.publicKey,
//             toMint: extMint.publicKey,
//             toTokenProgram: TOKEN_2022_PROGRAM_ID,
//             mTokenProgram: TOKEN_2022_PROGRAM_ID,
//             toExtProgram: extEarn.programId,
//             mMint: mMint.publicKey,
//           })
//           .signers([earnerOne, admin])
//           .rpc();

//         // Allow earnerOne to unwrap
//         await swapProgram.methods
//           .whitelistUnwrapper(earnerOne.publicKey)
//           .accounts({ admin: admin.publicKey })
//           .signers([admin])
//           .rpc();

//         // Unwrap
//         await swapProgram.methods
//           .unwrap(new BN(100))
//           .accountsPartial({
//             signer: earnerOne.publicKey,
//             unwrapAuthority: admin.publicKey,
//             fromMint: extMint.publicKey,
//             fromTokenProgram: TOKEN_2022_PROGRAM_ID,
//             mTokenProgram: TOKEN_2022_PROGRAM_ID,
//             fromExtProgram: extEarn.programId,
//             mMint: mMint.publicKey,
//           })
//           .signers([earnerOne, admin])
//           .rpc();
//       });
//     });
//   });
// });

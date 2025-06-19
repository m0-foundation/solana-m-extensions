import { Command } from "commander";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  AuthorityType,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  createMultisig,
  createSetAuthorityInstruction,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
} from "@solana/spl-token";
import {
  createInitializeInstruction,
  createUpdateAuthorityInstruction,
  createUpdateFieldInstruction,
  pack,
  TokenMetadata,
} from "@solana/spl-token-metadata";

import {
  createInitializeConfidentialTransferMintInstruction,
  createInitializeScaledUiAmountConfigInstruction,
} from "./token-extensions";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";

import { ExtSwap } from "../../target/types/ext_swap";

const EXT_SWAP_IDL = require("../../target/idl/ext_swap.json");
const NO_YIELD_EXT_IDL = require("../../target/idl/no_yield.json");
const SCALED_UI_EXT_IDL = require("../../target/idl/scaled_ui.json");

const M_MINT: PublicKey =
  process.env.NETWORK === "devnet"
    ? new PublicKey("mzeroZRGCah3j5xEWp2Nih3GDejSBbH1rbHoxDg8By6")
    : new PublicKey("mzerokyEX9TNDoK4o2YZQBDmMzjokAeN6M2g2S3pLJo");
const EXT_SWAP: PublicKey = new PublicKey(
  "MSwapi3WhNKMUGm9YrxGhypgUEt7wYQH3ZgG32XoWzH"
);

function keysFromEnv(keys: string[]) {
  return keys.map((key) =>
    Keypair.fromSecretKey(Buffer.from(JSON.parse(process.env[key] ?? "[]")))
  );
}

function anchorProvider(connection: Connection, owner: Keypair) {
  return new AnchorProvider(connection, new Wallet(owner), {
    commitment: "confirmed",
    skipPreflight: false,
  });
}

async function main() {
  const program = new Command();
  const connection = new Connection(process.env.RPC_URL ?? "");

  program
    .command("create-ext-mint")
    .description(
      "Create a new mint for an M extension using the Token2022 program"
    )
    .option("-n, --name <string>", "Token Name", process.env.EXT_NAME)
    .option("-s, --symbol <string>", "Token Symbol", process.env.EXT_SYMBOL)
    .option(
      "-i, --icon-uri [string]",
      "Token Icon URI",
      process.env.EXT_ICON_URI
    )
    .option(
      "--init-scaled-ui",
      "Enable scaled UI amounts",
      process.env.INIT_SCALED_UI
    )
    .option(
      "--init-confidential",
      "Enable confidential transfers",
      process.env.INIT_CONFIDENTIAL
    )
    .option(
      "--init-transfer-hook",
      "Enable transfer hook",
      process.env.INIT_TRANSFER_HOOK
    )
    .action(
      async ({
        name,
        symbol,
        iconUri,
        initScaledUi,
        initConfidential,
        initTransferHook,
      }) => {
        const [payer, mint, ext, owner, freezeAuthority] = keysFromEnv([
          "PAYER_KEYPAIR",
          "EXT_MINT_KEYPAIR",
          "EXT_PROGRAM_KEYPAIR",
          "EXT_OWNER",
          "EXT_FREEZE_AUTHORITY",
        ]);

        // Get the mint authority by deriving the PDA from the extension program
        let mintAuthority = PublicKey.findProgramAddressSync(
          [Buffer.from("mint_authority")],
          ext.publicKey
        )[0];

        // Create the list of extensions
        let extensions: ExtensionType[] = [ExtensionType.MetadataPointer];
        if (initScaledUi) {
          extensions.push(ExtensionType.ScaledUiAmountConfig);
        }
        if (initConfidential) {
          extensions.push(ExtensionType.ConfidentialTransferMint);
        }
        if (initTransferHook) {
          extensions.push(ExtensionType.TransferHook);
        }

        // Create the token 2022 mint with the ScaledUiAmount extension
        await createToken2022Mint(
          connection,
          payer,
          owner.publicKey,
          mint,
          mintAuthority,
          freezeAuthority.publicKey,
          name,
          symbol,
          iconUri ??
            "https://gistcdn.githack.com/SC4RECOIN/a729afb77aa15a4aa6b1b46c3afa1b52/raw/209da531ed46c1aaef0b1d3d7b67b3a5cec257f3/M_Symbol_512.svg",
          extensions
        );

        console.log(`Created token mint at ${mint.publicKey.toBase58()}`);
      }
    );

  program
    .command("create-vault-m-ata")
    .description(
      "Creates an associated token account for the M mint for the extension program's vault PDA."
    )
    .action(async ({}) => {
      const [owner, extProgram] = keysFromEnv([
        "PAYER_KEYPAIR",
        "EXT_PROGRAM_KEYPAIR",
      ]);

      // Create the vault ATA for the ext program if it doesn't exist
      const vault = PublicKey.findProgramAddressSync(
        [Buffer.from("m_vault")],
        extProgram.publicKey
      )[0];
      console.log("Vault PDA:", vault.toBase58());
      const vaultAta = await getOrCreateAssociatedTokenAccount(
        connection,
        owner,
        M_MINT,
        vault,
        true,
        "confirmed",
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      console.log("Vault ATA:", vaultAta.address.toBase58());
    });

  program
    .command("create-ata")
    .description(
      "Creates an associated token account for the provided account on the provided mint"
    )
    .option("-m, --mint <pubkey>", "Mint public key")
    .option("-a, --account <pubkey>", "Account public key")
    .action(async ({ mint, account }) => {
      const [owner] = keysFromEnv(["PAYER_KEYPAIR"]);

      const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        owner,
        new PublicKey(mint),
        new PublicKey(account),
        true,
        "confirmed",
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      console.log("ATA:", ata.address.toBase58());
    });

  program
    .command("initialize-ext")
    .description("Initialize the extension program")
    .option("-v, --variant <string>", "Program variant", process.env.VARIANT)
    .option("-f, --fee [number]", "Fee in bps", "0")
    .action(async ({ variant, fee }) => {
      const [owner, extMint, program] = keysFromEnv([
        "EXT_OWNER",
        "EXT_MINT_KEYPAIR",
        "EXT_PROGRAM_KEYPAIR",
      ]);

      // Setup wrap authorities list
      const swapGlobalSigner = PublicKey.findProgramAddressSync(
        [Buffer.from("global")],
        EXT_SWAP
      )[0];

      const wrapAuthorities: PublicKey[] = [swapGlobalSigner, owner.publicKey];

      let extProgram, tx;

      switch (variant) {
        case "no-yield":
          // Insert the program ID into the IDL so we can interact with it
          NO_YIELD_EXT_IDL.address = program.publicKey.toBase58();

          extProgram = new Program(
            NO_YIELD_EXT_IDL,
            anchorProvider(connection, owner)
          );

          tx = await extProgram.methods
            .initialize(wrapAuthorities)
            .accounts({
              admin: owner.publicKey,
              mMint: M_MINT,
              extMint: extMint.publicKey,
            })
            .signers([owner])
            .rpc();

          console.log(`Initialized no yield extension: ${tx}`);

          break;

        case "scaled-ui":
          // Insert the program ID into the IDL so we can interact with it
          SCALED_UI_EXT_IDL.address = program.publicKey.toBase58();

          extProgram = new Program(
            SCALED_UI_EXT_IDL,
            anchorProvider(connection, owner)
          );

          tx = await extProgram.methods
            .initialize(wrapAuthorities, new BN(fee))
            .accounts({
              admin: owner.publicKey,
              mMint: M_MINT,
              extMint: extMint.publicKey,
            })
            .signers([owner])
            .rpc();

          console.log(`Initialized scaled UI extension: ${tx}`);

          break;
        default:
          throw new Error(`Unknown variant: ${variant}`);
      }
    });

  program
    .command("initialize-ext-swap")
    .description("Initialize the Extension Swap Facility")
    .action(async () => {
      const [owner] = keysFromEnv(["PAYER_KEYPAIR"]);

      const extSwap = new Program<ExtSwap>(
        EXT_SWAP_IDL,
        anchorProvider(connection, owner)
      );

      const tx = await extSwap.methods
        .initializeGlobal(M_MINT)
        .accounts({
          admin: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      console.log(`Initialized Extension Swap Facility: ${tx}`);
    });

  program
    .command("whitelist-extension")
    .description(
      "Whitelist an extension program on the Extension Swap Facility"
    )
    .argument("<extProgramId>", "Extension program ID to whitelist")
    .action(async (extProgramId) => {
      const [owner] = keysFromEnv(["EXT_OWNER"]);

      const extSwap = new Program<ExtSwap>(
        EXT_SWAP_IDL,
        anchorProvider(connection, owner)
      );

      const tx = await extSwap.methods
        .whitelistExtension(new PublicKey(extProgramId))
        .accounts({
          admin: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      console.log(`Whitelisted extension: ${tx}`);
    });

  //   program
  //     .command("update-earn-lut")
  //     .description("Create or update the LUT for common addresses")
  //     .option(
  //       "-a, --address [pubkey]",
  //       "Address of table to update",
  //       "Aq87DiRe8thyDfPhkpe92umFj9VU6bt8o9S9MTAhNC6c"
  //     )
  //     .action(async ({ address }) => {
  //       const [owner] = keysFromEnv(["PAYER_KEYPAIR"]);
  //       const ixs = [
  //         ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }),
  //       ];

  //       // Get or create LUT
  //       let tableAddress: PublicKey;
  //       if (address) {
  //         tableAddress = new PublicKey(address);
  //       } else {
  //         const [lookupTableIx, lookupTableAddress] =
  //           AddressLookupTableProgram.createLookupTable({
  //             authority: owner.publicKey,
  //             payer: owner.publicKey,
  //             recentSlot:
  //               (await connection.getSlot({ commitment: "finalized" })) - 10,
  //           });

  //         console.log(`Creating lookup table: ${lookupTableAddress.toBase58()}`);
  //         tableAddress = lookupTableAddress;
  //         ixs.push(lookupTableIx);
  //       }

  //       // Addresses to add to LUT
  //       const [mMint, wmMint, multisig] = keysFromEnv([
  //         "M_MINT_KEYPAIR",
  //         "WM_MINT_KEYPAIR",
  //         "M_MINT_MULTISIG_KEYPAIR",
  //       ]);
  //       const [portalTokenAuthPda] = PublicKey.findProgramAddressSync(
  //         [Buffer.from("token_authority")],
  //         PROGRAMS.portal
  //       );
  //       const [earnTokenAuthPda] = PublicKey.findProgramAddressSync(
  //         [Buffer.from("token_authority")],
  //         PROGRAMS.earn
  //       );
  //       const [mVaultPda] = PublicKey.findProgramAddressSync(
  //         [Buffer.from("m_vault")],
  //         PROGRAMS.extEarn
  //       );
  //       const [mintAuthPda] = PublicKey.findProgramAddressSync(
  //         [Buffer.from("mint_authority")],
  //         PROGRAMS.extEarn
  //       );
  //       const [global] = PublicKey.findProgramAddressSync(
  //         [Buffer.from("global")],
  //         PROGRAM_ID
  //       );
  //       const [extGlobal] = PublicKey.findProgramAddressSync(
  //         [Buffer.from("global")],
  //         EXT_PROGRAM_ID
  //       );

  //       const globalAccount = await getProgram(connection).account.global.fetch(
  //         global
  //       );
  //       const extGlobalAccount = await getExtProgram(
  //         connection
  //       ).account.extGlobal.fetch(extGlobal);

  //       const addressesForTable = [
  //         PROGRAMS.portal,
  //         PROGRAMS.earn,
  //         PROGRAMS.extEarn,
  //         mMint.publicKey,
  //         wmMint.publicKey,
  //         multisig.publicKey,
  //         portalTokenAuthPda,
  //         earnTokenAuthPda,
  //         mVaultPda,
  //         mintAuthPda,
  //         global,
  //         extGlobal,
  //         globalAccount.earnAuthority,
  //         globalAccount.admin,
  //         extGlobalAccount.earnAuthority,
  //         extGlobalAccount.admin,
  //         TOKEN_2022_PROGRAM_ID,
  //       ];

  //       // Add current earners to LUT
  //       for (const pid of [PROGRAM_ID, EXT_PROGRAM_ID]) {
  //         const auth = await EarnAuthority.load(connection, evmClient, pid);
  //         const earners = await auth.getAllEarners();

  //         for (const earner of earners) {
  //           addressesForTable.push(earner.pubkey, earner.data.userTokenAccount);

  //           // Check if there is an earn manager
  //           if (
  //             earner.data.earnManager &&
  //             !addressesForTable.find((a) => a.equals(earner.data.earnManager!))
  //           ) {
  //             addressesForTable.push(earner.data.earnManager);
  //           }
  //         }
  //       }

  //       // Fetch current state of LUT
  //       let existingAddresses: PublicKey[] = [];
  //       if (address) {
  //         const state = (await connection.getAddressLookupTable(tableAddress))
  //           .value?.state.addresses;
  //         if (!state) {
  //           throw new Error(
  //             `Failed to fetch state for address lookup table ${tableAddress}`
  //           );
  //         }
  //         if (state.length === 256) {
  //           throw new Error("LUT is full");
  //         }

  //         existingAddresses = state;
  //       }

  //       // Dedupe missing addresses
  //       const toAdd = addressesForTable.filter(
  //         (address) => !existingAddresses.find((a) => a.equals(address))
  //       );
  //       if (toAdd.length === 0) {
  //         console.log("No addresses to add");
  //         return;
  //       }

  //       if (existingAddresses.length + toAdd.length > 256) {
  //         throw new Error(`cannot add ${toAdd.length} more addresses`);
  //       }

  //       ixs.push(
  //         AddressLookupTableProgram.extendLookupTable({
  //           payer: owner.publicKey,
  //           authority: owner.publicKey,
  //           lookupTable: tableAddress,
  //           addresses: toAdd,
  //         })
  //       );

  //       // Send transaction
  //       const blockhash = await connection.getLatestBlockhash("finalized");

  //       const messageV0 = new TransactionMessage({
  //         payerKey: owner.publicKey,
  //         recentBlockhash: blockhash.blockhash,
  //         instructions: ixs,
  //       }).compileToV0Message();

  //       const transaction = new VersionedTransaction(messageV0);
  //       transaction.sign([owner]);
  //       const txid = await connection.sendTransaction(transaction);
  //       console.log(`Transaction sent ${txid}\t${toAdd.length} addresses added`);

  //       // Confirm
  //       const confirmation = await connection.confirmTransaction(
  //         {
  //           signature: txid,
  //           blockhash: blockhash.blockhash,
  //           lastValidBlockHeight: blockhash.lastValidBlockHeight,
  //         },
  //         "confirmed"
  //       );
  //       if (confirmation.value.err) {
  //         throw new Error(`Transaction not confirmed: ${confirmation.value.err}`);
  //       }
  //     });

  await program.parseAsync(process.argv);
}

async function createToken2022Mint(
  connection: Connection,
  payer: Keypair,
  owner: PublicKey,
  mint: Keypair,
  mintAuthority: PublicKey,
  freezeAuthority: PublicKey | null,
  tokenName: string,
  tokenSymbol: string,
  tokenUri: string,
  extensions: ExtensionType[],
  evmTokenAddress: string | null = null
) {
  const metaData: TokenMetadata = {
    updateAuthority: owner,
    mint: mint.publicKey,
    name: tokenName,
    symbol: tokenSymbol,
    uri: tokenUri,
    additionalMetadata: evmTokenAddress ? [["evm", evmTokenAddress]] : [],
  };

  // mint size with extensions
  const metadataExtension = TYPE_SIZE + LENGTH_SIZE;
  const metadataLen = pack(metaData).length;
  const mintLen = getMintLen(extensions);
  const lamports = await connection.getMinimumBalanceForRentExemption(
    mintLen + metadataExtension + metadataLen
  );

  const instructions = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
  ];

  for (const extension of extensions) {
    switch (extension) {
      case ExtensionType.MetadataPointer:
        instructions.push(
          createInitializeMetadataPointerInstruction(
            mint.publicKey,
            owner,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID
          )
        );
        break;
      case ExtensionType.ScaledUiAmountConfig:
        instructions.push(
          createInitializeScaledUiAmountConfigInstruction(
            mint.publicKey,
            mintAuthority, // mint authority must be scaled ui config authority
            1.0, // multiplier
            TOKEN_2022_PROGRAM_ID
          )
        );
        break;
      case ExtensionType.TransferHook:
        instructions.push(
          createInitializeTransferHookInstruction(
            mint.publicKey,
            owner, // authority
            PublicKey.default, // no transfer hook
            TOKEN_2022_PROGRAM_ID
          )
        );
        break;
      case ExtensionType.ConfidentialTransferMint:
        instructions.push(
          createInitializeConfidentialTransferMintInstruction(
            mint.publicKey,
            owner,
            false
          )
        );
        break;
      default:
        throw new Error(`Unsupported extension: ${extension}`);
    }
  }

  instructions.push(
    ...[
      createInitializeMintInstruction(
        mint.publicKey,
        6,
        payer.publicKey, // will transfer on last instruction
        freezeAuthority, // if null, there is no freeze authority
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint.publicKey,
        updateAuthority: payer.publicKey,
        mint: mint.publicKey,
        mintAuthority: payer.publicKey,
        name: metaData.name,
        symbol: metaData.symbol,
        uri: metaData.uri,
      }),
    ]
  );

  if (evmTokenAddress) {
    instructions.push(
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint.publicKey,
        updateAuthority: payer.publicKey,
        field: metaData.additionalMetadata[0][0],
        value: metaData.additionalMetadata[0][1],
      })
    );
  }

  instructions.push(
    ...[
      // transfer metadata and mint authorities
      createUpdateAuthorityInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint.publicKey,
        oldAuthority: payer.publicKey,
        newAuthority: owner,
      }),
      createSetAuthorityInstruction(
        mint.publicKey,
        payer.publicKey,
        AuthorityType.MintTokens,
        mintAuthority,
        undefined,
        TOKEN_2022_PROGRAM_ID
      ),
    ]
  );

  const blockhash = await connection.getLatestBlockhash();
  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash.blockhash,
    instructions,
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([payer, mint]);

  await connection.sendTransaction(transaction);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

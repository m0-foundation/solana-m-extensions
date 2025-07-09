import { Command } from "commander";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
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
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { PROGRAM_ID as EARN_PID } from "@m0-foundation/solana-m-sdk";

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

  program.command("print-extensions").action(() => {
    const [usdk, usdky] = keysFromEnv(["KAST_USDK", "KAST_USDKY"]);

    const addresses: { [key: string]: PublicKey } = {
      "USDK program": usdk.publicKey,
      "USDK vault": PublicKey.findProgramAddressSync(
        [Buffer.from("m_vault")],
        usdk.publicKey
      )[0],
      "USDKY program": usdky.publicKey,
      "USDKY vault": PublicKey.findProgramAddressSync(
        [Buffer.from("m_vault")],
        usdky.publicKey
      )[0],
    };

    const tableData = Object.entries(addresses).map(([name, pubkey]) => ({
      Name: name,
      Address: pubkey.toBase58(),
      Hex: `0x${pubkey.toBuffer().toString("hex")}`,
    }));

    console.table(tableData);
  });

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
        const [payer, mint, ext] = keysFromEnv([
          "PAYER_KEYPAIR",
          "EXT_MINT_KEYPAIR",
          "EXT_PROGRAM_KEYPAIR",
        ]);

        console.log(
          `Deploying ${mint.publicKey.toBase58()} for extension program ${ext.publicKey.toBase58()}`
        );

        const authority = process.env.SQUADS_MULTISIG
          ? new PublicKey(process.env.SQUADS_MULTISIG)
          : payer.publicKey;

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
          authority,
          mint,
          mintAuthority,
          authority, // freeze authority
          name,
          symbol,
          iconUri,
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
    .option("-v, --variant <string>", "Program variant", "no-yield")
    .option("-f, --fee [number]", "Fee in bps", "0")
    .action(async ({ variant, fee }) => {
      const [payer, extMint, program] = keysFromEnv([
        "PAYER_KEYPAIR",
        "EXT_MINT_KEYPAIR",
        "EXT_PROGRAM_KEYPAIR",
      ]);

      const admin = process.env.SQUADS_MULTISIG
        ? new PublicKey(process.env.SQUADS_MULTISIG)
        : payer.publicKey;

      // Setup wrap authorities list
      const swapGlobalSigner = PublicKey.findProgramAddressSync(
        [Buffer.from("global")],
        EXT_SWAP
      )[0];
      const portalTokenAuth = PublicKey.findProgramAddressSync(
        [Buffer.from("TOKEN_AUTHORITY_SEED")],
        new PublicKey("mzp1q2j5Hr1QuLC3KFBCAUz5aUckT6qyuZKZ3WJnMmY")
      )[0];

      const wrapAuthorities: PublicKey[] = [
        swapGlobalSigner,
        portalTokenAuth,
        admin,
      ];

      let transaction: Transaction;
      switch (variant) {
        case "no-yield":
          // Insert the program ID into the IDL so we can interact with it
          NO_YIELD_EXT_IDL.address = program.publicKey.toBase58();

          const noYieldProgram = new Program(
            NO_YIELD_EXT_IDL,
            anchorProvider(connection, payer)
          );

          transaction = await noYieldProgram.methods
            .initialize(wrapAuthorities)
            .accounts({
              admin: admin,
              mMint: M_MINT,
              extMint: extMint.publicKey,
            })
            .transaction();

          console.log("Initialized no yield extension");
          break;

        case "scaled-ui":
          // Insert the program ID into the IDL so we can interact with it
          SCALED_UI_EXT_IDL.address = program.publicKey.toBase58();

          const suiProgram = new Program(
            SCALED_UI_EXT_IDL,
            anchorProvider(connection, payer)
          );

          transaction = await suiProgram.methods
            .initialize(wrapAuthorities, new BN(fee))
            .accounts({
              admin: admin,
              mMint: M_MINT,
              extMint: extMint.publicKey,
            })
            .transaction();

          console.log("Initialized scaled UI extension");

          break;
        default:
          throw new Error(`Unknown variant: ${variant}`);
      }

      transaction.feePayer = admin;
      transaction.recentBlockhash = (
        await connection.getLatestBlockhash()
      ).blockhash;

      if (process.env.SQUADS_MULTISIG) {
        const b = transaction.serialize({ verifySignatures: false });
        console.log("Transaction:", {
          b64: b.toString("base64"),
          b58: bs58.encode(b),
        });
      } else {
        const sig = await connection.sendTransaction(transaction, [payer]);
        console.log(`Initialized Extension Swap Facility: ${sig}`);
      }
    });

  program
    .command("initialize-ext-swap")
    .description("Initialize the Extension Swap Facility")
    .action(async () => {
      const [payer] = keysFromEnv(["PAYER_KEYPAIR"]);
      const admin = process.env.SQUADS_MULTISIG
        ? new PublicKey(process.env.SQUADS_MULTISIG)
        : payer.publicKey;

      const extSwap = new Program<ExtSwap>(
        EXT_SWAP_IDL,
        anchorProvider(connection, payer)
      );

      const tx = await extSwap.methods
        .initializeGlobal()
        .accounts({
          admin,
        })
        .transaction();

      tx.feePayer = admin;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      if (process.env.SQUADS_MULTISIG) {
        const b = tx.serialize({ verifySignatures: false });
        console.log("Transaction:", {
          b64: b.toString("base64"),
          b58: bs58.encode(b),
        });
      } else {
        const sig = await connection.sendTransaction(tx, [payer]);
        console.log(`Initialized Extension Swap Facility: ${sig}`);
      }
    });

  program
    .command("add-wrap-authority")
    .description("Add a wrap authority on the Extension program")
    .argument(
      "<wrapAuthorities>",
      "Comma-separated list of pubkeys to whitelist"
    )
    .action(async (wrapAuthorities) => {
      const [payer, extProgram] = keysFromEnv([
        "PAYER_KEYPAIR",
        "EXT_PROGRAM_KEYPAIR",
      ]);

      const admin = process.env.SQUADS_MULTISIG
        ? new PublicKey(process.env.SQUADS_MULTISIG)
        : payer.publicKey;

      // Insert the program ID into the IDL so we can interact with it
      NO_YIELD_EXT_IDL.address = extProgram.publicKey.toBase58();

      const ext = new Program(
        NO_YIELD_EXT_IDL,
        anchorProvider(connection, payer)
      );

      const tx = new Transaction();

      for (const auth of wrapAuthorities.split(",")) {
        tx.add(
          await ext.methods
            .addWrapAuthority(new PublicKey(auth))
            .accounts({
              admin,
            })
            .instruction()
        );
      }

      tx.feePayer = admin;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      if (process.env.SQUADS_MULTISIG) {
        const b = tx.serialize({ verifySignatures: false });
        console.log("Transaction:", {
          b64: b.toString("base64"),
          b58: bs58.encode(b),
        });
      } else {
        const sig = await connection.sendTransaction(tx, [payer]);
        console.log(`Added wrap authorties: ${sig}`);
      }
    });

  program
    .command("whitelist-swap-unwrapper")
    .description("Whitelist an unwrapper on the swap program")
    .argument("<authorities>", "Comma-separated list of pubkeys to whitelist")
    .action(async (auths) => {
      const [payer] = keysFromEnv(["PAYER_KEYPAIR"]);
      const admin = new PublicKey(process.env.SQUADS_MULTISIG!);

      const swap = new Program<ExtSwap>(
        EXT_SWAP_IDL,
        anchorProvider(connection, payer)
      );

      const tx = new Transaction();

      for (const auth of auths.split(",")) {
        tx.add(
          await swap.methods
            .whitelistUnwrapper(new PublicKey(auth))
            .accounts({
              admin,
            })
            .instruction()
        );
      }

      tx.feePayer = admin;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const b = tx.serialize({ verifySignatures: false });
      console.log("Transaction:", {
        b64: b.toString("base64"),
        b58: bs58.encode(b),
      });
    });

  program
    .command("whitelist-extensions")
    .description("Whitelist extensions on the Swap Facility")
    .argument("<extensions>", "Comma-separated list of extensions")
    .action(async (extensions) => {
      const [payer] = keysFromEnv(["PAYER_KEYPAIR"]);

      const admin = process.env.SQUADS_MULTISIG
        ? new PublicKey(process.env.SQUADS_MULTISIG)
        : payer.publicKey;

      const extSwap = new Program<ExtSwap>(
        EXT_SWAP_IDL,
        anchorProvider(connection, payer)
      );

      const tx = new Transaction();

      for (const ext of extensions.split(",")) {
        tx.add(
          await extSwap.methods
            .whitelistExtension()
            .accountsPartial({
              admin,
              extProgram: new PublicKey(ext),
            })
            .instruction()
        );
      }

      tx.feePayer = admin;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      if (process.env.SQUADS_MULTISIG) {
        const b = tx.serialize({ verifySignatures: false });
        console.log("Transaction:", {
          b64: b.toString("base64"),
          b58: bs58.encode(b),
        });
      } else {
        const sig = await connection.sendTransaction(tx, [payer]);
        console.log(`Added extensions: ${sig}`);
      }
    });

  program
    .command("update-swap-lut")
    .description("Create or update the LUT for common addresses")
    .action(async () => {
      const [owner, wM, ext1, ext2] = keysFromEnv([
        "PAYER_KEYPAIR",
        "M0_WM",
        "KAST_USDK",
        "KAST_USDKY",
      ]);
      const ixs = [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }),
      ];

      // Get or create LUT
      let tableAddress: PublicKey;
      if (process.env.LOOKUP_TABLE) {
        tableAddress = new PublicKey(process.env.LOOKUP_TABLE);
      } else {
        const [lookupTableIx, lookupTableAddress] =
          AddressLookupTableProgram.createLookupTable({
            authority: owner.publicKey,
            payer: owner.publicKey,
            recentSlot:
              (await connection.getSlot({ commitment: "finalized" })) - 10,
          });

        console.log(`Creating lookup table: ${lookupTableAddress.toBase58()}`);
        tableAddress = lookupTableAddress;
        ixs.push(lookupTableIx);
      }

      const addressesForTable = [EXT_SWAP];

      // Swap program addresses
      addressesForTable.push(
        PublicKey.findProgramAddressSync([Buffer.from("global")], EXT_SWAP)[0],
        PublicKey.findProgramAddressSync([Buffer.from("global")], EARN_PID)[0],
        M_MINT
      );

      // Extension mints
      const mints: { [key: string]: string } = {
        extaykYu5AQcDm3qZAbiDN3yp6skqn6Nssj7veUUGZw:
          "usdkbee86pkLyRmxfFCdkyySpxRb5ndCxVsK2BkRXwX",
        extMahs9bUFMYcviKCvnSRaXgs5PcqmMzcnHRtTqE85:
          "usdkyPPxgV7sfNyKb8eDz66ogPrkRXG3wS2FVb6LLUf",
        Fb2AsCKmPd4gKhabT6KsremSHMrJ8G2Mopnc6rDQZX9e:
          "usdkbee86pkLyRmxfFCdkyySpxRb5ndCxVsK2BkRXwX",
        "3PskKTHgboCbUSQPMcCAZdZNFHbNvSoZ8zEFYANCdob7":
          "usdkyPPxgV7sfNyKb8eDz66ogPrkRXG3wS2FVb6LLUf",
        wMXX1K1nca5W4pZr1piETe78gcAVVrEFi9f4g46uXko:
          "mzeroXDoBpRVhnEXBra27qzAMdxgpWVY3DzQW7xMVJp",
      };

      // Add common addresses for each extension
      for (const ext of [wM, ext1, ext2]) {
        const mint = new PublicKey(mints[ext.publicKey.toBase58()]);

        const vault = PublicKey.findProgramAddressSync(
          [Buffer.from("m_vault")],
          ext.publicKey
        )[0];

        const vaultAta = getAssociatedTokenAddressSync(
          mint,
          vault,
          true,
          TOKEN_2022_PROGRAM_ID
        );

        addressesForTable.push(
          ext.publicKey,
          PublicKey.findProgramAddressSync(
            [Buffer.from("global")],
            ext.publicKey
          )[0],
          mint,
          vault,
          PublicKey.findProgramAddressSync(
            [Buffer.from("mint_authority")],
            ext.publicKey
          )[0],
          vaultAta
        );
      }

      // Fetch current state of LUT
      let existingAddresses: PublicKey[] = [];
      if (process.env.LOOKUP_TABLE) {
        const state = (await connection.getAddressLookupTable(tableAddress))
          .value?.state.addresses;
        if (!state) {
          throw new Error(
            `Failed to fetch state for address lookup table ${tableAddress}`
          );
        }
        if (state.length === 256) {
          throw new Error("LUT is full");
        }

        existingAddresses = state;
      }

      // Dedupe missing addresses
      const toAdd = addressesForTable.filter(
        (address) => !existingAddresses.find((a) => a.equals(address))
      );
      if (toAdd.length === 0) {
        console.log("No addresses to add");
        return;
      }

      if (existingAddresses.length + toAdd.length > 256) {
        throw new Error(`cannot add ${toAdd.length} more addresses`);
      }

      ixs.push(
        AddressLookupTableProgram.extendLookupTable({
          payer: owner.publicKey,
          authority: owner.publicKey,
          lookupTable: tableAddress,
          addresses: toAdd,
        })
      );

      // Send transaction
      const blockhash = await connection.getLatestBlockhash("finalized");

      const messageV0 = new TransactionMessage({
        payerKey: owner.publicKey,
        recentBlockhash: blockhash.blockhash,
        instructions: ixs,
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([owner]);
      const txid = await connection.sendTransaction(transaction);
      console.log(`Transaction sent ${txid}\t${toAdd.length} addresses added`);

      // Confirm
      const confirmation = await connection.confirmTransaction(
        {
          signature: txid,
          blockhash: blockhash.blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
        },
        "confirmed"
      );
      if (confirmation.value.err) {
        throw new Error(`Transaction not confirmed: ${confirmation.value.err}`);
      }
    });

  await program.parseAsync(process.argv);
}

async function createToken2022Mint(
  connection: Connection,
  payer: Keypair,
  authority: PublicKey,
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
    updateAuthority: authority,
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
            authority,
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
            authority,
            PublicKey.default, // no transfer hook
            TOKEN_2022_PROGRAM_ID
          )
        );
        break;
      case ExtensionType.ConfidentialTransferMint:
        instructions.push(
          createInitializeConfidentialTransferMintInstruction(
            mint.publicKey,
            authority,
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
        newAuthority: authority,
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

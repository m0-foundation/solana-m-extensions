import { Command } from "commander";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
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
        .initializeGlobal()
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
        .whitelistExtension()
        .accounts({
          extProgram: new PublicKey(extProgramId),
        })
        .signers([owner])
        .rpc();

      console.log(`Whitelisted extension: ${tx}`);
    });

  program
    .command("add-wrap-authority")
    .description("Add a wrap authority on the Extension program")
    .argument("<wrapAuthority>", "Pubkey of wrap authority to whitelist")
    .action(async (wrapAuthority) => {
      const [owner, extProgram] = keysFromEnv([
        "EXT_OWNER",
        "EXT_PROGRAM_KEYPAIR",
      ]);

      // Insert the program ID into the IDL so we can interact with it
      NO_YIELD_EXT_IDL.address = extProgram.publicKey.toBase58();

      const ext = new Program(
        NO_YIELD_EXT_IDL,
        anchorProvider(connection, owner)
      );

      const tx = await ext.methods
        .addWrapAuthority(new PublicKey(wrapAuthority))
        .accounts({
          admin: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      console.log(`Added wrap authority: ${tx}`);
    });

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

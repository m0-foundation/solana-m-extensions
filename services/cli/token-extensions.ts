import {
  TokenInstruction,
  TOKEN_2022_PROGRAM_ID,
  initializeScaledUiAmountConfigInstructionData,
} from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { struct, u8, f64 } from "@solana/buffer-layout";
import { publicKey, u64 } from "@solana/buffer-layout-utils";

interface InitializeConfidentialTransferMintInstructionData {
  instruction: TokenInstruction.ConfidentialTransferExtension;
  confidentialTransferInstruction: 0;
  authority: PublicKey | null;
  autoApproveNewAccounts: boolean;
  auditorElgamalPubkey: PublicKey | null;
}

const initializeConfidentialTransferMintInstructionData =
  struct<InitializeConfidentialTransferMintInstructionData>([
    u8("instruction"),
    u8("confidentialTransferInstruction"),
    publicKey("authority"),
    u8("autoApproveNewAccounts"),
    publicKey("auditorElgamalPubkey"),
  ]);

/*
 * Confidential tranfers are not yet supported. However, we should still set up the extension in the event they are supported and we want to use them.
 * Note: when both TransferFeeConfig and ConfidentialTransferMint are enabled, ConfidentialTransferFeeConfig is also required.
 * Reference: https://github.com/jup-ag/jup-lock/blob/main/tests/locker_utils/token_2022/confidential_transfer.ts
 */
export function createInitializeConfidentialTransferMintInstruction(
  mint: PublicKey,
  authority: PublicKey,
  autoApproveNewAccounts: boolean = true,
  auditorElgamalPubkey: PublicKey = PublicKey.default,
  programId: PublicKey = TOKEN_2022_PROGRAM_ID
): TransactionInstruction {
  const keys = [{ pubkey: mint, isSigner: false, isWritable: true }];
  const data = Buffer.alloc(
    initializeConfidentialTransferMintInstructionData.span
  );
  initializeConfidentialTransferMintInstructionData.encode(
    {
      instruction: TokenInstruction.ConfidentialTransferExtension,
      confidentialTransferInstruction: 0,
      authority,
      auditorElgamalPubkey,
      autoApproveNewAccounts,
    },
    data
  );

  return new TransactionInstruction({ keys, programId, data });
}

// Scaled UI Amount Config Extension Types and Functions since not supported in spl-token library yet
interface InitializeScaledUiAmountConfigData {
  instruction: 43;
  scaledUiAmountInstruction: 0;
  authority: PublicKey | null;
  multiplier: number;
}

const InitializeScaledUiAmountConfigInstructionData =
  struct<InitializeScaledUiAmountConfigData>([
    u8("instruction"),
    u8("scaledUiAmountInstruction"),
    publicKey("authority"),
    f64("multiplier"),
  ]);

interface ScaledUiAmountConfig {
  authority: PublicKey;
  multiplier: number;
  newMultiplierEffectiveTimestamp: bigint;
  newMultiplier: number;
}

const ScaledUiAmountConfigLayout = struct<ScaledUiAmountConfig>([
  publicKey("authority"),
  f64("multiplier"),
  u64("newMultiplierEffectiveTimestamp"),
  f64("newMultiplier"),
]);

export function createInitializeScaledUiAmountConfigInstruction(
  mint: PublicKey,
  authority: PublicKey | null,
  multiplier: number,
  programId: PublicKey = TOKEN_2022_PROGRAM_ID
): TransactionInstruction {
  const keys = [{ pubkey: mint, isSigner: false, isWritable: true }];

  const data = Buffer.alloc(InitializeScaledUiAmountConfigInstructionData.span);
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

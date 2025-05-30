import { struct, u8, f64 } from "@solana/buffer-layout";
import { publicKey, u64 } from "@solana/buffer-layout-utils";
import { PublicKey } from "@solana/web3.js";

// TODO this file is currently a catch-all for random things I didn't want in the test harness file

// Byte utilities
export function toFixedSizedArray(buffer: Buffer, size: number): number[] {
  const array = new Array(size).fill(0);
  buffer.forEach((value, index) => {
    array[index] = value;
  });
  return array;
}

export const ZERO_WORD = new Array(32).fill(0);

// Scaled UI Amount Config Extension Types and Functions since not supported in spl-token library yet
interface InitializeScaledUiAmountConfigData {
  instruction: 43;
  scaledUiAmountInstruction: 0;
  authority: PublicKey | null;
  multiplier: number;
}

export const InitializeScaledUiAmountConfigInstructionData =
  struct<InitializeScaledUiAmountConfigData>([
    u8("instruction"),
    u8("scaledUiAmountInstruction"),
    publicKey("authority"),
    f64("multiplier"),
  ]);

export interface ScaledUiAmountConfig {
  authority: PublicKey;
  multiplier: number;
  newMultiplierEffectiveTimestamp: bigint;
  newMultiplier: number;
}

export const ScaledUiAmountConfigLayout = struct<ScaledUiAmountConfig>([
  publicKey("authority"),
  f64("multiplier"),
  u64("newMultiplierEffectiveTimestamp"),
  f64("newMultiplier"),
]);

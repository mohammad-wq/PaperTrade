/**
 * Paper weight and math formulas.
 * Re-exports and aliases from the centralized paper-math engine.
 */
export {
  PACKET_DIVISOR,
  REAM_DIVISOR,
  STANDARD_SIZES,
  calculatePacketWeight,
  calculateReamWeight,
  calculateGsmFromPacketWeight,
  calculateGsmFromReamWeight,
  calculateSheetWeightGrams,
  calculateRatePerPacket,
  calculateRatePerKgFromPacket,
  calculateRatePerReam,
  calculateRatePerKgFromReam,
  calculateRatePerTonne,
  calculateTotalWeightFromPackets,
  calculateQuantityFromTargetTonnes,
  calculateQuantityFromTargetKg,
  calculateRollToSheetYield,
  inchesToMm,
  mmToInches,
  inchesToCm,
  cmToInches,
} from "@/lib/paper-math";

import { calculatePacketWeight, calculateReamWeight } from "@/lib/paper-math";

export function calculateWeights(length: number, breadth: number, gsm: number) {
  return {
    packetWeight: calculatePacketWeight(length, breadth, gsm),
    reamWeight: calculateReamWeight(length, breadth, gsm),
  };
}

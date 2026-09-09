/**
 * Comprehensive paper trading math engine.
 * Covers all paper industry conversions:
 * - Size (inches) & GSM <-> Packet Weight (100 sheets) & Ream Weight (500 sheets)
 * - Weighed Packet/Ream <-> Derived GSM
 * - Pricing: Rate per kg <-> Rate per Packet <-> Rate per Ream <-> Rate per Metric Tonne
 * - Logistics: Packets/Reams <-> Total Weight (kg) <-> Metric Tonnes
 * - Reel/Roll conversion: Roll weight (kg) to sheet/packet yield
 * - Unit converters: Inches <-> cm <-> mm
 */

export const PACKET_DIVISOR = 15499; // (Length" * Breadth" * GSM) / 15499 = Weight of 100 sheets (1 Packet) in kg
export const REAM_DIVISOR = 3100;   // (Length" * Breadth" * GSM) / 3100 = Weight of 500 sheets (1 Ream) in kg

export const STANDARD_SIZES = [
  { label: '23" × 36" (Standard Crown)', length: 23, breadth: 36 },
  { label: '25" × 36" (Crown Double)', length: 25, breadth: 36 },
  { label: '20" × 30" (Demy)', length: 20, breadth: 30 },
  { label: '27" × 34" (Imperial / Royal)', length: 27, breadth: 34 },
  { label: '30" × 40" (Double Demy)', length: 30, breadth: 40 },
  { label: '22" × 28" (Small Demy)', length: 22, breadth: 28 },
  { label: '18" × 23" (Crown Single)', length: 18, breadth: 23 },
  { label: 'A4 (8.27" × 11.69")', length: 8.27, breadth: 11.69 },
  { label: 'A3 (11.69" × 16.54")', length: 11.69, breadth: 16.54 },
  { label: 'Legal (8.5" × 14")', length: 8.5, breadth: 14 },
] as const;

/**
 * Calculates packet weight in kg (100 sheets)
 */
export function calculatePacketWeight(length: number, breadth: number, gsm: number): number {
  if (![length, breadth, gsm].every((v) => Number.isFinite(v) && v > 0)) return 0;
  return (length * breadth * gsm) / PACKET_DIVISOR;
}

/**
 * Calculates ream weight in kg (500 sheets)
 */
export function calculateReamWeight(length: number, breadth: number, gsm: number): number {
  if (![length, breadth, gsm].every((v) => Number.isFinite(v) && v > 0)) return 0;
  return (length * breadth * gsm) / REAM_DIVISOR;
}

/**
 * Derives GSM from packet weight (100 sheets) in kg and dimensions in inches
 * GSM = (PacketWeight_kg * 15499) / (Length * Breadth)
 */
export function calculateGsmFromPacketWeight(length: number, breadth: number, packetWeightKg: number): number {
  if (![length, breadth, packetWeightKg].every((v) => Number.isFinite(v) && v > 0)) return 0;
  const area = length * breadth;
  if (area <= 0) return 0;
  return (packetWeightKg * PACKET_DIVISOR) / area;
}

/**
 * Derives GSM from ream weight (500 sheets) in kg and dimensions in inches
 * GSM = (ReamWeight_kg * 3100) / (Length * Breadth)
 */
export function calculateGsmFromReamWeight(length: number, breadth: number, reamWeightKg: number): number {
  if (![length, breadth, reamWeightKg].every((v) => Number.isFinite(v) && v > 0)) return 0;
  const area = length * breadth;
  if (area <= 0) return 0;
  return (reamWeightKg * REAM_DIVISOR) / area;
}

/**
 * Calculates single sheet weight in grams
 */
export function calculateSheetWeightGrams(packetWeightKg: number): number {
  if (!Number.isFinite(packetWeightKg) || packetWeightKg <= 0) return 0;
  // 1 packet = 100 sheets. Weight in grams = (kg * 1000) / 100 = kg * 10
  return packetWeightKg * 10;
}

/**
 * Price / Rate conversions:
 */

// Given rate per kg and packet weight in kg -> rate per packet
export function calculateRatePerPacket(ratePerKg: number, packetWeightKg: number): number {
  if (ratePerKg <= 0 || packetWeightKg <= 0) return 0;
  return ratePerKg * packetWeightKg;
}

// Given rate per packet and packet weight in kg -> rate per kg
export function calculateRatePerKgFromPacket(ratePerPacket: number, packetWeightKg: number): number {
  if (ratePerPacket <= 0 || packetWeightKg <= 0) return 0;
  return ratePerPacket / packetWeightKg;
}

// Given rate per kg and ream weight in kg -> rate per ream
export function calculateRatePerReam(ratePerKg: number, reamWeightKg: number): number {
  if (ratePerKg <= 0 || reamWeightKg <= 0) return 0;
  return ratePerKg * reamWeightKg;
}

// Given rate per ream and ream weight in kg -> rate per kg
export function calculateRatePerKgFromReam(ratePerReam: number, reamWeightKg: number): number {
  if (ratePerReam <= 0 || reamWeightKg <= 0) return 0;
  return ratePerReam / reamWeightKg;
}

// Given rate per kg -> rate per metric tonne (1000 kg)
export function calculateRatePerTonne(ratePerKg: number): number {
  if (ratePerKg <= 0) return 0;
  return ratePerKg * 1000;
}

/**
 * Quantity & Logistics calculations:
 */

// Given quantity of packets -> total weight in kg and metric tonnes
export function calculateTotalWeightFromPackets(packetCount: number, packetWeightKg: number) {
  const totalKg = packetCount * packetWeightKg;
  const metricTonnes = totalKg / 1000;
  return { totalKg, metricTonnes, totalSheets: packetCount * 100 };
}

// Given target weight in metric tonnes -> required packets and reams
export function calculateQuantityFromTargetTonnes(targetTonnes: number, packetWeightKg: number) {
  if (packetWeightKg <= 0) return { packets: 0, reams: 0, totalKg: 0 };
  const totalKg = targetTonnes * 1000;
  const packets = Math.round((totalKg / packetWeightKg) * 100) / 100;
  const reams = Math.round((packets / 5) * 100) / 100;
  return { packets, reams, totalKg };
}

// Given target weight in kg -> required packets and reams
export function calculateQuantityFromTargetKg(targetKg: number, packetWeightKg: number) {
  if (packetWeightKg <= 0) return { packets: 0, reams: 0 };
  const packets = Math.round((targetKg / packetWeightKg) * 100) / 100;
  const reams = Math.round((packets / 5) * 100) / 100;
  return { packets, reams };
}

/**
 * Reel / Roll to Sheets Yield Calculator:
 * Given roll weight (kg), roll width (inches), sheet cut length (inches), and GSM
 */
export function calculateRollToSheetYield({
  rollWeightKg,
  rollWidthInches,
  cutLengthInches,
  gsm,
}: {
  rollWeightKg: number;
  rollWidthInches: number;
  cutLengthInches: number;
  gsm: number;
}) {
  if (
    ![rollWeightKg, rollWidthInches, cutLengthInches, gsm].every(
      (v) => Number.isFinite(v) && v > 0,
    )
  ) {
    return { totalSheets: 0, totalPackets: 0, totalReams: 0, singleSheetWeightKg: 0, packetWeightKg: 0 };
  }

  // Weight of 1 packet (100 sheets) = (rollWidth * cutLength * gsm) / 15499
  const packetWeightKg = (rollWidthInches * cutLengthInches * gsm) / PACKET_DIVISOR;
  const singleSheetWeightKg = packetWeightKg / 100;

  const totalSheets = Math.floor(rollWeightKg / singleSheetWeightKg);
  const totalPackets = Math.floor(totalSheets / 100);
  const totalReams = Math.floor(totalSheets / 500);

  return {
    totalSheets,
    totalPackets,
    totalReams,
    singleSheetWeightKg,
    packetWeightKg,
  };
}

/**
 * Dimension conversions:
 */
export function inchesToMm(inches: number): number {
  return inches * 25.4;
}

export function mmToInches(mm: number): number {
  return mm / 25.4;
}

export function inchesToCm(inches: number): number {
  return inches * 2.54;
}

export function cmToInches(cm: number): number {
  return cm / 2.54;
}

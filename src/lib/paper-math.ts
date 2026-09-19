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
  { label: '22" × 28" (Small Demy)', length: 22, breadth: 28 },
  { label: '14" × 22" (Half Demy)', length: 14, breadth: 22 },
  { label: '23" × 36" (Crown Standard)', length: 23, breadth: 36 },
  { label: '25" × 36" (Crown Double)', length: 25, breadth: 36 },
  { label: '28" × 44" (Double Demy Large)', length: 28, breadth: 44 },
  { label: '18" × 23" (Crown Single)', length: 18, breadth: 23 },
  { label: '17" × 27" (Special Demy)', length: 17, breadth: 27 },
  { label: '20" × 30" (Demy)', length: 20, breadth: 30 },
  { label: '27" × 34" (Imperial / Royal)', length: 27, breadth: 34 },
  { label: '30" × 40" (Double Demy)', length: 30, breadth: 40 },
  { label: 'A4 (8.27" × 11.69")', length: 8.27, breadth: 11.69 },
  { label: 'A3 (11.69" × 16.54")', length: 11.69, breadth: 16.54 },
  { label: 'Legal (8.5" × 14")', length: 8.5, breadth: 14 },
] as const;

export const COMMON_CONVERTING_PRESETS = [
  { label: '22" × 28"', width: 28, length: 22, description: "Small Demy" },
  { label: '14" × 22"', width: 22, length: 14, description: "Half Demy" },
  { label: '23" × 36"', width: 36, length: 23, description: "Crown Standard" },
  { label: '25" × 36"', width: 36, length: 25, description: "Crown Double" },
  { label: '28" × 44"', width: 44, length: 28, description: "Double Demy" },
  { label: '18" × 23"', width: 23, length: 18, description: "Crown Single" },
  { label: '17" × 27"', width: 27, length: 17, description: "Special Demy" },
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

export type SlitPatternInput = {
  id: string;
  label?: string;
  slitWidth: number; // inches (along reel width)
  slitsCount: number; // number of parallel slits across width
  cutLength: number; // inches (along unwind/sheet length)
  sheetsPerPack?: number; // default 100
};

export type SlitPatternResult = {
  id: string;
  label: string;
  slitWidth: number;
  slitsCount: number;
  cutLength: number;
  sheetsPerPack: number;
  utilizedWidth: number; // slitWidth * slitsCount
  deckleSharePercent: number; // (utilizedWidth / reelWidth) * 100
  allocatedWeightKg: number;
  packetWeightKg: number; // 100-sheet standard packet weight
  packWeightKg: number; // actual pack weight according to sheetsPerPack
  singleSheetWeightGrams: number;
  packetsYieldDecimal: number; // Real decimal number (e.g. 334.06)
  packetsYieldInt: number; // Floor integer (e.g. 334)
  reamsYieldDecimal: number; // Real decimal number (e.g. 66.81)
  totalSheets: number;
  ratePerPack: number; // PKR
  ratePerReam: number; // PKR
  totalAmount: number; // PKR
};

export type MultiSlitRollYieldResult = {
  reelWidthInches: number;
  totalReelWeightKg: number;
  gsm: number;
  reelsCount: number;
  weightPerReelKg: number;
  ratePerKg: number;
  totalUtilizedDeckle: number;
  isOverDeckle: boolean;
  excessDeckle: number;
  trimWasteWidth: number;
  trimWastePercent: number;
  trimWasteKg: number;
  convertedWeightKg: number;
  totalPacketsDecimal: number;
  totalPacketsInt: number;
  totalReamsDecimal: number;
  totalSheets: number;
  totalCommercialValue: number;
  items: SlitPatternResult[];
};

/**
 * Calculates industrial multi-slit and multi-cut yield from paper reels.
 * Handles:
 * - Arbitrary slit cuts across reel width and unwind length
 * - Deckle utilization, trim waste in inches, %, and kg
 * - Exact floating-point / decimal real numbers for packets and reams
 * - Rates per packet, ream, and total commercial value in PKR
 */
export function calculateMultiSlitRollYield({
  reelWidthInches,
  totalReelWeightKg,
  gsm,
  reelsCount = 1,
  ratePerKg = 0,
  patterns = [],
}: {
  reelWidthInches: number;
  totalReelWeightKg: number;
  gsm: number;
  reelsCount?: number;
  ratePerKg?: number;
  patterns: SlitPatternInput[];
}): MultiSlitRollYieldResult {
  const safeReelWidth = Math.max(0, reelWidthInches);
  const safeTotalWeight = Math.max(0, totalReelWeightKg);
  const safeGsm = Math.max(0, gsm);
  const safeReelsCount = Math.max(1, reelsCount);
  const safeRate = Math.max(0, ratePerKg);
  const weightPerReelKg = safeReelsCount > 0 ? safeTotalWeight / safeReelsCount : 0;

  const totalUtilizedDeckle = patterns.reduce(
    (sum, p) => sum + Math.max(0, p.slitWidth) * Math.max(1, p.slitsCount),
    0
  );

  const isOverDeckle = safeReelWidth > 0 && totalUtilizedDeckle > safeReelWidth + 0.0001;
  const excessDeckle = isOverDeckle ? totalUtilizedDeckle - safeReelWidth : 0;
  const trimWasteWidth = Math.max(0, safeReelWidth - totalUtilizedDeckle);
  const trimWastePercent = safeReelWidth > 0 ? (trimWasteWidth / safeReelWidth) * 100 : 0;
  const trimWasteKg = safeReelWidth > 0 ? safeTotalWeight * (trimWasteWidth / safeReelWidth) : 0;
  const convertedWeightKg = Math.max(0, safeTotalWeight - trimWasteKg);

  const items: SlitPatternResult[] = patterns.map((p, idx) => {
    const sWidth = Math.max(0, p.slitWidth);
    const sCount = Math.max(1, p.slitsCount);
    const cLength = Math.max(0, p.cutLength);
    const sheetsPerPack = p.sheetsPerPack && p.sheetsPerPack > 0 ? p.sheetsPerPack : 100;
    const utilizedWidth = sWidth * sCount;

    const deckleSharePercent = safeReelWidth > 0 ? (utilizedWidth / safeReelWidth) * 100 : 0;
    const allocatedWeightKg = safeReelWidth > 0 ? safeTotalWeight * (utilizedWidth / safeReelWidth) : 0;

    const packetWeightKg = (sWidth > 0 && cLength > 0 && safeGsm > 0)
      ? (sWidth * cLength * safeGsm) / PACKET_DIVISOR
      : 0;

    const singleSheetWeightGrams = packetWeightKg > 0 ? (packetWeightKg / 100) * 1000 : 0;
    const packWeightKg = packetWeightKg > 0 ? (packetWeightKg / 100) * sheetsPerPack : 0;

    const packetsYieldDecimal = packWeightKg > 0 ? allocatedWeightKg / packWeightKg : 0;
    const packetsYieldInt = Math.floor(packetsYieldDecimal);
    const totalSheets = Math.round(packetsYieldDecimal * sheetsPerPack);
    const reamsYieldDecimal = packetsYieldDecimal * (sheetsPerPack / 500);

    const ratePerPack = safeRate > 0 && packWeightKg > 0 ? safeRate * packWeightKg : 0;
    const ratePerReam = safeRate > 0 && packetWeightKg > 0 ? safeRate * packetWeightKg * 5 : 0;
    const totalAmount = safeRate > 0 ? allocatedWeightKg * safeRate : 0;

    return {
      id: p.id || String(idx + 1),
      label: p.label || `Cut ${idx + 1} (${sWidth}" × ${cLength}")`,
      slitWidth: sWidth,
      slitsCount: sCount,
      cutLength: cLength,
      sheetsPerPack,
      utilizedWidth,
      deckleSharePercent,
      allocatedWeightKg,
      packetWeightKg,
      packWeightKg,
      singleSheetWeightGrams,
      packetsYieldDecimal,
      packetsYieldInt,
      reamsYieldDecimal,
      totalSheets,
      ratePerPack,
      ratePerReam,
      totalAmount,
    };
  });

  const totalPacketsDecimal = items.reduce((sum, it) => sum + it.packetsYieldDecimal, 0);
  const totalPacketsInt = items.reduce((sum, it) => sum + it.packetsYieldInt, 0);
  const totalReamsDecimal = items.reduce((sum, it) => sum + it.reamsYieldDecimal, 0);
  const totalSheets = items.reduce((sum, it) => sum + it.totalSheets, 0);
  const totalCommercialValue = items.reduce((sum, it) => sum + it.totalAmount, 0);

  return {
    reelWidthInches: safeReelWidth,
    totalReelWeightKg: safeTotalWeight,
    gsm: safeGsm,
    reelsCount: safeReelsCount,
    weightPerReelKg,
    ratePerKg: safeRate,
    totalUtilizedDeckle,
    isOverDeckle,
    excessDeckle,
    trimWasteWidth,
    trimWastePercent,
    trimWasteKg,
    convertedWeightKg,
    totalPacketsDecimal,
    totalPacketsInt,
    totalReamsDecimal,
    totalSheets,
    totalCommercialValue,
    items,
  };
}

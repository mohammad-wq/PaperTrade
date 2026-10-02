/**
 * Recursively converts Decimal objects (from Prisma / decimal.js) into plain numbers
 * and ensures all objects are plain serializable values for React Server Components.
 */
export function serializeDecimals<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj !== "object") return obj;

  // Check if it's a Decimal instance
  if (
    (obj as any)?._isDecimal === true ||
    (obj as any)?.constructor?.name === "Decimal" ||
    (typeof (obj as any)?.toNumber === "function" && (obj as any)?.d !== undefined)
  ) {
    return Number(obj) as any;
  }

  // Preserve Date instances
  if (obj instanceof Date) {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => serializeDecimals(item)) as any;
  }

  // Plain object traversal
  const result: any = {};
  for (const key of Object.keys(obj)) {
    result[key] = serializeDecimals((obj as any)[key]);
  }
  return result;
}

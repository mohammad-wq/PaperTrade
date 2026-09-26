import crypto from "crypto";

const TOKEN_SECRET = process.env.NEXTAUTH_SECRET ?? "";

if (!TOKEN_SECRET) {
  throw new Error("NEXTAUTH_SECRET is required for secure document share tokens.");
}

/**
 * Generate an HMAC token allowing public access to a specific document PDF
 * without exposing the rest of the application or other documents.
 */
export function generateDocShareToken(type: string, id: string): string {
  return crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(`${type}:${id}`)
    .digest("hex")
    .substring(0, 32);
}

/**
 * Verify a provided share token against the document type and ID in constant-time.
 */
export function verifyDocShareToken(type: string, id: string, token: string | null | undefined): boolean {
  if (!token || typeof token !== "string") return false;
  const expected = generateDocShareToken(type, id);
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  if (tokenBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(tokenBuf, expectedBuf);
}


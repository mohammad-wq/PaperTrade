/**
 * Isolated WAC math checks (no DB required for pure functions).
 * Run: npx tsx scripts/test-wac-service.ts
 */
import { resolveOwnershipKey, ownershipTypeFromKey } from "../src/lib/inventoryCost.service";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(resolveOwnershipKey({ ownershipType: "OWN" }) === "OWN", "OWN key");
assert(
  resolveOwnershipKey({ ownershipType: "LOT", partnershipLotId: "abc" }) === "LOT:abc",
  "LOT key",
);

const parsed = ownershipTypeFromKey("LOT:xyz");
assert(parsed.partnershipLotId === "xyz", "parse lot");

console.log("test-wac-service: OK");

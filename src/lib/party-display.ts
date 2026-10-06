export function cleanPartyDisplayName(name?: string | null): string {
  if (!name) return "";
  return name
    .replace(/\[\s*(CUSTOMER|SUPPLIER|BOTH|PARTNER|BENEFICIARY)\s*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}


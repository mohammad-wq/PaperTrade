export function cleanPartyDisplayName(name: string): string {
  return name.replace(/\s*\[(CUSTOMER|SUPPLIER)\]\s*$/i, "").trim();
}

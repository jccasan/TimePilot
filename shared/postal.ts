/**
 * Shared postal/ZIP code validation utilities.
 * Accepts both US ZIP codes (12345 or 12345-6789) and Canadian postal codes
 * (A1A 1A1 or A1A1A1, case-insensitive).
 */

export const US_ZIP_RE = /^\d{5}(-\d{4})?$/;
export const CA_POSTAL_RE = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

/**
 * Returns true if the value is a valid US ZIP code or Canadian postal code.
 * Accepts optional whitespace trimming.
 */
export function isValidPostalCode(value: string): boolean {
  const v = (value ?? "").trim();
  if (!v) return false;
  return US_ZIP_RE.test(v) || CA_POSTAL_RE.test(v);
}

/**
 * Returns a validation error message appropriate for the tenant's country.
 * @param country "ca" for Canadian tenants, anything else for US
 */
export function postalCodeError(country: string): string {
  if (country === "ca") return "Enter a valid postal code (e.g. V6B 2X3)";
  return "Enter a valid ZIP or postal code (e.g. 12345 or V6B 2X3)";
}

/**
 * Normalise a Canadian postal code to the standard "A1A 1A1" format (with space).
 * Returns the original string for non-Canadian codes.
 */
export function normalizeCanadianPostal(value: string): string {
  const v = value.trim().toUpperCase().replace(/\s/g, "");
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(v)) {
    return v.slice(0, 3) + " " + v.slice(3);
  }
  return value.trim();
}

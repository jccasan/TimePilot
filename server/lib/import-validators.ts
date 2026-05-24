export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits[0] === "1") return digits.slice(1);
  if (digits.length === 0) return null;
  return null;
}

export function isValidNumericValue(val: string): boolean {
  if (!val || val.trim() === "") return true;
  return !isNaN(parseFloat(val.trim())) && isFinite(Number(val.trim()));
}

export function isValidDate(val: string): boolean {
  return !isNaN(Date.parse(val));
}

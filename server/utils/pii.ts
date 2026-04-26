export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "***";
  const [local, domain] = email.split("@");
  return `${local.charAt(0)}***@${domain}`;
}

export function maskPhone(phone: string): string {
  if (!phone) return "***";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***-${digits.slice(-4)}`;
}

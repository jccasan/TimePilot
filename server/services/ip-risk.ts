const PRIVATE_IP = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1$|localhost)/;

export interface IpRiskResult {
  ip: string;
  isVpn: boolean;
  isProxy: boolean;
  country?: string;
  countryCode?: string;
  skipped: boolean;
}

function extractIp(req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(",")[0].trim();
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || "";
}

export function getClientIp(req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }): string {
  return extractIp(req);
}

export async function checkIpRisk(ip: string): Promise<IpRiskResult> {
  const base: IpRiskResult = { ip, isVpn: false, isProxy: false, skipped: false };

  if (!ip || PRIVATE_IP.test(ip)) {
    return { ...base, skipped: true };
  }

  try {
    const apiKey = process.env.PROXYCHECK_API_KEY || "";
    const url = apiKey
      ? `https://proxycheck.io/v2/${ip}?vpn=1&asn=1&key=${apiKey}`
      : `https://proxycheck.io/v2/${ip}?vpn=1&asn=1`;

    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return base;

    const data = await res.json() as Record<string, unknown>;
    const entry = data[ip] as Record<string, string> | undefined;
    if (!entry) return base;

    const proxy = String(entry.proxy ?? "").toLowerCase() === "yes";
    const type = String(entry.type ?? "").toLowerCase();
    const isVpn = proxy && (type.includes("vpn") || type.includes("tor") || type === "");
    const isProxy = proxy && !isVpn;
    const countryCode = (entry.isocode as string | undefined)?.toUpperCase();
    const country = entry.country as string | undefined;

    return { ip, isVpn, isProxy, country, countryCode, skipped: false };
  } catch {
    return { ...base, skipped: true };
  }
}

export async function getCountryCode(ip: string, cfHeader?: string): Promise<string | null> {
  if (cfHeader && cfHeader.length === 2 && cfHeader !== "XX") {
    return cfHeader.toUpperCase();
  }
  if (!ip || PRIVATE_IP.test(ip)) return null;
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json() as { countryCode?: string };
    return data.countryCode?.toUpperCase() || null;
  } catch {
    return null;
  }
}

const DEBOUNCE_MS = 5000;
const recentErrors = new Map<string, number>();

function getUserContext(): { userId?: string; companyId?: string } {
  try {
    const raw = sessionStorage.getItem("scoopilot_user_ctx");
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {};
}

export function setUserContext(userId: string, companyId?: string | null) {
  try {
    sessionStorage.setItem("scoopilot_user_ctx", JSON.stringify({ userId, companyId: companyId ?? null }));
  } catch (_) {}
}

export function clearUserContext() {
  try {
    sessionStorage.removeItem("scoopilot_user_ctx");
  } catch (_) {}
}

export async function reportError(
  message: string,
  stack: string | undefined,
  errorType: "react" | "js" | "api",
  extra?: { pageUrl?: string }
) {
  try {
    const key = `${errorType}:${message.slice(0, 100)}`;
    const now = Date.now();
    const last = recentErrors.get(key);
    if (last && now - last < DEBOUNCE_MS) return;
    recentErrors.set(key, now);

    const { userId, companyId } = getUserContext();
    const payload = {
      message: message.slice(0, 4000),
      stack: stack?.slice(0, 10000),
      errorType,
      pageUrl: extra?.pageUrl ?? window.location.href,
      userId,
      companyId,
      userAgent: navigator.userAgent,
    };

    await fetch("/api/errors/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (_) {}
}

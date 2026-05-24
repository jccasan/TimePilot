/* eslint-disable @typescript-eslint/no-explicit-any */
const STORAGE_KEY = "admin_token";

function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

function getSessionToken(): string | null {
  return localStorage.getItem("sessionToken");
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const adminToken = getToken();
  if (adminToken) headers["x-admin-token"] = adminToken;
  const sessionToken = getSessionToken();
  if (sessionToken) headers["Authorization"] = `Bearer ${sessionToken}`;
  return headers;
}

export function adminFetchFn(url: string): () => Promise<any> {
  return async () => {
    const res = await fetch(url, {
      headers: buildHeaders(),
      credentials: "include",
    });
    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem(STORAGE_KEY);
        window.location.href = "/admin";
      }
      throw new Error(`${res.status}`);
    }
    return res.json();
  };
}

export async function adminRequest(method: string, url: string, body?: any): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: buildHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    localStorage.removeItem(STORAGE_KEY);
    window.location.href = "/admin";
  }
  return res;
}

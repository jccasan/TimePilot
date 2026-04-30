/* eslint-disable @typescript-eslint/no-explicit-any */
const STORAGE_KEY = "admin_token";

function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function adminFetchFn(url: string): () => Promise<any> {
  return async () => {
    const token = getToken();
    const res = await fetch(url, {
      headers: token ? { "x-admin-token": token } : {},
    });
    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem(STORAGE_KEY);
        window.location.href = "/admin/login";
      }
      throw new Error(`${res.status}`);
    }
    return res.json();
  };
}

export async function adminRequest(method: string, url: string, body?: any): Promise<Response> {
  const token = getToken();
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    localStorage.removeItem(STORAGE_KEY);
    window.location.href = "/admin/login";
  }
  return res;
}

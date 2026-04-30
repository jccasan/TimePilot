import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface AdminAuthState {
  token: string | null;
  email: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  mustChangePassword: boolean;
  login: (
    email: string,
    password: string
  ) => Promise<{ error?: string; mustChangePassword?: boolean }>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ error?: string }>;
}

const AdminAuthContext = createContext<AdminAuthState | null>(null);

const STORAGE_KEY = "admin_token";

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [email, setEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const clearAuth = useCallback(() => {
    setToken(null);
    setEmail(null);
    setMustChangePassword(false);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    fetch("/api/admin/check", { headers: { "x-admin-token": token } })
      .then((r) => {
        if (!r.ok) {
          clearAuth();
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data) {
          setEmail(data.email);
          setMustChangePassword(data.mustChangePassword || false);
        }
      })
      .catch(() => clearAuth())
      .finally(() => setIsLoading(false));
  }, [token, clearAuth]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || "Login failed" };
    localStorage.setItem(STORAGE_KEY, data.token);
    setToken(data.token);
    setEmail(email);
    setMustChangePassword(data.mustChangePassword || false);
    return { mustChangePassword: data.mustChangePassword };
  }, []);

  const logout = useCallback(async () => {
    if (token) {
      await fetch("/api/admin/logout", {
        method: "POST",
        headers: { "x-admin-token": token },
      }).catch(() => {});
    }
    clearAuth();
  }, [token, clearAuth]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!token) return { error: "Not authenticated" };
      const res = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || "Failed to change password" };
      setMustChangePassword(false);
      return {};
    },
    [token]
  );

  return (
    <AdminAuthContext.Provider
      value={{
        token,
        email,
        isAuthenticated: !!token && !!email,
        isLoading,
        mustChangePassword,
        login,
        logout,
        changePassword,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}

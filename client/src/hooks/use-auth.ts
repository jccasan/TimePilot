import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { User } from "@shared/models/auth";
import { setUserContext, clearUserContext } from "@/lib/errorReporter";

type SafeUser = Omit<User, "passwordHash"> & {
  role?: string;
  companyId?: string | null;
  isPlatformAdmin?: boolean;
  setupDone?: boolean;
  sessionToken?: string;
  importMode?: boolean;
  subscriptionStatus?: string | null;
  subscriptionTier?: string | null;
  voicePlanStatus?: string | null;
  crmGrandfathered?: boolean;
};

async function fetchUser(): Promise<SafeUser | null> {
  const token = localStorage.getItem("sessionToken");
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch("/api/auth/user", {
    credentials: "include",
    headers,
  });

  if (response.status === 401) {
    if (token) {
      localStorage.removeItem("sessionToken");
      const retryResponse = await fetch("/api/auth/user", {
        credentials: "include",
      });
      if (retryResponse.ok) {
        return retryResponse.json();
      }
    }
    return null;
  }

  if (!response.ok) {
    return null;
  }

  return response.json();
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<SafeUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (user) {
      setUserContext(user.id, user.companyId ?? undefined);
    } else if (!isLoading) {
      clearUserContext();
    }
  }, [user, isLoading]);

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      await fetch("/api/auth/logout", { method: "POST", credentials: "include", headers });
    },
    onSuccess: () => {
      localStorage.removeItem("sessionToken");
      queryClient.clear();
      clearUserContext();
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}

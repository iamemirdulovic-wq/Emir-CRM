import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api.js';
import type { CurrentUser } from './types.js';
import { applyDirection, setLocale } from './i18n.js';

type AuthState = {
  user: CurrentUser | null;
  loading: boolean;
  signIn: (email: string, password: string, rememberMe: boolean) => Promise<CurrentUser>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

/**
 * The server's locale is the default, but a preference this browser has already
 * chosen wins — otherwise the language switch appears to do nothing, because
 * every session refresh would overwrite it.
 */
function applyServerLocale(serverLocale: string): void {
  if (localStorage.getItem('emir.locale')) return;
  if (serverLocale === 'ar' || serverLocale === 'en') setLocale(serverLocale);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<{ user: CurrentUser }>('/api/auth/me');
      setUser(response.user);
      applyServerLocale(response.user.locale);
      applyDirection();
    } catch (err) {
      // 401 simply means "not signed in"; anything else is worth surfacing.
      if (!(err instanceof ApiError) || err.status !== 401) console.error('session check failed', err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string, rememberMe: boolean) => {
    const response = await api.post<{ user: CurrentUser }>('/api/auth/login', { email, password, rememberMe });
    setUser(response.user);
    applyServerLocale(response.user.locale);
    applyDirection();
    return response.user;
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  }, []);

  const can = useCallback((permission: string) => user?.permissions.includes(permission) ?? false, [user]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, signIn, signOut, refresh, can }),
    [user, loading, signIn, signOut, refresh, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../../shared/domain/types';
import { createSeed } from '../../mocks/fixtures';
import { useQueryClient } from '@tanstack/react-query';
import { http } from '../../shared/api/client';
export const apiMode = import.meta.env.VITE_DATA_SOURCE === 'api';
const empty: User = {
  id: '',
  name: '',
  email: '',
  role: 'employee',
  active: false,
  createdAt: '',
  flags: {},
};

interface SessionContextValue {
  user: User;
  selectUser: (user: User) => void;
  loading: boolean;
  authenticated: boolean;
  login: (login: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
const Context = createContext<SessionContextValue | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [loading, setLoading] = useState(apiMode);
  const [user, setUser] = useState<User>(() => {
    if (apiMode) return empty;
    try {
      const saved = sessionStorage.getItem('bloom-session');
      if (saved) return JSON.parse(saved) as User;
    } catch {
      /* Use demo manager. */
    }
    return createSeed().users[1];
  });
  const selectUser = (next: User) => {
    if (apiMode) return;
    setUser(next);
    try {
      sessionStorage.setItem('bloom-session', JSON.stringify(next));
    } catch {
      /* Memory session. */
    }
  };
  const refresh = useCallback(async () => {
    if (!apiMode) return;
    try {
      const next = await http<User>('/auth/me');
      setUser((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    } catch {
      setUser(empty);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const unauthorized = () => {
      setUser(empty);
      client.clear();
    };
    window.addEventListener('bloom-unauthorized', unauthorized);
    if (!apiMode) return () => window.removeEventListener('bloom-unauthorized', unauthorized);
    const timer = setInterval(() => void refresh(), 15000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      window.removeEventListener('bloom-unauthorized', unauthorized);
    };
  }, [refresh, client]);
  const login = async (login: string, password: string) => {
    const next = await http<User>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    });
    client.clear();
    setUser(next);
    return next;
  };
  const logout = async () => {
    await http<void>('/auth/logout', { method: 'POST' });
    setUser(empty);
    client.clear();
  };
  return (
    <Context.Provider
      value={{
        user,
        selectUser,
        loading,
        authenticated: !apiMode || !!user.id,
        login,
        logout,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useSession() {
  const context = useContext(Context);
  if (!context) throw new Error('Thiếu SessionProvider');
  return context;
}

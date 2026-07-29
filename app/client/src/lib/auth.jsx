import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      register: async (u, p) => setUser((await api.register(u, p)).user),
      login: async (u, p) => setUser((await api.login(u, p)).user),
      logout: async () => {
        await api.logout();
        setUser(null);
      }
    }),
    [user, ready]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** The avatar initial the chrome shows. */
export function useInitial() {
  const { user } = useAuth();
  return useCallback(() => (user?.username ?? '?').slice(0, 1).toUpperCase(), [user])();
}

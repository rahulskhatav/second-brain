import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { forgetPerson, identify, track } from './analytics.js';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((d) => {
        setUser(d.user);
        identify(d.user); // an existing session is still this person
      })
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      register: async (u, p) => {
        const { user: created } = await api.register(u, p);
        setUser(created);
        identify(created);
        track('signed_up');
      },
      login: async (u, p) => {
        const { user: signedIn } = await api.login(u, p);
        setUser(signedIn);
        identify(signedIn);
        track('signed_in');
      },
      logout: async () => {
        track('signed_out');
        await api.logout();
        setUser(null);
        forgetPerson();
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

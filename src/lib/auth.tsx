import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../api/client';
import type { Me } from '../api/types';

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  setMe: (me: Me) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({ me: null, loading: true, setMe: () => {}, logout: async () => {} });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const value: AuthCtx = {
    me: data ?? null,
    loading: isLoading,
    setMe: (me) => qc.setQueryData(['me'], me),
    logout: async () => {
      await api.post('/auth/logout').catch(() => {});
      // Primero se marca la sesión como cerrada (el observador de ['me'] sigue vivo y re-renderiza);
      // con qc.clear() el observador quedaba apuntando a la consulta borrada y el login redirigía de vuelta.
      qc.setQueryData(['me'], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

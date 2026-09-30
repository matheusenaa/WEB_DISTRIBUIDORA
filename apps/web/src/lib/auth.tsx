import type { Permission, SessionUser } from '@webdist/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api, request, tokenStore } from './api';

/**
 * Sessao do usuario.
 *
 * Guarda apenas o perfil em memoria; os tokens ficam em localStorage
 * (ver `tokenStore`) para sobreviver a recarregar a pagina.
 * O backend continua sendo a autoridade: toda rota valida permissao.
 */

interface AuthContextValue {
  user: SessionUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  can: (permission: Permission) => boolean;
  canAny: (...permissions: Permission[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadSession = useCallback(async () => {
    if (!tokenStore.access) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      const me = await api.get<{ user: SessionUser }>('/api/auth/me');
      setUser(me.user);
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // Qualquer expiracao de sessao devolve o usuario ao login.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('wd:session-expired', onExpired);
    return () => window.removeEventListener('wd:session-expired', onExpired);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.post<{
      user: SessionUser;
      tokens: { accessToken: string; refreshToken: string };
    }>('/api/auth/login', { username, password });
    tokenStore.set(result.tokens.accessToken, result.tokens.refreshToken);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await request('/api/auth/logout', { method: 'POST', skipRefresh: true });
    } catch {
      // Mesmo que a API falhe, a sessao local e encerrada.
    }
    tokenStore.clear();
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const me = await api.get<{ user: SessionUser }>('/api/auth/me');
      setUser(me.user);
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        tokenStore.clear();
        setUser(null);
      }
    }
  }, []);

  const permissions = user?.permissions ?? [];

  const can = useCallback(
    (permission: Permission) => permissions.includes(permission),
    [permissions],
  );

  const canAny = useCallback(
    (...list: Permission[]) => list.some((permission) => permissions.includes(permission)),
    [permissions],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, login, logout, refreshProfile, can, canAny }),
    [user, isLoading, login, logout, refreshProfile, can, canAny],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}

/**
 * Atalho para proteger rotas: se o usuario nao tem a permissao,
 * ele e redirecionado para a pagina inicial.
 */
export function useRequirePermission(permission: Permission): boolean {
  const { can } = useAuth();
  return can(permission);
}
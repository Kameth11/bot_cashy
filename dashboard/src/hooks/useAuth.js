import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

const STORAGE_KEY = 'cashy_token';
const USER_KEY = 'cashy_user';

export function useAuth() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem(USER_KEY);
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);

  const requestCode = useCallback(async (userId) => {
    const { data } = await api.post('/api/auth/request-code', { userId });
    return data;
  }, []);

  const login = useCallback(async (userId, code) => {
    const { data } = await api.post('/api/auth/verify', { userId, code });
    if (!data.token) throw new Error('Token no recibido');
    localStorage.setItem(STORAGE_KEY, data.token);
    if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setUser(data.user);
    return data;
  }, []);

  const loginDemo = useCallback(() => {
    const demoUser = { userId: 'demo', isAdmin: false, permisos: [] };
    localStorage.setItem(STORAGE_KEY, 'demo-token');
    localStorage.setItem(USER_KEY, JSON.stringify(demoUser));
    setUser(demoUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  useEffect(() => {
    async function check() {
      try {
        const { data } = await api.get('/api/auth/me');
        if (data?.user) {
          setUser(data.user);
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        }
      } catch (err) {
        if (err.response?.status === 401) {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(USER_KEY);
        }
        // si el servidor está caído, mantener sesión local
      } finally {
        setLoading(false);
      }
    }
    if (localStorage.getItem(STORAGE_KEY)) check();
    else setLoading(false);
  }, []);

  // Helper para chequear permisos en componentes sin importar la lista de constantes
  const puede = useCallback((permiso) => {
    if (!user) return false;
    if (user.isAdmin) return true;
    return Array.isArray(user.permisos) && user.permisos.includes(permiso);
  }, [user]);

  return { user, loading, login, requestCode, loginDemo, logout, puede };
}

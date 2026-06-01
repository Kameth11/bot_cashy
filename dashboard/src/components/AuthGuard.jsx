import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function AuthGuard({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { loadWebUserSession } from './webSession';

export function RequireSession({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const session = loadWebUserSession();
  if (!session) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
  return <>{children}</>;
}

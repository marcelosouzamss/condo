import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { isPartnerAllowedAppPath } from './homeFeatures';
import { CondoUserRoles } from './condoUserRoles';
import { loadWebUserSession } from './webSession';

/** Sessão obrigatória para todas as rotas sob `/app`. */
export function AppSessionLayout() {
  const loc = useLocation();
  const session = loadWebUserSession();
  if (!session) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
  if (session.role === CondoUserRoles.partner && !isPartnerAllowedAppPath(loc.pathname)) {
    return <Navigate to="/app" replace />;
  }
  return <Outlet />;
}

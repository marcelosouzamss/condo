import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import {
  canOpenAdministrationHub,
  isBillingStaff,
  isPlatformAdmin,
  CondoUserRoles,
} from '../condoUserRoles';
import { loadWebUserSession } from '../webSession';

export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const s = loadWebUserSession();
  if (!s) {
    return <Navigate to="/login" replace />;
  }
  if (!isPlatformAdmin(s.role)) {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}

export function RequireSyndic({ children }: { children: ReactNode }) {
  const s = loadWebUserSession();
  if (!s) {
    return <Navigate to="/login" replace />;
  }
  if (s.role !== 'syndic') {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}

export function RequireAdministrationHub({ children }: { children: ReactNode }) {
  const s = loadWebUserSession();
  if (!s) {
    return <Navigate to="/login" replace />;
  }
  if (!canOpenAdministrationHub(s.role)) {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}

/** Mesmo critério que o cartão «Controle de Acesso» na home (`homeFeatures`). */
export function RequireNotPartner({ children }: { children: ReactNode }) {
  const s = loadWebUserSession();
  if (!s) {
    return <Navigate to="/login" replace />;
  }
  if (s.role === CondoUserRoles.partner) {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}

/** Morador com unidade ou equipa de faturação (síndico/admin). */
export function RequireBillingAccess({ children }: { children: ReactNode }) {
  const s = loadWebUserSession();
  if (!s) {
    return <Navigate to="/login" replace />;
  }
  if (s.unitId != null || isBillingStaff(s.role)) {
    return <>{children}</>;
  }
  return <Navigate to="/app" replace />;
}

/** Apenas síndico ou administradora (área de gestão de competências). */
export function RequireBillingStaff({ children }: { children: ReactNode }) {
  const s = loadWebUserSession();
  if (!s) {
    return <Navigate to="/login" replace />;
  }
  if (isBillingStaff(s.role)) {
    return <>{children}</>;
  }
  return <Navigate to="/app/boleto-online" replace />;
}

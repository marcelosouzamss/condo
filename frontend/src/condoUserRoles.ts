/** Perfis em `app_users.role` (alinhado ao app móvel). */
export const CondoUserRoles = {
  admin: 'admin',
  syndic: 'syndic',
  administrator: 'administrator',
  resident: 'resident',
  partner: 'partner',
  collaborator: 'collaborator',
  doorman: 'doorman',
} as const;

export function labelPt(role: string): string {
  switch (role) {
    case CondoUserRoles.admin:
      return 'Administrador da plataforma';
    case CondoUserRoles.syndic:
      return 'Síndico';
    case CondoUserRoles.administrator:
      return 'Administração';
    case CondoUserRoles.resident:
      return 'Morador';
    case CondoUserRoles.partner:
      return 'Parceiros';
    case CondoUserRoles.collaborator:
      return 'Colaboradores';
    case CondoUserRoles.doorman:
      return 'Portaria';
    default:
      return role;
  }
}

/** Administrador da plataforma (cadastro global de condomínios, não confundir com «administrator» do condomínio). */
export function isPlatformAdmin(role: string): boolean {
  return role === CondoUserRoles.admin;
}

export function isBillingStaff(role: string): boolean {
  return role === CondoUserRoles.syndic || role === CondoUserRoles.administrator;
}

export function canManageCondoHomeLayout(role: string): boolean {
  return isBillingStaff(role) || isPlatformAdmin(role);
}

export function isOperationalStaff(role: string): boolean {
  return (
    role === CondoUserRoles.syndic ||
    role === CondoUserRoles.administrator ||
    role === CondoUserRoles.collaborator ||
    role === CondoUserRoles.doorman
  );
}

export function canOpenAdministrationHub(role: string): boolean {
  return isOperationalStaff(role);
}

export function picksCondoBeforeContact(role: string): boolean {
  return (
    role === CondoUserRoles.admin ||
    role === CondoUserRoles.syndic ||
    role === CondoUserRoles.administrator ||
    role === CondoUserRoles.partner
  );
}

export function canManageReservationSpaces(role: string): boolean {
  return isBillingStaff(role);
}

export function canManageDocuments(role: string): boolean {
  return (
    isBillingStaff(role) ||
    role === CondoUserRoles.collaborator ||
    role === CondoUserRoles.doorman ||
    role === CondoUserRoles.partner
  );
}

/** Mercado interno — aba do condomínio: síndico, administração e parceiros. */
export function canPostMarketplaceCondominium(role: string): boolean {
  return (
    role === CondoUserRoles.syndic ||
    role === CondoUserRoles.administrator ||
    role === CondoUserRoles.partner
  );
}

/** Mercado interno — aba dos moradores: moradores e síndico. */
export function canPostMarketplaceResidents(role: string): boolean {
  return role === CondoUserRoles.resident || role === CondoUserRoles.syndic;
}

/** Guia de serviços — cadastro no catálogo: síndico, administração e parceiros. */
export function canManageServiceGuideCatalog(role: string): boolean {
  return (
    role === CondoUserRoles.syndic ||
    role === CondoUserRoles.administrator ||
    role === CondoUserRoles.partner
  );
}

/** Role usada em `fromStaffRole` / `viewerStaffRole` na API de comunicados individuais. */
export function staffMessagingApiRole(role: string): string | null {
  if (
    role === CondoUserRoles.syndic ||
    role === CondoUserRoles.administrator ||
    role === CondoUserRoles.collaborator ||
    role === CondoUserRoles.doorman
  ) {
    return role;
  }
  return null;
}

/** Quadro de colaboradores — cadastro e escala: síndico e administração. */
export function canManageCollaboratorsBoard(role: string): boolean {
  return isBillingStaff(role);
}

/** Aba «Escala» no quadro: síndico, administração e colaboradores (leitura). */
export function canViewCollaboratorScheduleTab(role: string): boolean {
  return (
    role === CondoUserRoles.syndic ||
    role === CondoUserRoles.administrator ||
    role === CondoUserRoles.collaborator ||
    role === CondoUserRoles.doorman
  );
}

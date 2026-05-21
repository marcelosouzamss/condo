/** Perfis em `app_users.role` (valores estáveis na API). */
export type AppUserRole =
  | 'admin'
  | 'syndic'
  | 'administrator'
  | 'resident'
  | 'partner'
  | 'collaborator'
  | 'doorman';

export function isPlatformAdmin(role: string): boolean {
  return role === 'admin';
}

export function isBillingStaff(role: string): boolean {
  return role === 'syndic' || role === 'administrator';
}

/** Equipe operacional (exceto financeiro completo de cobranças). */
export function isOperationalStaff(role: string): boolean {
  return (
    role === 'syndic' ||
    role === 'administrator' ||
    role === 'collaborator' ||
    role === 'doorman'
  );
}

/** Síndico e administradora: cadastro de colaboradores e escala. */
export function canManageCollaboratorsAndSchedule(role: string): boolean {
  return role === 'syndic' || role === 'administrator';
}

/** Escala visível para síndico, administradora e colaboradores (não para morador). */
export function canViewCollaboratorSchedule(role: string): boolean {
  return (
    role === 'syndic' ||
    role === 'administrator' ||
    role === 'collaborator' ||
    role === 'doorman'
  );
}

/** Passagem de turno: visivel para equipe operacional do condominio. */
export function canViewShiftHandovers(role: string): boolean {
  return (
    role === 'syndic' ||
    role === 'administrator' ||
    role === 'collaborator' ||
    role === 'doorman'
  );
}

/** Cadastro de areas e integrantes da passagem de turno. */
export function canManageShiftHandoverAreas(role: string): boolean {
  return role === 'syndic' || role === 'administrator';
}

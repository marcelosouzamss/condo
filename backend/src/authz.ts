/** Perfis em `app_users.role` (valores estáveis na API). */
export type AppUserRole =
  | 'syndic'
  | 'administrator'
  | 'resident'
  | 'partner'
  | 'collaborator';

export function isBillingStaff(role: string): boolean {
  return role === 'syndic' || role === 'administrator';
}

/** Equipe operacional (exceto financeiro completo de cobranças). */
export function isOperationalStaff(role: string): boolean {
  return (
    role === 'syndic' || role === 'administrator' || role === 'collaborator'
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
    role === 'collaborator'
  );
}

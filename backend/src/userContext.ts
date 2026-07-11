import { isPlatformAdmin } from './authz';
import { query } from './db';

export type UserCondoContext = {
  id: number;
  condoId: number;
  unitId: number | null;
  role: string;
  fullName: string;
  login: string;
};

export type AccessibleCondo = {
  condoId: number;
  condoName: string;
  role: string;
  unitId: number | null;
};

export type LoginCondoSelection = {
  mode: 'skip' | 'pick' | 'auto';
  condos: AccessibleCondo[];
};

type IdentityRow = {
  id: number;
  full_name: string;
  login: string;
  active: boolean;
  role: string;
  condo_id: number;
  unit_id: number | null;
};

async function loadIdentity(userId: number): Promise<IdentityRow | null> {
  const r = await query(
    `select id, full_name, login, active, role, condo_id, unit_id
     from app_users
     where id = $1
     limit 1`,
    [userId],
  );
  if (r.rows.length === 0) {
    return null;
  }
  return r.rows[0] as IdentityRow;
}

export async function userHasPartnerRole(userId: number): Promise<boolean> {
  const mem = await query(
    `select 1
     from app_user_condo_memberships
     where user_id = $1 and role = 'partner' and active = true
     limit 1`,
    [userId],
  );
  if (mem.rows.length > 0) {
    return true;
  }
  const ident = await loadIdentity(userId);
  return ident?.role === 'partner';
}

/** Contexto do utilizador num condomínio (autorização nas rotas). */
export async function loadUserCondoContext(
  userId: number,
  condoId: number,
): Promise<UserCondoContext | null> {
  const ident = await loadIdentity(userId);
  if (ident == null || ident.active !== true) {
    return null;
  }

  const mem = await query(
    `select condo_id, unit_id, role
     from app_user_condo_memberships
     where user_id = $1 and condo_id = $2 and active = true
     limit 1`,
    [userId, condoId],
  );
  if (mem.rows.length > 0) {
    const row = mem.rows[0] as {
      condo_id: number;
      unit_id: number | null;
      role: string;
    };
    return {
      id: userId,
      condoId: row.condo_id,
      unitId: row.unit_id,
      role: row.role,
      fullName: ident.full_name,
      login: ident.login,
    };
  }

  if (await userHasPartnerRole(userId)) {
    const condo = await query(`select id from condos where id = $1 limit 1`, [condoId]);
    if (condo.rows.length === 0) {
      return null;
    }
    return {
      id: userId,
      condoId,
      unitId: null,
      role: 'partner',
      fullName: ident.full_name,
      login: ident.login,
    };
  }

  if (isPlatformAdmin(ident.role) && ident.condo_id === condoId) {
    return {
      id: userId,
      condoId: ident.condo_id,
      unitId: ident.unit_id,
      role: ident.role,
      fullName: ident.full_name,
      login: ident.login,
    };
  }

  if (ident.condo_id === condoId) {
    return {
      id: userId,
      condoId: ident.condo_id,
      unitId: ident.unit_id,
      role: ident.role,
      fullName: ident.full_name,
      login: ident.login,
    };
  }

  return null;
}

function mapAccessibleRows(
  rows: Array<{
    condo_id: number;
    condo_name: string;
    role: string;
    unit_id: number | null;
  }>,
): AccessibleCondo[] {
  return rows.map((row) => ({
    condoId: row.condo_id,
    condoName: row.condo_name,
    role: row.role,
    unitId: row.unit_id,
  }));
}

/** Condomínios que o utilizador pode escolher após o login. */
export async function listLoginCondoOptions(userId: number): Promise<LoginCondoSelection> {
  const ident = await loadIdentity(userId);
  if (ident == null || ident.active !== true) {
    return { mode: 'pick', condos: [] };
  }

  if (isPlatformAdmin(ident.role)) {
    return { mode: 'skip', condos: [] };
  }

  if (await userHasPartnerRole(userId)) {
    const all = await query(
      `select id as condo_id, name as condo_name
       from condos
       order by lower(name) asc`,
    );
    const condos = all.rows.map((row) => ({
      condoId: row.condo_id as number,
      condoName: String(row.condo_name),
      role: 'partner',
      unitId: null,
    }));
    if (condos.length <= 1) {
      return { mode: condos.length === 1 ? 'auto' : 'pick', condos };
    }
    return { mode: 'pick', condos };
  }

  const mem = await query(
    `select m.condo_id, c.name as condo_name, m.role, m.unit_id
     from app_user_condo_memberships m
     join condos c on c.id = m.condo_id
     where m.user_id = $1 and m.active = true
     order by lower(c.name) asc`,
    [userId],
  );
  if (mem.rows.length > 0) {
    const condos = mapAccessibleRows(
      mem.rows as Array<{
        condo_id: number;
        condo_name: string;
        role: string;
        unit_id: number | null;
      }>,
    );
    if (condos.length === 1) {
      return { mode: 'auto', condos };
    }
    return { mode: 'pick', condos };
  }

  const legacy = await query(
    `select c.id as condo_id, c.name as condo_name, au.role, au.unit_id
     from app_users au
     join condos c on c.id = au.condo_id
     where au.id = $1 and au.active = true
     limit 1`,
    [userId],
  );
  if (legacy.rows.length === 0) {
    return { mode: 'pick', condos: [] };
  }
  const condos = mapAccessibleRows(
    legacy.rows as Array<{
      condo_id: number;
      condo_name: string;
      role: string;
      unit_id: number | null;
    }>,
  );
  return { mode: 'auto', condos };
}

export function sessionFromAccessibleCondo(
  userId: number,
  fullName: string,
  login: string,
  pick: AccessibleCondo,
): {
  id: number;
  condoId: number;
  unitId: number | null;
  fullName: string;
  login: string;
  role: string;
  condoName: string;
} {
  return {
    id: userId,
    condoId: pick.condoId,
    unitId: pick.unitId,
    fullName,
    login,
    role: pick.role,
    condoName: pick.condoName,
  };
}

/** Formato legado usado nas rotas (`condo_id`, `role`, …). */
export async function loadLegacyUserRow(
  userId: number,
  condoId: number,
): Promise<{
  id: number;
  condo_id: number;
  unit_id: number | null;
  role: string;
  active: boolean;
  full_name: string;
} | null> {
  const ctx = await loadUserCondoContext(userId, condoId);
  if (ctx == null) {
    return null;
  }
  return {
    id: ctx.id,
    condo_id: ctx.condoId,
    unit_id: ctx.unitId,
    role: ctx.role,
    active: true,
    full_name: ctx.fullName,
  };
}

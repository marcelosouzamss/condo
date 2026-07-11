import { Router } from 'express';

import {
  canManageShiftHandoverAreas,
  canViewShiftHandovers,
} from '../authz';
import { query } from '../db';
import { loadLegacyUserRow } from '../userContext';

const router = Router();

type AppUserRow = {
  id: number;
  condo_id: number;
  full_name: string;
  role: string;
  active: boolean;
};

function parsePositive(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parseCondoId(raw: unknown): number {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : 1;
}

function parseMemberIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: number[] = [];
  for (const item of raw) {
    const id = parsePositive(item);
    if (id != null) {
      out.push(id);
    }
  }
  return [...new Set(out)];
}

async function loadUser(userId: number, condoId: number): Promise<AppUserRow | null> {
  const row = await loadLegacyUserRow(userId, condoId);
  if (row == null) {
    return null;
  }
  return {
    id: row.id,
    condo_id: row.condo_id,
    full_name: row.full_name,
    role: row.role,
    active: row.active,
  };
}

function canView(user: AppUserRow, condoId: number): boolean {
  return (
    user.active === true &&
    user.condo_id === condoId &&
    canViewShiftHandovers(user.role)
  );
}

function canManage(user: AppUserRow, condoId: number): boolean {
  return (
    user.active === true &&
    user.condo_id === condoId &&
    canManageShiftHandoverAreas(user.role)
  );
}

async function validateCollaboratorUsers(
  condoId: number,
  memberUserIds: number[],
): Promise<number[] | null> {
  if (memberUserIds.length === 0) {
    return [];
  }
  const r = await query(
    `select au.id
     from app_user_condo_memberships m
     join app_users au on au.id = m.user_id
     where m.condo_id = $1
       and m.active = true
       and au.active = true
       and m.role in ('collaborator', 'doorman')
       and au.id = any($2::int[])
     order by au.full_name asc`,
    [condoId, memberUserIds],
  );
  const ids = r.rows.map((row) => Number(row.id));
  return ids.length === memberUserIds.length ? ids : null;
}

async function replaceMembers(
  areaId: number,
  condoId: number,
  memberUserIds: number[],
): Promise<void> {
  const valid = await validateCollaboratorUsers(condoId, memberUserIds);
  if (valid == null) {
    throw new Error('MEMBER_INVALID');
  }
  await query(`delete from shift_handover_area_members where area_id = $1`, [
    areaId,
  ]);
  for (const userId of valid) {
    await query(
      `insert into shift_handover_area_members (area_id, user_id)
       values ($1, $2)
       on conflict (area_id, user_id) do nothing`,
      [areaId, userId],
    );
  }
}

async function areaBelongsToCondo(areaId: number, condoId: number): Promise<boolean> {
  const r = await query(
    `select id from shift_handover_areas where id = $1 and condo_id = $2`,
    [areaId, condoId],
  );
  return r.rows.length > 0;
}

async function userIsAreaMember(areaId: number, userId: number): Promise<boolean> {
  const r = await query(
    `select area_id
     from shift_handover_area_members
     where area_id = $1 and user_id = $2`,
    [areaId, userId],
  );
  return r.rows.length > 0;
}

router.get('/collaborators', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    const user = await loadUser(userId, condoId);
    if (user == null || !canView(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao para passagem de turno.' });
    }
    const r = await query(
      `select id, full_name, login, role, active
       from app_users
       where condo_id = $1
         and active = true
         and role in ('collaborator', 'doorman')
       order by full_name asc`,
      [condoId],
    );
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.get('/areas', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    const user = await loadUser(userId, condoId);
    if (user == null || !canView(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao para passagem de turno.' });
    }

    const manage = canManage(user, condoId);
    const areasResult = await query(
      `select a.id,
              a.condo_id,
              a.name,
              a.service_name,
              a.instructions,
              a.active,
              a.created_by_user_id,
              a.created_at,
              a.updated_at,
              (
                select max(e.created_at)
                from shift_handover_entries e
                where e.area_id = a.id
              ) as last_entry_at
       from shift_handover_areas a
       where a.condo_id = $1
         and (
           $2::boolean
           or (
             a.active = true
             and exists (
               select 1
               from shift_handover_area_members am
               where am.area_id = a.id and am.user_id = $3
             )
           )
         )
       order by last_entry_at desc nulls last,
                a.updated_at desc,
                a.created_at desc`,
      [condoId, manage, userId],
    );

    const areaIds = areasResult.rows.map((row) => Number(row.id));
    if (areaIds.length === 0) {
      return res.json([]);
    }

    const membersResult = await query(
      `select am.area_id,
              u.id,
              u.full_name,
              u.login
       from shift_handover_area_members am
       join app_users u on u.id = am.user_id
       where am.area_id = any($1::int[])
       order by u.full_name asc`,
      [areaIds],
    );
    const entriesResult = await query(
      `select e.id,
              e.condo_id,
              e.area_id,
              e.author_user_id,
              e.body,
              e.created_at,
              u.full_name as author_name,
              u.role as author_role
       from shift_handover_entries e
       join app_users u on u.id = e.author_user_id
       where e.area_id = any($1::int[])
       order by e.created_at desc
       limit 300`,
      [areaIds],
    );

    const membersByArea = new Map<number, Record<string, unknown>[]>();
    for (const row of membersResult.rows) {
      const areaId = Number(row.area_id);
      const arr = membersByArea.get(areaId) ?? [];
      arr.push(row);
      membersByArea.set(areaId, arr);
    }

    const entriesByArea = new Map<number, Record<string, unknown>[]>();
    for (const row of entriesResult.rows) {
      const areaId = Number(row.area_id);
      const arr = entriesByArea.get(areaId) ?? [];
      if (arr.length < 20) {
        arr.push(row);
      }
      entriesByArea.set(areaId, arr);
    }

    return res.json(
      areasResult.rows.map((row) => ({
        ...row,
        members: membersByArea.get(Number(row.id)) ?? [],
        entries: entriesByArea.get(Number(row.id)) ?? [],
      })),
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/areas', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId);
    const userId = parsePositive(body.userId);
    const name = String(body.name ?? '').trim();
    const serviceName = String(body.serviceName ?? body.service_name ?? '').trim();
    const instructions = String(body.instructions ?? '').trim() || null;
    const memberUserIds = parseMemberIds(body.memberUserIds ?? body.member_user_ids);

    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (!name || !serviceName) {
      return res.status(400).json({ message: 'Area e servico sao obrigatorios.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || !canManage(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem criar areas de passagem.',
      });
    }
    const valid = await validateCollaboratorUsers(condoId, memberUserIds);
    if (valid == null) {
      return res.status(400).json({ message: 'Colaborador invalido para este condominio.' });
    }

    const ins = await query(
      `insert into shift_handover_areas (
         condo_id, name, service_name, instructions, created_by_user_id
       )
       values ($1, $2, $3, $4, $5)
       returning id, condo_id, name, service_name, instructions, active,
                 created_by_user_id, created_at, updated_at`,
      [condoId, name, serviceName, instructions, userId],
    );
    const area = ins.rows[0];
    await replaceMembers(Number(area.id), condoId, valid);
    return res.status(201).json({ ...area, members: valid, entries: [] });
  } catch (err) {
    if (err instanceof Error && err.message === 'MEMBER_INVALID') {
      return res.status(400).json({ message: 'Colaborador invalido para este condominio.' });
    }
    return next(err);
  }
});

router.patch('/areas/:id', async (req, res, next) => {
  try {
    const areaId = parsePositive(req.params.id);
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId);
    const userId = parsePositive(body.userId);
    const name = String(body.name ?? '').trim();
    const serviceName = String(body.serviceName ?? body.service_name ?? '').trim();
    const instructions = String(body.instructions ?? '').trim() || null;
    const active = body.active === undefined ? true : body.active === true;
    const memberUserIds = parseMemberIds(body.memberUserIds ?? body.member_user_ids);

    if (areaId == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (!name || !serviceName) {
      return res.status(400).json({ message: 'Area e servico sao obrigatorios.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || !canManage(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem editar areas de passagem.',
      });
    }
    if (!(await areaBelongsToCondo(areaId, condoId))) {
      return res.status(404).json({ message: 'Area de passagem nao encontrada.' });
    }
    const valid = await validateCollaboratorUsers(condoId, memberUserIds);
    if (valid == null) {
      return res.status(400).json({ message: 'Colaborador invalido para este condominio.' });
    }

    const upd = await query(
      `update shift_handover_areas
       set name = $1,
           service_name = $2,
           instructions = $3,
           active = $4,
           updated_at = now()
       where id = $5 and condo_id = $6
       returning id, condo_id, name, service_name, instructions, active,
                 created_by_user_id, created_at, updated_at`,
      [name, serviceName, instructions, active, areaId, condoId],
    );
    await replaceMembers(areaId, condoId, valid);
    return res.json({ ...upd.rows[0], members: valid });
  } catch (err) {
    if (err instanceof Error && err.message === 'MEMBER_INVALID') {
      return res.status(400).json({ message: 'Colaborador invalido para este condominio.' });
    }
    return next(err);
  }
});

router.post('/areas/:id/entries', async (req, res, next) => {
  try {
    const areaId = parsePositive(req.params.id);
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId);
    const userId = parsePositive(body.userId);
    const entryBody = String(body.body ?? body.handoverText ?? '').trim();

    if (areaId == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (!entryBody) {
      return res.status(400).json({ message: 'Informe a passagem de turno.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || !canView(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao para passagem de turno.' });
    }
    if (!(await areaBelongsToCondo(areaId, condoId))) {
      return res.status(404).json({ message: 'Area de passagem nao encontrada.' });
    }
    if (!canManage(user, condoId) && !(await userIsAreaMember(areaId, userId))) {
      return res.status(403).json({
        message: 'Colaborador nao pertence a esta area de servico.',
      });
    }

    const ins = await query(
      `insert into shift_handover_entries (condo_id, area_id, author_user_id, body)
       values ($1, $2, $3, $4)
       returning id, condo_id, area_id, author_user_id, body, created_at`,
      [condoId, areaId, userId, entryBody],
    );
    return res.status(201).json({
      ...ins.rows[0],
      author_name: user.full_name,
      author_role: user.role,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;

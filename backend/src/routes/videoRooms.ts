import { randomBytes } from 'node:crypto';

import { Router } from 'express';

import { isOperationalStaff } from '../authz';
import { query } from '../db';
import { loadLegacyUserRow } from '../userContext';

const router = Router();

const JITSI_DEFAULT = (process.env.JITSI_BASE_URL || 'https://meet.jit.si').replace(
  /\/$/,
  '',
);

const ROOM_STATUSES = ['scheduled', 'live', 'ended'] as const;
type RoomStatus = (typeof ROOM_STATUSES)[number];

function parsePositive(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parseCondoIdQuery(raw: unknown): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return 1;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : 1;
}

function parseRoomStatus(raw: unknown): RoomStatus | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (ROOM_STATUSES.includes(s as RoomStatus)) {
    return s as RoomStatus;
  }
  return null;
}

function buildJoinUrl(jitsiBaseOverride: string | null | undefined, slug: string): string {
  const b =
    jitsiBaseOverride != null && String(jitsiBaseOverride).trim() !== ''
      ? String(jitsiBaseOverride).trim().replace(/\/$/, '')
      : JITSI_DEFAULT;
  return `${b}/${encodeURIComponent(slug)}`;
}

function slugifyTitle(title: string): string {
  const t = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return t || 'sala';
}

function generateRoomSlug(condoId: number, title: string): string {
  const suffix = randomBytes(3).toString('hex');
  const base = `condo-${condoId}-${slugifyTitle(title)}-${suffix}`;
  return base.slice(0, 200);
}

type AppUserRow = {
  id: number;
  condo_id: number;
  role: string;
  active: boolean;
};

async function loadUser(userId: number, condoId: number): Promise<AppUserRow | null> {
  const row = await loadLegacyUserRow(userId, condoId);
  if (row == null) {
    return null;
  }
  return row as AppUserRow;
}

function canAccessCondo(user: AppUserRow, condoId: number): boolean {
  return user.active === true && user.condo_id === condoId;
}

function canManageRooms(user: AppUserRow, condoId: number): boolean {
  return canAccessCondo(user, condoId) && isOperationalStaff(user.role);
}

function rowWithJoinUrl(row: Record<string, unknown>): Record<string, unknown> {
  const slug = String(row.room_slug);
  const base = row.jitsi_base_url as string | null | undefined;
  return {
    ...row,
    joinUrl: buildJoinUrl(base, slug),
    jitsiBaseDefault: JITSI_DEFAULT,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    const includeEnded = req.query.includeEnded === 'true';

    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canAccessCondo(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    let sql = `select id,
                      condo_id,
                      title,
                      description,
                      room_slug,
                      status,
                      scheduled_starts_at,
                      scheduled_ends_at,
                      jitsi_base_url,
                      created_by_user_id,
                      created_at,
                      updated_at
               from condo_video_rooms
               where condo_id = $1`;
    const params: unknown[] = [condoId];
    if (!includeEnded) {
      sql += ` and status <> 'ended'`;
    }
    sql += ` order by
               case status when 'live' then 0 when 'scheduled' then 1 else 2 end,
               scheduled_starts_at desc nulls last,
               created_at desc`;

    const r = await query(sql, params);
    return res.json(r.rows.map((row) => rowWithJoinUrl(row as Record<string, unknown>)));
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);

    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canAccessCondo(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    const r = await query(
      `select id,
              condo_id,
              title,
              description,
              room_slug,
              status,
              scheduled_starts_at,
              scheduled_ends_at,
              jitsi_base_url,
              created_by_user_id,
              created_at,
              updated_at
       from condo_video_rooms
       where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Sala nao encontrada.' });
    }
    return res.json(rowWithJoinUrl(r.rows[0] as Record<string, unknown>));
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoIdBody = body.condoId;
    const condoId =
      condoIdBody !== undefined &&
      condoIdBody !== null &&
      String(condoIdBody).trim() !== ''
        ? Number(condoIdBody)
        : NaN;
    const userId = parsePositive(body.userId);
    const title = String(body.title ?? '').trim();
    const description = String(body.description ?? '').trim() || null;
    const jitsiBaseUrl =
      String(body.jitsiBaseUrl ?? body.jitsi_base_url ?? '').trim() || null;
    let status: RoomStatus = 'scheduled';
    if (body.status !== undefined && String(body.status).trim() !== '') {
      const s = parseRoomStatus(body.status);
      if (s == null) {
        return res.status(400).json({ message: 'status invalido.' });
      }
      status = s;
    }
    const startsRaw = body.scheduledStartsAt ?? body.scheduled_starts_at;
    const endsRaw = body.scheduledEndsAt ?? body.scheduled_ends_at;
    let scheduledStarts: Date | null = null;
    let scheduledEnds: Date | null = null;
    if (startsRaw != null && String(startsRaw).trim() !== '') {
      scheduledStarts = new Date(String(startsRaw));
      if (Number.isNaN(scheduledStarts.getTime())) {
        return res.status(400).json({ message: 'scheduledStartsAt invalido.' });
      }
    }
    if (endsRaw != null && String(endsRaw).trim() !== '') {
      scheduledEnds = new Date(String(endsRaw));
      if (Number.isNaN(scheduledEnds.getTime())) {
        return res.status(400).json({ message: 'scheduledEndsAt invalido.' });
      }
    }

    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (!title) {
      return res.status(400).json({ message: 'title e obrigatorio.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageRooms(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem criar salas de videoconferencia.',
      });
    }

    let roomSlug = generateRoomSlug(condoId, title);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const chk = await query(
        `select id from condo_video_rooms where room_slug = $1 limit 1`,
        [roomSlug],
      );
      if (chk.rows.length === 0) {
        break;
      }
      roomSlug = generateRoomSlug(condoId, title);
    }

    const ins = await query(
      `insert into condo_video_rooms (
         condo_id, title, description, room_slug, status,
         scheduled_starts_at, scheduled_ends_at, jitsi_base_url, created_by_user_id
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id,
                 condo_id,
                 title,
                 description,
                 room_slug,
                 status,
                 scheduled_starts_at,
                 scheduled_ends_at,
                 jitsi_base_url,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [
        condoId,
        title,
        description,
        roomSlug,
        status,
        scheduledStarts,
        scheduledEnds,
        jitsiBaseUrl,
        userId,
      ],
    );

    return res
      .status(201)
      .json(rowWithJoinUrl(ins.rows[0] as Record<string, unknown>));
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const body = req.body || {};
    const condoIdBody = body.condoId;
    const condoId =
      condoIdBody !== undefined &&
      condoIdBody !== null &&
      String(condoIdBody).trim() !== ''
        ? Number(condoIdBody)
        : NaN;
    const userId = parsePositive(body.userId);

    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageRooms(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem alterar salas.',
      });
    }

    const ex = await query(
      `select id from condo_video_rooms where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (ex.rows.length === 0) {
      return res.status(404).json({ message: 'Sala nao encontrada.' });
    }

    const cur = await query(
      `select title, description, room_slug, status, scheduled_starts_at, scheduled_ends_at, jitsi_base_url
       from condo_video_rooms where id = $1`,
      [id],
    );
    const row = cur.rows[0] as {
      title: string;
      description: string | null;
      room_slug: string;
      status: string;
      scheduled_starts_at: Date | null;
      scheduled_ends_at: Date | null;
      jitsi_base_url: string | null;
    };

    let nextTitle = row.title;
    let nextDesc = row.description;
    let nextStatus = row.status as RoomStatus;
    let nextStarts = row.scheduled_starts_at;
    let nextEnds = row.scheduled_ends_at;
    let nextJitsi = row.jitsi_base_url;
    let changed = false;

    if (body.title !== undefined) {
      const t = String(body.title ?? '').trim();
      if (!t) {
        return res.status(400).json({ message: 'title invalido.' });
      }
      nextTitle = t;
      changed = true;
    }
    if (body.description !== undefined) {
      nextDesc = String(body.description ?? '').trim() || null;
      changed = true;
    }
    if (body.status !== undefined && String(body.status).trim() !== '') {
      const s = parseRoomStatus(body.status);
      if (s == null) {
        return res.status(400).json({ message: 'status invalido.' });
      }
      nextStatus = s;
      changed = true;
    }
    if (body.scheduledStartsAt !== undefined || body.scheduled_starts_at !== undefined) {
      const raw = body.scheduledStartsAt ?? body.scheduled_starts_at;
      if (raw === null || String(raw).trim() === '') {
        nextStarts = null;
      } else {
        const d = new Date(String(raw));
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: 'scheduledStartsAt invalido.' });
        }
        nextStarts = d;
      }
      changed = true;
    }
    if (body.scheduledEndsAt !== undefined || body.scheduled_ends_at !== undefined) {
      const raw = body.scheduledEndsAt ?? body.scheduled_ends_at;
      if (raw === null || String(raw).trim() === '') {
        nextEnds = null;
      } else {
        const d = new Date(String(raw));
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: 'scheduledEndsAt invalido.' });
        }
        nextEnds = d;
      }
      changed = true;
    }
    if (body.jitsiBaseUrl !== undefined || body.jitsi_base_url !== undefined) {
      nextJitsi =
        String(body.jitsiBaseUrl ?? body.jitsi_base_url ?? '').trim() || null;
      changed = true;
    }

    if (!changed) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    const r = await query(
      `update condo_video_rooms
       set title = $2,
           description = $3,
           status = $4,
           scheduled_starts_at = $5,
           scheduled_ends_at = $6,
           jitsi_base_url = $7,
           updated_at = now()
       where id = $1
       returning id,
                 condo_id,
                 title,
                 description,
                 room_slug,
                 status,
                 scheduled_starts_at,
                 scheduled_ends_at,
                 jitsi_base_url,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [id, nextTitle, nextDesc, nextStatus, nextStarts, nextEnds, nextJitsi],
    );

    return res.json(rowWithJoinUrl(r.rows[0] as Record<string, unknown>));
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId =
      req.query.condoId !== undefined && String(req.query.condoId).trim() !== ''
        ? Number(req.query.condoId)
        : NaN;
    const userId = parsePositive(req.query.userId);

    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageRooms(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem excluir salas.',
      });
    }

    const del = await query(
      `delete from condo_video_rooms where id = $1 and condo_id = $2 returning id`,
      [id, condoId],
    );
    if (del.rows.length === 0) {
      return res.status(404).json({ message: 'Sala nao encontrada.' });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;

import { Router } from 'express';

import { isBillingStaff, isOperationalStaff } from '../authz';
import { query } from '../db';
import { loadLegacyUserRow } from '../userContext';

const router = Router();

const JITSI_DEFAULT = (process.env.JITSI_BASE_URL || 'https://meet.jit.si').replace(
  /\/$/,
  '',
);

const ASSEMBLY_STATUSES = [
  'draft',
  'scheduled',
  'live',
  'completed',
  'cancelled',
] as const;
type AssemblyStatus = (typeof ASSEMBLY_STATUSES)[number];

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

function parseAssemblyStatus(raw: unknown): AssemblyStatus | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (ASSEMBLY_STATUSES.includes(s as AssemblyStatus)) {
    return s as AssemblyStatus;
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

function canManageAssemblies(user: AppUserRow, condoId: number): boolean {
  return canAccessCondo(user, condoId) && isOperationalStaff(user.role);
}

/** Criar, editar, excluir assembleias e consultar lista de presença (síndico e administração). */
function canManageAssemblyRecords(user: AppUserRow, condoId: number): boolean {
  return canAccessCondo(user, condoId) && isBillingStaff(user.role);
}

function enrichRow(row: Record<string, unknown>): Record<string, unknown> {
  const slug = row.room_slug != null ? String(row.room_slug) : '';
  const hasSlug = slug.length > 0;
  const base = row.jitsi_base_url as string | null | undefined;
  return {
    ...row,
    joinUrl: hasSlug ? buildJoinUrl(base, slug) : null,
    jitsiBaseDefault: JITSI_DEFAULT,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);

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

    const includeDraft = canManageAssemblies(user, condoId);

    const r = await query(
      `select a.id,
              a.condo_id,
              a.title,
              a.description,
              a.status,
              a.scheduled_starts_at,
              a.scheduled_ends_at,
              a.video_room_id,
              a.created_by_user_id,
              a.created_at,
              a.updated_at,
              v.room_slug,
              v.jitsi_base_url,
              v.title as video_room_title,
              (select count(*)::int
               from condo_assembly_attendance att
               where att.assembly_id = a.id) as attendance_count,
              exists(
                select 1 from condo_assembly_attendance att2
                where att2.assembly_id = a.id and att2.user_id = $2
              ) as i_present
       from condo_virtual_assemblies a
       left join condo_video_rooms v on v.id = a.video_room_id
       where a.condo_id = $1
         and ($3::boolean or a.status <> 'draft')
       order by
         case a.status
           when 'live' then 0
           when 'scheduled' then 1
           when 'completed' then 2
           else 3
         end,
         a.scheduled_starts_at desc nulls last,
         a.id desc`,
      [condoId, userId, includeDraft],
    );

    return res.json(r.rows.map((row) => enrichRow(row as Record<string, unknown>)));
  } catch (err) {
    return next(err);
  }
});

router.get('/:id/attendance', async (req, res, next) => {
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
    if (!canManageAssemblyRecords(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem consultar a lista de presenca.',
      });
    }

    const asm = await query(
      `select id from condo_virtual_assemblies where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (asm.rows.length === 0) {
      return res.status(404).json({ message: 'Assembleia nao encontrada.' });
    }

    const r = await query(
      `select u.id as user_id,
              u.full_name,
              u.login,
              u.role,
              att.marked_at
       from condo_assembly_attendance att
       join app_users u on u.id = att.user_id
       where att.assembly_id = $1
       order by att.marked_at asc`,
      [id],
    );

    return res.json(r.rows);
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

    const includeDraft = canManageAssemblies(user, condoId);

    const r = await query(
      `select a.id,
              a.condo_id,
              a.title,
              a.description,
              a.status,
              a.scheduled_starts_at,
              a.scheduled_ends_at,
              a.video_room_id,
              a.created_by_user_id,
              a.created_at,
              a.updated_at,
              v.room_slug,
              v.jitsi_base_url,
              v.title as video_room_title,
              (select count(*)::int
               from condo_assembly_attendance att
               where att.assembly_id = a.id) as attendance_count,
              (select att3.marked_at
               from condo_assembly_attendance att3
               where att3.assembly_id = a.id and att3.user_id = $3
               limit 1) as my_marked_at
       from condo_virtual_assemblies a
       left join condo_video_rooms v on v.id = a.video_room_id
       where a.id = $1 and a.condo_id = $2
         and ($4::boolean or a.status <> 'draft')`,
      [id, condoId, userId, includeDraft],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Assembleia nao encontrada.' });
    }
    return res.json(enrichRow(r.rows[0] as Record<string, unknown>));
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
    const videoRoomId = parsePositive(body.videoRoomId ?? body.video_room_id);

    let status: AssemblyStatus = 'draft';
    if (body.status !== undefined && String(body.status).trim() !== '') {
      const s = parseAssemblyStatus(body.status);
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
    if (!canManageAssemblies(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem criar assembleias.',
      });
    }

    if (videoRoomId != null) {
      const vr = await query(
        `select id from condo_video_rooms where id = $1 and condo_id = $2`,
        [videoRoomId, condoId],
      );
      if (vr.rows.length === 0) {
        return res.status(400).json({ message: 'Sala de video invalida para este condominio.' });
      }
    }

    const ins = await query(
      `insert into condo_virtual_assemblies (
         condo_id, title, description, status,
         scheduled_starts_at, scheduled_ends_at, video_room_id, created_by_user_id
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id,
                 condo_id,
                 title,
                 description,
                 status,
                 scheduled_starts_at,
                 scheduled_ends_at,
                 video_room_id,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [
        condoId,
        title,
        description,
        status,
        scheduledStarts,
        scheduledEnds,
        videoRoomId,
        userId,
      ],
    );

    const created = ins.rows[0] as Record<string, unknown>;
    const vid = created.video_room_id as number | null;
    let roomSlug: string | null = null;
    let jitsiBase: string | null = null;
    let videoRoomTitle: string | null = null;
    if (vid != null) {
      const j = await query(
        `select room_slug, jitsi_base_url, title
         from condo_video_rooms where id = $1`,
        [vid],
      );
      if (j.rows.length > 0) {
        const jr = j.rows[0] as {
          room_slug: string;
          jitsi_base_url: string | null;
          title: string;
        };
        roomSlug = jr.room_slug;
        jitsiBase = jr.jitsi_base_url;
        videoRoomTitle = jr.title;
      }
    }

    return res.status(201).json(
      enrichRow({
        ...created,
        room_slug: roomSlug,
        jitsi_base_url: jitsiBase,
        video_room_title: videoRoomTitle,
        attendance_count: 0,
        i_present: false,
      }),
    );
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
    if (!canManageAssemblyRecords(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem alterar assembleias.',
      });
    }

    const ex = await query(
      `select id from condo_virtual_assemblies where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (ex.rows.length === 0) {
      return res.status(404).json({ message: 'Assembleia nao encontrada.' });
    }

    const cur = await query(
      `select title, description, status, scheduled_starts_at, scheduled_ends_at, video_room_id
       from condo_virtual_assemblies where id = $1`,
      [id],
    );
    const row = cur.rows[0] as {
      title: string;
      description: string | null;
      status: string;
      scheduled_starts_at: Date | null;
      scheduled_ends_at: Date | null;
      video_room_id: number | null;
    };

    let nextTitle = row.title;
    let nextDesc = row.description;
    let nextStatus = row.status as AssemblyStatus;
    let nextStarts = row.scheduled_starts_at;
    let nextEnds = row.scheduled_ends_at;
    let nextVideoRoomId = row.video_room_id;
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
      const s = parseAssemblyStatus(body.status);
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
    if (body.videoRoomId !== undefined || body.video_room_id !== undefined) {
      const raw = body.videoRoomId ?? body.video_room_id;
      if (raw === null || raw === '' || String(raw).toLowerCase() === 'null') {
        nextVideoRoomId = null;
      } else {
        const vid = parsePositive(raw);
        if (vid == null) {
          return res.status(400).json({ message: 'videoRoomId invalido.' });
        }
        const vr = await query(
          `select id from condo_video_rooms where id = $1 and condo_id = $2`,
          [vid, condoId],
        );
        if (vr.rows.length === 0) {
          return res.status(400).json({ message: 'Sala de video invalida para este condominio.' });
        }
        nextVideoRoomId = vid;
      }
      changed = true;
    }

    if (!changed) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    const r = await query(
      `update condo_virtual_assemblies
       set title = $2,
           description = $3,
           status = $4,
           scheduled_starts_at = $5,
           scheduled_ends_at = $6,
           video_room_id = $7,
           updated_at = now()
       where id = $1
       returning id,
                 condo_id,
                 title,
                 description,
                 status,
                 scheduled_starts_at,
                 scheduled_ends_at,
                 video_room_id,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [id, nextTitle, nextDesc, nextStatus, nextStarts, nextEnds, nextVideoRoomId],
    );

    const updated = r.rows[0] as Record<string, unknown>;
    const vid = updated.video_room_id as number | null;
    let roomSlug: string | null = null;
    let jitsiBase: string | null = null;
    let videoRoomTitle: string | null = null;
    if (vid != null) {
      const j = await query(
        `select room_slug, jitsi_base_url, title
         from condo_video_rooms where id = $1`,
        [vid],
      );
      if (j.rows.length > 0) {
        const jr = j.rows[0] as {
          room_slug: string;
          jitsi_base_url: string | null;
          title: string;
        };
        roomSlug = jr.room_slug;
        jitsiBase = jr.jitsi_base_url;
        videoRoomTitle = jr.title;
      }
    }

    const cnt = await query(
      `select count(*)::int as c from condo_assembly_attendance where assembly_id = $1`,
      [id],
    );
    const attendanceCount = (cnt.rows[0] as { c: number }).c;
    const mine = await query(
      `select marked_at from condo_assembly_attendance
       where assembly_id = $1 and user_id = $2 limit 1`,
      [id, userId],
    );

    return res.json(
      enrichRow({
        ...updated,
        room_slug: roomSlug,
        jitsi_base_url: jitsiBase,
        video_room_title: videoRoomTitle,
        attendance_count: attendanceCount,
        my_marked_at: mine.rows.length > 0 ? mine.rows[0].marked_at : null,
      }),
    );
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
    if (!canManageAssemblyRecords(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem excluir assembleias.',
      });
    }

    const st = await query(
      `select status from condo_virtual_assemblies where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (st.rows.length === 0) {
      return res.status(404).json({ message: 'Assembleia nao encontrada.' });
    }
    const status = String((st.rows[0] as { status: string }).status);
    if (status === 'completed') {
      return res.status(409).json({
        message: 'Assembleias encerradas nao podem ser excluidas.',
      });
    }

    const del = await query(
      `delete from condo_virtual_assemblies where id = $1 and condo_id = $2 returning id`,
      [id, condoId],
    );
    if (del.rows.length === 0) {
      return res.status(404).json({ message: 'Assembleia nao encontrada.' });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/attendance', async (req, res, next) => {
  try {
    const assemblyId = parsePositive(req.params.id);
    const body = req.body || {};
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);

    if (assemblyId == null) {
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
    if (!canAccessCondo(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    const asm = await query(
      `select id, status from condo_virtual_assemblies where id = $1 and condo_id = $2`,
      [assemblyId, condoId],
    );
    if (asm.rows.length === 0) {
      return res.status(404).json({ message: 'Assembleia nao encontrada.' });
    }
    const st = String((asm.rows[0] as { status: string }).status);
    if (st === 'draft' || st === 'cancelled') {
      return res.status(409).json({
        message: 'Presenca nao pode ser registrada nesta situacao da assembleia.',
      });
    }

    const ins = await query(
      `insert into condo_assembly_attendance (assembly_id, user_id)
       values ($1, $2)
       on conflict (assembly_id, user_id) do update set marked_at = now()
       returning id, assembly_id, user_id, marked_at`,
      [assemblyId, userId],
    );

    return res.status(201).json(ins.rows[0] as Record<string, unknown>);
  } catch (err) {
    return next(err);
  }
});

export default router;

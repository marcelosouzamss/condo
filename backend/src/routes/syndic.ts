import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import multer from 'multer';
import { Router, type Request, type Response } from 'express';

import { isBillingStaff, isOperationalStaff } from '../authz';
import { query } from '../db';

const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

const ALLOWED_NOTICE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const noticeUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const noticeId = Number(req.params.id);
      const condoId = condoIdFromReq(req) ?? 1;
      const dir = path.join(
        UPLOADS_ROOT,
        'notices',
        `condo-${condoId}`,
        `notice-${noticeId}`,
      );
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_NOTICE_MIME.has(file.mimetype));
  },
});

const router = Router();

const RECENT_COMMUNICATIONS_DAYS = 30;

const RESERVATION_STATUSES = [
  'approved',
  'rejected',
  'cancelled',
  'pending',
] as const;
type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

const REGISTRATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

const URGENCY_LEVELS = ['normal', 'urgent'] as const;
type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

const NOTICE_AUDIENCE_ROLES = new Set([
  'admin',
  'syndic',
  'administrator',
  'resident',
  'partner',
  'collaborator',
  'doorman',
]);

const OCCURRENCE_STATUSES = ['open', 'in_progress', 'closed'] as const;
type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

function condoIdFromReq(req: Request): number | null {
  const raw =
    req.query.condoId != null ? req.query.condoId : req.body?.condoId;
  if (raw === undefined || raw === null || raw === '') {
    return 1;
  }
  const id = Number(raw);
  if (!Number.isFinite(id) || id < 1) {
    return null;
  }
  return id;
}

function normalizeNoticeAudience(raw: unknown): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (Array.isArray(raw)) {
    const roles = raw
      .map((item) => String(item ?? '').trim().toLowerCase())
      .filter((role) => NOTICE_AUDIENCE_ROLES.has(role));
    const unique = [...new Set(roles)];
    return unique.length > 0 ? unique.join(',') : null;
  }
  const text = String(raw).trim();
  if (!text) {
    return null;
  }
  const roles = text
    .split(/[,\s;|]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((role) => NOTICE_AUDIENCE_ROLES.has(role));
  const unique = [...new Set(roles)];
  return unique.length > 0 ? unique.join(',') : text;
}

function parseUserId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** userId em body (JSON/multipart) ou query (GET/DELETE). */
function noticeActorUserId(req: Request): number | null {
  const fromBody = parseUserId(req.body?.userId);
  if (fromBody != null) {
    return fromBody;
  }
  return parseUserId(req.query?.userId);
}

async function assertBillingStaffForNotices(
  req: Request,
  res: Response,
  condoId: number,
): Promise<boolean> {
  const userId = noticeActorUserId(req);
  if (userId == null) {
    res.status(400).json({ message: 'userId e obrigatorio para gerir avisos.' });
    return false;
  }
  const ur = await query(
    `select condo_id, role, active from app_users where id = $1 limit 1`,
    [userId],
  );
  if (ur.rows.length === 0) {
    res.status(403).json({ message: 'Usuario nao encontrado.' });
    return false;
  }
  const u = ur.rows[0] as { condo_id: number; role: string; active: boolean };
  if (!u.active || u.condo_id !== condoId || !isBillingStaff(u.role)) {
    res.status(403).json({
      message: 'Apenas sindico ou administracao podem gerir avisos no mural.',
    });
    return false;
  }
  return true;
}

async function assertOperationalStaffMaintenance(
  req: Request,
  res: Response,
  condoId: number,
): Promise<boolean> {
  const userId = noticeActorUserId(req);
  if (userId == null) {
    res.status(400).json({ message: 'userId e obrigatorio.' });
    return false;
  }
  const ur = await query(
    `select condo_id, role, active from app_users where id = $1 limit 1`,
    [userId],
  );
  if (ur.rows.length === 0) {
    res.status(403).json({ message: 'Usuario nao encontrado.' });
    return false;
  }
  const u = ur.rows[0] as { condo_id: number; role: string; active: boolean };
  if (!u.active || u.condo_id !== condoId || !isOperationalStaff(u.role)) {
    res.status(403).json({
      message: 'Acesso restrito a equipe do condominio.',
    });
    return false;
  }
  return true;
}

function overlapsUtcDay(dayYmd: string, startMs: number, endMs: number): boolean {
  const parts = dayYmd.split('-').map(Number);
  const y = parts[0];
  const mo = parts[1];
  const d = parts[2];
  if (y === undefined || mo === undefined || d === undefined) {
    return false;
  }
  const dayStart = Date.UTC(y, mo - 1, d);
  const dayEnd = dayStart + 86400000;
  return startMs < dayEnd && endMs > dayStart;
}

async function assertCondoExists(condoId: number): Promise<boolean> {
  const r = await query('select id from condos where id = $1', [condoId]);
  return r.rows.length > 0;
}

function parseIsoDateOrNull(raw: unknown): Date | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d;
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (!(await assertCondoExists(condoId))) {
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }

    const [
      openOccurrences,
      maintenanceOpen,
      recentCommunications,
      pendingReservations,
      pendingRegistrations,
    ] = await Promise.all([
      query(
        `select count(*)::int as c from occurrences
         where condo_id = $1 and status = 'open'`,
        [condoId],
      ),
      query(
        `select count(*)::int as c from maintenance_requests mr
         join units u on u.id = mr.unit_id
         where u.condo_id = $1 and mr.status in ('open', 'in_progress')`,
        [condoId],
      ),
      query(
        `select count(*)::int as c from (
           select id from notices
           where condo_id = $1
             and is_archived = false
             and published_at > now() - ($2::int * interval '1 day')
           union
           select id from mass_communications
           where condo_id = $1
             and created_at > now() - ($2::int * interval '1 day')
         ) x`,
        [condoId, RECENT_COMMUNICATIONS_DAYS],
      ),
      query(
        `select count(*)::int as c from space_reservations
         where condo_id = $1 and status = 'pending'`,
        [condoId],
      ),
      query(
        `select count(*)::int as c from registration_requests
         where condo_id = $1 and status = 'pending'`,
        [condoId],
      ),
    ]);

    return res.json({
      condoId,
      metrics: {
        openOccurrences: openOccurrences.rows[0].c as number,
        maintenanceRequestsOpen: maintenanceOpen.rows[0].c as number,
        recentCommunications: recentCommunications.rows[0].c as number,
      },
      approvalSummary: {
        pendingReservations: pendingReservations.rows[0].c as number,
        pendingRegistrations: pendingRegistrations.rows[0].c as number,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/approvals/reservations', async (req, res, next) => {
  try {
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const status = (req.query.status as string) || 'pending';
    const spaceIdRaw = req.query.spaceId;
    let sql = `select sr.id, sr.condo_id, sr.unit_id, sr.space_name, sr.starts_at,
              sr.ends_at, sr.status, sr.notes, sr.created_at,
              u.tower, u.number,
              coalesce(nullif(trim(sr.requester_name), ''), u.resident_name) as requester_name
       from space_reservations sr
       join units u on u.id = sr.unit_id
       where sr.condo_id = $1 and sr.status = $2`;
    const params: unknown[] = [condoId, status];
    if (
      spaceIdRaw !== undefined &&
      spaceIdRaw !== null &&
      String(spaceIdRaw).trim() !== ''
    ) {
      const sid = Number(spaceIdRaw);
      if (!Number.isFinite(sid) || sid < 1) {
        return res.status(400).json({ message: 'spaceId invalido.' });
      }
      sql += ` and exists (
        select 1 from reservation_spaces rs
        where rs.id = $3 and rs.condo_id = sr.condo_id and rs.name = sr.space_name
      )`;
      params.push(sid);
    }
    sql += ` order by sr.starts_at asc`;
    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.patch('/approvals/reservations/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status, notes } = (req.body || {}) as {
      status?: ReservationStatus;
      notes?: string;
    };
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (!status || !RESERVATION_STATUSES.includes(status)) {
      return res.status(400).json({
        message: 'status deve ser pending, approved, rejected ou cancelled.',
      });
    }

    const result = await query(
      `update space_reservations
       set status = $2, notes = coalesce($3, notes)
       where id = $1
       returning id, condo_id, unit_id, space_name, starts_at, ends_at, status,
                 notes, created_at`,
      [id, status, notes ?? null],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Reserva nao encontrada.' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.get('/reservation-spaces/:spaceId/calendar', async (req, res, next) => {
  try {
    const spaceId = Number(req.params.spaceId);
    if (!Number.isFinite(spaceId) || spaceId < 1) {
      return res.status(400).json({ message: 'spaceId invalido.' });
    }
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (!(await assertCondoExists(condoId))) {
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }

    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      month < 1 ||
      month > 12
    ) {
      return res.status(400).json({ message: 'year e month (1-12) obrigatorios.' });
    }

    const spaceResult = await query(
      `select id, name
       from reservation_spaces
       where id = $1 and condo_id = $2 and active = true`,
      [spaceId, condoId],
    );
    if (spaceResult.rows.length === 0) {
      return res.status(404).json({ message: 'Espaco nao encontrado.' });
    }
    const spaceName = spaceResult.rows[0].name as string;

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));

    const resv = await query(
      `select sr.id, sr.starts_at, sr.ends_at, sr.status,
              u.tower, u.number,
              coalesce(nullif(trim(sr.requester_name), ''), u.resident_name) as requester_name
       from space_reservations sr
       join units u on u.id = sr.unit_id
       where sr.condo_id = $1
         and sr.space_name = $2
         and sr.status in ('pending', 'approved')
         and sr.starts_at < $4::timestamptz
         and sr.ends_at > $3::timestamptz`,
      [condoId, spaceName, monthStart.toISOString(), monthEnd.toISOString()],
    );

    type BookingRow = {
      id: number;
      start: number;
      end: number;
      status: string;
      tower: string;
      number: string;
      requesterName: string;
    };
    const bookingRows: BookingRow[] = resv.rows.map((row) => ({
      id: row.id as number,
      start: new Date(row.starts_at as string).getTime(),
      end: new Date(row.ends_at as string).getTime(),
      status: String(row.status),
      tower: String(row.tower),
      number: String(row.number),
      requesterName: row.requester_name != null ? String(row.requester_name) : '',
    }));

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const todayStr = new Date().toISOString().slice(0, 10);
    type DayCell = 'free' | 'pending' | 'approved' | 'past';
    const days: {
      date: string;
      cell: DayCell;
      bookings: {
        id: number;
        tower: string;
        number: string;
        status: string;
        requesterName: string;
      }[];
    }[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isPast = dateStr < todayStr;
      const overlapping = bookingRows.filter((b) =>
        overlapsUtcDay(dateStr, b.start, b.end),
      );
      let cell: DayCell;
      if (!isPast) {
        const hasApproved = overlapping.some((b) => b.status === 'approved');
        const hasPending = overlapping.some((b) => b.status === 'pending');
        if (hasApproved) {
          cell = 'approved';
        } else if (hasPending) {
          cell = 'pending';
        } else {
          cell = 'free';
        }
      } else {
        cell = 'past';
      }
      const bookings = overlapping.map((b) => ({
        id: b.id,
        tower: b.tower,
        number: b.number,
        status: b.status,
        requesterName: b.requesterName,
      }));
      days.push({ date: dateStr, cell, bookings });
    }

    return res.json({ year, month, spaceId, days });
  } catch (err) {
    return next(err);
  }
});

router.get('/approvals/registrations', async (req, res, next) => {
  try {
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const status = (req.query.status as string) || 'pending';
    const r = await query(
      `select rr.id, rr.condo_id, rr.unit_id, rr.request_type, rr.full_name,
              rr.details, rr.status, rr.created_at,
              u.tower, u.number
       from registration_requests rr
       left join units u on u.id = rr.unit_id
       where rr.condo_id = $1 and rr.status = $2
       order by rr.created_at asc`,
      [condoId, status],
    );
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.patch('/approvals/registrations/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status } = (req.body || {}) as { status?: RegistrationStatus };
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (!status || !REGISTRATION_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ message: 'status deve ser pending, approved ou rejected.' });
    }

    const result = await query(
      `update registration_requests
       set status = $2
       where id = $1
       returning id, condo_id, unit_id, request_type, full_name, details,
                 status, created_at`,
      [id, status],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Cadastro nao encontrado.' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.get('/notices', async (req, res, next) => {
  try {
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const okStaff = await assertBillingStaffForNotices(req, res, condoId);
    if (!okStaff) {
      return;
    }
    const includeArchived = req.query.includeArchived === 'true';
    let sql = `select n.id, n.condo_id, n.title, n.content, n.published_at, n.expires_at, n.is_pinned,
              n.is_archived, n.urgency, n.audience,
              coalesce(
                (select json_agg(
                   json_build_object(
                     'id', na.id,
                     'fileName', na.file_name,
                     'mimeType', na.mime_type,
                     'url', '/uploads/' || na.storage_path
                   ) order by na.sort_order, na.id
                 )
                 from notice_attachments na
                 where na.notice_id = n.id),
                '[]'::json
              ) as attachments
       from notices n
       where n.condo_id = $1`;
    const params: unknown[] = [condoId];
    if (!includeArchived) {
      sql += ` and n.is_archived = false`;
    }
    sql += ` order by n.is_archived asc,
              n.is_pinned desc,
              coalesce(n.notice_sort_at, n.published_at) desc,
              n.id desc`;
    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/notices', async (req, res, next) => {
  try {
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const okStaff = await assertBillingStaffForNotices(req, res, condoId);
    if (!okStaff) {
      return;
    }
    const body = (req.body || {}) as {
      title?: string;
      content?: string;
      urgency?: UrgencyLevel;
      isPinned?: boolean;
      audience?: string | null;
      publishedAt?: unknown;
      expiresAt?: unknown | null;
    };
    const { title, content, urgency = 'normal', isPinned = false, audience } = body;
    const normalizedAudience = normalizeNoticeAudience(audience);

    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ message: 'title e content sao obrigatorios.' });
    }

    if (!URGENCY_LEVELS.includes(urgency)) {
      return res.status(400).json({ message: 'urgency deve ser normal ou urgent.' });
    }

    if (!(await assertCondoExists(condoId))) {
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }

    const publishedAt = parseIsoDateOrNull(body.publishedAt) ?? new Date();
    let expiresAt: Date | null = null;
    if (body.expiresAt === null) {
      expiresAt = null;
    } else if (body.expiresAt !== undefined && body.expiresAt !== '') {
      expiresAt = parseIsoDateOrNull(body.expiresAt);
      if (expiresAt == null) {
        return res.status(400).json({ message: 'expiresAt invalido.' });
      }
    }

    if (expiresAt != null && expiresAt.getTime() <= publishedAt.getTime()) {
      return res.status(400).json({
        message: 'Data de termino deve ser posterior a publicacao.',
      });
    }

    const insertSql = `insert into notices (
          condo_id, title, content, urgency, is_pinned, audience, published_at, expires_at
       )
       values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8)
       returning id, condo_id, title, content, published_at, expires_at, is_pinned,
                 is_archived, urgency, audience`;

    const inserted = await query(insertSql, [
      condoId,
      title.trim(),
      content.trim(),
      urgency,
      Boolean(isPinned),
      normalizedAudience,
      publishedAt.toISOString(),
      expiresAt != null ? expiresAt.toISOString() : null,
    ]);

    return res.status(201).json(inserted.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/notices/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const okStaff = await assertBillingStaffForNotices(req, res, condoId);
    if (!okStaff) {
      return;
    }

    const body = (req.body || {}) as {
      isPinned?: boolean;
      isArchived?: boolean;
      urgency?: UrgencyLevel;
      title?: string;
      content?: string;
      publishedAt?: unknown;
      expiresAt?: unknown | null;
      audience?: string | null;
    };

    const {
      isPinned,
      isArchived,
      urgency,
      title,
      content,
      publishedAt,
      expiresAt,
      audience,
    } = body;

    const existing = await query(
      `select published_at, expires_at, is_pinned
       from notices where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Aviso nao encontrado.' });
    }

    let effPublished = new Date(existing.rows[0].published_at as string);
    let effExpires: Date | null = existing.rows[0].expires_at
      ? new Date(existing.rows[0].expires_at as string)
      : null;

    if (publishedAt !== undefined) {
      const pd = parseIsoDateOrNull(publishedAt);
      if (pd == null) {
        return res.status(400).json({ message: 'publishedAt invalido.' });
      }
      effPublished = pd;
    }
    if (expiresAt !== undefined) {
      if (expiresAt === null || expiresAt === '') {
        effExpires = null;
      } else {
        const ex = parseIsoDateOrNull(expiresAt);
        if (ex == null) {
          return res.status(400).json({ message: 'expiresAt invalido.' });
        }
        effExpires = ex;
      }
    }

    if (effExpires != null && effExpires.getTime() <= effPublished.getTime()) {
      return res.status(400).json({
        message: 'Data de termino deve ser posterior a publicacao.',
      });
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (title !== undefined) {
      const t = String(title).trim();
      if (!t) {
        return res.status(400).json({ message: 'title invalido.' });
      }
      sets.push(`title = $${p++}`);
      params.push(t);
    }
    if (content !== undefined) {
      const c = String(content).trim();
      if (!c) {
        return res.status(400).json({ message: 'content invalido.' });
      }
      sets.push(`content = $${p++}`);
      params.push(c);
    }

    if (isPinned !== undefined) {
      const nextPinned = Boolean(isPinned);
      sets.push(`is_pinned = $${p++}`);
      params.push(nextPinned);
      if (existing.rows[0].is_pinned === true && !nextPinned) {
        sets.push(`notice_sort_at = now()`);
      }
    }
    if (isArchived !== undefined) {
      sets.push(`is_archived = $${p++}`);
      params.push(Boolean(isArchived));
    }
    if (urgency !== undefined) {
      if (!URGENCY_LEVELS.includes(urgency)) {
        return res.status(400).json({ message: 'urgency invalido.' });
      }
      sets.push(`urgency = $${p++}`);
      params.push(urgency);
    }
    if (audience !== undefined) {
      sets.push(`audience = $${p++}`);
      params.push(normalizeNoticeAudience(audience));
    }

    if (publishedAt !== undefined) {
      sets.push(`published_at = $${p++}`);
      params.push(effPublished.toISOString());
    }

    if (expiresAt !== undefined) {
      if (effExpires == null) {
        sets.push(`expires_at = null`);
      } else {
        sets.push(`expires_at = $${p++}`);
        params.push(effExpires.toISOString());
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    params.push(id, condoId);
    const idPh = p++;
    const condoPh = p;

    const result = await query(
      `update notices set ${sets.join(', ')}
       where id = $${idPh} and condo_id = $${condoPh}
       returning id, condo_id, title, content, published_at, expires_at, is_pinned,
                 is_archived, urgency, audience`,
      params,
    );

    return res.json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete('/notices/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const okStaff = await assertBillingStaffForNotices(req, res, condoId);
    if (!okStaff) {
      return;
    }

    const del = await query(
      `delete from notices where id = $1 and condo_id = $2 returning id`,
      [id, condoId],
    );
    if (del.rows.length === 0) {
      return res.status(404).json({ message: 'Aviso nao encontrado.' });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.get('/reports/financial', async (req, res, next) => {
  try {
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const monthRaw = req.query.month as string | undefined;
    let monthStart: string;
    if (monthRaw) {
      const d = new Date(`${monthRaw}-01`);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: 'month deve ser YYYY-MM.' });
      }
      monthStart = d.toISOString().slice(0, 10);
    } else {
      const now = new Date();
      monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }

    const totals = await query(
      `select
         coalesce(sum(case when type = 'revenue' then amount else 0 end), 0)::numeric(14,2) as revenue,
         coalesce(sum(case when type = 'expense' then amount else 0 end), 0)::numeric(14,2) as expense
       from financial_entries
       where condo_id = $1 and entry_month = $2::date`,
      [condoId, monthStart],
    );

    const byCategory = await query(
      `select type, category, sum(amount)::numeric(14,2) as total
       from financial_entries
       where condo_id = $1 and entry_month = $2::date
       group by type, category
       order by type, category`,
      [condoId, monthStart],
    );

    const revenue = Number(totals.rows[0].revenue);
    const expense = Number(totals.rows[0].expense);

    return res.json({
      condoId,
      month: monthStart,
      summary: {
        revenue,
        expense,
        balance: revenue - expense,
      },
      byCategory: byCategory.rows,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/reports/area-usage', async (req, res, next) => {
  try {
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const r = await query(
      `select space_name, count(*)::int as reservation_count
       from space_reservations
       where condo_id = $1
         and status = 'approved'
         and starts_at > now() - interval '90 days'
       group by space_name
       order by reservation_count desc, space_name`,
      [condoId],
    );

    return res.json({ condoId, usageBySpace: r.rows });
  } catch (err) {
    return next(err);
  }
});

router.get('/reports/operations', async (req, res, next) => {
  try {
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const occ = await query(
      `select status, count(*)::int as c
       from occurrences
       where condo_id = $1
       group by status`,
      [condoId],
    );

    const maint = await query(
      `select mr.status, count(*)::int as c
       from maintenance_requests mr
       join units u on u.id = mr.unit_id
       where u.condo_id = $1
       group by mr.status`,
      [condoId],
    );

    const avgResolve = await query(
      `select coalesce(
         avg(extract(epoch from (resolved_at - created_at)) / 3600.0),
         0
       )::numeric(10,2) as avg_hours_to_resolve
       from occurrences
       where condo_id = $1 and status = 'closed' and resolved_at is not null`,
      [condoId],
    );

    return res.json({
      condoId,
      occurrencesByStatus: occ.rows,
      maintenanceByStatus: maint.rows,
      avgHoursToResolveOccurrences: Number(
        avgResolve.rows[0].avg_hours_to_resolve,
      ),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/communications/broadcast', async (req, res, next) => {
  try {
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const { subject, message, audience, publishAsNotice = true } =
      (req.body || {}) as {
        subject?: string;
        message?: string;
        audience?: string;
        publishAsNotice?: boolean;
      };

    if (!subject || !message || !audience) {
      return res.status(400).json({
        message: 'subject, message e audience sao obrigatorios.',
      });
    }

    if (!(await assertCondoExists(condoId))) {
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }

    const okStaff = await assertBillingStaffForNotices(req, res, condoId);
    if (!okStaff) {
      return;
    }

    const mc = await query(
      `insert into mass_communications (condo_id, subject, message, audience)
       values ($1, $2, $3, $4)
       returning id, condo_id, subject, message, audience, created_at`,
      [condoId, subject, message, audience],
    );

    let notice: unknown = null;
    if (publishAsNotice) {
      const n = await query(
        `insert into notices (condo_id, title, content, urgency, audience)
         values ($1, $2, $3, 'normal', $4)
         returning id, condo_id, title, content, published_at, audience`,
        [condoId, subject, message, audience],
      );
      notice = n.rows[0];
    }

    return res.status(201).json({
      communication: mc.rows[0],
      notice,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/occurrences', async (req, res, next) => {
  try {
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const status = req.query.status as string | undefined;
    let sql = `select id, condo_id, unit_id, title, description, category, status,
                      reporter_name, syndic_response,
                      created_at, updated_at, resolved_at
               from occurrences where condo_id = $1`;
    const params: unknown[] = [condoId];
    if (status) {
      sql += ` and status = $2`;
      params.push(status);
    }
    sql += ' order by created_at desc';
    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.get('/occurrences/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const condoId = condoIdFromReq(req);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const r = await query(
      `select o.id, o.condo_id, o.unit_id, o.title, o.description, o.category, o.status,
              o.reporter_name, o.syndic_response,
              o.created_at, o.updated_at, o.resolved_at,
              u.tower as unit_tower, u.number as unit_number
       from occurrences o
       left join units u on u.id = o.unit_id
       where o.id = $1 and o.condo_id = $2`,
      [id, condoId],
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Ocorrencia nao encontrada.' });
    }

    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.post('/occurrences', async (req, res, next) => {
  try {
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const { title, description, category, unitId, status = 'open', reporterName } =
      (req.body || {}) as {
        title?: string;
        description?: string;
        category?: string | null;
        unitId?: number | null;
        status?: OccurrenceStatus;
        reporterName?: string | null;
      };

    if (!title || !description) {
      return res.status(400).json({
        message: 'title e description sao obrigatorios.',
      });
    }
    if (!OCCURRENCE_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'status invalido.' });
    }

    if (!(await assertCondoExists(condoId))) {
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }

    const r = await query(
      `insert into occurrences (condo_id, unit_id, title, description, category, status, reporter_name)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, condo_id, unit_id, title, description, category, status, reporter_name, syndic_response,
                 created_at, updated_at, resolved_at`,
      [
        condoId,
        unitId || null,
        title,
        description,
        category || null,
        status,
        reporterName || null,
      ],
    );

    return res.status(201).json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/occurrences/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const { status, title, description, category, resolvedAt, syndicResponse } =
      (req.body || {}) as {
        status?: OccurrenceStatus;
        title?: string;
        description?: string;
        category?: string | null;
        resolvedAt?: string | null;
        syndicResponse?: string | null;
      };
    const sets: string[] = [];
    const params: unknown[] = [];

    if (title !== undefined) {
      sets.push(`title = $${params.length + 1}`);
      params.push(title);
    }
    if (description !== undefined) {
      sets.push(`description = $${params.length + 1}`);
      params.push(description);
    }
    if (category !== undefined) {
      sets.push(`category = $${params.length + 1}`);
      params.push(category);
    }
    if (syndicResponse !== undefined) {
      sets.push(`syndic_response = $${params.length + 1}`);
      params.push(syndicResponse);
    }
    if (status !== undefined) {
      if (!OCCURRENCE_STATUSES.includes(status)) {
        return res.status(400).json({ message: 'status invalido.' });
      }
      sets.push(`status = $${params.length + 1}`);
      params.push(status);
      if (status === 'closed') {
        sets.push(
          `resolved_at = coalesce($${params.length + 1}::timestamptz, now())`,
        );
        params.push(resolvedAt ?? null);
      } else {
        sets.push('resolved_at = null');
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    sets.push('updated_at = now()');
    params.push(id);
    const idPlaceholder = params.length;

    const result = await query(
      `update occurrences set ${sets.join(', ')}
       where id = $${idPlaceholder}
       returning id, condo_id, unit_id, title, description, category, status,
                 reporter_name, syndic_response,
                 created_at, updated_at, resolved_at`,
      params,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Ocorrencia nao encontrada.' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.get('/maintenance-requests', async (req, res, next) => {
  try {
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const r = await query(
      `select mr.id, mr.unit_id, mr.title, mr.description, mr.priority, mr.status,
              mr.syndic_response, mr.created_at, mr.updated_at,
              u.tower, u.number
       from maintenance_requests mr
       join units u on u.id = mr.unit_id
       where u.condo_id = $1
       order by mr.created_at desc`,
      [condoId],
    );

    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

/** Pedidos agrupados por unidade (visão síndico). */
router.get('/maintenance-requests-by-unit', async (req, res, next) => {
  try {
    const condoId = condoIdFromReq(req);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const r = await query(
      `select u.id as unit_id,
              u.tower,
              u.number,
              u.resident_name,
              coalesce(
                (select json_agg(
                   json_build_object(
                     'id', mr.id,
                     'title', mr.title,
                     'description', mr.description,
                     'priority', mr.priority,
                     'status', mr.status,
                     'syndic_response', mr.syndic_response,
                     'created_at', mr.created_at,
                     'updated_at', mr.updated_at
                   ) order by mr.created_at desc
                 )
                 from maintenance_requests mr
                 where mr.unit_id = u.id),
                '[]'::json
              ) as requests
       from units u
       where u.condo_id = $1
         and exists (
           select 1 from maintenance_requests mr2 where mr2.unit_id = u.id
         )
       order by u.tower asc, u.number asc`,
      [condoId],
    );

    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.get('/maintenance-requests/:id/messages', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const condoId = condoIdFromReq(req);
    const userId = parseUserId(req.query.userId);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const okStaff = await assertOperationalStaffMaintenance(req, res, condoId);
    if (!okStaff) {
      return;
    }

    const mr = await query(
      `select mr.id
       from maintenance_requests mr
       join units u on u.id = mr.unit_id
       where mr.id = $1 and u.condo_id = $2`,
      [id, condoId],
    );
    if (mr.rows.length === 0) {
      return res.status(404).json({ message: 'Solicitacao nao encontrada.' });
    }

    const list = await query(
      `select m.id,
              m.user_id,
              m.author_role,
              m.body,
              m.created_at,
              u.full_name,
              u.role as user_role
       from maintenance_request_messages m
       join app_users u on u.id = m.user_id
       where m.maintenance_request_id = $1
       order by m.created_at asc`,
      [id],
    );

    return res.json(list.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/maintenance-requests/:id/messages', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const condoId = condoIdFromReq(req);
    const body = (req.body || {}) as { body?: unknown };
    const text = String(body.body ?? '').trim();

    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (!text) {
      return res.status(400).json({ message: 'body e obrigatorio.' });
    }

    const okStaff = await assertOperationalStaffMaintenance(req, res, condoId);
    if (!okStaff) {
      return;
    }

    const userId = noticeActorUserId(req);
    if (userId == null) {
      return;
    }

    const mr = await query(
      `select mr.id
       from maintenance_requests mr
       join units u on u.id = mr.unit_id
       where mr.id = $1 and u.condo_id = $2`,
      [id, condoId],
    );
    if (mr.rows.length === 0) {
      return res.status(404).json({ message: 'Solicitacao nao encontrada.' });
    }

    const ins = await query(
      `insert into maintenance_request_messages (
         maintenance_request_id, user_id, author_role, body
       )
       values ($1, $2, 'staff', $3)
       returning id, maintenance_request_id, user_id, author_role, body, created_at`,
      [id, userId, text],
    );

    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.get('/maintenance-requests/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const condoId = condoIdFromReq(req);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const r = await query(
      `select mr.id, mr.unit_id, mr.title, mr.description, mr.priority, mr.status,
              mr.syndic_response, mr.created_at, mr.updated_at,
              u.tower, u.number, u.resident_name
       from maintenance_requests mr
       join units u on u.id = mr.unit_id
       where mr.id = $1 and u.condo_id = $2`,
      [id, condoId],
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Solicitacao nao encontrada.' });
    }

    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/maintenance-requests/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const condoId = condoIdFromReq(req);
    const { status, syndicResponse } = (req.body || {}) as {
      status?: string;
      syndicResponse?: string | null;
    };
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const okStaff = await assertOperationalStaffMaintenance(req, res, condoId);
    if (!okStaff) {
      return;
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (syndicResponse !== undefined) {
      sets.push(`syndic_response = $${params.length + 1}`);
      params.push(syndicResponse);
    }

    if (status !== undefined) {
      if (!['open', 'in_progress', 'completed', 'closed'].includes(status)) {
        return res.status(400).json({ message: 'status invalido.' });
      }
      sets.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    sets.push('updated_at = now()');
    params.push(id);
    const idPlaceholder = params.length;

    const result = await query(
      `update maintenance_requests
       set ${sets.join(', ')}
       where id = $${idPlaceholder}
       returning id, unit_id, title, description, priority, status,
                 syndic_response, created_at, updated_at`,
      params,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Solicitacao nao encontrada.' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.post(
  '/notices/:id/attachments',
  async (req, res, next) => {
    try {
      const noticeId = Number(req.params.id);
      const condoId = condoIdFromReq(req);
      if (!Number.isFinite(noticeId) || noticeId < 1 || condoId == null) {
        return res.status(400).json({ message: 'parametros invalidos.' });
      }
      const n = await query(
        `select id from notices where id = $1 and condo_id = $2`,
        [noticeId, condoId],
      );
      if (n.rows.length === 0) {
        return res.status(404).json({ message: 'Aviso nao encontrado.' });
      }
      next();
    } catch (err) {
      return next(err);
    }
  },
  noticeUpload.array('files', 12),
  async (req, res, next) => {
    try {
      const noticeId = Number(req.params.id);
      const condoId = condoIdFromReq(req);
      if (condoId == null) {
        return res.status(400).json({ message: 'condoId invalido.' });
      }
      const okStaff = await assertBillingStaffForNotices(req, res, condoId);
      if (!okStaff) {
        return;
      }
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files?.length) {
        return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
      }

      const sortR = await query(
        `select coalesce(max(sort_order), -1) + 1 as n
         from notice_attachments where notice_id = $1`,
        [noticeId],
      );
      let sortOrder = sortR.rows[0].n as number;

      const inserted: unknown[] = [];
      for (const f of files) {
        const relative = path
          .relative(UPLOADS_ROOT, f.path)
          .split(path.sep)
          .join('/');
        const safeName = f.originalname.trim().slice(0, 255) || 'arquivo';
        const ins = await query(
          `insert into notice_attachments (
             notice_id, sort_order, file_name, mime_type, byte_size, storage_path
           )
           values ($1, $2, $3, $4, $5, $6)
           returning id, file_name, mime_type, storage_path`,
          [
            noticeId,
            sortOrder++,
            safeName,
            f.mimetype,
            f.size,
            relative,
          ],
        );
        const row = ins.rows[0];
        inserted.push({
          id: row.id,
          fileName: row.file_name,
          mimeType: row.mime_type,
          url: `/uploads/${row.storage_path as string}`,
        });
      }

      return res.status(201).json({ attachments: inserted });
    } catch (err) {
      return next(err);
    }
  },
);

router.delete('/notices/:noticeId/attachments/:attachmentId', async (req, res, next) => {
  try {
    const noticeId = Number(req.params.noticeId);
    const attachmentId = Number(req.params.attachmentId);
    const condoId = condoIdFromReq(req);
    if (
      !Number.isFinite(noticeId) ||
      !Number.isFinite(attachmentId) ||
      condoId == null
    ) {
      return res.status(400).json({ message: 'parametros invalidos.' });
    }
    const okStaff = await assertBillingStaffForNotices(req, res, condoId);
    if (!okStaff) {
      return;
    }

    const del = await query(
      `delete from notice_attachments na
       using notices n
       where na.id = $1
         and na.notice_id = $2
         and n.id = na.notice_id
         and n.condo_id = $3
       returning na.storage_path`,
      [attachmentId, noticeId, condoId],
    );

    if (del.rows.length === 0) {
      return res.status(404).json({ message: 'Anexo nao encontrado.' });
    }

    const rel = del.rows[0].storage_path as string;
    const abs = path.join(UPLOADS_ROOT, rel);
    fs.unlink(abs, () => {});

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;

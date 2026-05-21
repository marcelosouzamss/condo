import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import multer from 'multer';
import { Router } from 'express';

import { query } from '../db';

const router = Router();

const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');
const MAX_SPACE_PHOTOS = 8;
const MAX_JSON_IMAGE_BYTES = 6 * 1024 * 1024;

const spacePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const condoId = parseCondoId(req.query.condoId);
      const dir = path.join(
        UPLOADS_ROOT,
        'reservation-spaces',
        `condo-${condoId ?? 1}`,
      );
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok =
      /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype) ||
      (file.mimetype === 'application/octet-stream' &&
        ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext));
    cb(null, ok);
  },
});

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

function parseCondoId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return 1;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function stripDataUrlBase64(raw: string): string {
  const t = raw.trim();
  const idx = t.indexOf('base64,');
  if (idx >= 0) {
    return t.slice(idx + 7);
  }
  return t;
}

function imageExtFromMagic(buf: Buffer): string | null {
  if (buf.length < 12) {
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    return '.jpg';
  }
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return '.png';
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return '.gif';
  }
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return '.webp';
  }
  return null;
}

function parseSpacePhotoUrls(raw: unknown, fallback?: string | null): string[] {
  let values: unknown[] = [];
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const decoded = JSON.parse(raw);
      values = Array.isArray(decoded) ? decoded : [raw];
    } catch {
      values = [raw];
    }
  } else if (fallback != null && String(fallback).trim() !== '') {
    values = [fallback];
  }

  const out: string[] = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text !== '' && text.startsWith('/uploads/') && !out.includes(text)) {
      out.push(text);
    }
    if (out.length >= MAX_SPACE_PHOTOS) {
      break;
    }
  }
  return out;
}

function photoUrlsFromRow(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return parseSpacePhotoUrls(raw);
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      return parseSpacePhotoUrls(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const result = await query(
      `select id, condo_id, name, description, icon_key, capacity,
              requires_approval, active, photo_urls, created_at
       from reservation_spaces
       where condo_id = $1 and active = true
       order by name asc`,
      [condoId],
    );

    const rows = result.rows.map((row) => ({
      ...row,
      photo_urls: photoUrlsFromRow(row.photo_urls),
    }));

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post('/upload-photo', spacePhotoUpload.single('photo'), async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const file = req.file;
    const cleanup = () => {
      if (file) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* empty */
        }
      }
    };

    const condo = await query('select id from condos where id = $1', [condoId]);
    if (condo.rows.length === 0) {
      cleanup();
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }

    if (!file) {
      return res.status(400).json({
        message: 'Envie o arquivo no campo photo (multipart/form-data).',
      });
    }

    const relPath = path.relative(UPLOADS_ROOT, file.path).split(path.sep).join('/');
    const photoUrl = `/uploads/${relPath}`;
    return res.status(201).json({ photoUrl });
  } catch (error) {
    return next(error);
  }
});

router.post('/upload-photo-json', async (req, res, next) => {
  try {
    const body = (req.body || {}) as {
      condoId?: unknown;
      imageBase64?: unknown;
      image_base64?: unknown;
      filename?: unknown;
    };
    const condoId = parseCondoId(body.condoId ?? req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const rawB64 = String(body.imageBase64 ?? body.image_base64 ?? '').trim();
    if (!rawB64) {
      return res.status(400).json({ message: 'imageBase64 e obrigatorio.' });
    }

    const condo = await query('select id from condos where id = $1', [condoId]);
    if (condo.rows.length === 0) {
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }

    let buf: Buffer;
    try {
      buf = Buffer.from(stripDataUrlBase64(rawB64), 'base64');
    } catch {
      return res.status(400).json({ message: 'Base64 invalido.' });
    }
    if (buf.length === 0 || buf.length > MAX_JSON_IMAGE_BYTES) {
      return res.status(400).json({
        message: 'Imagem vazia ou muito grande (max 6MB).',
      });
    }

    const ext = imageExtFromMagic(buf);
    if (ext == null) {
      return res.status(400).json({
        message: 'Tipo de imagem nao suportado (use JPEG, PNG, GIF ou WEBP).',
      });
    }

    const dir = path.join(
      UPLOADS_ROOT,
      'reservation-spaces',
      `condo-${condoId}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    const fname = `${crypto.randomBytes(16).toString('hex')}${ext}`;
    const absPath = path.join(dir, fname);
    fs.writeFileSync(absPath, buf);

    const relPath = path.relative(UPLOADS_ROOT, absPath).split(path.sep).join('/');
    const photoUrl = `/uploads/${relPath}`;
    return res.status(201).json({ photoUrl });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const {
      condoId: rawCondoId,
      name,
      description,
      iconKey = 'meeting_room',
      capacity,
      requiresApproval = true,
      photoUrls,
      photo_urls,
    } = (req.body || {}) as {
      condoId?: number;
      name?: string;
      description?: string;
      iconKey?: string;
      capacity?: number | null;
      requiresApproval?: boolean;
      photoUrls?: unknown;
      photo_urls?: unknown;
    };

    const condoId = parseCondoId(rawCondoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const trimmedName = name?.trim();
    const trimmedDescription = description?.trim();
    if (!trimmedName || !trimmedDescription) {
      return res.status(400).json({
        message: 'name e description sao obrigatorios.',
      });
    }

    const parsedPhotos = parseSpacePhotoUrls(photoUrls ?? photo_urls);

    const condo = await query('select id from condos where id = $1', [condoId]);
    if (condo.rows.length === 0) {
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }

    const result = await query(
      `insert into reservation_spaces (
         condo_id,
         name,
         description,
         icon_key,
         capacity,
         requires_approval,
         photo_urls
       )
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)
       returning id, condo_id, name, description, icon_key, capacity,
                 requires_approval, active, photo_urls, created_at`,
      [
        condoId,
        trimmedName,
        trimmedDescription,
        iconKey,
        capacity ?? null,
        Boolean(requiresApproval),
        JSON.stringify(parsedPhotos),
      ],
    );

    const row = result.rows[0] as Record<string, unknown>;
    return res.status(201).json({
      ...row,
      photo_urls: photoUrlsFromRow(row.photo_urls),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/my-reservations', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const unitId = Number(req.query.unitId);
    if (!Number.isFinite(unitId) || unitId <= 0) {
      return res.status(400).json({ message: 'unitId invalido.' });
    }

    const unitOk = await query(
      `select 1 from units where id = $1 and condo_id = $2`,
      [unitId, condoId],
    );
    if (unitOk.rows.length === 0) {
      return res.status(400).json({ message: 'Unidade invalida.' });
    }

    const r = await query(
      `select sr.id,
              sr.space_name,
              sr.starts_at,
              sr.ends_at,
              sr.status,
              rs.id as reservation_space_id
       from space_reservations sr
       left join reservation_spaces rs
         on rs.condo_id = sr.condo_id
        and rs.name = sr.space_name
        and rs.active = true
       where sr.condo_id = $1
         and sr.unit_id = $2
         and sr.status in ('pending', 'approved')
         and sr.ends_at > now()
       order by sr.starts_at asc`,
      [condoId, unitId],
    );

    return res.json(r.rows);
  } catch (error) {
    return next(error);
  }
});

router.patch('/reservations/:id/cancel', async (req, res, next) => {
  try {
    const reservationId = Number(req.params.id);
    if (!Number.isFinite(reservationId) || reservationId <= 0) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const body = (req.body || {}) as {
      condoId?: unknown;
      unitId?: unknown;
    };
    const condoId = parseCondoId(body.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const unitId = Number(body.unitId);
    if (!Number.isFinite(unitId) || unitId <= 0) {
      return res.status(400).json({ message: 'unitId invalido.' });
    }

    const result = await query(
      `update space_reservations
       set status = 'cancelled'
       where id = $1
         and condo_id = $2
         and unit_id = $3
         and status in ('pending', 'approved')
       returning id, space_name, starts_at, ends_at, status`,
      [reservationId, condoId, unitId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Reserva nao encontrada ou nao pode ser cancelada.',
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/calendar', async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
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

    const staffView =
      String(req.query.staffView ?? req.query.staff_view ?? '').trim() === '1' ||
      String(req.query.staffView ?? req.query.staff_view ?? '').toLowerCase() === 'true';

    const spaceResult = await query(
      `select id, name, condo_id
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

    if (staffView) {
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
        requesterName:
          row.requester_name != null ? String(row.requester_name) : '',
      }));

      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const todayStr = new Date().toISOString().slice(0, 10);
      type DayCell = 'free' | 'pending' | 'approved' | 'past';
      const days: {
        date: string;
        cell: DayCell;
        available: boolean;
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
        days.push({
          date: dateStr,
          cell,
          available: cell === 'free',
          bookings,
        });
      }

      return res.json({ year, month, spaceId, days });
    }

    const resv = await query(
      `select starts_at, ends_at, status
       from space_reservations
       where condo_id = $1
         and space_name = $2
         and status in ('pending', 'approved')
         and starts_at < $4::timestamptz
         and ends_at > $3::timestamptz`,
      [condoId, spaceName, monthStart.toISOString(), monthEnd.toISOString()],
    );

    const bookings = resv.rows.map((row) => ({
      start: new Date(row.starts_at as string).getTime(),
      end: new Date(row.ends_at as string).getTime(),
      status: String(row.status),
    }));

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const todayStr = new Date().toISOString().slice(0, 10);
    type DayCell = 'free' | 'pending' | 'approved' | 'past';
    const days: { date: string; cell: DayCell; available: boolean }[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isPast = dateStr < todayStr;
      let cell: DayCell;
      if (isPast) {
        cell = 'past';
      } else {
        const overlapping = bookings.filter((b) =>
          overlapsUtcDay(dateStr, b.start, b.end),
        );
        const hasApproved = overlapping.some((b) => b.status === 'approved');
        const hasPending = overlapping.some((b) => b.status === 'pending');
        if (hasApproved) {
          cell = 'approved';
        } else if (hasPending) {
          cell = 'pending';
        } else {
          cell = 'free';
        }
      }
      days.push({ date: dateStr, cell, available: cell === 'free' });
    }

    return res.json({ year, month, spaceId, days });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/reservations', async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const body = (req.body || {}) as {
      condoId?: unknown;
      unitId?: unknown;
      date?: unknown;
      requesterName?: unknown;
    };

    const condoId = parseCondoId(body.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const trimmedDate =
      typeof body.date === 'string' ? body.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      return res.status(400).json({ message: 'date invalido (YYYY-MM-DD).' });
    }

    const unitId = Number(body.unitId);
    if (!Number.isFinite(unitId) || unitId <= 0) {
      return res.status(400).json({ message: 'unitId invalido.' });
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

    const unitCheck = await query(
      `select id from units where id = $1 and condo_id = $2`,
      [unitId, condoId],
    );
    if (unitCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Unidade invalida.' });
    }

    const requesterName =
      typeof body.requesterName === 'string'
        ? body.requesterName.trim().slice(0, 150) || null
        : null;

    const parts = trimmedDate.split('-').map(Number);
    const y = parts[0];
    const mo = parts[1];
    const da = parts[2];
    if (y === undefined || mo === undefined || da === undefined) {
      return res.status(400).json({ message: 'date invalido.' });
    }

    const startIso = new Date(Date.UTC(y, mo - 1, da, 0, 0, 0)).toISOString();
    const endIso = new Date(Date.UTC(y, mo - 1, da + 1, 0, 0, 0)).toISOString();

    const conflict = await query(
      `select 1 from space_reservations
       where condo_id = $1
         and space_name = $2
         and status in ('pending', 'approved')
         and starts_at < $4::timestamptz
         and ends_at > $3::timestamptz
       limit 1`,
      [condoId, spaceName, startIso, endIso],
    );
    if (conflict.rows.length > 0) {
      return res.status(409).json({ message: 'Data indisponivel.' });
    }

    const insert = await query(
      `insert into space_reservations (
         condo_id,
         unit_id,
         space_name,
         starts_at,
         ends_at,
         status,
         requester_name
       )
       values ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'pending', $6)
       returning id, starts_at, ends_at, status`,
      [condoId, unitId, spaceName, startIso, endIso, requesterName],
    );

    return res.status(201).json(insert.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const {
      condoId: rawCondoId,
      name,
      description,
      iconKey,
      capacity,
      requiresApproval,
      photoUrls,
      photo_urls,
    } = (req.body || {}) as {
      condoId?: number;
      name?: string;
      description?: string;
      iconKey?: string;
      capacity?: number | null;
      requiresApproval?: boolean;
      photoUrls?: unknown;
      photo_urls?: unknown;
    };

    const condoId = parseCondoId(rawCondoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const trimmedName = name?.trim();
    const trimmedDescription = description?.trim();
    if (!trimmedName || !trimmedDescription) {
      return res.status(400).json({
        message: 'name e description sao obrigatorios.',
      });
    }

    const parsedPhotos = parseSpacePhotoUrls(photoUrls ?? photo_urls);

    const result = await query(
      `update reservation_spaces
       set name = $3,
           description = $4,
           icon_key = coalesce($5, icon_key),
           capacity = $6,
           requires_approval = coalesce($7, requires_approval),
           photo_urls = $8::jsonb
       where id = $1
         and condo_id = $2
         and active = true
       returning id, condo_id, name, description, icon_key, capacity,
                 requires_approval, active, photo_urls, created_at`,
      [
        spaceId,
        condoId,
        trimmedName,
        trimmedDescription,
        iconKey ?? null,
        capacity ?? null,
        requiresApproval === undefined ? null : Boolean(requiresApproval),
        JSON.stringify(parsedPhotos),
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Espaco nao encontrado.' });
    }

    const row = result.rows[0] as Record<string, unknown>;
    return res.json({
      ...row,
      photo_urls: photoUrlsFromRow(row.photo_urls),
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const spaceId = Number(req.params.id);
    if (!Number.isFinite(spaceId) || spaceId <= 0) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const condoId = parseCondoId(
      req.query.condoId ?? (req.body as { condoId?: unknown })?.condoId,
    );
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const result = await query(
      `update reservation_spaces
       set active = false
       where id = $1 and condo_id = $2 and active = true
       returning id, name`,
      [spaceId, condoId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Espaco nao encontrado.' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

export default router;

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import multer from 'multer';
import { Router } from 'express';

import { isBillingStaff } from '../authz';
import { query } from '../db';
import { loadLegacyUserRow } from '../userContext';

const router = Router();

const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

const lostFoundPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const condoId = parseCondoIdQuery(req.query.condoId);
      const dir = path.join(UPLOADS_ROOT, 'lost-found', `condo-${condoId}`);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extOk = /\.(jpe?g|png|gif|webp)$/i.test(file.originalname);
    const mimeOk = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    cb(null, mimeOk || extOk);
  },
});

const KINDS = ['lost', 'found'] as const;
type Kind = (typeof KINDS)[number];

const STATUSES = ['open', 'resolved'] as const;
type Status = (typeof STATUSES)[number];

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

function parseKind(raw: unknown): Kind | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (KINDS.includes(s as Kind)) {
    return s as Kind;
  }
  return null;
}

function parseStatus(raw: unknown): Status | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (STATUSES.includes(s as Status)) {
    return s as Status;
  }
  return null;
}

function parsePhotoUrls(raw: unknown, fallback?: string | null): string[] {
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
    if (text !== '' && !out.includes(text)) {
      out.push(text);
    }
    if (out.length >= 4) {
      break;
    }
  }
  return out;
}

type AppUserRow = {
  id: number;
  condo_id: number;
  unit_id: number | null;
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

/** Parceiros não acessam achados e perdidos. */
function canAccessLostFound(user: AppUserRow, condoId: number): boolean {
  return (
    user.active === true &&
    user.condo_id === condoId &&
    user.role !== 'partner'
  );
}

async function assertUnitInCondo(unitId: number, condoId: number): Promise<boolean> {
  const r = await query(
    `select id from units where id = $1 and condo_id = $2`,
    [unitId, condoId],
  );
  return r.rows.length > 0;
}

/** Morador com unidade no cadastro só registra para a própria unidade. */
function assertUnitMatchesResident(
  user: AppUserRow,
  unitId: number,
): boolean {
  if (user.role !== 'resident') {
    return true;
  }
  if (user.unit_id == null) {
    return true;
  }
  return user.unit_id === unitId;
}

/** Exclusão: criador ou síndico/administração (podem remover post de terceiros). Colaborador só remove o próprio. */
function mayDeleteRow(
  user: AppUserRow,
  row: { condo_id: number; created_by_user_id: number },
): boolean {
  if (user.active !== true || user.condo_id !== row.condo_id) {
    return false;
  }
  if (user.id === row.created_by_user_id) {
    return true;
  }
  return isBillingStaff(user.role);
}

function contentFieldsInPatch(body: Record<string, unknown>): boolean {
  return (
    body.unitId !== undefined ||
    body.unit_id !== undefined ||
    body.title !== undefined ||
    body.description !== undefined ||
    body.contactHint !== undefined ||
    body.contact_hint !== undefined ||
    body.photoUrl !== undefined ||
    body.photo_url !== undefined ||
    body.photoUrls !== undefined ||
    body.photo_urls !== undefined ||
    body.kind !== undefined
  );
}

/** PATCH: alterar dados só o criador; marcar como encontrado (status) também só o criador. */
function mayApplyPatch(
  user: AppUserRow,
  row: { condo_id: number; created_by_user_id: number },
  body: Record<string, unknown>,
): boolean {
  if (user.active !== true || user.condo_id !== row.condo_id) {
    return false;
  }
  const hasContent = contentFieldsInPatch(body);
  const hasStatus =
    body.status !== undefined && String(body.status ?? '').trim() !== '';
  if (hasContent) {
    return user.id === row.created_by_user_id;
  }
  if (hasStatus) {
    return user.id === row.created_by_user_id;
  }
  return false;
}

const ACHEI_MESSAGE_MAX = 600;

/** Subconsulta JSON para lista/detalhe (alias externo do item = `lf`). */
function acheiTipsSubquerySql(): string {
  return `(
    select coalesce(
      json_agg(
        json_build_object(
          'id', t.id,
          'message', t.message,
          'created_at', t.created_at,
          'user_id', t.user_id,
          'author_name', au.full_name
        )
        order by t.created_at asc
      ),
      '[]'::json
    )
    from condo_lost_found_achei t
    join app_users au on au.id = t.user_id
    where t.lost_found_id = lf.id
  )`;
}

router.post(
  '/upload-photo',
  lostFoundPhotoUpload.single('photo'),
  async (req, res, next) => {
    try {
      const file = req.file;
      const condoId = parseCondoIdQuery(req.query.condoId);
      const userId = parsePositive(req.query.userId);

      if (userId == null) {
        if (file) {
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* empty */
          }
        }
        return res.status(400).json({ message: 'userId e obrigatorio (query).' });
      }

      const user = await loadUser(userId, condoId);
      if (user == null || user.active !== true) {
        if (file) {
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* empty */
          }
        }
        return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
      }
      if (!canAccessLostFound(user, condoId)) {
        if (file) {
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* empty */
          }
        }
        return res.status(403).json({
          message: 'Parceiros nao utilizam achados e perdidos.',
        });
      }

      if (!file) {
        return res.status(400).json({
          message: 'Envie o arquivo no campo photo (multipart/form-data).',
        });
      }

      const relPath = path
        .relative(UPLOADS_ROOT, file.path)
        .split(path.sep)
        .join('/');
      const photoUrl = `/uploads/${relPath}`;
      return res.status(201).json({ photoUrl });
    } catch (err) {
      return next(err);
    }
  },
);

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
    if (!canAccessLostFound(user, condoId)) {
      return res.status(403).json({
        message: 'Parceiros nao utilizam achados e perdidos.',
      });
    }

    const kindFilter =
      req.query.kind !== undefined && String(req.query.kind).trim() !== ''
        ? parseKind(req.query.kind)
        : null;
    if (
      kindFilter === null &&
      req.query.kind !== undefined &&
      String(req.query.kind).trim() !== ''
    ) {
      return res.status(400).json({ message: 'kind deve ser lost (perda) ou found (achado).' });
    }

    const statusFilter =
      req.query.status !== undefined && String(req.query.status).trim() !== ''
        ? parseStatus(req.query.status)
        : null;
    if (
      statusFilter === null &&
      req.query.status !== undefined &&
      String(req.query.status).trim() !== ''
    ) {
      return res.status(400).json({
        message: 'status deve ser open ou resolved.',
      });
    }

    const onlyOpen = req.query.onlyOpen !== 'false';
    const history = req.query.history === 'true';

    if (history && statusFilter != null) {
      return res.status(400).json({
        message: 'Nao use status na query com history=true.',
      });
    }

    let sql = `select lf.id,
                      lf.condo_id,
                      lf.unit_id,
                      lf.kind,
                      lf.title,
                      lf.description,
                      lf.contact_hint,
                      lf.photo_url,
                      lf.photo_urls,
                      lf.status,
                      lf.created_by_user_id,
                      lf.created_at,
                      lf.updated_at,
                      u.full_name as created_by_name,
                      u.role as created_by_role,
                      un.tower as unit_tower,
                      un.number as unit_number,
                      ${acheiTipsSubquerySql()} as achei_tips
               from condo_lost_found lf
               join app_users u on u.id = lf.created_by_user_id
               left join units un on un.id = lf.unit_id
               where lf.condo_id = $1`;
    const params: unknown[] = [condoId];
    let p = 2;

    if (history) {
      if (kindFilter != null && kindFilter !== 'lost') {
        return res.status(400).json({
          message: 'history so lista itens perdidos já resolvidos (kind=lost).',
        });
      }
      sql += ` and lf.kind = 'lost'`;
      sql += ` and lf.status = 'resolved'`;
      if (!isBillingStaff(user.role)) {
        sql += ` and lf.created_by_user_id = $${p}`;
        params.push(user.id);
        p += 1;
      }
      sql += ` order by coalesce(lf.updated_at, lf.created_at) desc, lf.id desc`;
    } else {
      if (kindFilter != null) {
        sql += ` and lf.kind = $${p}`;
        params.push(kindFilter);
        p += 1;
      }
      if (statusFilter != null) {
        sql += ` and lf.status = $${p}`;
        params.push(statusFilter);
        p += 1;
      } else if (onlyOpen) {
        sql += ` and lf.status = 'open'`;
      }
      sql += ` order by lf.created_at desc`;
    }

    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

/** Contagens para itens kind=lost: total, em aberto (não encontrados), resolvidos (encontrados). */
router.get('/stats', async (req, res, next) => {
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
    if (!canAccessLostFound(user, condoId)) {
      return res.status(403).json({
        message: 'Parceiros nao utilizam achados e perdidos.',
      });
    }

    const r = await query(
      `select count(*) filter (where kind = 'lost')::int as total_lost,
              count(*) filter (where kind = 'lost' and status = 'open')::int as open_lost,
              count(*) filter (where kind = 'lost' and status = 'resolved')::int as resolved_lost
       from condo_lost_found
       where condo_id = $1`,
      [condoId],
    );
    const row = r.rows[0] as {
      total_lost: number;
      open_lost: number;
      resolved_lost: number;
    };
    return res.json({
      totalLost: row.total_lost,
      openLost: row.open_lost,
      resolvedLost: row.resolved_lost,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/achei', async (req, res, next) => {
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
    const message = String(body.message ?? '').trim();

    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (!message) {
      return res.status(400).json({ message: 'Escreva uma mensagem.' });
    }
    if (message.length > ACHEI_MESSAGE_MAX) {
      return res.status(400).json({
        message: `Mensagem muito longa (max ${ACHEI_MESSAGE_MAX} caracteres).`,
      });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canAccessLostFound(user, condoId)) {
      return res.status(403).json({
        message: 'Parceiros nao utilizam achados e perdidos.',
      });
    }

    const existing = await query(
      `select id, condo_id, status from condo_lost_found where id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Registro nao encontrado.' });
    }
    const lfRow = existing.rows[0] as {
      condo_id: number;
      status: string;
    };
    if (lfRow.condo_id !== condoId) {
      return res.status(403).json({ message: 'Registro de outro condominio.' });
    }
    if (lfRow.status !== 'open') {
      return res.status(400).json({
        message: 'So e possivel avisar em itens ainda em aberto.',
      });
    }

    const ins = await query(
      `insert into condo_lost_found_achei (lost_found_id, user_id, message)
       values ($1, $2, $3)
       returning id, lost_found_id, user_id, message, created_at`,
      [id, userId, message],
    );
    const row = ins.rows[0] as {
      id: number;
      lost_found_id: number;
      user_id: number;
      message: string;
      created_at: Date;
    };
    const nm = await query(`select full_name from app_users where id = $1`, [
      userId,
    ]);
    const authorName =
      (nm.rows[0] as { full_name: string } | undefined)?.full_name ?? '';

    return res.status(201).json({
      id: row.id,
      lost_found_id: row.lost_found_id,
      user_id: row.user_id,
      message: row.message,
      created_at: row.created_at,
      author_name: authorName,
    });
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
    if (!canAccessLostFound(user, condoId)) {
      return res.status(403).json({
        message: 'Parceiros nao utilizam achados e perdidos.',
      });
    }

    const r = await query(
      `select lf.id,
              lf.condo_id,
              lf.unit_id,
              lf.kind,
              lf.title,
              lf.description,
              lf.contact_hint,
              lf.photo_url,
              lf.photo_urls,
              lf.status,
              lf.created_by_user_id,
              lf.created_at,
              lf.updated_at,
              u.full_name as created_by_name,
              u.role as created_by_role,
              un.tower as unit_tower,
              un.number as unit_number,
              ${acheiTipsSubquerySql()} as achei_tips
       from condo_lost_found lf
       join app_users u on u.id = lf.created_by_user_id
       left join units un on un.id = lf.unit_id
       where lf.id = $1 and lf.condo_id = $2`,
      [id, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Registro nao encontrado.' });
    }
    return res.json(r.rows[0]);
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
    const unitId = parsePositive(body.unitId ?? body.unit_id);
    const kind = parseKind(body.kind) ?? 'lost';
    const title = String(body.title ?? '').trim();
    const description = String(body.description ?? '').trim() || null;
    const contactHint = String(body.contactHint ?? body.contact_hint ?? '').trim() || null;
    const photoUrl =
      String(body.photoUrl ?? body.photo_url ?? '').trim() || null;
    const photoUrls = parsePhotoUrls(body.photoUrls ?? body.photo_urls, photoUrl);

    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (unitId == null) {
      return res.status(400).json({ message: 'unitId e obrigatorio.' });
    }
    if (!title) {
      return res.status(400).json({ message: 'title (descricao do item) e obrigatorio.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || !canAccessLostFound(user, condoId)) {
      return res.status(403).json({
        message:
          user?.role === 'partner'
            ? 'Parceiros nao cadastram em achados e perdidos.'
            : 'Usuario nao autorizado a cadastrar neste condominio.',
      });
    }

    if (!(await assertUnitInCondo(unitId, condoId))) {
      return res.status(400).json({ message: 'Unidade invalida para este condominio.' });
    }
    if (!assertUnitMatchesResident(user, unitId)) {
      return res.status(403).json({
        message: 'Moradores so registram itens para a propria unidade.',
      });
    }

    const ins = await query(
      `insert into condo_lost_found (
         condo_id, unit_id, kind, title, description, contact_hint, photo_url, photo_urls, created_by_user_id
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       returning id,
                 condo_id,
                 unit_id,
                 kind,
                 title,
                 description,
                 contact_hint,
                 photo_url,
                 photo_urls,
                 status,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [
        condoId,
        unitId,
        kind,
        title,
        description,
        contactHint,
        photoUrls[0] ?? photoUrl,
        JSON.stringify(photoUrls),
        userId,
      ],
    );

    const row = ins.rows[0] as Record<string, unknown>;
    const meta = await query(
      `select tower, number from units where id = $1`,
      [unitId],
    );
    const um = meta.rows[0] as { tower: string; number: string } | undefined;
    return res.status(201).json({
      ...row,
      unit_tower: um?.tower ?? null,
      unit_number: um?.number ?? null,
    });
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
    if (!canAccessLostFound(user, condoId)) {
      return res.status(403).json({
        message: 'Parceiros nao utilizam achados e perdidos.',
      });
    }

    const existing = await query(
      `select id, condo_id, unit_id, created_by_user_id, kind, title, description, contact_hint, photo_url, photo_urls, status
       from condo_lost_found
       where id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Registro nao encontrado.' });
    }
    const row = existing.rows[0] as {
      condo_id: number;
      unit_id: number | null;
      created_by_user_id: number;
      kind: string;
      title: string;
      description: string | null;
      contact_hint: string | null;
      photo_url: string | null;
      photo_urls: unknown;
      status: string;
    };

    if (row.condo_id !== condoId) {
      return res.status(403).json({ message: 'Registro de outro condominio.' });
    }
    if (!mayApplyPatch(user, row, body)) {
      return res.status(403).json({ message: 'Sem permissao para alterar.' });
    }

    let nextUnitId = row.unit_id;
    let nextTitle = row.title;
    let nextDesc = row.description;
    let nextHint = row.contact_hint;
    let nextPhoto = row.photo_url;
    let nextPhotos = parsePhotoUrls(row.photo_urls, row.photo_url);
    let nextKind = row.kind as Kind;
    let nextStatus = row.status as Status;
    let changed = false;

    const unitRaw = body.unitId ?? body.unit_id;
    if (unitRaw !== undefined) {
      const uid = parsePositive(unitRaw);
      if (uid == null) {
        return res.status(400).json({ message: 'unitId invalido.' });
      }
      if (!(await assertUnitInCondo(uid, condoId))) {
        return res.status(400).json({ message: 'Unidade invalida para este condominio.' });
      }
      if (!assertUnitMatchesResident(user, uid)) {
        return res.status(403).json({
          message: 'Moradores so associam a propria unidade.',
        });
      }
      nextUnitId = uid;
      changed = true;
    }
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
    if (body.contactHint !== undefined || body.contact_hint !== undefined) {
      const h = String(body.contactHint ?? body.contact_hint ?? '').trim() || null;
      nextHint = h;
      changed = true;
    }
    if (body.photoUrl !== undefined || body.photo_url !== undefined) {
      nextPhoto =
        String(body.photoUrl ?? body.photo_url ?? '').trim() || null;
      nextPhotos = parsePhotoUrls(body.photoUrls ?? body.photo_urls, nextPhoto);
      changed = true;
    } else if (body.photoUrls !== undefined || body.photo_urls !== undefined) {
      nextPhotos = parsePhotoUrls(body.photoUrls ?? body.photo_urls, nextPhoto);
      nextPhoto = nextPhotos[0] ?? null;
      changed = true;
    }
    if (body.kind !== undefined && String(body.kind).trim() !== '') {
      const k = parseKind(body.kind);
      if (k == null) {
        return res.status(400).json({ message: 'kind invalido.' });
      }
      nextKind = k;
      changed = true;
    }
    if (body.status !== undefined && String(body.status).trim() !== '') {
      const s = parseStatus(body.status);
      if (s == null) {
        return res.status(400).json({ message: 'status invalido.' });
      }
      nextStatus = s;
      changed = true;
    }

    if (!changed) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    const r = await query(
      `update condo_lost_found
       set unit_id = $2,
           title = $3,
           description = $4,
           contact_hint = $5,
           photo_url = $6,
           photo_urls = $7::jsonb,
           kind = $8,
           status = $9,
           updated_at = now()
       where id = $1
       returning id,
                 condo_id,
                 unit_id,
                 kind,
                 title,
                 description,
                 contact_hint,
                 photo_url,
                 photo_urls,
                 status,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [
        id,
        nextUnitId,
        nextTitle,
        nextDesc,
        nextHint,
        nextPhoto,
        JSON.stringify(nextPhotos),
        nextKind,
        nextStatus,
      ],
    );

    const out = r.rows[0] as Record<string, unknown>;
    const meta = await query(
      `select tower, number from units where id = $1`,
      [nextUnitId],
    );
    const um = meta.rows[0] as { tower: string; number: string } | undefined;
    return res.json({
      ...out,
      unit_tower: um?.tower ?? null,
      unit_number: um?.number ?? null,
    });
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
    if (!canAccessLostFound(user, condoId)) {
      return res.status(403).json({
        message: 'Parceiros nao utilizam achados e perdidos.',
      });
    }

    const existing = await query(
      `select condo_id, created_by_user_id from condo_lost_found where id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Registro nao encontrado.' });
    }
    const row = existing.rows[0] as { condo_id: number; created_by_user_id: number };
    if (row.condo_id !== condoId) {
      return res.status(403).json({ message: 'Registro de outro condominio.' });
    }
    if (!mayDeleteRow(user, row)) {
      return res.status(403).json({ message: 'Sem permissao para excluir.' });
    }

    await query(`delete from condo_lost_found where id = $1`, [id]);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;

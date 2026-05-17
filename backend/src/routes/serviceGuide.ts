import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import multer from 'multer';
import { Router } from 'express';

import { isOperationalStaff } from '../authz';
import { query } from '../db';

const router = Router();

const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

/** node-pg por vezes devolve json_agg como string; o app precisa sempre de um array. */
function parsePortfolioPhotosRaw(raw: unknown): unknown[] {
  if (raw == null) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeCatalogRow(row: Record<string, unknown>): Record<string, unknown> {
  const pp = parsePortfolioPhotosRaw(row.portfolio_photos);
  return { ...row, portfolio_photos: pp };
}

const PORTFOLIO_MAX_PHOTOS = 12;

const serviceGuidePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const condoId = parseCondoIdQuery(req.query.condoId);
      const fromParams = parsePositive(req.params.serviceId);
      const fromPath =
        fromParams ??
        (() => {
          const m = /\/catalog\/(\d+)\/upload-photo/i.exec(req.path ?? '');
          return m ? parsePositive(m[1]) : null;
        })();
      const sid = fromPath;
      const dir = path.join(
        UPLOADS_ROOT,
        'service-guide',
        `condo-${condoId}`,
        `service-${sid ?? 0}`,
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
    const mime = String(file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const imageExts = new Set([
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.webp',
      '.heic',
      '.heif',
      '.bmp',
    ]);
    const mimeOk = /^image\/(jpeg|jpg|jpe|png|gif|webp|heic|heif|bmp)$/i.test(
      mime,
    );
    const octetOk =
      mime === 'application/octet-stream' && imageExts.has(ext);
    cb(null, mimeOk || octetOk);
  },
});

const REQUEST_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
] as const;
type RequestStatus = (typeof REQUEST_STATUSES)[number];

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

function parseRequestStatus(raw: unknown): RequestStatus | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (REQUEST_STATUSES.includes(s as RequestStatus)) {
    return s as RequestStatus;
  }
  return null;
}

function parseDateOnly(raw: unknown): string | null {
  if (raw == null || String(raw).trim() === '') {
    return null;
  }
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return null;
  }
  const d = new Date(`${s}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return s;
}

type AppUserRow = {
  id: number;
  condo_id: number;
  unit_id: number | null;
  role: string;
  active: boolean;
};

async function loadUser(userId: number): Promise<AppUserRow | null> {
  const r = await query(
    `select id, condo_id, unit_id, role, active from app_users where id = $1 limit 1`,
    [userId],
  );
  if (r.rows.length === 0) {
    return null;
  }
  return r.rows[0] as AppUserRow;
}

function canAccessCondo(user: AppUserRow, condoId: number): boolean {
  return user.active === true && user.condo_id === condoId;
}

function isStaff(user: AppUserRow): boolean {
  return isOperationalStaff(user.role);
}

/** Catálogo da guia: síndico, administração e parceiros (não colaborador). */
function canManageCatalog(user: AppUserRow, condoId: number): boolean {
  if (!canAccessCondo(user, condoId)) {
    return false;
  }
  return (
    user.role === 'syndic' ||
    user.role === 'administrator' ||
    user.role === 'partner'
  );
}

async function condoExistsRow(id: number): Promise<boolean> {
  const r = await query(`select 1 from condos where id = $1 limit 1`, [id]);
  return r.rows.length > 0;
}

/**
 * Parceiro pode alterar o próprio cadastro na guia de outro condomínio (anúncio multiedifício).
 * Síndico/admin: apenas o condomínio do utilizador.
 */
async function canMutateServiceCatalog(
  user: AppUserRow,
  catalogCondoId: number,
  createdByUserId: number,
): Promise<boolean> {
  if (user.role === 'syndic' || user.role === 'administrator') {
    return canAccessCondo(user, catalogCondoId);
  }
  if (user.role === 'partner') {
    if (canAccessCondo(user, catalogCondoId)) {
      return true;
    }
    if (createdByUserId === user.id && (await condoExistsRow(catalogCondoId))) {
      return true;
    }
  }
  return false;
}

/** Leitura da guia: parceiro pode consultar qualquer condomínio existente (escolha no portal). */
async function canAccessServiceGuideCondo(
  user: AppUserRow,
  condoId: number,
): Promise<boolean> {
  if (canAccessCondo(user, condoId)) {
    return true;
  }
  if (user.role === 'partner' && (await condoExistsRow(condoId))) {
    return true;
  }
  return false;
}

function parseCondoIdsBody(body: Record<string, unknown>): number[] | null {
  const raw = body.condoIds ?? body.condo_ids;
  if (raw == null) {
    return null;
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  const out: number[] = [];
  for (const x of raw) {
    const n = Number(x);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) {
      out.push(n);
    }
  }
  return out.length > 0 ? out : null;
}

/** Solicitações de serviço (morador): equipe operacional continua gerenciando. */
function canManageServiceRequests(user: AppUserRow, condoId: number): boolean {
  return canAccessCondo(user, condoId) && isStaff(user);
}

function parseCatalogScope(raw: unknown): 'unit' | 'condo' | null {
  const s = String(raw ?? 'unit').trim().toLowerCase();
  if (s === 'unit' || s === 'condo') {
    return s;
  }
  return null;
}

function parseVisible(raw: unknown, defaultVal: boolean): boolean {
  if (raw === undefined || raw === null) {
    return defaultVal;
  }
  if (typeof raw === 'boolean') {
    return raw;
  }
  const t = String(raw).trim().toLowerCase();
  if (t === 'true') {
    return true;
  }
  if (t === 'false') {
    return false;
  }
  return defaultVal;
}

function canSubmitServiceRequest(user: AppUserRow, condoId: number): boolean {
  return (
    canAccessCondo(user, condoId) &&
    user.role === 'resident' &&
    user.unit_id != null
  );
}

function portfolioPhotosJsonSubquery(tableAlias: string): string {
  return `(select coalesce(
      json_agg(
        json_build_object(
          'id', ph.id,
          'photo_url', ph.photo_url,
          'sort_order', ph.sort_order
        )
        order by ph.sort_order asc, ph.id asc
      ),
      '[]'::json
    )
    from condo_service_catalog_photos ph
    where ph.service_id = ${tableAlias}.id)`;
}

function unlinkUploadMaybe(photoUrl: string): void {
  const trimmed = String(photoUrl ?? '').trim();
  if (!trimmed.startsWith('/uploads/')) {
    return;
  }
  const rel = trimmed.replace(/^\/uploads\/?/, '');
  const abs = path.join(UPLOADS_ROOT, rel);
  try {
    fs.unlinkSync(abs);
  } catch {
    /* empty */
  }
}

router.get('/catalog', async (req, res, next) => {
  try {
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    const includeInactive = req.query.includeInactive === 'true';

    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!(await canAccessServiceGuideCondo(user, condoId))) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    if (includeInactive && !canManageCatalog(user, condoId)) {
      return res.status(403).json({
        message:
          'Somente quem cadastra na guia (sindico, administracao ou parceiro) pode listar servicos inativos.',
      });
    }

    const manager = canManageCatalog(user, condoId);

    let sql = `select svc.id,
                      svc.condo_id,
                      svc.title,
                      svc.description,
                      svc.category,
                      svc.provider_name,
                      svc.provider_phone,
                      svc.provider_email,
                      svc.provider_whatsapp,
                      svc.sort_order,
                      svc.active,
                      svc.scope,
                      svc.visible,
                      svc.created_at,
                      svc.updated_at,
                      ${portfolioPhotosJsonSubquery('svc')} as portfolio_photos
               from condo_service_catalog svc
               where svc.condo_id = $1`;
    const params: unknown[] = [condoId];

    if (!includeInactive) {
      sql += ` and svc.active = true`;
    }

    if (!manager) {
      if (user.role === 'partner') {
        sql += ` and (svc.visible = true or svc.created_by_user_id = $2)`;
        params.push(user.id);
      } else {
        sql += ` and svc.visible = true`;
      }
    }

    sql += ` order by svc.sort_order asc, svc.title asc`;

    const r = await query(sql, params);
    return res.json(
      r.rows.map((row) => normalizeCatalogRow(row as Record<string, unknown>)),
    );
  } catch (err) {
    return next(err);
  }
});

router.get('/overview', async (req, res, next) => {
  try {
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);

    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!(await canAccessServiceGuideCondo(user, condoId))) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    const manager = canManageCatalog(user, condoId);
    const visClause = manager ? '' : ' and visible = true';

    const r = await query(
      `select count(*) filter (where scope = 'unit')::int as unit_count,
              count(*) filter (where scope = 'condo')::int as condo_count,
              count(*) filter (
                where category is not null and trim(category) <> ''
              )::int as rows_with_category,
              count(distinct category) filter (
                where category is not null and trim(category) <> ''
              )::int as category_distinct,
              count(*)::int as total_listed
       from condo_service_catalog
       where condo_id = $1 and active = true${visClause}`,
      [condoId],
    );

    const row = r.rows[0] as {
      unit_count: number;
      condo_count: number;
      rows_with_category: number;
      category_distinct: number;
      total_listed: number;
    };

    let hiddenFromResidents: number | undefined;
    if (manager) {
      const h = await query(
        `select count(*)::int as c
         from condo_service_catalog
         where condo_id = $1 and active = true and visible = false`,
        [condoId],
      );
      hiddenFromResidents = (h.rows[0] as { c: number }).c;
    }

    const categoryCount =
      row.category_distinct > 0
        ? row.category_distinct
        : row.rows_with_category > 0
          ? row.rows_with_category
          : 0;

    return res.json({
      totalListed: row.total_listed,
      unitServices: row.unit_count,
      condoServices: row.condo_count,
      categoryCount,
      hiddenFromResidents:
        hiddenFromResidents !== undefined && hiddenFromResidents > 0
          ? hiddenFromResidents
          : undefined,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/catalog/:id', async (req, res, next) => {
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

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!(await canAccessServiceGuideCondo(user, condoId))) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    const r = await query(
      `select id,
              condo_id,
              title,
              description,
              category,
              provider_name,
              provider_phone,
              provider_email,
              provider_whatsapp,
              sort_order,
              active,
              scope,
              visible,
              created_by_user_id,
              created_at,
              updated_at,
              ${portfolioPhotosJsonSubquery('condo_service_catalog')} as portfolio_photos
       from condo_service_catalog
       where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Servico nao encontrado.' });
    }
    const row = r.rows[0] as {
      active: boolean;
      visible: boolean;
      created_by_user_id: number;
    };
    if (!canManageCatalog(user, condoId)) {
      const partnerOwn =
        user.role === 'partner' && row.created_by_user_id === user.id;
      if (!partnerOwn && (!row.active || !row.visible)) {
        return res.status(404).json({ message: 'Servico nao encontrado.' });
      }
    }
    return res.json(
      normalizeCatalogRow(r.rows[0] as Record<string, unknown>),
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/catalog', async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
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
    const category = String(body.category ?? '').trim() || null;
    const providerName =
      String(body.providerName ?? body.provider_name ?? '').trim() || null;
    const providerPhone =
      String(body.providerPhone ?? body.provider_phone ?? '').trim() || null;
    const providerEmail =
      String(body.providerEmail ?? body.provider_email ?? '').trim() || null;
    const providerWhatsapp =
      String(body.providerWhatsapp ?? body.provider_whatsapp ?? '').trim() ||
      null;
    const sortOrderRaw = body.sortOrder ?? body.sort_order;
    const sortOrder =
      sortOrderRaw !== undefined &&
      sortOrderRaw !== null &&
      String(sortOrderRaw).trim() !== ''
        ? Number(sortOrderRaw)
        : 0;

    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (!title) {
      return res.status(400).json({ message: 'title e obrigatorio.' });
    }
    if (!Number.isFinite(sortOrder)) {
      return res.status(400).json({ message: 'sortOrder invalido.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }

    const partnerTargets = parseCondoIdsBody(body);
    if (partnerTargets != null && user.role !== 'partner') {
      return res.status(400).json({
        message: 'condoIds so e permitido ao cadastrar como parceiro.',
      });
    }

    let targetCondoIds: number[];
    if (partnerTargets != null) {
      targetCondoIds = partnerTargets;
      for (const cid of targetCondoIds) {
        if (!(await condoExistsRow(cid))) {
          return res.status(400).json({ message: `condominio ${cid} invalido.` });
        }
      }
    } else {
      if (!Number.isFinite(condoId) || condoId < 1) {
        return res.status(400).json({ message: 'condoId invalido.' });
      }
      if (!canManageCatalog(user, condoId)) {
        return res.status(403).json({
          message:
            'Apenas sindico, administracao ou parceiros podem cadastrar servicos na guia.',
        });
      }
      targetCondoIds = [condoId];
    }

    const scope = parseCatalogScope(body.scope);
    if (scope == null) {
      return res.status(400).json({
        message: 'scope deve ser unit (unidades) ou condo (condominio).',
      });
    }
    const visible = parseVisible(body.visible ?? body.visivel, true);

    const insertSql = `insert into condo_service_catalog (
         condo_id, title, description, category,
         provider_name, provider_phone, provider_email, provider_whatsapp,
         sort_order, scope, visible, created_by_user_id
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id,
                 condo_id,
                 title,
                 description,
                 category,
                 provider_name,
                 provider_phone,
                 provider_email,
                 provider_whatsapp,
                 sort_order,
                 active,
                 scope,
                 visible,
                 created_by_user_id,
                 created_at,
                 updated_at`;

    const baseParams = [
      title,
      description,
      category,
      providerName,
      providerPhone,
      providerEmail,
      providerWhatsapp,
      sortOrder,
      scope,
      visible,
      userId,
    ];

    const createdRows: Record<string, unknown>[] = [];
    for (const cid of targetCondoIds) {
      const ins = await query(insertSql, [cid, ...baseParams]);
      createdRows.push(
        normalizeCatalogRow(ins.rows[0] as Record<string, unknown>),
      );
    }

    if (createdRows.length === 1) {
      const rowOut = createdRows[0];
      return res.status(201).json({
        ...rowOut,
        portfolio_photos: [],
      });
    }
    return res.status(201).json({
      catalog: createdRows.map((row) => ({ ...row, portfolio_photos: [] })),
    });
  } catch (err) {
    return next(err);
  }
});

router.patch('/catalog/:id', async (req, res, next) => {
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

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }

    const ex = await query(
      `select id, created_by_user_id from condo_service_catalog where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (ex.rows.length === 0) {
      return res.status(404).json({ message: 'Servico nao encontrado.' });
    }
    const createdBy = (ex.rows[0] as { created_by_user_id: number })
      .created_by_user_id;
    if (!(await canMutateServiceCatalog(user, condoId, createdBy))) {
      return res.status(403).json({
        message:
          'Apenas sindico, administracao ou parceiros podem alterar o catalogo.',
      });
    }

    const cur = await query(
      `select title, description, category, provider_name, provider_phone, provider_email,
              provider_whatsapp,
              sort_order, active, scope, visible
       from condo_service_catalog where id = $1`,
      [id],
    );
    const row = cur.rows[0] as {
      title: string;
      description: string | null;
      category: string | null;
      provider_name: string | null;
      provider_phone: string | null;
      provider_email: string | null;
      provider_whatsapp: string | null;
      sort_order: number;
      active: boolean;
      scope: string;
      visible: boolean;
    };

    let nextTitle = row.title;
    let nextDesc = row.description;
    let nextCat = row.category;
    let nextPn = row.provider_name;
    let nextPp = row.provider_phone;
    let nextPe = row.provider_email;
    let nextPw = row.provider_whatsapp;
    let nextSort = row.sort_order;
    let nextActive = row.active;
    let nextScope =
      row.scope === 'condo' ? ('condo' as const) : ('unit' as const);
    let nextVisible = row.visible;
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
    if (body.category !== undefined) {
      nextCat = String(body.category ?? '').trim() || null;
      changed = true;
    }
    if (body.providerName !== undefined || body.provider_name !== undefined) {
      nextPn =
        String(body.providerName ?? body.provider_name ?? '').trim() || null;
      changed = true;
    }
    if (body.providerPhone !== undefined || body.provider_phone !== undefined) {
      nextPp =
        String(body.providerPhone ?? body.provider_phone ?? '').trim() || null;
      changed = true;
    }
    if (body.providerEmail !== undefined || body.provider_email !== undefined) {
      nextPe =
        String(body.providerEmail ?? body.provider_email ?? '').trim() || null;
      changed = true;
    }
    if (
      body.providerWhatsapp !== undefined ||
      body.provider_whatsapp !== undefined
    ) {
      nextPw =
        String(
          body.providerWhatsapp ?? body.provider_whatsapp ?? '',
        ).trim() || null;
      changed = true;
    }
    if (body.sortOrder !== undefined || body.sort_order !== undefined) {
      const s = Number(body.sortOrder ?? body.sort_order);
      if (!Number.isFinite(s)) {
        return res.status(400).json({ message: 'sortOrder invalido.' });
      }
      nextSort = s;
      changed = true;
    }
    if (body.active !== undefined) {
      const a = body.active;
      if (typeof a === 'boolean') {
        nextActive = a;
      } else if (a === 'true') {
        nextActive = true;
      } else if (a === 'false') {
        nextActive = false;
      } else {
        return res.status(400).json({ message: 'active invalido.' });
      }
      changed = true;
    }
    if (body.scope !== undefined) {
      const sc = parseCatalogScope(body.scope);
      if (sc == null) {
        return res.status(400).json({
          message: 'scope deve ser unit (unidades) ou condo (condominio).',
        });
      }
      nextScope = sc;
      changed = true;
    }
    if (body.visible !== undefined || body.visivel !== undefined) {
      nextVisible = parseVisible(body.visible ?? body.visivel, nextVisible);
      changed = true;
    }

    if (!changed) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    const r = await query(
      `update condo_service_catalog
       set title = $2,
           description = $3,
           category = $4,
           provider_name = $5,
           provider_phone = $6,
           provider_email = $7,
           provider_whatsapp = $8,
           sort_order = $9,
           active = $10,
           scope = $11,
           visible = $12,
           updated_at = now()
       where id = $1
       returning id,
                 condo_id,
                 title,
                 description,
                 category,
                 provider_name,
                 provider_phone,
                 provider_email,
                 provider_whatsapp,
                 sort_order,
                 active,
                 scope,
                 visible,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [
        id,
        nextTitle,
        nextDesc,
        nextCat,
        nextPn,
        nextPp,
        nextPe,
        nextPw,
        nextSort,
        nextActive,
        nextScope,
        nextVisible,
      ],
    );

    const updatedRow = r.rows[0] as Record<string, unknown>;
    const ph = await query(
      `select coalesce(
          json_agg(
            json_build_object(
              'id', ph2.id,
              'photo_url', ph2.photo_url,
              'sort_order', ph2.sort_order
            )
            order by ph2.sort_order asc, ph2.id asc
          ),
          '[]'::json
        ) as portfolio_photos
       from condo_service_catalog_photos ph2
       where ph2.service_id = $1`,
      [id],
    );
    const portfolioPhotos = (ph.rows[0] as { portfolio_photos: unknown })
      .portfolio_photos;
    return res.json(
      normalizeCatalogRow({
        ...updatedRow,
        portfolio_photos: portfolioPhotos,
      } as Record<string, unknown>),
    );
  } catch (err) {
    return next(err);
  }
});

router.post(
  '/catalog/:serviceId/upload-photo',
  serviceGuidePhotoUpload.single('photo'),
  async (req, res, next) => {
    try {
      const serviceId = parsePositive(req.params.serviceId);
      const condoId = parseCondoIdQuery(req.query.condoId);
      const userId = parsePositive(req.query.userId);
      const file = req.file;

      if (serviceId == null) {
        if (file) {
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* empty */
          }
        }
        return res.status(400).json({ message: 'serviceId invalido.' });
      }
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

      const user = await loadUser(userId);
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
      const svcMeta = await query(
        `select condo_id, created_by_user_id from condo_service_catalog where id = $1 limit 1`,
        [serviceId],
      );
      if (svcMeta.rows.length === 0) {
        if (file) {
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* empty */
          }
        }
        return res.status(404).json({ message: 'Servico nao encontrado.' });
      }
      const sm = svcMeta.rows[0] as {
        condo_id: number;
        created_by_user_id: number;
      };
      if (sm.condo_id !== condoId) {
        if (file) {
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* empty */
          }
        }
        return res.status(404).json({ message: 'Servico nao encontrado.' });
      }
      if (!(await canMutateServiceCatalog(user, condoId, sm.created_by_user_id))) {
        if (file) {
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* empty */
          }
        }
        return res.status(403).json({
          message: 'Sem permissao para anexar fotos ao servico.',
        });
      }

      if (!file) {
        return res.status(400).json({
          message: 'Envie o arquivo no campo photo (multipart/form-data).',
        });
      }

      const cnt = await query(
        `select count(*)::int as c from condo_service_catalog_photos where service_id = $1`,
        [serviceId],
      );
      const n = (cnt.rows[0] as { c: number }).c;
      if (n >= PORTFOLIO_MAX_PHOTOS) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* empty */
        }
        return res.status(400).json({
          message: `Limite de ${PORTFOLIO_MAX_PHOTOS} fotos por servico.`,
        });
      }

      const relPath = path
        .relative(UPLOADS_ROOT, file.path)
        .split(path.sep)
        .join('/');
      const photoUrl = `/uploads/${relPath}`;

      const ins = await query(
        `insert into condo_service_catalog_photos (service_id, photo_url, sort_order)
         values ($1, $2, $3)
         returning id, service_id, photo_url, sort_order, created_at`,
        [serviceId, photoUrl, n],
      );

      return res.status(201).json(ins.rows[0]);
    } catch (err) {
      return next(err);
    }
  },
);

router.delete(
  '/catalog/:serviceId/photos/:photoId',
  async (req, res, next) => {
    try {
      const serviceId = parsePositive(req.params.serviceId);
      const photoId = parsePositive(req.params.photoId);
      const condoId =
        req.query.condoId !== undefined && String(req.query.condoId).trim() !== ''
          ? Number(req.query.condoId)
          : NaN;
      const userId = parsePositive(req.query.userId);

      if (serviceId == null || photoId == null) {
        return res.status(400).json({ message: 'Parametros invalidos.' });
      }
      if (!Number.isFinite(condoId) || condoId < 1) {
        return res.status(400).json({ message: 'condoId invalido.' });
      }
      if (userId == null) {
        return res.status(400).json({ message: 'userId e obrigatorio.' });
      }

      const user = await loadUser(userId);
      if (user == null || user.active !== true) {
        return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
      }

      const picRow = await query(
        `select p.id, p.photo_url, s.created_by_user_id
         from condo_service_catalog_photos p
         join condo_service_catalog s on s.id = p.service_id
         where p.id = $1 and p.service_id = $2 and s.condo_id = $3`,
        [photoId, serviceId, condoId],
      );
      if (picRow.rows.length === 0) {
        return res.status(404).json({ message: 'Foto nao encontrada.' });
      }
      const pr = picRow.rows[0] as {
        photo_url: string;
        created_by_user_id: number;
      };
      if (!(await canMutateServiceCatalog(user, condoId, pr.created_by_user_id))) {
        return res.status(403).json({ message: 'Sem permissao.' });
      }
      const photoUrl = pr.photo_url;

      await query(`delete from condo_service_catalog_photos where id = $1`, [
        photoId,
      ]);
      unlinkUploadMaybe(photoUrl);
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  },
);

router.delete('/catalog/:id', async (req, res, next) => {
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

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }

    const ownerCheck = await query(
      `select id, created_by_user_id from condo_service_catalog where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Servico nao encontrado.' });
    }
    const oc = ownerCheck.rows[0] as { created_by_user_id: number };
    if (!(await canMutateServiceCatalog(user, condoId, oc.created_by_user_id))) {
      return res.status(403).json({
        message:
          'Apenas sindico, administracao ou parceiros podem excluir servicos.',
      });
    }

    try {
      const pics = await query(
        `select photo_url from condo_service_catalog_photos where service_id = $1`,
        [id],
      );
      const del = await query(
        `delete from condo_service_catalog where id = $1 and condo_id = $2 returning id`,
        [id, condoId],
      );
      if (del.rows.length === 0) {
        return res.status(404).json({ message: 'Servico nao encontrado.' });
      }
      for (const pr of pics.rows) {
        unlinkUploadMaybe((pr as { photo_url: string }).photo_url);
      }
      return res.status(204).send();
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === '23503') {
        return res.status(409).json({
          message:
            'Nao e possivel excluir: existem solicitacoes vinculadas. Desative o servico ou conclua/cancele as solicitacoes.',
        });
      }
      throw e;
    }
  } catch (err) {
    return next(err);
  }
});

// --- Solicitações (morador) ---

router.get('/requests', async (req, res, next) => {
  try {
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    const statusFilter =
      req.query.status !== undefined && String(req.query.status).trim() !== ''
        ? parseRequestStatus(req.query.status)
        : null;
    if (
      statusFilter === null &&
      req.query.status !== undefined &&
      String(req.query.status).trim() !== ''
    ) {
      return res.status(400).json({ message: 'status invalido.' });
    }

    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canAccessCondo(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    let sql = `select r.id,
                      r.condo_id,
                      r.service_id,
                      r.unit_id,
                      r.created_by_user_id,
                      r.message,
                      r.preferred_date,
                      r.status,
                      r.staff_notes,
                      r.created_at,
                      r.updated_at,
                      s.title as service_title,
                      u.tower as unit_tower,
                      u.number as unit_number
               from condo_service_requests r
               join condo_service_catalog s on s.id = r.service_id
               join units u on u.id = r.unit_id
               where r.condo_id = $1`;
    const params: unknown[] = [condoId];
    let p = 2;

    if (!isStaff(user)) {
      sql += ` and r.created_by_user_id = $${p}`;
      params.push(userId);
      p += 1;
    }

    if (statusFilter != null) {
      sql += ` and r.status = $${p}`;
      params.push(statusFilter);
      p += 1;
    }

    sql += ` order by r.created_at desc`;

    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.get('/requests/:id', async (req, res, next) => {
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

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canAccessCondo(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    const r = await query(
      `select r.id,
              r.condo_id,
              r.service_id,
              r.unit_id,
              r.created_by_user_id,
              r.message,
              r.preferred_date,
              r.status,
              r.staff_notes,
              r.created_at,
              r.updated_at,
              s.title as service_title,
              s.description as service_description,
              s.provider_name as service_provider_name,
              s.provider_phone as service_provider_phone,
              s.provider_email as service_provider_email,
              u.tower as unit_tower,
              u.number as unit_number
       from condo_service_requests r
       join condo_service_catalog s on s.id = r.service_id
       join units u on u.id = r.unit_id
       where r.id = $1 and r.condo_id = $2`,
      [id, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Solicitacao nao encontrada.' });
    }
    const row = r.rows[0] as { created_by_user_id: number };
    if (!isStaff(user) && row.created_by_user_id !== userId) {
      return res.status(403).json({ message: 'Sem permissao.' });
    }
    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.post('/requests', async (req, res, next) => {
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
    const serviceId = parsePositive(body.serviceId ?? body.service_id);
    const unitId = parsePositive(body.unitId ?? body.unit_id);
    const message = String(body.message ?? '').trim();
    const preferredRaw = body.preferredDate ?? body.preferred_date;

    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (serviceId == null) {
      return res.status(400).json({ message: 'serviceId e obrigatorio.' });
    }
    if (unitId == null) {
      return res.status(400).json({ message: 'unitId e obrigatorio.' });
    }
    if (!message) {
      return res.status(400).json({
        message: 'message e obrigatorio (detalhes da solicitacao).',
      });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canSubmitServiceRequest(user, condoId)) {
      return res.status(403).json({
        message:
          'Apenas moradores com unidade cadastrada podem solicitar servicos da guia.',
      });
    }
    if (user.unit_id !== unitId) {
      return res.status(403).json({
        message: 'A solicitacao deve ser feita para a unidade do morador.',
      });
    }

    const uok = await query(
      `select id from units where id = $1 and condo_id = $2`,
      [unitId, condoId],
    );
    if (uok.rows.length === 0) {
      return res.status(404).json({ message: 'Unidade invalida.' });
    }

    const svc = await query(
      `select id, active, visible, scope from condo_service_catalog where id = $1 and condo_id = $2`,
      [serviceId, condoId],
    );
    if (svc.rows.length === 0) {
      return res.status(404).json({ message: 'Servico nao encontrado.' });
    }
    const svcRow = svc.rows[0] as {
      active: boolean;
      visible: boolean;
      scope: string;
    };
    if (!svcRow.active || !svcRow.visible) {
      return res.status(400).json({ message: 'Este servico nao esta disponivel.' });
    }
    if (svcRow.scope !== 'unit') {
      return res.status(400).json({
        message:
          'Este servico e voltado ao condominio; use os dados de contato na guia.',
      });
    }

    let preferredDate: string | null = null;
    if (preferredRaw !== undefined && preferredRaw !== null && String(preferredRaw).trim() !== '') {
      preferredDate = parseDateOnly(preferredRaw);
      if (preferredDate == null) {
        return res.status(400).json({
          message: 'preferredDate deve ser YYYY-MM-DD.',
        });
      }
    }

    const ins = await query(
      `insert into condo_service_requests (
         condo_id, service_id, unit_id, created_by_user_id, message, preferred_date
       )
       values ($1, $2, $3, $4, $5, $6)
       returning id,
                 condo_id,
                 service_id,
                 unit_id,
                 created_by_user_id,
                 message,
                 preferred_date,
                 status,
                 staff_notes,
                 created_at,
                 updated_at`,
      [condoId, serviceId, unitId, userId, message, preferredDate],
    );

    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/requests/:id', async (req, res, next) => {
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

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageServiceRequests(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas equipe operacional pode atualizar solicitacoes.',
      });
    }

    const ex = await query(
      `select id from condo_service_requests where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (ex.rows.length === 0) {
      return res.status(404).json({ message: 'Solicitacao nao encontrada.' });
    }

    const cur = await query(
      `select status, staff_notes from condo_service_requests where id = $1`,
      [id],
    );
    const row = cur.rows[0] as { status: string; staff_notes: string | null };

    let nextStatus = row.status as RequestStatus;
    let nextNotes = row.staff_notes;
    let changed = false;

    if (body.status !== undefined && String(body.status).trim() !== '') {
      const s = parseRequestStatus(body.status);
      if (s == null) {
        return res.status(400).json({ message: 'status invalido.' });
      }
      nextStatus = s;
      changed = true;
    }
    if (body.staffNotes !== undefined || body.staff_notes !== undefined) {
      nextNotes =
        String(body.staffNotes ?? body.staff_notes ?? '').trim() || null;
      changed = true;
    }

    if (!changed) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    const r = await query(
      `update condo_service_requests
       set status = $2,
           staff_notes = $3,
           updated_at = now()
       where id = $1
       returning id,
                 condo_id,
                 service_id,
                 unit_id,
                 created_by_user_id,
                 message,
                 preferred_date,
                 status,
                 staff_notes,
                 created_at,
                 updated_at`,
      [id, nextStatus, nextNotes],
    );

    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

export default router;

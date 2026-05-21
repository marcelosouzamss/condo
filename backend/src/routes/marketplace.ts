import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import multer from 'multer';
import { Router } from 'express';

import { isBillingStaff } from '../authz';
import { query } from '../db';

const router = Router();

const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

const MAX_PHOTOS_PER_LISTING = 8;

const marketplacePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const condoId = parseCondoIdQuery(req.query.condoId);
      const lid = parsePositive(req.params.listingId);
      const dir = path.join(
        UPLOADS_ROOT,
        'marketplace',
        `condo-${condoId}`,
        `listing-${lid ?? 0}`,
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
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    cb(null, ok);
  },
});

const STATUSES = ['active', 'closed'] as const;
type Status = (typeof STATUSES)[number];

const LISTING_SCOPES = ['condominium', 'residents'] as const;
type ListingScope = (typeof LISTING_SCOPES)[number];

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

function parseStatus(raw: unknown): Status | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (STATUSES.includes(s as Status)) {
    return s as Status;
  }
  return null;
}

function parseListingScope(raw: unknown): ListingScope | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (LISTING_SCOPES.includes(s as ListingScope)) {
    return s as ListingScope;
  }
  return null;
}

function parsePriceAmount(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) {
    return null;
  }
  return Math.round(v * 100) / 100;
}

function listingPhotosJsonSubquery(tableAlias: string): string {
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
    from condo_market_listing_photos ph
    where ph.listing_id = ${tableAlias}.id)`;
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

const MAX_JSON_IMAGE_BYTES = 6 * 1024 * 1024;

function stripDataUrlBase64(raw: string): string {
  const s = raw.trim();
  const m = /^data:image\/[^;]+;base64,(.+)$/is.exec(s);
  if (m) {
    return m[1].replace(/\s/g, '');
  }
  return s.replace(/\s/g, '');
}

function imageExtFromMagic(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return '.jpg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return '.png';
  }
  if (buf.length >= 6) {
    const sig = buf.subarray(0, 6).toString('ascii');
    if (sig === 'GIF87a' || sig === 'GIF89a') {
      return '.gif';
    }
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return '.webp';
  }
  return null;
}

type AppUserRow = {
  id: number;
  condo_id: number;
  role: string;
  active: boolean;
};

async function loadUser(userId: number): Promise<AppUserRow | null> {
  const r = await query(
    `select id, condo_id, role, active from app_users where id = $1 limit 1`,
    [userId],
  );
  if (r.rows.length === 0) {
    return null;
  }
  return r.rows[0] as AppUserRow;
}

/** Área condomínio: síndico, administração e parceiros. */
function canPostCondominiumListings(user: AppUserRow, condoId: number): boolean {
  return (
    user.active === true &&
    user.condo_id === condoId &&
    (user.role === 'syndic' ||
      user.role === 'administrator' ||
      user.role === 'partner')
  );
}

/** Área moradores: moradores e síndico. */
function canPostResidentsListings(user: AppUserRow, condoId: number): boolean {
  return (
    user.active === true &&
    user.condo_id === condoId &&
    (user.role === 'resident' || user.role === 'syndic')
  );
}

function canPostToScope(
  user: AppUserRow,
  condoId: number,
  scope: ListingScope,
): boolean {
  if (scope === 'condominium') {
    return canPostCondominiumListings(user, condoId);
  }
  return canPostResidentsListings(user, condoId);
}

type ListingAuthRow = {
  condo_id: number;
  created_by_user_id: number;
  listing_scope: ListingScope;
};

/** Alteração de texto/dados (PATCH): síndico e administração não editam. Morador só o próprio na área moradores. */
function mayEditListing(user: AppUserRow, row: ListingAuthRow): boolean {
  if (user.active !== true || user.condo_id !== row.condo_id) {
    return false;
  }
  if (isBillingStaff(user.role)) {
    return false;
  }
  if (user.id !== row.created_by_user_id) {
    return false;
  }
  if (user.role === 'resident') {
    return row.listing_scope === 'residents';
  }
  if (user.role === 'partner') {
    return row.listing_scope === 'condominium';
  }
  if (user.role === 'collaborator' || user.role === 'doorman') {
    return true;
  }
  return false;
}

/** Fotos: síndico/admin só nos anúncios que eles próprios criaram; demais perfis seguem [mayEditListing]. */
function mayManageListingPhotos(user: AppUserRow, row: ListingAuthRow): boolean {
  if (user.active !== true || user.condo_id !== row.condo_id) {
    return false;
  }
  if (isBillingStaff(user.role)) {
    return user.id === row.created_by_user_id;
  }
  return mayEditListing(user, row);
}

/** Exclusão: síndico e administração removem qualquer anúncio. Morador só remove o próprio na área moradores (não remove da área condomínio). */
function mayDeleteListing(user: AppUserRow, row: ListingAuthRow): boolean {
  if (user.active !== true || user.condo_id !== row.condo_id) {
    return false;
  }
  if (isBillingStaff(user.role)) {
    return true;
  }
  if (user.id !== row.created_by_user_id) {
    return false;
  }
  if (user.role === 'resident') {
    return row.listing_scope === 'residents';
  }
  if (user.role === 'partner') {
    return row.listing_scope === 'condominium';
  }
  if (user.role === 'collaborator' || user.role === 'doorman') {
    return true;
  }
  return false;
}

function listingSelectCols(viewerUserSql: string | null = null): string {
  const viewerInterested = viewerUserSql == null
    ? `false`
    : `exists (
        select 1
        from condo_market_listing_interests mi_viewer
        where mi_viewer.listing_id = m.id
          and mi_viewer.user_id = ${viewerUserSql}::integer
      )`;
  return `m.id,
                      m.condo_id,
                      m.title,
                      m.description,
                      m.category,
                      m.price_amount,
                      m.price_note,
                      m.contact_hint,
                      m.contact_phone,
                      m.contact_email,
                      m.contact_whatsapp,
                      m.listing_scope,
                      m.status,
                      m.created_by_user_id,
                      m.expires_at,
                      m.created_at,
                      m.updated_at,
                      u.full_name as created_by_name,
                      u.role as created_by_role,
                      (
                        select count(*)::int
                        from condo_market_listing_interests mi_count
                        where mi_count.listing_id = m.id
                      ) as interest_count,
                      ${viewerInterested} as viewer_interested,
                      ${listingPhotosJsonSubquery('m')} as portfolio_photos`;
}

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoIdQuery(req.query.condoId);
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
        message: 'status deve ser active ou closed.',
      });
    }

    const categoryFilter =
      req.query.category !== undefined && String(req.query.category).trim() !== ''
        ? String(req.query.category).trim()
        : null;

    const scopeFilterRaw =
      req.query.listingScope !== undefined && String(req.query.listingScope).trim() !== ''
        ? req.query.listingScope
        : req.query.listing_scope !== undefined && String(req.query.listing_scope).trim() !== ''
          ? req.query.listing_scope
          : undefined;

    const scopeFilter =
      scopeFilterRaw !== undefined ? parseListingScope(scopeFilterRaw) : null;
    if (
      scopeFilter === null &&
      scopeFilterRaw !== undefined &&
      String(scopeFilterRaw).trim() !== ''
    ) {
      return res.status(400).json({
        message: 'listingScope deve ser condominium ou residents.',
      });
    }

    const onlyActive = req.query.onlyActive !== 'false';
    const includeExpired = req.query.includeExpired === 'true';
    const viewerUserId = parsePositive(req.query.userId);

    const params: unknown[] = [condoId];
    let p = 2;
    let viewerUserSql: string | null = null;
    if (viewerUserId != null) {
      viewerUserSql = `$${p}`;
      params.push(viewerUserId);
      p += 1;
    }

    let sql = `select ${listingSelectCols(viewerUserSql)}
               from condo_market_listings m
               join app_users u on u.id = m.created_by_user_id
               where m.condo_id = $1`;

    if (statusFilter != null) {
      sql += ` and m.status = $${p}`;
      params.push(statusFilter);
      p += 1;
      if (statusFilter === 'active' && !includeExpired) {
        sql += ` and m.expires_at > now()`;
      }
    } else if (onlyActive) {
      sql += ` and m.status = 'active'`;
      if (!includeExpired) {
        sql += ` and m.expires_at > now()`;
      }
    }

    if (categoryFilter != null) {
      sql += ` and m.category = $${p}`;
      params.push(categoryFilter);
      p += 1;
    }

    if (scopeFilter != null) {
      sql += ` and m.listing_scope = $${p}`;
      params.push(scopeFilter);
      p += 1;
    }

    sql += ` order by m.created_at desc`;

    const r = await query(sql, params);
    return res.json(r.rows);
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
    const category = String(body.category ?? '').trim() || null;
    const contactHint = String(body.contactHint ?? body.contact_hint ?? '').trim() || null;
    const contactPhone =
      String(body.contactPhone ?? body.contact_phone ?? '').trim() || null;
    const contactEmail =
      String(body.contactEmail ?? body.contact_email ?? '').trim() || null;
    const contactWhatsapp =
      String(body.contactWhatsapp ?? body.contact_whatsapp ?? '').trim() || null;
    const priceNote = String(body.priceNote ?? body.price_note ?? '').trim() || null;

    const listingScope = parseListingScope(
      body.listingScope ?? body.listing_scope ?? '',
    );
    if (listingScope == null) {
      return res.status(400).json({
        message: 'listingScope e obrigatorio (condominium ou residents).',
      });
    }

    let priceAmount: number | null = null;
    if (body.priceAmount !== undefined || body.price_amount !== undefined) {
      const raw = body.priceAmount ?? body.price_amount;
      if (raw === null || raw === '') {
        priceAmount = null;
      } else {
        const parsed = parsePriceAmount(raw);
        if (parsed == null) {
          return res.status(400).json({ message: 'priceAmount invalido.' });
        }
        priceAmount = parsed;
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

    const user = await loadUser(userId);
    if (user == null || !canPostToScope(user, condoId, listingScope)) {
      return res.status(403).json({
        message:
          listingScope === 'condominium'
            ? 'Sem permissao para anunciar na area do condominio.'
            : 'Sem permissao para anunciar na area dos moradores.',
      });
    }

    const ins = await query(
      `insert into condo_market_listings (
         condo_id, title, description, category, price_amount, price_note,
         contact_hint, contact_phone, contact_email, contact_whatsapp,
         listing_scope, created_by_user_id
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id,
                 condo_id,
                 title,
                 description,
                 category,
                 price_amount,
                 price_note,
                 contact_hint,
                 contact_phone,
                 contact_email,
                 contact_whatsapp,
                 listing_scope,
                 status,
                 created_by_user_id,
                 expires_at,
                 created_at,
                 updated_at`,
      [
        condoId,
        title,
        description,
        category,
        priceAmount,
        priceNote,
        contactHint,
        contactPhone,
        contactEmail,
        contactWhatsapp,
        listingScope,
        userId,
      ],
    );

    const row = ins.rows[0] as Record<string, unknown>;
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
       from condo_market_listing_photos ph2
       where ph2.listing_id = $1`,
      [row.id],
    );
    const portfolioPhotos = (ph.rows[0] as { portfolio_photos: unknown }).portfolio_photos;

    return res.status(201).json({
      ...row,
      portfolio_photos: portfolioPhotos,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/listings/:listingId/upload-photo-json', async (req, res, next) => {
  try {
    const listingId = parsePositive(req.params.listingId);
    const body = req.body || {};
    let condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    if (!Number.isFinite(condoId) || condoId < 1) {
      condoId = parseCondoIdQuery(req.query.condoId);
    }
    const userId = parsePositive(body.userId) ?? parsePositive(req.query.userId);

    const rawB64 = String(body.imageBase64 ?? body.image_base64 ?? '').trim();

    if (listingId == null) {
      return res.status(400).json({ message: 'listingId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (!rawB64) {
      return res.status(400).json({
        message: 'imageBase64 e obrigatorio.',
      });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }

    const rowR = await query(
      `select condo_id, created_by_user_id, listing_scope from condo_market_listings where id = $1`,
      [listingId],
    );
    if (rowR.rows.length === 0) {
      return res.status(404).json({ message: 'Anuncio nao encontrado.' });
    }
    const listingRow = rowR.rows[0] as ListingAuthRow;
    if (listingRow.condo_id !== condoId) {
      return res.status(403).json({ message: 'Anuncio de outro condominio.' });
    }
    if (!mayManageListingPhotos(user, listingRow)) {
      return res.status(403).json({ message: 'Sem permissao para anexar fotos.' });
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
        message:
          'Tipo de imagem nao suportado (use JPEG, PNG, GIF ou WEBP).',
      });
    }

    const cnt = await query(
      `select count(*)::int as c from condo_market_listing_photos where listing_id = $1`,
      [listingId],
    );
    const n = (cnt.rows[0] as { c: number }).c;
    if (n >= MAX_PHOTOS_PER_LISTING) {
      return res.status(400).json({
        message: `Limite de ${MAX_PHOTOS_PER_LISTING} fotos por anuncio.`,
      });
    }

    const dir = path.join(
      UPLOADS_ROOT,
      'marketplace',
      `condo-${condoId}`,
      `listing-${listingId}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    const fname = `${crypto.randomBytes(16).toString('hex')}${ext}`;
    const absPath = path.join(dir, fname);
    fs.writeFileSync(absPath, buf);

    const relPath = path.relative(UPLOADS_ROOT, absPath).split(path.sep).join('/');
    const photoUrl = `/uploads/${relPath}`;

    const insPh = await query(
      `insert into condo_market_listing_photos (listing_id, photo_url, sort_order)
       values ($1, $2, $3)
       returning id, listing_id, photo_url, sort_order, created_at`,
      [listingId, photoUrl, n],
    );

    return res.status(201).json(insPh.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.post(
  '/listings/:listingId/upload-photo',
  marketplacePhotoUpload.single('photo'),
  async (req, res, next) => {
    try {
      const listingId = parsePositive(req.params.listingId);
      const condoId = parseCondoIdQuery(req.query.condoId);
      const userId = parsePositive(req.query.userId);
      const file = req.file;

      const cleanupFile = () => {
        if (file) {
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* empty */
          }
        }
      };

      if (listingId == null) {
        cleanupFile();
        return res.status(400).json({ message: 'listingId invalido.' });
      }
      if (userId == null) {
        cleanupFile();
        return res.status(400).json({ message: 'userId e obrigatorio (query).' });
      }

      const user = await loadUser(userId);
      if (user == null || user.active !== true) {
        cleanupFile();
        return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
      }

      const rowR = await query(
        `select condo_id, created_by_user_id, listing_scope from condo_market_listings where id = $1`,
        [listingId],
      );
      if (rowR.rows.length === 0) {
        cleanupFile();
        return res.status(404).json({ message: 'Anuncio nao encontrado.' });
      }
      const listingRow = rowR.rows[0] as ListingAuthRow;
      if (listingRow.condo_id !== condoId) {
        cleanupFile();
        return res.status(403).json({ message: 'Anuncio de outro condominio.' });
      }
      if (!mayManageListingPhotos(user, listingRow)) {
        cleanupFile();
        return res.status(403).json({ message: 'Sem permissao para anexar fotos.' });
      }

      if (!file) {
        return res.status(400).json({
          message: 'Envie o arquivo no campo photo (multipart/form-data).',
        });
      }

      const cnt = await query(
        `select count(*)::int as c from condo_market_listing_photos where listing_id = $1`,
        [listingId],
      );
      const n = (cnt.rows[0] as { c: number }).c;
      if (n >= MAX_PHOTOS_PER_LISTING) {
        cleanupFile();
        return res.status(400).json({
          message: `Limite de ${MAX_PHOTOS_PER_LISTING} fotos por anuncio.`,
        });
      }

      const relPath = path.relative(UPLOADS_ROOT, file.path).split(path.sep).join('/');
      const photoUrl = `/uploads/${relPath}`;

      const insPh = await query(
        `insert into condo_market_listing_photos (listing_id, photo_url, sort_order)
         values ($1, $2, $3)
         returning id, listing_id, photo_url, sort_order, created_at`,
        [listingId, photoUrl, n],
      );

      return res.status(201).json(insPh.rows[0]);
    } catch (err) {
      return next(err);
    }
  },
);

router.delete('/listings/:listingId/photos/:photoId', async (req, res, next) => {
  try {
    const listingId = parsePositive(req.params.listingId);
    const photoId = parsePositive(req.params.photoId);
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);

    if (listingId == null || photoId == null) {
      return res.status(400).json({ message: 'Parametros invalidos.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }

    const picRow = await query(
      `select p.id, p.photo_url
       from condo_market_listing_photos p
       join condo_market_listings m on m.id = p.listing_id
       where p.id = $1 and p.listing_id = $2 and m.condo_id = $3`,
      [photoId, listingId, condoId],
    );
    if (picRow.rows.length === 0) {
      return res.status(404).json({ message: 'Foto nao encontrada.' });
    }

    const listingMeta = await query(
      `select created_by_user_id, listing_scope from condo_market_listings where id = $1 and condo_id = $2`,
      [listingId, condoId],
    );
    const lm = listingMeta.rows[0] as {
      created_by_user_id: number;
      listing_scope: ListingScope;
    };
    if (
      !mayManageListingPhotos(user, {
        condo_id: condoId,
        created_by_user_id: lm.created_by_user_id,
        listing_scope: lm.listing_scope,
      })
    ) {
      return res.status(403).json({ message: 'Sem permissao para remover foto.' });
    }

    const photoUrl = (picRow.rows[0] as { photo_url: string }).photo_url;
    await query(`delete from condo_market_listing_photos where id = $1`, [photoId]);
    unlinkUploadMaybe(photoUrl);

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parseCondoIdQuery(req.query.condoId);
    const viewerUserId = parsePositive(req.query.userId);
    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const params: unknown[] = [id, condoId];
    let viewerUserSql: string | null = null;
    if (viewerUserId != null) {
      viewerUserSql = '$3';
      params.push(viewerUserId);
    }
    const r = await query(
      `select ${listingSelectCols(viewerUserSql)}
       from condo_market_listings m
       join app_users u on u.id = m.created_by_user_id
       where m.id = $1 and m.condo_id = $2`,
      params,
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Anuncio nao encontrado.' });
    }
    return res.json(r.rows[0]);
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

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }

    const existing = await query(
      `select id, condo_id, created_by_user_id, title, description, category,
              price_amount, price_note, contact_hint, contact_phone, contact_email,
              contact_whatsapp, listing_scope, status
       from condo_market_listings
       where id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Anuncio nao encontrado.' });
    }
    const row = existing.rows[0] as {
      condo_id: number;
      created_by_user_id: number;
      title: string;
      description: string | null;
      category: string | null;
      price_amount: string | number | null;
      price_note: string | null;
      contact_hint: string | null;
      contact_phone: string | null;
      contact_email: string | null;
      contact_whatsapp: string | null;
      listing_scope: string;
      status: string;
    };

    if (row.condo_id !== condoId) {
      return res.status(403).json({ message: 'Anuncio de outro condominio.' });
    }
    if (
      !mayEditListing(user, {
        condo_id: row.condo_id,
        created_by_user_id: row.created_by_user_id,
        listing_scope: row.listing_scope as ListingScope,
      })
    ) {
      return res.status(403).json({ message: 'Sem permissao para alterar.' });
    }

    if (body.listingScope !== undefined || body.listing_scope !== undefined) {
      return res.status(400).json({
        message: 'listing_scope nao pode ser alterado apos criacao.',
      });
    }

    let nextTitle = row.title;
    let nextDesc = row.description;
    let nextCat = row.category;
    let nextPrice: number | null =
      row.price_amount == null ? null : Number(row.price_amount);
    let nextPriceNote = row.price_note;
    let nextHint = row.contact_hint;
    let nextPhone = row.contact_phone;
    let nextEmail = row.contact_email;
    let nextWa = row.contact_whatsapp;
    let nextStatus = row.status as Status;
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
    if (body.contactHint !== undefined || body.contact_hint !== undefined) {
      nextHint =
        String(body.contactHint ?? body.contact_hint ?? '').trim() || null;
      changed = true;
    }
    if (body.contactPhone !== undefined || body.contact_phone !== undefined) {
      nextPhone =
        String(body.contactPhone ?? body.contact_phone ?? '').trim() || null;
      changed = true;
    }
    if (body.contactEmail !== undefined || body.contact_email !== undefined) {
      nextEmail =
        String(body.contactEmail ?? body.contact_email ?? '').trim() || null;
      changed = true;
    }
    if (
      body.contactWhatsapp !== undefined ||
      body.contact_whatsapp !== undefined
    ) {
      nextWa =
        String(body.contactWhatsapp ?? body.contact_whatsapp ?? '').trim() ||
        null;
      changed = true;
    }
    if (body.priceNote !== undefined || body.price_note !== undefined) {
      nextPriceNote =
        String(body.priceNote ?? body.price_note ?? '').trim() || null;
      changed = true;
    }
    if (body.priceAmount !== undefined || body.price_amount !== undefined) {
      const raw = body.priceAmount ?? body.price_amount;
      if (raw === null || raw === '') {
        nextPrice = null;
      } else {
        const parsed = parsePriceAmount(raw);
        if (parsed == null) {
          return res.status(400).json({ message: 'priceAmount invalido.' });
        }
        nextPrice = parsed;
      }
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
      `update condo_market_listings
       set title = $2,
           description = $3,
           category = $4,
           price_amount = $5,
           price_note = $6,
           contact_hint = $7,
           contact_phone = $8,
           contact_email = $9,
           contact_whatsapp = $10,
           status = $11,
           updated_at = now()
       where id = $1
       returning id,
                 condo_id,
                 title,
                 description,
                 category,
                 price_amount,
                 price_note,
                 contact_hint,
                 contact_phone,
                 contact_email,
                 contact_whatsapp,
                 listing_scope,
                 status,
                 created_by_user_id,
                 expires_at,
                 created_at,
                 updated_at`,
      [
        id,
        nextTitle,
        nextDesc,
        nextCat,
        nextPrice,
        nextPriceNote,
        nextHint,
        nextPhone,
        nextEmail,
        nextWa,
        nextStatus,
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
       from condo_market_listing_photos ph2
       where ph2.listing_id = $1`,
      [id],
    );
    const portfolioPhotos = (ph.rows[0] as { portfolio_photos: unknown }).portfolio_photos;

    return res.json({
      ...updatedRow,
      portfolio_photos: portfolioPhotos,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/interest', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const body = req.body || {};
    const condoId = Number(body.condoId ?? body.condo_id ?? req.query.condoId);
    const userId = parsePositive(body.userId ?? body.user_id ?? req.query.userId);
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
    if (user == null || user.active !== true || user.condo_id !== condoId) {
      return res.status(403).json({ message: 'Sem permissao para demonstrar interesse.' });
    }
    const listing = await query(
      `select id
       from condo_market_listings
       where id = $1
         and condo_id = $2
         and status = 'active'
         and expires_at > now()`,
      [id, condoId],
    );
    if (listing.rows.length === 0) {
      return res.status(404).json({ message: 'Anuncio ativo nao encontrado.' });
    }
    await query(
      `insert into condo_market_listing_interests (listing_id, user_id)
       values ($1, $2)
       on conflict (listing_id, user_id) do nothing`,
      [id, userId],
    );
    const count = await query(
      `select count(*)::int as c
       from condo_market_listing_interests
       where listing_id = $1`,
      [id],
    );
    return res.status(201).json({
      interested: true,
      interest_count: (count.rows[0] as { c: number }).c,
    });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id/interest', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = Number(req.query.condoId ?? req.query.condo_id);
    const userId = parsePositive(req.query.userId ?? req.query.user_id);
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
    if (user == null || user.active !== true || user.condo_id !== condoId) {
      return res.status(403).json({ message: 'Sem permissao para remover interesse.' });
    }
    await query(
      `delete from condo_market_listing_interests
       where listing_id = $1 and user_id = $2`,
      [id, userId],
    );
    const count = await query(
      `select count(*)::int as c
       from condo_market_listing_interests
       where listing_id = $1`,
      [id],
    );
    return res.json({
      interested: false,
      interest_count: (count.rows[0] as { c: number }).c,
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

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }

    const existing = await query(
      `select condo_id, created_by_user_id, listing_scope from condo_market_listings where id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Anuncio nao encontrado.' });
    }
    const row = existing.rows[0] as ListingAuthRow;
    if (row.condo_id !== condoId) {
      return res.status(403).json({ message: 'Anuncio de outro condominio.' });
    }
    if (!mayDeleteListing(user, row)) {
      return res.status(403).json({ message: 'Sem permissao para excluir.' });
    }

    const pics = await query(
      `select photo_url from condo_market_listing_photos where listing_id = $1`,
      [id],
    );
    for (const pr of pics.rows) {
      unlinkUploadMaybe((pr as { photo_url: string }).photo_url);
    }

    await query(`delete from condo_market_listings where id = $1`, [id]);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;

import path from 'node:path';

import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';

import { query } from './db';
import administratorRouter from './routes/administrator';
import agendaRouter from './routes/agenda';
import collaboratorsRouter from './routes/collaborators';
import contactsRouter from './routes/contacts';
import documentsRouter from './routes/documents';
import individualCommsRouter from './routes/individualComms';
import complaintsBookRouter from './routes/complaintsBook';
import lostFoundRouter from './routes/lostFound';
import marketplaceRouter from './routes/marketplace';
import offersRouter from './routes/offers';
import unitPetsRouter from './routes/unitPets';
import pollsRouter from './routes/polls';
import relationsRouter from './routes/relations';
import reservationSpacesRouter from './routes/reservationSpaces';
import serviceGuideRouter from './routes/serviceGuide';
import shiftHandoversRouter from './routes/shiftHandovers';
import syndicRouter from './routes/syndic';
import billingRouter, { billingPaymentWebhook } from './routes/billing';
import videoRoomsRouter from './routes/videoRooms';
import virtualAssembliesRouter from './routes/virtualAssemblies';
import accessControlRouter from './routes/accessControl';
import emergencyRouter from './routes/emergency';
import parcelDeliveriesRouter from './routes/parcelDeliveries';
import condosRegistryRouter from './routes/condosRegistry';

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // Inclui cabeçalhos que o app Flutter (sobretudo Web) envia em GET,
    // para o preflight OPTIONS não falhar (ex.: Cache-Control → no-cache).
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Cache-Control',
      'Pragma',
    ],
  }),
);
app.use((req, res, next) => {
  const pathOnly = (req.originalUrl ?? req.url ?? '').split('?')[0];
  const bigJson =
    req.method === 'POST' &&
    (/^\/api\/marketplace\/listings\/\d+\/upload-photo-json$/.test(pathOnly) ||
      pathOnly === '/api/reservation-spaces/upload-photo-json');
  (bigJson ? express.json({ limit: '12mb' }) : express.json())(req, res, next);
});

app.use(
  '/uploads',
  express.static(path.join(process.cwd(), 'uploads'), {
    fallthrough: true,
    maxAge: '1h',
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  }),
);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'condo-backend',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health/db', async (_req, res, next) => {
  try {
    const result = await query(
      'select current_database() as database, now() as server_time',
    );

    return res.json({
      status: 'ok',
      database: result.rows[0].database,
      serverTime: result.rows[0].server_time,
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/modules', async (_req, res, next) => {
  try {
    const result = await query(
      `select id, code, name, icon_key, display_order, enabled
       from app_modules
       where enabled = true
       order by display_order asc`,
    );

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

function parseCondoIdNotices(raw: unknown): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return 1;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : 1;
}

const NOTICE_AUDIENCE_ROLES = new Set([
  'admin',
  'syndic',
  'administrator',
  'resident',
  'partner',
  'collaborator',
  'doorman',
]);

function parseNoticeAudienceRoles(raw: unknown): string[] {
  const s = String(raw ?? '').trim();
  if (!s) {
    return [];
  }
  return s
    .split(/[,\s;|]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => NOTICE_AUDIENCE_ROLES.has(part));
}

function noticeVisibleForRole(audience: unknown, role: unknown): boolean {
  const roles = parseNoticeAudienceRoles(audience);
  if (roles.length === 0) {
    return true;
  }
  const viewerRole = String(role ?? '').trim().toLowerCase();
  return roles.includes(viewerRole);
}

app.get('/api/notices', async (req, res, next) => {
  try {
    const condoId = parseCondoIdNotices(req.query.condoId);
    const includeArchived = req.query.includeArchived === 'true';
    const viewerRole = req.query.userRole ?? req.query.role;

    const result = await query(
      `select n.id, n.title, n.content, n.published_at, n.expires_at, n.is_pinned, n.is_archived,
              n.urgency, n.audience,
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
       where n.condo_id = $1
         and ($2::boolean or n.is_archived = false)
         and n.published_at <= now()
         and (n.expires_at is null or n.expires_at > now())
       order by n.is_pinned desc,
                coalesce(n.notice_sort_at, n.published_at) desc,
                n.id desc
       limit 80`,
      [condoId, includeArchived],
    );

    return res.json(
      result.rows.filter((row: Record<string, unknown>) =>
        noticeVisibleForRole(row.audience, viewerRole),
      ),
    );
  } catch (error) {
    return next(error);
  }
});

/** Dados publicos para personalizar a tela de login (sem autenticacao). */
app.get('/api/auth/login-appearance', async (req, res, next) => {
  try {
    const raw = req.query.condoId;
    const condoId =
      raw !== undefined && raw !== null && String(raw).trim() !== ''
        ? Number(raw)
        : 1;
    const id = Number.isFinite(condoId) && condoId > 0 ? condoId : 1;

    const r = await query(
      `select id, name, login_logo_path, login_background_path from condos where id = $1 limit 1`,
      [id],
    );
    if (r.rows.length === 0) {
      return res.json({
        condoId: id,
        condominiumName: 'Condominio',
        logoRelativePath: null as string | null,
        backgroundRelativePath: null as string | null,
      });
    }
    const row = r.rows[0] as {
      id: number;
      name: string;
      login_logo_path: string | null;
      login_background_path: string | null;
    };
    return res.json({
      condoId: row.id,
      condominiumName: row.name,
      logoRelativePath:
        row.login_logo_path != null && String(row.login_logo_path).trim() !== ''
          ? String(row.login_logo_path).trim()
          : null,
      backgroundRelativePath:
        row.login_background_path != null &&
        String(row.login_background_path).trim() !== ''
          ? String(row.login_background_path).trim()
          : null,
    });
  } catch (error) {
    return next(error);
  }
});

app.use('/api/condos', condosRegistryRouter);

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { login, password } = (req.body || {}) as {
      login?: string;
      password?: string;
    };
    const normalizedLogin = login?.trim().toLowerCase() || '';
    const rawPassword = password?.trim() || '';

    if (!normalizedLogin || !rawPassword) {
      return res.status(400).json({ message: 'login e password sao obrigatorios.' });
    }

    const result = await query(
      `select id, condo_id, unit_id, full_name, login, role, active
       from app_users
       where lower(login) = $1 and password_plain = $2
       limit 1`,
      [normalizedLogin, rawPassword],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciais invalidas.' });
    }

    const user = result.rows[0];
    if (user.active !== true) {
      return res.status(403).json({ message: 'Usuario inativo.' });
    }

    return res.json({
      user: {
        id: user.id,
        condoId: user.condo_id,
        unitId: user.unit_id,
        fullName: user.full_name,
        login: user.login,
        role: user.role,
      },
    });
  } catch (error) {
    return next(error);
  }
});

app.use('/api/syndic', syndicRouter);
app.use('/api/reservation-spaces', reservationSpacesRouter);
app.use('/api/administrator', administratorRouter);
app.use('/api/relations', relationsRouter);
app.use('/api/individual-comms', individualCommsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/collaborators', collaboratorsRouter);
app.use('/api/shift-handovers', shiftHandoversRouter);
app.use('/api/service-guide', serviceGuideRouter);
app.use('/api/offers', offersRouter);
app.use('/api/agenda', agendaRouter);
app.use('/api/polls', pollsRouter);
app.use('/api/lost-found', lostFoundRouter);
app.use('/api/complaints-book', complaintsBookRouter);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/unit-pets', unitPetsRouter);
app.use('/api/video-rooms', videoRoomsRouter);
app.use('/api/virtual-assemblies', virtualAssembliesRouter);
app.use('/api/access-control', accessControlRouter);
app.use('/api/emergency-incidents', emergencyRouter);
app.use('/api/parcel-deliveries', parcelDeliveriesRouter);
app.use('/api/billing', billingRouter);

app.post('/api/webhooks/payment', billingPaymentWebhook);

app.get('/api/units', async (req, res, next) => {
  try {
    const raw = req.query.condoId;
    if (
      raw !== undefined &&
      raw !== null &&
      String(raw).trim() !== ''
    ) {
      const condoId = Number(raw);
      if (!Number.isFinite(condoId) || condoId < 1) {
        return res.status(400).json({ message: 'condoId invalido.' });
      }
      const result = await query(
        `select id,
                condo_id,
                tower,
                number,
                resident_name,
                monthly_fee,
                reserve_fund_fee,
                billing_active
         from units
         where condo_id = $1
         order by tower asc, number asc`,
        [condoId],
      );
      return res.json(result.rows);
    }

    const result = await query(
      `select id,
              condo_id,
              tower,
              number,
              resident_name,
              monthly_fee,
              reserve_fund_fee,
              billing_active
       from units
       order by tower asc, number asc`,
    );

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

/** Compatibilidade: somente eventos publicos; prefira GET /api/agenda/events */
app.get('/api/events', async (req, res, next) => {
  try {
    const raw = req.query.condoId;
    const condoId =
      raw !== undefined && raw !== null && String(raw).trim() !== ''
        ? Number(raw)
        : 1;
    const cid = Number.isFinite(condoId) && condoId > 0 ? condoId : 1;

    const result = await query(
      `select id,
              condo_id,
              title,
              description,
              event_date,
              event_end,
              location,
              visibility
       from events
       where condo_id = $1
         and visibility = 'public'
       order by event_date asc, id asc`,
      [cid],
    );

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/maintenance-requests', async (req, res, next) => {
  try {
    const condoIdRaw = (req.body as { condoId?: unknown }).condoId;
    const condoId =
      condoIdRaw !== undefined && condoIdRaw !== null && String(condoIdRaw).trim() !== ''
        ? Number(condoIdRaw)
        : 1;
    const { unitId: unitIdBody, title, description, priority = 'normal' } = req.body as {
      unitId?: number;
      title?: string;
      description?: string;
      priority?: string;
    };
    const unitId = Number(unitIdBody);

    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (!Number.isFinite(unitId) || unitId < 1) {
      return res.status(400).json({ message: 'unitId invalido.' });
    }

    const titleTrim = String(title ?? '').trim();
    const descTrim = String(description ?? '').trim();
    if (!titleTrim || !descTrim) {
      return res.status(400).json({
        message: 'title e description sao obrigatorios.',
      });
    }

    const PRIORITIES = ['low', 'normal', 'high'];
    const p = String(priority).trim();
    if (!PRIORITIES.includes(p)) {
      return res.status(400).json({
        message: 'priority deve ser low, normal ou high.',
      });
    }

    const unitOk = await query(
      `select id from units where id = $1 and condo_id = $2`,
      [unitId, condoId],
    );
    if (unitOk.rows.length === 0) {
      return res.status(404).json({ message: 'Unidade nao encontrada no condominio.' });
    }

    const result = await query(
      `insert into maintenance_requests (unit_id, title, description, priority)
       values ($1, $2, $3, $4)
       returning id, unit_id, title, description, priority, status, syndic_response, created_at, updated_at`,
      [unitId, titleTrim, descTrim, p],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

function parsePositive(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function residentOwnsMaintenanceRow(
  maintenanceId: number,
  condoId: number,
  unitId: number,
  userId: number,
): Promise<boolean> {
  const r = await query(
    `select mr.id
     from maintenance_requests mr
     join units u on u.id = mr.unit_id
     join app_users au on au.id = $4
     where mr.id = $1 and mr.unit_id = $2 and u.condo_id = $3
       and au.condo_id = u.condo_id
       and au.unit_id = mr.unit_id`,
    [maintenanceId, unitId, condoId, userId],
  );
  return r.rows.length > 0;
}

/** Chamados de manutenção da própria unidade (morador). */
app.get('/api/maintenance-requests', async (req, res, next) => {
  try {
    const condoId = parsePositive(req.query.condoId) ?? 1;
    const unitId = parsePositive(req.query.unitId);
    if (unitId == null) {
      return res.status(400).json({ message: 'unitId e obrigatorio.' });
    }

    const unitOk = await query(
      `select id from units where id = $1 and condo_id = $2`,
      [unitId, condoId],
    );
    if (unitOk.rows.length === 0) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }

    const r = await query(
      `select id,
              unit_id,
              title,
              description,
              priority,
              status,
              syndic_response,
              created_at,
              updated_at
       from maintenance_requests
       where unit_id = $1
       order by created_at desc`,
      [unitId],
    );

    return res.json(r.rows);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/maintenance-requests/:id/messages', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parsePositive(req.query.condoId) ?? 1;
    const unitId = parsePositive(req.query.unitId);
    const userId = parsePositive(req.query.userId);
    if (id == null || unitId == null || userId == null) {
      return res.status(400).json({
        message: 'id, unitId e userId sao obrigatorios.',
      });
    }
    const ok = await residentOwnsMaintenanceRow(id, condoId, unitId, userId);
    if (!ok) {
      return res.status(403).json({ message: 'Sem permissao para este chamado.' });
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
  } catch (error) {
    return next(error);
  }
});

app.post('/api/maintenance-requests/:id/messages', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const body = req.body as {
      condoId?: unknown;
      unitId?: unknown;
      userId?: unknown;
      body?: unknown;
    };
    const condoId = parsePositive(body.condoId) ?? 1;
    const unitId = parsePositive(body.unitId);
    const userId = parsePositive(body.userId);
    const text = String(body.body ?? '').trim();
    if (id == null || unitId == null || userId == null) {
      return res.status(400).json({ message: 'Parametros invalidos.' });
    }
    if (!text) {
      return res.status(400).json({ message: 'body e obrigatorio.' });
    }
    const ok = await residentOwnsMaintenanceRow(id, condoId, unitId, userId);
    if (!ok) {
      return res.status(403).json({ message: 'Sem permissao para este chamado.' });
    }
    const ins = await query(
      `insert into maintenance_request_messages (
         maintenance_request_id, user_id, author_role, body
       )
       values ($1, $2, 'resident', $3)
       returning id, maintenance_request_id, user_id, author_role, body, created_at`,
      [id, userId, text],
    );
    return res.status(201).json(ins.rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/maintenance-requests/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const body = req.body as {
      condoId?: unknown;
      unitId?: unknown;
      userId?: unknown;
      status?: unknown;
    };
    const condoId = parsePositive(body.condoId) ?? 1;
    const unitId = parsePositive(body.unitId);
    const userId = parsePositive(body.userId);
    const st = String(body.status ?? '').trim();
    if (id == null || unitId == null || userId == null) {
      return res.status(400).json({
        message: 'id, unitId e userId sao obrigatorios.',
      });
    }
    if (st !== 'completed') {
      return res.status(400).json({
        message: 'Apenas status completed pode ser definido pelo morador.',
      });
    }
    const ok = await residentOwnsMaintenanceRow(id, condoId, unitId, userId);
    if (!ok) {
      return res.status(403).json({ message: 'Sem permissao para este chamado.' });
    }
    const r = await query(
      `update maintenance_requests
       set status = $2, updated_at = now()
       where id = $1
       returning id, unit_id, title, description, priority, status,
                 syndic_response, created_at, updated_at`,
      [id, st],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Solicitacao nao encontrada.' });
    }
    return res.json(r.rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/maintenance-requests/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parsePositive(req.query.condoId) ?? 1;
    const unitId = parsePositive(req.query.unitId);
    const userId = parsePositive(req.query.userId);
    if (id == null || unitId == null || userId == null) {
      return res.status(400).json({
        message: 'id, unitId e userId sao obrigatorios.',
      });
    }
    const ok = await residentOwnsMaintenanceRow(id, condoId, unitId, userId);
    if (!ok) {
      return res.status(403).json({ message: 'Sem permissao para este chamado.' });
    }
    const r = await query(
      `select id,
              unit_id,
              title,
              description,
              priority,
              status,
              syndic_response,
              created_at,
              updated_at
       from maintenance_requests
       where id = $1`,
      [id],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Solicitacao nao encontrada.' });
    }
    return res.json(r.rows[0]);
  } catch (error) {
    return next(error);
  }
});

const RESIDENT_OCCURRENCE_CATEGORIES = [
  'noise_complaint',
  'common_area_issue',
] as const;

app.post('/api/resident/occurrences', async (req, res, next) => {
  try {
    const condoId = parsePositive((req.body as { condoId?: unknown }).condoId) ?? 1;
    const unitId = parsePositive((req.body as { unitId?: unknown }).unitId);
    const title = String((req.body as { title?: unknown }).title ?? '').trim();
    const description = String(
      (req.body as { description?: unknown }).description ?? '',
    ).trim();
    const category = String(
      (req.body as { category?: unknown }).category ?? '',
    ).trim();
    const reporterName = String(
      (req.body as { reporterName?: unknown }).reporterName ?? '',
    ).trim();

    if (unitId == null || !title || !description) {
      return res.status(400).json({
        message: 'unitId, title e description sao obrigatorios.',
      });
    }
    if (
      !RESIDENT_OCCURRENCE_CATEGORIES.includes(
        category as (typeof RESIDENT_OCCURRENCE_CATEGORIES)[number],
      )
    ) {
      return res.status(400).json({
        message:
          'category deve ser noise_complaint (reclamacao de ruido) ou common_area_issue (area comum).',
      });
    }

    const unitOk = await query(
      `select id from units where id = $1 and condo_id = $2`,
      [unitId, condoId],
    );
    if (unitOk.rows.length === 0) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }

    const result = await query(
      `insert into occurrences (condo_id, unit_id, title, description, category, status, reporter_name)
       values ($1, $2, $3, $4, $5, 'open', $6)
       returning id, condo_id, unit_id, title, description, category, status, reporter_name,
                 created_at, updated_at`,
      [condoId, unitId, title, description, category, reporterName || null],
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

async function resolveMyUnit(condoId: number, unitId?: number): Promise<number | null> {
  if (unitId != null) {
    const r = await query(`select id from units where id = $1 and condo_id = $2`, [
      unitId,
      condoId,
    ]);
    return r.rows.length > 0 ? unitId : null;
  }
  const fallback = await query(
    `select id from units where condo_id = $1 order by tower asc, number asc limit 1`,
    [condoId],
  );
  if (fallback.rows.length === 0) {
    return null;
  }
  return fallback.rows[0].id as number;
}

app.get('/api/my-unit', async (req, res, next) => {
  try {
    const condoId = parsePositive(req.query.condoId) ?? 1;
    const requestedUnitId = parsePositive(req.query.unitId);
    const unitId = await resolveMyUnit(condoId, requestedUnitId ?? undefined);
    if (unitId == null) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }

    const [unitResult, residentsResult, vehiclesResult, petsResult] = await Promise.all([
      query(
        `select id, condo_id, tower, number, resident_name
         from units
         where id = $1 and condo_id = $2`,
        [unitId, condoId],
      ),
      query(
        `select id, unit_id, role, full_name, phone, email, notes, created_at, updated_at
         from unit_residents
         where unit_id = $1
         order by
           case role when 'owner' then 1 when 'tenant' then 2 when 'resident' then 3 else 4 end,
           full_name asc`,
        [unitId],
      ),
      query(
        `select id, unit_id, model, plate, parking_spot, color, created_at, updated_at
         from unit_vehicles
         where unit_id = $1
         order by created_at desc`,
        [unitId],
      ),
      query(
        `select id, unit_id, name, species, breed, color, photo_url, notes, created_at, updated_at
         from unit_pets
         where unit_id = $1
         order by created_at desc`,
        [unitId],
      ),
    ]);

    const owner =
      residentsResult.rows.find((row) => String(row.role) === 'owner') ?? null;
    const unit = unitResult.rows[0];

    return res.json({
      unit,
      personalData: {
        fullName: owner?.full_name ?? unit.resident_name,
        phone: owner?.phone ?? '',
        email: owner?.email ?? '',
      },
      residents: residentsResult.rows,
      vehicles: vehiclesResult.rows,
      pets: petsResult.rows,
    });
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/my-unit/personal-data', async (req, res, next) => {
  try {
    const condoId = parsePositive((req.body as { condoId?: unknown }).condoId) ?? 1;
    const unitId = parsePositive((req.body as { unitId?: unknown }).unitId);
    const fullName = String((req.body as { fullName?: unknown }).fullName ?? '').trim();
    const phone = String((req.body as { phone?: unknown }).phone ?? '').trim();
    const email = String((req.body as { email?: unknown }).email ?? '').trim();

    if (unitId == null || !fullName) {
      return res.status(400).json({ message: 'unitId e fullName sao obrigatorios.' });
    }
    const resolvedUnitId = await resolveMyUnit(condoId, unitId);
    if (resolvedUnitId == null) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }

    const owner = await query(
      `select ur.id
       from unit_residents ur
       join units u on u.id = ur.unit_id
       where ur.unit_id = $1 and ur.role = 'owner' and u.condo_id = $2
       limit 1`,
      [resolvedUnitId, condoId],
    );

    if (owner.rows.length > 0) {
      await query(
        `update unit_residents
         set full_name = $2, phone = $3, email = $4, updated_at = now()
         where id = $1`,
        [owner.rows[0].id as number, fullName, phone || null, email || null],
      );
    } else {
      await query(
        `insert into unit_residents (unit_id, role, full_name, phone, email)
         values ($1, 'owner', $2, $3, $4)`,
        [resolvedUnitId, fullName, phone || null, email || null],
      );
    }

    const updated = await query(
      `update units
       set resident_name = $1
       where id = $2 and condo_id = $3
       returning id, condo_id, tower, number, resident_name`,
      [fullName, resolvedUnitId, condoId],
    );
    return res.json(updated.rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/my-unit/residents', async (req, res, next) => {
  try {
    const condoId = parsePositive((req.body as { condoId?: unknown }).condoId) ?? 1;
    const unitId = parsePositive((req.body as { unitId?: unknown }).unitId);
    const role = String((req.body as { role?: unknown }).role ?? '').trim();
    const fullName = String((req.body as { fullName?: unknown }).fullName ?? '').trim();
    const phone = String((req.body as { phone?: unknown }).phone ?? '').trim();
    const email = String((req.body as { email?: unknown }).email ?? '').trim();
    const notes = String((req.body as { notes?: unknown }).notes ?? '').trim();
    if (unitId == null || !fullName || !['owner', 'tenant', 'resident', 'other'].includes(role)) {
      return res.status(400).json({ message: 'Dados de morador invalidos.' });
    }
    const resolvedUnitId = await resolveMyUnit(condoId, unitId);
    if (resolvedUnitId == null) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }
    const inserted = await query(
      `insert into unit_residents (unit_id, role, full_name, phone, email, notes)
       values ($1, $2, $3, $4, $5, $6)
       returning id, unit_id, role, full_name, phone, email, notes, created_at, updated_at`,
      [resolvedUnitId, role, fullName, phone || null, email || null, notes || null],
    );
    if (role === 'owner') {
      await query(`update units set resident_name = $1 where id = $2`, [fullName, resolvedUnitId]);
    }
    return res.status(201).json(inserted.rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/my-unit/residents/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parsePositive((req.body as { condoId?: unknown }).condoId) ?? 1;
    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    const role = String((req.body as { role?: unknown }).role ?? '').trim();
    const fullName = String((req.body as { fullName?: unknown }).fullName ?? '').trim();
    const phone = String((req.body as { phone?: unknown }).phone ?? '').trim();
    const email = String((req.body as { email?: unknown }).email ?? '').trim();
    const notes = String((req.body as { notes?: unknown }).notes ?? '').trim();
    if (!['owner', 'tenant', 'resident', 'other'].includes(role) || !fullName) {
      return res.status(400).json({ message: 'Dados de morador invalidos.' });
    }
    const updated = await query(
      `update unit_residents ur
       set role = $1, full_name = $2, phone = $3, email = $4, notes = $5, updated_at = now()
       from units u
       where ur.id = $6 and ur.unit_id = u.id and u.condo_id = $7
       returning ur.id, ur.unit_id, ur.role, ur.full_name, ur.phone, ur.email, ur.notes, ur.created_at, ur.updated_at`,
      [role, fullName, phone || null, email || null, notes || null, id, condoId],
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ message: 'Morador nao encontrado.' });
    }
    if (role === 'owner') {
      await query(`update units set resident_name = $1 where id = $2`, [
        fullName,
        updated.rows[0].unit_id as number,
      ]);
    }
    return res.json(updated.rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/my-unit/residents/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parsePositive(req.query.condoId) ?? 1;
    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    const deleted = await query(
      `delete from unit_residents ur
       using units u
       where ur.id = $1 and ur.unit_id = u.id and u.condo_id = $2
       returning ur.id`,
      [id, condoId],
    );
    if (deleted.rows.length === 0) {
      return res.status(404).json({ message: 'Morador nao encontrado.' });
    }
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

app.post('/api/my-unit/vehicles', async (req, res, next) => {
  try {
    const condoId = parsePositive((req.body as { condoId?: unknown }).condoId) ?? 1;
    const unitId = parsePositive((req.body as { unitId?: unknown }).unitId);
    const model = String((req.body as { model?: unknown }).model ?? '').trim();
    const plate = String((req.body as { plate?: unknown }).plate ?? '').trim();
    const parkingSpot = String((req.body as { parkingSpot?: unknown }).parkingSpot ?? '').trim();
    const color = String((req.body as { color?: unknown }).color ?? '').trim();
    if (unitId == null || !model || !plate) {
      return res.status(400).json({ message: 'unitId, model e plate sao obrigatorios.' });
    }
    const resolvedUnitId = await resolveMyUnit(condoId, unitId);
    if (resolvedUnitId == null) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }
    const inserted = await query(
      `insert into unit_vehicles (unit_id, model, plate, parking_spot, color)
       values ($1, $2, $3, $4, $5)
       returning id, unit_id, model, plate, parking_spot, color, created_at, updated_at`,
      [resolvedUnitId, model, plate, parkingSpot || null, color || null],
    );
    return res.status(201).json(inserted.rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/my-unit/vehicles/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parsePositive((req.body as { condoId?: unknown }).condoId) ?? 1;
    const model = String((req.body as { model?: unknown }).model ?? '').trim();
    const plate = String((req.body as { plate?: unknown }).plate ?? '').trim();
    const parkingSpot = String((req.body as { parkingSpot?: unknown }).parkingSpot ?? '').trim();
    const color = String((req.body as { color?: unknown }).color ?? '').trim();
    if (id == null || !model || !plate) {
      return res.status(400).json({ message: 'Dados de veiculo invalidos.' });
    }
    const updated = await query(
      `update unit_vehicles uv
       set model = $1, plate = $2, parking_spot = $3, color = $4, updated_at = now()
       from units u
       where uv.id = $5 and uv.unit_id = u.id and u.condo_id = $6
       returning uv.id, uv.unit_id, uv.model, uv.plate, uv.parking_spot, uv.color, uv.created_at, uv.updated_at`,
      [model, plate, parkingSpot || null, color || null, id, condoId],
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ message: 'Veiculo nao encontrado.' });
    }
    return res.json(updated.rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/my-unit/vehicles/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parsePositive(req.query.condoId) ?? 1;
    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    const deleted = await query(
      `delete from unit_vehicles uv
       using units u
       where uv.id = $1 and uv.unit_id = u.id and u.condo_id = $2
       returning uv.id`,
      [id, condoId],
    );
    if (deleted.rows.length === 0) {
      return res.status(404).json({ message: 'Veiculo nao encontrado.' });
    }
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

app.post('/api/my-unit/pets', async (req, res, next) => {
  try {
    const condoId = parsePositive((req.body as { condoId?: unknown }).condoId) ?? 1;
    const unitId = parsePositive((req.body as { unitId?: unknown }).unitId);
    const name = String((req.body as { name?: unknown }).name ?? '').trim();
    const species = String((req.body as { species?: unknown }).species ?? '').trim();
    const breed = String((req.body as { breed?: unknown }).breed ?? '').trim();
    const color = String((req.body as { color?: unknown }).color ?? '').trim();
    if (unitId == null || !name || !species) {
      return res.status(400).json({ message: 'unitId, name e species sao obrigatorios.' });
    }
    const resolvedUnitId = await resolveMyUnit(condoId, unitId);
    if (resolvedUnitId == null) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }
    const inserted = await query(
      `insert into unit_pets (unit_id, name, species, breed, color)
       values ($1, $2, $3, $4, $5)
       returning id, unit_id, name, species, breed, color, photo_url, notes, created_at, updated_at`,
      [resolvedUnitId, name, species, breed || null, color || null],
    );
    return res.status(201).json(inserted.rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/my-unit/pets/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parsePositive((req.body as { condoId?: unknown }).condoId) ?? 1;
    const name = String((req.body as { name?: unknown }).name ?? '').trim();
    const species = String((req.body as { species?: unknown }).species ?? '').trim();
    const breed = String((req.body as { breed?: unknown }).breed ?? '').trim();
    const color = String((req.body as { color?: unknown }).color ?? '').trim();
    if (id == null || !name || !species) {
      return res.status(400).json({ message: 'Dados de pet invalidos.' });
    }
    const updated = await query(
      `update unit_pets up
       set name = $1, species = $2, breed = $3, color = $4, updated_at = now()
       from units u
       where up.id = $5 and up.unit_id = u.id and u.condo_id = $6
       returning up.id, up.unit_id, up.name, up.species, up.breed, up.color, up.photo_url, up.notes, up.created_at, up.updated_at`,
      [name, species, breed || null, color || null, id, condoId],
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ message: 'Pet nao encontrado.' });
    }
    return res.json(updated.rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/my-unit/pets/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parsePositive(req.query.condoId) ?? 1;
    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    const deleted = await query(
      `delete from unit_pets up
       using units u
       where up.id = $1 and up.unit_id = u.id and u.condo_id = $2
       returning up.id`,
      [id, condoId],
    );
    if (deleted.rows.length === 0) {
      return res.status(404).json({ message: 'Pet nao encontrado.' });
    }
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

app.use((_req, res) => {
  res.status(404).json({
    message: 'Rota nao encontrada.',
  });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error(error);

  res.status(500).json({
    message: 'Erro interno no servidor.',
    details: error instanceof Error ? error.message : String(error),
  });
};

app.use(errorHandler);

export default app;

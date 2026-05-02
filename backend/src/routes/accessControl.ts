import { randomUUID } from 'node:crypto';

import { Router } from 'express';

import { isOperationalStaff } from '../authz';
import { query } from '../db';

const router = Router();

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

function generateNumericPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

type AppUserRow = {
  id: number;
  condo_id: number;
  role: string;
  active: boolean;
  unit_id: number | null;
};

async function loadUser(userId: number): Promise<AppUserRow | null> {
  const r = await query(
    `select id, condo_id, role, active, unit_id from app_users where id = $1 limit 1`,
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

function canManageAccess(user: AppUserRow, condoId: number): boolean {
  return (
    canAccessCondo(user, condoId) && isOperationalStaff(user.role)
  );
}

async function expireStalePasses(condoId: number): Promise<void> {
  await query(
    `update condo_access_visitor_passes
     set status = 'expired', updated_at = now()
     where condo_id = $1
       and status = 'pending'
       and valid_until < now()`,
    [condoId],
  );
}

router.get('/stats', async (req, res, next) => {
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
    if (!canAccessCondo(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    await expireStalePasses(condoId);

    const unitFilterVp =
      user.role === 'resident' && user.unit_id != null
        ? 'and vp.unit_id = $2'
        : '';
    const unitFilterParamsVp =
      user.role === 'resident' && user.unit_id != null ? [condoId, user.unit_id] : [condoId];

    const visitorsExpected = await query(
      `select count(*)::int as c
       from condo_access_visitor_passes vp
       where vp.condo_id = $1
         and vp.status = 'pending'
         and vp.valid_until >= now()
         ${unitFilterVp}`,
      unitFilterParamsVp,
    );

    const visitorsInside = await query(
      `select count(*)::int as c
       from condo_access_visitor_passes vp
       where vp.condo_id = $1
         and vp.status = 'inside'
         ${unitFilterVp}`,
      unitFilterParamsVp,
    );

    const providersActive = await query(
      `select count(*)::int as c
       from condo_access_service_providers sp
       where sp.condo_id = $1 and sp.active = true`,
      [condoId],
    );

    const evFilter =
      user.role === 'resident' && user.unit_id != null ? 'and e.unit_id = $2' : '';
    const evParams =
      user.role === 'resident' && user.unit_id != null
        ? [condoId, user.unit_id]
        : [condoId];

    const entriesToday = await query(
      `select count(*)::int as c
       from condo_access_events e
       where e.condo_id = $1
         and e.direction = 'in'
         and e.recorded_at::date = (now() at time zone 'utc')::date
         ${evFilter}`,
      evParams,
    );

    return res.json({
      visitorsExpected: (visitorsExpected.rows[0] as { c: number }).c,
      visitorsInside: (visitorsInside.rows[0] as { c: number }).c,
      providersActive: (providersActive.rows[0] as { c: number }).c,
      entriesToday: (entriesToday.rows[0] as { c: number }).c,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/visitor-passes', async (req, res, next) => {
  try {
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    const statusFilter = String(req.query.status ?? '').trim();
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

    await expireStalePasses(condoId);

    let sql = `select vp.id,
                      vp.condo_id,
                      vp.unit_id,
                      vp.visitor_full_name,
                      vp.visitor_phone,
                      vp.document_id,
                      vp.valid_from,
                      vp.valid_until,
                      vp.status,
                      vp.pin_code,
                      vp.qr_token,
                      vp.notes,
                      vp.created_by_user_id,
                      vp.created_at,
                      vp.updated_at,
                      u.tower,
                      u.number
               from condo_access_visitor_passes vp
               join units u on u.id = vp.unit_id
               where vp.condo_id = $1`;
    const params: unknown[] = [condoId];
    let p = 2;

    if (user.role === 'resident' && user.unit_id != null) {
      sql += ` and vp.unit_id = $${p++}`;
      params.push(user.unit_id);
    }

    if (statusFilter && statusFilter !== 'all') {
      sql += ` and vp.status = $${p++}`;
      params.push(statusFilter);
    }

    sql += ` order by vp.valid_until desc, vp.id desc`;

    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/visitor-passes', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);
    const unitId = parsePositive(body.unitId ?? body.unit_id);
    const visitorFullName = String(
      body.visitorFullName ?? body.visitor_full_name ?? '',
    ).trim();
    const visitorPhone = String(body.visitorPhone ?? body.visitor_phone ?? '').trim() || null;
    const documentId = String(body.documentId ?? body.document_id ?? '').trim() || null;
    const notes = String(body.notes ?? '').trim() || null;
    const fromRaw = body.validFrom ?? body.valid_from;
    const untilRaw = body.validUntil ?? body.valid_until;

    if (!Number.isFinite(condoId) || condoId < 1 || userId == null || unitId == null) {
      return res.status(400).json({ message: 'condoId, userId e unitId sao obrigatorios.' });
    }
    if (!visitorFullName) {
      return res.status(400).json({ message: 'visitorFullName e obrigatorio.' });
    }
    if (fromRaw == null || untilRaw == null) {
      return res.status(400).json({ message: 'validFrom e validUntil sao obrigatorios.' });
    }
    const validFrom = new Date(String(fromRaw));
    const validUntil = new Date(String(untilRaw));
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime())) {
      return res.status(400).json({ message: 'Datas invalidas.' });
    }
    if (validUntil <= validFrom) {
      return res.status(400).json({ message: 'validUntil deve ser apos validFrom.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canAccessCondo(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    if (user.role === 'resident') {
      if (user.unit_id !== unitId) {
        return res.status(403).json({
          message: 'Morador so pode cadastrar visitante para a propria unidade.',
        });
      }
    } else if (!canManageAccess(user, condoId)) {
      return res.status(403).json({
        message: 'Sem permissao para cadastrar visitante.',
      });
    }

    const unitOk = await query(
      `select id from units where id = $1 and condo_id = $2`,
      [unitId, condoId],
    );
    if (unitOk.rows.length === 0) {
      return res.status(404).json({ message: 'Unidade nao encontrada neste condominio.' });
    }

    const pinCode = generateNumericPin();
    const qrToken = randomUUID();

    const ins = await query(
      `insert into condo_access_visitor_passes (
         condo_id, unit_id, visitor_full_name, visitor_phone, document_id,
         valid_from, valid_until, status, pin_code, qr_token, notes, created_by_user_id
       )
       values ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9::uuid, $10, $11)
       returning id,
                 condo_id,
                 unit_id,
                 visitor_full_name,
                 visitor_phone,
                 document_id,
                 valid_from,
                 valid_until,
                 status,
                 pin_code,
                 qr_token,
                 notes,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [
        condoId,
        unitId,
        visitorFullName,
        visitorPhone,
        documentId,
        validFrom,
        validUntil,
        pinCode,
        qrToken,
        notes,
        userId,
      ],
    );

    const row = ins.rows[0] as Record<string, unknown>;
    const u = await query(`select tower, number from units where id = $1`, [unitId]);
    return res.status(201).json({
      ...row,
      tower: (u.rows[0] as { tower: string }).tower,
      number: (u.rows[0] as { number: string }).number,
    });
  } catch (err) {
    return next(err);
  }
});

router.patch('/visitor-passes/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const body = req.body || {};
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);
    const statusNext = String(body.status ?? '').trim().toLowerCase();

    if (id == null || !Number.isFinite(condoId) || condoId < 1 || userId == null) {
      return res.status(400).json({ message: 'Dados invalidos.' });
    }
    if (!['revoked', 'expired'].includes(statusNext)) {
      return res.status(400).json({ message: 'status deve ser revoked ou expired.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageAccess(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem alterar liberacoes.',
      });
    }

    const r = await query(
      `update condo_access_visitor_passes
       set status = $2, updated_at = now()
       where id = $1 and condo_id = $3
         and status not in ('completed', 'revoked')
       returning *`,
      [id, statusNext, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Passe nao encontrado ou ja finalizado.' });
    }
    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

async function recordVisitorEvent(
  passId: number,
  condoId: number,
  direction: 'in' | 'out',
  method: string,
  userId: number | null,
  notes: string | null,
): Promise<void> {
  const p = await query(
    `select vp.unit_id, vp.visitor_full_name, vp.status, vp.valid_from, vp.valid_until
     from condo_access_visitor_passes vp
     where vp.id = $1 and vp.condo_id = $2`,
    [passId, condoId],
  );
  if (p.rows.length === 0) {
    throw new Error('NOT_FOUND');
  }
  const row = p.rows[0] as {
    unit_id: number;
    visitor_full_name: string;
    status: string;
    valid_from: Date;
    valid_until: Date;
  };
  const now = new Date();
  if (now < new Date(row.valid_from) || now > new Date(row.valid_until)) {
    throw new Error('OUTSIDE_WINDOW');
  }

  if (direction === 'in') {
    if (row.status !== 'pending') {
      throw new Error('BAD_STATE_IN');
    }
    await query(
      `update condo_access_visitor_passes
       set status = 'inside', updated_at = now()
       where id = $1`,
      [passId],
    );
  } else {
    if (row.status !== 'inside') {
      throw new Error('BAD_STATE_OUT');
    }
    await query(
      `update condo_access_visitor_passes
       set status = 'completed', updated_at = now()
       where id = $1`,
      [passId],
    );
  }

  await query(
    `insert into condo_access_events (
       condo_id, unit_id, visitor_pass_id, direction, method, subject_name,
       recorded_by_user_id, notes
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      condoId,
      row.unit_id,
      passId,
      direction,
      method,
      row.visitor_full_name,
      userId,
      notes,
    ],
  );
}

router.post('/visitor-passes/:id/check-in', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const body = req.body || {};
    const m = String(body.method ?? 'manual').trim().toLowerCase();
    const method = ['qr', 'pin', 'manual', 'rfid'].includes(m) ? m : 'manual';
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);
    const notes = String(body.notes ?? '').trim() || null;

    if (id == null || !Number.isFinite(condoId) || condoId < 1 || userId == null) {
      return res.status(400).json({ message: 'Dados invalidos.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageAccess(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas portaria/sindico/admin podem registrar entrada.',
      });
    }

    try {
      await recordVisitorEvent(id, condoId, 'in', method, userId, notes);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'NOT_FOUND') {
        return res.status(404).json({ message: 'Passe nao encontrado.' });
      }
      if (msg === 'OUTSIDE_WINDOW') {
        return res.status(409).json({ message: 'Fora da janela de validade.' });
      }
      if (msg === 'BAD_STATE_IN') {
        return res.status(409).json({ message: 'Passe nao esta pendente de entrada.' });
      }
      throw e;
    }
    return res.status(201).json({ message: 'Entrada registrada.', passId: id });
  } catch (err) {
    return next(err);
  }
});

router.post('/visitor-passes/:id/check-out', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const body = req.body || {};
    const m = String(body.method ?? 'manual').trim().toLowerCase();
    const method = ['qr', 'pin', 'manual', 'rfid'].includes(m) ? m : 'manual';
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);
    const notes = String(body.notes ?? '').trim() || null;

    if (id == null || !Number.isFinite(condoId) || condoId < 1 || userId == null) {
      return res.status(400).json({ message: 'Dados invalidos.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageAccess(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas portaria/sindico/admin podem registrar saida.',
      });
    }

    try {
      await recordVisitorEvent(id, condoId, 'out', method, userId, notes);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'NOT_FOUND') {
        return res.status(404).json({ message: 'Passe nao encontrado.' });
      }
      if (msg === 'OUTSIDE_WINDOW') {
        return res.status(409).json({ message: 'Fora da janela de validade.' });
      }
      if (msg === 'BAD_STATE_OUT') {
        return res.status(409).json({ message: 'Visitante nao consta dentro do condominio.' });
      }
      throw e;
    }
    return res.status(201).json({ message: 'Saida registrada.', passId: id });
  } catch (err) {
    return next(err);
  }
});

router.post('/validate', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);
    const pinCode = String(body.pinCode ?? body.pin_code ?? '').trim();
    const qrToken = String(body.qrToken ?? body.qr_token ?? '').trim();

    if (!Number.isFinite(condoId) || condoId < 1 || userId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    if (!pinCode && !qrToken) {
      return res.status(400).json({ message: 'Informe pinCode ou qrToken.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageAccess(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao para validar acesso.' });
    }

    await expireStalePasses(condoId);

    const r = qrToken
      ? await query(
          `select vp.*, u.tower, u.number
           from condo_access_visitor_passes vp
           join units u on u.id = vp.unit_id
           where vp.condo_id = $1 and vp.qr_token = $2::uuid`,
          [condoId, qrToken],
        )
      : await query(
          `select vp.*, u.tower, u.number
           from condo_access_visitor_passes vp
           join units u on u.id = vp.unit_id
           where vp.condo_id = $1 and vp.pin_code = $2`,
          [condoId, pinCode],
        );

    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Passe nao encontrado.' });
    }

    const pass = r.rows[0] as Record<string, unknown>;
    const now = new Date();
    const vf = new Date(pass.valid_from as string);
    const vu = new Date(pass.valid_until as string);
    if (now < vf || now > vu) {
      return res.status(409).json({
        message: 'Passe fora da validade.',
        pass,
      });
    }
    if (pass.status === 'revoked' || pass.status === 'expired') {
      return res.status(409).json({ message: 'Passe invalido.', pass });
    }

    const st = String(pass.status);
    return res.json({
      ok: true,
      pass,
      hint:
        st === 'pending'
          ? 'Pode registrar entrada (POST /visitor-passes/:id/check-in).'
          : st === 'inside'
            ? 'Visitante no condominio — use check-out ao sair.'
            : 'Passe ja utilizado ou encerrado.',
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/service-providers', async (req, res, next) => {
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
    if (!canAccessCondo(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    const r = await query(
      `select id, condo_id, company_name, notes,
              access_window_start, access_window_end, active,
              created_by_user_id, created_at, updated_at
       from condo_access_service_providers
       where condo_id = $1
       order by company_name asc`,
      [condoId],
    );
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/service-providers', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);
    const companyName = String(body.companyName ?? body.company_name ?? '').trim();
    const notes = String(body.notes ?? '').trim() || null;
    const active = body.active !== false;

    if (!Number.isFinite(condoId) || condoId < 1 || userId == null || !companyName) {
      return res.status(400).json({ message: 'condoId, userId e companyName sao obrigatorios.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageAccess(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao.' });
    }

    let ws: string | null = null;
    let we: string | null = null;
    if (body.accessWindowStart != null && String(body.accessWindowStart).trim() !== '') {
      ws = String(body.accessWindowStart);
    }
    if (body.accessWindowEnd != null && String(body.accessWindowEnd).trim() !== '') {
      we = String(body.accessWindowEnd);
    }

    const ins = await query(
      `insert into condo_access_service_providers (
         condo_id, company_name, notes, access_window_start, access_window_end,
         active, created_by_user_id
       )
       values ($1, $2, $3, $4::time, $5::time, $6, $7)
       returning *`,
      [condoId, companyName, notes, ws, we, active, userId],
    );
    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/service-providers/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const body = req.body || {};
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);

    if (id == null || !Number.isFinite(condoId) || condoId < 1 || userId == null) {
      return res.status(400).json({ message: 'Dados invalidos.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageAccess(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao.' });
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (body.companyName !== undefined || body.company_name !== undefined) {
      const n = String(body.companyName ?? body.company_name ?? '').trim();
      if (!n) {
        return res.status(400).json({ message: 'companyName invalido.' });
      }
      fields.push(`company_name = $${idx++}`);
      params.push(n);
    }
    if (body.notes !== undefined) {
      fields.push(`notes = $${idx++}`);
      params.push(String(body.notes ?? '').trim() || null);
    }
    if (body.active !== undefined) {
      fields.push(`active = $${idx++}`);
      params.push(Boolean(body.active));
    }
    if (body.accessWindowStart !== undefined || body.access_window_start !== undefined) {
      const raw = body.accessWindowStart ?? body.access_window_start;
      fields.push(`access_window_start = $${idx++}::time`);
      params.push(raw == null || String(raw).trim() === '' ? null : String(raw));
    }
    if (body.accessWindowEnd !== undefined || body.access_window_end !== undefined) {
      const raw = body.accessWindowEnd ?? body.access_window_end;
      fields.push(`access_window_end = $${idx++}::time`);
      params.push(raw == null || String(raw).trim() === '' ? null : String(raw));
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'Nada para atualizar.' });
    }

    fields.push('updated_at = now()');
    params.push(id, condoId);

    const r = await query(
      `update condo_access_service_providers
       set ${fields.join(', ')}
       where id = $${idx++} and condo_id = $${idx}
       returning *`,
      params,
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Prestador nao encontrado.' });
    }
    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.get('/events', async (req, res, next) => {
  try {
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    const limit = Math.min(parsePositive(req.query.limit) ?? 80, 200);
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

    let sql = `select e.id,
                      e.condo_id,
                      e.unit_id,
                      e.visitor_pass_id,
                      e.service_provider_id,
                      e.direction,
                      e.method,
                      e.subject_name,
                      e.recorded_at,
                      e.recorded_by_user_id,
                      e.notes,
                      u.tower,
                      u.number
               from condo_access_events e
               left join units u on u.id = e.unit_id
               where e.condo_id = $1`;
    const params: unknown[] = [condoId];
    let p = 2;

    if (user.role === 'resident' && user.unit_id != null) {
      sql += ` and e.unit_id = $${p++}`;
      params.push(user.unit_id);
    }

    sql += ` order by e.recorded_at desc limit $${p}`;
    params.push(limit);

    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/events', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);
    const direction = String(body.direction ?? '').trim().toLowerCase();
    const methodRaw = String(body.method ?? 'manual').trim().toLowerCase();
    const method = ['qr', 'pin', 'manual', 'rfid'].includes(methodRaw) ? methodRaw : 'manual';
    const subjectName = String(body.subjectName ?? body.subject_name ?? '').trim();
    const unitId = parsePositive(body.unitId ?? body.unit_id);
    const serviceProviderId = parsePositive(
      body.serviceProviderId ?? body.service_provider_id,
    );
    const notes = String(body.notes ?? '').trim() || null;

    if (!Number.isFinite(condoId) || condoId < 1 || userId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    if (!['in', 'out'].includes(direction)) {
      return res.status(400).json({ message: 'direction deve ser in ou out.' });
    }
    if (!subjectName) {
      return res.status(400).json({ message: 'subjectName e obrigatorio.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageAccess(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao para registrar evento.' });
    }

    if (unitId != null) {
      const u = await query(
        `select id from units where id = $1 and condo_id = $2`,
        [unitId, condoId],
      );
      if (u.rows.length === 0) {
        return res.status(400).json({ message: 'unitId invalido.' });
      }
    }

    if (serviceProviderId != null) {
      const sp = await query(
        `select id from condo_access_service_providers
         where id = $1 and condo_id = $2`,
        [serviceProviderId, condoId],
      );
      if (sp.rows.length === 0) {
        return res.status(400).json({ message: 'serviceProviderId invalido.' });
      }
    }

    const ins = await query(
      `insert into condo_access_events (
         condo_id, unit_id, visitor_pass_id, service_provider_id,
         direction, method, subject_name, recorded_by_user_id, notes
       )
       values ($1, $2, null, $3, $4, $5, $6, $7, $8)
       returning *`,
      [
        condoId,
        unitId,
        serviceProviderId,
        direction,
        method,
        subjectName,
        userId,
        notes,
      ],
    );
    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

export default router;

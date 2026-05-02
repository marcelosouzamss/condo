import { Router } from 'express';

import { isBillingStaff } from '../authz';
import { query } from '../db';

const router = Router();

export const EMERGENCY_INCIDENT_KINDS = [
  'incendio',
  'invasao',
  'briga',
  'agressao_mulher',
  'maus_tratos_animais',
  'maus_tratos_idosos',
  'maus_tratos_criancas',
  'outro',
] as const;

export type EmergencyIncidentKind = (typeof EMERGENCY_INCIDENT_KINDS)[number];

function parsePositive(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parseCondoId(raw: unknown): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return 1;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : 1;
}

function parseIncidentKind(raw: unknown): EmergencyIncidentKind | null {
  const s = String(raw ?? '').trim();
  if (EMERGENCY_INCIDENT_KINDS.includes(s as EmergencyIncidentKind)) {
    return s as EmergencyIncidentKind;
  }
  return null;
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

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }
    if (user.condo_id !== condoId) {
      return res.status(403).json({ message: 'Condominio invalido.' });
    }

    let sql = `select e.id,
                      e.condo_id,
                      e.unit_id,
                      e.reporter_user_id,
                      e.incident_kind,
                      e.description,
                      e.status,
                      e.created_at,
                      e.updated_at,
                      u.full_name as reporter_name,
                      un.tower as unit_tower,
                      un.number as unit_number
               from condo_emergency_incidents e
               join app_users u on u.id = e.reporter_user_id
               left join units un on un.id = e.unit_id
               where e.condo_id = $1`;
    const params: unknown[] = [condoId];

    if (!isBillingStaff(user.role)) {
      if (user.role !== 'resident') {
        return res.status(403).json({
          message: 'Somente moradores ou equipe podem consultar ocorrências.',
        });
      }
      sql += ` and (
        e.reporter_user_id = $2
        or ($3::integer is not null and e.unit_id = $3)
      )`;
      params.push(userId, user.unit_id);
    }

    sql += ` order by e.created_at desc limit 200`;

    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId);
    const userId = parsePositive(body.userId);
    const incidentKind = parseIncidentKind(body.incidentKind);
    const description = String(body.description ?? '').trim() || null;
    const unitIdBody = parsePositive(body.unitId);

    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (incidentKind == null) {
      return res.status(400).json({ message: 'incidentKind invalido.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }
    if (user.condo_id !== condoId) {
      return res.status(403).json({ message: 'Condominio invalido.' });
    }
    if (user.role !== 'resident') {
      return res.status(403).json({
        message: 'Apenas moradores podem abrir chamado de emergência pelo app.',
      });
    }

    const effectiveUnitId = user.unit_id ?? unitIdBody;
    if (effectiveUnitId == null) {
      return res.status(400).json({
        message: 'Informe a unidade ou vincule-se a uma unidade no cadastro.',
      });
    }

    const ucheck = await query(
      `select id from units where id = $1 and condo_id = $2`,
      [effectiveUnitId, condoId],
    );
    if (ucheck.rows.length === 0) {
      return res.status(400).json({ message: 'Unidade invalida.' });
    }
    if (user.unit_id != null && effectiveUnitId !== user.unit_id) {
      return res.status(403).json({
        message: 'Unidade diferente da vinculada ao seu usuario.',
      });
    }

    const ins = await query(
      `insert into condo_emergency_incidents (
         condo_id, unit_id, reporter_user_id, incident_kind, description
       )
       values ($1, $2, $3, $4, $5)
       returning id,
                 condo_id,
                 unit_id,
                 reporter_user_id,
                 incident_kind,
                 description,
                 status,
                 created_at,
                 updated_at`,
      [condoId, effectiveUnitId, userId, incidentKind, description],
    );

    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const body = req.body || {};
    const userId = parsePositive(body.userId);
    const status = String(body.status ?? '').trim();

    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (!['open', 'acknowledged', 'closed'].includes(status)) {
      return res.status(400).json({
        message: 'status deve ser open, acknowledged ou closed.',
      });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }
    if (!isBillingStaff(user.role)) {
      return res.status(403).json({
        message: 'Somente síndico ou administração pode atualizar status.',
      });
    }

    const cur = await query(
      `select id, condo_id from condo_emergency_incidents where id = $1`,
      [id],
    );
    if (cur.rows.length === 0) {
      return res.status(404).json({ message: 'Ocorrencia nao encontrada.' });
    }
    const row = cur.rows[0] as { condo_id: number };
    if (row.condo_id !== user.condo_id) {
      return res.status(403).json({ message: 'Outro condominio.' });
    }

    const r = await query(
      `update condo_emergency_incidents
       set status = $2, updated_at = now()
       where id = $1
       returning id,
                 condo_id,
                 unit_id,
                 reporter_user_id,
                 incident_kind,
                 description,
                 status,
                 created_at,
                 updated_at`,
      [id, status],
    );

    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

export default router;

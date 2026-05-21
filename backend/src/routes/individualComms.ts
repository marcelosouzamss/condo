import { Router } from 'express';

import { query } from '../db';

const router = Router();

function parseCondoId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return 1;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parseUnitId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

const STAFF_ROLES = ['syndic', 'administrator', 'collaborator', 'doorman'] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

function parseStaffRole(raw: unknown): StaffRole | null {
  const s = String(raw ?? '').trim();
  if (s === 'syndic' || s === 'administrator' || s === 'collaborator' || s === 'doorman') {
    return s;
  }
  return null;
}

async function assertUnitInCondo(
  condoId: number,
  unitId: number,
): Promise<boolean> {
  const r = await query(
    `select 1 from units where id = $1 and condo_id = $2`,
    [unitId, condoId],
  );
  return r.rows.length > 0;
}

function rowToOutgoing(row: Record<string, unknown>) {
  return {
    id: row.id,
    condo_id: row.condo_id,
    to_unit_id: row.to_unit_id,
    to_tower: row.to_tower,
    to_number: row.to_number,
    from_unit_id: row.from_unit_id,
    from_tower: row.from_tower,
    from_number: row.from_number,
    from_staff_role: row.from_staff_role,
    subject: row.subject,
    body: row.body,
    read_at: row.read_at,
    created_at: row.created_at,
  };
}

/** Envia comunicado: morador (fromUnitId) ou equipe (fromStaffRole). */
router.post('/', async (req, res, next) => {
  try {
    const condoId = parseCondoId((req.body || {}).condoId);
    const toUnitId = parseUnitId((req.body || {}).toUnitId);
    const subject = String((req.body || {}).subject ?? '').trim();
    const body = String((req.body || {}).body ?? '').trim();
    const fromUnitId = parseUnitId((req.body || {}).fromUnitId);
    const fromStaffRole = parseStaffRole((req.body || {}).fromStaffRole);

    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (toUnitId == null) {
      return res.status(400).json({ message: 'toUnitId e obrigatorio.' });
    }
    if (!subject || !body) {
      return res.status(400).json({ message: 'subject e body sao obrigatorios.' });
    }

    const hasResident = fromUnitId != null;
    const hasStaff = fromStaffRole != null;
    if (hasResident === hasStaff) {
      return res.status(400).json({
        message:
          'Informe fromUnitId (morador) OU fromStaffRole (syndic, administrator, collaborator ou doorman), nao ambos.',
      });
    }

    if (!(await assertUnitInCondo(condoId, toUnitId))) {
      return res.status(404).json({ message: 'Unidade destino nao encontrada.' });
    }

    if (hasResident) {
      if (!(await assertUnitInCondo(condoId, fromUnitId!))) {
        return res.status(404).json({ message: 'Unidade remetente nao encontrada.' });
      }
      if (fromUnitId === toUnitId) {
        return res.status(400).json({
          message: 'Nao e possivel enviar comunicado para a propria unidade.',
        });
      }
    }

    const ins = await query(
      `insert into individual_communications (
         condo_id, to_unit_id, from_unit_id, from_staff_role, subject, body
       )
       values ($1, $2, $3, $4, $5, $6)
       returning id, condo_id, to_unit_id, from_unit_id, from_staff_role,
                 subject, body, read_at, created_at`,
      [
        condoId,
        toUnitId,
        hasResident ? fromUnitId : null,
        hasStaff ? fromStaffRole : null,
        subject,
        body,
      ],
    );

    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

/** Caixa de entrada da unidade (recebidos). */
router.get('/inbox', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const unitId = parseUnitId(req.query.unitId);
    if (condoId == null || unitId == null) {
      return res.status(400).json({ message: 'condoId e unitId sao obrigatorios.' });
    }
    if (!(await assertUnitInCondo(condoId, unitId))) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }

    const r = await query(
      `select c.id,
              c.condo_id,
              c.to_unit_id,
              c.from_unit_id,
              c.from_staff_role,
              c.subject,
              c.body,
              c.read_at,
              c.created_at,
              tu.tower as to_tower,
              tu.number as to_number,
              fu.tower as from_tower,
              fu.number as from_number
       from individual_communications c
       join units tu on tu.id = c.to_unit_id
       left join units fu on fu.id = c.from_unit_id
       where c.condo_id = $1 and c.to_unit_id = $2
       order by c.created_at desc
       limit 200`,
      [condoId, unitId],
    );

    return res.json(r.rows.map(rowToOutgoing));
  } catch (err) {
    return next(err);
  }
});

/** Enviados pelo morador (origem = unidade). */
router.get('/sent-by-unit', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const unitId = parseUnitId(req.query.unitId);
    if (condoId == null || unitId == null) {
      return res.status(400).json({ message: 'condoId e unitId sao obrigatorios.' });
    }
    if (!(await assertUnitInCondo(condoId, unitId))) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }

    const r = await query(
      `select c.id,
              c.condo_id,
              c.to_unit_id,
              c.from_unit_id,
              c.from_staff_role,
              c.subject,
              c.body,
              c.read_at,
              c.created_at,
              tu.tower as to_tower,
              tu.number as to_number,
              fu.tower as from_tower,
              fu.number as from_number
       from individual_communications c
       join units tu on tu.id = c.to_unit_id
       left join units fu on fu.id = c.from_unit_id
       where c.condo_id = $1 and c.from_unit_id = $2
       order by c.created_at desc
       limit 200`,
      [condoId, unitId],
    );

    return res.json(r.rows.map(rowToOutgoing));
  } catch (err) {
    return next(err);
  }
});

/** Histórico enviado pela equipe (síndico ou administradora). */
router.get('/staff-sent', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const role = parseStaffRole(req.query.role);
    if (condoId == null || role == null) {
      return res.status(400).json({
        message:
          'condoId e role (syndic, administrator, collaborator ou doorman) sao obrigatorios.',
      });
    }

    const r = await query(
      `select c.id,
              c.condo_id,
              c.to_unit_id,
              c.from_unit_id,
              c.from_staff_role,
              c.subject,
              c.body,
              c.read_at,
              c.created_at,
              tu.tower as to_tower,
              tu.number as to_number,
              fu.tower as from_tower,
              fu.number as from_number
       from individual_communications c
       join units tu on tu.id = c.to_unit_id
       left join units fu on fu.id = c.from_unit_id
       where c.condo_id = $1 and c.from_staff_role = $2
       order by c.created_at desc
       limit 200`,
      [condoId, role],
    );

    return res.json(r.rows.map(rowToOutgoing));
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const condoId = parseCondoId(req.query.condoId);
    const viewerUnitId = parseUnitId(req.query.viewerUnitId);
    const viewerStaffRole = parseStaffRole(req.query.viewerStaffRole);

    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const hasUnitViewer = viewerUnitId != null;
    const hasStaffViewer = viewerStaffRole != null;
    if (hasUnitViewer === hasStaffViewer) {
      return res.status(400).json({
        message: 'Informe viewerUnitId OU viewerStaffRole.',
      });
    }

    const r = await query(
      `select c.id,
              c.condo_id,
              c.to_unit_id,
              c.from_unit_id,
              c.from_staff_role,
              c.subject,
              c.body,
              c.read_at,
              c.created_at,
              tu.tower as to_tower,
              tu.number as to_number,
              fu.tower as from_tower,
              fu.number as from_number
       from individual_communications c
       join units tu on tu.id = c.to_unit_id
       left join units fu on fu.id = c.from_unit_id
       where c.id = $1 and c.condo_id = $2`,
      [id, condoId],
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Comunicado nao encontrado.' });
    }

    const row = r.rows[0] as Record<string, unknown>;

    if (hasUnitViewer) {
      if (!(await assertUnitInCondo(condoId, viewerUnitId!))) {
        return res.status(404).json({ message: 'Unidade nao encontrada.' });
      }
      const toId = row.to_unit_id as number;
      const fromId = row.from_unit_id as number | null;
      if (viewerUnitId !== toId && viewerUnitId !== fromId) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    } else {
      const msgRole = row.from_staff_role as string | null;
      if (msgRole !== viewerStaffRole) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

    return res.json(rowToOutgoing(row));
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const condoId = parseCondoId((req.body || {}).condoId);
    const unitId = parseUnitId((req.body || {}).unitId);

    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (condoId == null || unitId == null) {
      return res.status(400).json({ message: 'condoId e unitId sao obrigatorios.' });
    }

    const upd = await query(
      `update individual_communications c
       set read_at = coalesce(c.read_at, now())
       where c.id = $1 and c.condo_id = $2 and c.to_unit_id = $3
       returning c.id, c.read_at`,
      [id, condoId, unitId],
    );

    if (upd.rows.length === 0) {
      return res.status(404).json({ message: 'Comunicado nao encontrado ou nao destinado a esta unidade.' });
    }

    return res.json(upd.rows[0]);
  } catch (err) {
    return next(err);
  }
});

export default router;

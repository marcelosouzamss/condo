import { Router } from 'express';

import { isBillingStaff } from '../authz';
import { query } from '../db';

const router = Router();

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
    const unitIdQ = parsePositive(req.query.unitId);

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

    let sql = `select p.id,
                      p.condo_id,
                      p.unit_id,
                      p.registered_by_user_id,
                      p.carrier_hint,
                      p.recipient_label,
                      p.notes,
                      p.status,
                      p.picked_up_at,
                      p.picked_up_by_user_id,
                      p.created_at,
                      p.updated_at,
                      u.tower as unit_tower,
                      u.number as unit_number,
                      reg.full_name as registered_by_name,
                      pu.full_name as picked_up_by_name
               from condo_parcel_deliveries p
               join units u on u.id = p.unit_id
               join app_users reg on reg.id = p.registered_by_user_id
               left join app_users pu on pu.id = p.picked_up_by_user_id
               where p.condo_id = $1`;
    const params: unknown[] = [condoId];

    if (isBillingStaff(user.role)) {
      const onlyPending = req.query.onlyPending === 'true';
      if (onlyPending) {
        sql += ` and p.status = 'awaiting_pickup'`;
      }
      const uf = parsePositive(req.query.filterUnitId);
      if (uf != null) {
        sql += ` and p.unit_id = $${params.length + 1}`;
        params.push(uf);
      }
    } else {
      if (user.role !== 'resident') {
        return res.status(403).json({
          message: 'Acesso restrito a moradores ou equipe.',
        });
      }
      const uid = user.unit_id ?? unitIdQ;
      if (uid == null) {
        return res.status(400).json({
          message: 'Morador sem unidade; informe unitId ou complete o cadastro.',
        });
      }
      if (user.unit_id != null && unitIdQ != null && unitIdQ !== user.unit_id) {
        return res.status(403).json({ message: 'Unidade nao permitida.' });
      }
      sql += ` and p.unit_id = $2`;
      params.push(uid);
    }

    sql += ` order by p.created_at desc limit 300`;

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
    const unitId = parsePositive(body.unitId);

    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (unitId == null) {
      return res.status(400).json({ message: 'unitId e obrigatorio.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }
    if (!isBillingStaff(user.role)) {
      return res.status(403).json({
        message: 'Somente síndico ou administração registra encomendas.',
      });
    }
    if (user.condo_id !== condoId) {
      return res.status(403).json({ message: 'Condominio invalido.' });
    }

    const ucheck = await query(
      `select id from units where id = $1 and condo_id = $2`,
      [unitId, condoId],
    );
    if (ucheck.rows.length === 0) {
      return res.status(400).json({ message: 'Unidade invalida.' });
    }

    const carrierHint = String(body.carrierHint ?? '').trim().slice(0, 120) || null;
    const recipientLabel =
      String(body.recipientLabel ?? '').trim().slice(0, 200) || null;
    const notes = String(body.notes ?? '').trim() || null;

    const ins = await query(
      `insert into condo_parcel_deliveries (
         condo_id,
         unit_id,
         registered_by_user_id,
         carrier_hint,
         recipient_label,
         notes
       )
       values ($1, $2, $3, $4, $5, $6)
       returning id,
                 condo_id,
                 unit_id,
                 registered_by_user_id,
                 carrier_hint,
                 recipient_label,
                 notes,
                 status,
                 picked_up_at,
                 picked_up_by_user_id,
                 created_at,
                 updated_at`,
      [condoId, unitId, userId, carrierHint, recipientLabel, notes],
    );

    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id/pickup', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const body = req.body || {};
    const userId = parsePositive(body.userId);
    const claimUnitId = parsePositive(body.unitId);

    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }
    if (user.role !== 'resident') {
      return res.status(403).json({
        message: 'Somente moradores confirmam retirada na portaria.',
      });
    }

    const claimUnit = user.unit_id ?? claimUnitId;
    if (claimUnit == null) {
      return res.status(400).json({
        message: 'Informe a unidade ou complete seu vínculo no cadastro.',
      });
    }
    if (user.unit_id != null && claimUnitId != null && claimUnitId !== user.unit_id) {
      return res.status(403).json({ message: 'Unidade inconsistente.' });
    }

    const cur = await query(
      `select id, condo_id, unit_id, status from condo_parcel_deliveries where id = $1`,
      [id],
    );
    if (cur.rows.length === 0) {
      return res.status(404).json({ message: 'Encomenda nao encontrada.' });
    }
    const row = cur.rows[0] as {
      condo_id: number;
      unit_id: number;
      status: string;
    };
    if (row.condo_id !== user.condo_id) {
      return res.status(403).json({ message: 'Outro condominio.' });
    }
    if (row.unit_id !== claimUnit) {
      return res.status(403).json({
        message: 'Esta encomenda e de outra unidade.',
      });
    }
    if (row.status !== 'awaiting_pickup') {
      return res.status(400).json({ message: 'Encomenda ja retirada ou invalida.' });
    }

    const r = await query(
      `update condo_parcel_deliveries
       set status = 'picked_up',
           picked_up_at = now(),
           picked_up_by_user_id = $2,
           updated_at = now()
       where id = $1
       returning id,
                 condo_id,
                 unit_id,
                 status,
                 picked_up_at,
                 picked_up_by_user_id,
                 created_at,
                 updated_at`,
      [id, userId],
    );

    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

export default router;

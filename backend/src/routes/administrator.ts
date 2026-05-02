import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import multer from 'multer';
import { Router } from 'express';

import { isBillingStaff, isOperationalStaff } from '../authz';
import { query } from '../db';

const router = Router();

const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

const loginLogoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const condoId = parseCondoId(req.query.condoId);
      const id = condoId ?? 1;
      const dir = path.join(UPLOADS_ROOT, 'branding', `condo-${id}`);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    cb(null, ok);
  },
});

const RESIDENT_ROLES = ['owner', 'tenant', 'resident', 'other'] as const;
type ResidentRole = (typeof RESIDENT_ROLES)[number];

function parseCondoId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return 1;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parsePositive(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

type HubUserRow = {
  id: number;
  condo_id: number;
  role: string;
  active: boolean;
};

async function loadHubUser(userId: number): Promise<HubUserRow | null> {
  const r = await query(
    `select id, condo_id, role, active from app_users where id = $1`,
    [userId],
  );
  if (r.rows.length === 0) {
    return null;
  }
  return r.rows[0] as HubUserRow;
}

function hubReadAuthorized(user: HubUserRow | null, condoId: number): boolean {
  return (
    user != null &&
    user.active === true &&
    user.condo_id === condoId &&
    isOperationalStaff(user.role)
  );
}

function hubBillingAuthorized(user: HubUserRow | null, condoId: number): boolean {
  return (
    user != null &&
    user.active === true &&
    user.condo_id === condoId &&
    isBillingStaff(user.role)
  );
}

router.get('/units', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const r = await query(
      `select u.id,
              u.condo_id,
              u.tower,
              u.number,
              u.resident_name,
              u.monthly_fee,
              u.reserve_fund_fee,
              u.billing_active,
              u.created_at,
              (select count(*)::int from unit_residents ur where ur.unit_id = u.id)
                as residents_count
       from units u
       where u.condo_id = $1
       order by u.tower asc, u.number asc`,
      [condoId],
    );
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/units/generate', async (req, res, next) => {
  try {
    const condoId = parseCondoId(
      (req.body || {}).condoId as unknown,
    );
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const { blockCount, floorsPerBlock, unitsPerFloor } =
      (req.body || {}) as {
        blockCount?: unknown;
        floorsPerBlock?: unknown;
        unitsPerFloor?: unknown;
      };

    const bc = Number(blockCount);
    const fp = Number(floorsPerBlock);
    const up = Number(unitsPerFloor);

    if (
      !Number.isInteger(bc) ||
      bc < 1 ||
      bc > 80 ||
      !Number.isInteger(fp) ||
      fp < 1 ||
      fp > 80 ||
      !Number.isInteger(up) ||
      up < 1 ||
      up > 40
    ) {
      return res.status(400).json({
        message:
          'blockCount, floorsPerBlock e unitsPerFloor devem ser inteiros positivos (limites: 80 blocos, 80 andares, 40 unidades/andar).',
      });
    }

    const total = bc * fp * up;
    if (total > 5000) {
      return res.status(400).json({
        message: 'Geracao limitada a 5000 unidades por operacao. Reduza os valores.',
      });
    }

    const condo = await query('select id from condos where id = $1', [condoId]);
    if (condo.rows.length === 0) {
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }

    let created = 0;
    let skipped = 0;

    for (let b = 1; b <= bc; b++) {
      const tower = b <= 26 ? String.fromCharCode(64 + b) : `Q${b}`;
      for (let f = 1; f <= fp; f++) {
        for (let u = 1; u <= up; u++) {
          const num = String(f * 100 + u);
          const ins = await query(
            `insert into units (condo_id, tower, number, resident_name)
             values ($1, $2, $3, $4)
             on conflict (condo_id, tower, number) do nothing
             returning id`,
            [condoId, tower, num, '—'],
          );
          if (ins.rowCount && ins.rowCount > 0) {
            created++;
          } else {
            skipped++;
          }
        }
      }
    }

    return res.status(201).json({ created, skipped, total: created + skipped });
  } catch (err) {
    return next(err);
  }
});

router.post('/units', async (req, res, next) => {
  try {
    const condoId = parseCondoId((req.body || {}).condoId as unknown);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const { tower, number, residentName, monthlyFee, reserveFundFee, billingActive } =
      (req.body || {}) as {
        tower?: string;
        number?: string;
        residentName?: string;
        monthlyFee?: unknown;
        reserveFundFee?: unknown;
        billingActive?: unknown;
      };

    const t = tower?.trim();
    const n = number?.trim();
    if (!t || !n) {
      return res.status(400).json({ message: 'tower e number sao obrigatorios.' });
    }

    const rn = residentName?.trim() || '—';

    const mf =
      monthlyFee !== undefined && monthlyFee !== null && String(monthlyFee).trim() !== ''
        ? Number(monthlyFee)
        : 0;
    const rf =
      reserveFundFee !== undefined &&
      reserveFundFee !== null &&
      String(reserveFundFee).trim() !== ''
        ? Number(reserveFundFee)
        : 0;
    if (!Number.isFinite(mf) || mf < 0 || !Number.isFinite(rf) || rf < 0) {
      return res.status(400).json({ message: 'monthlyFee e reserveFundFee devem ser numeros >= 0.' });
    }

    let ba = true;
    if (billingActive !== undefined) {
      ba = Boolean(billingActive);
    }

    const condo = await query('select id from condos where id = $1', [condoId]);
    if (condo.rows.length === 0) {
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }

    const ins = await query(
      `insert into units (condo_id, tower, number, resident_name, monthly_fee, reserve_fund_fee, billing_active)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id,
                 condo_id,
                 tower,
                 number,
                 resident_name,
                 monthly_fee,
                 reserve_fund_fee,
                 billing_active,
                 created_at`,
      [condoId, t, n, rn, mf, rf, ba],
    );
    return res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '23505') {
      return res.status(409).json({
        message: 'Ja existe unidade com este bloco e numero neste condominio.',
      });
    }
    return next(err);
  }
});

router.patch('/units/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const condoId = parseCondoId((req.body || {}).condoId as unknown);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const { tower, number, residentName, monthlyFee, reserveFundFee, billingActive } =
      (req.body || {}) as {
        tower?: string;
        number?: string;
        residentName?: string;
        monthlyFee?: unknown;
        reserveFundFee?: unknown;
        billingActive?: unknown;
      };

    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (tower !== undefined) {
      const t = tower.trim();
      if (!t) {
        return res.status(400).json({ message: 'tower invalido.' });
      }
      fields.push(`tower = $${idx++}`);
      params.push(t);
    }
    if (number !== undefined) {
      const n = number.trim();
      if (!n) {
        return res.status(400).json({ message: 'number invalido.' });
      }
      fields.push(`number = $${idx++}`);
      params.push(n);
    }
    if (residentName !== undefined) {
      fields.push(`resident_name = $${idx++}`);
      params.push(residentName.trim() || '—');
    }
    if (monthlyFee !== undefined) {
      const m = Number(monthlyFee);
      if (!Number.isFinite(m) || m < 0) {
        return res.status(400).json({ message: 'monthlyFee invalido.' });
      }
      fields.push(`monthly_fee = $${idx++}`);
      params.push(m);
    }
    if (reserveFundFee !== undefined) {
      const rf = Number(reserveFundFee);
      if (!Number.isFinite(rf) || rf < 0) {
        return res.status(400).json({ message: 'reserveFundFee invalido.' });
      }
      fields.push(`reserve_fund_fee = $${idx++}`);
      params.push(rf);
    }
    if (billingActive !== undefined) {
      fields.push(`billing_active = $${idx++}`);
      params.push(Boolean(billingActive));
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'Nada para atualizar.' });
    }

    params.push(id, condoId);
    const r = await query(
      `update units set ${fields.join(', ')}
       where id = $${idx++} and condo_id = $${idx}
       returning id, condo_id, tower, number, resident_name,
                 monthly_fee, reserve_fund_fee, billing_active, created_at`,
      params,
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }
    return res.json(r.rows[0]);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '23505') {
      return res.status(409).json({
        message: 'Ja existe unidade com este bloco e numero neste condominio.',
      });
    }
    return next(err);
  }
});

router.delete('/units/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const r = await query(
      `delete from units where id = $1 and condo_id = $2
       returning id`,
      [id, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.get('/units/:unitId/residents', async (req, res, next) => {
  try {
    const unitId = Number(req.params.unitId);
    if (!Number.isFinite(unitId) || unitId < 1) {
      return res.status(400).json({ message: 'unitId invalido.' });
    }

    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const u = await query(
      `select id from units where id = $1 and condo_id = $2`,
      [unitId, condoId],
    );
    if (u.rows.length === 0) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }

    const r = await query(
      `select id, unit_id, role, full_name, phone, email, notes, created_at, updated_at
       from unit_residents
       where unit_id = $1
       order by
         case role
           when 'owner' then 1
           when 'tenant' then 2
           when 'resident' then 3
           else 4
         end,
         full_name asc`,
      [unitId],
    );
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/units/:unitId/residents', async (req, res, next) => {
  try {
    const unitId = Number(req.params.unitId);
    if (!Number.isFinite(unitId) || unitId < 1) {
      return res.status(400).json({ message: 'unitId invalido.' });
    }

    const condoId = parseCondoId((req.body || {}).condoId as unknown);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const { role, fullName, phone, email, notes } = (req.body || {}) as {
      role?: string;
      fullName?: string;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
    };

    if (!role || !RESIDENT_ROLES.includes(role as ResidentRole)) {
      return res.status(400).json({
        message: 'role deve ser owner, tenant, resident ou other.',
      });
    }

    const name = fullName?.trim();
    if (!name) {
      return res.status(400).json({ message: 'fullName e obrigatorio.' });
    }

    const u = await query(
      `select id from units where id = $1 and condo_id = $2`,
      [unitId, condoId],
    );
    if (u.rows.length === 0) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }

    const ins = await query(
      `insert into unit_residents (unit_id, role, full_name, phone, email, notes)
       values ($1, $2, $3, $4, $5, $6)
       returning id, unit_id, role, full_name, phone, email, notes, created_at, updated_at`,
      [
        unitId,
        role,
        name,
        phone?.trim() || null,
        email?.trim() || null,
        notes?.trim() || null,
      ],
    );

    if (role === 'owner') {
      await query(`update units set resident_name = $1 where id = $2`, [
        name,
        unitId,
      ]);
    }

    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/residents/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const condoId = parseCondoId((req.body || {}).condoId as unknown);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const { role, fullName, phone, email, notes } = (req.body || {}) as {
      role?: string;
      fullName?: string;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
    };

    const unitCheck = await query(
      `select ur.unit_id
       from unit_residents ur
       join units u on u.id = ur.unit_id
       where ur.id = $1 and u.condo_id = $2`,
      [id, condoId],
    );
    if (unitCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Registro nao encontrado.' });
    }
    const unitId = unitCheck.rows[0].unit_id as number;

    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (role !== undefined) {
      if (!RESIDENT_ROLES.includes(role as ResidentRole)) {
        return res.status(400).json({ message: 'role invalido.' });
      }
      fields.push(`role = $${idx++}`);
      params.push(role);
    }
    if (fullName !== undefined) {
      const n = fullName.trim();
      if (!n) {
        return res.status(400).json({ message: 'fullName invalido.' });
      }
      fields.push(`full_name = $${idx++}`);
      params.push(n);
    }
    if (phone !== undefined) {
      fields.push(`phone = $${idx++}`);
      params.push(phone?.trim() || null);
    }
    if (email !== undefined) {
      fields.push(`email = $${idx++}`);
      params.push(email?.trim() || null);
    }
    if (notes !== undefined) {
      fields.push(`notes = $${idx++}`);
      params.push(notes?.trim() || null);
    }

    fields.push(`updated_at = now()`);

    if (fields.length === 1) {
      return res.status(400).json({ message: 'Nada para atualizar.' });
    }

    params.push(id);
    const r = await query(
      `update unit_residents set ${fields.join(', ')}
       where id = $${idx}
       returning id, unit_id, role, full_name, phone, email, notes, created_at, updated_at`,
      params,
    );

    const row = r.rows[0];
    if (row && row.role === 'owner') {
      await query(`update units set resident_name = $1 where id = $2`, [
        row.full_name,
        unitId,
      ]);
    }

    return res.json(row);
  } catch (err) {
    return next(err);
  }
});

router.delete('/residents/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const r = await query(
      `delete from unit_residents ur
       using units u
       where ur.id = $1 and ur.unit_id = u.id and u.condo_id = $2
       returning ur.id`,
      [id, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Registro nao encontrado.' });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.get('/financial-overview', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (userId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    const user = await loadHubUser(userId);
    if (!hubReadAuthorized(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao para visualizar este painel.' });
    }

    const fin = await query(
      `select count(*) filter (where uc.status <> 'cancelled')::int as charges_total,
              count(*) filter (where uc.status in ('pending', 'overdue'))::int as charges_open,
              count(*) filter (where uc.status = 'paid')::int as charges_paid
       from condo_unit_charges uc
       inner join condo_billing_campaigns c on c.id = uc.campaign_id and c.condo_id = $1`,
      [condoId],
    );
    const urow = await query(
      `select count(*)::int as units_total,
              count(*) filter (where billing_active = true)::int as units_billing_active
       from units
       where condo_id = $1`,
      [condoId],
    );

    const f = fin.rows[0] as {
      charges_total: number;
      charges_open: number;
      charges_paid: number;
    };
    const u = urow.rows[0] as { units_total: number; units_billing_active: number };
    const total = f.charges_total;
    const open = f.charges_open;
    const delinquencyPercent =
      total > 0 ? Math.round((100 * open) / total) : 0;

    return res.json({
      invoicesIssued: total,
      delinquencyPercent,
      unpaidOpen: open,
      paidCharges: f.charges_paid,
      unitsTotal: u.units_total,
      unitsBillingActive: u.units_billing_active,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/reports/summary', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (userId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    const user = await loadHubUser(userId);
    if (!hubReadAuthorized(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao.' });
    }

    const fin = await query(
      `select count(*) filter (where uc.status <> 'cancelled')::int as charges_total,
              count(*) filter (where uc.status in ('pending', 'overdue'))::int as charges_open,
              sum(uc.amount) filter (where uc.status in ('pending', 'overdue')) as amount_open_raw
       from condo_unit_charges uc
       inner join condo_billing_campaigns c on c.id = uc.campaign_id and c.condo_id = $1`,
      [condoId],
    );
    const occ = await query(
      `select count(*)::int as c from occurrences where condo_id = $1 and status = 'open'`,
      [condoId],
    );
    const resv = await query(
      `select count(*)::int as c from space_reservations
       where condo_id = $1 and created_at >= now() - interval '90 days'`,
      [condoId],
    );
    const mant = await query(
      `select count(*)::int as c from maintenance_requests m
       join units u on u.id = m.unit_id
       where u.condo_id = $1 and m.status = 'open'`,
      [condoId],
    );
    const residents = await query(
      `select count(distinct ur.unit_id)::int as occupied_units from unit_residents ur
       join units u on u.id = ur.unit_id
       where u.condo_id = $1`,
      [condoId],
    );

    const f = fin.rows[0] as {
      charges_total: number;
      charges_open: number;
      amount_open_raw: string | null;
    };
    const total = f.charges_total;
    const open = f.charges_open;
    const delinquencyPercent = total > 0 ? Math.round((100 * open) / total) : 0;
    const amountOpen = Number(f.amount_open_raw ?? 0) || 0;

    const delinqDetail = await query(
      `select u.id as unit_id, u.tower, u.number, count(*) filter (where uc.status = 'overdue')::int as overdue_count,
              count(*) filter (where uc.status = 'pending')::int as pending_count,
              sum(uc.amount) filter (where uc.status in ('pending','overdue')) as amount_due_raw
       from condo_unit_charges uc
       inner join condo_billing_campaigns c on c.id = uc.campaign_id and c.condo_id = $1
       inner join units u on u.id = uc.unit_id
       where uc.status in ('pending', 'overdue')
       group by u.id, u.tower, u.number
       order by amount_due_raw desc nulls last, u.tower asc, u.number asc
       limit 50`,
      [condoId],
    );

    const occCount = (occ.rows[0] as { c: number }).c;
    const resvCount = (resv.rows[0] as { c: number }).c;
    const maintOpen = (mant.rows[0] as { c: number }).c;
    const occUnits = (residents.rows[0] as { occupied_units: number }).occupied_units;

    const unitTotalRow = await query(
      `select count(*)::int as c from units where condo_id = $1`,
      [condoId],
    );
    const unitTotalFull = (unitTotalRow.rows[0] as { c: number }).c;

    return res.json({
      financial: {
        chargesIssued: total,
        chargesOpen: open,
        delinquencyPercent,
        amountOpenRough: Math.round(amountOpen * 100) / 100,
      },
      delinquencyByUnit: delinqDetail.rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          unitId: r.unit_id,
          tower: r.tower,
          number: r.number,
          overdueCount: r.overdue_count,
          pendingCount: r.pending_count,
          amountDue: Number(r.amount_due_raw ?? 0) || 0,
        };
      }),
      occurrencesOpen: occCount,
      maintenanceOpen: maintOpen,
      reservationsLast90Days: resvCount,
      unitsOccupied: occUnits,
      unitsTotal: unitTotalFull,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/contracts', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (userId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    const user = await loadHubUser(userId);
    if (!hubReadAuthorized(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao.' });
    }
    const r = await query(
      `select id, condo_id, title, counterparty_name, category, starts_at, ends_at, value_amount,
              notes, attachment_url, status, created_by_user_id, created_at, updated_at
       from condo_admin_contracts
       where condo_id = $1
       order by ends_at desc nulls last, id desc`,
      [condoId],
    );
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/contracts', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId);
    const userId = parsePositive(body.userId);
    if (userId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    const user = await loadHubUser(userId);
    if (!hubBillingAuthorized(user, condoId)) {
      return res.status(403).json({ message: 'Apenas sindico ou administracao podem cadastrar contratos.' });
    }

    const title = String(body.title ?? '').trim();
    const counterpartyName = String(
      body.counterpartyName ?? body.counterparty_name ?? '',
    ).trim();
    const category = String(body.category ?? 'supplier').trim() || 'supplier';
    const notes = String(body.notes ?? '').trim() || null;
    const attachmentUrl =
      body.attachmentUrl != null && String(body.attachmentUrl).trim() !== ''
        ? String(body.attachmentUrl).trim()
        : null;
    let status =
      body.status !== undefined ? String(body.status).trim().toLowerCase() : 'active';
    if (!['active', 'expiring', 'archived'].includes(status)) {
      status = 'active';
    }

    const startsRaw = body.startsAt ?? body.starts_at;
    let startsAt: string | null =
      startsRaw != null && String(startsRaw).trim() !== ''
        ? String(startsRaw).slice(0, 10)
        : null;
    const endsRaw = body.endsAt ?? body.ends_at;
    let endsAt: string | null =
      endsRaw != null && String(endsRaw).trim() !== ''
        ? String(endsRaw).slice(0, 10)
        : null;

    if (startsAt === '') startsAt = null;
    if (endsAt === '') endsAt = null;

    let valueAmount: number | null = null;
    if (
      body.valueAmount !== undefined ||
      body.value_amount !== undefined
    ) {
      const vx = Number(body.valueAmount ?? body.value_amount ?? NaN);
      valueAmount = Number.isFinite(vx) ? vx : null;
    }

    if (!title || !counterpartyName) {
      return res.status(400).json({ message: 'title e counterpartyName sao obrigatorios.' });
    }

    const ins = await query(
      `insert into condo_admin_contracts (
         condo_id, title, counterparty_name, category, starts_at, ends_at, value_amount,
         notes, attachment_url, status, created_by_user_id
       )
       values ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11)
       returning id, condo_id, title, counterparty_name, category, starts_at, ends_at, value_amount,
                 notes, attachment_url, status, created_by_user_id, created_at, updated_at`,
      [
        condoId,
        title,
        counterpartyName,
        category,
        startsAt,
        endsAt,
        valueAmount,
        notes,
        attachmentUrl,
        status,
        userId,
      ],
    );
    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/contracts/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId);
    const userId = parsePositive(body.userId);
    if (userId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    const user = await loadHubUser(userId);
    if (!hubBillingAuthorized(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao para editar.' });
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    const pushOptStr = (
      bodyKeyCamel: string,
      bodyKeySnake: string,
      colName: string,
    ) => {
      if (body[bodyKeyCamel] !== undefined || body[bodyKeySnake] !== undefined) {
        const vRaw = body[bodyKeyCamel] ?? body[bodyKeySnake];
        const v =
          vRaw == null || String(vRaw).trim() === '' ? null : String(vRaw).trim();
        fields.push(`${colName} = $${idx++}`);
        params.push(v);
      }
    };

    pushOptStr('title', 'title', 'title');
    pushOptStr('counterpartyName', 'counterparty_name', 'counterparty_name');
    pushOptStr('category', 'category', 'category');
    pushOptStr('notes', 'notes', 'notes');
    if (body.status !== undefined) {
      const st = String(body.status).trim().toLowerCase();
      if (!['active', 'expiring', 'archived'].includes(st)) {
        return res.status(400).json({ message: 'status invalido.' });
      }
      fields.push(`status = $${idx++}`);
      params.push(st);
    }
    if (body.startsAt !== undefined || body.starts_at !== undefined) {
      const raw = body.startsAt ?? body.starts_at;
      fields.push(`starts_at = $${idx++}::date`);
      params.push(
        raw == null || String(raw).trim() === '' ? null : String(raw).slice(0, 10),
      );
    }
    if (body.endsAt !== undefined || body.ends_at !== undefined) {
      const raw = body.endsAt ?? body.ends_at;
      fields.push(`ends_at = $${idx++}::date`);
      params.push(
        raw == null || String(raw).trim() === '' ? null : String(raw).slice(0, 10),
      );
    }
    if (body.valueAmount !== undefined || body.value_amount !== undefined) {
      const vx = Number(body.valueAmount ?? body.value_amount ?? NaN);
      fields.push(`value_amount = $${idx++}`);
      params.push(Number.isFinite(vx) ? vx : null);
    }
    if (body.attachmentUrl !== undefined || body.attachment_url !== undefined) {
      const v = body.attachmentUrl ?? body.attachment_url;
      fields.push(`attachment_url = $${idx++}`);
      params.push(
        v == null || String(v).trim() === '' ? null : String(v).trim(),
      );
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'Nada para atualizar.' });
    }
    fields.push('updated_at = now()');
    params.push(id, condoId);

    const r = await query(
      `update condo_admin_contracts set ${fields.join(', ')}
       where id = $${idx++} and condo_id = $${idx}
       returning id, condo_id, title, counterparty_name, category, starts_at, ends_at, value_amount,
                 notes, attachment_url, status, created_by_user_id, created_at, updated_at`,
      params,
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Contrato nao encontrado.' });
    }
    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete('/contracts/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (userId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    const user = await loadHubUser(userId);
    if (!hubBillingAuthorized(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao para excluir.' });
    }
    const r = await query(
      `delete from condo_admin_contracts where id = $1 and condo_id = $2 returning id`,
      [id, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Contrato nao encontrado.' });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.get('/registry-documents', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (userId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    const user = await loadHubUser(userId);
    if (!hubReadAuthorized(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao.' });
    }
    const r = await query(
      `select id, condo_id, title, category, document_date, notes, attachment_url,
              created_by_user_id, created_at, updated_at
       from condo_admin_registry_documents
       where condo_id = $1
       order by document_date desc nulls last, id desc`,
      [condoId],
    );
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/registry-documents', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId);
    const userId = parsePositive(body.userId);
    if (userId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    const user = await loadHubUser(userId);
    if (!hubBillingAuthorized(user, condoId)) {
      return res.status(403).json({ message: 'Apenas sindico ou administracao podem cadastrar.' });
    }

    const title = String(body.title ?? '').trim();
    const category = String(body.category ?? 'other').trim() || 'other';
    const notes = String(body.notes ?? '').trim() || null;
    const dateRaw = body.documentDate ?? body.document_date;
    let documentDate: string | null =
      dateRaw != null && String(dateRaw).trim() !== ''
        ? String(dateRaw).slice(0, 10)
        : null;
    if (documentDate === '') documentDate = null;
    const attachmentUrl =
      body.attachmentUrl != null && String(body.attachmentUrl).trim() !== ''
        ? String(body.attachmentUrl).trim()
        : null;

    if (!title) {
      return res.status(400).json({ message: 'title e obrigatorio.' });
    }

    const ins = await query(
      `insert into condo_admin_registry_documents (
         condo_id, title, category, document_date, notes, attachment_url, created_by_user_id
       )
       values ($1, $2, $3, $4::date, $5, $6, $7)
       returning id, condo_id, title, category, document_date, notes, attachment_url,
                 created_by_user_id, created_at, updated_at`,
      [condoId, title, category, documentDate, notes, attachmentUrl, userId],
    );
    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/registry-documents/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId);
    const userId = parsePositive(body.userId);
    if (userId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    const actor = await loadHubUser(userId);
    if (!hubBillingAuthorized(actor, condoId)) {
      return res.status(403).json({ message: 'Sem permissao para editar.' });
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (!t) {
        return res.status(400).json({ message: 'title invalido.' });
      }
      fields.push(`title = $${idx++}`);
      params.push(t);
    }
    if (body.category !== undefined) {
      fields.push(`category = $${idx++}`);
      params.push(String(body.category).trim() || 'other');
    }
    if (body.notes !== undefined) {
      fields.push(`notes = $${idx++}`);
      params.push(String(body.notes ?? '').trim() || null);
    }
    if (body.documentDate !== undefined || body.document_date !== undefined) {
      const raw = body.documentDate ?? body.document_date;
      fields.push(`document_date = $${idx++}::date`);
      params.push(
        raw == null || String(raw).trim() === '' ? null : String(raw).slice(0, 10),
      );
    }
    if (body.attachmentUrl !== undefined || body.attachment_url !== undefined) {
      const v = body.attachmentUrl ?? body.attachment_url;
      fields.push(`attachment_url = $${idx++}`);
      params.push(
        v == null || String(v).trim() === '' ? null : String(v).trim(),
      );
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'Nada para atualizar.' });
    }
    fields.push('updated_at = now()');
    params.push(id, condoId);

    const r = await query(
      `update condo_admin_registry_documents set ${fields.join(', ')}
       where id = $${idx++} and condo_id = $${idx}
       returning id, condo_id, title, category, document_date, notes, attachment_url,
                 created_by_user_id, created_at, updated_at`,
      params,
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Documento nao encontrado.' });
    }
    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete('/registry-documents/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (userId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    const user = await loadHubUser(userId);
    if (!hubBillingAuthorized(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao para excluir.' });
    }
    const r = await query(
      `delete from condo_admin_registry_documents where id = $1 and condo_id = $2 returning id`,
      [id, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Documento nao encontrado.' });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

const APP_ROLE_LIST = ['syndic', 'administrator', 'resident', 'partner', 'collaborator'] as const;

router.get('/app-users', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (userId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    const viewer = await loadHubUser(userId);
    if (!hubBillingAuthorized(viewer, condoId)) {
      return res.status(403).json({ message: 'Apenas sindico ou administracao podem listar usuarios do app.' });
    }
    const r = await query(
      `select id, condo_id, unit_id, full_name, login, role, active, created_at
       from app_users
       where condo_id = $1
       order by role asc, full_name asc`,
      [condoId],
    );
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/app-users', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId);
    const actorId = parsePositive(body.userId);
    const fullName = String(body.fullName ?? body.full_name ?? '').trim();
    const loginRaw = String(body.login ?? '').trim().toLowerCase();
    const passwordPlain = String(body.password ?? body.password_plain ?? '').trim();
    const role = String(body.role ?? '').trim();

    if (actorId == null || condoId == null || !fullName || !loginRaw || !passwordPlain || !role) {
      return res.status(400).json({
        message: 'condoId, userId (ator), fullName, login, password e role sao obrigatorios.',
      });
    }

    const actor = await loadHubUser(actorId);
    if (!hubBillingAuthorized(actor, condoId)) {
      return res.status(403).json({ message: 'Apenas sindico ou administracao podem cadastrar usuarios.' });
    }
    if (!APP_ROLE_LIST.includes(role as (typeof APP_ROLE_LIST)[number])) {
      return res.status(400).json({ message: 'role invalido para app_users.' });
    }

    const unitIdParsed = parsePositive(body.unitId ?? body.unit_id);
    let unitId: number | null = unitIdParsed;
    if (unitId != null) {
      const u = await query(
        `select id from units where id = $1 and condo_id = $2`,
        [unitId, condoId],
      );
      if (u.rows.length === 0) {
        return res.status(400).json({ message: 'unitId invalido para este condominio.' });
      }
    } else {
      unitId = null;
    }

    const exists = await query(
      `select id from condos where id = $1`,
      [condoId],
    );
    if (exists.rows.length === 0) {
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }

    const ins = await query(
      `insert into app_users (condo_id, unit_id, full_name, login, password_plain, role, active)
       values ($1, $2, $3, $4, $5, $6, true)
       returning id, condo_id, unit_id, full_name, login, role, active, created_at`,
      [condoId, unitId, fullName, loginRaw, passwordPlain, role],
    );
    return res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const code = err as { code?: string };
    if (code.code === '23505') {
      return res.status(409).json({ message: 'Login ja existe no sistema.' });
    }
    return next(err as Error);
  }
});

router.patch('/app-users/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId);
    const actorId = parsePositive(body.userId);
    if (actorId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }

    const actor = await loadHubUser(actorId);
    if (!hubBillingAuthorized(actor, condoId)) {
      return res.status(403).json({ message: 'Sem permissao para editar usuarios.' });
    }

    const tgt = await query(
      `select id from app_users where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (tgt.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (body.fullName !== undefined || body.full_name !== undefined) {
      const n = String(body.fullName ?? body.full_name ?? '').trim();
      if (!n) {
        return res.status(400).json({ message: 'fullName invalido.' });
      }
      fields.push(`full_name = $${idx++}`);
      params.push(n);
    }
    if (body.role !== undefined) {
      const rl = String(body.role ?? '').trim();
      if (!APP_ROLE_LIST.includes(rl as (typeof APP_ROLE_LIST)[number])) {
        return res.status(400).json({ message: 'role invalido.' });
      }
      fields.push(`role = $${idx++}`);
      params.push(rl);
    }
    if (body.active !== undefined) {
      fields.push(`active = $${idx++}`);
      params.push(Boolean(body.active));
    }
    if (body.unitId !== undefined || body.unit_id !== undefined) {
      const parsed = parsePositive(body.unitId ?? body.unit_id);
      if (parsed != null) {
        const u = await query(
          `select id from units where id = $1 and condo_id = $2`,
          [parsed, condoId],
        );
        if (u.rows.length === 0) {
          return res.status(400).json({ message: 'unitId invalido.' });
        }
      }
      fields.push(`unit_id = $${idx++}`);
      params.push(parsed);
    }
    const pwd = String(body.password ?? body.password_plain ?? '').trim();
    if (pwd !== '') {
      fields.push(`password_plain = $${idx++}`);
      params.push(pwd);
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'Nada para atualizar.' });
    }

    params.push(id, condoId);
    const r = await query(
      `update app_users set ${fields.join(', ')}
       where id = $${idx++} and condo_id = $${idx}
       returning id, condo_id, unit_id, full_name, login, role, active, created_at`,
      params,
    );

    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.get('/condo-login-branding', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId as unknown);
    const actorId = parsePositive(req.query.userId as unknown);
    if (actorId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    const actor = await loadHubUser(actorId);
    if (!hubBillingAuthorized(actor, condoId)) {
      return res.status(403).json({ message: 'Sem permissao para editar aparencia da tela de login.' });
    }
    const r = await query(
      `select id, name, login_logo_path from condos where id = $1 limit 1`,
      [condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }
    const row = r.rows[0] as {
      id: number;
      name: string;
      login_logo_path: string | null;
    };
    return res.json({
      condoId: row.id,
      condominiumName: row.name,
      logoRelativePath:
        row.login_logo_path != null && String(row.login_logo_path).trim() !== ''
          ? String(row.login_logo_path).trim()
          : null,
    });
  } catch (err) {
    return next(err);
  }
});

router.patch('/condo-login-branding', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId as unknown);
    const actorId = parsePositive(body.userId as unknown);
    const nameRaw = body.condominiumName ?? body.name;
    if (actorId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    if (typeof nameRaw !== 'string' || nameRaw.trim() === '') {
      return res.status(400).json({ message: 'condominiumName e obrigatorio.' });
    }
    const nm = nameRaw.trim();
    if (nm.length > 150) {
      return res.status(400).json({ message: 'Nome com ate 150 caracteres.' });
    }
    const actor = await loadHubUser(actorId);
    if (!hubBillingAuthorized(actor, condoId)) {
      return res.status(403).json({ message: 'Sem permissao.' });
    }
    const ex = await query('select id from condos where id = $1', [condoId]);
    if (ex.rows.length === 0) {
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }
    const u = await query(
      `update condos set name = $1 where id = $2
       returning id, name, login_logo_path`,
      [nm, condoId],
    );
    const row = u.rows[0] as {
      id: number;
      name: string;
      login_logo_path: string | null;
    };
    return res.json({
      condoId: row.id,
      condominiumName: row.name,
      logoRelativePath:
        row.login_logo_path != null && String(row.login_logo_path).trim() !== ''
          ? String(row.login_logo_path).trim()
          : null,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/condo-login-logo', loginLogoUpload.single('logo'), async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId as unknown);
    const actorId = parsePositive(req.query.userId as unknown);
    if (actorId == null || condoId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }
    const actor = await loadHubUser(actorId);
    if (!hubBillingAuthorized(actor, condoId)) {
      return res.status(403).json({ message: 'Sem permissao.' });
    }
    const file = req.file;
    if (file == null) {
      return res.status(400).json({ message: 'Arquivo logo e obrigatorio (campo logo).' });
    }
    const ex = await query(
      `select login_logo_path from condos where id = $1`,
      [condoId],
    );
    if (ex.rows.length === 0) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      return res.status(404).json({ message: 'Condominio nao encontrado.' });
    }
    const prev = ex.rows[0] as { login_logo_path: string | null };
    if (prev.login_logo_path != null && String(prev.login_logo_path).trim() !== '') {
      const oldRel = String(prev.login_logo_path).trim().replace(/\\/g, '/');
      const oldFull = path.join(UPLOADS_ROOT, ...oldRel.split('/'));
      try {
        if (fs.existsSync(oldFull)) {
          fs.unlinkSync(oldFull);
        }
      } catch {
        /* ignore */
      }
    }
    const rel = path.posix.join('branding', `condo-${condoId}`, file.filename);
    await query(`update condos set login_logo_path = $1 where id = $2`, [
      rel,
      condoId,
    ]);
    const r = await query(
      `select id, name, login_logo_path from condos where id = $1`,
      [condoId],
    );
    const row = r.rows[0] as {
      id: number;
      name: string;
      login_logo_path: string | null;
    };
    return res.status(201).json({
      condoId: row.id,
      condominiumName: row.name,
      logoRelativePath: rel,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;

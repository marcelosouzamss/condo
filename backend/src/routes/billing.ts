import { randomUUID } from 'node:crypto';

import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';

import { isBillingStaff } from '../authz';
import { pool, query } from '../db';
import { loadLegacyUserRow } from '../userContext';

const router = Router();

const WEBHOOK_SECRET =
  process.env.BILLING_WEBHOOK_SECRET || 'dev-billing-webhook-secret';

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

type AppUserRow = {
  id: number;
  condo_id: number;
  role: string;
  active: boolean;
  unit_id: number | null;
};

async function loadUser(userId: number, condoId: number): Promise<AppUserRow | null> {
  const row = await loadLegacyUserRow(userId, condoId);
  if (row == null) {
    return null;
  }
  return row as AppUserRow;
}

function canAccessCondo(user: AppUserRow, condoId: number): boolean {
  return user.active === true && user.condo_id === condoId;
}

function canManageBilling(user: AppUserRow, condoId: number): boolean {
  return (
    canAccessCondo(user, condoId) && isBillingStaff(user.role)
  );
}

function fakeBarcode(seed: string): string {
  const d = seed.replace(/\D/g, '').padEnd(12, '0').slice(0, 12);
  const base = `34191${d}0000000000000000000000000`;
  return base.slice(0, 47);
}

function simBoletoUrl(condoId: number, chargeId: number): string {
  const base = (process.env.PUBLIC_APP_URL || 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
  return `${base}/boleto-simulado/condo-${condoId}/cobranca-${chargeId}`;
}

function sqlBoletoPdfUrlExpr(ucAlias: string): string {
  return `(case when coalesce(${ucAlias}.boleto_url, '') <> ''
            then ${ucAlias}.boleto_url || '.pdf'
            else null end) as boleto_pdf_url`;
}

function simPixCopyPaste(gatewayId: string, amount: string): string {
  return `PIX_SIM|${gatewayId}|BRL${amount}|CONDO`;
}

type ChargeInsertOutcome =
  | { ok: true; chargeId: number }
  | {
      ok: false;
      reason:
        | 'unit_not_found'
        | 'billing_inactive'
        | 'amount_non_positive'
        | 'duplicate';
    };

async function insertChargeForUnit(
  client: PoolClient,
  args: {
    campaignId: number;
    condoId: number;
    unitId: number;
    discount: number;
  },
): Promise<ChargeInsertOutcome> {
  const u = await client.query(
    `select id, monthly_fee, reserve_fund_fee, billing_active
     from units
     where id = $1 and condo_id = $2`,
    [args.unitId, args.condoId],
  );
  if (u.rows.length === 0) {
    return { ok: false, reason: 'unit_not_found' };
  }
  const row = u.rows[0] as {
    id: number;
    monthly_fee: string;
    reserve_fund_fee: string;
    billing_active: boolean;
  };
  if (row.billing_active !== true) {
    return { ok: false, reason: 'billing_inactive' };
  }

  const condoPart = Number(row.monthly_fee) || 0;
  const resPart = Number(row.reserve_fund_fee) || 0;
  const base = condoPart + resPart;
  const amount = Math.round((base - args.discount) * 100) / 100;
  if (amount <= 0) {
    return { ok: false, reason: 'amount_non_positive' };
  }

  const gatewayChargeId = `sim-${randomUUID()}`;
  const ins = await client.query(
    `insert into condo_unit_charges (
       campaign_id, unit_id, amount, condominium_part, reserve_part,
       status, boleto_url, barcode, pix_copia_cola, gateway_charge_id
     )
     values ($1, $2, $3, $4, $5, 'pending', '', '', '', $6)
     on conflict (campaign_id, unit_id) do nothing
     returning id`,
    [args.campaignId, row.id, amount, condoPart, resPart, gatewayChargeId],
  );

  if (ins.rows.length === 0) {
    return { ok: false, reason: 'duplicate' };
  }

  const chargeId = (ins.rows[0] as { id: number }).id;
  const boletoUrl = simBoletoUrl(args.condoId, chargeId);
  const barcodeField = fakeBarcode(`${chargeId}${row.id}`);
  const pix = simPixCopyPaste(gatewayChargeId, amount.toFixed(2));
  await client.query(
    `update condo_unit_charges
     set boleto_url = $1, barcode = $2, pix_copia_cola = $3, updated_at = now()
     where id = $4`,
    [boletoUrl, barcodeField, pix, chargeId],
  );
  return { ok: true, chargeId };
}

/** Listagem de competências / campanhas (síndico ou administradora). */
router.get('/campaigns', async (req, res, next) => {
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
    if (!canManageBilling(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem listar competencias de cobranca.',
      });
    }

    const r = await query(
      `select bc.id,
              bc.condo_id,
              bc.title,
              bc.competence,
              bc.due_date,
              bc.fine_percent,
              bc.interest_percent_month,
              bc.discount_amount,
              bc.notes,
              bc.status,
              bc.created_by_user_id,
              bc.created_at,
              bc.updated_at,
              (select count(*)::int from condo_unit_charges uc where uc.campaign_id = bc.id)
                as charges_count,
              (select count(*)::int from condo_unit_charges uc
               where uc.campaign_id = bc.id and uc.status = 'paid') as paid_count
       from condo_billing_campaigns bc
       where bc.condo_id = $1
       order by bc.due_date desc, bc.id desc`,
      [condoId],
    );
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

/** Detalhe de uma competência (staff) — status e metadados. */
router.get('/campaigns/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (id == null || userId == null) {
      return res.status(400).json({ message: 'parametros invalidos.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageBilling(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao.',
      });
    }

    const r = await query(
      `select bc.id,
              bc.condo_id,
              bc.title,
              bc.competence,
              bc.due_date,
              bc.status,
              bc.discount_amount,
              bc.notes,
              (select count(*)::int from condo_unit_charges uc where uc.campaign_id = bc.id)
                as charges_count
       from condo_billing_campaigns bc
       where bc.id = $1 and bc.condo_id = $2`,
      [id, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Competencia nao encontrada.' });
    }
    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

/** Cobranças da unidade do morador (segunda via, PIX simulado, etc.). */
router.get('/my-charges', async (req, res, next) => {
  try {
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    const unitIdParam = parsePositive(req.query.unitId);

    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canAccessCondo(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    const unitId = unitIdParam ?? user.unit_id;
    if (unitId == null) {
      return res.status(400).json({
        message: 'Unidade nao vinculada ao usuario. Solicite cadastro na administracao.',
      });
    }

    const unitOk = await query(
      `select id from units where id = $1 and condo_id = $2`,
      [unitId, condoId],
    );
    if (unitOk.rows.length === 0) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }

    const r = await query(
      `select uc.id,
              uc.campaign_id,
              uc.unit_id,
              uc.amount,
              uc.condominium_part,
              uc.reserve_part,
              uc.status,
              uc.boleto_url,
              ${sqlBoletoPdfUrlExpr('uc')},
              uc.barcode,
              uc.pix_copia_cola,
              uc.gateway_charge_id,
              uc.paid_at,
              uc.created_at,
              bc.title as campaign_title,
              bc.competence,
              bc.due_date,
              bc.fine_percent,
              bc.interest_percent_month,
              bc.notes as campaign_notes
       from condo_unit_charges uc
       join condo_billing_campaigns bc on bc.id = uc.campaign_id
       where uc.unit_id = $1 and bc.condo_id = $2
       order by bc.due_date desc, uc.id desc`,
      [unitId, condoId],
    );
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

/** Detalhe de todas as cobranças de uma competência (staff). */
router.get('/campaigns/:id/charges', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (id == null || userId == null) {
      return res.status(400).json({ message: 'parametros invalidos.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageBilling(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem listar cobrancas da competencia.',
      });
    }

    const campEx = await query(
      `select id from condo_billing_campaigns where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (campEx.rows.length === 0) {
      return res.status(404).json({ message: 'Competencia nao encontrada.' });
    }

    const r = await query(
      `select uc.id,
              uc.campaign_id,
              uc.unit_id,
              uc.amount,
              uc.condominium_part,
              uc.reserve_part,
              uc.status,
              uc.boleto_url,
              ${sqlBoletoPdfUrlExpr('uc')},
              uc.barcode,
              uc.pix_copia_cola,
              uc.gateway_charge_id,
              uc.paid_at,
              uc.created_at,
              u.tower,
              u.number,
              u.resident_name
       from condo_unit_charges uc
       join units u on u.id = uc.unit_id
       join condo_billing_campaigns bc on bc.id = uc.campaign_id
       where uc.campaign_id = $1 and bc.condo_id = $2
       order by u.tower asc, u.number asc`,
      [id, condoId],
    );
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/campaigns', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);
    const title = String(body.title ?? '').trim();
    const competence = String(body.competence ?? '').trim();
    const dueRaw = body.dueDate ?? body.due_date;
    const notes = String(body.notes ?? '').trim() || null;
    const finePercent =
      body.finePercent != null && String(body.finePercent).trim() !== ''
        ? Number(body.finePercent)
        : null;
    const interestPercentMonth =
      body.interestPercentMonth != null &&
      String(body.interestPercentMonth).trim() !== ''
        ? Number(body.interestPercentMonth)
        : null;
    const discountAmount =
      body.discountAmount != null && String(body.discountAmount).trim() !== ''
        ? Number(body.discountAmount)
        : null;

    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (!title || !competence) {
      return res.status(400).json({ message: 'title e competence sao obrigatorios.' });
    }
    if (dueRaw == null || String(dueRaw).trim() === '') {
      return res.status(400).json({ message: 'dueDate e obrigatorio.' });
    }
    const due = new Date(String(dueRaw));
    if (Number.isNaN(due.getTime())) {
      return res.status(400).json({ message: 'dueDate invalido.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageBilling(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem criar competencias.',
      });
    }

    const ins = await query(
      `insert into condo_billing_campaigns (
         condo_id, title, competence, due_date,
         fine_percent, interest_percent_month, discount_amount, notes,
         status, created_by_user_id
       )
       values ($1, $2, $3, $4::date, $5, $6, $7, $8, 'draft', $9)
       returning id,
                 condo_id,
                 title,
                 competence,
                 due_date,
                 fine_percent,
                 interest_percent_month,
                 discount_amount,
                 notes,
                 status,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [
        condoId,
        title,
        competence,
        due,
        finePercent,
        interestPercentMonth,
        discountAmount,
        notes,
        userId,
      ],
    );
    return res.status(201).json(ins.rows[0]);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '23505') {
      return res.status(409).json({
        message:
          'Ja existe uma competencia com este mesmo texto de competencia (ex.: 05/2026) neste condominio. Escolha outra competencia ou edite a existente enquanto estiver em rascunho.',
      });
    }
    return next(err);
  }
});

/** Gera linhas de cobrança (boleto simulado) para todas as unidades ativas no lote. */
router.post('/campaigns/:id/generate', async (req, res, next) => {
  try {
    const campaignId = parsePositive(req.params.id);
    const body = req.body || {};
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);

    if (campaignId == null || !Number.isFinite(condoId) || condoId < 1 || userId == null) {
      return res.status(400).json({ message: 'Dados invalidos.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageBilling(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem gerar boletos em lote.',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const camp = await client.query(
        `select id, status, discount_amount, condo_id
         from condo_billing_campaigns
         where id = $1 and condo_id = $2
         for update`,
        [campaignId, condoId],
      );
      if (camp.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Competencia nao encontrada.' });
      }
      const row = camp.rows[0] as {
        status: string;
        discount_amount: string | null;
      };
      if (row.status !== 'draft') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: 'Somente competencias em rascunho podem gerar boletos. Gere uma nova competencia.',
        });
      }

      const discount = Number(row.discount_amount ?? 0) || 0;

      const units = await client.query(
        `select id from units
         where condo_id = $1 and billing_active = true`,
        [condoId],
      );

      let created = 0;
      for (const u of units.rows) {
        const ur = u as { id: number };
        const out = await insertChargeForUnit(client, {
          campaignId,
          condoId,
          unitId: ur.id,
          discount,
        });
        if (out.ok) {
          created += 1;
        }
      }

      const sum = await client.query(
        `select count(*)::int as total from condo_unit_charges where campaign_id = $1`,
        [campaignId],
      );
      const chargesTotal = (sum.rows[0] as { total: number }).total;

      if (chargesTotal > 0) {
        await client.query(
          `update condo_billing_campaigns
           set status = 'generated', updated_at = now()
           where id = $1`,
          [campaignId],
        );
      }

      await client.query('COMMIT');

      if (chargesTotal === 0) {
        return res.status(422).json({
          message:
            'Nenhuma cobranca foi criada. Cadastre taxa condominial e fundo de reserva nas unidades (Administracao > unidades), confira se a cobranca esta ativa e se o desconto da competencia nao zera o valor.',
          campaignId,
          chargesCreated: created,
          chargesTotal: 0,
        });
      }

      return res.status(201).json({
        message: 'Boletos gerados (modo simulado — integre Asaas/Efi para producao).',
        campaignId,
        chargesCreated: created,
        chargesTotal,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    return next(err);
  }
});

/** Gera boleto simulado para uma única unidade (competência em rascunho). */
router.post('/campaigns/:id/charges/generate-one', async (req, res, next) => {
  try {
    const campaignId = parsePositive(req.params.id);
    const body = req.body || {};
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);
    const unitId = parsePositive(body.unitId);

    if (
      campaignId == null ||
      !Number.isFinite(condoId) ||
      condoId < 1 ||
      userId == null ||
      unitId == null
    ) {
      return res.status(400).json({ message: 'Dados invalidos (condoId, userId, unitId).' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageBilling(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem gerar boletos.',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const camp = await client.query(
        `select id, status, discount_amount, condo_id
         from condo_billing_campaigns
         where id = $1 and condo_id = $2
         for update`,
        [campaignId, condoId],
      );
      if (camp.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Competencia nao encontrada.' });
      }
      const row = camp.rows[0] as {
        status: string;
        discount_amount: string | null;
      };
      if (row.status !== 'draft') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message:
            'So e possivel gerar boletos unitarios enquanto a competencia estiver em rascunho. Use uma nova competencia ou finalize apos gerar todos.',
        });
      }

      const discount = Number(row.discount_amount ?? 0) || 0;
      const out = await insertChargeForUnit(client, {
        campaignId,
        condoId,
        unitId,
        discount,
      });

      if (!out.ok) {
        await client.query('ROLLBACK');
        const msg =
          out.reason === 'duplicate'
            ? 'Ja existe cobranca para esta unidade nesta competencia.'
            : out.reason === 'unit_not_found'
              ? 'Unidade nao encontrada neste condominio.'
              : out.reason === 'billing_inactive'
                ? 'Unidade sem cobranca ativa (billing inativo ou valor zerado).'
                : 'Valor da cobranca nao pode ser zero ou negativo apos desconto.';
        const code =
          out.reason === 'duplicate'
            ? 409
            : out.reason === 'unit_not_found'
              ? 404
              : 400;
        return res.status(code).json({ message: msg, reason: out.reason });
      }

      await client.query('COMMIT');
      return res.status(201).json({
        message: 'Boleto gerado para a unidade (modo simulado).',
        chargeId: out.chargeId,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    return next(err);
  }
});

/** Finaliza competência em rascunho (marcar como “boletos gerados”) quando já houver pelo menos uma cobrança — útil após gerar por unidade. */
router.post('/campaigns/:id/finalize', async (req, res, next) => {
  try {
    const campaignId = parsePositive(req.params.id);
    const body = req.body || {};
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);

    if (
      campaignId == null ||
      !Number.isFinite(condoId) ||
      condoId < 1 ||
      userId == null
    ) {
      return res.status(400).json({ message: 'Dados invalidos.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageBilling(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao.' });
    }

    const r = await query(
      `update condo_billing_campaigns bc
       set status = 'generated',
           updated_at = now()
       where bc.id = $1
         and bc.condo_id = $2
         and bc.status = 'draft'
         and exists (
           select 1 from condo_unit_charges uc where uc.campaign_id = bc.id
         )
       returning bc.id, bc.status`,
      [campaignId, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(409).json({
        message:
          'Nao foi possivel finalizar: competencia inexistente, ja finalizada, ou sem nenhuma cobranca gerada.',
      });
    }
    return res.json({
      message: 'Competencia marcada como encerrada para geracao (boletos gerados).',
      campaignId: r.rows[0].id,
      status: (r.rows[0] as { status: string }).status,
    });
  } catch (err) {
    return next(err);
  }
});

router.patch('/campaigns/:id', async (req, res, next) => {
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

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageBilling(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao.' });
    }

    const cur = await query(
      `select status from condo_billing_campaigns where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (cur.rows.length === 0) {
      return res.status(404).json({ message: 'Competencia nao encontrada.' });
    }
    if ((cur.rows[0] as { status: string }).status !== 'draft') {
      return res.status(409).json({ message: 'So e possivel editar competencias em rascunho.' });
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (body.title !== undefined) {
      const t = String(body.title ?? '').trim();
      if (!t) {
        return res.status(400).json({ message: 'title invalido.' });
      }
      fields.push(`title = $${idx++}`);
      params.push(t);
    }
    if (body.competence !== undefined) {
      const c = String(body.competence ?? '').trim();
      if (!c) {
        return res.status(400).json({ message: 'competence invalido.' });
      }
      fields.push(`competence = $${idx++}`);
      params.push(c);
    }
    if (body.dueDate !== undefined || body.due_date !== undefined) {
      const raw = body.dueDate ?? body.due_date;
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: 'dueDate invalido.' });
      }
      fields.push(`due_date = $${idx++}::date`);
      params.push(d);
    }
    if (body.notes !== undefined) {
      fields.push(`notes = $${idx++}`);
      params.push(String(body.notes ?? '').trim() || null);
    }
    if (body.finePercent !== undefined) {
      fields.push(`fine_percent = $${idx++}`);
      params.push(
        body.finePercent === null ? null : Number(body.finePercent),
      );
    }
    if (body.interestPercentMonth !== undefined) {
      fields.push(`interest_percent_month = $${idx++}`);
      params.push(
        body.interestPercentMonth === null
          ? null
          : Number(body.interestPercentMonth),
      );
    }
    if (body.discountAmount !== undefined) {
      fields.push(`discount_amount = $${idx++}`);
      params.push(
        body.discountAmount === null ? null : Number(body.discountAmount),
      );
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    fields.push('updated_at = now()');
    params.push(id, condoId);

    const r = await query(
      `update condo_billing_campaigns
       set ${fields.join(', ')}
       where id = $${idx++} and condo_id = $${idx++}
       returning *`,
      params,
    );
    return res.json(r.rows[0]);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '23505') {
      return res.status(409).json({
        message:
          'Ja existe uma competencia com este mesmo texto de competencia (ex.: 05/2026) neste condominio. Escolha outra competencia ou edite a existente enquanto estiver em rascunho.',
      });
    }
    return next(err);
  }
});

router.delete('/campaigns/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId =
      req.query.condoId !== undefined && String(req.query.condoId).trim() !== ''
        ? Number(req.query.condoId)
        : NaN;
    const userId = parsePositive(req.query.userId);
    if (id == null || !Number.isFinite(condoId) || condoId < 1 || userId == null) {
      return res.status(400).json({ message: 'Dados invalidos.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageBilling(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao.' });
    }

    const chk = await query(
      `select status,
              (select count(*)::int from condo_unit_charges uc where uc.campaign_id = $1)
                as n
       from condo_billing_campaigns
       where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (chk.rows.length === 0) {
      return res.status(404).json({ message: 'Competencia nao encontrada.' });
    }
    const z = chk.rows[0] as { status: string; n: number };
    if (z.status !== 'draft' || z.n > 0) {
      return res.status(409).json({
        message: 'So e possivel excluir competencias em rascunho sem cobrancas geradas.',
      });
    }

    await query(
      `delete from condo_billing_campaigns where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

/** Baixa manual (conferência bancária) — substituível pelo webhook do gateway. */
router.post('/charges/:id/mark-paid', async (req, res, next) => {
  try {
    const chargeId = parsePositive(req.params.id);
    const body = req.body || {};
    const condoId =
      body.condoId !== undefined &&
      body.condoId !== null &&
      String(body.condoId).trim() !== ''
        ? Number(body.condoId)
        : NaN;
    const userId = parsePositive(body.userId);

    if (
      chargeId == null ||
      !Number.isFinite(condoId) ||
      condoId < 1 ||
      userId == null
    ) {
      return res.status(400).json({ message: 'Dados invalidos.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageBilling(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao.' });
    }

    const paidAtRaw = body.paidAt ?? body.paid_at;
    let paidAt = new Date();
    if (paidAtRaw != null && String(paidAtRaw).trim() !== '') {
      paidAt = new Date(String(paidAtRaw));
      if (Number.isNaN(paidAt.getTime())) {
        return res.status(400).json({ message: 'paidAt invalido.' });
      }
    }

    const r = await query(
      `update condo_unit_charges uc
       set status = 'paid',
           paid_at = $2,
           updated_at = now()
       from condo_billing_campaigns bc
       where uc.id = $1
         and uc.campaign_id = bc.id
         and bc.condo_id = $3
         and uc.status <> 'cancelled'
       returning uc.id, uc.status, uc.paid_at, uc.gateway_charge_id`,
      [chargeId, paidAt, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Cobranca nao encontrada ou ja cancelada.' });
    }
    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

export async function billingPaymentWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body || {};
    const secret = String(body.secret ?? body.webhookSecret ?? '');
    if (secret !== WEBHOOK_SECRET) {
      res.status(401).json({ message: 'Webhook nao autorizado.' });
      return;
    }

    const gatewayChargeId = String(
      body.gatewayChargeId ?? body.gateway_charge_id ?? '',
    ).trim();
    if (!gatewayChargeId) {
      res.status(400).json({ message: 'gatewayChargeId e obrigatorio.' });
      return;
    }

    const status = String(body.status ?? 'paid').toLowerCase();
    if (status !== 'paid') {
      res.status(202).json({ message: 'Status ignorado (trate apenas liquidacao).', status });
      return;
    }

    const paidAtRaw = body.paidAt ?? body.paid_at;
    let paidAt = new Date();
    if (paidAtRaw != null && String(paidAtRaw).trim() !== '') {
      paidAt = new Date(String(paidAtRaw));
      if (Number.isNaN(paidAt.getTime())) {
        res.status(400).json({ message: 'paidAt invalido.' });
        return;
      }
    }

    const r = await query(
      `update condo_unit_charges
       set status = 'paid',
           paid_at = $1,
           updated_at = now()
       where gateway_charge_id = $2
         and status = 'pending'
       returning id, unit_id`,
      [paidAt, gatewayChargeId],
    );
    if (r.rows.length === 0) {
      res.status(404).json({
        message: 'Cobranca nao encontrada ou ja liquidada/cancelada.',
      });
      return;
    }

    res.json({ ok: true, chargeId: r.rows[0].id });
  } catch (err) {
    next(err);
  }
}

export default router;
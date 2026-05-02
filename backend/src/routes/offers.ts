import { Router } from 'express';

import { isBillingStaff } from '../authz';
import { query } from '../db';

const router = Router();

const SCOPES = ['condo', 'resident', 'partner'] as const;
type Scope = (typeof SCOPES)[number];

const REDEMPTION_KINDS = ['coupon_code', 'loyalty_program'] as const;
type RedemptionKind = (typeof REDEMPTION_KINDS)[number];

const OFFER_CATEGORIES = [
  'Restaurantes',
  'Mercado',
  'Serviços',
  'Saúde',
  'Lazer',
  'Outros',
] as const;

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

function parseScope(raw: unknown): Scope | null {
  const s = String(raw ?? '').trim();
  if (SCOPES.includes(s as Scope)) {
    return s as Scope;
  }
  return null;
}

function parseCategory(raw: unknown): string {
  const s = String(raw ?? '').trim();
  return OFFER_CATEGORIES.includes(s as (typeof OFFER_CATEGORIES)[number])
    ? s
    : 'Outros';
}

function parseRedemptionKind(raw: unknown): RedemptionKind | null {
  const s = String(raw ?? '').trim();
  if (REDEMPTION_KINDS.includes(s as RedemptionKind)) {
    return s as RedemptionKind;
  }
  return null;
}

type AppUserRow = {
  id: number;
  condo_id: number;
  unit_id: number | null;
  full_name: string;
  role: string;
  active: boolean;
};

type OfferRow = {
  id: number;
  condo_id: number;
  scope: string;
  title: string;
  description: string | null;
  created_by_user_id: number;
  unit_id: number | null;
  partner_label: string | null;
  category: string;
  redemption_kind: string;
  coupon_text: string | null;
  program_instructions: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  contact_email: string | null;
  contact_url: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

async function loadUser(userId: number): Promise<AppUserRow | null> {
  const r = await query(
    `select id, condo_id, unit_id, full_name, role, active
     from app_users
     where id = $1
     limit 1`,
    [userId],
  );
  if (r.rows.length === 0) {
    return null;
  }
  return r.rows[0] as AppUserRow;
}

function roleMayCreateScope(user: AppUserRow, scope: Scope): boolean {
  if (scope === 'condo') {
    return isBillingStaff(user.role);
  }
  if (scope === 'resident') {
    return user.role === 'resident' && user.unit_id != null;
  }
  if (scope === 'partner') {
    return user.role === 'partner';
  }
  return false;
}

function mayModifyOffer(
  user: AppUserRow,
  offer: { condo_id: number; created_by_user_id: number },
): boolean {
  if (user.condo_id !== offer.condo_id) {
    return false;
  }
  if (isBillingStaff(user.role)) {
    return true;
  }
  return user.id === offer.created_by_user_id;
}

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoIdQuery(req.query.condoId);
    const scopeParam = req.query.scope;
    const scopeFilter =
      scopeParam !== undefined && String(scopeParam).trim() !== ''
        ? parseScope(scopeParam)
        : null;
    if (
      scopeFilter === null &&
      scopeParam !== undefined &&
      String(scopeParam).trim() !== ''
    ) {
      return res.status(400).json({
        message: 'scope deve ser condo, resident ou partner.',
      });
    }

    const catRaw = req.query.category;
    const categoryFilter =
      catRaw !== undefined &&
      catRaw !== null &&
      String(catRaw).trim() !== '' &&
      String(catRaw).trim().toLowerCase() !== 'todas'
        ? String(catRaw).trim()
        : null;

    const includeInactive = req.query.includeInactive === 'true';
    const forUserId = parsePositive(req.query.forUserId);

    const r = await query(
      `select o.id,
              o.condo_id,
              o.scope,
              o.title,
              o.description,
              o.created_by_user_id,
              o.unit_id,
              o.partner_label,
              o.category,
              o.redemption_kind,
              o.coupon_text,
              o.program_instructions,
              o.contact_phone,
              o.contact_whatsapp,
              o.contact_email,
              o.contact_url,
              o.active,
              o.created_at,
              o.updated_at,
              u.full_name as created_by_name,
              un.tower as unit_tower,
              un.number as unit_number,
              case
                when $5::integer is null then false
                else exists (
                  select 1 from condo_offer_enrollments e
                  where e.offer_id = o.id and e.user_id = $5::integer
                )
              end as viewer_enrolled
       from condo_offers o
       join app_users u on u.id = o.created_by_user_id
       left join units un on un.id = o.unit_id
       where o.condo_id = $1
         and ($2::text is null or o.scope = $2)
         and ($3::boolean or o.active = true)
         and (
           $4::text is null
           or trim($4::text) = ''
           or o.category = $4::text
         )
       order by o.created_at desc`,
      [condoId, scopeFilter, includeInactive, categoryFilter, forUserId],
    );

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
    const scope = parseScope(body.scope);
    const title = String(body.title ?? '').trim();
    const description = String(body.description ?? '').trim();
    const partnerLabelRaw = String(body.partnerLabel ?? '').trim();
    const category = parseCategory(body.category);
    const redemptionKind =
      parseRedemptionKind(body.redemptionKind) ?? 'coupon_code';
    const couponText = String(body.couponText ?? '').trim();
    const programInstructions = String(body.programInstructions ?? '').trim();
    const contactPhone = String(body.contactPhone ?? '').trim() || null;
    const contactWhatsapp = String(body.contactWhatsapp ?? '').trim() || null;
    const contactEmail = String(body.contactEmail ?? '').trim() || null;
    const contactUrl = String(body.contactUrl ?? '').trim() || null;

    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (scope == null) {
      return res.status(400).json({
        message: 'scope deve ser condo, resident ou partner.',
      });
    }
    if (!title) {
      return res.status(400).json({ message: 'title e obrigatorio.' });
    }
    if (redemptionKind === 'coupon_code' && !couponText) {
      return res.status(400).json({
        message: 'Informe o texto ou codigo do cupom para o modo cupom.',
      });
    }
    if (redemptionKind === 'loyalty_program' && !programInstructions) {
      return res.status(400).json({
        message: 'Informe como o morador adere ao programa.',
      });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (user.condo_id !== condoId) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }
    if (!roleMayCreateScope(user, scope)) {
      return res.status(403).json({
        message: 'Este perfil nao pode publicar ofertas nesta categoria.',
      });
    }

    let unitId: number | null = null;
    let partnerLabel: string | null = null;

    if (scope === 'condo') {
      unitId = null;
      partnerLabel = partnerLabelRaw || null;
    } else if (scope === 'resident') {
      unitId = user.unit_id as number;
      const uok = await query(`select id from units where id = $1 and condo_id = $2`, [
        unitId,
        condoId,
      ]);
      if (uok.rows.length === 0) {
        return res.status(400).json({ message: 'Unidade do morador invalida.' });
      }
    } else {
      unitId = null;
      partnerLabel = partnerLabelRaw || user.full_name || null;
    }

    const ins = await query(
      `insert into condo_offers (
         condo_id,
         scope,
         title,
         description,
         created_by_user_id,
         unit_id,
         partner_label,
         category,
         redemption_kind,
         coupon_text,
         program_instructions,
         contact_phone,
         contact_whatsapp,
         contact_email,
         contact_url
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       returning id,
                 condo_id,
                 scope,
                 title,
                 description,
                 created_by_user_id,
                 unit_id,
                 partner_label,
                 category,
                 redemption_kind,
                 coupon_text,
                 program_instructions,
                 contact_phone,
                 contact_whatsapp,
                 contact_email,
                 contact_url,
                 active,
                 created_at,
                 updated_at`,
      [
        condoId,
        scope,
        title,
        description || null,
        userId,
        unitId,
        partnerLabel,
        category,
        redemptionKind,
        couponText || null,
        programInstructions || null,
        contactPhone,
        contactWhatsapp,
        contactEmail,
        contactUrl,
      ],
    );

    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/enroll', async (req, res, next) => {
  try {
    const offerId = parsePositive(req.params.id);
    const body = req.body || {};
    const userId = parsePositive(body.userId);

    if (offerId == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (user.role !== 'resident') {
      return res.status(403).json({
        message: 'Somente moradores podem aderir ao programa da oferta.',
      });
    }
    if (user.unit_id == null) {
      return res.status(400).json({ message: 'Morador sem unidade vinculada.' });
    }

    const existing = await query(
      `select id,
              condo_id,
              redemption_kind,
              active
       from condo_offers
       where id = $1`,
      [offerId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Oferta nao encontrada.' });
    }
    const row = existing.rows[0] as {
      condo_id: number;
      redemption_kind: string;
      active: boolean;
    };
    if (row.condo_id !== user.condo_id) {
      return res.status(403).json({ message: 'Oferta de outro condominio.' });
    }
    if (!row.active) {
      return res.status(400).json({ message: 'Oferta inativa.' });
    }
    if (row.redemption_kind !== 'loyalty_program') {
      return res.status(400).json({
        message: 'Esta oferta usa cupom; nao ha adesao ao programa.',
      });
    }

    const ins = await query(
      `insert into condo_offer_enrollments (offer_id, user_id)
       values ($1, $2)
       on conflict (offer_id, user_id) do nothing
       returning id, enrolled_at`,
      [offerId, userId],
    );

    if (ins.rows.length === 0) {
      return res.status(200).json({
        enrolled: true,
        alreadyEnrolled: true,
        message: 'Voce ja havia aderido a esta oferta.',
      });
    }

    return res.status(201).json({
      enrolled: true,
      alreadyEnrolled: false,
      enrollment: ins.rows[0],
    });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const body = req.body || {};
    const userId = parsePositive(body.userId);

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

    const existing = await query(
      `select id,
              condo_id,
              scope,
              title,
              description,
              partner_label,
              category,
              redemption_kind,
              coupon_text,
              program_instructions,
              contact_phone,
              contact_whatsapp,
              contact_email,
              contact_url,
              active,
              created_by_user_id,
              unit_id,
              created_at,
              updated_at
       from condo_offers
       where id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Oferta nao encontrada.' });
    }
    const offer = existing.rows[0] as OfferRow;

    if (!mayModifyOffer(user, offer)) {
      return res.status(403).json({ message: 'Sem permissao para alterar esta oferta.' });
    }

    let nextTitle = offer.title;
    let nextDescription = offer.description;
    let nextPartnerLabel = offer.partner_label;
    let nextActive = offer.active;
    let nextCategory = offer.category;
    let nextRedemption = offer.redemption_kind as RedemptionKind;
    let nextCoupon = offer.coupon_text;
    let nextProgram = offer.program_instructions;
    let nextPhone = offer.contact_phone;
    let nextWa = offer.contact_whatsapp;
    let nextEmail = offer.contact_email;
    let nextUrl = offer.contact_url;
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
      nextDescription = String(body.description ?? '').trim() || null;
      changed = true;
    }
    if (body.partnerLabel !== undefined) {
      nextPartnerLabel = String(body.partnerLabel ?? '').trim() || null;
      changed = true;
    }
    if (body.category !== undefined) {
      nextCategory = parseCategory(body.category);
      changed = true;
    }
    if (body.redemptionKind !== undefined) {
      const rk = parseRedemptionKind(body.redemptionKind);
      if (rk == null) {
        return res.status(400).json({ message: 'redemptionKind invalido.' });
      }
      nextRedemption = rk;
      changed = true;
    }
    if (body.couponText !== undefined) {
      nextCoupon = String(body.couponText ?? '').trim() || null;
      changed = true;
    }
    if (body.programInstructions !== undefined) {
      nextProgram = String(body.programInstructions ?? '').trim() || null;
      changed = true;
    }
    if (body.contactPhone !== undefined) {
      nextPhone = String(body.contactPhone ?? '').trim() || null;
      changed = true;
    }
    if (body.contactWhatsapp !== undefined) {
      nextWa = String(body.contactWhatsapp ?? '').trim() || null;
      changed = true;
    }
    if (body.contactEmail !== undefined) {
      nextEmail = String(body.contactEmail ?? '').trim() || null;
      changed = true;
    }
    if (body.contactUrl !== undefined) {
      nextUrl = String(body.contactUrl ?? '').trim() || null;
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

    if (nextRedemption === 'coupon_code' && !(nextCoupon ?? '').trim()) {
      return res.status(400).json({
        message: 'Modo cupom exige texto ou codigo do cupom.',
      });
    }
    if (nextRedemption === 'loyalty_program' && !(nextProgram ?? '').trim()) {
      return res.status(400).json({
        message: 'Modo programa exige instrucoes de adesao.',
      });
    }

    if (!changed) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    const r = await query(
      `update condo_offers
       set title = $2,
           description = $3,
           partner_label = $4,
           active = $5,
           category = $6,
           redemption_kind = $7,
           coupon_text = $8,
           program_instructions = $9,
           contact_phone = $10,
           contact_whatsapp = $11,
           contact_email = $12,
           contact_url = $13,
           updated_at = now()
       where id = $1
       returning id,
                 condo_id,
                 scope,
                 title,
                 description,
                 created_by_user_id,
                 unit_id,
                 partner_label,
                 category,
                 redemption_kind,
                 coupon_text,
                 program_instructions,
                 contact_phone,
                 contact_whatsapp,
                 contact_email,
                 contact_url,
                 active,
                 created_at,
                 updated_at`,
      [
        id,
        nextTitle,
        nextDescription,
        nextPartnerLabel,
        nextActive,
        nextCategory,
        nextRedemption,
        nextCoupon,
        nextProgram,
        nextPhone,
        nextWa,
        nextEmail,
        nextUrl,
      ],
    );

    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
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

    const existing = await query(
      `select id, condo_id, created_by_user_id from condo_offers where id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Oferta nao encontrada.' });
    }
    const offer = existing.rows[0] as { condo_id: number; created_by_user_id: number };
    if (!mayModifyOffer(user, offer)) {
      return res.status(403).json({ message: 'Sem permissao para excluir esta oferta.' });
    }

    await query(`delete from condo_offers where id = $1`, [id]);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;

import { Router } from 'express';

import { isBillingStaff } from '../authz';
import { query } from '../db';

const router = Router();

const POLL_KINDS = ['survey', 'formal_ballot'] as const;
type PollKind = (typeof POLL_KINDS)[number];

const POLL_STATUSES = ['draft', 'open', 'closed'] as const;
type PollStatus = (typeof POLL_STATUSES)[number];

const POLL_ELIGIBLE_APP_ROLES = [
  'resident',
  'collaborator',
  'partner',
  'syndic',
  'administrator',
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

function parseKind(raw: unknown): PollKind | null {
  const s = String(raw ?? '').trim();
  if (POLL_KINDS.includes(s as PollKind)) {
    return s as PollKind;
  }
  return null;
}

function parseStatus(raw: unknown): PollStatus | null {
  const s = String(raw ?? '').trim();
  if (POLL_STATUSES.includes(s as PollStatus)) {
    return s as PollStatus;
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

/** Qualquer perfil ativo do condomínio pode criar enquete. */
function canCreatePoll(user: AppUserRow, condoId: number): boolean {
  return user.active === true && user.condo_id === condoId;
}

/** Editar/apagar/opções: criador ou síndico/administração. */
function canEditPollRow(
  user: AppUserRow,
  condoId: number,
  createdByUserId: number,
): boolean {
  if (!user.active || user.condo_id !== condoId) {
    return false;
  }
  if (isBillingStaff(user.role)) {
    return true;
  }
  return user.id === createdByUserId;
}

function parseEligibleRoles(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const allowed = POLL_ELIGIBLE_APP_ROLES as readonly string[];
  const out: string[] = [];
  for (const x of raw) {
    const s = String(x ?? '').trim();
    if (!allowed.includes(s)) {
      return null;
    }
    if (!out.includes(s)) {
      out.push(s);
    }
  }
  return out.length > 0 ? out : null;
}

function userMayVoteOnPoll(
  user: AppUserRow,
  condoId: number,
  eligibleRoles: string[],
): boolean {
  if (!user.active || user.condo_id !== condoId) {
    return false;
  }
  if (!eligibleRoles.includes(user.role)) {
    return false;
  }
  if (user.role === 'resident' && user.unit_id == null) {
    return false;
  }
  return true;
}

async function autoCloseExpiredPollsForCondo(condoId: number): Promise<void> {
  await query(
    `update condo_polls
     set status = 'closed', updated_at = now()
     where condo_id = $1
       and status = 'open'
       and closes_at is not null
       and closes_at <= now()`,
    [condoId],
  );
}

async function autoCloseExpiredPollById(
  pollId: number,
  condoId: number,
): Promise<void> {
  await query(
    `update condo_polls
     set status = 'closed', updated_at = now()
     where id = $1
       and condo_id = $2
       and status = 'open'
       and closes_at is not null
       and closes_at <= now()`,
    [pollId, condoId],
  );
}

async function countOptions(pollId: number): Promise<number> {
  const r = await query(
    `select count(*)::int as c from condo_poll_options where poll_id = $1`,
    [pollId],
  );
  return (r.rows[0]?.c as number) ?? 0;
}

type OptionResult = {
  id: number;
  label: string;
  sort_order: number;
  vote_count: number;
  percent: number;
};

async function fetchAggregatedResults(pollId: number): Promise<{
  totalVotes: number;
  options: OptionResult[];
}> {
  const r = await query(
    `select o.id,
            o.label,
            o.sort_order,
            count(v.id)::int as vote_count
     from condo_poll_options o
     left join condo_poll_votes v on v.option_id = o.id
     where o.poll_id = $1
     group by o.id, o.label, o.sort_order
     order by o.sort_order asc, o.id asc`,
    [pollId],
  );
  const total = (r.rows as { vote_count: number }[]).reduce(
    (s, row) => s + row.vote_count,
    0,
  );
  const options: OptionResult[] = (r.rows as OptionResult[]).map((row) => ({
    id: row.id,
    label: row.label,
    sort_order: row.sort_order,
    vote_count: row.vote_count,
    percent:
      total > 0 ? Math.round((row.vote_count * 1000) / total) / 10 : 0,
  }));
  return { totalVotes: total, options };
}

/** Evita join falso quando nao ha userId: id 0 nunca existe. */
function joinVoteUserId(id: number): number {
  return id > 0 ? id : 0;
}

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoIdQuery(req.query.condoId);
    await autoCloseExpiredPollsForCondo(condoId);

    const userId = parsePositive(req.query.userId);
    const user = userId != null ? await loadUser(userId) : null;

    if (user != null && user.active !== true) {
      return res.status(403).json({ message: 'Usuario inativo.' });
    }
    if (user != null && user.condo_id !== condoId) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    const kindParam = req.query.kind;
    const kindFilter =
      kindParam !== undefined && String(kindParam).trim() !== ''
        ? parseKind(kindParam)
        : null;
    if (
      kindFilter === null &&
      kindParam !== undefined &&
      String(kindParam).trim() !== ''
    ) {
      return res.status(400).json({
        message: 'kind deve ser survey (enquete) ou formal_ballot (votacao formal).',
      });
    }

    const billingStaff = user != null && isBillingStaff(user.role);
    const joinVoteUid = userId != null && userId > 0 ? userId : 0;
    const viewerId = user?.id ?? 0;

    let sql = `select p.id,
                      p.condo_id,
                      p.kind,
                      p.title,
                      p.description,
                      p.status,
                      p.opens_at,
                      p.closes_at,
                      p.eligible_roles,
                      p.created_by_user_id,
                      p.created_at,
                      p.updated_at,
                      (select count(*)::int from condo_poll_options o where o.poll_id = p.id) as option_count,
                      (select count(*)::int from condo_poll_votes v where v.poll_id = p.id) as total_votes,
                      pv.option_id as my_vote_option_id
               from condo_polls p
               left join condo_poll_votes pv
                 on pv.poll_id = p.id and pv.user_id = $2
               where p.condo_id = $1`;

    const params: unknown[] = [condoId, joinVoteUserId(joinVoteUid)];

    if (userId == null || viewerId < 1) {
      sql += ` and p.status in ('open', 'closed')`;
    } else {
      sql += ` and (
        p.status in ('open', 'closed')
        or (
          p.status = 'draft'
          and (
            $3::boolean = true
            or p.created_by_user_id = $4
          )
        )
      )`;
      params.push(billingStaff, viewerId);
    }

    if (kindFilter != null) {
      sql += ` and p.kind = $${params.length + 1}`;
      params.push(kindFilter);
    }

    sql += ` order by p.created_at desc`;

    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }

    await autoCloseExpiredPollById(id, condoId);

    const user = userId != null ? await loadUser(userId) : null;
    if (user != null && user.active !== true) {
      return res.status(403).json({ message: 'Usuario inativo.' });
    }
    if (user != null && user.condo_id !== condoId) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    const billingStaff = user != null && isBillingStaff(user.role);

    const pr = await query(
      `select id,
              condo_id,
              kind,
              title,
              description,
              status,
              opens_at,
              closes_at,
              eligible_roles,
              created_by_user_id,
              created_at,
              updated_at
       from condo_polls
       where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (pr.rows.length === 0) {
      return res.status(404).json({ message: 'Enquete ou votacao nao encontrada.' });
    }
    const poll = pr.rows[0] as {
      id: number;
      status: string;
      created_by_user_id: number;
      eligible_roles: string[];
    };

    const viewerId = user?.id ?? 0;
    const maySeeDraft =
      billingStaff ||
      (poll.status === 'draft' && viewerId === poll.created_by_user_id);

    if (poll.status === 'draft' && !maySeeDraft) {
      return res.status(404).json({ message: 'Enquete ou votacao nao encontrada.' });
    }

    const eligibleRoles = Array.isArray(poll.eligible_roles)
      ? poll.eligible_roles
      : ['resident'];

    const { totalVotes, options } = await fetchAggregatedResults(id);

    let myVoteOptionId: number | null = null;
    if (userId != null && userId > 0) {
      const vr = await query(
        `select option_id from condo_poll_votes where poll_id = $1 and user_id = $2`,
        [id, userId],
      );
      if (vr.rows.length > 0) {
        myVoteOptionId = vr.rows[0].option_id as number;
      }
    }

    const resultsPhase = poll.status === 'closed' ? 'final' : 'partial';

    const mayVote =
      user != null &&
      poll.status === 'open' &&
      userMayVoteOnPoll(user, condoId, eligibleRoles);

    return res.json({
      ...poll,
      eligibleRoles,
      resultsPhase,
      totalVotes,
      /** Moradores/parceiros veem apenas totais agregados (sem identificacao de votantes). */
      results: options.map((o) => ({
        optionId: o.id,
        label: o.label,
        sortOrder: o.sort_order,
        voteCount: o.vote_count,
        percent: o.percent,
      })),
      myVoteOptionId,
      mayVote,
    });
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
    let kind: PollKind = 'survey';
    if (
      body.kind !== undefined &&
      body.kind !== null &&
      String(body.kind).trim() !== ''
    ) {
      const k = parseKind(body.kind);
      if (k == null) {
        return res.status(400).json({
          message: 'kind deve ser survey (enquete) ou formal_ballot (votacao formal).',
        });
      }
      kind = k;
    }
    const title = String(body.title ?? '').trim();
    const description = String(body.description ?? '').trim() || null;

    const rolesRaw = body.eligibleRoles ?? body.eligible_roles;
    let eligibleRoles: string[];
    if (rolesRaw === undefined) {
      eligibleRoles = ['resident'];
    } else {
      const parsed = parseEligibleRoles(rolesRaw);
      if (parsed == null) {
        return res.status(400).json({
          message:
            'eligibleRoles deve ser um array com pelo menos um perfil: resident, collaborator, partner, syndic, administrator.',
        });
      }
      eligibleRoles = parsed;
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
    if (user == null || !canCreatePoll(user, condoId)) {
      return res.status(403).json({
        message: 'Sem permissao para criar enquete neste condominio.',
      });
    }

    const ins = await query(
      `insert into condo_polls (
         condo_id, kind, title, description, status, created_by_user_id, eligible_roles
       )
       values ($1, $2, $3, $4, 'draft', $5, $6::text[])
       returning id,
                 condo_id,
                 kind,
                 title,
                 description,
                 status,
                 opens_at,
                 closes_at,
                 eligible_roles,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [condoId, kind, title, description, userId, eligibleRoles],
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
    if (user == null) {
      return res.status(403).json({ message: 'Usuario invalido.' });
    }

    const existing = await query(
      `select id, condo_id, status, created_by_user_id from condo_polls where id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Nao encontrado.' });
    }
    const row = existing.rows[0] as {
      condo_id: number;
      status: string;
      created_by_user_id: number;
    };
    if (row.condo_id !== condoId) {
      return res.status(403).json({ message: 'Item pertence a outro condominio.' });
    }
    if (!canEditPollRow(user, condoId, row.created_by_user_id)) {
      return res.status(403).json({
        message:
          'Apenas quem criou a enquete ou a administracao/sindico podem alterar.',
      });
    }

    let nextTitle: string | undefined;
    let nextDesc: string | null | undefined;
    let nextStatus: PollStatus | undefined;
    let nextOpens: Date | null | undefined;
    let nextCloses: Date | null | undefined;
    let nextKind: PollKind | undefined;
    let nextEligible: string[] | undefined;
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
    if (body.status !== undefined) {
      const s = parseStatus(body.status);
      if (s == null) {
        return res.status(400).json({
          message: 'status deve ser draft, open ou closed.',
        });
      }
      nextStatus = s;
      changed = true;
    }
    if (body.kind !== undefined && String(body.kind).trim() !== '') {
      const k = parseKind(body.kind);
      if (k == null) {
        return res.status(400).json({
          message: 'kind deve ser survey ou formal_ballot.',
        });
      }
      nextKind = k;
      changed = true;
    }
    if (body.opensAt !== undefined || body.opens_at !== undefined) {
      const raw = body.opensAt ?? body.opens_at;
      if (raw === null || String(raw).trim() === '') {
        nextOpens = null;
      } else {
        const d = new Date(String(raw));
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: 'opensAt invalido.' });
        }
        nextOpens = d;
      }
      changed = true;
    }
    if (body.closesAt !== undefined || body.closes_at !== undefined) {
      const raw = body.closesAt ?? body.closes_at;
      if (raw === null || String(raw).trim() === '') {
        nextCloses = null;
      } else {
        const d = new Date(String(raw));
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: 'closesAt invalido.' });
        }
        nextCloses = d;
      }
      changed = true;
    }
    if (body.eligibleRoles !== undefined || body.eligible_roles !== undefined) {
      const raw = body.eligibleRoles ?? body.eligible_roles;
      const parsed = parseEligibleRoles(raw);
      if (parsed == null) {
        return res.status(400).json({
          message:
            'eligibleRoles invalido: use array de resident, collaborator, partner, syndic, administrator.',
        });
      }
      nextEligible = parsed;
      changed = true;
    }

    if (!changed) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    if (row.status !== 'draft' && nextEligible !== undefined) {
      return res.status(400).json({
        message: 'Publico permitido so pode ser alterado em rascunho.',
      });
    }

    if (nextStatus === 'open') {
      const nOpt = await countOptions(id);
      if (nOpt < 2) {
        return res.status(400).json({
          message: 'E preciso pelo menos duas opcoes para abrir a votacao.',
        });
      }
    }

    if (nextStatus === 'closed' && row.status === 'draft') {
      return res.status(400).json({
        message: 'Nao e possivel encerrar diretamente um rascunho; abra antes.',
      });
    }

    const cur = await query(
      `select title, description, status, kind, opens_at, closes_at, eligible_roles
       from condo_polls where id = $1`,
      [id],
    );
    const c = cur.rows[0] as {
      title: string;
      description: string | null;
      status: string;
      kind: string;
      opens_at: Date | null;
      closes_at: Date | null;
      eligible_roles: string[];
    };

    const titleF = nextTitle ?? c.title;
    const descF = nextDesc !== undefined ? nextDesc : c.description;
    const statusF = nextStatus ?? (c.status as PollStatus);
    const kindF = nextKind ?? (c.kind as PollKind);
    const opensF = nextOpens !== undefined ? nextOpens : c.opens_at;
    const closesF = nextCloses !== undefined ? nextCloses : c.closes_at;
    const eligibleF =
      nextEligible !== undefined ? nextEligible : c.eligible_roles;

    const r = await query(
      `update condo_polls
       set title = $2,
           description = $3,
           status = $4,
           kind = $5,
           opens_at = $6,
           closes_at = $7,
           eligible_roles = $8::text[],
           updated_at = now()
       where id = $1
       returning id,
                 condo_id,
                 kind,
                 title,
                 description,
                 status,
                 opens_at,
                 closes_at,
                 eligible_roles,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [
        id,
        titleF,
        descF,
        statusF,
        kindF,
        opensF,
        closesF,
        eligibleF,
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
    if (user == null) {
      return res.status(403).json({ message: 'Usuario invalido.' });
    }

    const found = await query(
      `select created_by_user_id from condo_polls where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (found.rows.length === 0) {
      return res.status(404).json({ message: 'Nao encontrado.' });
    }
    const createdBy = (found.rows[0] as { created_by_user_id: number })
      .created_by_user_id;
    if (!canEditPollRow(user, condoId, createdBy)) {
      return res.status(403).json({
        message:
          'Apenas quem criou a enquete ou a administracao/sindico podem excluir.',
      });
    }

    const del = await query(
      `delete from condo_polls where id = $1 and condo_id = $2 returning id`,
      [id, condoId],
    );
    if (del.rows.length === 0) {
      return res.status(404).json({ message: 'Nao encontrado.' });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/options', async (req, res, next) => {
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
    const label = String(body.label ?? '').trim();
    const sortOrderRaw = body.sortOrder ?? body.sort_order;
    const sortOrder =
      sortOrderRaw !== undefined &&
      sortOrderRaw !== null &&
      String(sortOrderRaw).trim() !== ''
        ? Number(sortOrderRaw)
        : 0;

    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (!label) {
      return res.status(400).json({ message: 'label e obrigatorio.' });
    }
    if (!Number.isFinite(sortOrder)) {
      return res.status(400).json({ message: 'sortOrder invalido.' });
    }

    const user = await loadUser(userId);
    if (user == null) {
      return res.status(403).json({ message: 'Usuario invalido.' });
    }

    const pr = await query(
      `select id, status, created_by_user_id from condo_polls where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (pr.rows.length === 0) {
      return res.status(404).json({ message: 'Nao encontrado.' });
    }
    const prow = pr.rows[0] as { status: string; created_by_user_id: number };
    if (!canEditPollRow(user, condoId, prow.created_by_user_id)) {
      return res.status(403).json({
        message: 'Sem permissao para adicionar opcoes.',
      });
    }
    if (prow.status !== 'draft') {
      return res.status(400).json({
        message: 'Opcoes so podem ser incluidas enquanto a enquete estiver em rascunho.',
      });
    }

    const ins = await query(
      `insert into condo_poll_options (poll_id, label, sort_order)
       values ($1, $2, $3)
       returning id, poll_id, label, sort_order, created_at`,
      [id, label, sortOrder],
    );

    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id/options/:optionId', async (req, res, next) => {
  try {
    const pollId = parsePositive(req.params.id);
    const optionId = parsePositive(req.params.optionId);
    const body = req.body || {};
    const condoIdBody = body.condoId;
    const condoId =
      condoIdBody !== undefined &&
      condoIdBody !== null &&
      String(condoIdBody).trim() !== ''
        ? Number(condoIdBody)
        : NaN;
    const userId = parsePositive(body.userId);
    const label = String(body.label ?? '').trim();

    if (pollId == null || optionId == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (!label) {
      return res.status(400).json({ message: 'label e obrigatorio.' });
    }

    const user = await loadUser(userId);
    if (user == null) {
      return res.status(403).json({ message: 'Usuario invalido.' });
    }

    const pr = await query(
      `select p.id, p.status, p.created_by_user_id
       from condo_polls p
       join condo_poll_options o on o.poll_id = p.id
       where p.id = $1 and p.condo_id = $2 and o.id = $3`,
      [pollId, condoId, optionId],
    );
    if (pr.rows.length === 0) {
      return res.status(404).json({ message: 'Opcao nao encontrada.' });
    }
    const prow = pr.rows[0] as {
      status: string;
      created_by_user_id: number;
    };
    if (!canEditPollRow(user, condoId, prow.created_by_user_id)) {
      return res.status(403).json({
        message: 'Sem permissao.',
      });
    }
    if (prow.status !== 'draft') {
      return res.status(400).json({
        message: 'So e permitido editar opcoes em rascunho.',
      });
    }

    const r = await query(
      `update condo_poll_options
       set label = $2
       where id = $1 and poll_id = $3
       returning id, poll_id, label, sort_order, created_at`,
      [optionId, label, pollId],
    );

    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id/options/:optionId', async (req, res, next) => {
  try {
    const pollId = parsePositive(req.params.id);
    const optionId = parsePositive(req.params.optionId);
    const condoId =
      req.query.condoId !== undefined && String(req.query.condoId).trim() !== ''
        ? Number(req.query.condoId)
        : NaN;
    const userId = parsePositive(req.query.userId);

    if (pollId == null || optionId == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId);
    if (user == null) {
      return res.status(403).json({ message: 'Usuario invalido.' });
    }

    const pr = await query(
      `select p.status, p.created_by_user_id
       from condo_polls p
       join condo_poll_options o on o.poll_id = p.id
       where p.id = $1 and p.condo_id = $2 and o.id = $3`,
      [pollId, condoId, optionId],
    );
    if (pr.rows.length === 0) {
      return res.status(404).json({ message: 'Opcao nao encontrada.' });
    }
    const prow = pr.rows[0] as {
      status: string;
      created_by_user_id: number;
    };
    if (!canEditPollRow(user, condoId, prow.created_by_user_id)) {
      return res.status(403).json({ message: 'Sem permissao.' });
    }
    if (prow.status !== 'draft') {
      return res.status(400).json({
        message: 'So e possivel remover opcoes em rascunho.',
      });
    }

    const voteOnOption = await query(
      `select count(*)::int as c from condo_poll_votes where option_id = $1`,
      [optionId],
    );
    if (((voteOnOption.rows[0] as { c: number })?.c ?? 0) > 0) {
      return res.status(409).json({ message: 'Opcao ja recebeu votos.' });
    }

    await query(
      `delete from condo_poll_options where id = $1 and poll_id = $2`,
      [optionId, pollId],
    );
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/vote', async (req, res, next) => {
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
    const optionId = parsePositive(body.optionId ?? body.option_id);

    if (id == null) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (optionId == null) {
      return res.status(400).json({ message: 'optionId e obrigatorio.' });
    }

    await autoCloseExpiredPollById(id, condoId);

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }

    const pr = await query(
      `select id, status, eligible_roles from condo_polls where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (pr.rows.length === 0) {
      return res.status(404).json({ message: 'Nao encontrado.' });
    }
    const pollRow = pr.rows[0] as {
      status: string;
      eligible_roles: string[];
    };
    const eligibleRoles = Array.isArray(pollRow.eligible_roles)
      ? pollRow.eligible_roles
      : ['resident'];

    if (!userMayVoteOnPoll(user, condoId, eligibleRoles)) {
      return res.status(403).json({
        message:
          'Seu perfil nao esta autorizado a votar nesta enquete ou falta vinculo de unidade (morador).',
      });
    }

    if (pollRow.status !== 'open') {
      return res.status(400).json({
        message: 'A votacao nao esta aberta.',
      });
    }

    const okOpt = await query(
      `select id from condo_poll_options where id = $1 and poll_id = $2`,
      [optionId, id],
    );
    if (okOpt.rows.length === 0) {
      return res.status(400).json({ message: 'Opcao invalida para esta enquete.' });
    }

    try {
      const ins = await query(
        `insert into condo_poll_votes (poll_id, user_id, option_id)
         values ($1, $2, $3)
         returning id, poll_id, user_id, option_id, voted_at`,
        [id, userId, optionId],
      );
      const { totalVotes, options } = await fetchAggregatedResults(id);
      return res.status(201).json({
        vote: ins.rows[0],
        resultsPhase: 'partial',
        totalVotes,
        results: options.map((o) => ({
          optionId: o.id,
          label: o.label,
          sortOrder: o.sort_order,
          voteCount: o.vote_count,
          percent: o.percent,
        })),
      });
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === '23505') {
        return res.status(409).json({
          message: 'Este usuario ja votou nesta enquete.',
        });
      }
      throw e;
    }
  } catch (err) {
    return next(err);
  }
});

export default router;

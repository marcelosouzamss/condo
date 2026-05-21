import { Router } from 'express';

import { query } from '../db';

const router = Router();

const CHANNELS = ['syndic', 'administration', 'doorman', 'collaborator'] as const;
type RelationChannel = (typeof CHANNELS)[number];

const SENDER_SIDES = ['resident', 'staff', 'partner'] as const;
type SenderSide = (typeof SENDER_SIDES)[number];

function parseCondoId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return 1;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parseChannel(raw: unknown): RelationChannel | null {
  const s = String(raw ?? '').trim();
  if (CHANNELS.includes(s as RelationChannel)) {
    return s as RelationChannel;
  }
  return null;
}

function parseSenderSide(raw: unknown): SenderSide | null {
  const s = String(raw ?? '').trim();
  if (s === 'resident' || s === 'staff' || s === 'partner') {
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

async function assertActivePartner(userId: number): Promise<boolean> {
  const r = await query(
    `select 1 from app_users where id = $1 and active = true and role = 'partner' limit 1`,
    [userId],
  );
  return r.rows.length > 0;
}

async function ensureThread(
  condoId: number,
  unitId: number,
  channel: RelationChannel,
): Promise<number> {
  const existing = await query(
    `select id from relation_threads
     where condo_id = $1 and unit_id = $2 and channel = $3`,
    [condoId, unitId, channel],
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id as number;
  }
  const ins = await query(
    `insert into relation_threads (condo_id, unit_id, channel)
     values ($1, $2, $3)
     returning id`,
    [condoId, unitId, channel],
  );
  return ins.rows[0].id as number;
}

async function ensurePartnerThread(
  condoId: number,
  partnerUserId: number,
  channel: RelationChannel,
): Promise<number> {
  const existing = await query(
    `select id from relation_threads
     where condo_id = $1 and partner_user_id = $2 and channel = $3`,
    [condoId, partnerUserId, channel],
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id as number;
  }
  const ins = await query(
    `insert into relation_threads (condo_id, unit_id, partner_user_id, channel)
     values ($1, null, $2, $3)
     returning id`,
    [condoId, partnerUserId, channel],
  );
  return ins.rows[0].id as number;
}

/** Lista conversas por canal, ordenadas pela última mensagem. */
router.get('/inbox', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const channel = parseChannel(req.query.channel);
    if (channel == null) {
      return res.status(400).json({ message: 'channel invalido.' });
    }

    const r = await query(
      `select t.id as thread_id,
              t.unit_id,
              t.partner_user_id,
              t.channel,
              t.last_message_at,
              t.created_at,
              u.tower as unit_tower,
              u.number as unit_number,
              coalesce(u.resident_name, pu.full_name) as resident_name,
              (select m.body
               from relation_messages m
               where m.thread_id = t.id
               order by m.created_at desc
               limit 1) as last_message_body
       from relation_threads t
       left join units u on u.id = t.unit_id
       left join app_users pu on pu.id = t.partner_user_id
       where t.condo_id = $1 and t.channel = $2
       order by t.last_message_at desc nulls last,
                t.created_at desc`,
      [condoId, channel],
    );

    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

/** Resumo das duas linhas de conversa da unidade (última mensagem por canal). */
router.get('/unit-summary', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const unitId = Number(req.query.unitId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (!Number.isFinite(unitId) || unitId < 1) {
      return res.status(400).json({ message: 'unitId invalido.' });
    }
    if (!(await assertUnitInCondo(condoId, unitId))) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }

    const r = await query(
      `select t.channel,
              t.last_message_at,
              (select m.body
               from relation_messages m
               where m.thread_id = t.id
               order by m.created_at desc
               limit 1) as last_message_body
       from relation_threads t
       where t.condo_id = $1 and t.unit_id = $2`,
      [condoId, unitId],
    );

    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

/** Conversa morador: mensagens por unidade + canal (thread criada no primeiro envio). */
router.get('/conversation', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const unitId = Number(req.query.unitId);
    const channel = parseChannel(req.query.channel);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (!Number.isFinite(unitId) || unitId < 1) {
      return res.status(400).json({ message: 'unitId invalido.' });
    }
    if (channel == null) {
      return res.status(400).json({ message: 'channel invalido.' });
    }
    if (!(await assertUnitInCondo(condoId, unitId))) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }

    const tr = await query(
      `select t.id, t.channel, t.unit_id, t.last_message_at, t.created_at
       from relation_threads t
       where t.condo_id = $1 and t.unit_id = $2 and t.channel = $3`,
      [condoId, unitId, channel],
    );

    if (tr.rows.length === 0) {
      return res.json({ thread: null, messages: [] });
    }

    const threadId = tr.rows[0].id as number;
    const msgs = await query(
      `select id, sender_side, body, created_at
       from relation_messages
       where thread_id = $1
       order by created_at asc`,
      [threadId],
    );

    return res.json({ thread: tr.rows[0], messages: msgs.rows });
  } catch (err) {
    return next(err);
  }
});

/** Conversa parceiro → equipe do condomínio (sem unidade). */
router.get('/partner-conversation', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const channel = parseChannel(req.query.channel);
    const partnerUserId = Number(req.query.userId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (channel == null) {
      return res.status(400).json({ message: 'channel invalido.' });
    }
    if (!Number.isFinite(partnerUserId) || partnerUserId < 1) {
      return res.status(400).json({ message: 'userId invalido.' });
    }
    if (!(await assertActivePartner(partnerUserId))) {
      return res.status(403).json({ message: 'Usuario nao e parceiro ativo.' });
    }

    const tr = await query(
      `select t.id, t.channel, t.unit_id, t.partner_user_id, t.last_message_at, t.created_at
       from relation_threads t
       where t.condo_id = $1 and t.partner_user_id = $2 and t.channel = $3`,
      [condoId, partnerUserId, channel],
    );

    if (tr.rows.length === 0) {
      return res.json({ thread: null, messages: [] });
    }

    const threadId = tr.rows[0].id as number;
    const msgs = await query(
      `select id, sender_side, body, created_at
       from relation_messages
       where thread_id = $1
       order by created_at asc`,
      [threadId],
    );

    return res.json({ thread: tr.rows[0], messages: msgs.rows });
  } catch (err) {
    return next(err);
  }
});

/** Thread + mensagens (área da equipe). */
router.get('/threads/:threadId', async (req, res, next) => {
  try {
    const threadId = Number(req.params.threadId);
    const condoId = parseCondoId(req.query.condoId);
    if (!Number.isFinite(threadId) || threadId < 1) {
      return res.status(400).json({ message: 'threadId invalido.' });
    }
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const tr = await query(
      `select t.id, t.condo_id, t.unit_id, t.partner_user_id, t.channel, t.last_message_at, t.created_at,
              u.tower as unit_tower, u.number as unit_number, u.resident_name,
              pu.full_name as partner_name
       from relation_threads t
       left join units u on u.id = t.unit_id
       left join app_users pu on pu.id = t.partner_user_id
       where t.id = $1 and t.condo_id = $2`,
      [threadId, condoId],
    );

    if (tr.rows.length === 0) {
      return res.status(404).json({ message: 'Conversa nao encontrada.' });
    }

    const msgs = await query(
      `select id, sender_side, body, created_at
       from relation_messages
       where thread_id = $1
       order by created_at asc`,
      [threadId],
    );

    return res.json({ thread: tr.rows[0], messages: msgs.rows });
  } catch (err) {
    return next(err);
  }
});

router.post('/messages', async (req, res, next) => {
  try {
    const condoId = parseCondoId((req.body || {}).condoId);
    const bodyText = String((req.body || {}).body ?? '').trim();
    const senderSide = parseSenderSide((req.body || {}).senderSide);
    const threadIdRaw = (req.body || {}).threadId as unknown;
    const unitIdRaw = (req.body || {}).unitId as unknown;
    const channelRaw = (req.body || {}).channel as unknown;
    const partnerUserIdRaw = (req.body || {}).partnerUserId as unknown;

    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (!bodyText) {
      return res.status(400).json({ message: 'body e obrigatorio.' });
    }
    if (senderSide == null) {
      return res.status(400).json({ message: 'senderSide invalido.' });
    }

    let threadId: number;
    if (threadIdRaw !== undefined && threadIdRaw !== null && threadIdRaw !== '') {
      const parsedThread = Number(threadIdRaw);
      if (!Number.isFinite(parsedThread) || parsedThread < 1) {
        return res.status(400).json({ message: 'threadId invalido.' });
      }
      const row = await query(
        `select id, partner_user_id, unit_id from relation_threads where id = $1 and condo_id = $2`,
        [parsedThread, condoId],
      );
      if (row.rows.length === 0) {
        return res.status(404).json({ message: 'Conversa nao encontrada.' });
      }
      const th = row.rows[0] as {
        id: number;
        partner_user_id: number | null;
        unit_id: number | null;
      };

      if (senderSide === 'partner') {
        const puid = Number(partnerUserIdRaw);
        if (
          !Number.isFinite(puid) ||
          puid < 1 ||
          th.partner_user_id == null ||
          puid !== th.partner_user_id
        ) {
          return res.status(403).json({ message: 'partnerUserId nao coincide com esta conversa.' });
        }
      } else if (senderSide === 'resident') {
        const fromBody = Number(unitIdRaw);
        if (
          th.unit_id == null ||
          !Number.isFinite(fromBody) ||
          fromBody !== th.unit_id
        ) {
          return res.status(403).json({ message: 'unitId nao coincide com esta conversa.' });
        }
      }

      threadId = th.id;
    } else {
      const unitId = Number(unitIdRaw);
      const channel = parseChannel(channelRaw);

      if (senderSide === 'partner') {
        const partnerUserId = Number(partnerUserIdRaw);
        const channelPartner = parseChannel(channelRaw);
        if (
          !Number.isFinite(partnerUserId) ||
          partnerUserId < 1 ||
          channelPartner == null
        ) {
          return res.status(400).json({
            message: 'Para parceiro informe partnerUserId e channel.',
          });
        }
        if (!(await assertActivePartner(partnerUserId))) {
          return res.status(403).json({ message: 'Usuario nao e parceiro ativo.' });
        }
        threadId = await ensurePartnerThread(condoId, partnerUserId, channelPartner);
      } else {
        if (!Number.isFinite(unitId) || unitId < 1 || channel == null) {
          return res
            .status(400)
            .json({ message: 'Para novo envio informe unitId e channel, ou threadId.' });
        }
        if (!(await assertUnitInCondo(condoId, unitId))) {
          return res.status(404).json({ message: 'Unidade nao encontrada.' });
        }
        threadId = await ensureThread(condoId, unitId, channel);
      }
    }

    const ins = await query(
      `insert into relation_messages (thread_id, sender_side, body)
       values ($1, $2, $3)
       returning id, thread_id, sender_side, body, created_at`,
      [threadId, senderSide, bodyText],
    );

    await query(
      `update relation_threads
       set last_message_at = $2
       where id = $1`,
      [threadId, ins.rows[0].created_at],
    );

    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

export default router;

import { Router } from 'express';

import { isBillingStaff } from '../authz';
import { query } from '../db';

const router = Router();

const VISIBILITIES = ['public', 'private'] as const;
type Visibility = (typeof VISIBILITIES)[number];

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
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseVisibility(raw: unknown): Visibility | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (VISIBILITIES.includes(s as Visibility)) {
    return s as Visibility;
  }
  return null;
}

type Viewer = {
  id: number;
  role: string;
  condo_id: number;
  active: boolean;
};

async function loadViewer(userIdRaw: unknown): Promise<Viewer | null> {
  const id = parsePositive(userIdRaw);
  if (id == null) {
    return null;
  }
  const r = await query(
    `select id, role, condo_id, active from app_users where id = $1 limit 1`,
    [id],
  );
  if (r.rows.length === 0) {
    return null;
  }
  return r.rows[0] as Viewer;
}

function canSeePrivateEvents(viewer: Viewer | null): boolean {
  return (
    viewer != null &&
    viewer.active === true &&
    isBillingStaff(viewer.role)
  );
}

/** Cadastro / edição: apenas síndico e administração (moradores e demais só visualizam eventos públicos). */
function canManageAgenda(viewer: Viewer | null, condoId: number): boolean {
  return (
    viewer != null &&
    viewer.active === true &&
    viewer.condo_id === condoId &&
    isBillingStaff(viewer.role)
  );
}

const SELECT_LIST = `e.id,
  e.condo_id,
  e.title,
  e.description,
  e.event_date,
  e.event_end,
  e.location,
  e.visibility,
  e.created_by_user_id,
  e.created_at,
  e.updated_at,
  u.full_name as created_by_name`;

/** Lista: evento mais próximo primeiro (futuros em ordem crescente de data). */
router.get('/events', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const viewRaw = String(req.query.view ?? 'list').trim().toLowerCase();
    const includePast = req.query.includePast === 'true';
    const viewer = await loadViewer(req.query.userId);

    if (viewer != null && viewer.active !== true) {
      return res.status(403).json({ message: 'Usuario inativo.' });
    }
    if (viewer != null && viewer.condo_id !== condoId) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    const seePrivate =
      viewer != null && canSeePrivateEvents(viewer) && viewer.condo_id === condoId;

    if (viewRaw === 'calendar') {
      const year = parsePositive(req.query.year);
      const month = parsePositive(req.query.month);
      if (year == null || month == null || month < 1 || month > 12) {
        return res
          .status(400)
          .json({ message: 'Para view=calendar informe year e month (1-12) validos.' });
      }

      const rangeStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      const rangeEndEx = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

      const r = await query(
        `select ${SELECT_LIST}
         from events e
         left join app_users u on u.id = e.created_by_user_id
         where e.condo_id = $1
           and (e.visibility = 'public' or $2::boolean = true)
           and e.event_date < $4
           and coalesce(e.event_end, e.event_date) >= $3
         order by e.event_date asc, e.id asc`,
        [condoId, seePrivate, rangeStart, rangeEndEx],
      );

      return res.json({
        view: 'calendar',
        year,
        month,
        rangeStart: rangeStart.toISOString(),
        rangeEndExclusive: rangeEndEx.toISOString(),
        events: r.rows,
      });
    }

    if (viewRaw !== 'list') {
      return res.status(400).json({ message: 'view deve ser list ou calendar.' });
    }

    let sql = `select ${SELECT_LIST}
         from events e
         left join app_users u on u.id = e.created_by_user_id
         where e.condo_id = $1
           and (e.visibility = 'public' or $2::boolean = true)`;
    const params: unknown[] = [condoId, seePrivate];
    if (!includePast) {
      sql += ` and e.event_date >= now()`;
    }
    sql += ` order by e.event_date asc, e.id asc`;

    const r = await query(sql, params);

    return res.json({
      view: 'list',
      includePast,
      events: r.rows,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/events', async (req, res, next) => {
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
    const title = String(body.title ?? '').trim();
    const description = String(body.description ?? '').trim() || null;
    const location = String(body.location ?? '').trim() || null;
    let visibility: Visibility = 'public';
    if (
      body.visibility !== undefined &&
      body.visibility !== null &&
      String(body.visibility).trim() !== ''
    ) {
      const v = parseVisibility(body.visibility);
      if (v == null) {
        return res.status(400).json({ message: 'visibility deve ser public ou private.' });
      }
      visibility = v;
    }
    const eventDateRaw = body.eventDate ?? body.event_date;
    const eventEndRaw = body.eventEnd ?? body.event_end;

    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (!title) {
      return res.status(400).json({ message: 'title e obrigatorio.' });
    }

    const viewer = await loadViewer(userId);
    if (!canManageAgenda(viewer, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem cadastrar eventos na agenda.',
      });
    }

    const eventDate =
      eventDateRaw != null && String(eventDateRaw).trim() !== ''
        ? new Date(String(eventDateRaw))
        : null;
    if (eventDate == null || Number.isNaN(eventDate.getTime())) {
      return res.status(400).json({ message: 'eventDate invalido (use ISO 8601).' });
    }

    let eventEnd: Date | null = null;
    if (eventEndRaw != null && String(eventEndRaw).trim() !== '') {
      eventEnd = new Date(String(eventEndRaw));
      if (Number.isNaN(eventEnd.getTime())) {
        return res.status(400).json({ message: 'eventEnd invalido (use ISO 8601).' });
      }
    }

    const ins = await query(
      `insert into events (
         condo_id, title, description, event_date, event_end, location,
         visibility, created_by_user_id
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id,
                 condo_id,
                 title,
                 description,
                 event_date,
                 event_end,
                 location,
                 visibility,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [condoId, title, description, eventDate, eventEnd, location, visibility, userId],
    );

    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/events/:id', async (req, res, next) => {
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

    const viewer = await loadViewer(userId);
    if (!canManageAgenda(viewer, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem alterar eventos.',
      });
    }

    const existing = await query(
      `select id, condo_id from events where id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Evento nao encontrado.' });
    }
    if ((existing.rows[0] as { condo_id: number }).condo_id !== condoId) {
      return res.status(403).json({ message: 'Evento pertence a outro condominio.' });
    }

    const cur = await query(
      `select title, description, event_date, event_end, location, visibility
       from events where id = $1`,
      [id],
    );
    const row = cur.rows[0] as {
      title: string;
      description: string | null;
      event_date: Date;
      event_end: Date | null;
      location: string | null;
      visibility: string;
    };

    let nextTitle = row.title;
    let nextDesc = row.description;
    let nextStart = row.event_date;
    let nextEnd = row.event_end;
    let nextLoc = row.location;
    let nextVis = row.visibility as Visibility;
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
    if (body.location !== undefined) {
      nextLoc = String(body.location ?? '').trim() || null;
      changed = true;
    }
    if (body.visibility !== undefined) {
      const v = parseVisibility(body.visibility);
      if (v == null) {
        return res.status(400).json({ message: 'visibility deve ser public ou private.' });
      }
      nextVis = v;
      changed = true;
    }
    const eventDateRaw = body.eventDate ?? body.event_date;
    if (eventDateRaw !== undefined) {
      const d = new Date(String(eventDateRaw));
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: 'eventDate invalido.' });
      }
      nextStart = d;
      changed = true;
    }
    const eventEndRaw = body.eventEnd ?? body.event_end;
    if (eventEndRaw !== undefined) {
      if (eventEndRaw === null || String(eventEndRaw).trim() === '') {
        nextEnd = null;
      } else {
        const d = new Date(String(eventEndRaw));
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: 'eventEnd invalido.' });
        }
        nextEnd = d;
      }
      changed = true;
    }

    if (!changed) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    const r = await query(
      `update events
       set title = $2,
           description = $3,
           event_date = $4,
           event_end = $5,
           location = $6,
           visibility = $7,
           updated_at = now()
       where id = $1
       returning id,
                 condo_id,
                 title,
                 description,
                 event_date,
                 event_end,
                 location,
                 visibility,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [id, nextTitle, nextDesc, nextStart, nextEnd, nextLoc, nextVis],
    );

    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete('/events/:id', async (req, res, next) => {
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

    const viewer = await loadViewer(userId);
    if (!canManageAgenda(viewer, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem excluir eventos.',
      });
    }

    const del = await query(
      `delete from events where id = $1 and condo_id = $2 returning id`,
      [id, condoId],
    );
    if (del.rows.length === 0) {
      return res.status(404).json({ message: 'Evento nao encontrado.' });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;

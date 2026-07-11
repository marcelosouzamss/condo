import { Router } from 'express';

import {
  canManageCollaboratorsAndSchedule,
  canViewCollaboratorSchedule,
} from '../authz';
import { query } from '../db';
import { loadLegacyUserRow } from '../userContext';

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

function parseDayOfMonth(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 31) {
    return null;
  }
  return n;
}

/** Dias do mês (1–31) para combinar com year/month no body. */
function parseDaysOfMonth(body: Record<string, unknown>): number[] | null {
  const rawArr = body.daysOfMonth ?? body.days_of_month;
  if (Array.isArray(rawArr)) {
    const out: number[] = [];
    for (const item of rawArr) {
      const d = parseDayOfMonth(item);
      if (d == null) {
        return null;
      }
      out.push(d);
    }
    if (out.length === 0) {
      return null;
    }
    return [...new Set(out)].sort((a, b) => a - b);
  }
  const single = parseDayOfMonth(body.dayOfMonth ?? body.day_of_month);
  return single != null ? [single] : null;
}

function isIsoDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** aceita shiftDates[], shiftDate, ou year + month + daysOfMonth/dayOfMonth */
function parseShiftDates(body: Record<string, unknown>): string[] | null {
  const rawArr = body.shiftDates ?? body.shift_dates;
  if (Array.isArray(rawArr)) {
    const out: string[] = [];
    for (const item of rawArr) {
      const s = String(item ?? '').trim();
      if (!isIsoDateOnly(s)) {
        return null;
      }
      const parts = s.split('-').map((p) => Number(p));
      if (
        parts.length !== 3 ||
        parts.some((n) => !Number.isFinite(n))
      ) {
        return null;
      }
      const [y, mo, d] = parts;
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (
        dt.getUTCFullYear() !== y ||
        dt.getUTCMonth() !== mo - 1 ||
        dt.getUTCDate() !== d
      ) {
        return null;
      }
      out.push(s);
    }
    if (out.length === 0) {
      return null;
    }
    return [...new Set(out)].sort();
  }

  const single = String(body.shiftDate ?? body.shift_date ?? '').trim();
  if (single !== '') {
    if (!isIsoDateOnly(single)) {
      return null;
    }
    const parts = single.split('-').map((p) => Number(p));
    const [y, mo, d] = parts;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== mo - 1 ||
      dt.getUTCDate() !== d
    ) {
      return null;
    }
    return [single];
  }

  const year = Number(body.year);
  const month = Number(body.month ?? body.monthNum ?? body.month_number);
  const days = parseDaysOfMonth(body);
  if (
    !Number.isInteger(year) ||
    year < 1970 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    days == null ||
    days.length === 0
  ) {
    return null;
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const out: string[] = [];
  for (const dm of days) {
    if (dm > lastDay) {
      return null;
    }
    const mm = String(month).padStart(2, '0');
    const dd = String(dm).padStart(2, '0');
    out.push(`${year}-${mm}-${dd}`);
  }
  return [...new Set(out)].sort();
}

function parseShiftDateUpdate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!isIsoDateOnly(s)) {
    return null;
  }
  const parts = s.split('-').map((p) => Number(p));
  const [y, mo, d] = parts;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return s;
}

type AppUserRow = {
  id: number;
  condo_id: number;
  role: string;
  active: boolean;
};

async function loadUser(userId: number, condoId: number): Promise<AppUserRow | null> {
  const row = await loadLegacyUserRow(userId, condoId);
  if (row == null) {
    return null;
  }
  return row as AppUserRow;
}

function canViewBoard(user: AppUserRow, condoId: number): boolean {
  return user.active === true && user.condo_id === condoId;
}

function canManageCollaborators(user: AppUserRow, condoId: number): boolean {
  return (
    user.active === true &&
    user.condo_id === condoId &&
    canManageCollaboratorsAndSchedule(user.role)
  );
}

function canViewSchedule(user: AppUserRow): boolean {
  return user.active === true && canViewCollaboratorSchedule(user.role);
}

async function assertCollaboratorInCondo(
  collaboratorId: number,
  condoId: number,
): Promise<boolean> {
  const r = await query(
    `select id from condo_collaborators where id = $1 and condo_id = $2`,
    [collaboratorId, condoId],
  );
  return r.rows.length > 0;
}

/** Escala: lista (síndico, administradora, colaboradores). */
router.get('/schedule', async (req, res, next) => {
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
    if (!canViewBoard(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }
    if (!canViewSchedule(user)) {
      return res.status(403).json({
        message: 'Moradores visualizam apenas o quadro de colaboradores, sem escala.',
      });
    }

    const r = await query(
      `select s.id,
              s.condo_id,
              s.collaborator_id,
              s.shift_date,
              s.time_start,
              s.time_end,
              s.notes,
              s.sort_order,
              s.created_at,
              s.updated_at,
              c.full_name as collaborator_name,
              c.job_title as collaborator_job_title
       from condo_collaborator_shifts s
       join condo_collaborators c on c.id = s.collaborator_id
       where s.condo_id = $1
       order by s.shift_date asc, s.sort_order asc, c.full_name asc`,
      [condoId],
    );
    const rows = r.rows.map((row: Record<string, unknown>) => {
      const sd = row.shift_date;
      let shiftDateStr: string;
      if (sd instanceof Date) {
        shiftDateStr = sd.toISOString().slice(0, 10);
      } else if (typeof sd === 'string') {
        shiftDateStr = sd.slice(0, 10);
      } else {
        shiftDateStr = String(sd ?? '');
      }
      return { ...row, shift_date: shiftDateStr };
    });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

/** Nova entrada de escala (síndico ou administradora). */
router.post('/schedule', async (req, res, next) => {
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
    const collaboratorId = parsePositive(body.collaboratorId ?? body.collaborator_id);
    const shiftDates = parseShiftDates(body as Record<string, unknown>);
    const timeStart =
      String(body.timeStart ?? body.time_start ?? '').trim() || null;
    const timeEnd =
      String(body.timeEnd ?? body.time_end ?? '').trim() || null;
    const notes = String(body.notes ?? '').trim() || null;
    const sortOrderRaw = body.sortOrder ?? body.sort_order;
    const sortOrder =
      sortOrderRaw !== undefined &&
      sortOrderRaw !== null &&
      String(sortOrderRaw).trim() !== ''
        ? Number(sortOrderRaw)
        : 0;

    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (collaboratorId == null) {
      return res.status(400).json({ message: 'collaboratorId e obrigatorio.' });
    }
    if (shiftDates == null || shiftDates.length === 0) {
      return res.status(400).json({
        message:
          'Informe shiftDates (lista YYYY-MM-DD), shiftDate, ou year, month e daysOfMonth.',
      });
    }
    if (!Number.isFinite(sortOrder)) {
      return res.status(400).json({ message: 'sortOrder invalido.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageCollaborators(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem criar a escala.',
      });
    }
    if (!(await assertCollaboratorInCondo(collaboratorId, condoId))) {
      return res.status(404).json({ message: 'Colaborador nao encontrado neste condominio.' });
    }

    const meta = await query(
      `select c.full_name as collaborator_name, c.job_title as collaborator_job_title
       from condo_collaborators c where c.id = $1`,
      [collaboratorId],
    );
    const m = meta.rows[0] as Record<string, unknown>;

    const created: Record<string, unknown>[] = [];
    for (const shiftDate of shiftDates) {
      const ins = await query(
        `insert into condo_collaborator_shifts (
           condo_id, collaborator_id, shift_date, time_start, time_end,
           notes, sort_order, created_by_user_id
         )
         values ($1, $2, $3::date, $4, $5, $6, $7, $8)
         returning id,
                   condo_id,
                   collaborator_id,
                   shift_date,
                   time_start,
                   time_end,
                   notes,
                   sort_order,
                   created_at,
                   updated_at`,
        [
          condoId,
          collaboratorId,
          shiftDate,
          timeStart,
          timeEnd,
          notes,
          sortOrder,
          userId,
        ],
      );
      const row = ins.rows[0] as Record<string, unknown>;
      const sd = row.shift_date;
      const shiftDateStr =
        sd instanceof Date
          ? sd.toISOString().slice(0, 10)
          : String(sd ?? '').slice(0, 10);
      created.push({
        ...row,
        shift_date: shiftDateStr,
        collaborator_name: m.collaborator_name,
        collaborator_job_title: m.collaborator_job_title,
      });
    }

    return res.status(201).json({ shifts: created });
  } catch (err) {
    return next(err);
  }
});

router.patch('/schedule/:shiftId', async (req, res, next) => {
  try {
    const shiftId = parsePositive(req.params.shiftId);
    const body = req.body || {};
    const condoIdBody = body.condoId;
    const condoId =
      condoIdBody !== undefined &&
      condoIdBody !== null &&
      String(condoIdBody).trim() !== ''
        ? Number(condoIdBody)
        : NaN;
    const userId = parsePositive(body.userId);

    if (shiftId == null) {
      return res.status(400).json({ message: 'shiftId invalido.' });
    }
    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageCollaborators(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem alterar a escala.',
      });
    }

    const cur = await query(
      `select id, collaborator_id, shift_date, time_start, time_end, notes, sort_order
       from condo_collaborator_shifts
       where id = $1 and condo_id = $2`,
      [shiftId, condoId],
    );
    if (cur.rows.length === 0) {
      return res.status(404).json({ message: 'Turno da escala nao encontrado.' });
    }
    const row = cur.rows[0] as {
      collaborator_id: number;
      shift_date: Date | string;
      time_start: string | null;
      time_end: string | null;
      notes: string | null;
      sort_order: number;
    };

    let nextCollab = row.collaborator_id;
    let nextShiftDate =
      typeof row.shift_date === 'string'
        ? row.shift_date.slice(0, 10)
        : row.shift_date.toISOString().slice(0, 10);
    let nextStart = row.time_start;
    let nextEnd = row.time_end;
    let nextNotes = row.notes;
    let nextSort = row.sort_order;
    let changed = false;

    const collabRaw = body.collaboratorId ?? body.collaborator_id;
    if (collabRaw !== undefined) {
      const cid = parsePositive(collabRaw);
      if (cid == null) {
        return res.status(400).json({ message: 'collaboratorId invalido.' });
      }
      if (!(await assertCollaboratorInCondo(cid, condoId))) {
        return res.status(404).json({ message: 'Colaborador nao encontrado neste condominio.' });
      }
      nextCollab = cid;
      changed = true;
    }
    if (
      body.shiftDate !== undefined ||
      body.shift_date !== undefined ||
      body.year !== undefined
    ) {
      const direct = parseShiftDateUpdate(
        body.shiftDate ?? body.shift_date,
      );
      if (
        body.shiftDate !== undefined ||
        body.shift_date !== undefined
      ) {
        if (direct == null) {
          return res.status(400).json({
            message: 'shiftDate deve estar no formato YYYY-MM-DD.',
          });
        }
        nextShiftDate = direct;
        changed = true;
      } else {
        const year = Number(body.year);
        const month = Number(body.month ?? body.monthNum ?? body.month_number);
        const dm = parseDayOfMonth(body.dayOfMonth ?? body.day_of_month);
        if (
          Number.isInteger(year) &&
          year >= 1970 &&
          year <= 2100 &&
          Number.isInteger(month) &&
          month >= 1 &&
          month <= 12 &&
          dm != null
        ) {
          const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
          if (dm > lastDay) {
            return res.status(400).json({
              message: 'Data invalida para o mes escolhido.',
            });
          }
          const mm = String(month).padStart(2, '0');
          const dd = String(dm).padStart(2, '0');
          nextShiftDate = `${year}-${mm}-${dd}`;
          changed = true;
        }
      }
    }
    if (body.timeStart !== undefined || body.time_start !== undefined) {
      nextStart =
        String(body.timeStart ?? body.time_start ?? '').trim() || null;
      changed = true;
    }
    if (body.timeEnd !== undefined || body.time_end !== undefined) {
      nextEnd = String(body.timeEnd ?? body.time_end ?? '').trim() || null;
      changed = true;
    }
    if (body.notes !== undefined) {
      nextNotes = String(body.notes ?? '').trim() || null;
      changed = true;
    }
    if (body.sortOrder !== undefined || body.sort_order !== undefined) {
      const s = Number(body.sortOrder ?? body.sort_order);
      if (!Number.isFinite(s)) {
        return res.status(400).json({ message: 'sortOrder invalido.' });
      }
      nextSort = s;
      changed = true;
    }

    if (!changed) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    const up = await query(
      `update condo_collaborator_shifts
       set collaborator_id = $2,
           shift_date = $3::date,
           time_start = $4,
           time_end = $5,
           notes = $6,
           sort_order = $7,
           updated_at = now()
       where id = $1 and condo_id = $8
       returning id,
                 condo_id,
                 collaborator_id,
                 shift_date,
                 time_start,
                 time_end,
                 notes,
                 sort_order,
                 created_at,
                 updated_at`,
      [
        shiftId,
        nextCollab,
        nextShiftDate,
        nextStart,
        nextEnd,
        nextNotes,
        nextSort,
        condoId,
      ],
    );

    const out = up.rows[0] as Record<string, unknown>;
    const sdOut = out.shift_date;
    const shiftDateStr =
      sdOut instanceof Date
        ? sdOut.toISOString().slice(0, 10)
        : String(sdOut ?? '').slice(0, 10);
    const meta = await query(
      `select full_name as collaborator_name, job_title as collaborator_job_title
       from condo_collaborators where id = $1`,
      [nextCollab],
    );
    const m = meta.rows[0] as Record<string, unknown>;
    return res.json({
      ...out,
      shift_date: shiftDateStr,
      collaborator_name: m.collaborator_name,
      collaborator_job_title: m.collaborator_job_title,
    });
  } catch (err) {
    return next(err);
  }
});

router.delete('/schedule/:shiftId', async (req, res, next) => {
  try {
    const shiftId = parsePositive(req.params.shiftId);
    const condoId =
      req.query.condoId !== undefined && String(req.query.condoId).trim() !== ''
        ? Number(req.query.condoId)
        : NaN;
    const userId = parsePositive(req.query.userId);

    if (shiftId == null) {
      return res.status(400).json({ message: 'shiftId invalido.' });
    }
    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageCollaborators(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem excluir turnos da escala.',
      });
    }

    const del = await query(
      `delete from condo_collaborator_shifts where id = $1 and condo_id = $2 returning id`,
      [shiftId, condoId],
    );
    if (del.rows.length === 0) {
      return res.status(404).json({ message: 'Turno da escala nao encontrado.' });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoIdQuery(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    const includeInactive = req.query.includeInactive === 'true';

    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canViewBoard(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    let sql = `select id,
                      condo_id,
                      full_name,
                      job_title,
                      phone,
                      email,
                      photo_url,
                      notes,
                      sort_order,
                      active,
                      created_at,
                      updated_at
               from condo_collaborators
               where condo_id = $1`;
    const params: unknown[] = [condoId];
    if (!includeInactive) {
      sql += ` and active = true`;
    }
    sql += ` order by sort_order asc, full_name asc`;

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
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canViewBoard(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    const r = await query(
      `select id,
              condo_id,
              full_name,
              job_title,
              phone,
              email,
              photo_url,
              notes,
              sort_order,
              active,
              created_at,
              updated_at
       from condo_collaborators
       where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Colaborador nao encontrado.' });
    }
    return res.json(r.rows[0]);
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
    const fullName = String(body.fullName ?? body.full_name ?? '').trim();
    const jobTitle = String(body.jobTitle ?? body.job_title ?? '').trim();
    const phone = String(body.phone ?? '').trim() || null;
    const email = String(body.email ?? '').trim() || null;
    const photoUrl =
      String(body.photoUrl ?? body.photo_url ?? '').trim() || null;
    const notes = String(body.notes ?? '').trim() || null;
    const sortOrderRaw = body.sortOrder ?? body.sort_order;
    const sortOrder =
      sortOrderRaw !== undefined &&
      sortOrderRaw !== null &&
      String(sortOrderRaw).trim() !== ''
        ? Number(sortOrderRaw)
        : 0;

    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (!fullName || !jobTitle) {
      return res.status(400).json({
        message: 'fullName e jobTitle sao obrigatorios.',
      });
    }
    if (!Number.isFinite(sortOrder)) {
      return res.status(400).json({ message: 'sortOrder invalido.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageCollaborators(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem cadastrar colaboradores.',
      });
    }

    const ins = await query(
      `insert into condo_collaborators (
         condo_id, full_name, job_title, phone, email, photo_url, notes,
         sort_order, created_by_user_id
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id,
                 condo_id,
                 full_name,
                 job_title,
                 phone,
                 email,
                 photo_url,
                 notes,
                 sort_order,
                 active,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [
        condoId,
        fullName,
        jobTitle,
        phone,
        email,
        photoUrl,
        notes,
        sortOrder,
        userId,
      ],
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

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageCollaborators(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem alterar colaboradores.',
      });
    }

    const existing = await query(
      `select id from condo_collaborators where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Colaborador nao encontrado.' });
    }

    const cur = await query(
      `select full_name, job_title, phone, email, photo_url, notes, sort_order, active
       from condo_collaborators where id = $1`,
      [id],
    );
    const row = cur.rows[0] as {
      full_name: string;
      job_title: string;
      phone: string | null;
      email: string | null;
      photo_url: string | null;
      notes: string | null;
      sort_order: number;
      active: boolean;
    };

    let nextName = row.full_name;
    let nextJob = row.job_title;
    let nextPhone = row.phone;
    let nextEmail = row.email;
    let nextPhoto = row.photo_url;
    let nextNotes = row.notes;
    let nextSort = row.sort_order;
    let nextActive = row.active;
    let changed = false;

    if (body.fullName !== undefined || body.full_name !== undefined) {
      const t = String(body.fullName ?? body.full_name ?? '').trim();
      if (!t) {
        return res.status(400).json({ message: 'fullName invalido.' });
      }
      nextName = t;
      changed = true;
    }
    if (body.jobTitle !== undefined || body.job_title !== undefined) {
      const t = String(body.jobTitle ?? body.job_title ?? '').trim();
      if (!t) {
        return res.status(400).json({ message: 'jobTitle invalido.' });
      }
      nextJob = t;
      changed = true;
    }
    if (body.phone !== undefined) {
      nextPhone = String(body.phone ?? '').trim() || null;
      changed = true;
    }
    if (body.email !== undefined) {
      nextEmail = String(body.email ?? '').trim() || null;
      changed = true;
    }
    if (body.photoUrl !== undefined || body.photo_url !== undefined) {
      nextPhoto =
        String(body.photoUrl ?? body.photo_url ?? '').trim() || null;
      changed = true;
    }
    if (body.notes !== undefined) {
      nextNotes = String(body.notes ?? '').trim() || null;
      changed = true;
    }
    if (body.sortOrder !== undefined || body.sort_order !== undefined) {
      const s = Number(body.sortOrder ?? body.sort_order);
      if (!Number.isFinite(s)) {
        return res.status(400).json({ message: 'sortOrder invalido.' });
      }
      nextSort = s;
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

    if (!changed) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    const r = await query(
      `update condo_collaborators
       set full_name = $2,
           job_title = $3,
           phone = $4,
           email = $5,
           photo_url = $6,
           notes = $7,
           sort_order = $8,
           active = $9,
           updated_at = now()
       where id = $1
       returning id,
                 condo_id,
                 full_name,
                 job_title,
                 phone,
                 email,
                 photo_url,
                 notes,
                 sort_order,
                 active,
                 created_by_user_id,
                 created_at,
                 updated_at`,
      [
        id,
        nextName,
        nextJob,
        nextPhone,
        nextEmail,
        nextPhoto,
        nextNotes,
        nextSort,
        nextActive,
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

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canManageCollaborators(user, condoId)) {
      return res.status(403).json({
        message: 'Apenas sindico ou administracao podem excluir colaboradores.',
      });
    }

    const del = await query(
      `delete from condo_collaborators where id = $1 and condo_id = $2 returning id`,
      [id, condoId],
    );
    if (del.rows.length === 0) {
      return res.status(404).json({ message: 'Colaborador nao encontrado.' });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;

import { Router } from 'express';

import { isBillingStaff, isOperationalStaff } from '../authz';
import { query } from '../db';
import { loadLegacyUserRow } from '../userContext';

const router = Router();

export const COMPLAINTS_BOOK_ENTRY_TYPES = [
  'occurrence',
  'complaint',
  'improvement',
] as const;

export type ComplaintsBookEntryType = (typeof COMPLAINTS_BOOK_ENTRY_TYPES)[number];

const STATUSES = ['open', 'in_progress', 'closed'] as const;
type Status = (typeof STATUSES)[number];

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

function parseEntryType(raw: unknown): ComplaintsBookEntryType | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (COMPLAINTS_BOOK_ENTRY_TYPES.includes(s as ComplaintsBookEntryType)) {
    return s as ComplaintsBookEntryType;
  }
  return null;
}

function parseStatus(raw: unknown): Status | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (STATUSES.includes(s as Status)) {
    return s as Status;
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

async function loadUser(userId: number, condoId: number): Promise<AppUserRow | null> {
  const row = await loadLegacyUserRow(userId, condoId);
  if (row == null) {
    return null;
  }
  return row as AppUserRow;
}

function canAccessComplaintsBook(user: AppUserRow, condoId: number): boolean {
  return user.active === true && user.condo_id === condoId && user.role !== 'partner';
}

const listSelectSql = `select e.id,
                              e.condo_id,
                              e.unit_id,
                              e.created_by_user_id,
                              e.entry_type,
                              e.subject,
                              e.description,
                              e.status,
                              e.admin_response,
                              e.created_at,
                              e.updated_at,
                              u.full_name as created_by_name,
                              un.tower as unit_tower,
                              un.number as unit_number
                       from condo_complaints_book e
                       join app_users u on u.id = e.created_by_user_id
                       left join units un on un.id = e.unit_id`;

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }
    if (!canAccessComplaintsBook(user, condoId)) {
      return res.status(403).json({
        message: 'Parceiros nao utilizam o livro de reclamacoes.',
      });
    }

    const entryTypeFilter =
      req.query.entryType !== undefined && String(req.query.entryType).trim() !== ''
        ? parseEntryType(req.query.entryType)
        : null;
    if (
      entryTypeFilter === null &&
      req.query.entryType !== undefined &&
      String(req.query.entryType).trim() !== ''
    ) {
      return res.status(400).json({
        message: 'entryType invalido (occurrence, complaint ou improvement).',
      });
    }

    const params: unknown[] = [condoId];
    let sql = `${listSelectSql} where e.condo_id = $1`;

    if (entryTypeFilter != null) {
      params.push(entryTypeFilter);
      sql += ` and e.entry_type = $${params.length}`;
    }

    sql += ` order by e.created_at desc, e.id desc limit 300`;

    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (id == null || userId == null) {
      return res.status(400).json({ message: 'id e userId sao obrigatorios.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }
    if (!canAccessComplaintsBook(user, condoId)) {
      return res.status(403).json({
        message: 'Parceiros nao utilizam o livro de reclamacoes.',
      });
    }

    const r = await query(`${listSelectSql} where e.id = $1 and e.condo_id = $2`, [
      id,
      condoId,
    ]);
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Registro nao encontrado.' });
    }
    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId);
    const userId = parsePositive(body.userId);
    const entryType = parseEntryType(body.entryType ?? body.entry_type);
    const subject = String(body.subject ?? '').trim();
    const description = String(body.description ?? '').trim();
    const unitIdBody = parsePositive(body.unitId ?? body.unit_id);

    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (entryType == null) {
      return res.status(400).json({
        message: 'entryType invalido (occurrence, complaint ou improvement).',
      });
    }
    if (subject.length < 3) {
      return res.status(400).json({ message: 'Informe um assunto com pelo menos 3 caracteres.' });
    }
    if (subject.length > 200) {
      return res.status(400).json({ message: 'Assunto muito longo (max. 200 caracteres).' });
    }
    if (description.length < 10) {
      return res.status(400).json({
        message: 'Descreva o registro com pelo menos 10 caracteres.',
      });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }
    if (!canAccessComplaintsBook(user, condoId)) {
      return res.status(403).json({
        message: 'Parceiros nao utilizam o livro de reclamacoes.',
      });
    }
    if (user.role !== 'resident') {
      return res.status(403).json({
        message: 'Apenas moradores podem registrar no livro de reclamacoes.',
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
      `insert into condo_complaints_book (
         condo_id, unit_id, created_by_user_id, entry_type, subject, description
       )
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [condoId, effectiveUnitId, userId, entryType, subject, description],
    );
    const newId = (ins.rows[0] as { id: number }).id;

    const detail = await query(`${listSelectSql} where e.id = $1`, [newId]);
    return res.status(201).json(detail.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId ?? req.query.condoId);
    const userId = parsePositive(body.userId);
    if (id == null || userId == null) {
      return res.status(400).json({ message: 'id e userId sao obrigatorios.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }

    const existing = await query(
      `select id, condo_id, created_by_user_id, status
       from condo_complaints_book
       where id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Registro nao encontrado.' });
    }
    const row = existing.rows[0] as {
      id: number;
      condo_id: number;
      created_by_user_id: number;
      status: string;
    };

    if (!canAccessComplaintsBook(user, row.condo_id)) {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    const nextStatus =
      body.status !== undefined ? parseStatus(body.status) : null;
    if (body.status !== undefined && nextStatus == null) {
      return res.status(400).json({ message: 'status invalido.' });
    }

    const adminResponse =
      body.adminResponse !== undefined || body.admin_response !== undefined
        ? String(body.adminResponse ?? body.admin_response ?? '').trim() || null
        : undefined;

    const isStaff = isOperationalStaff(user.role);

    if (nextStatus != null || adminResponse !== undefined) {
      if (!isStaff) {
        return res.status(403).json({
          message: 'Somente a equipe do condominio pode atualizar status ou resposta.',
        });
      }
    } else {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    if (nextStatus == null && adminResponse === undefined) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (nextStatus != null) {
      params.push(nextStatus);
      sets.push(`status = $${params.length}`);
    }
    if (adminResponse !== undefined) {
      params.push(adminResponse);
      sets.push(`admin_response = $${params.length}`);
    }
    params.push(id);
    sets.push('updated_at = now()');

    await query(
      `update condo_complaints_book set ${sets.join(', ')} where id = $${params.length}`,
      params,
    );

    const detail = await query(`${listSelectSql} where e.id = $1`, [id]);
    return res.json(detail.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = parsePositive(req.params.id);
    const condoId = parseCondoId(req.query.condoId ?? req.body?.condoId);
    const userId = parsePositive(req.query.userId ?? req.body?.userId);
    if (id == null || userId == null) {
      return res.status(400).json({ message: 'id e userId sao obrigatorios.' });
    }

    const user = await loadUser(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }

    const existing = await query(
      `select id, condo_id, created_by_user_id, status
       from condo_complaints_book
       where id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Registro nao encontrado.' });
    }
    const row = existing.rows[0] as {
      condo_id: number;
      created_by_user_id: number;
      status: string;
    };

    if (!canAccessComplaintsBook(user, row.condo_id)) {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    const mayDelete =
      isBillingStaff(user.role) ||
      (user.id === row.created_by_user_id && row.status === 'open');
    if (!mayDelete) {
      return res.status(403).json({
        message: 'Somente o autor (registro aberto) ou síndico/administração podem excluir.',
      });
    }

    await query(`delete from condo_complaints_book where id = $1`, [id]);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;

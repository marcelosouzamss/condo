import { Router } from 'express';

import { query } from '../db';

const router = Router();

const CATEGORIES = ['syndic', 'administration', 'intercom', 'other'] as const;
type Category = (typeof CATEGORIES)[number];

const VISIBLE_TO = [
  'everyone',
  'syndic_only',
  'syndic_administration',
  'operational_staff',
] as const;
type VisibleTo = (typeof VISIBLE_TO)[number];

function parseCondoId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return 1;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parseCategory(raw: unknown): Category | null {
  const s = String(raw ?? '').trim();
  if (CATEGORIES.includes(s as Category)) {
    return s as Category;
  }
  return null;
}

function parseVisibleTo(raw: unknown): VisibleTo | null {
  const s = String(raw ?? '').trim();
  if (VISIBLE_TO.includes(s as VisibleTo)) {
    return s as VisibleTo;
  }
  return null;
}

/** Quem pode ver o contato conforme o perfil do usuário logado. */
function contactVisibleToViewer(viewerRole: string, visibleTo: string): boolean {
  const v = visibleTo || 'everyone';
  if (v === 'everyone') {
    return true;
  }
  if (v === 'operational_staff') {
    return (
      viewerRole === 'syndic' ||
      viewerRole === 'administrator' ||
      viewerRole === 'collaborator'
    );
  }
  if (v === 'syndic_administration') {
    return viewerRole === 'syndic' || viewerRole === 'administrator';
  }
  if (v === 'syndic_only') {
    return viewerRole === 'syndic';
  }
  return true;
}

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const catFilter = req.query.category
      ? parseCategory(req.query.category)
      : null;
    const forManage = String(req.query.manage ?? '').trim().toLowerCase() === 'true';
    const viewerRole = String(req.query.viewerRole ?? '').trim();

    let sql = `select id,
                      condo_id,
                      category,
                      name,
                      phone,
                      extension,
                      email,
                      notes,
                      sort_order,
                      visible_to,
                      created_at,
                      updated_at
               from condo_contacts
               where condo_id = $1`;
    const params: unknown[] = [condoId];
    if (catFilter != null) {
      sql += ` and category = $2`;
      params.push(catFilter);
    }

    const r = await query(sql, params);
    let rows = r.rows as Record<string, unknown>[];

    if (!forManage && viewerRole) {
      rows = rows.filter((row) =>
        contactVisibleToViewer(viewerRole, String(row.visible_to ?? 'everyone')),
      );
    }

    rows.sort((a, b) => {
      const catOrder = (c: unknown) => {
        const s = String(c ?? '');
        if (s === 'syndic') {
          return 0;
        }
        if (s === 'administration') {
          return 1;
        }
        if (s === 'intercom') {
          return 2;
        }
        return 3;
      };
      const ca = catOrder(a.category);
      const cb = catOrder(b.category);
      if (ca !== cb) {
        return ca - cb;
      }
      const oa = Number(a.sort_order ?? 0);
      const ob = Number(b.sort_order ?? 0);
      if (oa !== ob) {
        return oa - ob;
      }
      return String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });

    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const condoId = parseCondoId((req.body || {}).condoId);
    const category = parseCategory((req.body || {}).category);
    const name = String((req.body || {}).name ?? '').trim();
    const phone = String((req.body || {}).phone ?? '').trim() || null;
    const extension = String((req.body || {}).extension ?? '').trim() || null;
    const email = String((req.body || {}).email ?? '').trim() || null;
    const notes = String((req.body || {}).notes ?? '').trim() || null;
    const sortOrderRaw = (req.body || {}).sortOrder;
    const sortOrder =
      sortOrderRaw !== undefined && sortOrderRaw !== null && String(sortOrderRaw).trim() !== ''
        ? Number(sortOrderRaw)
        : 0;

    const visibleRaw =
      (req.body || {}).visibleTo ?? (req.body || {}).visible_to;

    let visibleTo: VisibleTo = 'everyone';
    if (
      visibleRaw !== undefined &&
      visibleRaw !== null &&
      String(visibleRaw).trim() !== ''
    ) {
      const parsed = parseVisibleTo(visibleRaw);
      if (parsed == null) {
        return res.status(400).json({
          message:
            'visibleTo deve ser everyone, syndic_only, syndic_administration ou operational_staff.',
        });
      }
      visibleTo = parsed;
    }

    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (category == null) {
      return res.status(400).json({
        message: 'category deve ser syndic, administration, intercom ou other.',
      });
    }
    if (!name) {
      return res.status(400).json({ message: 'name e obrigatorio.' });
    }
    if (!Number.isFinite(sortOrder)) {
      return res.status(400).json({ message: 'sortOrder invalido.' });
    }

    const ins = await query(
      `insert into condo_contacts (
         condo_id, category, name, phone, extension, email, notes, sort_order, visible_to
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id,
                 condo_id,
                 category,
                 name,
                 phone,
                 extension,
                 email,
                 notes,
                 sort_order,
                 visible_to,
                 created_at,
                 updated_at`,
      [condoId, category, name, phone, extension, email, notes, sortOrder, visibleTo],
    );

    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const condoId = parseCondoId((req.body || {}).condoId);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const categoryRaw = (req.body || {}).category;
    const nameRaw = (req.body || {}).name;
    const phoneRaw = (req.body || {}).phone;
    const extensionRaw = (req.body || {}).extension;
    const emailRaw = (req.body || {}).email;
    const notesRaw = (req.body || {}).notes;
    const sortOrderRaw = (req.body || {}).sortOrder;
    const visibleRaw =
      (req.body || {}).visibleTo ?? (req.body || {}).visible_to;

    const sets: string[] = [];
    const vals: unknown[] = [];
    let p = 1;

    if (categoryRaw !== undefined) {
      const c = parseCategory(categoryRaw);
      if (c == null) {
        return res.status(400).json({ message: 'category invalido.' });
      }
      sets.push(`category = $${p++}`);
      vals.push(c);
    }
    if (nameRaw !== undefined) {
      const n = String(nameRaw ?? '').trim();
      if (!n) {
        return res.status(400).json({ message: 'name nao pode ser vazio.' });
      }
      sets.push(`name = $${p++}`);
      vals.push(n);
    }
    if (phoneRaw !== undefined) {
      sets.push(`phone = $${p++}`);
      vals.push(String(phoneRaw ?? '').trim() || null);
    }
    if (extensionRaw !== undefined) {
      sets.push(`extension = $${p++}`);
      vals.push(String(extensionRaw ?? '').trim() || null);
    }
    if (emailRaw !== undefined) {
      sets.push(`email = $${p++}`);
      vals.push(String(emailRaw ?? '').trim() || null);
    }
    if (notesRaw !== undefined) {
      sets.push(`notes = $${p++}`);
      vals.push(String(notesRaw ?? '').trim() || null);
    }
    if (sortOrderRaw !== undefined) {
      const so = Number(sortOrderRaw);
      if (!Number.isFinite(so)) {
        return res.status(400).json({ message: 'sortOrder invalido.' });
      }
      sets.push(`sort_order = $${p++}`);
      vals.push(so);
    }
    if (visibleRaw !== undefined) {
      const vt = parseVisibleTo(visibleRaw);
      if (vt == null) {
        return res.status(400).json({
          message:
            'visibleTo deve ser everyone, syndic_only, syndic_administration ou operational_staff.',
        });
      }
      sets.push(`visible_to = $${p++}`);
      vals.push(vt);
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    sets.push(`updated_at = now()`);

    vals.push(id, condoId);
    const r = await query(
      `update condo_contacts
       set ${sets.join(', ')}
       where id = $${p} and condo_id = $${p + 1}
       returning id,
                 condo_id,
                 category,
                 name,
                 phone,
                 extension,
                 email,
                 notes,
                 sort_order,
                 visible_to,
                 created_at,
                 updated_at`,
      vals,
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Contato nao encontrado.' });
    }

    return res.json(r.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const condoId = parseCondoId(req.query.condoId);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }

    const del = await query(
      `delete from condo_contacts where id = $1 and condo_id = $2 returning id`,
      [id, condoId],
    );
    if (del.rows.length === 0) {
      return res.status(404).json({ message: 'Contato nao encontrado.' });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;

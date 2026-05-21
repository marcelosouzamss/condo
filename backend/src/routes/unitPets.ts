import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import multer from 'multer';
import { Router } from 'express';

import { isOperationalStaff } from '../authz';
import { query } from '../db';

const router = Router();

const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

const petPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const condoId = parseCondoIdQuery(req.query.condoId);
      const dir = path.join(UPLOADS_ROOT, 'pets', `condo-${condoId}`);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok =
      /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype) ||
      (file.mimetype === 'application/octet-stream' &&
        ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext));
    cb(null, ok);
  },
});

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

function canViewCondoPets(user: AppUserRow, condoId: number): boolean {
  return user.active === true && user.condo_id === condoId;
}

/** Cadastro / edição / exclusão: apenas morador da própria unidade. Equipe só consulta. */
function canResidentManageUnitPet(
  user: AppUserRow,
  condoId: number,
  unitId: number,
): boolean {
  if (user.active !== true || user.condo_id !== condoId) {
    return false;
  }
  return user.role === 'resident' && user.unit_id != null && user.unit_id === unitId;
}

async function assertUnitInCondo(unitId: number, condoId: number): Promise<boolean> {
  const r = await query(
    `select id from units where id = $1 and condo_id = $2`,
    [unitId, condoId],
  );
  return r.rows.length > 0;
}

/** Somente morador com unidade no cadastro pode enviar foto (para registrar pet). */
async function assertResidentUploader(
  userId: number,
  condoId: number,
): Promise<{ ok: true; user: AppUserRow } | { ok: false; status: number; message: string }> {
  const user = await loadUser(userId);
  if (user == null || user.active !== true) {
    return { ok: false, status: 404, message: 'Usuario nao encontrado ou inativo.' };
  }
  if (!canViewCondoPets(user, condoId)) {
    return { ok: false, status: 403, message: 'Usuario nao pertence a este condominio.' };
  }
  if (user.role !== 'resident' || user.unit_id == null) {
    return {
      ok: false,
      status: 403,
      message: 'Apenas moradores com unidade podem enviar foto de animal.',
    };
  }
  return { ok: true, user };
}

router.post(
  '/upload-photo',
  petPhotoUpload.single('photo'),
  async (req, res, next) => {
    try {
      const file = req.file;
      const condoId = parseCondoIdQuery(req.query.condoId);
      const userId = parsePositive(req.query.userId);

      if (userId == null) {
        if (file) {
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* empty */
          }
        }
        return res.status(400).json({ message: 'userId e obrigatorio (query).' });
      }

      const gate = await assertResidentUploader(userId, condoId);
      if (!gate.ok) {
        if (file) {
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* empty */
          }
        }
        return res.status(gate.status).json({ message: gate.message });
      }

      if (!file) {
        return res.status(400).json({
          message: 'Envie o arquivo no campo photo (multipart/form-data).',
        });
      }

      const relPath = path
        .relative(UPLOADS_ROOT, file.path)
        .split(path.sep)
        .join('/');
      const photoUrl = `/uploads/${relPath}`;
      return res.status(201).json({ photoUrl });
    } catch (err) {
      return next(err);
    }
  },
);

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoIdQuery(req.query.condoId);
    const unitFilter = parsePositive(req.query.unitId);
    const userId = parsePositive(req.query.userId);
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canViewCondoPets(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    let sql = `select p.id,
                      p.unit_id,
                      p.name,
                      p.species,
                      p.breed,
                      p.color,
                      p.photo_url,
                      p.notes,
                      p.created_at,
                      p.updated_at,
                      u.tower as unit_tower,
                      u.number as unit_number
               from unit_pets p
               join units u on u.id = p.unit_id
               where u.condo_id = $1`;
    const params: unknown[] = [condoId];

    if (user.role === 'resident') {
      if (user.unit_id == null) {
        return res.json([]);
      }
      sql += ` and p.unit_id = $2`;
      params.push(user.unit_id);
    } else if (isOperationalStaff(user.role)) {
      if (unitFilter != null) {
        sql += ` and p.unit_id = $2`;
        params.push(unitFilter);
      }
    } else {
      return res.json([]);
    }

    sql += ` order by u.tower asc, u.number asc, p.name asc`;

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

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!canViewCondoPets(user, condoId)) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    const r = await query(
      `select p.id,
              p.unit_id,
              p.name,
              p.species,
              p.breed,
              p.color,
              p.photo_url,
              p.notes,
              p.created_at,
              p.updated_at,
              u.tower as unit_tower,
              u.number as unit_number
       from unit_pets p
       join units u on u.id = p.unit_id
       where p.id = $1 and u.condo_id = $2`,
      [id, condoId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Pet nao encontrado.' });
    }
    const row = r.rows[0] as { unit_id: number };
    if (user.role === 'resident') {
      if (user.unit_id == null || row.unit_id !== user.unit_id) {
        return res.status(403).json({ message: 'Sem permissao para ver este cadastro.' });
      }
    } else if (!isOperationalStaff(user.role)) {
      return res.status(403).json({ message: 'Sem permissao.' });
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
    const unitId = parsePositive(body.unitId);
    const name = String(body.name ?? '').trim();
    const species = String(body.species ?? '').trim();
    const breed = String(body.breed ?? '').trim() || null;
    const color = String(body.color ?? '').trim() || null;
    const notes = String(body.notes ?? '').trim() || null;
    const photoUrl =
      String(body.photoUrl ?? body.photo_url ?? '').trim() || null;

    if (!Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    if (unitId == null) {
      return res.status(400).json({ message: 'unitId e obrigatorio — cadastro por unidade.' });
    }
    if (!name || !species) {
      return res.status(400).json({ message: 'name e species sao obrigatorios.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (!(await assertUnitInCondo(unitId, condoId))) {
      return res.status(404).json({ message: 'Unidade nao encontrada neste condominio.' });
    }
    if (!canResidentManageUnitPet(user, condoId, unitId)) {
      return res.status(403).json({
        message:
          'Apenas moradores podem cadastrar animais da propria unidade.',
      });
    }

    const ins = await query(
      `insert into unit_pets (unit_id, name, species, breed, color, photo_url, notes)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id,
                 unit_id,
                 name,
                 species,
                 breed,
                 color,
                 photo_url,
                 notes,
                 created_at,
                 updated_at`,
      [unitId, name, species, breed, color, photoUrl, notes],
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
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }

    const cur = await query(
      `select p.id,
              p.unit_id,
              p.name,
              p.species,
              p.breed,
              p.color,
              p.photo_url,
              p.notes
       from unit_pets p
       join units u on u.id = p.unit_id
       where p.id = $1 and u.condo_id = $2`,
      [id, condoId],
    );
    if (cur.rows.length === 0) {
      return res.status(404).json({ message: 'Pet nao encontrado.' });
    }
    const row = cur.rows[0] as {
      unit_id: number;
      name: string;
      species: string;
      breed: string | null;
      color: string | null;
      photo_url: string | null;
      notes: string | null;
    };

    if (!canResidentManageUnitPet(user, condoId, row.unit_id)) {
      return res.status(403).json({
        message: 'Apenas o morador da unidade pode alterar este cadastro.',
      });
    }

    let nextName = row.name;
    let nextSpecies = row.species;
    let nextBreed = row.breed;
    let nextColor = row.color;
    let nextPhoto = row.photo_url;
    let nextNotes = row.notes;
    let changed = false;

    if (body.name !== undefined) {
      const t = String(body.name ?? '').trim();
      if (!t) {
        return res.status(400).json({ message: 'name invalido.' });
      }
      nextName = t;
      changed = true;
    }
    if (body.species !== undefined) {
      const t = String(body.species ?? '').trim();
      if (!t) {
        return res.status(400).json({ message: 'species invalida.' });
      }
      nextSpecies = t;
      changed = true;
    }
    if (body.breed !== undefined) {
      nextBreed = String(body.breed ?? '').trim() || null;
      changed = true;
    }
    if (body.color !== undefined) {
      nextColor = String(body.color ?? '').trim() || null;
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

    if (!changed) {
      return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    }

    const r = await query(
      `update unit_pets
       set name = $2,
           species = $3,
           breed = $4,
           color = $5,
           photo_url = $6,
           notes = $7,
           updated_at = now()
       where id = $1
       returning id,
                 unit_id,
                 name,
                 species,
                 breed,
                 color,
                 photo_url,
                 notes,
                 created_at,
                 updated_at`,
      [id, nextName, nextSpecies, nextBreed, nextColor, nextPhoto, nextNotes],
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
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }

    const cur = await query(
      `select p.unit_id
       from unit_pets p
       join units u on u.id = p.unit_id
       where p.id = $1 and u.condo_id = $2`,
      [id, condoId],
    );
    if (cur.rows.length === 0) {
      return res.status(404).json({ message: 'Pet nao encontrado.' });
    }
    const unitId = (cur.rows[0] as { unit_id: number }).unit_id;
    if (!canResidentManageUnitPet(user, condoId, unitId)) {
      return res.status(403).json({
        message: 'Apenas o morador da unidade pode excluir este cadastro.',
      });
    }

    await query(`delete from unit_pets where id = $1`, [id]);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;

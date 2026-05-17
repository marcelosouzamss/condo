import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import multer from 'multer';
import { Router } from 'express';

import { isBillingStaff } from '../authz';
import { query } from '../db';

const router = Router();

const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

const ALLOWED_DOC_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

function parsePositive(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parseCondoId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return 1;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

type AppUserRow = {
  id: number;
  condo_id: number;
  role: string;
  active: boolean;
};

async function loadUser(userId: number): Promise<AppUserRow | null> {
  const r = await query(
    `select id, condo_id, role, active from app_users where id = $1 limit 1`,
    [userId],
  );
  if (r.rows.length === 0) {
    return null;
  }
  return r.rows[0] as AppUserRow;
}

const DOCUMENT_VIEW_ROLES = new Set([
  'resident',
  'collaborator',
  'partner',
  'syndic',
  'administrator',
]);

/** Envio e exclusão: síndico, administração, colaboradores e parceiros do condomínio. */
function canPublishDocuments(user: AppUserRow, condoId: number): boolean {
  return (
    user.active === true &&
    user.condo_id === condoId &&
    (isBillingStaff(user.role) ||
      user.role === 'collaborator' ||
      user.role === 'partner')
  );
}

/** Quem publica documentos vê a lista completa (sem filtro de audiência). */
function seesAllCondoDocuments(user: AppUserRow, condoId: number): boolean {
  return canPublishDocuments(user, condoId);
}

/** Editar metadados: síndico ou administração; ou quem publicou o documento. */
function canEditDocument(
  user: AppUserRow,
  condoId: number,
  postedByUserId: number | null,
): boolean {
  if (!user.active || user.condo_id !== condoId) {
    return false;
  }
  if (isBillingStaff(user.role)) {
    return true;
  }
  return (
    postedByUserId != null &&
    Number(postedByUserId) === Number(user.id)
  );
}

function parseVisibleToAll(raw: unknown): boolean {
  if (raw === undefined || raw === null || raw === '') {
    return true;
  }
  const t = String(raw).trim().toLowerCase();
  if (t === 'false' || t === '0' || t === 'no') {
    return false;
  }
  return true;
}

function parseViewerRolesJson(raw: unknown): string[] | null {
  if (raw === undefined || raw === null || raw === '') {
    return [];
  }
  let parsed: unknown;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  } else if (Array.isArray(raw)) {
    parsed = raw;
  } else {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const out: string[] = [];
  for (const x of parsed) {
    const role = String(x ?? '').trim().toLowerCase();
    if (!DOCUMENT_VIEW_ROLES.has(role) || out.includes(role)) {
      continue;
    }
    out.push(role);
  }
  return out;
}

const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const condoRaw = req.body?.condoId;
      const condoId =
        condoRaw !== undefined && condoRaw !== null && String(condoRaw).trim() !== ''
          ? Number(condoRaw)
          : 1;
      const safeId = Number.isFinite(condoId) && condoId > 0 ? condoId : 1;
      const dir = path.join(UPLOADS_ROOT, 'documents', `condo-${safeId}`);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_DOC_MIME.has(file.mimetype));
  },
});

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    const userId = parsePositive(req.query.userId);
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }
    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (user.condo_id !== condoId) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    let sql = `select id,
              condo_id,
              title,
              document_type,
              description,
              file_name,
              mime_type,
              byte_size,
              storage_path,
              visible_to_all,
              viewer_roles,
              posted_by_user_id,
              created_at
       from condo_documents
       where condo_id = $1`;
    const params: unknown[] = [condoId];
    if (!seesAllCondoDocuments(user, condoId)) {
      sql += ` and (
        visible_to_all = true
        or exists (
          select 1
          from jsonb_array_elements_text(viewer_roles) as t(role)
          where t.role = $2
        )
      )`;
      params.push(user.role);
    }
    sql += ` order by created_at desc limit 500`;
    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

router.post(
  '/upload',
  documentUpload.single('file'),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          message:
            'Arquivo obrigatorio (campo file em multipart/form-data). Tipos: PDF, Word, Excel, imagens, TXT (ate 16 MB).',
        });
      }

      const condoId = parseCondoId(req.body?.condoId);
      if (condoId == null) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* empty */
        }
        return res.status(400).json({ message: 'condoId invalido.' });
      }

      const userId = parsePositive(req.body?.userId);
      if (userId == null) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* empty */
        }
        return res.status(400).json({ message: 'userId e obrigatorio.' });
      }

      const user = await loadUser(userId);
      if (user == null || !canPublishDocuments(user, condoId)) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* empty */
        }
        return res.status(403).json({
          message:
            'Somente sindico, administracao, colaboradores e parceiros podem enviar documentos.',
        });
      }

      const documentType = String(
        req.body?.documentType ?? req.body?.document_type ?? '',
      ).trim();
      if (!documentType || documentType.length > 80) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* empty */
        }
        return res.status(400).json({
          message: 'documentType e obrigatorio (max 80 caracteres).',
        });
      }

      const titleRaw = String(req.body?.title ?? req.body?.name ?? '').trim();
      if (!titleRaw) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* empty */
        }
        return res.status(400).json({
          message: 'title (nome do documento) e obrigatorio.',
        });
      }
      const title =
        titleRaw.length > 200 ? titleRaw.slice(0, 200) : titleRaw;
      const description = String(req.body?.description ?? '').trim() || null;

      const visibleToAll = parseVisibleToAll(
        req.body?.visibleToAll ?? req.body?.visible_to_all,
      );
      const viewerRolesParsed = parseViewerRolesJson(
        req.body?.viewerRoles ?? req.body?.viewer_roles,
      );
      if (viewerRolesParsed == null) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* empty */
        }
        return res.status(400).json({
          message:
            'viewerRoles invalido: envie um JSON array de perfis (resident, collaborator, partner, syndic, administrator).',
        });
      }
      if (!visibleToAll && viewerRolesParsed.length === 0) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* empty */
        }
        return res.status(400).json({
          message:
            'Se o documento nao for para todos, selecione pelo menos um perfil.',
        });
      }
      const viewerRolesJson = JSON.stringify(
        visibleToAll ? [] : viewerRolesParsed,
      );

      const relPath = path
        .relative(UPLOADS_ROOT, file.path)
        .split(path.sep)
        .join('/');

      const ins = await query(
        `insert into condo_documents (
           condo_id, title, document_type, description, file_name, mime_type, byte_size, storage_path,
           visible_to_all, viewer_roles, posted_by_user_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
         returning id,
                   condo_id,
                   title,
                   document_type,
                   description,
                   file_name,
                   mime_type,
                   byte_size,
                   storage_path,
                   visible_to_all,
                   viewer_roles,
                   posted_by_user_id,
                   created_at`,
        [
          condoId,
          title,
          documentType,
          description,
          file.originalname,
          file.mimetype,
          file.size,
          relPath,
          visibleToAll,
          viewerRolesJson,
          userId,
        ],
      );

      return res.status(201).json(ins.rows[0]);
    } catch (err) {
      return next(err);
    }
  },
);

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);

    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId);
    if (user == null || !canPublishDocuments(user, condoId)) {
      return res.status(403).json({
        message:
          'Somente sindico, administracao, colaboradores e parceiros podem excluir documentos.',
      });
    }

    const found = await query(
      `select storage_path from condo_documents where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (found.rows.length === 0) {
      return res.status(404).json({ message: 'Documento nao encontrado.' });
    }

    const storagePath = found.rows[0].storage_path as string;
    const abs = path.join(UPLOADS_ROOT, storagePath);
    try {
      fs.unlinkSync(abs);
    } catch {
      /* arquivo ja removido */
    }

    await query(`delete from condo_documents where id = $1 and condo_id = $2`, [
      id,
      condoId,
    ]);

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);

    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'id invalido.' });
    }
    if (condoId == null) {
      return res.status(400).json({ message: 'condoId invalido.' });
    }
    if (userId == null) {
      return res.status(400).json({ message: 'userId e obrigatorio.' });
    }

    const user = await loadUser(userId);
    if (user == null || user.active !== true) {
      return res.status(404).json({ message: 'Usuario nao encontrado ou inativo.' });
    }
    if (user.condo_id !== condoId) {
      return res.status(403).json({ message: 'Usuario nao pertence a este condominio.' });
    }

    const found = await query(
      `select id,
              title,
              document_type,
              description,
              visible_to_all,
              viewer_roles,
              posted_by_user_id
       from condo_documents
       where id = $1 and condo_id = $2`,
      [id, condoId],
    );
    if (found.rows.length === 0) {
      return res.status(404).json({ message: 'Documento nao encontrado.' });
    }
    const row = found.rows[0] as {
      title: string;
      document_type: string;
      description: string | null;
      visible_to_all: boolean;
      viewer_roles: unknown;
      posted_by_user_id: number | null;
    };

    const postedBy =
      row.posted_by_user_id == null ? null : Number(row.posted_by_user_id);
    if (!canEditDocument(user, condoId, postedBy)) {
      return res.status(403).json({
        message: 'Sem permissao para editar este documento.',
      });
    }

    const titleRaw = String(req.body?.title ?? '').trim();
    if (!titleRaw) {
      return res.status(400).json({
        message: 'title (nome do documento) e obrigatorio.',
      });
    }
    const title =
      titleRaw.length > 200 ? titleRaw.slice(0, 200) : titleRaw;

    const documentType = String(
      req.body?.documentType ?? req.body?.document_type ?? '',
    ).trim();
    if (!documentType || documentType.length > 80) {
      return res.status(400).json({
        message: 'documentType e obrigatorio (max 80 caracteres).',
      });
    }

    const description = String(req.body?.description ?? '').trim() || null;

    const visibleToAll = parseVisibleToAll(
      req.body?.visibleToAll ?? req.body?.visible_to_all,
    );
    const viewerRolesParsed = parseViewerRolesJson(
      req.body?.viewerRoles ?? req.body?.viewer_roles,
    );
    if (viewerRolesParsed == null) {
      return res.status(400).json({
        message:
          'viewerRoles invalido: envie um JSON array de perfis (resident, collaborator, partner, syndic, administrator).',
      });
    }
    if (!visibleToAll && viewerRolesParsed.length === 0) {
      return res.status(400).json({
        message:
          'Se o documento nao for para todos, selecione pelo menos um perfil.',
      });
    }
    const viewerRolesJson = JSON.stringify(
      visibleToAll ? [] : viewerRolesParsed,
    );

    const upd = await query(
      `update condo_documents
       set title = $1,
           document_type = $2,
           description = $3,
           visible_to_all = $4,
           viewer_roles = $5::jsonb
       where id = $6 and condo_id = $7
       returning id,
                 condo_id,
                 title,
                 document_type,
                 description,
                 file_name,
                 mime_type,
                 byte_size,
                 storage_path,
                 visible_to_all,
                 viewer_roles,
                 posted_by_user_id,
                 created_at`,
      [
        title,
        documentType,
        description,
        visibleToAll,
        viewerRolesJson,
        id,
        condoId,
      ],
    );

    return res.json(upd.rows[0]);
  } catch (err) {
    return next(err);
  }
});

export default router;

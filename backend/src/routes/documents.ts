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

/** Envio e exclusão: apenas síndico e administração. */
function canManageDocuments(user: AppUserRow, condoId: number): boolean {
  return (
    user.active === true && user.condo_id === condoId && isBillingStaff(user.role)
  );
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
    const r = await query(
      `select id,
              condo_id,
              title,
              document_type,
              description,
              file_name,
              mime_type,
              byte_size,
              storage_path,
              created_at
       from condo_documents
       where condo_id = $1
       order by created_at desc
       limit 500`,
      [condoId],
    );
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
      if (user == null || !canManageDocuments(user, condoId)) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* empty */
        }
        return res.status(403).json({
          message:
            'Somente sindico e administracao podem enviar documentos.',
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

      const relPath = path
        .relative(UPLOADS_ROOT, file.path)
        .split(path.sep)
        .join('/');

      const ins = await query(
        `insert into condo_documents (
           condo_id, title, document_type, description, file_name, mime_type, byte_size, storage_path
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id,
                   condo_id,
                   title,
                   document_type,
                   description,
                   file_name,
                   mime_type,
                   byte_size,
                   storage_path,
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
    if (user == null || !canManageDocuments(user, condoId)) {
      return res.status(403).json({
        message: 'Somente sindico e administracao podem excluir documentos.',
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

export default router;

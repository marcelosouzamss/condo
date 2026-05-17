import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import multer from 'multer';
import { Router, type RequestHandler } from 'express';

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

/** Compara condomínio do utilizador com o pedido (evita falhas `===` com string vs número do driver). */
function userCondoMatches(userCondoId: unknown, requestedCondoId: number): boolean {
  return Number(userCondoId) === Number(requestedCondoId);
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

function normalizeRoleKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function normalizeAppRole(raw: unknown): string {
  const key = normalizeRoleKey(raw);
  switch (key) {
    case 'morador':
    case 'moradores':
    case 'residente':
    case 'residentes':
    case 'resident':
      return 'resident';
    case 'colaborador':
    case 'colaboradores':
    case 'collaborators':
    case 'collaborator':
      return 'collaborator';
    case 'parceiro':
    case 'parceiros':
    case 'partners':
    case 'partner':
      return 'partner';
    case 'sindico':
    case 'sindicos':
    case 'syndic':
      return 'syndic';
    case 'administracao':
    case 'administradora':
    case 'administradoras':
    case 'administrador':
    case 'administradores':
    case 'administrator':
      return 'administrator';
    default:
      return key;
  }
}

function canAccessDocumentsCondo(user: AppUserRow, condoId: number): boolean {
  if (user.active !== true) {
    return false;
  }
  if (userCondoMatches(user.condo_id, condoId)) {
    return true;
  }
  const role = normalizeAppRole(user.role);
  return role === 'administrator' || role === 'partner';
}

/** Envio e exclusão: síndico, administração, colaboradores e parceiros do condomínio. */
function canPublishDocuments(user: AppUserRow, condoId: number): boolean {
  const role = normalizeAppRole(user.role);
  return (
    user.active === true &&
    canAccessDocumentsCondo(user, condoId) &&
    (isBillingStaff(role) || role === 'collaborator' || role === 'partner')
  );
}

/**
 * Lista sem filtro de audiência: só síndico, administração e colaboradores.
 * Parceiros publicam documentos mas só veem o que é para todos ou inclui o seu perfil.
 */
function seesAllCondoDocuments(user: AppUserRow, condoId: number): boolean {
  if (!canAccessDocumentsCondo(user, condoId)) {
    return false;
  }
  const role = normalizeAppRole(user.role);
  return isBillingStaff(role) || role === 'collaborator';
}

/** Editar metadados: síndico ou administração; ou quem publicou o documento. */
function canEditDocument(
  user: AppUserRow,
  condoId: number,
  postedByUserId: number | null,
): boolean {
  if (!canAccessDocumentsCondo(user, condoId)) {
    return false;
  }
  if (isBillingStaff(normalizeAppRole(user.role))) {
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
    const role = normalizeAppRole(x);
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
    if (!canAccessDocumentsCondo(user, condoId)) {
      return res.status(403).json({ message: 'Sem permissao para acessar documentos deste condominio.' });
    }
    const requestedRole = normalizeAppRole(req.query.userRole ?? req.query.role);
    const effectiveUser: AppUserRow = {
      ...user,
      role: DOCUMENT_VIEW_ROLES.has(requestedRole)
        ? requestedRole
        : normalizeAppRole(user.role),
    };

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
    if (!seesAllCondoDocuments(effectiveUser, condoId)) {
      /** Comparação por elemento: robusto vs tipagem jsonb (parceiro, morador, etc.). */
      const roleKey = normalizeAppRole(effectiveUser.role);
      sql += ` and (
        visible_to_all = true
        or exists (
          select 1
          from jsonb_array_elements(
            case jsonb_typeof(coalesce(viewer_roles, '[]'::jsonb))
              when 'array' then coalesce(viewer_roles, '[]'::jsonb)
              when 'string' then jsonb_build_array(trim(both from (viewer_roles #>> '{}')))
              else '[]'::jsonb
            end
          ) as vr(elem)
          where case lower(trim(vr.elem #>> '{}'))
            when 'morador' then 'resident'
            when 'moradores' then 'resident'
            when 'residente' then 'resident'
            when 'residentes' then 'resident'
            when 'resident' then 'resident'
            when 'colaborador' then 'collaborator'
            when 'colaboradores' then 'collaborator'
            when 'collaborators' then 'collaborator'
            when 'collaborator' then 'collaborator'
            when 'parceiro' then 'partner'
            when 'parceiros' then 'partner'
            when 'partners' then 'partner'
            when 'partner' then 'partner'
            when 'síndico' then 'syndic'
            when 'sindico' then 'syndic'
            when 'síndicos' then 'syndic'
            when 'sindicos' then 'syndic'
            when 'syndic' then 'syndic'
            when 'administração' then 'administrator'
            when 'administracao' then 'administrator'
            when 'administradora' then 'administrator'
            when 'administradoras' then 'administrator'
            when 'administrador' then 'administrator'
            when 'administradores' then 'administrator'
            when 'administrator' then 'administrator'
            else lower(trim(vr.elem #>> '{}'))
          end = $2
        )
      )`;
      params.push(roleKey);
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

const updateDocumentMetadata: RequestHandler = async (req, res, next) => {
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
    if (!userCondoMatches(user.condo_id, condoId)) {
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
};

/** PATCH e PUT: alguns proxies bloqueiam PATCH; clientes usam PUT por defeito. */
router.patch('/:id', updateDocumentMetadata);
router.put('/:id', updateDocumentMetadata);

export default router;

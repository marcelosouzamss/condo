import { Router } from 'express';

import { query } from '../db';
import { userHasPartnerRole } from '../userContext';

const router = Router();

/** Perfis que podem listar todos os condomínios (escolha em «Fale com o condomínio»). */
const CONDO_LIST_ROLES = new Set([
  'admin',
  'syndic',
  'administrator',
  'partner',
]);

async function getActiveUserRole(userId: number): Promise<string | null> {
  const mem = await query(
    `select role
     from app_user_condo_memberships
     where user_id = $1 and active = true`,
    [userId],
  );
  for (const row of mem.rows) {
    const role = String(row.role);
    if (CONDO_LIST_ROLES.has(role)) {
      return role;
    }
  }

  if (await userHasPartnerRole(userId)) {
    return 'partner';
  }

  const r = await query(
    `select role from app_users where id = $1 and active = true limit 1`,
    [userId],
  );
  if (r.rows.length === 0) {
    return null;
  }
  return String(r.rows[0].role);
}

/** Lista condomínios cadastrados (para seleção em atendimento / relacionamento). */
router.get('/', async (req, res, next) => {
  try {
    const userId = Number(req.query.userId);
    if (!Number.isFinite(userId) || userId < 1) {
      return res.status(400).json({ message: 'userId invalido.' });
    }
    const role = await getActiveUserRole(userId);
    if (role == null || !CONDO_LIST_ROLES.has(role)) {
      return res
        .status(403)
        .json({ message: 'Sem permissao para listar condomínios.' });
    }

    const r = await query(
      `select id, name, created_at from condos order by lower(name) asc`,
    );
    return res.json(r.rows);
  } catch (err) {
    return next(err);
  }
});

/** Cadastro de condomínio (apenas perfil admin da plataforma). */
router.post('/', async (req, res, next) => {
  try {
    const userId = Number((req.body || {}).userId);
    const name = String((req.body || {}).name ?? '').trim();
    if (!Number.isFinite(userId) || userId < 1) {
      return res.status(400).json({ message: 'userId invalido.' });
    }
    if (!name || name.length > 150) {
      return res.status(400).json({
        message: 'name e obrigatorio (ate 150 caracteres).',
      });
    }

    const role = await getActiveUserRole(userId);
    if (role !== 'admin') {
      return res.status(403).json({
        message: 'Apenas perfil administrador pode cadastrar condomínios.',
      });
    }

    const ins = await query(
      `insert into condos (name) values ($1)
       returning id, name, created_at`,
      [name],
    );
    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    return next(err);
  }
});

export default router;

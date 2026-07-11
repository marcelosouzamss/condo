import type { Request, Response } from 'express';
import { Router } from 'express';

import { query } from '../db';
import {
  listLoginCondoOptions,
  loadUserCondoContext,
  sessionFromAccessibleCondo,
  type AccessibleCondo,
} from '../userContext';
import { signAccessToken, signPreAuthToken, verifyPreAuthToken, refreshTokenMaxAgeMs, verifyAccessToken } from '../auth/jwt';
import { extractBearer } from '../auth/middleware';
import {
  clearLoginFailures,
  checkLoginAllowed,
  recordLoginFailure,
} from '../auth/rateLimit';
import { hashPassword, verifyPassword, validatePasswordPolicy } from '../auth/password';
import { consumeInviteToken, loadInvitePreview } from '../auth/invites';
import {
  generateRefreshToken,
  persistRefreshToken,
  revokeAllUserRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  validateRefreshToken,
} from '../auth/refreshTokens';

const router = Router();

const REFRESH_COOKIE = 'condo_refresh';

type AppUserRow = {
  id: number;
  condo_id: number;
  unit_id: number | null;
  full_name: string;
  login: string;
  role: string;
  active: boolean;
  password_plain: string | null;
  password_hash: string | null;
  pending_activation: boolean;
};

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    return forwarded.split(',')[0]?.trim() || req.ip || 'unknown';
  }
  return req.ip || 'unknown';
}

function readRefreshFromRequest(req: Request): string | null {
  const fromBody = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
  if (typeof fromBody === 'string' && fromBody.trim() !== '') {
    return fromBody.trim();
  }
  const fromCookie = req.cookies?.[REFRESH_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie.trim() !== '') {
    return fromCookie.trim();
  }
  return null;
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: refreshTokenMaxAgeMs(),
    path: '/api/auth',
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

async function verifyUserPassword(
  user: AppUserRow,
  password: string,
): Promise<boolean> {
  if (user.password_hash) {
    return verifyPassword(password, user.password_hash);
  }
  if (user.password_plain && user.password_plain === password) {
    const hash = await hashPassword(password);
    await query(
      `update app_users
       set password_hash = $1, password_plain = ''
       where id = $2`,
      [hash, user.id],
    );
    return true;
  }
  return false;
}

async function loadUserByLogin(login: string): Promise<AppUserRow | null> {
  const r = await query(
    `select id, condo_id, unit_id, full_name, login, role, active,
            password_plain, password_hash, pending_activation
     from app_users
     where lower(login) = $1
     limit 1`,
    [login],
  );
  if (r.rows.length === 0) {
    return null;
  }
  return r.rows[0] as AppUserRow;
}

function sessionUserPayload(
  userId: number,
  fullName: string,
  login: string,
  pick: AccessibleCondo,
) {
  return sessionFromAccessibleCondo(userId, fullName, login, pick);
}

async function issueSessionTokens(
  req: Request,
  res: Response,
  userId: number,
  fullName: string,
  login: string,
  pick: AccessibleCondo,
) {
  const user = sessionUserPayload(userId, fullName, login, pick);
  const accessToken = signAccessToken({
    sub: userId,
    condoId: user.condoId,
    role: user.role,
    unitId: user.unitId,
  });
  const refreshToken = generateRefreshToken();
  await persistRefreshToken(userId, refreshToken, {
    userAgent: req.headers['user-agent'],
    ip: clientIp(req),
  });
  setRefreshCookie(res, refreshToken);
  return {
    user,
    accessToken,
    refreshToken,
    expiresIn: Number(process.env.ACCESS_TOKEN_TTL_MIN || 60) * 60,
  };
}

async function respondWithLoginForUser(req: Request, res: Response, user: AppUserRow) {
  const userId = user.id;
  const selection = await listLoginCondoOptions(userId);
  const ip = clientIp(req);

  if (selection.mode === 'skip') {
    const accessToken = signAccessToken({
      sub: userId,
      condoId: user.condo_id,
      role: user.role,
      unitId: user.unit_id,
    });
    const refreshToken = generateRefreshToken();
    await persistRefreshToken(userId, refreshToken, {
      userAgent: req.headers['user-agent'],
      ip,
    });
    setRefreshCookie(res, refreshToken);
    return res.json({
      user: {
        id: userId,
        condoId: user.condo_id,
        unitId: user.unit_id,
        fullName: user.full_name,
        login: user.login,
        role: user.role,
        condoName: null,
      },
      condoSelection: selection,
      accessToken,
      refreshToken,
      expiresIn: Number(process.env.ACCESS_TOKEN_TTL_MIN || 60) * 60,
    });
  }

  if (selection.condos.length === 0) {
    return res.status(403).json({
      message: 'Usuario sem condominio associado. Contacte a administracao.',
    });
  }

  if (selection.mode === 'auto') {
    const issued = await issueSessionTokens(
      req,
      res,
      userId,
      user.full_name,
      user.login,
      selection.condos[0],
    );
    return res.json({
      user: issued.user,
      condoSelection: selection,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.expiresIn,
    });
  }

  const preAuthToken = signPreAuthToken(userId);
  return res.json({
    user: {
      id: userId,
      condoId: null,
      unitId: null,
      fullName: user.full_name,
      login: user.login,
      role: null,
      condoName: null,
    },
    condoSelection: selection,
    preAuthToken,
  });
}

router.post('/login', async (req, res, next) => {
  try {
    const { login, password } = (req.body || {}) as {
      login?: string;
      password?: string;
    };
    const normalizedLogin = login?.trim().toLowerCase() || '';
    const rawPassword = password?.trim() || '';

    if (!normalizedLogin || !rawPassword) {
      return res.status(400).json({ message: 'login e password sao obrigatorios.' });
    }

    const ip = clientIp(req);
    const gate = checkLoginAllowed(ip, normalizedLogin);
    if (!gate.allowed) {
      return res.status(429).json({
        message: `Muitas tentativas falhas. Tente novamente em ${gate.retryAfterSec ?? 900} segundos.`,
      });
    }

    const user = await loadUserByLogin(normalizedLogin);
    if (user == null) {
      recordLoginFailure(ip, normalizedLogin);
      return res.status(401).json({ message: 'Credenciais invalidas.' });
    }

    if (user.pending_activation && !user.password_hash) {
      return res.status(403).json({
        message:
          'Conta pendente de ativacao. Use o link de convite enviado pela administracao para definir sua senha.',
        code: 'pending_activation',
      });
    }

    if (!(await verifyUserPassword(user, rawPassword))) {
      recordLoginFailure(ip, normalizedLogin);
      return res.status(401).json({ message: 'Credenciais invalidas.' });
    }

    if (user.active !== true) {
      return res.status(403).json({ message: 'Usuario inativo.' });
    }

    clearLoginFailures(ip, normalizedLogin);

    return respondWithLoginForUser(req, res, user);
  } catch (error) {
    return next(error);
  }
});

router.get('/invite-preview', async (req, res, next) => {
  try {
    const token = String(req.query.token ?? '').trim();
    if (!token) {
      return res.status(400).json({ message: 'token e obrigatorio.' });
    }
    const preview = await loadInvitePreview(token);
    if (!preview) {
      return res.status(404).json({ message: 'Convite invalido ou expirado.' });
    }
    return res.json(preview);
  } catch (error) {
    return next(error);
  }
});

router.post('/accept-invite', async (req, res, next) => {
  try {
    const body = (req.body || {}) as { token?: string; password?: string };
    const token = String(body.token ?? '').trim();
    const password = String(body.password ?? '').trim();
    if (!token || !password) {
      return res.status(400).json({ message: 'token e password sao obrigatorios.' });
    }

    const preview = await loadInvitePreview(token);
    if (!preview) {
      return res.status(404).json({ message: 'Convite invalido ou expirado.' });
    }

    const roleRow = await query(
      `select m.role
       from app_user_condo_memberships m
       where m.user_id = $1 and m.active = true
       order by m.condo_id asc
       limit 1`,
      [preview.userId],
    );
    const role =
      roleRow.rows.length > 0
        ? String((roleRow.rows[0] as { role: string }).role)
        : 'resident';

    const passwordError = validatePasswordPolicy(password, role);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const passwordHash = await hashPassword(password);
    const userId = await consumeInviteToken(token);
    if (userId == null) {
      return res.status(404).json({ message: 'Convite invalido ou expirado.' });
    }

    await query(
      `update app_users
       set password_hash = $1,
           password_plain = '',
           pending_activation = false
       where id = $2`,
      [passwordHash, userId],
    );

    const user = await loadUserByLogin(preview.login);
    if (user == null || user.active !== true) {
      return res.status(403).json({ message: 'Usuario inativo.' });
    }

    return respondWithLoginForUser(req, res, user);
  } catch (error) {
    return next(error);
  }
});

router.post('/select-condo', async (req, res, next) => {
  try {
    const body = (req.body || {}) as {
      preAuthToken?: string;
      condoId?: number | string;
    };
    const token = String(body.preAuthToken ?? '').trim();
    const condoId = Number(body.condoId);
    if (!token || !Number.isFinite(condoId) || condoId < 1) {
      return res.status(400).json({
        message: 'preAuthToken e condoId sao obrigatorios.',
      });
    }

    const claims = verifyPreAuthToken(token);
    if (!claims) {
      return res.status(401).json({ message: 'Sessao de selecao expirada. Faca login novamente.' });
    }

    const selection = await listLoginCondoOptions(claims.sub);
    const pick = selection.condos.find((c) => c.condoId === condoId);
    if (!pick) {
      return res.status(403).json({ message: 'Condominio nao acessivel para este usuario.' });
    }

    const ident = await query(
      `select full_name, login from app_users where id = $1 limit 1`,
      [claims.sub],
    );
    if (ident.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }
    const row = ident.rows[0] as { full_name: string; login: string };

    const issued = await issueSessionTokens(
      req,
      res,
      claims.sub,
      row.full_name,
      row.login,
      pick,
    );
    return res.json({
      user: issued.user,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.expiresIn,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = readRefreshFromRequest(req);
    if (!refreshToken) {
      return res.status(401).json({ message: 'Refresh token ausente.' });
    }

    const userId = await validateRefreshToken(refreshToken);
    if (userId == null) {
      clearRefreshCookie(res);
      return res.status(401).json({ message: 'Refresh token invalido ou expirado.' });
    }

    const ident = await query(
      `select id, active, condo_id, unit_id, role, full_name, login
       from app_users where id = $1 limit 1`,
      [userId],
    );
    if (ident.rows.length === 0 || (ident.rows[0] as { active: boolean }).active !== true) {
      await revokeRefreshToken(refreshToken);
      clearRefreshCookie(res);
      return res.status(403).json({ message: 'Usuario inativo.' });
    }

    const user = ident.rows[0] as AppUserRow;
    const condoId = Number(req.body?.condoId ?? req.auth?.condoId ?? user.condo_id);
    const ctx = await loadUserCondoContext(userId, condoId);
    if (ctx == null) {
      await revokeRefreshToken(refreshToken);
      clearRefreshCookie(res);
      return res.status(403).json({ message: 'Contexto de condominio invalido.' });
    }

    const rotated = await rotateRefreshToken(refreshToken, userId, {
      userAgent: req.headers['user-agent'],
      ip: clientIp(req),
    });
    if (!rotated.valid || !rotated.newToken) {
      clearRefreshCookie(res);
      return res.status(401).json({ message: 'Refresh token invalido ou expirado.' });
    }

    const accessToken = signAccessToken({
      sub: userId,
      condoId: ctx.condoId,
      role: ctx.role,
      unitId: ctx.unitId,
    });
    setRefreshCookie(res, rotated.newToken);

    return res.json({
      accessToken,
      refreshToken: rotated.newToken,
      expiresIn: Number(process.env.ACCESS_TOKEN_TTL_MIN || 60) * 60,
      user: {
        id: userId,
        condoId: ctx.condoId,
        unitId: ctx.unitId,
        fullName: ctx.fullName,
        login: ctx.login,
        role: ctx.role,
        condoName: null,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const refreshToken = readRefreshFromRequest(req);
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    const bearer = extractBearer(req);
    if (bearer) {
      const claims = verifyAccessToken(bearer);
      if (claims) {
        await revokeAllUserRefreshTokens(claims.sub);
      }
    }
    clearRefreshCookie(res);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export { validatePasswordPolicy, hashPassword } from '../auth/password';
export default router;

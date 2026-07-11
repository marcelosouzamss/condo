import type { NextFunction, Request, Response } from 'express';

import { verifyAccessToken, type AccessClaims } from './jwt';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AccessClaims;
  }
}

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/health/db',
  '/api/modules',
  '/api/auth/login',
  '/api/auth/login-appearance',
  '/api/auth/refresh',
  '/api/auth/select-condo',
  '/api/auth/invite-preview',
  '/api/auth/accept-invite',
]);

function requestPath(req: Request): string {
  return (req.originalUrl ?? req.url ?? '').split('?')[0];
}

export function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice(7).trim();
  return token || null;
}

function injectAuthIntoRequest(req: Request): void {
  if (!req.auth) {
    return;
  }
  const query = req.query as Record<string, unknown>;
  query.userId = String(req.auth.sub);
  if (req.auth.condoId) {
    query.condoId = String(req.auth.condoId);
  }

  if (req.body && typeof req.body === 'object') {
    const body = req.body as Record<string, unknown>;
    body.userId = req.auth.sub;
    if (req.auth.condoId) {
      body.condoId = req.auth.condoId;
    }
  }
}

function parsePositiveQuery(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const path = requestPath(req);
  if (path.startsWith('/uploads') || PUBLIC_PATHS.has(path)) {
    next();
    return;
  }

  const token = extractBearer(req);
  if (!token) {
    next();
    return;
  }

  const claims = verifyAccessToken(token);
  if (!claims) {
    res.status(401).json({ message: 'Token invalido ou expirado.' });
    return;
  }

  req.auth = claims;
  injectAuthIntoRequest(req);

  const qUserId = parsePositiveQuery(req.query.userId);
  const qCondoId = parsePositiveQuery(req.query.condoId);
  if (qUserId != null && qUserId !== claims.sub) {
    res.status(403).json({ message: 'userId nao corresponde ao token.' });
    return;
  }
  if (qCondoId != null && claims.condoId && qCondoId !== claims.condoId) {
    res.status(403).json({ message: 'condoId nao corresponde ao token.' });
    return;
  }

  next();
}

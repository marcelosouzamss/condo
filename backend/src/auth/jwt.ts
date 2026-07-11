import jwt from 'jsonwebtoken';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production.');
  }
  return 'dev-insecure-change-me';
}

const accessTtlMin = Number(process.env.ACCESS_TOKEN_TTL_MIN || 60);
const refreshTtlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 14);
const preAuthTtlMin = Number(process.env.PRE_AUTH_TOKEN_TTL_MIN || 10);

export type AccessClaims = {
  sub: number;
  condoId: number;
  role: string;
  unitId: number | null;
  type: 'access';
};

export type PreAuthClaims = {
  sub: number;
  type: 'pre_auth';
};

export function accessTokenExpiresInSec(): number {
  return accessTtlMin * 60;
}

export function refreshTokenMaxAgeMs(): number {
  return refreshTtlDays * 24 * 60 * 60 * 1000;
}

export function signAccessToken(claims: {
  sub: number;
  condoId: number;
  role: string;
  unitId: number | null;
}): string {
  const payload: AccessClaims = {
    sub: claims.sub,
    condoId: claims.condoId,
    role: claims.role,
    unitId: claims.unitId,
    type: 'access',
  };
  return jwt.sign(payload, jwtSecret(), { expiresIn: `${accessTtlMin}m` });
}

export function signPreAuthToken(userId: number): string {
  const payload: PreAuthClaims = { sub: userId, type: 'pre_auth' };
  return jwt.sign(payload, jwtSecret(), { expiresIn: `${preAuthTtlMin}m` });
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const decoded = jwt.verify(token, jwtSecret()) as unknown;
    if (!decoded || typeof decoded !== 'object') {
      return null;
    }
    const claims = decoded as AccessClaims;
    if (claims.type !== 'access' || !Number.isFinite(claims.sub)) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export function verifyPreAuthToken(token: string): PreAuthClaims | null {
  try {
    const decoded = jwt.verify(token, jwtSecret()) as unknown;
    if (!decoded || typeof decoded !== 'object') {
      return null;
    }
    const claims = decoded as PreAuthClaims;
    if (claims.type !== 'pre_auth' || !Number.isFinite(claims.sub)) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export function refreshExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + refreshTtlDays);
  return d;
}

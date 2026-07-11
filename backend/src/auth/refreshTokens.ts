import crypto from 'node:crypto';

import { query } from '../db';
import { refreshExpiresAt } from './jwt';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

export async function persistRefreshToken(
  userId: number,
  token: string,
  meta?: { userAgent?: string; ip?: string },
): Promise<void> {
  await query(
    `insert into app_refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
     values ($1, $2, $3, $4, $5)`,
    [
      userId,
      hashToken(token),
      refreshExpiresAt(),
      meta?.userAgent ?? null,
      meta?.ip ?? null,
    ],
  );
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await query(
    `update app_refresh_tokens
     set revoked_at = now()
     where token_hash = $1 and revoked_at is null`,
    [hashToken(token)],
  );
}

export async function validateRefreshToken(token: string): Promise<number | null> {
  const r = await query(
    `select user_id
     from app_refresh_tokens
     where token_hash = $1
       and revoked_at is null
       and expires_at > now()
     limit 1`,
    [hashToken(token)],
  );
  if (r.rows.length === 0) {
    return null;
  }
  return (r.rows[0] as { user_id: number }).user_id;
}

export async function rotateRefreshToken(
  oldToken: string,
  userId: number,
  meta?: { userAgent?: string; ip?: string },
): Promise<{ valid: boolean; newToken?: string }> {
  const hash = hashToken(oldToken);
  const r = await query(
    `select id, user_id
     from app_refresh_tokens
     where token_hash = $1
       and revoked_at is null
       and expires_at > now()
     limit 1`,
    [hash],
  );
  if (r.rows.length === 0) {
    return { valid: false };
  }
  const row = r.rows[0] as { id: number; user_id: number };
  if (row.user_id !== userId) {
    return { valid: false };
  }

  await query(`update app_refresh_tokens set revoked_at = now() where id = $1`, [row.id]);
  const newToken = generateRefreshToken();
  await persistRefreshToken(userId, newToken, meta);
  return { valid: true, newToken };
}

export async function revokeAllUserRefreshTokens(userId: number): Promise<void> {
  await query(
    `update app_refresh_tokens
     set revoked_at = now()
     where user_id = $1 and revoked_at is null`,
    [userId],
  );
}

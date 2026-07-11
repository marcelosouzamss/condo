import crypto from 'node:crypto';

import { query } from '../db';

const INVITE_TTL_DAYS = Number(process.env.INVITE_TOKEN_TTL_DAYS || 7);

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function inviteExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + INVITE_TTL_DAYS);
  return d;
}

export function buildInviteWebUrl(rawToken: string): string | null {
  const base = (
    process.env.INVITE_WEB_BASE_URL ||
    process.env.CORS_ORIGIN ||
    ''
  ).trim().replace(/\/$/, '');
  if (!base || base === '*') {
    return null;
  }
  return `${base}/ativar?token=${encodeURIComponent(rawToken)}`;
}

export async function revokeOpenInvitesForUser(userId: number): Promise<void> {
  await query(
    `update app_user_invites
     set used_at = now()
     where user_id = $1 and used_at is null`,
    [userId],
  );
}

export async function createUserInvite(
  userId: number,
  createdByUserId: number | null,
): Promise<{ rawToken: string; expiresAt: Date }> {
  await revokeOpenInvitesForUser(userId);
  const rawToken = generateInviteToken();
  const expiresAt = inviteExpiresAt();
  await query(
    `insert into app_user_invites (user_id, token_hash, expires_at, created_by_user_id)
     values ($1, $2, $3, $4)`,
    [userId, hashToken(rawToken), expiresAt, createdByUserId],
  );
  return { rawToken, expiresAt };
}

export type InvitePreview = {
  userId: number;
  fullName: string;
  login: string;
  condoId: number;
  condoName: string;
  expiresAt: string;
};

export async function loadInvitePreview(rawToken: string): Promise<InvitePreview | null> {
  const r = await query(
    `select i.expires_at, i.used_at,
            u.id as user_id, u.full_name, u.login, u.pending_activation,
            u.password_hash, u.active,
            c.id as condo_id, c.name as condo_name
     from app_user_invites i
     join app_users u on u.id = i.user_id
     join condos c on c.id = u.condo_id
     where i.token_hash = $1
     limit 1`,
    [hashToken(rawToken)],
  );
  if (r.rows.length === 0) {
    return null;
  }
  const row = r.rows[0] as {
    expires_at: string;
    used_at: string | null;
    user_id: number;
    full_name: string;
    login: string;
    pending_activation: boolean;
    password_hash: string | null;
    active: boolean;
    condo_id: number;
    condo_name: string;
  };
  if (row.used_at != null) {
    return null;
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return null;
  }
  if (row.active !== true) {
    return null;
  }
  if (!row.pending_activation && row.password_hash) {
    return null;
  }
  return {
    userId: row.user_id,
    fullName: row.full_name,
    login: row.login,
    condoId: row.condo_id,
    condoName: row.condo_name,
    expiresAt: row.expires_at,
  };
}

export async function consumeInviteToken(rawToken: string): Promise<number | null> {
  const preview = await loadInvitePreview(rawToken);
  if (!preview) {
    return null;
  }
  await query(
    `update app_user_invites
     set used_at = now()
     where token_hash = $1 and used_at is null`,
    [hashToken(rawToken)],
  );
  return preview.userId;
}

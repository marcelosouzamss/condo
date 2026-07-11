export const WEB_USER_SESSION_KEY = 'condo_web_user_v1';
export const WEB_PENDING_CONDO_KEY = 'condo_web_pending_condo_v1';
export const WEB_ACCESS_TOKEN_KEY = 'condo_web_access_v1';

export type WebUserPayload = {
  id: number;
  condoId: number;
  unitId: number | null;
  fullName: string;
  login: string;
  role: string;
  condoName?: string;
};

export type AccessibleCondoOption = {
  condoId: number;
  condoName: string;
  role: string;
  unitId: number | null;
};

export type PendingLoginPayload = {
  id: number;
  fullName: string;
  login: string;
  condos: AccessibleCondoOption[];
  preAuthToken?: string;
};

export function saveAccessToken(token: string): void {
  sessionStorage.setItem(WEB_ACCESS_TOKEN_KEY, token);
}

export function loadAccessToken(): string | null {
  const raw = sessionStorage.getItem(WEB_ACCESS_TOKEN_KEY);
  if (!raw || raw.trim() === '') {
    return null;
  }
  return raw.trim();
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(WEB_ACCESS_TOKEN_KEY);
}

export function saveWebUserSession(user: WebUserPayload): void {
  sessionStorage.setItem(WEB_USER_SESSION_KEY, JSON.stringify(user));
}

export function savePendingCondoSelection(pending: PendingLoginPayload): void {
  sessionStorage.setItem(WEB_PENDING_CONDO_KEY, JSON.stringify(pending));
}

export function loadPendingCondoSelection(): PendingLoginPayload | null {
  try {
    const raw = sessionStorage.getItem(WEB_PENDING_CONDO_KEY);
    if (!raw) {
      return null;
    }
    const o = JSON.parse(raw) as PendingLoginPayload;
    if (
      typeof o.id !== 'number' ||
      typeof o.fullName !== 'string' ||
      typeof o.login !== 'string' ||
      !Array.isArray(o.condos)
    ) {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export function clearPendingCondoSelection(): void {
  sessionStorage.removeItem(WEB_PENDING_CONDO_KEY);
}

export function loadWebUserSession(): WebUserPayload | null {
  try {
    const raw = sessionStorage.getItem(WEB_USER_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const o = JSON.parse(raw) as WebUserPayload;
    if (
      typeof o.id !== 'number' ||
      typeof o.condoId !== 'number' ||
      typeof o.fullName !== 'string' ||
      typeof o.login !== 'string' ||
      typeof o.role !== 'string'
    ) {
      return null;
    }
    return {
      ...o,
      unitId: o.unitId == null ? null : Number(o.unitId),
    };
  } catch {
    return null;
  }
}

export function clearWebUserSession(): void {
  sessionStorage.removeItem(WEB_USER_SESSION_KEY);
  clearAccessToken();
}

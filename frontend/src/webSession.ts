export const WEB_USER_SESSION_KEY = 'condo_web_user_v1';

export type WebUserPayload = {
  id: number;
  condoId: number;
  unitId: number | null;
  fullName: string;
  login: string;
  role: string;
};

export function saveWebUserSession(user: WebUserPayload): void {
  sessionStorage.setItem(WEB_USER_SESSION_KEY, JSON.stringify(user));
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
}

const LAST_LOGIN_CONDO_ID_KEY = 'condo_web_last_login_condo_id_v1';

export function readLastLoginCondoId(): number | null {
  try {
    const raw = localStorage.getItem(LAST_LOGIN_CONDO_ID_KEY);
    if (!raw) {
      return null;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeLastLoginCondoId(condoId: number): void {
  if (!Number.isFinite(condoId) || condoId < 1) {
    return;
  }
  localStorage.setItem(LAST_LOGIN_CONDO_ID_KEY, String(condoId));
}

export function appearanceCondoIdFromEnv(): number {
  const fromQuery =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('condoId')?.trim()
      : '';
  if (fromQuery) {
    const n = Number.parseInt(fromQuery, 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  const fromEnv = import.meta.env.VITE_LOGIN_CONDO_ID?.trim();
  if (fromEnv) {
    const n = Number.parseInt(fromEnv, 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return readLastLoginCondoId() ?? 1;
}

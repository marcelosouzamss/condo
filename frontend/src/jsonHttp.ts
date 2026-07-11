import { apiUrl } from './api';
import {
  clearAccessToken,
  clearWebUserSession,
  loadAccessToken,
  loadWebUserSession,
  saveAccessToken,
  saveWebUserSession,
  type WebUserPayload,
} from './webSession';

async function readErrorBody(r: Response): Promise<string> {
  try {
    const t = await r.text();
    if (!t) {
      return r.statusText || `Erro ${r.status}`;
    }
    const j = JSON.parse(t) as { message?: string };
    return j.message ?? t;
  } catch {
    return r.statusText || `Erro ${r.status}`;
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const token = loadAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshAccessToken(): Promise<boolean> {
  const session = loadWebUserSession();
  if (!session) {
    return false;
  }
  const r = await fetch(apiUrl('/api/auth/refresh'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ condoId: session.condoId }),
  });
  if (!r.ok) {
    clearWebUserSession();
    return false;
  }
  const body = (await r.json()) as {
    accessToken?: string;
    user?: WebUserPayload;
  };
  if (!body.accessToken) {
    clearWebUserSession();
    return false;
  }
  saveAccessToken(body.accessToken);
  if (body.user) {
    saveWebUserSession({
      ...session,
      ...body.user,
      condoName: body.user.condoName ?? session.condoName,
    });
  }
  return true;
}

async function fetchWithAuth(path: string, init: RequestInit, retried = false): Promise<Response> {
  const headers = authHeaders(
    init.headers && typeof init.headers === 'object'
      ? (init.headers as Record<string, string>)
      : undefined,
  );
  const r = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers,
  });
  if (r.status === 401 && !retried) {
    if (!refreshPromise) {
      refreshPromise = tryRefreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }
    const refreshed = await refreshPromise;
    if (refreshed) {
      return fetchWithAuth(path, init, true);
    }
    clearAccessToken();
  }
  return r;
}

export async function getJson<T>(pathWithQuery: string): Promise<T> {
  const r = await fetchWithAuth(pathWithQuery, { method: 'GET' });
  if (!r.ok) {
    throw new Error(await readErrorBody(r));
  }
  if (r.status === 204) {
    return undefined as T;
  }
  const t = await r.text();
  if (!t) {
    return undefined as T;
  }
  return JSON.parse(t) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetchWithAuth(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(await readErrorBody(r));
  }
  if (r.status === 204) {
    return undefined as T;
  }
  const t = await r.text();
  if (!t) {
    return undefined as T;
  }
  return JSON.parse(t) as T;
}

export async function putJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetchWithAuth(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(await readErrorBody(r));
  }
  const t = await r.text();
  if (!t) {
    return undefined as T;
  }
  return JSON.parse(t) as T;
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetchWithAuth(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(await readErrorBody(r));
  }
  const t = await r.text();
  if (!t) {
    return undefined as T;
  }
  return JSON.parse(t) as T;
}

export async function deleteVoid(pathWithQuery: string): Promise<void> {
  const r = await fetchWithAuth(pathWithQuery, { method: 'DELETE' });
  if (!r.ok) {
    throw new Error(await readErrorBody(r));
  }
}

/** multipart/form-data (não definir Content-Type manualmente — o boundary é necessário). */
export async function postFormDataJson<T>(path: string, formData: FormData): Promise<T> {
  const r = await fetchWithAuth(path, {
    method: 'POST',
    body: formData,
  });
  if (!r.ok) {
    throw new Error(await readErrorBody(r));
  }
  const t = await r.text();
  if (!t) {
    return undefined as T;
  }
  return JSON.parse(t) as T;
}

export async function logoutWebSession(): Promise<void> {
  try {
    await fetch(apiUrl('/api/auth/logout'), {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
    });
  } catch {
    /* ignora falha de rede */
  }
  clearWebUserSession();
}

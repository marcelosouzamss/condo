import { apiUrl } from './api';

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

export async function getJson<T>(pathWithQuery: string): Promise<T> {
  const r = await fetch(apiUrl(pathWithQuery));
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
  const r = await fetch(apiUrl(path), {
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
  const r = await fetch(apiUrl(path), {
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
  const r = await fetch(apiUrl(path), {
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
  const r = await fetch(apiUrl(pathWithQuery), { method: 'DELETE' });
  if (!r.ok) {
    throw new Error(await readErrorBody(r));
  }
}

/** multipart/form-data (não definir Content-Type manualmente — o boundary é necessário). */
export async function postFormDataJson<T>(path: string, formData: FormData): Promise<T> {
  const r = await fetch(apiUrl(path), {
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

/**
 * Base URL do backend (sem barra final). Vazio = mesmo host (ex.: proxy `/api` no Vite).
 * Em produção com front estático separado, defina `VITE_API_BASE_URL`.
 */
export function getApiBase(): string {
  const v = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!v) {
    return '';
  }
  return v.replace(/\/$/, '');
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBase();
  return base ? `${base}${p}` : p;
}

/** Respostas típicas quando o proxy Vite não consegue ligar ao backend (API parada ou URL errado). */
export function isLikelyUnreachableApiStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/**
 * O proxy do Vite devolve 500 com corpo vazio quando a ligação ao `target` é recusada (ECONNREFUSED).
 */
export function isProxyOrApiDownMessage(status: number, parsedBody: unknown): boolean {
  if (status !== 500) {
    return false;
  }
  if (!parsedBody || typeof parsedBody !== 'object' || parsedBody === null) {
    return true;
  }
  if (!('message' in parsedBody)) {
    return true;
  }
  const m = (parsedBody as { message?: unknown }).message;
  return typeof m !== 'string' || m.trim() === '';
}

export function apiUnreachableHint(): string {
  const base = getApiBase();
  if (base) {
    return `Não foi possível contactar a API em ${base}. Verifique o URL, a rede e o CORS.`;
  }
  return (
    'Não foi possível contactar a API (proxy → servidor). ' +
    'Por padrão o proxy de desenvolvimento usa o mesmo backend do app móvel. ' +
    'Se quiser usar uma API local, crie `frontend/.env` com VITE_DEV_PROXY_TARGET=http://HOST:PORTA ' +
    '(reinicie o Vite) ou defina VITE_API_BASE_URL com o URL completo da API.'
  );
}

/** Caminho relativo gravado na BD (ex.: `condo-1/logo.png`) → URL absoluta ou relativa ao host. */
export function uploadsUrl(relativePath: string): string {
  let p = relativePath.trim().replace(/\\/g, '/');
  if (!p) {
    return apiUrl('/uploads');
  }
  if (!p.startsWith('/')) {
    p = `/${p}`;
  }
  if (!p.startsWith('/uploads/')) {
    p = `/uploads${p}`;
  }
  return apiUrl(p);
}

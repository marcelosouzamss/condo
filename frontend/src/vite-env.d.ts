/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOGIN_URL: string | undefined;
  /** Base do backend (ex.: http://localhost:3333). Vazio = mesmo host / proxy. */
  readonly VITE_API_BASE_URL: string | undefined;
  /** Condomínio usado em `/api/auth/login-appearance` quando não há `?condoId=`. */
  readonly VITE_LOGIN_CONDO_ID: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

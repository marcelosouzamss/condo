import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  apiUnreachableHint,
  apiUrl,
  isLikelyUnreachableApiStatus,
  isProxyOrApiDownMessage,
  uploadsUrl,
} from './api';
import { readLastLoginCondoId, writeLastLoginCondoId } from './loginAppearanceStorage';
import { loadWebUserSession, saveAccessToken, savePendingCondoSelection, saveWebUserSession, type AccessibleCondoOption, type WebUserPayload } from './webSession';
import './LoginPage.css';

type LoginAppearance = {
  condominiumName: string;
  logoRelativePath: string | null;
  backgroundRelativePath: string | null;
};

function LoginNavLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const external = /^https?:\/\//i.test(href) || href.startsWith('//');
  if (external) {
    return (
      <a className={className} href={href}>
        {children}
      </a>
    );
  }
  return (
    <Link className={className} to={href}>
      {children}
    </Link>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const condoIdParam = searchParams.get('condoId');
  const appearanceCondoId = useMemo(() => {
    if (condoIdParam != null && String(condoIdParam).trim() !== '') {
      const n = Number.parseInt(String(condoIdParam), 10);
      if (Number.isFinite(n) && n > 0) {
        return n;
      }
    }
    const last = readLastLoginCondoId();
    if (last != null) {
      return last;
    }
    const fromEnv = import.meta.env.VITE_LOGIN_CONDO_ID?.trim();
    if (fromEnv) {
      const n = Number.parseInt(fromEnv, 10);
      if (Number.isFinite(n) && n > 0) {
        return n;
      }
    }
    return 1;
  }, [condoIdParam]);

  const [appearance, setAppearance] = useState<LoginAppearance>({
    condominiumName: 'Acesso ao Condomínio',
    logoRelativePath: null,
    backgroundRelativePath: null,
  });
  const [loginField, setLoginField] = useState('');
  const [passwordField, setPasswordField] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loadWebUserSession()) {
      navigate('/app', { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = new URL(apiUrl('/api/auth/login-appearance'));
        u.searchParams.set('condoId', String(appearanceCondoId));
        const r = await fetch(u.toString());
        if (!r.ok || cancelled) {
          return;
        }
        const m = (await r.json()) as {
          condominiumName?: string;
          logoRelativePath?: string | null;
          backgroundRelativePath?: string | null;
        };
        if (cancelled) {
          return;
        }
        const title = m.condominiumName?.trim();
        const logo = m.logoRelativePath?.trim();
        const background = m.backgroundRelativePath?.trim();
        setAppearance({
          condominiumName:
            title && title.length > 0 ? title : 'Acesso ao Condomínio',
          logoRelativePath: logo && logo.length > 0 ? logo : null,
          backgroundRelativePath:
            background && background.length > 0 ? background : null,
        });
      } catch {
        /* mantém padrão */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appearanceCondoId]);

  useEffect(() => {
    document.title = 'Entrar — Condo App';
    return () => {
      document.title = 'Condo App — Gestão do condomínio';
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const login = loginField.trim();
    const password = passwordField.trim();
    if (!login || !password) {
      setError('Informe login e senha.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const r = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      const text = await r.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!r.ok) {
        const fromServer =
          body &&
          typeof body === 'object' &&
          body !== null &&
          'message' in body &&
          typeof (body as { message: unknown }).message === 'string'
            ? (body as { message: string }).message.trim()
            : '';
        const unreachable =
            isLikelyUnreachableApiStatus(r.status) ||
            isProxyOrApiDownMessage(r.status, body);
        const msg =
            fromServer ||
            (unreachable
                ? apiUnreachableHint()
                : `Falha no login (${r.status}).`);
        setError(msg);
        return;
      }
      if (
        !body ||
        typeof body !== 'object' ||
        !('user' in body) ||
        typeof (body as { user: unknown }).user !== 'object' ||
        (body as { user: unknown }).user === null
      ) {
        setError('Resposta inválida do servidor.');
        return;
      }
      const user = (body as { user: Record<string, unknown> }).user;
      const selectionRaw = (body as { condoSelection?: Record<string, unknown> }).condoSelection;
      const mode = String(selectionRaw?.mode ?? 'auto');
      const condosRaw = selectionRaw?.condos;
      const condos: AccessibleCondoOption[] = Array.isArray(condosRaw)
        ? condosRaw
            .map((item) => {
              if (!item || typeof item !== 'object') {
                return null;
              }
              const row = item as Record<string, unknown>;
              const condoId = Number(row.condoId);
              if (!Number.isFinite(condoId)) {
                return null;
              }
              return {
                condoId,
                condoName: String(row.condoName ?? 'Condomínio'),
                role: String(row.role ?? 'resident'),
                unitId:
                  row.unitId == null || row.unitId === undefined
                    ? null
                    : Number(row.unitId),
              };
            })
            .filter((item): item is AccessibleCondoOption => item != null)
        : [];

      const id = Number(user.id);
      const fullName = String(user.fullName ?? '');
      const loginStr = String(user.login ?? '');

      if (!Number.isFinite(id)) {
        setError('Resposta inválida do servidor.');
        return;
      }

      if (mode === 'pick' || user.condoId == null) {
        const preAuthToken =
          body &&
          typeof body === 'object' &&
          'preAuthToken' in body &&
          typeof (body as { preAuthToken: unknown }).preAuthToken === 'string'
            ? (body as { preAuthToken: string }).preAuthToken
            : undefined;
        savePendingCondoSelection({
          id,
          fullName,
          login: loginStr,
          condos,
          preAuthToken,
        });
        setPasswordField('');
        navigate('/select-condo', {
          replace: true,
          state: {
            pending: { id, fullName, login: loginStr, condos, preAuthToken },
          },
        });
        return;
      }

      const accessToken =
        body &&
        typeof body === 'object' &&
        'accessToken' in body &&
        typeof (body as { accessToken: unknown }).accessToken === 'string'
          ? (body as { accessToken: string }).accessToken
          : null;
      if (accessToken) {
        saveAccessToken(accessToken);
      }

      const condoId = Number(user.condoId);
      const unitRaw = user.unitId;
      const unitId =
        unitRaw === null || unitRaw === undefined ? null : Number(unitRaw);
      const role = String(user.role ?? 'resident');
      if (!Number.isFinite(condoId)) {
        setError('Resposta inválida do servidor.');
        return;
      }
      const payload: WebUserPayload = {
        id,
        condoId,
        unitId: unitId != null && Number.isFinite(unitId) ? unitId : null,
        fullName,
        login: loginStr,
        role,
        condoName:
          user.condoName != null ? String(user.condoName) : undefined,
      };
      saveWebUserSession(payload);
      writeLastLoginCondoId(payload.condoId);
      setPasswordField('');
      navigate('/app', { replace: true });
    } catch {
      setError(
        `Não foi possível conectar ao servidor. Verifique se a API está em execução${
          import.meta.env.VITE_API_BASE_URL?.trim()
            ? ''
            : ' (ou defina VITE_API_BASE_URL)'
        }.`,
      );
    } finally {
      setLoading(false);
    }
  }

  const homeHref = '/';

  return (
    <div
      className="login-page"
      style={
        appearance.backgroundRelativePath
          ? ({
              '--login-bg-image': `url("${uploadsUrl(appearance.backgroundRelativePath)}")`,
            } as CSSProperties)
          : undefined
      }
    >
      <header className="login-page__top">
        <LoginNavLink href={homeHref} className="login-page__back">
          ← Início
        </LoginNavLink>
      </header>

      <div className="login-page__shell">
        <div className="login-card">
          {appearance.logoRelativePath ? (
            <img
              className="login-card__logo"
              src={uploadsUrl(appearance.logoRelativePath)}
              alt=""
              width={280}
              height={100}
            />
          ) : (
            <div className="login-card__icon" aria-hidden>
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1h-5v-6H10v6H5a1 1 0 01-1-1v-9.5z"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}
          <h1 className="login-card__title">{appearance.condominiumName}</h1>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <label className="login-field">
              <span className="login-field__label">Login</span>
              <input
                type="text"
                name="login"
                autoComplete="username"
                value={loginField}
                onChange={(e) => setLoginField(e.target.value)}
                disabled={loading}
              />
            </label>
            <label className="login-field">
              <span className="login-field__label">Senha</span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                value={passwordField}
                onChange={(e) => setPasswordField(e.target.value)}
                disabled={loading}
              />
            </label>
            {error ? (
              <p className="login-form__error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              className="login-btn login-btn--primary login-btn--block"
              disabled={loading}
            >
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>

          <p className="login-card__footer-note">
            Esqueceu a senha? Contacte a administração do condomínio.
          </p>
          <p className="login-card__footer-note">
            Primeiro acesso? <Link to="/ativar">Ativar conta com convite</Link>
          </p>
        </div>
      </div>

      <footer className="login-page__footer">
        <p>
          <strong>Condo App</strong> · gestão e comunicação para condomínios
        </p>
      </footer>
    </div>
  );
}

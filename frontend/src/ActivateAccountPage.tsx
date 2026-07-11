import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiUrl } from './api';
import { writeLastLoginCondoId } from './loginAppearanceStorage';
import { saveAccessToken, savePendingCondoSelection, saveWebUserSession, type WebUserPayload } from './webSession';
import './LoginPage.css';

type InvitePreview = {
  fullName: string;
  login: string;
  condoName: string;
  expiresAt?: string;
};

export function ActivateAccountPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialToken = useMemo(() => searchParams.get('token')?.trim() ?? '', [searchParams]);

  const [tokenField, setTokenField] = useState(initialToken);
  const [passwordField, setPasswordField] = useState('');
  const [confirmField, setConfirmField] = useState('');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialToken) {
      void validateInvite(initialToken);
    }
  }, [initialToken]);

  async function validateInvite(token: string) {
    const trimmed = token.trim();
    if (!trimmed) {
      setPreview(null);
      setError('Informe o código do convite.');
      return;
    }
    setPreviewLoading(true);
    setError(null);
    try {
      const u = new URL(apiUrl('/api/auth/invite-preview'));
      u.searchParams.set('token', trimmed);
      const r = await fetch(u.toString());
      if (!r.ok) {
        setPreview(null);
        setError('Convite inválido ou expirado.');
        return;
      }
      const body = (await r.json()) as InvitePreview;
      setPreview(body);
    } catch {
      setPreview(null);
      setError('Falha de rede ao validar o convite.');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const token = tokenField.trim();
    const password = passwordField;
    const confirm = confirmField;
    if (!token || !password) {
      setError('Informe o convite e a nova senha.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(apiUrl('/api/auth/accept-invite'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const text = await r.text();
      let body: Record<string, unknown> | null = null;
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      } catch {
        body = null;
      }
      if (!r.ok) {
        const msg =
          body && typeof body.message === 'string'
            ? body.message
            : 'Não foi possível ativar a conta.';
        setError(msg);
        return;
      }

      const accessToken =
        body && typeof body.accessToken === 'string' ? body.accessToken : null;
      if (accessToken) {
        saveAccessToken(accessToken);
      }

      const user = body?.user as Record<string, unknown> | undefined;
      const selectionRaw = body?.condoSelection as Record<string, unknown> | undefined;
      const mode = String(selectionRaw?.mode ?? 'auto');
      const preAuthToken =
        body && typeof body.preAuthToken === 'string' ? body.preAuthToken : undefined;

      if (!user) {
        setError('Resposta inválida do servidor.');
        return;
      }

      if (mode === 'pick' || user.condoId == null) {
        const condosRaw = selectionRaw?.condos;
        const condos = Array.isArray(condosRaw)
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
              .filter((item): item is NonNullable<typeof item> => item != null)
          : [];
        savePendingCondoSelection({
          id: Number(user.id),
          fullName: String(user.fullName ?? ''),
          login: String(user.login ?? ''),
          condos,
          preAuthToken,
        });
        navigate('/select-condo', { replace: true });
        return;
      }

      const payload: WebUserPayload = {
        id: Number(user.id),
        condoId: Number(user.condoId),
        unitId:
          user.unitId == null || user.unitId === undefined
            ? null
            : Number(user.unitId),
        fullName: String(user.fullName ?? ''),
        login: String(user.login ?? ''),
        role: String(user.role ?? 'resident'),
        condoName: user.condoName != null ? String(user.condoName) : undefined,
      };
      saveWebUserSession(payload);
      writeLastLoginCondoId(payload.condoId);
      navigate('/app', { replace: true });
    } catch {
      setError('Falha de rede ao ativar a conta.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-page__shell">
        <div className="login-card">
          <h1 className="login-card__title">Ativar conta</h1>
          <p className="login-card__subtitle">
            Cole o código ou abra o link enviado pela administração e defina sua senha.
          </p>
          <form className="login-form" onSubmit={(e) => void handleSubmit(e)}>
            <label className="login-form__field">
              <span>Código do convite</span>
              <textarea
                rows={3}
                value={tokenField}
                onChange={(e) => setTokenField(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="login-form__submit"
              disabled={previewLoading}
              onClick={() => void validateInvite(tokenField)}
            >
              {previewLoading ? 'Validando…' : 'Validar convite'}
            </button>
            {preview ? (
              <p className="login-card__subtitle">
                <strong>{preview.fullName}</strong>
                <br />
                {preview.login} · {preview.condoName}
              </p>
            ) : null}
            <label className="login-form__field">
              <span>Nova senha</span>
              <input
                type="password"
                autoComplete="new-password"
                value={passwordField}
                onChange={(e) => setPasswordField(e.target.value)}
              />
            </label>
            <label className="login-form__field">
              <span>Confirmar senha</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmField}
                onChange={(e) => setConfirmField(e.target.value)}
              />
            </label>
            {error ? <p className="login-form__error">{error}</p> : null}
            <button type="submit" className="login-form__submit" disabled={loading}>
              {loading ? 'Ativando…' : 'Ativar e entrar'}
            </button>
          </form>
          <p className="login-card__subtitle">
            Já tem senha? <Link to="/login">Entrar</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

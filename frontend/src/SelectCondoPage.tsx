import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiUrl } from './api';
import { labelPt } from './condoUserRoles';
import { writeLastLoginCondoId } from './loginAppearanceStorage';
import {
  clearPendingCondoSelection,
  loadPendingCondoSelection,
  saveAccessToken,
  saveWebUserSession,
  type AccessibleCondoOption,
  type PendingLoginPayload,
} from './webSession';
import './LoginPage.css';

export function SelectCondoPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loadingCondoId, setLoadingCondoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useMemo(() => {
    const fromState = (location.state as { pending?: PendingLoginPayload } | null)
      ?.pending;
    return fromState ?? loadPendingCondoSelection();
  }, [location.state]);

  if (!pending || pending.condos.length === 0) {
    return (
      <div className="login-page">
        <div className="login-page__shell">
          <div className="login-card">
            <h1 className="login-card__title">Sessão expirada</h1>
            <p className="login-form__error">Faça login novamente para escolher o condomínio.</p>
            <button
              type="button"
              className="login-form__submit"
              onClick={() => navigate('/login', { replace: true })}
            >
              Ir para login
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isPartner = pending.condos.every((c) => c.role === 'partner');

  async function chooseCondo(option: AccessibleCondoOption) {
    if (loadingCondoId != null) {
      return;
    }
    setError(null);
    setLoadingCondoId(option.condoId);
    try {
      let userPayload = {
        id: pending!.id,
        condoId: option.condoId,
        unitId: option.unitId,
        fullName: pending!.fullName,
        login: pending!.login,
        role: option.role,
        condoName: option.condoName,
      };
      if (pending!.preAuthToken) {
        const r = await fetch(apiUrl('/api/auth/select-condo'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            preAuthToken: pending!.preAuthToken,
            condoId: option.condoId,
          }),
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
              : 'Não foi possível confirmar o condomínio.';
          setError(msg);
          return;
        }
        const accessToken =
          body && typeof body.accessToken === 'string' ? body.accessToken : null;
        if (accessToken) {
          saveAccessToken(accessToken);
        }
        const user = body?.user as Record<string, unknown> | undefined;
        if (user) {
          userPayload = {
            id: Number(user.id ?? pending!.id),
            condoId: Number(user.condoId ?? option.condoId),
            unitId:
              user.unitId == null || user.unitId === undefined
                ? null
                : Number(user.unitId),
            fullName: String(user.fullName ?? pending!.fullName),
            login: String(user.login ?? pending!.login),
            role: String(user.role ?? option.role),
            condoName:
              user.condoName != null ? String(user.condoName) : option.condoName,
          };
        }
      }
      writeLastLoginCondoId(userPayload.condoId);
      saveWebUserSession(userPayload);
      clearPendingCondoSelection();
      navigate('/app', { replace: true });
    } catch {
      setError('Falha de rede ao confirmar o condomínio.');
    } finally {
      setLoadingCondoId(null);
    }
  }

  return (
    <div className="login-page">
      <div className="login-page__shell">
        <div className="login-card">
          <h1 className="login-card__title">Escolha o condomínio</h1>
          <p className="login-card__subtitle">
            Olá, {pending.fullName}.{' '}
            {isPartner
              ? 'Selecione o condomínio com o qual deseja trabalhar.'
              : 'Você tem acesso a mais de um condomínio. Selecione qual deseja acessar agora.'}
          </p>
          {error ? <p className="login-form__error">{error}</p> : null}
          <ul className="select-condo-list">
            {pending.condos.map((c) => (
              <li key={c.condoId}>
                <button
                  type="button"
                  className="select-condo-list__item"
                  disabled={loadingCondoId != null}
                  onClick={() => void chooseCondo(c)}
                >
                  <span className="select-condo-list__name">{c.condoName}</span>
                  <span className="select-condo-list__role">{labelPt(c.role)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

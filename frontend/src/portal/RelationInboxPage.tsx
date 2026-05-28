import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { CondoUserRoles, isOperationalStaff, picksCondoBeforeContact } from '../condoUserRoles';
import { getRelationsInboxApi, type RelationChannel, type RelationInboxRow } from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

function parseChannel(
  raw: string | undefined,
): RelationChannel | null {
  if (raw === 'syndic' || raw === 'administration' || raw === 'doorman' || raw === 'collaborator') {
    return raw;
  }
  return null;
}

export function RelationInboxPage() {
  const session = useStaffSession();
  const { channel: channelParam } = useParams();
  const [searchParams] = useSearchParams();
  const channel = parseChannel(channelParam);
  const condoIdRaw = searchParams.get('condoId');
  const condoId =
    condoIdRaw != null && String(condoIdRaw).trim() !== ''
      ? Number.parseInt(condoIdRaw, 10)
      : null;

  const [rows, setRows] = useState<RelationInboxRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const title =
    channel === 'syndic'
      ? 'Caixa de entrada · Síndico'
      : channel === 'administration'
        ? 'Caixa de entrada · Administração'
        : channel === 'doorman'
          ? 'Caixa de entrada · Portaria'
          : channel === 'collaborator'
            ? 'Caixa de entrada · Colaborador'
            : 'Caixa de entrada';

  const load = useCallback(async () => {
    if (!session || channel == null || condoId == null || !Number.isFinite(condoId)) {
      return;
    }
    setErr(null);
    try {
      const list = await getRelationsInboxApi(condoId, channel);
      setRows(list);
    } catch (e) {
      setRows(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, [session, channel, condoId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 4000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!session) {
    return null;
  }

  if (session.role === CondoUserRoles.partner) {
    const q =
      condoId != null && Number.isFinite(condoId) && condoId >= 1
        ? `?condoId=${condoId}`
        : '';
    return <Navigate to={`/app/fale-condominio${q}`} replace />;
  }

  if (!picksCondoBeforeContact(session.role) && !isOperationalStaff(session.role)) {
    return <Navigate to="/app/fale-condominio" replace />;
  }

  if (channel == null) {
    return <Navigate to="/app/fale-condominio" replace />;
  }

  if (condoId == null || !Number.isFinite(condoId) || condoId < 1) {
    return <Navigate to="/app/fale-condominio" replace />;
  }

  const backTo = `/app/fale-condominio?condoId=${condoId}`;

  return (
    <StaffLayout title={title} backTo={backTo}>
      {err ? <p className="staff-error">{err}</p> : null}
      {!rows ? (
        <p>A carregar…</p>
      ) : rows.length === 0 ? (
        <p className="staff-muted">Sem conversas neste canal.</p>
      ) : (
        <ol className="staff-list">
          {rows.map((t) => (
            <li key={t.thread_id}>
              <Link
                className="portal-offer-head"
                to={`/app/fale-condominio/thread/${t.thread_id}?condoId=${condoId}&channel=${channel}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <span>
                  <strong>
                    {t.partner_user_id != null ? (
                      <>Parceiro{t.resident_name ? ` · ${t.resident_name}` : ''}</>
                    ) : (
                      <>
                        Unidade {t.unit_tower ?? ''} {t.unit_number ?? ''} (#{t.unit_id})
                      </>
                    )}
                  </strong>
                  <div className="staff-muted" style={{ marginTop: 4 }}>
                    {t.partner_user_id == null && t.resident_name
                      ? `${t.resident_name} · `
                      : null}
                    {t.last_message_at != null ? String(t.last_message_at) : ''}
                  </div>
                  {t.last_message_body ? (
                    <div style={{ marginTop: 6, fontSize: '0.9rem' }}>
                      {t.last_message_body}
                    </div>
                  ) : null}
                </span>
                <span>→</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </StaffLayout>
  );
}

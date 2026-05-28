import { useCallback, useEffect, useState } from 'react';
import { getSyndicMaintenanceRequests } from '../../staffApi';
import { useStaffSession } from '../useStaffSession';
import { StaffLayout } from '../StaffLayout';

type Row = Record<string, unknown>;

function str(v: unknown): string {
  if (v == null) {
    return '';
  }
  return String(v);
}

export function SyndicMaintenancePage() {
  const session = useStaffSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setErr(null);
    try {
      const list = (await getSyndicMaintenanceRequests(session.condoId)) as Row[];
      setRows(list);
    } catch (e) {
      setRows(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Manutenções" backTo="/app/sindico">
      <p className="staff-muted">
        Pedidos por unidade (<code>GET /api/syndic/maintenance-requests</code>).
      </p>
      {err ? <p className="staff-error">{err}</p> : null}
      {!rows ? (
        <p>Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="staff-muted">Nenhuma solicitação.</p>
      ) : (
        <ol className="staff-list">
          {rows.map((r) => (
            <li key={str(r.id)}>
              <strong>{str(r.title) || `#${str(r.id)}`}</strong>
              <div className="staff-muted">
                {str(r.tower)} {str(r.number)} · {str(r.status)} · {str(r.priority)} ·{' '}
                {str(r.created_at)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </StaffLayout>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { getSyndicOccurrences } from '../../staffApi';
import { useStaffSession } from '../useStaffSession';
import { StaffLayout } from '../StaffLayout';

type Row = Record<string, unknown>;

function str(v: unknown): string {
  if (v == null) {
    return '';
  }
  return String(v);
}

export function SyndicOccurrencesPage() {
  const session = useStaffSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setErr(null);
    try {
      const list = (await getSyndicOccurrences(session.condoId)) as Row[];
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
    <StaffLayout title="Ocorrências" backTo="/app/sindico">
      <p className="staff-muted">
        Lista ordenada por data (mesmo endpoint{' '}
        <code className="staff-muted">GET /api/syndic/occurrences</code>).
      </p>
      {err ? <p className="staff-error">{err}</p> : null}
      {!rows ? (
        <p>Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="staff-muted">Nenhuma ocorrência registada.</p>
      ) : (
        <ol className="staff-list">
          {rows.map((o) => (
            <li key={str(o.id)}>
              <strong>{str(o.title) || `#${str(o.id)}`}</strong>
              <div className="staff-muted">
                Estado: {str(o.status)} · Unidade: {str(o.unit_id)} ·{' '}
                {str(o.created_at)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </StaffLayout>
  );
}

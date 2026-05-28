import { useCallback, useEffect, useState } from 'react';
import { getSyndicNotices } from '../../staffApi';
import { useStaffSession } from '../useStaffSession';
import { StaffLayout } from '../StaffLayout';

type Row = Record<string, unknown>;

function str(v: unknown): string {
  if (v == null) {
    return '';
  }
  return String(v);
}

export function SyndicNoticesPage() {
  const session = useStaffSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setErr(null);
    try {
      const list = (await getSyndicNotices(
        session.condoId,
        session.id,
        false,
      )) as Row[];
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
    <StaffLayout title="Mural de avisos" backTo="/app/sindico">
      <p className="staff-muted">
        Avisos não arquivados. A API exige <code>userId</code> no pedido (perfil de
        faturação).
      </p>
      {err ? <p className="staff-error">{err}</p> : null}
      {!rows ? (
        <p>Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="staff-muted">Nenhum aviso publicado.</p>
      ) : (
        <ol className="staff-list">
          {rows.map((n) => (
            <li key={str(n.id)}>
              <strong>{str(n.title)}</strong>
              <div className="staff-muted">
                {str(n.urgency)} · {str(n.published_at)}
                {n.is_pinned ? ' · fixado' : ''}
              </div>
            </li>
          ))}
        </ol>
      )}
    </StaffLayout>
  );
}

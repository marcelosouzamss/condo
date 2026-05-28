import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAdministratorUnits } from '../../staffApi';
import { useStaffSession } from '../useStaffSession';
import { StaffLayout } from '../StaffLayout';

type UnitRow = {
  id: number;
  tower?: string | null;
  number?: string | null;
  resident_name?: string | null;
  residents_count?: number;
  billing_active?: boolean;
};

export function AdministratorUnitsPage() {
  const session = useStaffSession();
  const [rows, setRows] = useState<UnitRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setErr(null);
    try {
      const list = (await getAdministratorUnits(session.condoId)) as UnitRow[];
      setRows(list);
    } catch (e) {
      setRows(null);
      setErr(e instanceof Error ? e.message : 'Erro.');
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Unidades" backTo="/app/administracao">
      <p className="staff-muted">
        <code>GET /api/administrator/units</code>
      </p>
      {err ? <p className="staff-error">{err}</p> : null}
      {!rows ? (
        <p>Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="staff-muted">Nenhuma unidade.</p>
      ) : (
        <ol className="staff-list">
          {rows.map((u) => (
            <li key={u.id}>
              <Link
                to={`/app/administracao/unidades/${u.id}/moradores`}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                <strong>
                  {u.tower ?? ''} {u.number ?? u.id}
                </strong>
              </Link>
              <div className="staff-muted">
                Moradores: {u.residents_count ?? 0}
                {u.billing_active ? ' · cobrança ativa' : ''}
              </div>
            </li>
          ))}
        </ol>
      )}
    </StaffLayout>
  );
}

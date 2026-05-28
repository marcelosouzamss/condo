import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAdministratorUnitResidents } from '../../staffApi';
import { useStaffSession } from '../useStaffSession';
import { StaffLayout } from '../StaffLayout';

type ResidentRow = Record<string, unknown>;

function str(v: unknown): string {
  if (v == null) {
    return '';
  }
  return String(v);
}

export function AdministratorUnitResidentsPage() {
  const session = useStaffSession();
  const { unitId } = useParams<{ unitId: string }>();
  const id = unitId != null ? Number.parseInt(unitId, 10) : Number.NaN;
  const [rows, setRows] = useState<ResidentRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !Number.isFinite(id) || id < 1) {
      return;
    }
    setErr(null);
    try {
      const list = (await getAdministratorUnitResidents(session.condoId, id)) as ResidentRow[];
      setRows(list);
    } catch (e) {
      setRows(null);
      setErr(e instanceof Error ? e.message : 'Erro.');
    }
  }, [session, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) {
    return null;
  }

  if (!Number.isFinite(id) || id < 1) {
    return (
      <StaffLayout title="Moradores" backTo="/app/administracao/unidades">
        <p className="staff-error">Unidade inválida.</p>
      </StaffLayout>
    );
  }

  return (
    <StaffLayout title="Moradores da unidade" backTo="/app/administracao/unidades">
      <p className="staff-muted">
        Unidade #{id} — <code>GET /api/administrator/units/:id/residents</code>
      </p>
      {err ? <p className="staff-error">{err}</p> : null}
      {!rows ? (
        <p>Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="staff-muted">Nenhum morador registado.</p>
      ) : (
        <ol className="staff-list">
          {rows.map((r, i) => (
            <li key={str(r.id) || String(i)}>
              <strong>{str(r.full_name) || 'Morador'}</strong>
              <div className="staff-muted">
                {str(r.role)} · {str(r.email)}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p style={{ marginTop: 20 }}>
        <Link to="/app/administracao/unidades">← Todas as unidades</Link>
      </p>
    </StaffLayout>
  );
}

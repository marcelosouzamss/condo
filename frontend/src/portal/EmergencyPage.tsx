import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CondoUserRoles, isOperationalStaff, picksCondoBeforeContact } from '../condoUserRoles';
import {
  createEmergencyIncident,
  getUnitsForCondo,
  listEmergencyIncidents,
  patchEmergencyIncident,
  type UnitRow,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const INCIDENT_OPTIONS: { id: string; label: string }[] = [
  { id: 'incendio', label: 'Incêndio' },
  { id: 'invasao', label: 'Invasão' },
  { id: 'briga', label: 'Briga ou tumulto' },
  { id: 'agressao_mulher', label: 'Agressão à mulher' },
  { id: 'maus_tratos_animais', label: 'Maus-tratos a animais' },
  { id: 'maus_tratos_idosos', label: 'Maus-tratos a idosos' },
  { id: 'maus_tratos_criancas', label: 'Maus-tratos a crianças' },
  { id: 'outro', label: 'Outro' },
];

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function kindPt(k: string): string {
  return INCIDENT_OPTIONS.find((o) => o.id === k)?.label ?? k;
}

function statusPt(s: string): string {
  switch (s) {
    case 'open':
      return 'Aberto';
    case 'acknowledged':
      return 'Reconhecido';
    case 'closed':
      return 'Encerrado';
    default:
      return s;
  }
}

export function EmergencyPage() {
  const session = useStaffSession();
  const [searchParams] = useSearchParams();
  const condoParam = searchParams.get('condoId');
  const effectiveCondoId = useMemo(() => {
    if (!session) {
      return 0;
    }
    if (picksCondoBeforeContact(session.role)) {
      if (condoParam) {
        const n = Number.parseInt(condoParam, 10);
        if (Number.isFinite(n) && n > 0) {
          return n;
        }
      }
    }
    return session.condoId;
  }, [session, condoParam]);

  const staff = session ? isOperationalStaff(session.role) : false;
  const isResident = session?.role === CondoUserRoles.resident;

  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [units, setUnits] = useState<UnitRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [kind, setKind] = useState('outro');
  const [description, setDescription] = useState('');
  const [unitOverride, setUnitOverride] = useState('');
  const [sending, setSending] = useState(false);

  const effectiveUnitForCreate = useMemo(() => {
    if (!session) {
      return null;
    }
    if (session.unitId != null) {
      return session.unitId;
    }
    const u = Number.parseInt(unitOverride, 10);
    return Number.isFinite(u) && u > 0 ? u : null;
  }, [session, unitOverride]);

  const load = useCallback(async () => {
    if (!session || !effectiveCondoId) {
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      setRows(await listEmergencyIncidents(effectiveCondoId, session.id));
    } catch (e) {
      setRows(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!session || !effectiveCondoId || !isResident || session.unitId != null) {
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const u = await getUnitsForCondo(effectiveCondoId);
        if (!cancel) {
          setUnits(u);
        }
      } catch {
        if (!cancel) {
          setUnits([]);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [session, effectiveCondoId, isResident]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !effectiveCondoId || !isResident) {
      return;
    }
    if (effectiveUnitForCreate == null) {
      setErr('Selecione ou associe uma unidade.');
      return;
    }
    setSending(true);
    setErr(null);
    try {
      await createEmergencyIncident({
        condoId: effectiveCondoId,
        userId: session.id,
        incidentKind: kind,
        description: description.trim() || null,
        ...(session.unitId == null ? { unitId: effectiveUnitForCreate } : {}),
      });
      setDescription('');
      await load();
      window.alert('Chamado registado. A equipa foi notificada no quadro de ocorrências.');
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Não foi possível registar.');
    } finally {
      setSending(false);
    }
  };

  const onStatus = async (id: number, status: 'open' | 'acknowledged' | 'closed') => {
    if (!session) {
      return;
    }
    setErr(null);
    try {
      await patchEmergencyIncident(id, { userId: session.id, status });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao atualizar.');
    }
  };

  if (!session) {
    return null;
  }

  const canUseApi = staff || isResident;

  return (
    <StaffLayout title="Emergência" backTo="/app">
      <div className="staff-hero">
        <h2>Situações de urgência</h2>
        <p>
          Moradores abrem chamados; síndico e administração vêem todos os casos do condomínio e atualizam o estado.
        </p>
      </div>

      {err ? <p className="staff-error">{err}</p> : null}

      {!canUseApi ? (
        <p className="staff-banner">Este módulo está disponível para moradores e para equipa de faturação (síndico/administração).</p>
      ) : null}

      {isResident ? (
        <details className="portal-details" style={{ marginBottom: 20 }} open>
          <summary style={{ fontWeight: 700, cursor: 'pointer' }}>Abrir novo chamado</summary>
          <form className="portal-form" style={{ marginTop: 12 }} onSubmit={onSubmit}>
            <label>
              Tipo
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {INCIDENT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {session.unitId == null && units && units.length > 0 ? (
              <label>
                Unidade
                <select
                  required
                  value={unitOverride}
                  onChange={(e) => setUnitOverride(e.target.value)}
                >
                  <option value="">—</option>
                  {units.map((u) => (
                    <option key={num(u.id)} value={num(u.id)}>
                      {str(u.tower)} {str(u.number)} (#{num(u.id)})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Descrição (opcional)
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </label>
            <button
              type="submit"
              className="portal-btn portal-btn--primary"
              disabled={sending || effectiveUnitForCreate == null}
            >
              {sending ? 'A enviar…' : 'Registar ocorrência'}
            </button>
          </form>
        </details>
      ) : null}

      {isResident && effectiveUnitForCreate == null ? (
        <p className="staff-banner">Se não tiver unidade no cadastro, escolha a unidade no formulário acima.</p>
      ) : null}

      <h3 className="staff-section-title">Ocorrências</h3>
      {loading ? (
        <p>A carregar…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="staff-muted">Nenhum registo.</p>
      ) : (
        <ul className="staff-list">
          {rows.map((row) => {
            const id = num(row.id);
            const st = str(row.status);
            return (
              <li key={id}>
                <strong>{kindPt(str(row.incident_kind))}</strong>
                <div className="staff-muted" style={{ fontSize: '0.85rem' }}>
                  {str(row.created_at)?.slice(0, 16)?.replace('T', ' ')} · {statusPt(st)} ·{' '}
                  {str(row.unit_tower)} {str(row.unit_number)} · {str(row.reporter_name)}
                </div>
                {str(row.description) ? (
                  <p style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{str(row.description)}</p>
                ) : null}
                {staff ? (
                  <div className="portal-charge-actions" style={{ marginTop: 8 }}>
                    <button type="button" className="portal-btn" onClick={() => void onStatus(id, 'acknowledged')} disabled={st === 'acknowledged'}>
                      Reconhecer
                    </button>
                    <button type="button" className="portal-btn" onClick={() => void onStatus(id, 'closed')} disabled={st === 'closed'}>
                      Encerrar
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </StaffLayout>
  );
}

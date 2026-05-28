import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CondoUserRoles, isOperationalStaff, picksCondoBeforeContact } from '../condoUserRoles';
import {
  createComplaintsBookEntry,
  deleteComplaintsBookEntry,
  getUnitsForCondo,
  listComplaintsBookEntries,
  patchComplaintsBookEntry,
  type ComplaintsBookRow,
  type UnitRow,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const ENTRY_OPTIONS: { id: string; label: string }[] = [
  { id: 'occurrence', label: 'Ocorrência' },
  { id: 'complaint', label: 'Reclamação' },
  { id: 'improvement', label: 'Melhoria' },
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

function entryTypePt(value: string): string {
  return ENTRY_OPTIONS.find((o) => o.id === value)?.label ?? value;
}

function statusPt(value: string): string {
  switch (value) {
    case 'open':
      return 'Aberto';
    case 'in_progress':
      return 'Em andamento';
    case 'closed':
      return 'Encerrado';
    default:
      return value;
  }
}

function formatDate(raw: unknown): string {
  const text = str(raw);
  if (!text) {
    return '';
  }
  return text.length >= 16 ? text.slice(0, 16).replace('T', ' ') : text;
}

export function ComplaintsBookPage() {
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

  const [rows, setRows] = useState<ComplaintsBookRow[] | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('');

  const [createOpen, setCreateOpen] = useState(false);
  const [formType, setFormType] = useState('occurrence');
  const [formSubject, setFormSubject] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formUnit, setFormUnit] = useState(0);
  const [saving, setSaving] = useState(false);

  const [responseRow, setResponseRow] = useState<ComplaintsBookRow | null>(null);
  const [responseStatus, setResponseStatus] = useState('open');
  const [responseText, setResponseText] = useState('');
  const [responseSaving, setResponseSaving] = useState(false);

  const effectiveUnitForCreate = useMemo(() => {
    if (!session) {
      return null;
    }
    if (session.unitId != null) {
      return session.unitId;
    }
    return formUnit > 0 ? formUnit : null;
  }, [session, formUnit]);

  const loadUnits = useCallback(async () => {
    if (effectiveCondoId < 1) {
      return;
    }
    try {
      const u = await getUnitsForCondo(effectiveCondoId);
      setUnits(u);
      if (session?.unitId != null) {
        setFormUnit(session.unitId);
      } else if (u.length > 0) {
        setFormUnit(num(u[0].id));
      }
    } catch {
      setUnits([]);
    }
  }, [effectiveCondoId, session?.unitId]);

  const reload = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      setRows([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      setRows(
        await listComplaintsBookEntries({
          condoId: effectiveCondoId,
          userId: session.id,
          entryType: typeFilter || undefined,
        }),
      );
    } catch (e) {
      setRows(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId, typeFilter]);

  useEffect(() => {
    void loadUnits();
  }, [loadUnits]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openCreate = () => {
    setFormType('occurrence');
    setFormSubject('');
    setFormDescription('');
    setCreateOpen(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !isResident || effectiveCondoId < 1) {
      return;
    }
    if (effectiveUnitForCreate == null) {
      setErr('Selecione ou associe uma unidade.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await createComplaintsBookEntry({
        condoId: effectiveCondoId,
        userId: session.id,
        entryType: formType,
        subject: formSubject.trim(),
        description: formDescription.trim(),
        ...(session.unitId == null ? { unitId: effectiveUnitForCreate } : {}),
      });
      setCreateOpen(false);
      setFormSubject('');
      setFormDescription('');
      await reload();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Não foi possível registrar.');
    } finally {
      setSaving(false);
    }
  };

  const openResponse = (row: ComplaintsBookRow) => {
    setResponseRow(row);
    setResponseStatus(str(row.status) || 'open');
    setResponseText(str(row.admin_response));
  };

  const saveResponse = async () => {
    if (!session || !responseRow) {
      return;
    }
    setResponseSaving(true);
    setErr(null);
    try {
      await patchComplaintsBookEntry(num(responseRow.id), {
        userId: session.id,
        status: responseStatus as 'open' | 'in_progress' | 'closed',
        adminResponse: responseText.trim() || null,
      });
      setResponseRow(null);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar resposta.');
    } finally {
      setResponseSaving(false);
    }
  };

  const onDelete = async (id: number) => {
    if (!session) {
      return;
    }
    if (!window.confirm('Deseja remover este registro do livro de reclamações?')) {
      return;
    }
    setErr(null);
    try {
      await deleteComplaintsBookEntry(id, session.id);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  };

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Livro de Reclamações" backTo="/app">
      <div className="staff-hero">
        <h2>Livro de reclamações</h2>
        <p>
          Moradores registram ocorrências, reclamações e sugestões de melhoria. A equipe do condomínio
          acompanha e responde; os registros mais recentes aparecem no topo.
        </p>
      </div>

      {err ? <p className="staff-error">{err}</p> : null}

      <div className="portal-charge-actions" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className={`portal-btn${typeFilter === '' ? ' portal-btn--primary' : ''}`}
          onClick={() => setTypeFilter('')}
        >
          Todos
        </button>
        {ENTRY_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`portal-btn${typeFilter === opt.id ? ' portal-btn--primary' : ''}`}
            onClick={() => setTypeFilter(opt.id)}
          >
            {opt.label}
          </button>
        ))}
        {isResident ? (
          <button type="button" className="portal-btn portal-btn--primary" onClick={openCreate}>
            Novo registro
          </button>
        ) : null}
      </div>

      {loading ? (
        <p>A carregar…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="staff-muted">Nenhum registro ainda.</p>
      ) : (
        <ul className="staff-list">
          {rows.map((row) => {
            const id = num(row.id);
            const status = str(row.status);
            const creatorId = num(row.created_by_user_id);
            const canDelete =
              staff ||
              (isResident && creatorId === session.id && status === 'open');
            return (
              <li key={id}>
                <strong>{str(row.subject)}</strong>
                <div className="staff-muted" style={{ fontSize: '0.85rem' }}>
                  {entryTypePt(str(row.entry_type))} · {statusPt(status)} · {formatDate(row.created_at)} ·{' '}
                  {str(row.unit_tower)} {str(row.unit_number)} · {str(row.created_by_name)}
                </div>
                <p style={{ margin: '8px 0', whiteSpace: 'pre-wrap' }}>{str(row.description)}</p>
                {str(row.admin_response) ? (
                  <div
                    style={{
                      marginTop: 8,
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'rgba(15, 23, 42, 0.05)',
                    }}
                  >
                    <strong>Resposta da administração</strong>
                    <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{str(row.admin_response)}</p>
                  </div>
                ) : null}
                <div className="portal-charge-actions" style={{ marginTop: 8 }}>
                  {staff ? (
                    <button type="button" className="portal-btn" onClick={() => openResponse(row)}>
                      Responder
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button type="button" className="portal-btn" onClick={() => void onDelete(id)}>
                      Excluir
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {createOpen ? (
        <div className="portal-modal-backdrop" role="presentation" onClick={() => setCreateOpen(false)}>
          <div
            className="portal-modal"
            role="dialog"
            aria-labelledby="complaints-create-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="complaints-create-title">Novo registro</h3>
            <form className="portal-form" onSubmit={onSubmit}>
              <label>
                Tipo
                <select value={formType} onChange={(e) => setFormType(e.target.value)}>
                  {ENTRY_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              {session.unitId == null && units.length > 0 ? (
                <label>
                  Unidade
                  <select
                    required
                    value={formUnit || ''}
                    onChange={(e) => setFormUnit(num(e.target.value))}
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
                Assunto
                <input
                  value={formSubject}
                  onChange={(e) => setFormSubject(e.target.value)}
                  maxLength={200}
                  required
                  minLength={3}
                />
              </label>
              <label>
                Descrição
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={5}
                  required
                  minLength={10}
                />
              </label>
              <div className="portal-charge-actions">
                <button type="button" className="portal-btn" onClick={() => setCreateOpen(false)}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="portal-btn portal-btn--primary"
                  disabled={saving || effectiveUnitForCreate == null}
                >
                  {saving ? 'A enviar…' : 'Registrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {responseRow ? (
        <div className="portal-modal-backdrop" role="presentation" onClick={() => setResponseRow(null)}>
          <div
            className="portal-modal"
            role="dialog"
            aria-labelledby="complaints-response-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="complaints-response-title">Atualizar registro</h3>
            <div className="portal-form">
              <label>
                Status
                <select value={responseStatus} onChange={(e) => setResponseStatus(e.target.value)}>
                  <option value="open">Aberto</option>
                  <option value="in_progress">Em andamento</option>
                  <option value="closed">Encerrado</option>
                </select>
              </label>
              <label>
                Resposta da administração
                <textarea
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  rows={4}
                />
              </label>
              <div className="portal-charge-actions">
                <button type="button" className="portal-btn" onClick={() => setResponseRow(null)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="portal-btn portal-btn--primary"
                  disabled={responseSaving}
                  onClick={() => void saveResponse()}
                >
                  {responseSaving ? 'A guardar…' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </StaffLayout>
  );
}

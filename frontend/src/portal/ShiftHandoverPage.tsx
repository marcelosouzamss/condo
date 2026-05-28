import { useCallback, useEffect, useMemo, useState } from 'react';
import { isBillingStaff } from '../condoUserRoles';
import {
  createShiftHandoverArea,
  createShiftHandoverEntry,
  listShiftHandoverAreas,
  listShiftHandoverCollaborators,
  patchShiftHandoverArea,
  type ShiftHandoverAreaRow,
  type ShiftHandoverCollaboratorUser,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

function parseDate(raw: unknown): Date | null {
  const d = new Date(str(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

function areaLatestAt(area: ShiftHandoverAreaRow): Date {
  const fromField = parseDate(area.last_entry_at);
  if (fromField) {
    return fromField;
  }
  const entries = arr(area.entries);
  if (entries.length > 0) {
    const first = parseDate(entries[0].created_at);
    if (first) {
      return first;
    }
  }
  return (
    parseDate(area.updated_at) ??
    parseDate(area.created_at) ??
    new Date(0)
  );
}

function sortAreasByRecent(rows: ShiftHandoverAreaRow[]): ShiftHandoverAreaRow[] {
  return [...rows].sort(
    (a, b) => areaLatestAt(b).getTime() - areaLatestAt(a).getTime(),
  );
}

function formatDateTime(raw: unknown): string {
  const d = parseDate(raw);
  if (!d) {
    return str(raw);
  }
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function areaCardSubtitle(area: ShiftHandoverAreaRow): string {
  const entries = arr(area.entries);
  if (entries.length > 0) {
    const body = str(entries[0].body).trim();
    if (!body) {
      return 'Última passagem registrada';
    }
    return body.length > 90 ? `${body.slice(0, 87)}…` : body;
  }
  const instructions = str(area.instructions).trim();
  if (instructions) {
    return instructions.length > 90 ? `${instructions.slice(0, 87)}…` : instructions;
  }
  return str(area.service_name);
}

type ShiftHandoverAreaDetailProps = {
  area: ShiftHandoverAreaRow;
  canManage: boolean;
  condoId: number;
  userId: number;
  onBack: () => void;
  onEdit: () => void;
  onEntryCreated: (entry: Record<string, unknown>) => void;
};

function ShiftHandoverAreaDetail({
  area,
  canManage,
  condoId,
  userId,
  onBack,
  onEdit,
  onEntryCreated,
}: ShiftHandoverAreaDetailProps) {
  const [handoverText, setHandoverText] = useState('');
  const [savingEntry, setSavingEntry] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = useMemo(
    () =>
      [...arr(area.entries)].sort((a, b) => {
        const ta = parseDate(a.created_at)?.getTime() ?? 0;
        const tb = parseDate(b.created_at)?.getTime() ?? 0;
        return tb - ta;
      }),
    [area.entries],
  );

  const members = arr(area.members)
    .map((m) => str(m.full_name))
    .filter(Boolean)
    .join(', ');

  const saveEntry = async () => {
    if (!handoverText.trim()) {
      setError('Informe a passagem de turno.');
      return;
    }
    setSavingEntry(true);
    setError(null);
    try {
      const created = await createShiftHandoverEntry(num(area.id), {
        condoId,
        userId,
        body: handoverText,
      });
      setHandoverText('');
      onEntryCreated(created as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao registrar passagem.');
    } finally {
      setSavingEntry(false);
    }
  };

  return (
    <div className="shift-handover">
      <button type="button" className="portal-btn" onClick={onBack}>
        ← Voltar às áreas
      </button>

      <section className="shift-handover__card" style={{ marginTop: 16 }}>
        <h3>{str(area.name)}</h3>
        <p className="staff-muted">{str(area.service_name)}</p>
        {members ? <p className="staff-muted">Colaboradores: {members}</p> : null}
        {canManage ? (
          <button type="button" className="secondary" onClick={onEdit}>
            Editar área
          </button>
        ) : null}
        <h4 style={{ marginTop: 16, marginBottom: 8 }}>Instruções</h4>
        <p>{str(area.instructions) || 'Sem instruções cadastradas.'}</p>
      </section>

      <section className="shift-handover__card">
        <h3>Nova passagem de turno</h3>
        {error ? (
          <p className="staff-muted" role="alert">
            {error}
          </p>
        ) : null}
        <textarea
          value={handoverText}
          onChange={(e) => setHandoverText(e.target.value)}
          rows={5}
          placeholder="Registre pendências, ocorrências e orientações para o próximo colaborador."
        />
        <div className="shift-handover__actions">
          <button type="button" onClick={() => void saveEntry()} disabled={savingEntry}>
            {savingEntry ? 'Registrando…' : 'Registrar passagem'}
          </button>
        </div>
      </section>

      <section>
        <h3 className="staff-section-title">Histórico de passagens</h3>
        <p className="staff-section-desc">Mais recentes no topo</p>
        {entries.length === 0 ? (
          <p className="staff-muted">Nenhuma passagem registrada nesta área.</p>
        ) : (
          entries.map((entry) => (
            <article key={num(entry.id)} className="shift-handover__entry">
              <strong>{str(entry.author_name)}</strong>
              <p className="staff-muted">{formatDateTime(entry.created_at)}</p>
              <p>{str(entry.body)}</p>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

export function ShiftHandoverPage() {
  const session = useStaffSession();
  const canManage = session ? isBillingStaff(session.role) : false;
  const condoId = session?.condoId ?? 0;
  const userId = session?.id ?? 0;

  const [areas, setAreas] = useState<ShiftHandoverAreaRow[]>([]);
  const [collaborators, setCollaborators] = useState<ShiftHandoverCollaboratorUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailAreaId, setDetailAreaId] = useState<number | null>(null);

  const [name, setName] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [active, setActive] = useState(true);
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingArea, setSavingArea] = useState(false);

  const detailArea = useMemo(
    () => areas.find((a) => num(a.id) === detailAreaId) ?? null,
    [areas, detailAreaId],
  );

  const load = useCallback(async () => {
    if (!session || condoId < 1) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [areaRows, collabRows] = await Promise.all([
        listShiftHandoverAreas(condoId, userId),
        listShiftHandoverCollaborators(condoId, userId),
      ]);
      setAreas(sortAreasByRecent(areaRows));
      setCollaborators(collabRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar passagem de turno.');
    } finally {
      setLoading(false);
    }
  }, [session, condoId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startCreate = () => {
    setEditingId(null);
    setName('');
    setServiceName('');
    setInstructions('');
    setActive(true);
    setMemberIds([]);
    setDetailAreaId(null);
  };

  const startEdit = (area: ShiftHandoverAreaRow) => {
    setDetailAreaId(null);
    setEditingId(num(area.id));
    setName(str(area.name));
    setServiceName(str(area.service_name));
    setInstructions(str(area.instructions));
    setActive(area.active !== false);
    setMemberIds(arr(area.members).map((m) => num(m.id)).filter(Boolean));
  };

  const toggleMember = (id: number) => {
    setMemberIds((cur) =>
      cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id],
    );
  };

  const saveArea = async () => {
    if (!session || !name.trim() || !serviceName.trim()) {
      setError('Preencha área de serviço e serviço.');
      return;
    }
    setSavingArea(true);
    setError(null);
    try {
      if (editingId == null) {
        await createShiftHandoverArea({
          condoId,
          userId,
          name,
          serviceName,
          instructions,
          memberUserIds: memberIds,
        });
      } else {
        await patchShiftHandoverArea(editingId, {
          condoId,
          userId,
          name,
          serviceName,
          instructions,
          active,
          memberUserIds: memberIds,
        });
      }
      startCreate();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar área.');
    } finally {
      setSavingArea(false);
    }
  };

  const onEntryCreated = (entry: Record<string, unknown>) => {
    if (detailAreaId == null) {
      return;
    }
    setAreas((cur) => {
      const next = cur.map((area) => {
        if (num(area.id) !== detailAreaId) {
          return area;
        }
        const entries = [entry, ...arr(area.entries)];
        return {
          ...area,
          entries,
          last_entry_at: entry.created_at ?? new Date().toISOString(),
        };
      });
      return sortAreasByRecent(next);
    });
  };

  if (!session) {
    return null;
  }

  if (detailArea) {
    return (
      <StaffLayout title="Passagem de Turno" backTo="/app">
        <ShiftHandoverAreaDetail
          area={detailArea}
          canManage={canManage}
          condoId={condoId}
          userId={userId}
          onBack={() => setDetailAreaId(null)}
          onEdit={() => startEdit(detailArea)}
          onEntryCreated={onEntryCreated}
        />
      </StaffLayout>
    );
  }

  return (
    <StaffLayout title="Passagem de Turno" backTo="/app">
      <div className="shift-handover">
        <div className="staff-banner">
          <h2>Áreas de serviço e continuidade do turno</h2>
          <p>
            Toque numa área para ver instruções, registrar passagem e histórico. Lista
            ordenada com as mais recentes no topo.
          </p>
        </div>

        {error ? (
          <p className="staff-muted" role="alert">
            {error}
          </p>
        ) : null}

        {canManage ? (
          <section className="shift-handover__card">
            <h3>{editingId == null ? 'Nova área de serviço' : 'Editar área de serviço'}</h3>
            <div className="staff-form-grid">
              <label>
                Área de serviço
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Portaria" />
              </label>
              <label>
                Serviço
                <input
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  placeholder="Controle de acesso"
                />
              </label>
            </div>
            <label>
              Instruções da área
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={4}
                placeholder="Rotina, responsabilidades, contatos e pontos de atenção."
              />
            </label>
            <div style={{ marginTop: 12 }}>
              <strong>Colaboradores da área</strong>
              <div className="shift-handover__chips">
                {collaborators.map((c) => {
                  const id = num(c.id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={memberIds.includes(id) ? 'is-selected' : ''}
                      onClick={() => toggleMember(id)}
                    >
                      {str(c.full_name)}
                    </button>
                  );
                })}
              </div>
            </div>
            {editingId != null ? (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                Área ativa
              </label>
            ) : null}
            <div className="shift-handover__actions">
              <button type="button" onClick={() => void saveArea()} disabled={savingArea}>
                {savingArea ? 'Salvando…' : 'Salvar área'}
              </button>
              <button type="button" className="secondary" onClick={startCreate}>
                Limpar
              </button>
            </div>
          </section>
        ) : null}

        <h3 className="staff-section-title">Áreas de serviço</h3>
        <p className="staff-section-desc">Mais recentes no topo</p>

        {loading ? (
          <p className="staff-muted">A carregar áreas…</p>
        ) : areas.length === 0 ? (
          <p className="staff-muted">Nenhuma área de passagem cadastrada para este perfil.</p>
        ) : (
          <div className="shift-handover__area-grid">
            {areas.map((area) => {
              const members = arr(area.members)
                .map((m) => str(m.full_name))
                .filter(Boolean)
                .join(', ');
              const latest = areaLatestAt(area);
              const hasEntries = arr(area.entries).length > 0;
              return (
                <article key={num(area.id)} className="shift-handover__area-card">
                  <button
                    type="button"
                    className="shift-handover__area-card-main"
                    onClick={() => setDetailAreaId(num(area.id))}
                  >
                    <div className="shift-handover__area-card-head">
                      <strong>{str(area.name)}</strong>
                      {area.active === false ? (
                        <span className="shift-handover__badge">Inativa</span>
                      ) : null}
                    </div>
                    <span className="shift-handover__area-service">{str(area.service_name)}</span>
                    <p className="shift-handover__area-preview">{areaCardSubtitle(area)}</p>
                    <small>{members || 'Sem colaboradores'}</small>
                    <small className="shift-handover__area-when">
                      {hasEntries
                        ? `Última: ${formatDateTime(latest.toISOString())}`
                        : 'Sem passagens registradas'}
                    </small>
                  </button>
                  {canManage ? (
                    <button
                      type="button"
                      className="shift-handover__area-edit"
                      onClick={() => startEdit(area)}
                    >
                      Editar
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </StaffLayout>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isBillingStaff, labelPt, picksCondoBeforeContact } from '../condoUserRoles';
import {
  createPoll,
  addPollOption,
  deletePoll,
  listPolls,
  patchPoll,
  type PollKindApi,
  type PollListRow,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const POLL_AUDIENCE_LABELS: Record<string, string> = {
  resident: 'Moradores',
  collaborator: 'Colaboradores',
  doorman: 'Portaria',
  partner: 'Parceiros',
  syndic: 'Síndico',
  administrator: 'Administração',
};

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

function statusPt(s: string): string {
  switch (s) {
    case 'draft':
      return 'Rascunho';
    case 'open':
      return 'Aberta';
    case 'closed':
      return 'Encerrada';
    default:
      return s;
  }
}

function kindPt(k: string): string {
  return k === 'formal_ballot' ? 'Votação formal' : 'Enquete';
}

function eligibleLabels(raw: unknown): string {
  if (!Array.isArray(raw)) {
    return '';
  }
  return raw
    .map((e) => POLL_AUDIENCE_LABELS[String(e)] ?? String(e))
    .join(', ');
}

function defaultClosesLocalInput(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(23, 59, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function canEditRow(row: PollListRow, userId: number, role: string): boolean {
  const createdBy = num(row.created_by_user_id);
  if (createdBy === userId) {
    return true;
  }
  return isBillingStaff(role);
}

export function PollsHubPage() {
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

  const [rows, setRows] = useState<PollListRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<PollKindApi>('survey');
  const [optionLines, setOptionLines] = useState<string[]>(['', '']);
  const [roleOn, setRoleOn] = useState<Record<string, boolean>>({
    resident: true,
    collaborator: false,
    doorman: false,
    partner: false,
    syndic: false,
    administrator: false,
  });
  const [closesLocal, setClosesLocal] = useState(() => defaultClosesLocalInput());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      setRows([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const list = await listPolls(effectiveCondoId, session.id);
      setRows(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setTitle('');
    setDescription('');
    setKind('survey');
    setOptionLines(['', '']);
    setRoleOn({
      resident: true,
      collaborator: false,
      doorman: false,
      partner: false,
      syndic: false,
      administrator: false,
    });
    setClosesLocal(defaultClosesLocalInput());
    setCreateOpen(true);
  };

  const selectedRoles = (): string[] =>
    Object.entries(roleOn)
      .filter(([, v]) => v)
      .map(([k]) => k);

  const submitCreate = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const t = title.trim();
    if (!t) {
      window.alert('Informe o título da enquete.');
      return;
    }
    const opts = optionLines.map((s) => s.trim()).filter((s) => s.length > 0);
    if (opts.length < 2) {
      window.alert('Defina pelo menos duas opções de resposta.');
      return;
    }
    const roles = selectedRoles();
    if (roles.length < 1) {
      window.alert('Selecione quem pode responder.');
      return;
    }
    if (!closesLocal) {
      window.alert('Escolha data e hora de encerramento.');
      return;
    }
    const closesDate = new Date(closesLocal);
    if (Number.isNaN(closesDate.getTime()) || closesDate.getTime() <= Date.now()) {
      window.alert('A data de encerramento deve ser no futuro.');
      return;
    }

    setSaving(true);
    try {
      const created = await createPoll({
        condoId: effectiveCondoId,
        userId: session.id,
        kind,
        title: t,
        description: description.trim() || null,
        eligibleRoles: roles,
      });
      const pollId = num(created.id);
      for (let i = 0; i < opts.length; i++) {
        await addPollOption(pollId, {
          condoId: effectiveCondoId,
          userId: session.id,
          label: opts[i],
          sortOrder: i,
        });
      }
      await patchPoll(pollId, {
        condoId: effectiveCondoId,
        userId: session.id,
        status: 'open',
        closesAt: closesDate.toISOString(),
      });
      setCreateOpen(false);
      await load();
      window.alert('Enquete publicada.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao publicar.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (pollId: number, pollTitle: string) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    if (!window.confirm(`Remover «${pollTitle}»? Esta ação não pode ser desfeita.`)) {
      return;
    }
    try {
      await deletePoll(pollId, effectiveCondoId, session.id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao excluir.');
    }
  };

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Enquetes e Votações" backTo="/app">
      <div className="staff-hero">
        <h2>Consultas e votações</h2>
        <p className="staff-muted">Mesma API do app móvel: listar, criar, votar e apurar resultados.</p>
      </div>

      <div className="portal-inline" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <button type="button" className="portal-btn portal-btn--primary" onClick={openCreate}>
          Nova enquete
        </button>
        <button type="button" className="portal-btn" onClick={() => void load()}>
          Atualizar
        </button>
        {picksCondoBeforeContact(session.role) ? (
          <span className="staff-muted">
            Condomínio: {effectiveCondoId} · {labelPt(session.role)}
          </span>
        ) : null}
      </div>

      {effectiveCondoId < 1 ? (
        <p className="staff-error">Selecione um condomínio válido (parâmetro condoId na URL).</p>
      ) : null}

      {err ? <p className="staff-error">{err}</p> : null}

      {loading ? (
        <p>A carregar…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="staff-muted">Nenhuma enquete ainda. Use «Nova enquete» para criar.</p>
      ) : (
        <ul className="staff-list">
          {rows.map((row) => {
            const id = num(row.id);
            const st = str(row.status);
            const votes = row.total_votes;
            const aud = eligibleLabels(row.eligible_roles);
            const k = str(row.kind);
            return (
              <li key={id}>
                <div className="portal-offer-head" style={{ cursor: 'default' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link to={`/app/enquetes/${id}${condoParam ? `?condoId=${condoParam}` : ''}`} className="portal-link">
                      <strong>{str(row.title)}</strong>
                    </Link>
                    <div className="staff-muted" style={{ marginTop: 4 }}>
                      {kindPt(k)} · {statusPt(st)}
                      {typeof votes === 'number' ? ` · ${votes} voto(s)` : ''}
                      {aud ? ` · Quem responde: ${aud}` : ''}
                    </div>
                  </div>
                  {canEditRow(row, session.id, session.role) ? (
                    <button
                      type="button"
                      className="portal-link-danger"
                      onClick={() => void onDelete(id, str(row.title))}
                    >
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
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 520 }}>
            <h3>Nova enquete</h3>
            <form onSubmit={(e) => void submitCreate(e)}>
              <label>
                Tipo
                <select
                  className="portal-input"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as PollKindApi)}
                >
                  <option value="survey">Enquete</option>
                  <option value="formal_ballot">Votação formal</option>
                </select>
              </label>
              <label>
                Pergunta / título
                <input
                  className="portal-input"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Descrição (opcional)
                <textarea
                  className="portal-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </label>
              <p className="staff-muted" style={{ marginBottom: 8 }}>
                Opções de resposta (mínimo duas não vazias)
              </p>
              {optionLines.map((line, i) => (
                <div key={i} className="portal-inline" style={{ marginBottom: 8 }}>
                  <label style={{ flex: 1 }}>
                    Opção {i + 1}
                    <input
                      className="portal-input"
                      value={line}
                      onChange={(e) => {
                        const next = [...optionLines];
                        next[i] = e.target.value;
                        setOptionLines(next);
                      }}
                    />
                  </label>
                  {optionLines.length > 2 ? (
                    <button
                      type="button"
                      className="portal-btn"
                      onClick={() => {
                        const next = optionLines.filter((_x, j) => j !== i);
                        setOptionLines(next);
                      }}
                    >
                      −
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                className="portal-btn"
                onClick={() => setOptionLines([...optionLines, ''])}
              >
                Adicionar opção
              </button>
              <p className="staff-muted" style={{ marginTop: 16 }}>
                Quem pode responder
              </p>
              <div className="portal-inline" style={{ flexWrap: 'wrap', gap: 8 }}>
                {Object.entries(POLL_AUDIENCE_LABELS).map(([key, lbl]) => (
                  <label key={key} className="staff-muted" style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={roleOn[key] ?? false}
                      onChange={(e) => setRoleOn({ ...roleOn, [key]: e.target.checked })}
                    />
                    {lbl}
                  </label>
                ))}
              </div>
              <label style={{ marginTop: 16 }}>
                Encerramento
                <input
                  className="portal-input"
                  type="datetime-local"
                  required
                  value={closesLocal}
                  onChange={(e) => setClosesLocal(e.target.value)}
                />
              </label>
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={saving}>
                  {saving ? 'A publicar…' : 'Publicar enquete'}
                </button>
                <button type="button" className="portal-btn" onClick={() => setCreateOpen(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </StaffLayout>
  );
}

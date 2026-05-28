import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { isBillingStaff, picksCondoBeforeContact } from '../condoUserRoles';
import {
  addPollOption,
  deletePollOption,
  getPoll,
  patchPoll,
  votePoll,
  type PollDetail,
  type PollResultRow,
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

function closesAtIso(d: PollDetail): string | null {
  const v = d.closes_at ?? d.closesAt;
  if (v == null || String(v).trim() === '') {
    return null;
  }
  return String(v);
}

function eligibleList(d: PollDetail): string[] {
  const r = d.eligibleRoles ?? d.eligible_roles;
  if (!Array.isArray(r)) {
    return [];
  }
  return r.map((x) => String(x));
}

function formatDt(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return iso;
  }
  const l = new Date(parsed);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(l.getDate())}/${pad(l.getMonth() + 1)}/${l.getFullYear()} ${pad(l.getHours())}:${pad(l.getMinutes())}`;
}

export function PollDetailPage() {
  const { pollId: pollIdParam } = useParams();
  const [searchParams] = useSearchParams();
  const condoParam = searchParams.get('condoId');
  const session = useStaffSession();

  const pollId = useMemo(() => {
    const n = Number.parseInt(String(pollIdParam ?? ''), 10);
    return Number.isFinite(n) ? n : 0;
  }, [pollIdParam]);

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

  const [data, setData] = useState<PollDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedOptionId, setSelectedOptionId] = useState<number | null>(null);
  const [voteSaving, setVoteSaving] = useState(false);

  const [draftLabel, setDraftLabel] = useState('');
  const [draftSaving, setDraftSaving] = useState(false);
  const [closesLocal, setClosesLocal] = useState('');

  const load = useCallback(async () => {
    if (!session || pollId < 1 || effectiveCondoId < 1) {
      setData(null);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const d = await getPoll(pollId, effectiveCondoId, session.id);
      setData(d);
      const my = d.myVoteOptionId;
      const myN = typeof my === 'number' ? my : my != null ? num(my) : null;
      setSelectedOptionId(myN == null || myN === 0 ? null : myN);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [session, pollId, effectiveCondoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canEdit = useMemo(() => {
    if (!session || !data) {
      return false;
    }
    const createdBy = num(data.created_by_user_id);
    if (createdBy === session.id) {
      return true;
    }
    return isBillingStaff(session.role);
  }, [session, data]);

  const status = data ? str(data.status) : '';
  const phase = data ? str(data.resultsPhase ?? 'partial') : '';
  const mayVote = data?.mayVote === true;
  const myVote = data?.myVoteOptionId;
  const myVoteN = typeof myVote === 'number' ? myVote : myVote != null ? num(myVote) : null;
  const resultsRaw = Array.isArray(data?.results)
    ? (data!.results as PollResultRow[])
    : [];

  const voting =
    mayVote && status === 'open' && (myVoteN == null || myVoteN === 0 || Number.isNaN(myVoteN));

  const addDraftOption = async () => {
    if (!session || !data || effectiveCondoId < 1) {
      return;
    }
    const label = draftLabel.trim();
    if (!label) {
      return;
    }
    setDraftSaving(true);
    try {
      await addPollOption(pollId, {
        condoId: effectiveCondoId,
        userId: session.id,
        label,
        sortOrder: resultsRaw.length,
      });
      setDraftLabel('');
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao adicionar opção.');
    } finally {
      setDraftSaving(false);
    }
  };

  const removeDraftOption = async (optionId: number) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    if (!window.confirm('Remover esta opção?')) {
      return;
    }
    setDraftSaving(true);
    try {
      await deletePollOption(pollId, optionId, effectiveCondoId, session.id);
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao remover.');
    } finally {
      setDraftSaving(false);
    }
  };

  const publishDraft = async () => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    if (resultsRaw.length < 2) {
      window.alert('São precisas pelo menos duas opções para publicar.');
      return;
    }
    if (!closesLocal) {
      window.alert('Defina data e hora de encerramento.');
      return;
    }
    const closesDate = new Date(closesLocal);
    if (Number.isNaN(closesDate.getTime()) || closesDate.getTime() <= Date.now()) {
      window.alert('A data de encerramento deve estar no futuro.');
      return;
    }
    setDraftSaving(true);
    try {
      await patchPoll(pollId, {
        condoId: effectiveCondoId,
        userId: session.id,
        status: 'open',
        closesAt: closesDate.toISOString(),
      });
      await load();
      window.alert('Enquete publicada.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao publicar.');
    } finally {
      setDraftSaving(false);
    }
  };

  const submitVote = async () => {
    if (!session || !data || effectiveCondoId < 1 || selectedOptionId == null) {
      return;
    }
    setVoteSaving(true);
    try {
      await votePoll(pollId, {
        condoId: effectiveCondoId,
        userId: session.id,
        optionId: selectedOptionId,
      });
      await load();
      window.alert('Voto registado.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Não foi possível votar.');
    } finally {
      setVoteSaving(false);
    }
  };

  const backQs = condoParam ? `?condoId=${encodeURIComponent(condoParam)}` : '';

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Enquete" backTo={`/app/enquetes${backQs}`}>
      {effectiveCondoId < 1 || pollId < 1 ? (
        <p className="staff-error">Enquete ou condomínio inválido.</p>
      ) : null}

      {loading ? (
        <p>A carregar…</p>
      ) : err ? (
        <>
          <p className="staff-error">{err}</p>
          <button type="button" className="portal-btn" onClick={() => void load()}>
            Tentar novamente
          </button>
        </>
      ) : data ? (
        <>
          <div className="staff-hero">
            <h2>{str(data.title)}</h2>
            {(data.description ? str(data.description).trim() : '') ? (
              <p>{str(data.description)}</p>
            ) : null}
          </div>

          <div className="portal-inline" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="staff-muted">{statusPt(status)}</span>
            <span className="staff-muted">
              {phase === 'final' ? 'Resultado final' : 'Resultados parciais'}
            </span>
          </div>

          {closesAtIso(data) ? (
            <p className="staff-muted">Encerra em {formatDt(closesAtIso(data)!)}</p>
          ) : null}

          {eligibleList(data).length > 0 ? (
            <p className="staff-muted">
              Quem pode responder:{' '}
              {eligibleList(data)
                .map((role) => POLL_AUDIENCE_LABELS[role] ?? role)
                .join(', ')}
            </p>
          ) : null}

          <p style={{ fontWeight: 600 }}>
            Total de votos:{' '}
            {typeof data.totalVotes === 'number' ? data.totalVotes : num(data.totalVotes)}
          </p>

          <button type="button" className="portal-btn" style={{ marginBottom: 16 }} onClick={() => void load()}>
            Atualizar
          </button>

          <h3>Apuração</h3>
          <ul className="staff-list" style={{ listStyle: 'none', paddingLeft: 0 }}>
            {resultsRaw.map((row) => {
              const oid = num(row.optionId);
              const label = str(row.label);
              const pct = typeof row.percent === 'number' ? row.percent : num(row.percent);
              const cnt = typeof row.voteCount === 'number' ? row.voteCount : num(row.voteCount);
              const bar = (
                <div
                  style={{
                    height: 10,
                    borderRadius: 6,
                    background: 'rgba(0,0,0,0.08)',
                    overflow: 'hidden',
                    marginTop: 6,
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.max(0, pct))}%`,
                      background: 'var(--portal-accent, #2563eb)',
                    }}
                  />
                </div>
              );

              if (voting) {
                return (
                  <li key={oid} style={{ marginBottom: 12 }}>
                    <label style={{ cursor: 'pointer', display: 'block' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="radio"
                          name="pollOpt"
                          checked={selectedOptionId === oid}
                          onChange={() => setSelectedOptionId(oid)}
                        />
                        <strong>{label}</strong>
                      </span>
                      {bar}
                      <span className="staff-muted" style={{ fontSize: 12 }}>
                        {pct.toFixed(1)}% · {cnt} voto(s)
                      </span>
                    </label>
                  </li>
                );
              }

              return (
                <li key={oid} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong>{label}</strong>
                    <span className="staff-muted">
                      {pct.toFixed(1)}% ({cnt})
                    </span>
                  </div>
                  {bar}
                </li>
              );
            })}
          </ul>

          {voting ? (
            <button
              type="button"
              className="portal-btn portal-btn--primary"
              disabled={selectedOptionId == null || voteSaving}
              onClick={() => void submitVote()}
            >
              {voteSaving ? 'A enviar…' : 'Confirmar voto'}
            </button>
          ) : null}

          {!mayVote && status === 'open' ? (
            <p className="staff-muted">Seu perfil não está autorizado a votar nesta enquete.</p>
          ) : null}

          {status === 'draft' ? (
            <p className="staff-error">Esta enquete ainda é rascunho.</p>
          ) : null}

          {!voting && myVoteN != null && myVoteN > 0 ? (
            <p className="staff-muted">O seu voto já foi registado nesta consulta.</p>
          ) : null}

          {status === 'draft' && canEdit ? (
            <section style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
              <h4>Rascunho — opções</h4>
              <p className="staff-muted">
                Inclua pelo menos duas opções e defina o encerramento para publicar.
              </p>
              <div className="portal-inline" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
                <input
                  className="portal-input"
                  placeholder="Texto da nova opção"
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  style={{ minWidth: 220 }}
                />
                <button
                  type="button"
                  className="portal-btn portal-btn--primary"
                  disabled={draftSaving}
                  onClick={() => void addDraftOption()}
                >
                  Adicionar opção
                </button>
              </div>
              <ul className="staff-list">
                {resultsRaw.map((row) => {
                  const oid = num(row.optionId);
                  const label = str(row.label);
                  return (
                    <li key={oid}>
                      <div className="portal-inline" style={{ justifyContent: 'space-between', width: '100%' }}>
                        <span>{label}</span>
                        <button type="button" className="portal-link-danger" onClick={() => void removeDraftOption(oid)}>
                          Remover
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <label>
                Encerramento (para publicar)
                <input
                  className="portal-input"
                  type="datetime-local"
                  value={closesLocal}
                  onChange={(e) => setClosesLocal(e.target.value)}
                  style={{ marginTop: 8 }}
                />
              </label>
              <button
                type="button"
                style={{ marginTop: 12 }}
                className="portal-btn portal-btn--primary"
                disabled={draftSaving}
                onClick={() => void publishDraft()}
              >
                Publicar enquete
              </button>
            </section>
          ) : null}
        </>
      ) : null}
    </StaffLayout>
  );
}

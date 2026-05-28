import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isOperationalStaff, picksCondoBeforeContact } from '../condoUserRoles';
import {
  createMaintenanceRequest,
  getResidentMaintenanceRequest,
  getSyndicMaintenanceRequest,
  listResidentMaintenanceMessages,
  listResidentMaintenanceRequests,
  listSyndicMaintenanceMessages,
  listSyndicMaintenanceRequests,
  patchResidentMaintenanceComplete,
  patchSyndicMaintenanceRequest,
  postResidentMaintenanceMessage,
  postSyndicMaintenanceMessage,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

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
    case 'open':
      return 'Aberto';
    case 'in_progress':
      return 'Em andamento';
    case 'completed':
      return 'Concluído';
    case 'closed':
      return 'Fechado';
    default:
      return s;
  }
}

function priorityPt(p: string): string {
  switch (p) {
    case 'low':
      return 'Baixa';
    case 'normal':
      return 'Normal';
    case 'high':
      return 'Alta';
    default:
      return p;
  }
}

export function MaintenanceRequestsPage() {
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

  const modeStaff = session ? isOperationalStaff(session.role) : false;

  const [view, setView] = useState<'list' | 'new' | 'detail'>('list');
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [msgs, setMsgs] = useState<Record<string, unknown>[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [saving, setSaving] = useState(false);

  const [residentReply, setResidentReply] = useState('');
  const [staffReply, setStaffReply] = useState('');
  const [staffStatus, setStaffStatus] = useState('');
  const [staffNote, setStaffNote] = useState('');

  const loadList = useCallback(async () => {
    if (!session || !effectiveCondoId) {
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      if (modeStaff) {
        setRows(await listSyndicMaintenanceRequests(effectiveCondoId));
      } else if (session.unitId != null) {
        setRows(await listResidentMaintenanceRequests(effectiveCondoId, session.unitId));
      } else {
        setRows([]);
      }
    } catch (e) {
      setRows(null);
      setErr(e instanceof Error ? e.message : 'Erro ao listar.');
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId, modeStaff]);

  useEffect(() => {
    if (view === 'list') {
      void loadList();
    }
  }, [view, loadList]);

  const openDetail = async (id: number) => {
    if (!session || !effectiveCondoId) {
      return;
    }
    setSelectedId(id);
    setView('detail');
    setErr(null);
    setLoading(true);
    try {
      if (modeStaff) {
        const d = await getSyndicMaintenanceRequest(id, effectiveCondoId);
        setDetail(d);
        setStaffStatus(str(d.status));
        setStaffNote(str(d.syndic_response));
        setMsgs(await listSyndicMaintenanceMessages(id, effectiveCondoId, session.id));
      } else if (session.unitId != null) {
        const d = await getResidentMaintenanceRequest(
          id,
          effectiveCondoId,
          session.unitId,
          session.id,
        );
        setDetail(d);
        setMsgs(
          await listResidentMaintenanceMessages(
            id,
            effectiveCondoId,
            session.unitId,
            session.id,
          ),
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro.');
      setDetail(null);
      setMsgs(null);
    } finally {
      setLoading(false);
    }
  };

  const submitNew = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !effectiveCondoId || session.unitId == null) {
      return;
    }
    if (!title.trim() || !description.trim()) {
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await createMaintenanceRequest({
        condoId: effectiveCondoId,
        unitId: session.unitId,
        title: title.trim(),
        description: description.trim(),
        priority,
      });
      setTitle('');
      setDescription('');
      setPriority('normal');
      setView('list');
      await loadList();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Erro ao criar.');
    } finally {
      setSaving(false);
    }
  };

  const onResidentMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !selectedId || session.unitId == null || !residentReply.trim()) {
      return;
    }
    setErr(null);
    try {
      await postResidentMaintenanceMessage(selectedId, {
        condoId: effectiveCondoId,
        unitId: session.unitId,
        userId: session.id,
        body: residentReply.trim(),
      });
      setResidentReply('');
      setMsgs(
        await listResidentMaintenanceMessages(
          selectedId,
          effectiveCondoId,
          session.unitId,
          session.id,
        ),
      );
      await loadList();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Erro.');
    }
  };

  const onStaffMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !selectedId || !staffReply.trim()) {
      return;
    }
    setErr(null);
    try {
      await postSyndicMaintenanceMessage(selectedId, effectiveCondoId, session.id, staffReply.trim());
      setStaffReply('');
      setMsgs(await listSyndicMaintenanceMessages(selectedId, effectiveCondoId, session.id));
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Erro.');
    }
  };

  const onStaffSaveMeta = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !selectedId) {
      return;
    }
    setErr(null);
    try {
      await patchSyndicMaintenanceRequest(selectedId, {
        condoId: effectiveCondoId,
        userId: session.id,
        status: staffStatus || undefined,
        syndicResponse: staffNote.trim() || null,
      });
      const d = await getSyndicMaintenanceRequest(selectedId, effectiveCondoId);
      setDetail(d);
      await loadList();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Erro.');
    }
  };

  const onMarkCompleted = async () => {
    if (!session || !selectedId || session.unitId == null) {
      return;
    }
    if (!window.confirm('Marcar este pedido como concluído?')) {
      return;
    }
    setErr(null);
    try {
      await patchResidentMaintenanceComplete(
        selectedId,
        effectiveCondoId,
        session.unitId,
        session.id,
      );
      await openDetail(selectedId);
      await loadList();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Erro.');
    }
  };

  if (!session) {
    return null;
  }

  const titlePage = modeStaff ? 'Manutenções solicitadas' : 'Solicitar manutenção';

  return (
    <StaffLayout title={titlePage} backTo="/app">
      <div className="staff-hero">
        <h2>{modeStaff ? 'Pedidos da equipa operacional' : 'Chamados da sua unidade'}</h2>
        <p>
          Mesmas APIs do aplicativo: prioridade, estado, mensagens e resposta do síndico.
        </p>
      </div>

      {err ? <p className="staff-error">{err}</p> : null}

      <div className="portal-inline" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={view === 'list' ? 'portal-btn portal-btn--primary' : 'portal-btn'}
          onClick={() => {
            setView('list');
            setSelectedId(null);
            setDetail(null);
          }}
        >
          Lista
        </button>
        {!modeStaff && session.unitId != null ? (
          <button
            type="button"
            className={view === 'new' ? 'portal-btn portal-btn--primary' : 'portal-btn'}
            onClick={() => {
              setView('new');
              setSelectedId(null);
              setDetail(null);
            }}
          >
            Novo pedido
          </button>
        ) : null}
      </div>

      {view === 'list' && (
        <>
          {session.unitId == null && !modeStaff ? (
            <p className="staff-banner">Associe a sua unidade para ver e abrir pedidos de manutenção.</p>
          ) : null}
          {loading ? (
            <p>A carregar…</p>
          ) : !rows || rows.length === 0 ? (
            <p className="staff-muted">Nenhum pedido.</p>
          ) : (
            <ul className="staff-list">
              {rows.map((row) => {
                const id = num(row.id);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className="portal-offer-head"
                      onClick={() => void openDetail(id)}
                    >
                      <span>
                        <strong>{str(row.title)}</strong>
                        <div className="staff-muted" style={{ fontSize: '0.85rem' }}>
                          {modeStaff ? (
                            <>
                              {str(row.tower)} {str(row.number)} ·{' '}
                            </>
                          ) : (
                            <>Unidade #{num(row.unit_id)} · </>
                          )}
                          {statusPt(str(row.status))} · {priorityPt(str(row.priority))}
                        </div>
                      </span>
                      <span>→</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {view === 'new' && session.unitId != null && (
        <form className="portal-form" onSubmit={submitNew}>
          <label>
            Título
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label>
            Descrição
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} required />
          </label>
          <label>
            Prioridade
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Baixa</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
            </select>
          </label>
          <button type="submit" className="portal-btn portal-btn--primary" disabled={saving}>
            {saving ? 'A enviar…' : 'Registar pedido'}
          </button>
        </form>
      )}

      {view === 'detail' && detail && (
        <div>
          <button
            type="button"
            className="portal-btn"
            style={{ marginBottom: 12 }}
            onClick={() => {
              setView('list');
              setSelectedId(null);
              setDetail(null);
            }}
          >
            ← Voltar à lista
          </button>
          <div className="portal-details">
            <h3 style={{ marginTop: 0 }}>{str(detail.title)}</h3>
            <p className="staff-muted">
              Estado: {statusPt(str(detail.status))} · Prioridade: {priorityPt(str(detail.priority))}
            </p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{str(detail.description)}</p>
            {str(detail.syndic_response) ? (
              <p>
                <strong>Resposta da equipa:</strong> {str(detail.syndic_response)}
              </p>
            ) : null}
          </div>

          <h4 className="staff-section-title">Mensagens</h4>
          {!msgs ? (
            <p>A carregar…</p>
          ) : msgs.length === 0 ? (
            <p className="staff-muted">Sem mensagens no fio.</p>
          ) : (
            <ul className="staff-list">
              {msgs.map((m) => (
                <li key={str(m.id)}>
                  <span className="staff-muted">{str(m.created_at)?.slice(0, 16)} · </span>
                  <strong>{str(m.author_role) === 'staff' ? 'Equipa' : 'Morador'}</strong> ({str(m.full_name)})
                  <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{str(m.body)}</p>
                </li>
              ))}
            </ul>
          )}

          {!modeStaff && session.unitId != null ? (
            <form className="portal-form" style={{ marginTop: 12 }} onSubmit={onResidentMessage}>
              <label>
                Nova mensagem
                <textarea value={residentReply} onChange={(e) => setResidentReply(e.target.value)} rows={3} />
              </label>
              <button type="submit" className="portal-btn portal-btn--primary" disabled={!residentReply.trim()}>
                Enviar
              </button>
              {str(detail.status) !== 'completed' ? (
                <button type="button" className="portal-btn" style={{ marginLeft: 8 }} onClick={() => void onMarkCompleted()}>
                  Marcar concluído
                </button>
              ) : null}
            </form>
          ) : null}

          {modeStaff ? (
            <>
              <form className="portal-form" style={{ marginTop: 16 }} onSubmit={onStaffSaveMeta}>
                <label>
                  Estado
                  <select value={staffStatus} onChange={(e) => setStaffStatus(e.target.value)}>
                    <option value="open">Aberto</option>
                    <option value="in_progress">Em andamento</option>
                    <option value="completed">Concluído</option>
                    <option value="closed">Fechado</option>
                  </select>
                </label>
                <label>
                  Nota / resposta (síndico)
                  <textarea value={staffNote} onChange={(e) => setStaffNote(e.target.value)} rows={3} />
                </label>
                <button type="submit" className="portal-btn portal-btn--primary">
                  Guardar estado e nota
                </button>
              </form>
              <form className="portal-form" style={{ marginTop: 12 }} onSubmit={onStaffMessage}>
                <label>
                  Mensagem ao morador
                  <textarea value={staffReply} onChange={(e) => setStaffReply(e.target.value)} rows={3} />
                </label>
                <button type="submit" className="portal-btn" disabled={!staffReply.trim()}>
                  Enviar ao fio
                </button>
              </form>
            </>
          ) : null}
        </div>
      )}
    </StaffLayout>
  );
}

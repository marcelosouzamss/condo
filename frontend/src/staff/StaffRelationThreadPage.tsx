import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { getRelationThread, postRelationMessage } from '../portalApi';
import { useStaffSession } from './useStaffSession';
import { StaffLayout } from './StaffLayout';

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

type MsgRow = {
  id?: unknown;
  sender_side?: unknown;
  body?: unknown;
  created_at?: unknown;
};

type StaffRelationThreadPageProps = {
  backTo: string;
  layoutTitle: string;
};

export function StaffRelationThreadPage({
  backTo,
  layoutTitle,
}: StaffRelationThreadPageProps) {
  const session = useStaffSession();
  const { threadId: threadIdParam } = useParams();
  const threadId = Number.parseInt(String(threadIdParam ?? ''), 10);

  const [messages, setMessages] = useState<MsgRow[] | null>(null);
  const [unitLabel, setUnitLabel] = useState<string>('');
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!session || !Number.isFinite(threadId)) {
      return;
    }
    setErr(null);
    try {
      const res = await getRelationThread(threadId, session.condoId);
      const th = res.thread as Record<string, unknown>;
      const pn = str(th.partner_name).trim();
      const tower = str(th.unit_tower);
      const num = str(th.unit_number);
      const uid = str(th.unit_id);
      const resident = str(th.resident_name).trim();
      setUnitLabel(
        pn
          ? `Parceiro · ${pn}`
          : tower || num
            ? `Torre ${tower} · ${num}${resident ? ` · ${resident}` : ''}`
            : `Unidade #${uid}`,
      );
      setMessages((res.messages as MsgRow[]) ?? []);
    } catch (e) {
      setMessages(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar conversa.');
    }
  }, [session, threadId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 4000);
    return () => window.clearInterval(id);
  }, [load]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!session || !text) {
      return;
    }
    setSending(true);
    setErr(null);
    try {
      await postRelationMessage({
        condoId: session.condoId,
        body: text,
        senderSide: 'staff',
        threadId,
      });
      setDraft('');
      await load();
    } catch (errSubmit) {
      setErr(errSubmit instanceof Error ? errSubmit.message : 'Erro ao enviar.');
    } finally {
      setSending(false);
    }
  };

  if (!session) {
    return null;
  }

  if (!Number.isFinite(threadId) || threadId < 1) {
    return <Navigate to={backTo} replace />;
  }

  return (
    <StaffLayout title={unitLabel || layoutTitle} backTo={backTo}>
      {err ? <p className="staff-error">{err}</p> : null}
      <div className="relation-chat">
        {!messages ? (
          <p>A carregar…</p>
        ) : messages.length === 0 ? (
          <p className="staff-muted">Sem mensagens ainda.</p>
        ) : (
          <ul className="relation-chat__list">
            {messages.map((m) => {
              const side = str(m.sender_side);
              const mine = side === 'staff';
              const counterLabel = side === 'partner' ? 'Parceiro' : 'Morador';
              return (
                <li
                  key={str(m.id)}
                  className={
                    mine ? 'relation-msg relation-msg--staff' : 'relation-msg relation-msg--resident'
                  }
                >
                  <div className="relation-msg__meta">
                    {mine ? 'Equipa' : counterLabel}{' '}
                    {m.created_at != null ? ` · ${String(m.created_at)}` : null}
                  </div>
                  <div className="relation-msg__body">{str(m.body)}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <form className="relation-chat__form" onSubmit={onSubmit}>
        <textarea
          className="relation-chat__input"
          rows={3}
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          placeholder="Escreva a resposta…"
          aria-label="Mensagem"
        />
        <button type="submit" className="portal-btn" disabled={sending || !draft.trim()}>
          {sending ? 'A enviar…' : 'Enviar'}
        </button>
      </form>
    </StaffLayout>
  );
}

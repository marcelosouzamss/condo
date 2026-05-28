import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { CondoUserRoles, isOperationalStaff, picksCondoBeforeContact } from '../condoUserRoles';
import { getRelationThread, postRelationMessage } from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function isRelationChannel(raw: string): raw is 'syndic' | 'administration' | 'doorman' | 'collaborator' {
  return raw === 'syndic' || raw === 'administration' || raw === 'doorman' || raw === 'collaborator';
}

type MsgRow = {
  id?: unknown;
  sender_side?: unknown;
  body?: unknown;
  created_at?: unknown;
};

export function RelationThreadPage() {
  const session = useStaffSession();
  const { threadId: threadIdParam } = useParams();
  const [searchParams] = useSearchParams();
  const threadId = Number.parseInt(String(threadIdParam ?? ''), 10);
  const condoIdRaw = searchParams.get('condoId');
  const condoId =
    condoIdRaw != null && String(condoIdRaw).trim() !== ''
      ? Number.parseInt(condoIdRaw, 10)
      : null;
  const channelHint = searchParams.get('channel') ?? '';
  const [threadChannel, setThreadChannel] = useState<string | null>(null);

  const [messages, setMessages] = useState<MsgRow[] | null>(null);
  const [unitLabel, setUnitLabel] = useState<string>('');
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!session || condoId == null || !Number.isFinite(threadId)) {
      return;
    }
    setErr(null);
    try {
      const res = await getRelationThread(threadId, condoId);
      const th = res.thread as Record<string, unknown>;
      const ch = str(th.channel);
      setThreadChannel(ch || null);
      const pn = str(th.partner_name).trim();
      const tower = str(th.unit_tower);
      const num = str(th.unit_number);
      const uid = str(th.unit_id);
      setUnitLabel(
        pn
          ? `Parceiro · ${pn}`
          : tower || num
            ? `Unidade ${tower} ${num} (#${uid})`
            : `Unidade #${uid}`,
      );
      setMessages((res.messages as MsgRow[]) ?? []);
    } catch (e) {
      setMessages(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar conversa.');
    }
  }, [session, condoId, threadId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 4000);
    return () => window.clearInterval(id);
  }, [load]);

  const backTo = useMemo(() => {
    if (condoId == null) {
      return '/app/fale-condominio';
    }
    const ch =
      threadChannel != null && isRelationChannel(threadChannel)
        ? threadChannel
        : isRelationChannel(channelHint)
          ? channelHint
          : 'syndic';
    return `/app/fale-condominio/inbox/${ch}?condoId=${condoId}`;
  }, [condoId, channelHint, threadChannel]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!session || condoId == null || !text) {
      return;
    }
    setSending(true);
    setErr(null);
    try {
      await postRelationMessage({
        condoId,
        body: text,
        senderSide: 'staff',
        threadId,
      });
      setDraft('');
      await load();
    } catch (errSubmit) {
      setErr(
        errSubmit instanceof Error ? errSubmit.message : 'Erro ao enviar.',
      );
    } finally {
      setSending(false);
    }
  };

  if (!session) {
    return null;
  }

  if (session.role === CondoUserRoles.partner) {
    return <Navigate to="/app/fale-condominio" replace />;
  }

  if (!picksCondoBeforeContact(session.role) && !isOperationalStaff(session.role)) {
    return <Navigate to="/app/fale-condominio" replace />;
  }

  if (condoId == null || !Number.isFinite(condoId) || condoId < 1) {
    return <Navigate to="/app/fale-condominio" replace />;
  }

  if (!Number.isFinite(threadId) || threadId < 1) {
    return <Navigate to="/app/fale-condominio" replace />;
  }

  return (
    <StaffLayout
      title={unitLabel || 'Conversa'}
      backTo={backTo}
    >
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

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { picksCondoBeforeContact } from '../condoUserRoles';
import {
  getRelationConversation,
  postRelationMessage,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

type MsgRow = {
  id?: unknown;
  sender_side?: unknown;
  body?: unknown;
  created_at?: unknown;
};

function parseChannel(
  raw: string | undefined,
): 'syndic' | 'administration' | 'doorman' | 'collaborator' | null {
  if (raw === 'syndic' || raw === 'administration' || raw === 'doorman' || raw === 'collaborator') {
    return raw;
  }
  return null;
}

export function ResidentRelationChatPage() {
  const session = useStaffSession();
  const { channel: channelParam } = useParams();
  const channel = parseChannel(channelParam);

  const [messages, setMessages] = useState<MsgRow[] | null>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const title =
    channel === 'syndic'
      ? 'Síndico'
      : channel === 'administration'
        ? 'Administração'
        : channel === 'doorman'
          ? 'Portaria'
          : channel === 'collaborator'
            ? 'Colaborador'
            : 'Conversa';

  const load = useCallback(async () => {
    if (
      !session ||
      channel == null ||
      session.unitId == null
    ) {
      return;
    }
    setErr(null);
    try {
      const res = await getRelationConversation(
        session.condoId,
        session.unitId,
        channel,
      );
      setMessages((res.messages as MsgRow[]) ?? []);
    } catch (e) {
      setMessages(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, [session, channel]);

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
    if (!session || channel == null || session.unitId == null || !text) {
      return;
    }
    setSending(true);
    setErr(null);
    try {
      await postRelationMessage({
        condoId: session.condoId,
        body: text,
        senderSide: 'resident',
        unitId: session.unitId,
        channel,
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

  if (picksCondoBeforeContact(session.role)) {
    return <Navigate to="/app/fale-condominio" replace />;
  }

  if (channel == null) {
    return <Navigate to="/app/fale-condominio" replace />;
  }

  if (session.unitId == null) {
    return (
      <StaffLayout title={title} backTo="/app/fale-condominio">
        <p className="staff-banner">
          Não foi possível identificar a sua unidade para este canal.
        </p>
      </StaffLayout>
    );
  }

  return (
    <StaffLayout title={`Fale com · ${title}`} backTo="/app/fale-condominio">
      {err ? <p className="staff-error">{err}</p> : null}
      <div className="relation-chat">
        {!messages ? (
          <p>A carregar…</p>
        ) : messages.length === 0 ? (
          <p className="staff-muted">Ainda não há mensagens. Escreva abaixo para iniciar.</p>
        ) : (
          <ul className="relation-chat__list">
            {messages.map((m) => {
              const side = str(m.sender_side);
              const mine = side === 'resident';
              return (
                <li
                  key={str(m.id)}
                  className={
                    mine ? 'relation-msg relation-msg--resident' : 'relation-msg relation-msg--staff'
                  }
                >
                  <div className="relation-msg__meta">
                    {mine ? 'Você' : 'Condomínio'}{' '}
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
          placeholder="Escreva a sua mensagem…"
          aria-label="Mensagem"
        />
        <button type="submit" className="portal-btn" disabled={sending || !draft.trim()}>
          {sending ? 'A enviar…' : 'Enviar'}
        </button>
      </form>
    </StaffLayout>
  );
}

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { CondoUserRoles } from '../condoUserRoles';
import {
  getPartnerRelationConversation,
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

export function PartnerRelationChatPage() {
  const session = useStaffSession();
  const { channel: channelParam } = useParams();
  const [searchParams] = useSearchParams();
  const channel = parseChannel(channelParam);

  const condoIdRaw = searchParams.get('condoId');
  const condoId =
    condoIdRaw != null && String(condoIdRaw).trim() !== ''
      ? Number.parseInt(condoIdRaw, 10)
      : null;

  const [messages, setMessages] = useState<MsgRow[] | null>(null);
  const [partnerThreadId, setPartnerThreadId] = useState<number | null>(null);
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
    if (!session || channel == null || condoId == null || !Number.isFinite(condoId)) {
      return;
    }
    setErr(null);
    try {
      const res = await getPartnerRelationConversation(
        condoId,
        channel,
        session.id,
      );
      const th = res.thread as { id?: unknown } | null;
      const id = th?.id;
      setPartnerThreadId(
        typeof id === 'number' && Number.isFinite(id) ? id : null,
      );
      setMessages((res.messages as MsgRow[]) ?? []);
    } catch (e) {
      setMessages(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, [session, channel, condoId]);

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
    if (
      !session ||
      channel == null ||
      condoId == null ||
      !Number.isFinite(condoId) ||
      !text
    ) {
      return;
    }
    setSending(true);
    setErr(null);
    try {
      await postRelationMessage({
        condoId,
        body: text,
        senderSide: 'partner',
        partnerUserId: session.id,
        ...(partnerThreadId != null
          ? { threadId: partnerThreadId }
          : { channel }),
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

  if (session.role !== CondoUserRoles.partner) {
    return <Navigate to="/app/fale-condominio" replace />;
  }

  if (channel == null) {
    return <Navigate to="/app/fale-condominio" replace />;
  }

  if (
    condoId == null ||
    !Number.isFinite(condoId) ||
    condoId < 1
  ) {
    return <Navigate to="/app/fale-condominio" replace />;
  }

  const backTo = `/app/fale-condominio?condoId=${condoId}`;

  return (
    <StaffLayout title={`Fale com · ${title}`} backTo={backTo}>
      {err ? <p className="staff-error">{err}</p> : null}
      <div className="relation-chat">
        {!messages ? (
          <p>A carregar…</p>
        ) : messages.length === 0 ? (
          <p className="staff-muted">Ainda não há mensagens. Escreva abaixo para contactar este condomínio.</p>
        ) : (
          <ul className="relation-chat__list">
            {messages.map((m) => {
              const side = str(m.sender_side);
              const mine = side === 'partner';
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

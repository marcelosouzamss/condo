import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getRelationsInbox,
  getRelationsInboxStats,
  type RelationInboxRow,
  type RelationInboxStats,
} from '../staffApi';
import { useStaffSession } from './useStaffSession';
import { StaffLayout } from './StaffLayout';

function formatWhen(iso: unknown): string {
  if (iso == null || iso === '') {
    return '';
  }
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) {
    return String(iso);
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}

type StaffRelationsInboxProps = {
  channel: 'syndic' | 'administration';
  backTo: string;
  inboxPath: string;
  title: string;
};

export function StaffRelationsInbox({
  channel,
  backTo,
  inboxPath,
  title,
}: StaffRelationsInboxProps) {
  const session = useStaffSession();
  const [rows, setRows] = useState<RelationInboxRow[] | null>(null);
  const [stats, setStats] = useState<RelationInboxStats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setErr(null);
    try {
      const [list, st] = await Promise.all([
        getRelationsInbox(session.condoId, channel),
        getRelationsInboxStats(session.condoId, channel),
      ]);
      setRows(list);
      setStats(st);
    } catch (e) {
      setRows(null);
      setStats(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar conversas.');
    }
  }, [session, channel]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 4000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!session) {
    return null;
  }

  const awaiting = stats?.awaitingStaffReplyCount ?? 0;
  const total = stats?.conversationCount ?? 0;

  return (
    <StaffLayout title={title} backTo={backTo}>
      <p className="staff-muted">
        Conversas iniciadas pelos moradores em <strong>Fale com o Condomínio</strong>.
        {total > 0 ? (
          <>
            {' '}
            {total} ativa(s)
            {awaiting > 0 ? (
              <>
                {' '}
                · <strong>{awaiting}</strong> aguardando resposta
              </>
            ) : null}
            .
          </>
        ) : null}
      </p>
      {err ? <p className="staff-error">{err}</p> : null}
      {!rows ? (
        <p>A carregar…</p>
      ) : rows.length === 0 ? (
        <p className="staff-muted">
          Nenhuma conversa neste canal. Aparecem quando um morador enviar a primeira mensagem.
        </p>
      ) : (
        <ol className="staff-list staff-chat-inbox">
          {rows.map((t) => {
            const label =
              t.partner_user_id != null ? (
                <>Parceiro{t.resident_name ? ` · ${t.resident_name}` : ''}</>
              ) : (
                <>
                  Torre {t.unit_tower ?? ''} {t.unit_number ?? ''}
                  {t.resident_name ? ` · ${t.resident_name}` : ''}
                </>
              );
            return (
              <li key={t.thread_id}>
                <Link
                  className="staff-chat-inbox__item"
                  to={`${inboxPath}/thread/${t.thread_id}`}
                >
                  <span className="staff-chat-inbox__main">
                    <strong>{label}</strong>
                    {t.last_message_body ? (
                      <span className="staff-chat-inbox__preview">{t.last_message_body}</span>
                    ) : (
                      <span className="staff-muted">Sem mensagens</span>
                    )}
                  </span>
                  <span className="staff-chat-inbox__meta">
                    {formatWhen(t.last_message_at)}
                    <span aria-hidden>→</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </StaffLayout>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getRelationsInboxStats,
  getSyndicDashboard,
  type RelationInboxStats,
  type SyndicDashboard,
} from '../../staffApi';
import { useStaffSession } from '../useStaffSession';
import { StaffLayout } from '../StaffLayout';

export function SyndicAreaPage() {
  const session = useStaffSession();
  const [dash, setDash] = useState<SyndicDashboard | null>(null);
  const [chatStats, setChatStats] = useState<RelationInboxStats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setErr(null);
    try {
      const [d, chats] = await Promise.all([
        getSyndicDashboard(session.condoId),
        getRelationsInboxStats(session.condoId, 'syndic'),
      ]);
      setDash(d);
      setChatStats(chats);
    } catch (e) {
      setDash(null);
      setChatStats(null);
      setErr(e instanceof Error ? e.message : 'Falha ao carregar o painel.');
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) {
    return null;
  }

  const m = dash?.metrics;
  const appr = dash?.approvalSummary;
  const chatTotal = chatStats?.conversationCount ?? 0;
  const chatAwaiting = chatStats?.awaitingStaffReplyCount ?? 0;
  const chatSubtitle =
    chatTotal === 0
      ? 'Conversas do Fale com o Condomínio · nenhuma ativa'
      : chatAwaiting > 0
        ? `${chatTotal} conversa(s) · ${chatAwaiting} aguardando resposta`
        : `${chatTotal} conversa(s) com moradores`;

  return (
    <StaffLayout title="Área do Síndico">
      <div className="staff-hero">
        <h2>Painel de gestão do síndico</h2>
        <p>
          Acompanhe o que precisa de atenção imediata e acesse os mesmos fluxos do
          aplicativo.
        </p>
      </div>

      {err ? <p className="staff-error">{err}</p> : null}

      <h3 className="staff-section-title">Indicadores</h3>
      <p className="staff-section-desc">
        Dados em tempo real do condomínio (mesma API do app).
      </p>
      <div className="staff-metrics">
        <Link className="staff-metric-card" to="ocorrencias">
          <div className="staff-metric-card__val">
            {m != null ? m.openOccurrences : '—'}
          </div>
          <div className="staff-metric-card__label">Ocorrências abertas</div>
        </Link>
        <Link className="staff-metric-card" to="manutencoes">
          <div className="staff-metric-card__val">
            {m != null ? m.maintenanceRequestsOpen : '—'}
          </div>
          <div className="staff-metric-card__label">Manutenções em aberto</div>
        </Link>
        <Link className="staff-metric-card" to="avisos">
          <div className="staff-metric-card__val">
            {m != null ? m.recentCommunications : '—'}
          </div>
          <div className="staff-metric-card__label">Comunicados recentes (30 dias)</div>
        </Link>
      </div>

      {appr ? (
        <div className="staff-banner" role="status">
          <strong>Pendentes de aprovação:</strong> reservas{' '}
          <strong>{appr.pendingReservations}</strong> · registos{' '}
          <strong>{appr.pendingRegistrations}</strong>
        </div>
      ) : null}

      <h3 className="staff-section-title">Operação</h3>
      <p className="staff-section-desc">Listas e acompanhamento diário.</p>
      <Link className="staff-card" to="ocorrencias">
        <span className="staff-card__icon" aria-hidden>
          ⚠️
        </span>
        <div className="staff-card__body">
          <strong>Ocorrências</strong>
          <span>Lista completa por estado</span>
        </div>
        <span className="staff-card__action">Abrir</span>
      </Link>
      <Link className="staff-card" to="manutencoes">
        <span className="staff-card__icon" aria-hidden>
          🔧
        </span>
        <div className="staff-card__body">
          <strong>Manutenções</strong>
          <span>Solicitações por unidade</span>
        </div>
        <span className="staff-card__action">Abrir</span>
      </Link>

      <h3 className="staff-section-title">Mural de avisos</h3>
      <Link className="staff-card" to="avisos">
        <span className="staff-card__icon" aria-hidden>
          📣
        </span>
        <div className="staff-card__body">
          <strong>Avisos publicados</strong>
          <span>Gestão do mural (requer userId na API)</span>
        </div>
        <span className="staff-card__action">Ver</span>
      </Link>

      <h3 className="staff-section-title">Chats</h3>
      <p className="staff-section-desc">
        Conversas iniciadas pelos moradores em Fale com o Condomínio.
      </p>
      <Link className="staff-card" to="chats">
        <span className="staff-card__icon" aria-hidden>
          💬
        </span>
        <div className="staff-card__body">
          <strong>Chats</strong>
          <span>{chatSubtitle}</span>
        </div>
        <span className="staff-card__action">Abrir</span>
      </Link>

      <h3 className="staff-section-title">Relatórios gerenciais</h3>
      <p className="staff-section-desc">Os mesmos relatórios do app (JSON estruturado).</p>
      <Link className="staff-card" to="relatorio-financeiro">
        <span className="staff-card__icon" aria-hidden>
          📊
        </span>
        <div className="staff-card__body">
          <strong>Financeiro</strong>
          <span>Receitas, despesas e resumo</span>
        </div>
        <span className="staff-card__action">Ver</span>
      </Link>
      <Link className="staff-card" to="relatorio-areas">
        <span className="staff-card__icon" aria-hidden>
          🏢
        </span>
        <div className="staff-card__body">
          <strong>Uso de áreas</strong>
          <span>Ocupação de espaços e utilizadores</span>
        </div>
        <span className="staff-card__action">Ver</span>
      </Link>
      <Link className="staff-card" to="relatorio-operacao">
        <span className="staff-card__icon" aria-hidden>
          📈
        </span>
        <div className="staff-card__body">
          <strong>Operação</strong>
          <span>Ocorrências, manutenção e volumes</span>
        </div>
        <span className="staff-card__action">Ver</span>
      </Link>
    </StaffLayout>
  );
}

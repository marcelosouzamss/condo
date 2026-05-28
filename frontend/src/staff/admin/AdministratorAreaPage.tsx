import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getAdministratorFinancialOverview,
  getAdministratorReportsSummary,
  getRelationsInboxStats,
  type AdminFinancialOverview,
  type AdminReportsSummary,
  type RelationInboxStats,
} from '../../staffApi';
import { isBillingStaff } from '../../condoUserRoles';
import { AdminReportsSummaryPanel } from './AdminReportsSummaryPanel';
import { useStaffSession } from '../useStaffSession';
import { StaffLayout } from '../StaffLayout';

export function AdministratorAreaPage() {
  const session = useStaffSession();
  const [fin, setFin] = useState<AdminFinancialOverview | null>(null);
  const [finErr, setFinErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<AdminReportsSummary | null>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [chatStats, setChatStats] = useState<RelationInboxStats | null>(null);

  const canBill = session && isBillingStaff(session.role);

  const loadFin = useCallback(async () => {
    if (!session) {
      return;
    }
    setFinErr(null);
    try {
      const r = await getAdministratorFinancialOverview(session.condoId, session.id);
      setFin(r);
    } catch (e) {
      setFin(null);
      setFinErr(e instanceof Error ? e.message : 'Erro ao carregar indicadores.');
    }
  }, [session]);

  const loadSummary = useCallback(async () => {
    if (!session) {
      return;
    }
    setSumErr(null);
    try {
      const r = await getAdministratorReportsSummary(session.condoId, session.id);
      setSummary(r);
    } catch (e) {
      setSummary(null);
      setSumErr(e instanceof Error ? e.message : 'Erro ao carregar resumo.');
    }
  }, [session]);

  const loadChatStats = useCallback(async () => {
    if (!session) {
      return;
    }
    try {
      const r = await getRelationsInboxStats(session.condoId, 'administration');
      setChatStats(r);
    } catch {
      setChatStats(null);
    }
  }, [session]);

  useEffect(() => {
    void loadFin();
    void loadSummary();
    void loadChatStats();
  }, [loadFin, loadSummary, loadChatStats]);

  if (!session) {
    return null;
  }

  const chatTotal = chatStats?.conversationCount ?? 0;
  const chatAwaiting = chatStats?.awaitingStaffReplyCount ?? 0;
  const chatSubtitle =
    chatTotal === 0
      ? 'Conversas do Fale com o Condomínio · nenhuma ativa'
      : chatAwaiting > 0
        ? `${chatTotal} conversa(s) · ${chatAwaiting} aguardando resposta`
        : `${chatTotal} conversa(s) com moradores`;

  return (
    <StaffLayout title="Administração">
      <div className="staff-hero">
        <h2>Painel da administração</h2>
        <p>
          Indicadores da API — alinhados ao app móvel. Equipa operacional (inclui
          colaboradores) acede a cadastros e chats.
        </p>
      </div>

      <h3 className="staff-section-title">Controlo financeiro</h3>
      <p className="staff-section-desc">
        Com base em cobranças cadastradas (requer permissão de leitura na API).
      </p>
      {finErr && !fin ? (
        <p className="staff-error">{finErr}</p>
      ) : !fin ? (
        <p>Carregando…</p>
      ) : (
        <div className="staff-metrics">
          <div className="staff-metric-card" style={{ cursor: 'default' }}>
            <div className="staff-metric-card__val">{fin.invoicesIssued}</div>
            <div className="staff-metric-card__label">Cobranças emitidas</div>
          </div>
          <div className="staff-metric-card" style={{ cursor: 'default' }}>
            <div className="staff-metric-card__val">{fin.delinquencyPercent}%</div>
            <div className="staff-metric-card__label">Inadimplência (aberto / emitido)</div>
          </div>
          <div className="staff-metric-card" style={{ cursor: 'default' }}>
            <div className="staff-metric-card__val">{fin.unpaidOpen}</div>
            <div className="staff-metric-card__label">Abertas (pendentes/atraso)</div>
          </div>
          <div className="staff-metric-card" style={{ cursor: 'default' }}>
            <div className="staff-metric-card__val">{fin.unitsBillingActive}</div>
            <div className="staff-metric-card__label">Unidades com cobrança ativa</div>
          </div>
        </div>
      )}

      <h3 className="staff-section-title">Cadastros</h3>
      <Link className="staff-card" to="unidades">
        <span className="staff-card__icon" aria-hidden>
          🏠
        </span>
        <div className="staff-card__body">
          <strong>Unidades</strong>
          <span>Blocos, torres e números</span>
        </div>
        <span className="staff-card__action">Abrir</span>
      </Link>
      {canBill ? (
        <p className="staff-muted" style={{ marginTop: 12 }}>
          <strong>Boleto online</strong> e <strong>utilizadores do app</strong> continuam
          disponíveis no aplicativo móvel; integração web pode seguir nestas rotas.
        </p>
      ) : null}

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
      <p className="staff-section-desc">
        Resumo executivo com os mesmos números do endpoint de relatórios da API.
      </p>
      {sumErr && !summary ? (
        <p className="staff-error">{sumErr}</p>
      ) : summary ? (
        <AdminReportsSummaryPanel data={summary} />
      ) : (
        <p>Carregando…</p>
      )}
    </StaffLayout>
  );
}

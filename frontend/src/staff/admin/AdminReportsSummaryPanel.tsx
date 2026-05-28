import { Link } from 'react-router-dom';
import type { AdminReportsSummary } from '../../staffApi';

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function unitLabel(tower: string | null, number: string | null): string {
  const t = tower?.trim() || '';
  const n = number?.trim() || '';
  if (t && n) {
    return `${t} · ${n}`;
  }
  return t || n || '—';
}

export function AdminReportsSummaryPanel({ data }: { data: AdminReportsSummary }) {
  const { financial: fin } = data;
  const units = data.delinquencyByUnit ?? [];

  return (
    <div className="staff-report-summary">
      <div className="staff-section-subtitle">Indicadores financeiros</div>
      <div className="staff-metrics staff-metrics--static">
        <div className="staff-metric-card staff-metric-card--static">
          <div className="staff-metric-card__val">{fin.chargesIssued}</div>
          <div className="staff-metric-card__label">Cobranças emitidas</div>
        </div>
        <div className="staff-metric-card staff-metric-card--static">
          <div className="staff-metric-card__val">{fin.chargesOpen}</div>
          <div className="staff-metric-card__label">Em aberto (pendentes + atraso)</div>
        </div>
        <div className="staff-metric-card staff-metric-card--static">
          <div className="staff-metric-card__val">{fin.delinquencyPercent}%</div>
          <div className="staff-metric-card__label">Taxa de inadimplência</div>
        </div>
        <div className="staff-metric-card staff-metric-card--static">
          <div className="staff-metric-card__val">{brl.format(fin.amountOpenRough)}</div>
          <div className="staff-metric-card__label">Valor aprox. em aberto</div>
        </div>
      </div>

      <div className="staff-section-subtitle">Operação e ocupação</div>
      <div className="staff-metrics staff-metrics--static">
        <div className="staff-metric-card staff-metric-card--static">
          <div className="staff-metric-card__val">{data.occurrencesOpen}</div>
          <div className="staff-metric-card__label">Ocorrências abertas</div>
        </div>
        <div className="staff-metric-card staff-metric-card--static">
          <div className="staff-metric-card__val">{data.maintenanceOpen}</div>
          <div className="staff-metric-card__label">Manutenções abertas</div>
        </div>
        <div className="staff-metric-card staff-metric-card--static">
          <div className="staff-metric-card__val">{data.reservationsLast90Days}</div>
          <div className="staff-metric-card__label">Reservas (últimos 90 dias)</div>
        </div>
        <div className="staff-metric-card staff-metric-card--static">
          <div className="staff-metric-card__val">
            {data.unitsOccupied} / {data.unitsTotal}
          </div>
          <div className="staff-metric-card__label">Unidades com morador / total</div>
        </div>
      </div>

      <div className="staff-section-subtitle">Cobranças em aberto por unidade</div>
      <p className="staff-section-desc" style={{ marginTop: 0 }}>
        Até 50 unidades com maior valor em dívida (mesma lista que alimenta o resumo na API).
      </p>
      {units.length === 0 ? (
        <p className="staff-muted">Nenhuma unidade com cobrança pendente ou em atraso.</p>
      ) : (
        <div className="staff-table-wrap">
          <table className="staff-table">
            <thead>
              <tr>
                <th scope="col">Unidade</th>
                <th scope="col">Atraso</th>
                <th scope="col">Pendente</th>
                <th scope="col" className="staff-table__num">
                  Valor em aberto
                </th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.unitId}>
                  <td>
                    <strong>{unitLabel(u.tower, u.number)}</strong>
                    <span className="staff-table__id"> #{u.unitId}</span>
                  </td>
                  <td>{u.overdueCount}</td>
                  <td>{u.pendingCount}</td>
                  <td className="staff-table__num">{brl.format(u.amountDue)}</td>
                  <td className="staff-table__actions">
                    <Link
                      className="staff-table__link"
                      to={`/app/administracao/unidades/${u.unitId}/moradores`}
                    >
                      Moradores
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

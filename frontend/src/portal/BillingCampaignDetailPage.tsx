import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getBillingCampaign,
  getBillingCampaignCharges,
  getUnitsForCondo,
  postFinalizeCampaign,
  postGenerateCampaignCharges,
  postGenerateOneCharge,
  postMarkChargePaid,
  type BillingCampaignRow,
  type UnitRow,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

export function BillingCampaignDetailPage() {
  const session = useStaffSession();
  const { campaignId: rawId } = useParams<{ campaignId: string }>();
  const campaignId = rawId != null ? Number.parseInt(rawId, 10) : Number.NaN;

  const [campaign, setCampaign] = useState<BillingCampaignRow | null>(null);
  const [charges, setCharges] = useState<Record<string, unknown>[] | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickUnit, setPickUnit] = useState<string>('');

  const load = useCallback(async () => {
    if (!session || !Number.isFinite(campaignId) || campaignId < 1) {
      return;
    }
    setErr(null);
    try {
      const [c, ch, u] = await Promise.all([
        getBillingCampaign(campaignId, session.condoId, session.id),
        getBillingCampaignCharges(campaignId, session.condoId, session.id),
        getUnitsForCondo(session.condoId),
      ]);
      setCampaign(c);
      setCharges(ch);
      setUnits(u);
    } catch (e) {
      setCampaign(null);
      setCharges(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, [session, campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isDraft = str(campaign?.status) === 'draft';

  const billedUnitIds = useMemo(() => {
    const s = new Set<number>();
    for (const ch of charges ?? []) {
      s.add(num(ch.unit_id));
    }
    return s;
  }, [charges]);

  const eligibleUnits = useMemo(() => {
    return units.filter(
      (u) => u.billing_active === true && !billedUnitIds.has(u.id),
    );
  }, [units, billedUnitIds]);

  if (!session) {
    return null;
  }

  if (!Number.isFinite(campaignId) || campaignId < 1) {
    return (
      <StaffLayout title="Competência" backTo="/app/boleto-online">
        <p className="staff-error">Identificador inválido.</p>
      </StaffLayout>
    );
  }

  const onGenerateAll = async () => {
    if (!session) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await postGenerateCampaignCharges(campaignId, session.condoId, session.id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha na geração em lote.');
    } finally {
      setBusy(false);
    }
  };

  const onGenerateOne = async () => {
    if (!session || !pickUnit) {
      return;
    }
    const uid = Number.parseInt(pickUnit, 10);
    if (!Number.isFinite(uid)) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await postGenerateOneCharge(campaignId, session.condoId, session.id, uid);
      setPickUnit('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha.');
    } finally {
      setBusy(false);
    }
  };

  const onFinalize = async () => {
    if (!session) {
      return;
    }
    if (!window.confirm('Encerrar esta competência e marcar como «boletos gerados»?')) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await postFinalizeCampaign(campaignId, session.condoId, session.id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao finalizar.');
    } finally {
      setBusy(false);
    }
  };

  const onMarkPaid = async (chargeId: number) => {
    if (!session) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await postMarkChargePaid(chargeId, session.condoId, session.id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Não foi possível marcar como pago.');
    } finally {
      setBusy(false);
    }
  };

  const title = str(campaign?.title) || 'Competência';

  return (
    <StaffLayout title={title} backTo="/app/boleto-online">
      {err ? <p className="staff-error">{err}</p> : null}

      {!campaign || !charges ? (
        <p>Carregando…</p>
      ) : (
        <>
          <p className="staff-muted">
            {str(campaign.competence)} · Venc.: {str(campaign.due_date)?.slice(0, 10)} · Status:{' '}
            <strong>{str(campaign.status)}</strong>
          </p>

          {isDraft ? (
            <div className="portal-form" style={{ marginBottom: 20 }}>
              <p className="staff-section-desc">Gerar cobranças (mesmo fluxo do app móvel)</p>
              <div className="portal-charge-actions" style={{ flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="portal-btn portal-btn--primary"
                  disabled={busy}
                  onClick={() => void onGenerateAll()}
                >
                  Gerar para todas as unidades
                </button>
              </div>
              <div style={{ marginTop: 14 }}>
                <label>
                  Gerar para uma unidade
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                    <select
                      value={pickUnit}
                      onChange={(e) => setPickUnit(e.target.value)}
                      style={{ minWidth: 200 }}
                    >
                      <option value="">Escolha…</option>
                      {eligibleUnits.map((u) => (
                        <option key={u.id} value={String(u.id)}>
                          {u.tower ?? ''} {u.number ?? u.id}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="portal-btn"
                      disabled={busy || !pickUnit}
                      onClick={() => void onGenerateOne()}
                    >
                      Gerar
                    </button>
                  </div>
                </label>
              </div>
              {charges.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <button type="button" className="portal-btn" disabled={busy} onClick={() => void onFinalize()}>
                    Encerrar competência (marcar como gerada)
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <h3 className="staff-section-title">Cobranças</h3>
          {charges.length === 0 ? (
            <p className="staff-muted">Nenhuma cobrança nesta competência.</p>
          ) : (
            <div className="staff-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Unidade</th>
                    <th>Valor</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {charges.map((c) => {
                    const id = num(c.id);
                    const st = str(c.status);
                    return (
                      <tr key={id}>
                        <td>
                          {str(c.tower)} · {str(c.number)}
                          <span className="staff-table__id">#{num(c.unit_id)}</span>
                        </td>
                        <td className="staff-table__num">{brl.format(num(c.amount))}</td>
                        <td>{st}</td>
                        <td className="staff-table__actions">
                          {st === 'pending' || st === 'overdue' ? (
                            <button
                              type="button"
                              className="portal-link"
                              disabled={busy}
                              onClick={() => void onMarkPaid(id)}
                            >
                              Marcar pago
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ marginTop: 24 }}>
            <Link to="/app/boleto-online">← Voltar à lista</Link>
          </p>
        </>
      )}
    </StaffLayout>
  );
}

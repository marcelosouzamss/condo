import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import { isOperationalStaff } from '../condoUserRoles';
import {
  checkInPass,
  checkOutPass,
  createServiceProvider,
  createVisitorPass,
  getAccessEvents,
  getAccessStats,
  getServiceProviders,
  getUnitsForCondo,
  getVisitorPasses,
  revokeVisitorPass,
  validateAccessPin,
  type AccessStats,
  type UnitRow,
  type VisitorPassRow,
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

function fmtDt(raw: unknown): string {
  if (raw == null) {
    return '';
  }
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) {
    return String(raw);
  }
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function statusPt(s: string): string {
  switch (s) {
    case 'pending':
      return 'Pendente entrada';
    case 'inside':
      return 'Dentro do condomínio';
    case 'completed':
      return 'Concluído';
    case 'revoked':
      return 'Revogado';
    case 'expired':
      return 'Expirado';
    default:
      return s || '—';
  }
}

function passName(p: VisitorPassRow): string {
  return str(p.visitor_full_name).trim();
}

function unitLabel(p: VisitorPassRow): string {
  const t = str(p.tower).trim();
  const n = str(p.number).trim();
  if (!t && !n) {
    return 'Unidade';
  }
  return `${t} · ${n}`;
}

export function AccessControlPage() {
  const session = useStaffSession();
  const staff = session ? isOperationalStaff(session.role) : false;
  const maxTab = staff ? 2 : 1;

  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [stats, setStats] = useState<AccessStats | null>(null);
  const [passes, setPasses] = useState<VisitorPassRow[]>([]);
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [providers, setProviders] = useState<Record<string, unknown>[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);

  const [pin, setPin] = useState('');
  const [validated, setValidated] = useState<VisitorPassRow | null>(null);

  const [visitorOpen, setVisitorOpen] = useState(false);
  const [vName, setVName] = useState('');
  const [vPhone, setVPhone] = useState('');
  const [vDoc, setVDoc] = useState('');
  const [vNotes, setVNotes] = useState('');
  const [vFrom, setVFrom] = useState(() => new Date().toISOString().slice(0, 16));
  const [vUntil, setVUntil] = useState(() => {
    const e = new Date();
    e.setHours(e.getHours() + 4);
    return e.toISOString().slice(0, 16);
  });
  const [unitPick, setUnitPick] = useState<string>('');

  const [spOpen, setSpOpen] = useState(false);
  const [spCompany, setSpCompany] = useState('');
  const [spNotes, setSpNotes] = useState('');

  const residentUnitId = session?.unitId;

  const reload = useCallback(async () => {
    if (!session) {
      return;
    }
    setErr(null);
    try {
      const [st, ps, ev, un] = await Promise.all([
        getAccessStats(session.condoId, session.id),
        getVisitorPasses(session.condoId, session.id, 'all'),
        getAccessEvents(session.condoId, session.id, 120),
        staff ? getUnitsForCondo(session.condoId) : Promise.resolve([] as UnitRow[]),
      ]);
      setStats(st);
      setPasses(ps);
      setEvents(ev);
      setUnits(un);
      if (staff) {
        setProviders(await getServiceProviders(session.condoId, session.id));
      } else {
        setProviders([]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }, [session, staff]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (tab > maxTab) {
      setTab(maxTab);
    }
  }, [tab, maxTab]);

  const groupPassesByUnit = useMemo(() => {
    const m = new Map<string, VisitorPassRow[]>();
    for (const p of passes) {
      const label = unitLabel(p);
      const list = m.get(label) ?? [];
      list.push(p);
      m.set(label, list);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [passes]);

  const pendingInside = useMemo(() => {
    const pending = passes.filter((p) => str(p.status) === 'pending');
    const inside = passes.filter((p) => str(p.status) === 'inside');
    return { pending, inside };
  }, [passes]);

  const onValidate = async () => {
    if (!session || !staff) {
      return;
    }
    const code = pin.trim();
    if (code.length !== 6) {
      setErr('Informe o PIN de 6 dígitos.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await validateAccessPin(session.condoId, session.id, code);
      setValidated((res.pass as VisitorPassRow) ?? null);
    } catch (e) {
      setValidated(null);
      setErr(e instanceof Error ? e.message : 'Passe não encontrado.');
    } finally {
      setBusy(false);
    }
  };

  const doCheckIn = async (passId: number, method: string) => {
    if (!session) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await checkInPass(passId, session.condoId, session.id, method);
      setValidated(null);
      setPin('');
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro na entrada.');
    } finally {
      setBusy(false);
    }
  };

  const doCheckOut = async (passId: number, method: string) => {
    if (!session) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await checkOutPass(passId, session.condoId, session.id, method);
      setValidated(null);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro na saída.');
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async (passId: number) => {
    if (!session || !staff) {
      return;
    }
    if (!window.confirm('Revogar esta liberação?')) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await revokeVisitorPass(passId, session.condoId, session.id);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao revogar.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmitVisitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !vName.trim()) {
      return;
    }
    const uid = staff
      ? Number.parseInt(unitPick, 10)
      : residentUnitId ?? Number.NaN;
    if (!Number.isFinite(uid) || uid < 1) {
      setErr(staff ? 'Selecione a unidade.' : 'Unidade não definida no login.');
      return;
    }
    const from = new Date(vFrom);
    const until = new Date(vUntil);
    if (until <= from) {
      setErr('A data final deve ser após o início.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await createVisitorPass({
        condoId: session.condoId,
        userId: session.id,
        unitId: uid,
        visitorFullName: vName.trim(),
        visitorPhone: vPhone.trim() || null,
        documentId: vDoc.trim() || null,
        notes: vNotes.trim() || null,
        validFrom: from.toISOString(),
        validUntil: until.toISOString(),
      });
      setVisitorOpen(false);
      setVName('');
      await reload();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Erro ao criar liberação.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmitProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !spCompany.trim()) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await createServiceProvider({
        condoId: session.condoId,
        userId: session.id,
        companyName: spCompany.trim(),
        notes: spNotes.trim() || null,
      });
      setSpOpen(false);
      setSpCompany('');
      setSpNotes('');
      await reload();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Erro.');
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return null;
  }

  const qrFor = (p: VisitorPassRow) => str(p.qr_token ?? p.qrToken);

  const renderPassCard = (p: VisitorPassRow) => {
    const id = num(p.id);
    const pinCode = str(p.pin_code ?? p.pinCode);
    const qr = qrFor(p);
    const rawStatus = str(p.status);

    return (
      <div className="portal-pass-card" key={id}>
        <div className="portal-pass-card__main">
          <strong>{passName(p)}</strong>
          <div className="staff-muted">{unitLabel(p)}</div>
          <div className="portal-tag">{statusPt(rawStatus)}</div>
          <div className="staff-muted" style={{ marginTop: 6 }}>
            Validade: {fmtDt(p.valid_from ?? p.validFrom)} — {fmtDt(p.valid_until ?? p.validUntil)}
          </div>
          {pinCode ? (
            <div className="portal-pin-row">
              PIN <code>{pinCode}</code>
              <button type="button" className="portal-btn portal-btn--small" onClick={() => void navigator.clipboard?.writeText(pinCode)}>
                Copiar
              </button>
            </div>
          ) : null}
        </div>
        {qr ? (
          <div className="portal-qr">
            <QRCode value={qr} size={88} />
          </div>
        ) : null}
        {staff ? (
          <div className="portal-charge-actions" style={{ gridColumn: '1 / -1' }}>
            {rawStatus === 'pending' ? (
              <button type="button" className="portal-btn" disabled={busy} onClick={() => void doCheckIn(id, 'manual')}>
                Entrada
              </button>
            ) : null}
            {rawStatus === 'inside' ? (
              <button type="button" className="portal-btn" disabled={busy} onClick={() => void doCheckOut(id, 'manual')}>
                Saída
              </button>
            ) : null}
            {rawStatus !== 'completed' && rawStatus !== 'revoked' ? (
              <button type="button" className="portal-link-danger" disabled={busy} onClick={() => void doRevoke(id)}>
                Revogar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const tabs = staff
    ? [
        { id: 'sum', label: 'Resumo' },
        { id: 'units', label: 'Unidades autorizadas' },
        { id: 'hist', label: 'Histórico' },
      ]
    : [
        { id: 'vis', label: 'Visitantes' },
        { id: 'hist', label: 'Histórico' },
      ];

  return (
    <StaffLayout title="Controle de Acesso" backTo="/app">
      <div className="portal-tabs" role="tablist">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === i}
            className={tab === i ? 'portal-tabs__btn portal-tabs__btn--on' : 'portal-tabs__btn'}
            onClick={() => setTab(i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <p>A carregar…</p> : null}
      {err ? <p className="staff-error">{err}</p> : null}

      {staff && tab === 0 ? (
        <div className="portal-tab-panel">
          {stats ? (
            <div className="staff-metrics staff-metrics--static" style={{ marginBottom: 16 }}>
              <div className="staff-metric-card staff-metric-card--static">
                <div className="staff-metric-card__val">{stats.visitorsExpected}</div>
                <div className="staff-metric-card__label">Aguardados</div>
              </div>
              <div className="staff-metric-card staff-metric-card--static">
                <div className="staff-metric-card__val">{stats.visitorsInside}</div>
                <div className="staff-metric-card__label">Dentro</div>
              </div>
              <div className="staff-metric-card staff-metric-card--static">
                <div className="staff-metric-card__val">{stats.providersActive}</div>
                <div className="staff-metric-card__label">Prestadores</div>
              </div>
              <div className="staff-metric-card staff-metric-card--static">
                <div className="staff-metric-card__val">{stats.entriesToday}</div>
                <div className="staff-metric-card__label">Entradas hoje</div>
              </div>
            </div>
          ) : null}

          <h3 className="staff-section-title">Validar na portaria</h3>
          <div className="portal-inline">
            <input
              className="portal-input"
              placeholder="PIN 6 dígitos"
              maxLength={6}
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button type="button" className="portal-btn portal-btn--primary" disabled={busy} onClick={() => void onValidate()}>
              Validar
            </button>
          </div>

          {validated ? (
            <div className="staff-banner" style={{ marginTop: 12 }}>
              <strong>{passName(validated)}</strong>
              <div>{unitLabel(validated)}</div>
              <div>{statusPt(str(validated.status))}</div>
              <div className="portal-charge-actions" style={{ marginTop: 10 }}>
                {str(validated.status) === 'pending' ? (
                  <button type="button" className="portal-btn" disabled={busy} onClick={() => void doCheckIn(num(validated.id), 'pin')}>
                    Registrar entrada
                  </button>
                ) : null}
                {str(validated.status) === 'inside' ? (
                  <button type="button" className="portal-btn" disabled={busy} onClick={() => void doCheckOut(num(validated.id), 'pin')}>
                    Registrar saída
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <h3 className="staff-section-title" style={{ marginTop: 20 }}>
            Fila rápida
          </h3>
          {pendingInside.pending.length === 0 && pendingInside.inside.length === 0 ? (
            <p className="staff-muted">Nenhum visitante pendente ou dentro.</p>
          ) : (
            <>
              {pendingInside.pending.map((p) => renderPassCard(p))}
              {pendingInside.inside.map((p) => renderPassCard(p))}
            </>
          )}

          <div className="portal-split-head">
            <h3 className="staff-section-title">Prestadores de serviço</h3>
            <button type="button" className="portal-btn" onClick={() => setSpOpen(true)}>
              Novo
            </button>
          </div>
          {providers.length === 0 ? (
            <p className="staff-muted">Nenhum prestador cadastrado.</p>
          ) : (
            <ul className="staff-list">
              {providers.map((sp) => (
                <li key={num(sp.id)}>
                  <strong>{str(sp.company_name ?? sp.companyName)}</strong>
                  <div className="staff-muted">{str(sp.notes)}</div>
                </li>
              ))}
            </ul>
          )}

          <button type="button" className="portal-btn portal-btn--primary" style={{ marginTop: 16 }} disabled={busy || units.length === 0} onClick={() => setVisitorOpen(true)}>
            Nova liberação
          </button>
        </div>
      ) : null}

      {staff && tab === 1 ? (
        <div className="portal-tab-panel">
          {groupPassesByUnit.length === 0 ? (
            <p className="staff-muted">Nenhuma liberação cadastrada.</p>
          ) : (
            groupPassesByUnit.map(([label, list]) => (
              <details key={label} className="portal-details" open>
                <summary>
                  <strong>{label}</strong>
                  <span className="staff-muted"> ({list.length})</span>
                </summary>
                {list.map((p) => renderPassCard(p))}
              </details>
            ))
          )}
        </div>
      ) : null}

      {tab === (staff ? 2 : 1) ? (
        <div className="portal-tab-panel">
          {events.length === 0 ? (
            <p className="staff-muted">Nenhum registo no histórico.</p>
          ) : (
            <ul className="staff-list">
              {events.map((e, i) => {
                const dir = str(e.direction) === 'in' ? 'Entrada' : 'Saída';
                return (
                  <li key={num(e.id) || i}>
                    <strong>{str(e.subject_name ?? e.subjectName) || '—'}</strong>
                    <div className="staff-muted">
                      {dir} · {fmtDt(e.recorded_at ?? e.recordedAt)} · {str(e.method)} · {str(e.tower)} {str(e.number)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {!staff && tab === 0 ? (
        <div className="portal-tab-panel">
          {residentUnitId == null ? (
            <p className="staff-banner">
              Associe a sua unidade (como em «Minha Unidade» no app) para cadastrar visitantes.
            </p>
          ) : stats ? (
            <div className="staff-metrics staff-metrics--static" style={{ marginBottom: 16 }}>
              <div className="staff-metric-card staff-metric-card--static">
                <div className="staff-metric-card__val">{stats.visitorsExpected}</div>
                <div className="staff-metric-card__label">Aguardados</div>
              </div>
              <div className="staff-metric-card staff-metric-card--static">
                <div className="staff-metric-card__val">{stats.visitorsInside}</div>
                <div className="staff-metric-card__label">Dentro</div>
              </div>
              <div className="staff-metric-card staff-metric-card--static">
                <div className="staff-metric-card__val">{stats.providersActive}</div>
                <div className="staff-metric-card__label">Prestadores</div>
              </div>
              <div className="staff-metric-card staff-metric-card--static">
                <div className="staff-metric-card__val">{stats.entriesToday}</div>
                <div className="staff-metric-card__label">Entradas hoje</div>
              </div>
            </div>
          ) : null}
          {passes.length === 0 ? (
            <p className="staff-muted">Nenhuma liberação cadastrada.</p>
          ) : (
            passes.map((p) => renderPassCard(p))
          )}
          <button
            type="button"
            className="portal-btn portal-btn--primary"
            style={{ marginTop: 16 }}
            disabled={busy || residentUnitId == null}
            onClick={() => setVisitorOpen(true)}
          >
            Visitante
          </button>
        </div>
      ) : null}

      <p style={{ marginTop: 20 }}>
        <button type="button" className="portal-btn" disabled={busy} onClick={() => void reload()}>
          Atualizar
        </button>
      </p>

      {visitorOpen ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card">
            <h3>Nova liberação</h3>
            <form onSubmit={onSubmitVisitor}>
              {staff ? (
                <label>
                  Unidade
                  <select required value={unitPick} onChange={(e) => setUnitPick(e.target.value)}>
                    <option value="">Escolha…</option>
                    {units.map((u) => (
                      <option key={u.id} value={String(u.id)}>
                        {u.tower ?? ''} · {u.number ?? u.id}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                Nome do visitante
                <input required value={vName} onChange={(e) => setVName(e.target.value)} />
              </label>
              <label>
                Telefone (opcional)
                <input value={vPhone} onChange={(e) => setVPhone(e.target.value)} />
              </label>
              <label>
                Documento (opcional)
                <input value={vDoc} onChange={(e) => setVDoc(e.target.value)} />
              </label>
              <label>
                Notas (opcional)
                <textarea value={vNotes} onChange={(e) => setVNotes(e.target.value)} rows={2} />
              </label>
              <label>
                Válido de
                <input type="datetime-local" value={vFrom} onChange={(e) => setVFrom(e.target.value)} />
              </label>
              <label>
                Até
                <input type="datetime-local" value={vUntil} onChange={(e) => setVUntil(e.target.value)} />
              </label>
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={busy}>
                  Gerar liberação
                </button>
                <button type="button" className="portal-btn" onClick={() => setVisitorOpen(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {spOpen ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card">
            <h3>Novo prestador</h3>
            <form onSubmit={onSubmitProvider}>
              <label>
                Empresa
                <input required value={spCompany} onChange={(e) => setSpCompany(e.target.value)} />
              </label>
              <label>
                Notas
                <textarea value={spNotes} onChange={(e) => setSpNotes(e.target.value)} rows={2} />
              </label>
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={busy}>
                  Guardar
                </button>
                <button type="button" className="portal-btn" onClick={() => setSpOpen(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </StaffLayout>
  );
}

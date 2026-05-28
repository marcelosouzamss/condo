import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CondoUserRoles, isOperationalStaff, picksCondoBeforeContact } from '../condoUserRoles';
import {
  getUnitsForCondo,
  listParcelDeliveries,
  pickupParcelDelivery,
  registerParcelDelivery,
  type UnitRow,
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

function parcelStatusPt(s: string): string {
  switch (s) {
    case 'awaiting_pickup':
      return 'Aguarda retirada';
    case 'picked_up':
      return 'Retirada';
    default:
      return s;
  }
}

export function ParcelDeliveriesPage() {
  const session = useStaffSession();
  const [searchParams] = useSearchParams();
  const condoParam = searchParams.get('condoId');
  const effectiveCondoId = useMemo(() => {
    if (!session) {
      return 0;
    }
    if (picksCondoBeforeContact(session.role)) {
      if (condoParam) {
        const n = Number.parseInt(condoParam, 10);
        if (Number.isFinite(n) && n > 0) {
          return n;
        }
      }
    }
    return session.condoId;
  }, [session, condoParam]);

  const staff = session ? isOperationalStaff(session.role) : false;
  const isResident = session?.role === CondoUserRoles.resident;

  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [units, setUnits] = useState<UnitRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [filterUnit, setFilterUnit] = useState('');

  const [regUnit, setRegUnit] = useState('');
  const [carrier, setCarrier] = useState('');
  const [recipient, setRecipient] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [residentUnitPick, setResidentUnitPick] = useState('');

  const effectiveResidentUnitId = useMemo(() => {
    if (!session) {
      return null;
    }
    if (session.unitId != null) {
      return session.unitId;
    }
    const u = Number.parseInt(residentUnitPick, 10);
    return Number.isFinite(u) && u > 0 ? u : null;
  }, [session, residentUnitPick]);

  const load = useCallback(async () => {
    if (!session || !effectiveCondoId) {
      return;
    }
    if (isResident && effectiveResidentUnitId == null) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      setRows(
        await listParcelDeliveries({
          condoId: effectiveCondoId,
          userId: session.id,
          ...(staff
            ? {
                ...(filterUnit &&
                Number.isFinite(Number.parseInt(filterUnit, 10)) &&
                Number.parseInt(filterUnit, 10) > 0
                  ? { filterUnitId: Number.parseInt(filterUnit, 10) }
                  : {}),
              }
            : { unitId: effectiveResidentUnitId! }),
        }),
      );
    } catch (e) {
      setRows(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId, staff, isResident, effectiveResidentUnitId, filterUnit]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!staff || !effectiveCondoId) {
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const u = await getUnitsForCondo(effectiveCondoId);
        if (!cancel) {
          setUnits(u);
        }
      } catch {
        if (!cancel) {
          setUnits([]);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [staff, effectiveCondoId]);

  useEffect(() => {
    if (!isResident || !effectiveCondoId || session?.unitId != null) {
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const u = await getUnitsForCondo(effectiveCondoId);
        if (!cancel) {
          setUnits(u);
        }
      } catch {
        if (!cancel) {
          setUnits([]);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [isResident, effectiveCondoId, session?.unitId]);

  const onRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !staff || !effectiveCondoId) {
      return;
    }
    const uid = Number.parseInt(regUnit, 10);
    if (!Number.isFinite(uid) || uid < 1) {
      setErr('Escolha a unidade.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await registerParcelDelivery({
        condoId: effectiveCondoId,
        userId: session.id,
        unitId: uid,
        carrierHint: carrier.trim() || null,
        recipientLabel: recipient.trim() || null,
        notes: notes.trim() || null,
      });
      setCarrier('');
      setRecipient('');
      setNotes('');
      setRegUnit('');
      await load();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Erro ao registar.');
    } finally {
      setSaving(false);
    }
  };

  const onPickup = async (id: number) => {
    if (!session || !isResident) {
      return;
    }
    if (!window.confirm('Confirmar retirada desta encomenda na portaria?')) {
      return;
    }
    setErr(null);
    try {
      await pickupParcelDelivery(id, {
        userId: session.id,
        ...(session.unitId == null && effectiveResidentUnitId != null
          ? { unitId: effectiveResidentUnitId }
          : {}),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro.');
    }
  };

  if (!session) {
    return null;
  }

  const canAccess = staff || isResident;
  const allRows = rows ?? [];
  const visibleRows =
    tab === 'pending'
      ? allRows.filter((row) => str(row.status) === 'awaiting_pickup')
      : allRows;

  return (
    <StaffLayout title="Encomendas" backTo="/app">
      <div className="staff-hero">
        <h2>Portaria</h2>
        <p>
          A equipa regista chegadas; o morador confirma quando retira a encomenda.
        </p>
      </div>

      {err ? <p className="staff-error">{err}</p> : null}

      {!canAccess ? (
        <p className="staff-banner">
          Disponível para moradores, síndico, administração e colaboradores.
        </p>
      ) : null}

      {staff && units ? (
        <details className="portal-details" style={{ marginBottom: 16 }}>
          <summary style={{ fontWeight: 700, cursor: 'pointer' }}>Registar encomenda recebida</summary>
          <form className="portal-form" style={{ marginTop: 12 }} onSubmit={onRegister}>
            <label>
              Unidade
              <select required value={regUnit} onChange={(e) => setRegUnit(e.target.value)}>
                <option value="">—</option>
                {units.map((u) => (
                  <option key={num(u.id)} value={num(u.id)}>
                    {str(u.tower)} {str(u.number)} (#{num(u.id)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Transportadora / dica (opcional)
              <input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
            </label>
            <label>
              Destinatário / identificação (opcional)
              <input value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            </label>
            <label>
              Notas (opcional)
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </label>
            <button type="submit" className="portal-btn portal-btn--primary" disabled={saving}>
              {saving ? 'A guardar…' : 'Registar'}
            </button>
          </form>
        </details>
      ) : null}

      {staff ? (
        <div className="portal-inline" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          {units && units.length > 0 ? (
            <label>
              Filtrar unidade
              <select value={filterUnit} onChange={(e) => setFilterUnit(e.target.value)}>
                <option value="">Todas</option>
                {units.map((u) => (
                  <option key={num(u.id)} value={num(u.id)}>
                    {str(u.tower)} {str(u.number)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="portal-tabs" role="tablist" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={tab === 'pending' ? 'portal-tabs__btn portal-tabs__btn--on' : 'portal-tabs__btn'}
          onClick={() => setTab('pending')}
        >
          Pendentes
        </button>
        <button
          type="button"
          className={tab === 'history' ? 'portal-tabs__btn portal-tabs__btn--on' : 'portal-tabs__btn'}
          onClick={() => setTab('history')}
        >
          Histórico
        </button>
      </div>

      {isResident && session.unitId == null && units && units.length > 0 ? (
        <label className="staff-muted" style={{ display: 'block', marginBottom: 12 }}>
          Unidade para consultar
          <select
            className="portal-input"
            value={residentUnitPick}
            onChange={(e) => setResidentUnitPick(e.target.value)}
          >
            <option value="">—</option>
            {units.map((u) => (
              <option key={num(u.id)} value={num(u.id)}>
                {str(u.tower)} {str(u.number)} (#{num(u.id)})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {isResident && effectiveResidentUnitId == null ? (
        <p className="staff-muted">Selecione a unidade ou associe-a ao seu perfil.</p>
      ) : null}

      {loading ? (
        <p>A carregar…</p>
      ) : visibleRows.length === 0 ? (
        <p className="staff-muted">
          {tab === 'pending'
            ? 'Nenhuma encomenda aguardando retirada.'
            : 'Nenhuma encomenda registrada no histórico.'}
        </p>
      ) : (
        <ul className="staff-list">
          {visibleRows.map((row) => {
            const id = num(row.id);
            const st = str(row.status);
            return (
              <li key={id}>
                <strong>{parcelStatusPt(st)}</strong>
                <div className="staff-muted" style={{ fontSize: '0.85rem' }}>
                  {str(row.unit_tower)} {str(row.unit_number)} · {str(row.created_at)?.slice(0, 16)?.replace('T', ' ')}
                </div>
                {str(row.carrier_hint) ? <p className="staff-muted">Transporte: {str(row.carrier_hint)}</p> : null}
                {str(row.recipient_label) ? <p>Destinatário: {str(row.recipient_label)}</p> : null}
                {str(row.notes) ? <p style={{ whiteSpace: 'pre-wrap' }}>{str(row.notes)}</p> : null}
                {st === 'picked_up' && str(row.picked_up_at) ? (
                  <p className="staff-muted">
                    Retirada em {str(row.picked_up_at).slice(0, 16).replace('T', ' ')}
                    {str(row.picked_up_by_name) ? ` por ${str(row.picked_up_by_name)}` : ''}
                  </p>
                ) : null}
                {isResident && st === 'awaiting_pickup' ? (
                  <button type="button" className="portal-btn portal-btn--primary" style={{ marginTop: 8 }} onClick={() => void onPickup(id)}>
                    Confirmar retirada
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </StaffLayout>
  );
}

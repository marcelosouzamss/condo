import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isOperationalStaff, picksCondoBeforeContact, staffMessagingApiRole, labelPt } from '../condoUserRoles';
import {
  getIndividualCommsInbox,
  getIndividualCommsSentByUnit,
  getIndividualCommsStaffSent,
  getIndividualCommAsStaff,
  getIndividualCommAsUnit,
  getUnitsForCondo,
  patchIndividualCommRead,
  postIndividualComm,
  type IndividualCommRow,
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

type Tab = 'hub' | 'inbox' | 'sent' | 'composeR' | 'composeS' | 'staffSent';

export function IndividualCommsPage() {
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

  const staffOperational = session ? isOperationalStaff(session.role) : false;
  const staffRole = session ? staffMessagingApiRole(session.role) : null;

  const [tab, setTab] = useState<Tab>('hub');
  const [rows, setRows] = useState<IndividualCommRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [units, setUnits] = useState<UnitRow[] | null>(null);

  const [toUnitId, setToUnitId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const [detail, setDetail] = useState<IndividualCommRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(async () => {
    if (!session || !effectiveCondoId) {
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      if (tab === 'inbox' && session.unitId != null) {
        setRows(await getIndividualCommsInbox(effectiveCondoId, session.unitId));
      } else if (tab === 'sent' && session.unitId != null) {
        setRows(await getIndividualCommsSentByUnit(effectiveCondoId, session.unitId));
      } else if (tab === 'staffSent' && staffRole) {
        setRows(await getIndividualCommsStaffSent(effectiveCondoId, staffRole));
      } else {
        setRows([]);
      }
    } catch (e) {
      setRows(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId, tab, staffRole]);

  useEffect(() => {
    if (tab === 'inbox' || tab === 'sent' || tab === 'staffSent') {
      void loadList();
    }
  }, [loadList, tab]);

  useEffect(() => {
    if (!session || !effectiveCondoId) {
      return;
    }
    if (tab === 'composeR' || tab === 'composeS') {
      let cancelled = false;
      (async () => {
        try {
          const u = await getUnitsForCondo(effectiveCondoId);
          if (!cancelled) {
            setUnits(u);
          }
        } catch {
          if (!cancelled) {
            setUnits([]);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [session, effectiveCondoId, tab]);

  const openDetail = async (id: number) => {
    if (!session || !effectiveCondoId) {
      return;
    }
    setDetailLoading(true);
    setErr(null);
    try {
      let d: IndividualCommRow;
      if (tab === 'inbox' && session.unitId != null) {
        d = await getIndividualCommAsUnit(effectiveCondoId, id, session.unitId);
        if (!str(d.read_at)) {
          await patchIndividualCommRead(id, effectiveCondoId, session.unitId);
        }
      } else if (tab === 'staffSent' && staffRole) {
        d = await getIndividualCommAsStaff(effectiveCondoId, id, staffRole);
      } else if (tab === 'sent' && session.unitId != null) {
        d = await getIndividualCommAsUnit(effectiveCondoId, id, session.unitId);
      } else {
        return;
      }
      setDetail(d);
      void loadList();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setDetailLoading(false);
    }
  };

  const submitCompose = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !effectiveCondoId || !subject.trim() || !body.trim()) {
      return;
    }
    const toId = Number.parseInt(toUnitId, 10);
    if (!Number.isFinite(toId) || toId < 1) {
      setErr('Escolha a unidade destino.');
      return;
    }
    setSending(true);
    setErr(null);
    try {
      if (tab === 'composeR' && session.unitId != null) {
        await postIndividualComm({
          condoId: effectiveCondoId,
          toUnitId: toId,
          fromUnitId: session.unitId,
          subject: subject.trim(),
          body: body.trim(),
        });
      } else if (tab === 'composeS' && staffRole) {
        await postIndividualComm({
          condoId: effectiveCondoId,
          toUnitId: toId,
          fromStaffRole: staffRole,
          subject: subject.trim(),
          body: body.trim(),
        });
      }
      setSubject('');
      setBody('');
      setToUnitId('');
      setTab(staffOperational ? 'staffSent' : 'sent');
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Não foi possível enviar.');
    } finally {
      setSending(false);
    }
  };

  if (!session) {
    return null;
  }

  const unitForResident =
    session.unitId != null && !staffOperational ? session.unitId : null;

  return (
    <StaffLayout title="Comunicados individuais" backTo="/app">
      <div className="staff-hero">
        <h2>Mensagens por unidade</h2>
        <p>
          {staffOperational && staffRole
            ? 'Como equipa, pode enviar comunicados privados para qualquer apartamento.'
            : 'Receba mensagens da equipa ou de outras unidades e envie para outras unidades.'}
        </p>
      </div>

      {err ? <p className="staff-error">{err}</p> : null}

      <div className="portal-inline" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        <button type="button" className={tab === 'hub' ? 'portal-btn portal-btn--primary' : 'portal-btn'} onClick={() => { setTab('hub'); setDetail(null); }}>
          Início
        </button>
        {unitForResident != null ? (
          <>
            <button type="button" className={tab === 'inbox' ? 'portal-btn portal-btn--primary' : 'portal-btn'} onClick={() => { setTab('inbox'); setDetail(null); }}>
              Caixa de entrada
            </button>
            <button type="button" className={tab === 'sent' ? 'portal-btn portal-btn--primary' : 'portal-btn'} onClick={() => { setTab('sent'); setDetail(null); }}>
              Enviados
            </button>
            <button type="button" className={tab === 'composeR' ? 'portal-btn portal-btn--primary' : 'portal-btn'} onClick={() => { setTab('composeR'); setDetail(null); }}>
              Novo (morador)
            </button>
          </>
        ) : null}
        {staffOperational && staffRole ? (
          <>
            <button type="button" className={tab === 'composeS' ? 'portal-btn portal-btn--primary' : 'portal-btn'} onClick={() => { setTab('composeS'); setDetail(null); }}>
              Novo (equipa)
            </button>
            <button type="button" className={tab === 'staffSent' ? 'portal-btn portal-btn--primary' : 'portal-btn'} onClick={() => { setTab('staffSent'); setDetail(null); }}>
              Enviados da equipa
            </button>
          </>
        ) : null}
      </div>

      {tab === 'hub' ? (
        <div className="portal-details">
          <p>
            {unitForResident == null && !staffOperational ? (
              <span className="staff-banner">
                Associe a sua unidade (como em «Minha Unidade» no app) para usar a caixa de entrada e enviar como morador.
              </span>
            ) : null}
            {staffOperational && !staffRole ? (
              <span className="staff-banner">O seu perfil não pode enviar como equipa nesta API.</span>
            ) : null}
          </p>
          <p className="staff-muted">Condomínio (pedido): {effectiveCondoId || '—'}</p>
        </div>
      ) : null}

      {(tab === 'inbox' || tab === 'sent' || tab === 'staffSent') && (
        <>
          {loading ? (
            <p>A carregar…</p>
          ) : !rows || rows.length === 0 ? (
            <p className="staff-muted">Nenhum comunicado.</p>
          ) : (
            <ul className="staff-list">
              {rows.map((r) => {
                const id = num(r.id);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className="portal-offer-head"
                      onClick={() => void openDetail(id)}
                    >
                      <span>
                        <strong>{str(r.subject) || '(sem assunto)'}</strong>
                        <div className="staff-muted" style={{ fontSize: '0.85rem' }}>
                          {str(r.created_at)?.slice(0, 16)?.replace('T', ' ')}
                          {tab === 'inbox' && !r.read_at ? ' · não lido' : ''}
                        </div>
                      </span>
                      <span>▶</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {detailLoading ? <p>A abrir…</p> : null}
          {detail ? (
            <div className="portal-details" style={{ marginTop: 16 }}>
              <h4 style={{ marginTop: 0 }}>{str(detail.subject)}</h4>
              <p style={{ whiteSpace: 'pre-wrap' }}>{str(detail.body)}</p>
              <p className="staff-muted" style={{ fontSize: '0.85rem' }}>
                De:{' '}
                {detail.from_staff_role
                  ? labelPt(str(detail.from_staff_role))
                  : `${str(detail.from_tower)} ${str(detail.from_number)}`}
                {' · '}
                Para: {str(detail.to_tower)} {str(detail.to_number)}
              </p>
              <button type="button" className="portal-btn" onClick={() => setDetail(null)}>
                Fechar
              </button>
            </div>
          ) : null}
        </>
      )}

      {(tab === 'composeR' || tab === 'composeS') && (
        <form className="portal-form" onSubmit={submitCompose}>
          <label>
            Unidade destino
            <select
              required
              value={toUnitId}
              onChange={(e) => setToUnitId(e.target.value)}
            >
              <option value="">—</option>
              {(units ?? []).map((u) => {
                const uid = num(u.id);
                if (tab === 'composeR' && session.unitId != null && uid === session.unitId) {
                  return null;
                }
                return (
                  <option key={uid} value={uid}>
                    {str(u.tower)} {str(u.number)} (#{uid})
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            Assunto
            <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </label>
          <label>
            Mensagem
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} required />
          </label>
          <button type="submit" className="portal-btn portal-btn--primary" disabled={sending}>
            {sending ? 'A enviar…' : 'Enviar'}
          </button>
        </form>
      )}
    </StaffLayout>
  );
}

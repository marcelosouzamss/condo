import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isBillingStaff, labelPt, picksCondoBeforeContact } from '../condoUserRoles';
import {
  createAgendaEvent,
  deleteAgendaEvent,
  getAgendaEventsCalendar,
  patchAgendaEvent,
  type AgendaEventRow,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const MESES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoFromYmd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function dateOnlyLocal(raw: unknown): { y: number; m: number; d: number } {
  const dt = new Date(String(raw));
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
}

function addDaysDate(y: number, m: number, d: number, delta: number): { y: number; m: number; d: number } {
  const x = new Date(y, m - 1, d + delta);
  return { y: x.getFullYear(), m: x.getMonth() + 1, d: x.getDate() };
}

/** Compara apenas ordem cronológica (datas de calendário). */
function dateKeyCompare(a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }): number {
  if (a.y !== b.y) {
    return a.y - b.y;
  }
  if (a.m !== b.m) {
    return a.m - b.m;
  }
  return a.d - b.d;
}

function eventsByDayInMonth(events: AgendaEventRow[], y: number, m: number): Map<string, AgendaEventRow[]> {
  const map = new Map<string, AgendaEventRow[]>();
  for (const e of events) {
    const start = dateOnlyLocal(e.event_date ?? e.eventDate);
    const endRaw = e.event_end ?? e.eventEnd;
    const end = endRaw != null ? dateOnlyLocal(endRaw) : start;
    let cur = start;
    for (;;) {
      if (cur.y === y && cur.m === m) {
        const key = isoFromYmd(cur.y, cur.m, cur.d);
        const list = map.get(key) ?? [];
        list.push(e);
        map.set(key, list);
      }
      if (dateKeyCompare(cur, end) >= 0) {
        break;
      }
      cur = addDaysDate(cur.y, cur.m, cur.d, 1);
    }
  }
  for (const [, arr] of map) {
    arr.sort((a, b) =>
      String(a.event_date ?? a.eventDate).localeCompare(String(b.event_date ?? b.eventDate)),
    );
  }
  return map;
}

function fmtDateTimePt(raw: unknown): string {
  if (raw == null) {
    return '';
  }
  const dt = new Date(String(raw));
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

function toDatetimeLocalValue(iso: string): string {
  const dt = new Date(iso);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}T${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

export function EventsCalendarPage() {
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

  const canManage = session ? isBillingStaff(session.role) : false;

  const now = new Date();
  const [viewY, setViewY] = useState(now.getFullYear());
  const [viewM, setViewM] = useState(now.getMonth() + 1);

  const [events, setEvents] = useState<AgendaEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [dayModal, setDayModal] = useState<{ iso: string; rows: AgendaEventRow[] } | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AgendaEventRow | null>(null);
  const [evTitle, setEvTitle] = useState('');
  const [evDesc, setEvDesc] = useState('');
  const [evLoc, setEvLoc] = useState('');
  const [evVis, setEvVis] = useState<'public' | 'private'>('public');
  const [evStart, setEvStart] = useState('');
  const [evUseEnd, setEvUseEnd] = useState(false);
  const [evEnd, setEvEnd] = useState('');
  const [evSaving, setEvSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const res = await getAgendaEventsCalendar(effectiveCondoId, session.id, viewY, viewM);
      setEvents(res.events ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId, viewY, viewM]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const byDay = useMemo(() => eventsByDayInMonth(events, viewY, viewM), [events, viewY, viewM]);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewY, viewM - 1 + delta, 1);
    setViewY(d.getFullYear());
    setViewM(d.getMonth() + 1);
  };

  const openDay = (iso: string) => {
    setDayModal({ iso, rows: byDay.get(iso) ?? [] });
  };

  const openCreate = (preferredIso?: string) => {
    if (!session) {
      return;
    }
    setEditing(null);
    setEvTitle('');
    setEvDesc('');
    setEvLoc('');
    setEvVis('public');
    if (preferredIso && /^\d{4}-\d{2}-\d{2}$/.test(preferredIso)) {
      setEvStart(`${preferredIso}T10:00`);
    } else {
      const dt = new Date();
      setEvStart(
        `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}T10:00`,
      );
    }
    setEvUseEnd(false);
    setEvEnd('');
    setEditorOpen(true);
    setDayModal(null);
  };

  const openEdit = (row: AgendaEventRow) => {
    setEditing(row);
    setEvTitle(str(row.title));
    setEvDesc(str(row.description));
    setEvLoc(str(row.location));
    setEvVis(str(row.visibility).toLowerCase() === 'private' ? 'private' : 'public');
    const sd = row.event_date ?? row.eventDate;
    setEvStart(sd ? toDatetimeLocalValue(String(sd)) : '');
    const en = row.event_end ?? row.eventEnd;
    if (en != null && String(en).trim() !== '') {
      setEvUseEnd(true);
      setEvEnd(toDatetimeLocalValue(String(en)));
    } else {
      setEvUseEnd(false);
      setEvEnd('');
    }
    setEditorOpen(true);
    setDayModal(null);
  };

  const submitEvent = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const title = evTitle.trim();
    if (!title) {
      window.alert('Informe o título do evento.');
      return;
    }
    const start = new Date(evStart);
    if (Number.isNaN(start.getTime())) {
      window.alert('Data/hora de início inválida.');
      return;
    }

    let endIsoSent: string | null = null;
    if (evUseEnd) {
      const en = new Date(evEnd);
      if (Number.isNaN(en.getTime())) {
        window.alert('Data/hora de término inválida.');
        return;
      }
      endIsoSent = en.toISOString();
    }

    setEvSaving(true);
    try {
      const base = {
        condoId: effectiveCondoId,
        userId: session.id,
        title,
        description: evDesc.trim() || null,
        location: evLoc.trim() || null,
        visibility: evVis,
        eventDate: start.toISOString(),
      };

      if (editing) {
        const id = Number.parseInt(String(editing.id), 10);
        await patchAgendaEvent(id, {
          ...base,
          eventEnd: evUseEnd ? endIsoSent : null,
        });
      } else {
        await createAgendaEvent({
          ...base,
          ...(evUseEnd && endIsoSent ? { eventEnd: endIsoSent } : {}),
        });
      }
      setEditorOpen(false);
      await reload();
      window.alert(editing ? 'Evento atualizado.' : 'Evento criado.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao guardar.');
    } finally {
      setEvSaving(false);
    }
  };

  const onDeleteEvent = async (row: AgendaEventRow) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const id = Number.parseInt(String(row.id), 10);
    const tit = str(row.title);
    if (!window.confirm(`Remover «${tit}»?`)) {
      return;
    }
    try {
      await deleteAgendaEvent(id, effectiveCondoId, session.id);
      await reload();
      window.alert('Evento removido.');
      setDayModal(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  };

  const first = new Date(viewY, viewM - 1, 1);
  const lead = first.getDay();
  const lastDay = daysInMonth(viewY, viewM);
  const rowCount = Math.ceil((lead + lastDay) / 7);
  const cellCount = rowCount * 7;

  const today = new Date();
  const isTodayCell = (day: number) =>
    today.getFullYear() === viewY && today.getMonth() + 1 === viewM && today.getDate() === day;

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Calendário de eventos" backTo="/app">
      <div className="staff-hero">
        <h2>Agenda do condomínio</h2>
        <p className="staff-muted">
          API `GET /api/agenda/events?view=calendar` — eventos privados apenas para síndico e administração.
        </p>
      </div>

      <div className="portal-inline" style={{ marginBottom: 12 }}>
        <button type="button" className="portal-btn" onClick={() => void reload()} disabled={loading}>
          Atualizar
        </button>
        {canManage ? (
          <button type="button" className="portal-btn portal-btn--primary" onClick={() => openCreate()}>
            Novo evento
          </button>
        ) : null}
        {picksCondoBeforeContact(session.role) ? (
          <span className="staff-muted">
            Condomínio: {effectiveCondoId} · {labelPt(session.role)}
          </span>
        ) : null}
      </div>

      {effectiveCondoId < 1 ? (
        <p className="staff-error">Selecione um condomínio válido (query condoId).</p>
      ) : null}

      {err ? <p className="staff-error">{err}</p> : null}

      <div className="portal-inline" style={{ alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button type="button" className="portal-btn" onClick={() => shiftMonth(-1)} disabled={loading}>
          ◀ Mês anterior
        </button>
        <strong style={{ minWidth: 200, textAlign: 'center' }}>
          {MESES_PT[viewM - 1]} {viewY}
        </strong>
        <button type="button" className="portal-btn" onClick={() => shiftMonth(1)} disabled={loading}>
          Próximo mês ▶
        </button>
      </div>

      {loading && events.length === 0 ? (
        <p>A carregar…</p>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 6,
              marginBottom: 8,
              textAlign: 'center',
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            {WEEKDAYS.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 6,
            }}
          >
            {Array.from({ length: cellCount }, (_, index) => {
              if (index < lead || index >= lead + lastDay) {
                return <div key={index} style={{ minHeight: 76 }} />;
              }
              const day = index - lead + 1;
              const iso = isoFromYmd(viewY, viewM, day);
              const dayEv = byDay.get(iso) ?? [];
              const has = dayEv.length > 0;

              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => openDay(iso)}
                  disabled={loading}
                  style={{
                    minHeight: 76,
                    textAlign: 'left',
                    padding: 6,
                    borderRadius: 10,
                    border: isTodayCell(day)
                      ? '2px solid var(--portal-accent, #2563eb)'
                      : '1px solid rgba(0,0,0,0.12)',
                    background: has ? 'rgba(37,99,235,0.08)' : 'rgba(0,0,0,0.03)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 800, color: isTodayCell(day) ? 'var(--portal-accent,#2563eb)' : undefined }}>
                      {day}
                    </span>
                    {has ? (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          background: 'rgba(37,99,235,0.2)',
                          borderRadius: 8,
                          padding: '2px 6px',
                        }}
                      >
                        {dayEv.length}
                      </span>
                    ) : null}
                  </div>
                  {has ? (
                    <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.25 }}>
                      {dayEv.slice(0, 2).map((e) => (
                        <div key={String(e.id)} style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {str(e.title)}
                        </div>
                      ))}
                      {dayEv.length > 2 ? <div className="staff-muted">+{dayEv.length - 2}</div> : null}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      )}

      {dayModal ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 480 }}>
            <h3>{dayModal.iso}</h3>
            {dayModal.rows.length === 0 ? (
              <>
                <p>Nenhum evento neste dia.</p>
                {canManage ? (
                  <button type="button" className="portal-btn portal-btn--primary" onClick={() => openCreate(dayModal.iso)}>
                    Novo evento neste dia
                  </button>
                ) : null}
              </>
            ) : (
              <ul className="staff-list" style={{ maxHeight: 360, overflow: 'auto' }}>
                {dayModal.rows.map((e) => (
                  <li key={String(e.id)}>
                    <strong>{str(e.title)}</strong>
                    <div className="staff-muted">{fmtDateTimePt(e.event_date ?? e.eventDate)}</div>
                    {str(e.visibility).toLowerCase() === 'private' ? (
                      <span style={{ fontSize: 12 }}>[Privado]</span>
                    ) : null}
                    {str(e.location) ? <p>Local: {str(e.location)}</p> : null}
                    {str(e.description) ? <p>{str(e.description)}</p> : null}
                    {canManage ? (
                      <div className="portal-charge-actions" style={{ marginTop: 10 }}>
                        <button type="button" className="portal-btn" onClick={() => openEdit(e)}>
                          Editar
                        </button>
                        <button type="button" className="portal-link-danger" onClick={() => void onDeleteEvent(e)}>
                          Excluir
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {dayModal.rows.length > 0 && canManage ? (
              <button
                type="button"
                style={{ marginTop: 16 }}
                className="portal-btn portal-btn--primary"
                onClick={() => openCreate(dayModal.iso)}
              >
                Novo evento neste dia
              </button>
            ) : null}
            <button type="button" className="portal-btn" style={{ marginTop: 12 }} onClick={() => setDayModal(null)}>
              Fechar
            </button>
          </div>
        </div>
      ) : null}

      {editorOpen ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 520 }}>
            <h3>{editing ? 'Editar evento' : 'Novo evento'}</h3>
            <form onSubmit={(e) => void submitEvent(e)}>
              <label>
                Título *
                <input
                  className="portal-input"
                  required
                  value={evTitle}
                  onChange={(e) => setEvTitle(e.target.value)}
                />
              </label>
              <label>
                Descrição
                <textarea className="portal-input" rows={3} value={evDesc} onChange={(e) => setEvDesc(e.target.value)} />
              </label>
              <label>
                Local
                <input className="portal-input" value={evLoc} onChange={(e) => setEvLoc(e.target.value)} />
              </label>
              <label>
                Visibilidade
                <select
                  className="portal-input"
                  value={evVis}
                  onChange={(e) => setEvVis(e.target.value as 'public' | 'private')}
                >
                  <option value="public">Público (todos os moradores)</option>
                  <option value="private">Privado (síndico e administração)</option>
                </select>
              </label>
              <label>
                Início *
                <input
                  className="portal-input"
                  type="datetime-local"
                  required
                  value={evStart}
                  onChange={(e) => setEvStart(e.target.value)}
                />
              </label>
              <label className="staff-muted" style={{ display: 'flex', gap: 8 }}>
                <input type="checkbox" checked={evUseEnd} onChange={(e) => setEvUseEnd(e.target.checked)} />
                Definir término
              </label>
              {evUseEnd ? (
                <label>
                  Término
                  <input
                    className="portal-input"
                    type="datetime-local"
                    required={evUseEnd}
                    value={evEnd}
                    onChange={(e) => setEvEnd(e.target.value)}
                  />
                </label>
              ) : null}
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={evSaving}>
                  {evSaving ? '…' : editing ? 'Salvar' : 'Publicar'}
                </button>
                <button type="button" className="portal-btn" onClick={() => setEditorOpen(false)}>
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

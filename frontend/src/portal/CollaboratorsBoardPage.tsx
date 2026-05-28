import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { uploadsUrl } from '../api';
import {
  canManageCollaboratorsBoard,
  canViewCollaboratorScheduleTab,
  picksCondoBeforeContact,
} from '../condoUserRoles';
import {
  createCollaborator,
  createCollaboratorShifts,
  deleteCollaborator,
  deleteCollaboratorShift,
  listCollaboratorSchedule,
  listCollaborators,
  patchCollaborator,
  patchCollaboratorShift,
  type CollaboratorRow,
  type CollaboratorShiftRow,
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

const WEEKDAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

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

function isoMonthPrefix(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function isoDateLocal(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthTitlePt(d: Date): string {
  return `${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`;
}

function formatShiftDayPt(iso: string): string {
  const s = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return iso;
  }
  const [ys, ms, ds] = s.split('-');
  const y = Number.parseInt(ys, 10);
  const mo = Number.parseInt(ms, 10);
  const day = Number.parseInt(ds, 10);
  if (!Number.isFinite(y) || mo < 1 || mo > 12) {
    return iso;
  }
  return `${day} de ${MESES_PT[mo - 1]} de ${y}`;
}

function telHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const digits = trimmed.replace(/[^\d+]/g, '');
  return digits.length > 0 ? `tel:${digits}` : null;
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (a + b).toUpperCase() || '?';
}

function CollabFaceCircle({ photo, name }: { photo: string; name: string }) {
  const [imgErr, setImgErr] = useState(false);
  const trimmed = photo.trim();
  const showImg = trimmed !== '' && !imgErr;
  const inner: ReactNode = showImg ? (
    <img
      src={uploadsUrl(trimmed)}
      alt=""
      width={52}
      height={52}
      style={{ objectFit: 'cover', width: '100%', height: '100%' }}
      onError={() => setImgErr(true)}
    />
  ) : (
    <span>{initialsFromName(name)}</span>
  );
  return (
    <div
      style={{
        width: 52,
        height: 52,
        borderRadius: '50%',
        overflow: 'hidden',
        flexShrink: 0,
        background: 'color-mix(in srgb, var(--primary) 35%, transparent)',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 800,
        color: '#fff',
      }}
    >
      {inner}
    </div>
  );
}

export function CollaboratorsBoardPage() {
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

  const canManage = session ? canManageCollaboratorsBoard(session.role) : false;
  const showScheduleTab = session ? canViewCollaboratorScheduleTab(session.role) : false;

  const [mainTab, setMainTab] = useState<'people' | 'schedule'>('people');
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [people, setPeople] = useState<CollaboratorRow[] | null>(null);
  const [shifts, setShifts] = useState<CollaboratorShiftRow[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [peopleErr, setPeopleErr] = useState<string | null>(null);
  const [shiftsErr, setShiftsErr] = useState<string | null>(null);

  const [collabModal, setCollabModal] = useState(false);
  const [editingCollab, setEditingCollab] = useState<CollaboratorRow | null>(null);
  const [collabSaving, setCollabSaving] = useState(false);
  const [fName, setFName] = useState('');
  const [fJob, setFJob] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fPhoto, setFPhoto] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [fOrder, setFOrder] = useState('0');
  const [fActive, setFActive] = useState(true);

  const [shiftModal, setShiftModal] = useState(false);
  const [editingShift, setEditingShift] = useState<CollaboratorShiftRow | null>(null);
  const [shiftSaving, setShiftSaving] = useState(false);
  const [shiftCollabId, setShiftCollabId] = useState(0);
  const [shiftDate, setShiftDate] = useState('');
  const [shiftStart, setShiftStart] = useState('');
  const [shiftEnd, setShiftEnd] = useState('');
  const [shiftNotes, setShiftNotes] = useState('');
  const [shiftOrder, setShiftOrder] = useState('0');

  const loadPeople = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      setPeople([]);
      setLoadingPeople(false);
      return;
    }
    setPeopleErr(null);
    setLoadingPeople(true);
    try {
      const list = await listCollaborators(effectiveCondoId, session.id, canManage);
      setPeople(list);
    } catch (e) {
      setPeopleErr(e instanceof Error ? e.message : 'Erro ao carregar colaboradores.');
      setPeople(null);
    } finally {
      setLoadingPeople(false);
    }
  }, [session, effectiveCondoId, canManage]);

  const loadShifts = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      setShifts([]);
      return;
    }
    setShiftsErr(null);
    setLoadingShifts(true);
    try {
      const rows = await listCollaboratorSchedule(effectiveCondoId, session.id);
      setShifts(rows);
    } catch (e) {
      setShiftsErr(e instanceof Error ? e.message : 'Erro ao carregar escala.');
      setShifts([]);
    } finally {
      setLoadingShifts(false);
    }
  }, [session, effectiveCondoId]);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  useEffect(() => {
    if (mainTab === 'schedule' && showScheduleTab) {
      void loadShifts();
    }
  }, [mainTab, showScheduleTab, loadShifts]);

  const shiftsInMonth = useMemo(() => {
    const prefix = isoMonthPrefix(calMonth);
    return shifts.filter((s) => str(s.shift_date).startsWith(prefix));
  }, [shifts, calMonth]);

  const shiftsByDate = useMemo(() => {
    const m = new Map<string, CollaboratorShiftRow[]>();
    for (const s of shiftsInMonth) {
      const k = str(s.shift_date).slice(0, 10);
      if (!m.has(k)) {
        m.set(k, []);
      }
      m.get(k)!.push(s);
    }
    const keys = [...m.keys()].sort();
    return keys.map((k) => ({ date: k, rows: m.get(k) ?? [] }));
  }, [shiftsInMonth]);

  const shiftsByDateMap = useMemo(() => {
    const m = new Map<string, CollaboratorShiftRow[]>();
    for (const s of shiftsInMonth) {
      const k = str(s.shift_date).slice(0, 10);
      const arr = m.get(k) ?? [];
      arr.push(s);
      m.set(k, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const at = `${str(a.time_start)} ${str(a.collaborator_name)}`;
        const bt = `${str(b.time_start)} ${str(b.collaborator_name)}`;
        return at.localeCompare(bt, 'pt-BR');
      });
    }
    return m;
  }, [shiftsInMonth]);

  const calendarCells = useMemo(() => {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const cells: Array<{
      iso: string | null;
      day: number | null;
      rows: CollaboratorShiftRow[];
    }> = [];
    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push({ iso: null, day: null, rows: [] });
    }
    for (let day = 1; day <= lastDay; day += 1) {
      const iso = isoDateLocal(year, month, day);
      cells.push({ iso, day, rows: shiftsByDateMap.get(iso) ?? [] });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ iso: null, day: null, rows: [] });
    }
    return cells;
  }, [calMonth, shiftsByDateMap]);

  const openNewCollab = () => {
    setEditingCollab(null);
    setFName('');
    setFJob('');
    setFPhone('');
    setFEmail('');
    setFPhoto('');
    setFNotes('');
    setFOrder('0');
    setFActive(true);
    setCollabModal(true);
  };

  const openEditCollab = (row: CollaboratorRow) => {
    setEditingCollab(row);
    setFName(str(row.full_name));
    setFJob(str(row.job_title));
    setFPhone(str(row.phone));
    setFEmail(str(row.email));
    setFPhoto(str(row.photo_url));
    setFNotes(str(row.notes));
    setFOrder(String(row.sort_order ?? 0));
    setFActive(row.active !== false && str(row.active) !== 'false');
    setCollabModal(true);
  };

  const saveCollab = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const fullName = fName.trim();
    const jobTitle = fJob.trim();
    if (!fullName || !jobTitle) {
      window.alert('Nome completo e função são obrigatórios.');
      return;
    }
    const sortOrder = Number.parseInt(fOrder.trim(), 10);
    if (!Number.isFinite(sortOrder)) {
      window.alert('Ordem inválida.');
      return;
    }

    const base = {
      condoId: effectiveCondoId,
      userId: session.id,
      fullName,
      jobTitle,
      phone: fPhone.trim() || null,
      email: fEmail.trim() || null,
      photoUrl: fPhoto.trim() || null,
      notes: fNotes.trim() || null,
      sortOrder,
    };

    setCollabSaving(true);
    try {
      const id = num(editingCollab?.id);
      if (id > 0) {
        await patchCollaborator(id, { ...base, active: fActive });
      } else {
        await createCollaborator(base);
      }
      setCollabModal(false);
      await loadPeople();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao guardar.');
    } finally {
      setCollabSaving(false);
    }
  };

  const onDeleteCollab = async (row: CollaboratorRow) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const id = num(row.id);
    if (id < 1 || !window.confirm(`Remover ${str(row.full_name)} do quadro?`)) {
      return;
    }
    try {
      await deleteCollaborator(id, effectiveCondoId, session.id);
      await loadPeople();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  };

  const openNewShift = (dateOverride?: string) => {
    const all = people ?? [];
    const actives = all.filter((p) => p.active !== false);
    const pickList = actives.length > 0 ? actives : all;
    if (pickList.length === 0) {
      window.alert('Cadastre pelo menos um colaborador antes de criar turnos.');
      return;
    }
    setEditingShift(null);
    const first = num((pickList[0]?.id ?? 0) as unknown);
    setShiftCollabId(first > 0 ? first : 0);
    setShiftDate(dateOverride ?? new Date().toISOString().slice(0, 10));
    setShiftStart('');
    setShiftEnd('');
    setShiftNotes('');
    setShiftOrder('0');
    setShiftModal(true);
  };

  const openEditShift = (s: CollaboratorShiftRow) => {
    setEditingShift(s);
    setShiftCollabId(num(s.collaborator_id));
    setShiftDate(str(s.shift_date).slice(0, 10));
    const ts = str(s.time_start);
    const te = str(s.time_end);
    setShiftStart(ts.length >= 5 ? ts.slice(0, 5) : ts);
    setShiftEnd(te.length >= 5 ? te.slice(0, 5) : te);
    setShiftNotes(str(s.notes));
    setShiftOrder(String(s.sort_order ?? 0));
    setShiftModal(true);
  };

  const saveShift = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1) {
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) {
      window.alert('Data inválida (use AAAA-MM-DD).');
      return;
    }
    const sortOrder = Number.parseInt(shiftOrder.trim(), 10);
    if (!Number.isFinite(sortOrder)) {
      window.alert('Ordem inválida.');
      return;
    }
    const tStart = shiftStart.trim() === '' ? null : shiftStart.trim();
    const tEnd = shiftEnd.trim() === '' ? null : shiftEnd.trim();

    setShiftSaving(true);
    try {
      const sid = num(editingShift?.id);
      if (sid > 0) {
        await patchCollaboratorShift(sid, {
          condoId: effectiveCondoId,
          userId: session.id,
          collaboratorId: shiftCollabId,
          shiftDate,
          timeStart: tStart,
          timeEnd: tEnd,
          notes: shiftNotes.trim() || null,
          sortOrder,
        });
      } else {
        await createCollaboratorShifts({
          condoId: effectiveCondoId,
          userId: session.id,
          collaboratorId: shiftCollabId,
          shiftDates: [shiftDate],
          timeStart: tStart,
          timeEnd: tEnd,
          notes: shiftNotes.trim() || null,
          sortOrder,
        });
      }
      setShiftModal(false);
      await loadShifts();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao guardar escala.');
    } finally {
      setShiftSaving(false);
    }
  };

  const onDeleteShift = async (s: CollaboratorShiftRow) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const id = num(s.id);
    if (
      id < 1 ||
      !window.confirm('Remover esta entrada da escala?')
    ) {
      return;
    }
    try {
      await deleteCollaboratorShift(id, effectiveCondoId, session.id);
      await loadShifts();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  };

  const shiftMonth = (delta: number) => {
    setCalMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  };

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Quadro de colaboradores">
      <p className="staff-section-desc" style={{ marginTop: 0 }}>
        Lista de colaboradores do condomínio. Gestão e alteração da escala: síndico e administração. Colaboradores
        podem apenas consultar a escala.
      </p>

      {effectiveCondoId < 1 ? (
        <p className="staff-muted">
          Associe ou escolha um condomínio (perfil sem condomínio válido selecionado).
        </p>
      ) : null}

      <div className="portal-inline" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className={`portal-btn ${mainTab === 'people' ? 'portal-btn--primary' : ''}`}
          onClick={() => setMainTab('people')}
        >
          Colaboradores
        </button>
        {showScheduleTab ? (
          <button
            type="button"
            className={`portal-btn ${mainTab === 'schedule' ? 'portal-btn--primary' : ''}`}
            onClick={() => setMainTab('schedule')}
          >
            Escala
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        <button type="button" className="portal-btn" onClick={() => void loadPeople()}>
          Atualizar quadro
        </button>
        {mainTab === 'schedule' && showScheduleTab ? (
          <button type="button" className="portal-btn" onClick={() => void loadShifts()}>
            Atualizar escala
          </button>
        ) : null}
      </div>

      {mainTab === 'people' ? (
        <>
          {peopleErr ? (
            <p className="staff-muted" role="alert">
              {peopleErr}
            </p>
          ) : null}
          <div className="portal-inline" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {canManage ? (
              <button type="button" className="portal-btn portal-btn--primary" onClick={openNewCollab}>
                Novo colaborador
              </button>
            ) : null}
          </div>
          {loadingPeople ? <p className="staff-muted">A carregar…</p> : null}
          {!loadingPeople && !peopleErr && (people ?? []).length === 0 ? (
            <p className="staff-muted">Sem colaboradores cadastrados.</p>
          ) : null}

          {!loadingPeople && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {(people ?? []).map((row) => {
                const id = num(row.id);
                const pname = str(row.full_name);
                const job = str(row.job_title);
                const photo = str(row.photo_url);
                const phone = str(row.phone);
                const phoneL = telHref(phone);
                const inactive =
                  row.active === false || row.active === 0 || str(row.active) === 'false';
                const email = str(row.email);
                return (
                  <li key={id} className="portal-details" style={{ marginBottom: 14 }}>
                    <div className="portal-inline" style={{ alignItems: 'flex-start', gap: 14 }}>
                      <CollabFaceCircle photo={photo} name={pname} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong>{pname}</strong>
                        <div className="staff-muted" style={{ fontSize: '0.9rem', marginTop: 2 }}>
                          {job}
                          {inactive ? ' · Inativo' : ''}
                        </div>
                        {phone ? (
                          <div style={{ marginTop: 8, fontSize: '0.92rem' }}>
                            {phoneL ? <a href={phoneL}>{phone}</a> : phone}
                          </div>
                        ) : null}
                        {email ? (
                          <div style={{ marginTop: 4, fontSize: '0.92rem' }}>
                            <a href={`mailto:${email}`}>{email}</a>
                          </div>
                        ) : null}
                        {str(row.notes) ? (
                          <p style={{ margin: '10px 0 0', lineHeight: 1.45 }}>{str(row.notes)}</p>
                        ) : null}
                      </div>
                    </div>
                    {canManage ? (
                      <div className="portal-charge-actions" style={{ marginTop: 12 }}>
                        <button type="button" className="portal-btn" onClick={() => openEditCollab(row)}>
                          Editar
                        </button>
                        <button type="button" className="portal-link-danger" onClick={() => void onDeleteCollab(row)}>
                          Excluir
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}

      {mainTab === 'schedule' && showScheduleTab ? (
        <>
          {shiftsErr ? (
            <p className="staff-muted" role="alert">
              {shiftsErr}
            </p>
          ) : null}
          <div className="portal-inline" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
            <button type="button" className="portal-btn" onClick={() => shiftMonth(-1)}>
              « Anterior
            </button>
            <strong style={{ flex: '1 1 160px', textAlign: 'center' }}>{monthTitlePt(calMonth)}</strong>
            <button type="button" className="portal-btn" onClick={() => shiftMonth(1)}>
              Seguinte »
            </button>
          </div>
          {canManage ? (
            <button type="button" className="portal-btn portal-btn--primary" style={{ marginBottom: 16 }} onClick={() => openNewShift()}>
              Novo turno
            </button>
          ) : null}
          {loadingShifts ? <p className="staff-muted">A carregar escala…</p> : null}
          {!loadingShifts && !shiftsErr ? (
            <section style={{ marginBottom: 24 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                  border: '1px solid var(--border)',
                  borderRadius: 16,
                  overflow: 'hidden',
                  background: 'var(--surface)',
                }}
              >
                {WEEKDAYS_PT.map((day) => (
                  <div
                    key={day}
                    style={{
                      padding: '10px 8px',
                      textAlign: 'center',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      color: 'var(--muted)',
                      background: 'color-mix(in srgb, var(--primary) 9%, transparent)',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {day}
                  </div>
                ))}
                {calendarCells.map((cell, idx) => {
                  const isToday = cell.iso === new Date().toISOString().slice(0, 10);
                  return (
                    <div
                      key={cell.iso ?? `blank-${idx}`}
                      style={{
                        minHeight: 118,
                        padding: 8,
                        borderRight: idx % 7 === 6 ? 'none' : '1px solid var(--border)',
                        borderBottom:
                          idx >= calendarCells.length - 7 ? 'none' : '1px solid var(--border)',
                        background: cell.iso
                          ? isToday
                            ? 'color-mix(in srgb, var(--primary) 8%, var(--surface))'
                            : 'var(--surface)'
                          : 'color-mix(in srgb, var(--muted) 6%, transparent)',
                      }}
                    >
                      {cell.iso ? (
                        <>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 6,
                              marginBottom: 6,
                            }}
                          >
                            <strong
                              style={{
                                display: 'inline-grid',
                                placeItems: 'center',
                                minWidth: 24,
                                height: 24,
                                borderRadius: 999,
                                background: isToday ? 'var(--primary)' : 'transparent',
                                color: isToday ? '#fff' : 'var(--text)',
                                fontSize: '0.86rem',
                              }}
                            >
                              {cell.day}
                            </strong>
                            {canManage ? (
                              <button
                                type="button"
                                className="portal-btn portal-btn--small"
                                style={{ padding: '3px 7px', fontSize: '0.72rem' }}
                                onClick={() => openNewShift(cell.iso!)}
                              >
                                +
                              </button>
                            ) : null}
                          </div>
                          <div style={{ display: 'grid', gap: 6 }}>
                            {cell.rows.map((s) => {
                              const sid = num(s.id);
                              const ts = str(s.time_start);
                              const te = str(s.time_end);
                              const line =
                                ts || te ? `${ts || '—'}-${te || '—'}` : 'Sem horário';
                              return (
                                <button
                                  key={sid}
                                  type="button"
                                  onClick={canManage ? () => openEditShift(s) : undefined}
                                  style={{
                                    border: '1px solid color-mix(in srgb, var(--primary) 28%, var(--border))',
                                    borderRadius: 10,
                                    padding: '6px 7px',
                                    textAlign: 'left',
                                    background:
                                      'color-mix(in srgb, var(--primary) 10%, var(--surface))',
                                    color: 'var(--text)',
                                    cursor: canManage ? 'pointer' : 'default',
                                  }}
                                  title={`${str(s.collaborator_name)} · ${line}`}
                                >
                                  <span
                                    style={{
                                      display: 'block',
                                      fontSize: '0.75rem',
                                      fontWeight: 800,
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {str(s.collaborator_name)}
                                  </span>
                                  <span
                                    style={{
                                      display: 'block',
                                      fontSize: '0.68rem',
                                      color: 'var(--muted)',
                                      marginTop: 2,
                                    }}
                                  >
                                    {line}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
          {!loadingShifts &&
            shiftsByDate.map(({ date, rows }) => (
              <section key={date} style={{ marginBottom: 20 }}>
                <h2 className="staff-section-title" style={{ fontSize: '1.05rem' }}>
                  {formatShiftDayPt(date)}
                </h2>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {rows.map((s) => {
                    const sid = num(s.id);
                    const cname = str(s.collaborator_name);
                    const cjob = str(s.collaborator_job_title);
                    const ts = str(s.time_start);
                    const te = str(s.time_end);
                    return (
                      <li key={sid} className="portal-details" style={{ marginBottom: 8 }}>
                        <div>
                          <strong>{cname}</strong>
                          <span className="staff-muted"> — {cjob}</span>
                          <div style={{ marginTop: 6, fontSize: '0.92rem' }}>
                            {ts || te ? (
                              <>
                                <span>
                                  {ts || '—'} – {te || '—'}
                                </span>
                              </>
                            ) : (
                              <span className="staff-muted">Horário não informado</span>
                            )}
                          </div>
                          {str(s.notes) ? <p style={{ margin: '8px 0 0', lineHeight: 1.45 }}>{str(s.notes)}</p> : null}
                        </div>
                        {canManage ? (
                          <div className="portal-charge-actions" style={{ marginTop: 10 }}>
                            <button type="button" className="portal-btn" onClick={() => openEditShift(s)}>
                              Editar
                            </button>
                            <button type="button" className="portal-link-danger" onClick={() => void onDeleteShift(s)}>
                              Excluir
                            </button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          {!loadingShifts && shiftsByDate.length === 0 && !shiftsErr ? (
            <p className="staff-muted">Sem turnos neste mês.</p>
          ) : null}
        </>
      ) : null}

      {collabModal && canManage ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 480 }}>
            <h3>{editingCollab ? 'Editar colaborador' : 'Novo colaborador'}</h3>
            <form className="portal-form" onSubmit={(e) => void saveCollab(e)}>
              <label>
                Nome completo *
                <input className="portal-input" required value={fName} onChange={(e) => setFName(e.target.value)} />
              </label>
              <label>
                Função / cargo *
                <input className="portal-input" required value={fJob} onChange={(e) => setFJob(e.target.value)} />
              </label>
              <label>
                Telefone
                <input className="portal-input" type="tel" value={fPhone} onChange={(e) => setFPhone(e.target.value)} />
              </label>
              <label>
                E-mail
                <input className="portal-input" type="email" value={fEmail} onChange={(e) => setFEmail(e.target.value)} />
              </label>
              <label>
                Caminho da foto (upload guardado sob /uploads, como no app móvel)
                <input className="portal-input" value={fPhoto} onChange={(e) => setFPhoto(e.target.value)} />
              </label>
              <label>
                Observações
                <textarea className="portal-input" rows={2} value={fNotes} onChange={(e) => setFNotes(e.target.value)} />
              </label>
              <label>
                Ordem na lista
                <input className="portal-input" inputMode="numeric" value={fOrder} onChange={(e) => setFOrder(e.target.value)} />
              </label>
              {editingCollab ? (
                <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={fActive} onChange={(e) => setFActive(e.target.checked)} />
                  Ativo na lista pública
                </label>
              ) : null}
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={collabSaving}>
                  Guardar
                </button>
                <button type="button" className="portal-btn" onClick={() => setCollabModal(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {shiftModal && canManage ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 480 }}>
            <h3>{editingShift ? 'Editar turno' : 'Novo turno'}</h3>
            <form className="portal-form" onSubmit={(e) => void saveShift(e)}>
              <label>
                Colaborador *
                <select
                  className="portal-input"
                  value={shiftCollabId || ''}
                  required
                  onChange={(e) => setShiftCollabId(Number.parseInt(e.target.value, 10))}
                >
                  {(people ?? []).map((p) => (
                    <option key={num(p.id)} value={num(p.id)}>
                      {str(p.full_name)}
                      {p.active === false ? ' (inativo)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Data *
                <input className="portal-input" type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} required />
              </label>
              <label>
                Início
                <input className="portal-input" type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
              </label>
              <label>
                Fim
                <input className="portal-input" type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
              </label>
              <label>
                Notas
                <textarea className="portal-input" rows={2} value={shiftNotes} onChange={(e) => setShiftNotes(e.target.value)} />
              </label>
              <label>
                Ordem
                <input className="portal-input" inputMode="numeric" value={shiftOrder} onChange={(e) => setShiftOrder(e.target.value)} />
              </label>
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={shiftSaving}>
                  Guardar
                </button>
                <button type="button" className="portal-btn" onClick={() => setShiftModal(false)}>
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

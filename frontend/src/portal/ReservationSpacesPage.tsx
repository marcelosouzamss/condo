import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  canManageReservationSpaces,
  isBillingStaff,
  picksCondoBeforeContact,
} from '../condoUserRoles';
import { uploadsUrl } from '../api';
import {
  cancelSpaceReservation,
  createSpaceReservation,
  createReservationSpace,
  deleteReservationSpace,
  getReservationSpaceCalendar,
  listReservationSpaces,
  listMySpaceReservations,
  listPendingReservationApprovals,
  patchReservationApproval,
  updateReservationSpace,
  uploadReservationSpacePhoto,
  type CalendarDayCell,
  type ReservationSpaceRow,
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

function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

const WK = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MAX_SPACE_PHOTOS = 8;

function photoUrlsFromSpace(s: ReservationSpaceRow): string[] {
  const raw = s.photo_urls;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((u) => str(u).trim())
    .filter((u) => u.startsWith('/uploads/'));
}

function ReservationSpaceTile({
  space,
  onClick,
}: {
  space: ReservationSpaceRow;
  onClick: () => void;
}) {
  const name = str(space.name);
  const photos = photoUrlsFromSpace(space);
  const thumb = photos[0];
  return (
    <button type="button" className="resv-space-tile" onClick={onClick}>
      {thumb ? (
        <img className="resv-space-tile__img" src={uploadsUrl(thumb)} alt="" />
      ) : (
        <div className="resv-space-tile__img resv-space-tile__img--empty" aria-hidden>
          📍
        </div>
      )}
      <span className="resv-space-tile__name">{name}</span>
    </button>
  );
}

type PhotoEntry =
  | { kind: 'url'; url: string }
  | { kind: 'file'; file: File; preview: string };

function CalendarGrid({
  year,
  month,
  cal,
  calLoading,
  staffView,
  canBook,
  bookingBusy,
  onBookDay,
}: {
  year: number;
  month: number;
  cal: CalendarDayCell[] | null;
  calLoading: boolean;
  staffView: boolean;
  canBook: boolean;
  bookingBusy: boolean;
  onBookDay: (date: string) => void;
}) {
  const calendarCells = useMemo(() => {
    if (!cal || cal.length === 0) {
      return [];
    }
    const pad = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const padCells: (CalendarDayCell | null)[] = Array(pad).fill(null);
    return [...padCells, ...cal];
  }, [cal, year, month]);

  const weeks = useMemo(() => {
    const rows: (typeof calendarCells)[] = [];
    for (let i = 0; i < calendarCells.length; i += 7) {
      rows.push(calendarCells.slice(i, i + 7));
    }
    return rows;
  }, [calendarCells]);

  if (calLoading || !cal) {
    return <p>A carregar calendário…</p>;
  }

  return (
    <div className={`resv-cal${staffView ? ' resv-cal--staff' : ''}`}>
      <div className="resv-cal__wk">
        {WK.map((d) => (
          <div key={d} className="resv-cal__wkh">
            {d}
          </div>
        ))}
      </div>
      {weeks.map((row, wi) => (
        <div key={wi} className="resv-cal__row">
          {row.map((cell, ci) => (
            <div key={ci} className="resv-cal__cell-wrap">
              {cell == null ? (
                <div className="resv-cal__cell resv-cal__cell--empty" />
              ) : staffView && (cell.bookings?.length ?? 0) > 0 ? (
                <div
                  title={cell.date}
                  className={`resv-cal__cell resv-cal__cell--staff resv-cal__cell--${cell.cell}`}
                >
                  <span className="resv-cal__day-num">{cell.date.slice(8)}</span>
                  {(cell.bookings ?? []).slice(0, 3).map((b) => (
                    <span key={b.id} className="resv-cal__unit">
                      Bl. {b.tower} · {b.number}
                      {b.status === 'pending' ? ' (pend.)' : ''}
                    </span>
                  ))}
                  {(cell.bookings?.length ?? 0) > 3 ? (
                    <span className="resv-cal__unit">+{(cell.bookings?.length ?? 0) - 3}</span>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={bookingBusy || !cell.available || !canBook}
                  title={cell.date}
                  className={`resv-cal__cell resv-cal__cell--${cell.cell}`}
                  onClick={() => onBookDay(cell.date)}
                >
                  {cell.date.slice(8)}
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ReservationSpacesPage() {
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

  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(() => now.getUTCFullYear());
  const [month, setMonth] = useState(() => now.getUTCMonth() + 1);

  const [spaces, setSpaces] = useState<ReservationSpaceRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cal, setCal] = useState<CalendarDayCell[] | null>(null);
  const [calLoading, setCalLoading] = useState(false);
  const [myList, setMyList] = useState<Record<string, unknown>[] | null>(null);
  const [pending, setPending] = useState<Record<string, unknown>[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);

  const canManage = session ? canManageReservationSpaces(session.role) : false;
  const staffBilling = session ? isBillingStaff(session.role) : false;

  const [formOpen, setFormOpen] = useState(false);
  const [editingSpace, setEditingSpace] = useState<ReservationSpaceRow | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCapacity, setFormCapacity] = useState('');
  const [formRequiresAppr, setFormRequiresAppr] = useState(true);
  const [formPhotos, setFormPhotos] = useState<PhotoEntry[]>([]);
  const [formSaving, setFormSaving] = useState(false);

  const [galleryUrls, setGalleryUrls] = useState<string[] | null>(null);
  const [galleryTitle, setGalleryTitle] = useState('');
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [detailSpaceId, setDetailSpaceId] = useState<number | null>(null);

  const loadSpaces = useCallback(async () => {
    if (!session || !effectiveCondoId) {
      return;
    }
    setErr(null);
    try {
      const list = await listReservationSpaces(effectiveCondoId);
      setSpaces(list);
    } catch (e) {
      setSpaces(null);
      setErr(e instanceof Error ? e.message : 'Erro ao listar espaços.');
    }
  }, [session, effectiveCondoId]);

  const detailSpace = useMemo(() => {
    if (!spaces || detailSpaceId == null) {
      return null;
    }
    return spaces.find((s) => num(s.id) === detailSpaceId) ?? null;
  }, [spaces, detailSpaceId]);

  const openSpaceDetail = (spaceId: number) => {
    setDetailSpaceId(spaceId);
    setSelectedId(spaceId);
  };

  const closeSpaceDetail = () => {
    setDetailSpaceId(null);
  };

  const loadCalendar = useCallback(async () => {
    if (!session || !effectiveCondoId || selectedId == null || selectedId < 1) {
      setCal(null);
      return;
    }
    setCalLoading(true);
    setErr(null);
    try {
      const res = await getReservationSpaceCalendar(
        selectedId,
        effectiveCondoId,
        year,
        month,
        { staffView: canManage },
      );
      setCal(res.days);
    } catch (e) {
      setCal(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar calendário.');
    } finally {
      setCalLoading(false);
    }
  }, [session, effectiveCondoId, selectedId, year, month, canManage]);

  const loadMine = useCallback(async () => {
    if (!session || !effectiveCondoId || session.unitId == null) {
      return;
    }
    try {
      const r = await listMySpaceReservations(effectiveCondoId, session.unitId);
      setMyList(r);
    } catch {
      setMyList([]);
    }
  }, [session, effectiveCondoId]);

  const loadPending = useCallback(async () => {
    if (!session || !effectiveCondoId || !staffBilling) {
      return;
    }
    try {
      const r = await listPendingReservationApprovals(effectiveCondoId);
      setPending(r);
    } catch {
      setPending([]);
    }
  }, [session, effectiveCondoId, staffBilling]);

  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const selectedSpace = useMemo(
    () => spaces?.find((s) => num(s.id) === selectedId) ?? null,
    [spaces, selectedId],
  );

  const pendingForSelected = useMemo(() => {
    if (!pending || !selectedSpace) {
      return [];
    }
    const name = str(selectedSpace.name);
    return pending.filter((p) => str(p.space_name) === name);
  }, [pending, selectedSpace]);

  const pendingCountBySpaceName = useCallback(
    (spaceName: string) => {
      if (!pending) {
        return 0;
      }
      return pending.filter((p) => str(p.space_name) === spaceName).length;
    },
    [pending],
  );

  const openCreateForm = () => {
    setEditingSpace(null);
    setFormName('');
    setFormDesc('');
    setFormCapacity('');
    setFormRequiresAppr(true);
    setFormPhotos([]);
    setFormOpen(true);
  };

  const openEditForm = (space: ReservationSpaceRow) => {
    setEditingSpace(space);
    setFormName(str(space.name));
    setFormDesc(str(space.description));
    const cap = space.capacity;
    setFormCapacity(cap != null && cap !== '' ? String(cap) : '');
    setFormRequiresAppr(space.requires_approval !== false);
    setFormPhotos(
      photoUrlsFromSpace(space).map((url) => ({ kind: 'url' as const, url })),
    );
    setFormOpen(true);
  };

  const closeForm = () => {
    for (const p of formPhotos) {
      if (p.kind === 'file') {
        URL.revokeObjectURL(p.preview);
      }
    }
    setFormOpen(false);
    setEditingSpace(null);
    setFormPhotos([]);
  };

  const onPickFormPhotos = (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    const room = MAX_SPACE_PHOTOS - formPhotos.length;
    if (room <= 0) {
      return;
    }
    const added: PhotoEntry[] = [];
    for (const f of Array.from(files).slice(0, room)) {
      added.push({ kind: 'file', file: f, preview: URL.createObjectURL(f) });
    }
    setFormPhotos((prev) => [...prev, ...added]);
  };

  const removeFormPhoto = (index: number) => {
    setFormPhotos((prev) => {
      const next = [...prev];
      const removed = next.splice(index, 1)[0];
      if (removed?.kind === 'file') {
        URL.revokeObjectURL(removed.preview);
      }
      return next;
    });
  };

  const setFormPhotoPrincipal = (index: number) => {
    if (index <= 0) {
      return;
    }
    setFormPhotos((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      if (item) {
        next.unshift(item);
      }
      return next;
    });
  };

  const saveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !effectiveCondoId || !formName.trim() || !formDesc.trim()) {
      return;
    }
    setFormSaving(true);
    setErr(null);
    try {
      const photoUrls: string[] = [];
      for (const entry of formPhotos) {
        if (entry.kind === 'url') {
          photoUrls.push(entry.url);
        } else {
          const up = await uploadReservationSpacePhoto(effectiveCondoId, entry.file);
          if (up.photoUrl) {
            photoUrls.push(up.photoUrl);
          }
        }
      }

      const body = {
        condoId: effectiveCondoId,
        name: formName.trim(),
        description: formDesc.trim(),
        capacity: formCapacity.trim() ? Number.parseInt(formCapacity, 10) : null,
        requiresApproval: formRequiresAppr,
        photoUrls,
      };

      if (editingSpace) {
        await updateReservationSpace(num(editingSpace.id), body);
      } else {
        await createReservationSpace(body);
      }

      closeForm();
      await loadSpaces();
      if (editingSpace && num(editingSpace.id) === selectedId) {
        await loadCalendar();
      }
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Erro ao guardar espaço.');
    } finally {
      setFormSaving(false);
    }
  };

  const onDeleteSpace = async (space: ReservationSpaceRow) => {
    const name = str(space.name);
    const id = num(space.id);
    if (
      !window.confirm(
        `Remover «${name}»? O espaço deixa de aparecer para novas reservas.`,
      )
    ) {
      return;
    }
    setErr(null);
    try {
      await deleteReservationSpace(id, effectiveCondoId);
      if (selectedId === id) {
        setSelectedId(null);
        setDetailSpaceId(null);
      }
      await loadSpaces();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao excluir espaço.');
    }
  };

  const openGallery = (space: ReservationSpaceRow, startIndex = 0) => {
    const urls = photoUrlsFromSpace(space);
    if (urls.length === 0) {
      return;
    }
    setGalleryTitle(str(space.name));
    setGalleryUrls(urls);
    setGalleryIndex(startIndex);
  };

  const onBookDay = async (dateStr: string) => {
    if (!session || session.unitId == null || selectedId == null || !effectiveCondoId) {
      return;
    }
    if (!window.confirm(`Pedir reserva para ${dateStr}?`)) {
      return;
    }
    setBookingBusy(true);
    setErr(null);
    try {
      await createSpaceReservation(selectedId, {
        condoId: effectiveCondoId,
        unitId: session.unitId,
        date: dateStr,
        requesterName: session.fullName?.trim() || null,
      });
      await loadCalendar();
      await loadMine();
      await loadPending();
      window.alert('Pedido registado. Aguarde aprovação se exigida.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Não foi possível reservar.');
    } finally {
      setBookingBusy(false);
    }
  };

  const onCancelReservation = async (id: number) => {
    if (!session || session.unitId == null || !effectiveCondoId) {
      return;
    }
    if (!window.confirm('Cancelar esta reserva?')) {
      return;
    }
    try {
      await cancelSpaceReservation(id, effectiveCondoId, session.unitId);
      await loadMine();
      await loadCalendar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao cancelar.');
    }
  };

  const onApprove = async (id: number, status: 'approved' | 'rejected') => {
    try {
      await patchReservationApproval(id, { status });
      await loadPending();
      await loadCalendar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao atualizar.');
    }
  };

  const scrollToAgenda = (spaceId: number) => {
    setSelectedId(spaceId);
    setDetailSpaceId(null);
    requestAnimationFrame(() => {
      document.getElementById('resv-agenda-section')?.scrollIntoView({ behavior: 'smooth' });
    });
  };

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Reservas de espaço" backTo="/app">
      <div className="staff-hero">
        <h2>Espaços comuns</h2>
        <p>
          {canManage
            ? 'Gerir espaços, consultar a agenda com unidades reservadas e aprovar pedidos.'
            : 'Escolha o espaço e o dia livre no calendário. Quando o espaço exige validação, aguarde aprovação da equipa.'}
        </p>
        {staffBilling && !canManage ? (
          <p style={{ marginTop: 8, marginBottom: 0, opacity: 0.95 }}>
            Para o painel completo do síndico, use também{' '}
            <Link to="/app/sindico" style={{ color: 'inherit', fontWeight: 800 }}>
              Área do Síndico
            </Link>
            .
          </p>
        ) : null}
      </div>

      {err ? <p className="staff-error">{err}</p> : null}

      {staffBilling && pending && pending.length > 0 && !canManage ? (
        <section className="portal-details" style={{ marginBottom: 16 }}>
          <strong>Pedidos pendentes ({pending.length})</strong>
          <ul className="staff-list" style={{ marginTop: 8 }}>
            {pending.map((p) => (
              <li key={str(p.id)} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span>
                  {str(p.space_name)} · {str(p.starts_at)?.slice(0, 10)} · {str(p.tower)} {str(p.number)} ·{' '}
                  {str(p.requester_name)}
                </span>
                <button
                  type="button"
                  className="portal-btn portal-btn--primary"
                  onClick={() => void onApprove(num(p.id), 'approved')}
                >
                  Aprovar
                </button>
                <button type="button" className="portal-btn" onClick={() => void onApprove(num(p.id), 'rejected')}>
                  Recusar
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canManage ? (
        <>
          <div className="portal-inline" style={{ marginBottom: 16, justifyContent: 'space-between' }}>
            <strong>Gestão de espaços</strong>
            <button type="button" className="portal-btn portal-btn--primary" onClick={openCreateForm}>
              + Cadastrar espaço
            </button>
          </div>

          {!spaces ? (
            <p>A carregar espaços…</p>
          ) : spaces.length === 0 ? (
            <p className="staff-muted">Nenhum espaço cadastrado. Use o botão acima.</p>
          ) : detailSpace ? (
            <section className="resv-space-detail">
              <button type="button" className="portal-btn" style={{ marginBottom: 16 }} onClick={closeSpaceDetail}>
                ← Voltar à lista
              </button>
              <h3 className="staff-section-title" style={{ marginTop: 0 }}>
                {str(detailSpace.name)}
              </h3>
              {photoUrlsFromSpace(detailSpace).length > 0 ? (
                <div className="resv-space-detail__photos">
                  {photoUrlsFromSpace(detailSpace).map((url, i) => (
                    <button
                      key={url}
                      type="button"
                      className="resv-space-photos__btn"
                      onClick={() => openGallery(detailSpace, i)}
                    >
                      <img src={uploadsUrl(url)} alt="" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="resv-space-tile__img resv-space-tile__img--empty resv-space-detail__placeholder">
                  📍
                </div>
              )}
              <p className="staff-muted" style={{ marginTop: 16, lineHeight: 1.5 }}>
                {str(detailSpace.description)}
              </p>
              {detailSpace.capacity != null && detailSpace.capacity !== '' ? (
                <p className="staff-muted">Capacidade: {str(detailSpace.capacity)} pessoa(s)</p>
              ) : null}
              <p className="staff-muted" style={{ marginTop: 8 }}>
                {detailSpace.requires_approval === false
                  ? 'Reservas confirmadas automaticamente.'
                  : 'Reservas exigem aprovação da equipa.'}
              </p>
              <div className="resv-space-card__actions" style={{ marginTop: 20 }}>
                <button
                  type="button"
                  className="portal-btn portal-btn--primary"
                  onClick={() => scrollToAgenda(num(detailSpace.id))}
                >
                  Ver agenda
                </button>
                {staffBilling && pendingCountBySpaceName(str(detailSpace.name)) > 0 ? (
                  <span className="staff-muted" style={{ alignSelf: 'center' }}>
                    {pendingCountBySpaceName(str(detailSpace.name))} pendente(s)
                  </span>
                ) : null}
                <button type="button" className="portal-btn" onClick={() => openEditForm(detailSpace)}>
                  Editar
                </button>
                <button
                  type="button"
                  className="portal-link-danger"
                  onClick={() => void onDeleteSpace(detailSpace)}
                >
                  Excluir
                </button>
              </div>
            </section>
          ) : (
            <div className="resv-space-tile-grid">
              {spaces.map((space) => (
                <ReservationSpaceTile
                  key={str(space.id)}
                  space={space}
                  onClick={() => openSpaceDetail(num(space.id))}
                />
              ))}
            </div>
          )}

          <section id="resv-agenda-section" style={{ marginTop: 28 }}>
            <h3 className="staff-section-title">
              Agenda{selectedSpace ? `: ${str(selectedSpace.name)}` : ''}
            </h3>
            {spaces && spaces.length > 1 ? (
              <label className="staff-muted" style={{ display: 'block', marginBottom: 12 }}>
                Espaço no calendário
                <select
                  className="portal-input"
                  value={selectedId ?? ''}
                  onChange={(e) => setSelectedId(Number.parseInt(e.target.value, 10))}
                >
                  {spaces.map((s) => (
                    <option key={str(s.id)} value={num(s.id)}>
                      {str(s.name)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="portal-inline" style={{ marginBottom: 12, alignItems: 'center' }}>
              <button
                type="button"
                className="portal-btn"
                onClick={() => {
                  const n = shiftMonth(year, month, -1);
                  setYear(n.y);
                  setMonth(n.m);
                }}
              >
                ← Mês
              </button>
              <strong style={{ minWidth: 160, textAlign: 'center' }}>
                {month.toString().padStart(2, '0')}/{year}
              </strong>
              <button
                type="button"
                className="portal-btn"
                onClick={() => {
                  const n = shiftMonth(year, month, 1);
                  setYear(n.y);
                  setMonth(n.m);
                }}
              >
                Mês →
              </button>
            </div>

            <div className="resv-legend staff-muted" style={{ marginBottom: 8, fontSize: '0.85rem' }}>
              <span className="resv-legend__i resv-legend__i--free" /> Livre
              <span className="resv-legend__i resv-legend__i--pending" style={{ marginLeft: 12 }} /> Pendente
              <span className="resv-legend__i resv-legend__i--approved" style={{ marginLeft: 12 }} /> Ocupado
              <span className="resv-legend__i resv-legend__i--past" style={{ marginLeft: 12 }} /> Passado
              <span style={{ display: 'block', marginTop: 6 }}>
                Nos dias reservados: bloco e apartamento da unidade (como no app móvel).
              </span>
            </div>

            <CalendarGrid
              year={year}
              month={month}
              cal={cal}
              calLoading={calLoading}
              staffView
              canBook={session.unitId != null}
              bookingBusy={bookingBusy}
              onBookDay={onBookDay}
            />

            {staffBilling && pendingForSelected.length > 0 ? (
              <div style={{ marginTop: 20 }}>
                <strong>Pedidos pendentes — {str(selectedSpace?.name)}</strong>
                <ul className="staff-list" style={{ marginTop: 8 }}>
                  {pendingForSelected.map((p) => (
                    <li
                      key={str(p.id)}
                      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
                    >
                      <span>
                        {str(p.starts_at)?.slice(0, 10)} · Bl. {str(p.tower)} {str(p.number)} ·{' '}
                        {str(p.requester_name)}
                      </span>
                      <button
                        type="button"
                        className="portal-btn portal-btn--primary"
                        onClick={() => void onApprove(num(p.id), 'approved')}
                      >
                        Aprovar
                      </button>
                      <button
                        type="button"
                        className="portal-btn"
                        onClick={() => void onApprove(num(p.id), 'rejected')}
                      >
                        Recusar
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </>
      ) : !spaces ? (
        <p>A carregar espaços…</p>
      ) : spaces.length === 0 ? (
        <p className="staff-muted">Nenhum espaço ativo. Contacte a administração.</p>
      ) : detailSpace ? (
        <section className="resv-space-detail">
          <button type="button" className="portal-btn" style={{ marginBottom: 16 }} onClick={closeSpaceDetail}>
            ← Voltar à lista
          </button>
          <h3 className="staff-section-title" style={{ marginTop: 0 }}>
            {str(detailSpace.name)}
          </h3>
          {photoUrlsFromSpace(detailSpace).length > 0 ? (
            <div className="resv-space-detail__photos">
              {photoUrlsFromSpace(detailSpace).map((url, i) => (
                <button
                  key={url}
                  type="button"
                  className="resv-space-photos__btn"
                  onClick={() => openGallery(detailSpace, i)}
                >
                  <img src={uploadsUrl(url)} alt="" />
                </button>
              ))}
            </div>
          ) : (
            <div className="resv-space-tile__img resv-space-tile__img--empty resv-space-detail__placeholder">
              📍
            </div>
          )}
          <p className="staff-muted" style={{ marginTop: 16, lineHeight: 1.5 }}>
            {str(detailSpace.description)}
          </p>
          <p className="staff-muted" style={{ marginTop: 8 }}>
            {detailSpace.requires_approval === false
              ? 'Reserva confirmada automaticamente.'
              : 'Após escolher a data, aguarde aprovação da equipa.'}
          </p>

          <h4 className="staff-section-title" style={{ marginTop: 24 }}>
            Escolher data
          </h4>
          <div className="portal-inline" style={{ marginBottom: 12, alignItems: 'center' }}>
            <button
              type="button"
              className="portal-btn"
              onClick={() => {
                const n = shiftMonth(year, month, -1);
                setYear(n.y);
                setMonth(n.m);
              }}
            >
              ← Mês
            </button>
            <strong style={{ minWidth: 160, textAlign: 'center' }}>
              {month.toString().padStart(2, '0')}/{year}
            </strong>
            <button
              type="button"
              className="portal-btn"
              onClick={() => {
                const n = shiftMonth(year, month, 1);
                setYear(n.y);
                setMonth(n.m);
              }}
            >
              Mês →
            </button>
          </div>

          <div className="resv-legend staff-muted" style={{ marginBottom: 8, fontSize: '0.85rem' }}>
            <span className="resv-legend__i resv-legend__i--free" /> Livre
            <span className="resv-legend__i resv-legend__i--pending" style={{ marginLeft: 12 }} /> Pendente
            <span className="resv-legend__i resv-legend__i--approved" style={{ marginLeft: 12 }} /> Ocupado
            <span className="resv-legend__i resv-legend__i--past" style={{ marginLeft: 12 }} /> Passado
          </div>

          <CalendarGrid
            year={year}
            month={month}
            cal={cal}
            calLoading={calLoading}
            staffView={false}
            canBook={session.unitId != null}
            bookingBusy={bookingBusy}
            onBookDay={onBookDay}
          />

          {session.unitId == null ? (
            <p className="staff-banner" style={{ marginTop: 16 }}>
              Associe uma unidade ao seu utilizador para pedir reservas.
            </p>
          ) : null}
        </section>
      ) : (
        <>
          <p className="staff-muted" style={{ marginBottom: 12 }}>
            Toque num espaço para ver detalhes e reservar.
          </p>
          <div className="resv-space-tile-grid">
            {spaces.map((space) => (
              <ReservationSpaceTile
                key={str(space.id)}
                space={space}
                onClick={() => openSpaceDetail(num(space.id))}
              />
            ))}
          </div>
        </>
      )}

      {session.unitId != null ? (
        <section style={{ marginTop: 24 }}>
          <h3 className="staff-section-title">As minhas reservas em curso</h3>
          {!myList ? (
            <p className="staff-muted">A carregar…</p>
          ) : myList.length === 0 ? (
            <p className="staff-muted">Sem reservas ativas.</p>
          ) : (
            <ul className="staff-list">
              {myList.map((r) => (
                <li key={str(r.id)}>
                  <strong>{str(r.space_name)}</strong>
                  <div className="staff-muted">
                    {str(r.starts_at)} · {str(r.status)}
                  </div>
                  <button
                    type="button"
                    className="portal-link-danger"
                    style={{ marginTop: 6 }}
                    onClick={() => void onCancelReservation(num(r.id))}
                  >
                    Cancelar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {formOpen ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card resv-form-modal">
            <h3>{editingSpace ? 'Editar espaço' : 'Cadastrar espaço'}</h3>
            <form onSubmit={(e) => void saveForm(e)}>
              <label>
                Nome
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                />
              </label>
              <label>
                Descrição
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  rows={3}
                  required
                />
              </label>
              <label>
                Capacidade (opcional)
                <input
                  inputMode="numeric"
                  value={formCapacity}
                  onChange={(e) => setFormCapacity(e.target.value)}
                />
              </label>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={formRequiresAppr}
                  onChange={(e) => setFormRequiresAppr(e.target.checked)}
                />
                Exige aprovação da equipa
              </label>

              <p className="staff-section-title" style={{ marginTop: 16, marginBottom: 8 }}>
                Fotos (até {MAX_SPACE_PHOTOS})
              </p>
              <p className="staff-muted" style={{ marginTop: 0, marginBottom: 12 }}>
                A primeira foto é a principal no card da lista.
              </p>

              {formPhotos.map((entry, i) => (
                <div key={i} className="resv-form-photo">
                  <img
                    src={entry.kind === 'url' ? uploadsUrl(entry.url) : entry.preview}
                    alt=""
                  />
                  <div className="resv-form-photo__meta">
                    <strong>
                      {i === 0 ? 'Foto principal' : `Foto ${i + 1}`}
                      {entry.kind === 'file' ? ' (nova)' : ''}
                    </strong>
                    <div className="resv-form-photo__btns">
                      {i > 0 ? (
                        <button
                          type="button"
                          className="portal-btn"
                          disabled={formSaving}
                          onClick={() => setFormPhotoPrincipal(i)}
                        >
                          Tornar principal
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="portal-link-danger"
                        disabled={formSaving}
                        onClick={() => removeFormPhoto(i)}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              <label style={{ marginTop: 8 }}>
                Adicionar imagens
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  multiple
                  disabled={formSaving || formPhotos.length >= MAX_SPACE_PHOTOS}
                  onChange={(e) => {
                    onPickFormPhotos(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>

              <div className="resv-form-footer">
                <button
                  type="button"
                  className="portal-btn"
                  disabled={formSaving}
                  onClick={closeForm}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="portal-btn portal-btn--primary"
                  disabled={formSaving}
                >
                  {formSaving ? 'A guardar…' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {galleryUrls && galleryUrls.length > 0 ? (
        <div
          className="portal-modal"
          role="dialog"
          onClick={() => setGalleryUrls(null)}
        >
          <div
            className="portal-modal__card resv-gallery-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{galleryTitle}</h3>
            <div className="resv-gallery-main">
              <img src={uploadsUrl(galleryUrls[galleryIndex])} alt="" />
            </div>
            <p className="staff-muted" style={{ textAlign: 'center' }}>
              {galleryIndex === 0 && galleryUrls.length > 1
                ? `Foto principal · ${galleryIndex + 1} de ${galleryUrls.length}`
                : `${galleryIndex + 1} de ${galleryUrls.length}`}
            </p>
            <div className="portal-inline" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button
                type="button"
                className="portal-btn"
                disabled={galleryIndex <= 0}
                onClick={() => setGalleryIndex((i) => Math.max(0, i - 1))}
              >
                ← Anterior
              </button>
              <button
                type="button"
                className="portal-btn"
                disabled={galleryIndex >= galleryUrls.length - 1}
                onClick={() =>
                  setGalleryIndex((i) => Math.min(galleryUrls.length - 1, i + 1))
                }
              >
                Seguinte →
              </button>
              <button type="button" className="portal-btn" onClick={() => setGalleryUrls(null)}>
                Fechar
              </button>
            </div>
            {galleryUrls.length > 1 ? (
              <div className="resv-gallery-thumbs">
                {galleryUrls.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    className={i === galleryIndex ? 'resv-gallery-thumbs__active' : ''}
                    onClick={() => setGalleryIndex(i)}
                  >
                    <img src={uploadsUrl(url)} alt="" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </StaffLayout>
  );
}

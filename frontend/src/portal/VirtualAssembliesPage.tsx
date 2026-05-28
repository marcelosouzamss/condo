import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isBillingStaff, labelPt, picksCondoBeforeContact } from '../condoUserRoles';
import {
  createVirtualAssembly,
  deleteVirtualAssembly,
  getVirtualAssemblyAttendance,
  listVideoRooms,
  listVirtualAssemblies,
  patchVirtualAssembly,
  postVirtualAssemblyAttendance,
  type VirtualAssemblyRow,
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

function asBool(v: unknown): boolean {
  if (typeof v === 'boolean') {
    return v;
  }
  if (typeof v === 'string') {
    return v.toLowerCase() === 'true' || v === 't';
  }
  return false;
}

function assemblyStatusLabel(s: string): string {
  switch (s) {
    case 'draft':
      return 'Rascunho';
    case 'scheduled':
      return 'Agendada';
    case 'live':
      return 'Ao vivo';
    case 'completed':
      return 'Encerrada';
    case 'cancelled':
      return 'Cancelada';
    default:
      return s;
  }
}

function fmtScheduleLine(row: VirtualAssemblyRow): string | null {
  const start = row.scheduled_starts_at;
  const end = row.scheduled_ends_at;
  if (start == null && end == null) {
    return null;
  }
  const fmt = (v: unknown) => {
    if (v == null) {
      return '';
    }
    const s = String(v);
    if (s.length >= 16) {
      return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`;
    }
    return s;
  };
  if (start != null && end != null) {
    return `${fmt(start)} — ${fmt(end)}`;
  }
  if (start != null) {
    return `Início: ${fmt(start)}`;
  }
  return `Fim: ${fmt(end)}`;
}

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function VirtualAssembliesPage() {
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

  const canBillingManage = session ? isBillingStaff(session.role) : false;

  const [rows, setRows] = useState<VirtualAssemblyRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [roomsCache, setRoomsCache] = useState<{ id: number; title: string }[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<VirtualAssemblyRow | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStatus, setFormStatus] = useState('scheduled');
  const [formVideoRoomId, setFormVideoRoomId] = useState<number | ''>('');

  const [attOpen, setAttOpen] = useState(false);
  const [attTitle, setAttTitle] = useState('');
  const [attRows, setAttRows] = useState<Record<string, unknown>[]>([]);
  const [attLoading, setAttLoading] = useState(false);

  const loadRoomsForPicker = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      return [];
    }
    try {
      const list = await listVideoRooms(effectiveCondoId, session.id, true);
      return list.map((r) => ({
        id: num(r.id),
        title: str(r.title) || `Sala ${num(r.id)}`,
      }));
    } catch {
      return [];
    }
  }, [session, effectiveCondoId]);

  const reload = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      setRows([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const list = await listVirtualAssemblies(effectiveCondoId, session.id);
      setRows(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar assembleias.');
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openCreate = async () => {
    const rooms = await loadRoomsForPicker();
    setRoomsCache(rooms);
    if (rooms.length === 0) {
      window.alert(
        'Não foi possível carregar as salas de videoconferência. Pode criar a assembleia sem vínculo a uma sala.',
      );
    }
    setEditing(null);
    setFormTitle('');
    setFormDesc('');
    setFormStatus('scheduled');
    setFormVideoRoomId('');
    setEditorOpen(true);
  };

  const openEdit = async (row: VirtualAssemblyRow) => {
    const rooms = await loadRoomsForPicker();
    setRoomsCache(rooms);
    if (rooms.length === 0) {
      window.alert(
        'Não foi possível carregar as salas. A edição segue sem alterar o vínculo pela lista.',
      );
    }
    setEditing(row);
    setFormTitle(str(row.title));
    setFormDesc(str(row.description));
    setFormStatus(str(row.status) || 'scheduled');
    const vid = row.video_room_id;
    setFormVideoRoomId(vid == null || vid === '' ? '' : num(vid));
    setEditorOpen(true);
  };

  const saveEditor = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const title = formTitle.trim();
    if (!title) {
      window.alert('Informe o título.');
      return;
    }
    const vid =
      formVideoRoomId === '' ? null : Number.parseInt(String(formVideoRoomId), 10);
    if (vid != null && !Number.isFinite(vid)) {
      window.alert('Sala inválida.');
      return;
    }

    setSaveBusy(true);
    try {
      const desc = formDesc.trim();
      if (editing) {
        const id = num(editing.id);
        await patchVirtualAssembly(id, {
          condoId: effectiveCondoId,
          userId: session.id,
          title,
          status: formStatus,
          description: desc === '' ? null : desc,
          videoRoomId: vid,
        });
      } else {
        await createVirtualAssembly({
          condoId: effectiveCondoId,
          userId: session.id,
          title,
          status: formStatus,
          ...(desc ? { description: desc } : {}),
          ...(vid != null ? { videoRoomId: vid } : {}),
        });
      }
      setEditorOpen(false);
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao guardar.');
    } finally {
      setSaveBusy(false);
    }
  };

  const onDelete = async (row: VirtualAssemblyRow) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const id = num(row.id);
    const title = str(row.title);
    if (id < 1 || !window.confirm(`Confirma a exclusão de «${title}»?`)) {
      return;
    }
    try {
      await deleteVirtualAssembly(id, effectiveCondoId, session.id);
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  };

  const showAttendance = async (assemblyId: number, title: string) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    setAttTitle(title);
    setAttOpen(true);
    setAttLoading(true);
    setAttRows([]);
    try {
      const list = await getVirtualAssemblyAttendance(assemblyId, effectiveCondoId, session.id);
      setAttRows(list as Record<string, unknown>[]);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao carregar presenças.');
      setAttOpen(false);
    } finally {
      setAttLoading(false);
    }
  };

  const markPresence = async (assemblyId: number) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    try {
      await postVirtualAssemblyAttendance(assemblyId, {
        condoId: effectiveCondoId,
        userId: session.id,
      });
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao registar presença.');
    }
  };

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Assembleias virtuais">
      {effectiveCondoId < 1 ? (
        <p className="staff-muted">
          Associe ou escolha um condomínio (perfil sem condomínio válido selecionado).
        </p>
      ) : null}

      <p className="staff-section-desc" style={{ marginTop: 0 }}>
        Assembleias com ligação opcional a salas Jitsi. Registe a sua presença no dia do evento; síndico e
        administração gerem o cadastro e consultam a lista de presença.
      </p>

      <div className="portal-inline" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        {canBillingManage ? (
          <button type="button" className="portal-btn portal-btn--primary" onClick={() => void openCreate()}>
            Nova assembleia
          </button>
        ) : null}
        <button type="button" className="portal-btn" onClick={() => void reload()}>
          Atualizar
        </button>
      </div>

      {err ? (
        <p className="staff-muted" role="alert">
          {err}
        </p>
      ) : null}
      {loading ? <p className="staff-muted">A carregar…</p> : null}

      {!loading && !err && (rows ?? []).length === 0 ? (
        <p className="staff-muted">
          {canBillingManage
            ? 'Nenhuma assembleia cadastrada. Use «Nova assembleia», opcionalmente com uma sala Jitsi.'
            : 'Não há assembleias publicadas no momento.'}
        </p>
      ) : null}
      {!loading && (rows ?? []).length > 0 ? (
        <p className="staff-muted" style={{ fontSize: '0.9rem', marginBottom: 12 }}>
          Registe a sua presença no dia do evento. O botão «Entrar na sala» abre o Jitsi Meet no navegador.
        </p>
      ) : null}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {(rows ?? []).map((row) => {
          const id = num(row.id);
          const title = str(row.title);
          const desc = str(row.description);
          const status = str(row.status);
          const joinUrl = str(row.joinUrl);
          const vTitle = str(row.video_room_title);
          const schedule = fmtScheduleLine(row);
          const nPresent = num(row.attendance_count);
          const present = asBool(row.i_present);
          const canJoin =
            joinUrl !== '' && status !== 'cancelled' && status !== 'draft';
          const canMark = status !== 'draft' && status !== 'cancelled';
          const canDelete = status !== 'completed';

          return (
            <li key={id} className="portal-details" style={{ marginBottom: 12 }}>
              <div className="portal-inline" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ flex: '1 1 220px' }}>
                  <strong>{title}</strong>
                  {desc ? <p style={{ margin: '8px 0 0', lineHeight: 1.45 }}>{desc}</p> : null}
                  {schedule ? (
                    <p className="staff-muted" style={{ margin: '6px 0 0', fontSize: '0.9rem' }}>
                      {schedule}
                    </p>
                  ) : null}
                  {vTitle ? (
                    <p className="staff-muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                      Sala: {vTitle}
                    </p>
                  ) : null}
                  <p style={{ margin: '8px 0 0', fontSize: '0.88rem', fontWeight: 600, color: 'var(--primary)' }}>
                    Situação: {assemblyStatusLabel(status)} · {nPresent} participante
                    {nPresent === 1 ? '' : 's'}
                    {present ? ' · Você confirmou presença' : ''}
                  </p>
                </div>
                {canBillingManage ? (
                  <div className="portal-charge-actions" style={{ flexWrap: 'wrap' }}>
                    <button type="button" className="portal-btn" onClick={() => void openEdit(row)}>
                      Editar
                    </button>
                    <button type="button" className="portal-btn" onClick={() => void showAttendance(id, title)}>
                      Lista de presença
                    </button>
                    {canDelete ? (
                      <button type="button" className="portal-link-danger" onClick={() => void onDelete(row)}>
                        Excluir
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="portal-charge-actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="portal-btn portal-btn--primary"
                  disabled={!canJoin}
                  onClick={() => canJoin && openExternal(joinUrl)}
                >
                  Entrar na sala
                </button>
                <button
                  type="button"
                  className="portal-btn"
                  disabled={!canMark || present}
                  onClick={() => void markPresence(id)}
                >
                  {present ? 'Presença ok' : 'Registar presença'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {editorOpen && canBillingManage ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 440 }}>
            <h3>{editing ? 'Editar assembleia virtual' : 'Nova assembleia virtual'}</h3>
            <form className="portal-form" onSubmit={(e) => void saveEditor(e)}>
              <label>
                Título *
                <input className="portal-input" required value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
              </label>
              <label>
                Descrição / pauta (opcional)
                <textarea className="portal-input" rows={3} value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
              </label>
              <label>
                Situação
                <select className="portal-input" value={formStatus} onChange={(e) => setFormStatus(e.target.value)}>
                  <option value="draft">Rascunho</option>
                  <option value="scheduled">Agendada</option>
                  <option value="live">Ao vivo</option>
                  <option value="completed">Encerrada</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </label>
              <label>
                Sala de videoconferência (opcional)
                <select
                  className="portal-input"
                  value={formVideoRoomId === '' ? '' : String(formVideoRoomId)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFormVideoRoomId(v === '' ? '' : Number.parseInt(v, 10));
                  }}
                >
                  <option value="">Nenhuma</option>
                  {roomsCache.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </label>
              {roomsCache.length === 0 && (
                <p className="staff-muted" style={{ fontSize: '0.82rem', margin: 0 }}>
                  Crie salas em Videoconferência para as ver aqui (ou deixe sem vínculo).
                </p>
              )}
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={saveBusy}>
                  {editing ? 'Guardar' : 'Criar'}
                </button>
                <button type="button" className="portal-btn" onClick={() => setEditorOpen(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {attOpen ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 480 }}>
            <h3>Presença registada · {attTitle}</h3>
            {attLoading ? <p className="staff-muted">A carregar…</p> : null}
            {!attLoading && attRows.length === 0 ? (
              <p className="staff-muted">Ninguém registou presença ainda.</p>
            ) : null}
            {!attLoading && attRows.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 360, overflow: 'auto' }}>
                {attRows.map((m, i) => {
                  const name = str(m.full_name);
                  const login = str(m.login);
                  const role = str(m.role);
                  const marked = str(m.marked_at);
                  let when = marked;
                  if (marked.length >= 16) {
                    when = `${marked.slice(8, 10)}/${marked.slice(5, 7)}/${marked.slice(0, 4)} ${marked.slice(11, 16)}`;
                  }
                  const uid = num(m.user_id);
                  return (
                    <li
                      key={`${uid}-${i}`}
                      style={{
                        padding: '10px 0',
                        borderBottom: '1px solid color-mix(in srgb, var(--ink) 10%, transparent)',
                      }}
                    >
                      <strong>{name || `Utilizador ${uid}`}</strong>
                      <div className="staff-muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                        {[labelPt(role), login ? `@${login}` : '', when].filter(Boolean).join(' · ')}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="portal-form__actions" style={{ marginTop: 12 }}>
              <button type="button" className="portal-btn" onClick={() => setAttOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </StaffLayout>
  );
}

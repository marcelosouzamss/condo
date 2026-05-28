import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isOperationalStaff, picksCondoBeforeContact } from '../condoUserRoles';
import { createVideoRoom, listVideoRooms, type VideoRoomRow } from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function roomStatusLabel(s: string): string {
  switch (s) {
    case 'live':
      return 'Ao vivo';
    case 'scheduled':
      return 'Agendada';
    case 'ended':
      return 'Encerrada';
    default:
      return s;
  }
}

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function VideoConferencePage() {
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

  const canManageStaff = session ? isOperationalStaff(session.role) : false;

  const [rows, setRows] = useState<VideoRoomRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [includeEnded, setIncludeEnded] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStatus, setFormStatus] = useState('live');

  const reload = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      setRows([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const list = await listVideoRooms(effectiveCondoId, session.id, includeEnded);
      setRows(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar salas.');
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId, includeEnded]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveRoom = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const title = formTitle.trim();
    if (!title) {
      window.alert('Informe o título da reunião.');
      return;
    }
    setSaving(true);
    try {
      await createVideoRoom({
        condoId: effectiveCondoId,
        userId: session.id,
        title,
        status: formStatus,
        description: formDesc.trim() || null,
      });
      setModalOpen(false);
      setFormTitle('');
      setFormDesc('');
      setFormStatus('live');
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao criar sala.');
    } finally {
      setSaving(false);
    }
  };

  const openNew = () => {
    setFormTitle('');
    setFormDesc('');
    setFormStatus('live');
    setModalOpen(true);
  };

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Videoconferência">
      {effectiveCondoId < 1 ? (
        <p className="staff-muted">
          Associe ou escolha um condomínio (perfil sem condomínio válido selecionado).
        </p>
      ) : null}

      <p className="staff-section-desc" style={{ marginTop: 0 }}>
        Salas Jitsi Meet associadas ao condomínio. As reuniões abrem no navegador; identifique-se com o seu nome ao
        entrar.
      </p>

      <div className="portal-inline" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <label className="staff-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={includeEnded}
            onChange={(e) => setIncludeEnded(e.target.checked)}
          />
          Mostrar salas encerradas
        </label>
        <span style={{ flex: 1 }} />
        {canManageStaff ? (
          <button type="button" className="portal-btn portal-btn--primary" onClick={openNew}>
            Nova sala
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
          {canManageStaff
            ? 'Nenhuma sala ativa. Use «Nova sala» para criar uma reunião Jitsi Meet.'
            : 'Nenhuma sala disponível no momento.'}
        </p>
      ) : null}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {(rows ?? []).map((row) => {
          const title = str(row.title);
          const desc = str(row.description);
          const status = str(row.status);
          const joinUrl = str(row.joinUrl);
          return (
            <li key={num(row.id)} className="portal-details" style={{ marginBottom: 10 }}>
              <div className="portal-inline" style={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <strong>{title}</strong>
                  {desc ? <p style={{ margin: '8px 0 0', lineHeight: 1.45 }}>{desc}</p> : null}
                  <p
                    style={{
                      margin: '8px 0 0',
                      fontSize: '0.88rem',
                      fontWeight: 700,
                      color: 'var(--primary)',
                    }}
                  >
                    Situação: {roomStatusLabel(status)}
                  </p>
                </div>
                <button
                  type="button"
                  className="portal-btn portal-btn--primary"
                  disabled={!joinUrl}
                  onClick={() => joinUrl && openExternal(joinUrl)}
                  style={{ flexShrink: 0 }}
                >
                  Entrar
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {modalOpen && canManageStaff ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 440 }}>
            <h3>Nova sala (Jitsi Meet)</h3>
            <form className="portal-form" onSubmit={(e) => void saveRoom(e)}>
              <label>
                Título da reunião *
                <input className="portal-input" required value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
              </label>
              <label>
                Descrição (opcional)
                <textarea className="portal-input" rows={2} value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
              </label>
              <label>
                Situação
                <select className="portal-input" value={formStatus} onChange={(e) => setFormStatus(e.target.value)}>
                  <option value="scheduled">Agendada</option>
                  <option value="live">Ao vivo / aberta</option>
                  <option value="ended">Encerrada</option>
                </select>
              </label>
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={saving}>
                  Criar
                </button>
                <button type="button" className="portal-btn" onClick={() => setModalOpen(false)}>
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

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

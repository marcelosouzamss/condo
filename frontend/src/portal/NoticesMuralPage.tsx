import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiUrl } from '../api';
import { isBillingStaff, picksCondoBeforeContact } from '../condoUserRoles';
import {
  createStaffNotice,
  deleteStaffNotice,
  listPublicNotices,
  listStaffNotices,
  patchStaffNotice,
  type PublicNoticeRow,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const NOTICE_AUDIENCE_OPTIONS = [
  { value: 'resident', label: 'Moradores' },
  { value: 'partner', label: 'Parceiros' },
  { value: 'collaborator', label: 'Colaboradores' },
  { value: 'doorman', label: 'Portaria' },
  { value: 'syndic', label: 'Síndico' },
  { value: 'administrator', label: 'Administração' },
  { value: 'admin', label: 'Administrador da plataforma' },
];

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

function attachmentHref(url: string): string {
  if (!url) {
    return '#';
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const p = url.startsWith('/') ? url : `/${url}`;
  return apiUrl(p);
}

function audienceRoleValues(raw: unknown): string[] {
  const text = str(raw).trim();
  if (!text) {
    return [];
  }
  const allowed = new Set(NOTICE_AUDIENCE_OPTIONS.map((o) => o.value));
  return text
    .split(/[,\s;|]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part, index, arr) => allowed.has(part) && arr.indexOf(part) === index);
}

function audienceLabel(raw: unknown): string {
  const roles = audienceRoleValues(raw);
  if (roles.length === 0) {
    return str(raw);
  }
  return roles
    .map((role) => NOTICE_AUDIENCE_OPTIONS.find((o) => o.value === role)?.label ?? role)
    .join(', ');
}

function noticeVisibleForRole(row: PublicNoticeRow, role: string): boolean {
  const roles = audienceRoleValues(row.audience);
  return roles.length === 0 || roles.includes(role);
}

function mergeNoticeAtTop(
  rows: PublicNoticeRow[] | null,
  notice: PublicNoticeRow,
): PublicNoticeRow[] {
  const noticeId = str(notice.id);
  const current = rows ?? [];
  return [notice, ...current.filter((row) => str(row.id) !== noticeId)];
}

function dateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultEndDateTimeLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(23, 59, 0, 0);
  return dateTimeLocalValue(d);
}

function datetimeLocalToIso(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

type NoticePatchFields = Omit<
  Parameters<typeof patchStaffNotice>[1],
  'condoId' | 'userId'
>;

export function NoticesMuralPage() {
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

  const staff = session && isBillingStaff(session.role);

  const [publicRows, setPublicRows] = useState<PublicNoticeRow[] | null>(null);
  const [staffRows, setStaffRows] = useState<PublicNoticeRow[] | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal');
  const [pinned, setPinned] = useState(false);
  const [audienceRoles, setAudienceRoles] = useState<string[]>([]);
  const [publishedAt, setPublishedAt] = useState(() => dateTimeLocalValue(new Date()));
  const [hasEnd, setHasEnd] = useState(false);
  const [expiresAt, setExpiresAt] = useState(() => defaultEndDateTimeLocal());
  const [saving, setSaving] = useState(false);
  const [noticeFormOpen, setNoticeFormOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const loadPublic = useCallback(async () => {
    if (!session || !effectiveCondoId) {
      return;
    }
    try {
      const list = await listPublicNotices(effectiveCondoId, false, session.role);
      setPublicRows(list);
    } catch (e) {
      setPublicRows([]);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar avisos públicos.');
    }
  }, [session, effectiveCondoId]);

  const loadStaff = useCallback(async () => {
    if (!session || !staff || !effectiveCondoId) {
      return;
    }
    try {
      const list = await listStaffNotices(
        effectiveCondoId,
        session.id,
        includeArchived,
      );
      setStaffRows(list);
    } catch (e) {
      setStaffRows([]);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar gestão.');
    }
  }, [session, staff, effectiveCondoId, includeArchived]);

  useEffect(() => {
    if (!session || !effectiveCondoId) {
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      await loadPublic();
      if (staff) {
        await loadStaff();
      } else {
        setStaffRows(null);
      }
      if (!cancelled) {
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, effectiveCondoId, staff, includeArchived, loadPublic, loadStaff]);

  const loadAll = useCallback(async () => {
    await loadPublic();
    if (staff) {
      await loadStaff();
    }
  }, [loadPublic, loadStaff, staff]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !staff || !effectiveCondoId || !title.trim() || !content.trim()) {
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const created = await createStaffNotice({
        condoId: effectiveCondoId,
        userId: session.id,
        title: title.trim(),
        content: content.trim(),
        urgency,
        isPinned: pinned,
        audience: audienceRoles.length > 0 ? audienceRoles.join(',') : null,
        publishedAt: datetimeLocalToIso(publishedAt),
        expiresAt: hasEnd ? (datetimeLocalToIso(expiresAt) ?? null) : null,
      });
      setTitle('');
      setContent('');
      setPinned(false);
      setAudienceRoles([]);
      setPublishedAt(dateTimeLocalValue(new Date()));
      setHasEnd(false);
      setExpiresAt(defaultEndDateTimeLocal());
      setNoticeFormOpen(false);
      setManageOpen(true);
      if (noticeVisibleForRole(created, session.role)) {
        setPublicRows((prev) => mergeNoticeAtTop(prev, created));
      }
      setStaffRows((prev) => mergeNoticeAtTop(prev, created));
      void (async () => {
        await loadAll();
        if (noticeVisibleForRole(created, session.role)) {
          setPublicRows((prev) => mergeNoticeAtTop(prev, created));
        }
        setStaffRows((prev) => mergeNoticeAtTop(prev, created));
      })();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Erro ao publicar.');
    } finally {
      setSaving(false);
    }
  };

  const onPatch = async (id: number, patch: NoticePatchFields) => {
    if (!session || !staff || !effectiveCondoId) {
      return;
    }
    setErr(null);
    try {
      await patchStaffNotice(id, {
        ...patch,
        condoId: effectiveCondoId,
        userId: session.id,
      });
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao atualizar.');
    }
  };

  const onDelete = async (id: number) => {
    if (!session || !staff || !effectiveCondoId || !window.confirm('Eliminar este aviso?')) {
      return;
    }
    setErr(null);
    try {
      await deleteStaffNotice(id, effectiveCondoId, session.id);
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao eliminar.');
    }
  };

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Mural de avisos" backTo="/app">
      <div className="staff-hero">
        <h2>Comunicados do condomínio</h2>
        <p>A mesma informação pública do app, com gestão integral para síndico e administração.</p>
      </div>

      {err ? <p className="staff-error">{err}</p> : null}

      {staff ? (
        <div className="portal-inline" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            className="portal-btn portal-btn--primary"
            onClick={() => {
              setNoticeFormOpen((open) => !open);
              setManageOpen(false);
            }}
          >
            Novo aviso
          </button>
          <button
            type="button"
            className="portal-btn"
            onClick={() => {
              setManageOpen((open) => !open);
              setNoticeFormOpen(false);
            }}
          >
            Gerir mural
          </button>
        </div>
      ) : null}

      {loading ? (
        <p>A carregar…</p>
      ) : (
        <>
          <h3 className="staff-section-title">Mural</h3>
          {!publicRows || publicRows.length === 0 ? (
            <p className="staff-muted">Nenhum aviso em vigor.</p>
          ) : (
            <ul className="staff-list">
              {publicRows.map((n) => (
                <li key={str(n.id)} className="notice-card">
                  <div className="notice-card__head">
                    <strong>{str(n.title)}</strong>
                    <span className="staff-muted" style={{ marginLeft: 8, fontSize: '0.85rem' }}>
                      {n.is_pinned ? '📌 ' : ''}
                      {str(n.urgency)} · {str(n.published_at)?.slice(0, 16)?.replace('T', ' ')}
                    </span>
                  </div>
                  <p className="notice-card__body" style={{ whiteSpace: 'pre-wrap' }}>
                    {str(n.content)}
                  </p>
                  {str(n.audience) ? (
                    <p className="staff-muted" style={{ fontSize: '0.85rem' }}>
                      Público-alvo: {audienceLabel(n.audience)}
                    </p>
                  ) : null}
                  <NoticeAttachments row={n} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {staff ? (
        <section style={{ marginTop: 28 }}>
          <details
            className="portal-details"
            style={{ marginBottom: 16 }}
            open={noticeFormOpen}
            onToggle={(e) => setNoticeFormOpen(e.currentTarget.open)}
          >
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Novo aviso</summary>
            <form className="portal-form" style={{ marginTop: 12 }} onSubmit={onCreate}>
              <label>
                Título
                <input value={title} onChange={(e) => setTitle(e.target.value)} required />
              </label>
              <label>
                Texto
                <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} required />
              </label>
              <label>
                Urgência
                <select
                  value={urgency}
                  onChange={(e) =>
                    setUrgency(e.target.value as 'normal' | 'urgent')
                  }
                >
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgente</option>
                </select>
              </label>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
                Fixar no topo
              </label>
              <label>
                Publicação
                <input
                  type="datetime-local"
                  value={publishedAt}
                  onChange={(e) => setPublishedAt(e.target.value)}
                  required
                />
              </label>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={hasEnd}
                  onChange={(e) => setHasEnd(e.target.checked)}
                />
                Definir término
              </label>
              {hasEnd ? (
                <label>
                  Término
                  <input
                    type="datetime-local"
                    value={expiresAt}
                    min={publishedAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    required
                  />
                </label>
              ) : null}
              <label>
                Público
                <select
                  multiple
                  value={audienceRoles}
                  onChange={(e) =>
                    setAudienceRoles(
                      Array.from(e.currentTarget.selectedOptions).map((opt) => opt.value),
                    )
                  }
                  size={NOTICE_AUDIENCE_OPTIONS.length}
                >
                  {NOTICE_AUDIENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="staff-muted">
                  Segure Ctrl/Command para selecionar mais de um perfil. Sem seleção = todos.
                </span>
              </label>
              <button type="submit" className="portal-btn portal-btn--primary" disabled={saving}>
                {saving ? 'A publicar…' : 'Publicar'}
              </button>
            </form>
          </details>

          <details
            className="portal-details"
            open={manageOpen}
            onToggle={(e) => setManageOpen(e.currentTarget.open)}
          >
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Gerir mural</summary>
            <label className="staff-muted" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              Incluir arquivados na lista interna
            </label>

            {!staffRows ? (
              <p className="staff-muted">A carregar lista da equipa…</p>
            ) : staffRows.length === 0 ? (
              <p className="staff-muted">Sem avisos na lista interna.</p>
            ) : (
              <ul className="staff-list">
                {staffRows.map((n) => {
                  const id = num(n.id);
                  const archived = n.is_archived === true;
                  return (
                    <li key={id}>
                      <strong>{str(n.title)}</strong>
                      <div className="staff-muted" style={{ fontSize: '0.85rem' }}>
                        {archived ? 'Arquivado · ' : ''}
                        {str(n.published_at)} · {str(n.urgency)}
                      </div>
                      <div className="portal-charge-actions" style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          className="portal-btn"
                          onClick={() =>
                            void onPatch(id, { isPinned: n.is_pinned !== true })
                          }
                        >
                          {n.is_pinned ? 'Desafixar' : 'Fixar'}
                        </button>
                        <button
                          type="button"
                          className="portal-btn"
                          onClick={() => void onPatch(id, { isArchived: !archived })}
                        >
                          {archived ? 'Restaurar' : 'Arquivar'}
                        </button>
                        <button type="button" className="portal-link-danger" onClick={() => void onDelete(id)}>
                          Eliminar
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </details>
        </section>
      ) : null}
    </StaffLayout>
  );
}

function NoticeAttachments({ row }: { row: PublicNoticeRow }) {
  const raw = row.attachments;
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
      {raw.map((a) => {
        const att = a as Record<string, unknown>;
        const url = str(att.url);
        const name = str(att.fileName) || 'Anexo';
        return (
          <li key={str(att.id)}>
            <a href={attachmentHref(url)} target="_blank" rel="noreferrer">
              {name}
            </a>
            <span className="staff-muted" style={{ marginLeft: 8, fontSize: '0.8rem' }}>
              {str(att.mimeType)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { canManageDocuments, CondoUserRoles, isBillingStaff, labelPt, picksCondoBeforeContact } from '../condoUserRoles';
import {
  deleteCondoDocument,
  listDocuments,
  updateCondoDocument,
  uploadCondoDocument,
  type CondoDocumentRow,
} from '../portalApi';
import { uploadsUrl } from '../api';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const PRESET_DOC_TYPES = [
  'Ata',
  'Regimento interno',
  'Convenção',
  'Contrato',
  'Financeiro',
  'Manutenção',
  'Comunicado',
  'Outro',
] as const;

/** Perfis que podem ser escolhidos como audiência (sem admin da plataforma). */
const DOCUMENT_VIEWER_ROLE_OPTIONS = [
  CondoUserRoles.resident,
  CondoUserRoles.collaborator,
  CondoUserRoles.doorman,
  CondoUserRoles.partner,
  CondoUserRoles.syndic,
  CondoUserRoles.administrator,
] as const;

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

/** Evita `application/octet-stream` no multipart (multer rejeita). */
function mimeFromFilename(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.doc':
      return 'application/msword';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.txt':
      return 'text/plain';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return undefined;
  }
}

function fileWithReliableMime(f: File): File {
  const t = (f.type || '').trim();
  if (t && t !== 'application/octet-stream') {
    return f;
  }
  const mime = mimeFromFilename(f.name);
  if (!mime) {
    return f;
  }
  return new File([f], f.name, { type: mime });
}

function formatWhen(iso: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) {
    return iso;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(d));
}

function rowVisibleToAll(row: CondoDocumentRow): boolean {
  const v = row.visible_to_all;
  if (v === false || v === 'false' || v === 0) {
    return false;
  }
  return true;
}

function rowViewerRolesLabels(row: CondoDocumentRow): string {
  const raw = row.viewer_roles;
  if (!Array.isArray(raw) || raw.length === 0) {
    return '';
  }
  const labels = raw
    .map((r) => (typeof r === 'string' ? labelPt(r) : ''))
    .filter((s) => s.length > 0);
  return labels.join(', ');
}

function viewerRoleChecksFromRow(row: CondoDocumentRow): Record<string, boolean> {
  const m = Object.fromEntries(DOCUMENT_VIEWER_ROLE_OPTIONS.map((r) => [r, false])) as Record<
    string,
    boolean
  >;
  const raw = row.viewer_roles;
  if (!Array.isArray(raw)) {
    return m;
  }
  for (const x of raw) {
    if (typeof x === 'string' && x in m) {
      m[x] = true;
    }
  }
  return m;
}

function canEditDocumentRow(session: { id: number; role: string }, row: CondoDocumentRow): boolean {
  if (!canManageDocuments(session.role)) {
    return false;
  }
  if (isBillingStaff(session.role)) {
    return true;
  }
  const poster = num(row.posted_by_user_id);
  return poster > 0 && poster === session.id;
}

export function DocumentsPage() {
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

  const able = session ? canManageDocuments(session.role) : false;

  const [docs, setDocs] = useState<CondoDocumentRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [docType, setDocType] = useState<string>(PRESET_DOC_TYPES[0]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [docVisibleToAll, setDocVisibleToAll] = useState(true);
  const [docViewerRoles, setDocViewerRoles] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(DOCUMENT_VIEWER_ROLE_OPTIONS.map((r) => [r, false])) as Record<string, boolean>,
  );

  const [editingRow, setEditingRow] = useState<CondoDocumentRow | null>(null);
  const [editDocType, setEditDocType] = useState<string>(PRESET_DOC_TYPES[0]);
  const [editCustomType, setEditCustomType] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editVisibleToAll, setEditVisibleToAll] = useState(true);
  const [editViewerRoles, setEditViewerRoles] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(DOCUMENT_VIEWER_ROLE_OPTIONS.map((r) => [r, false])) as Record<string, boolean>,
  );
  const [editSaving, setEditSaving] = useState(false);

  const resetUploadAudience = useCallback(() => {
    setDocVisibleToAll(true);
    setDocViewerRoles(
      Object.fromEntries(DOCUMENT_VIEWER_ROLE_OPTIONS.map((r) => [r, false])) as Record<string, boolean>,
    );
  }, []);

  const load = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      setDocs([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const list = await listDocuments(effectiveCondoId, session.id);
      setDocs(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar documentos.');
      setDocs(null);
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitUpload = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1 || !file) {
      return;
    }
    const t = title.trim();
    if (!t) {
      window.alert('Informe o título do documento.');
      return;
    }
    const dt = docType.trim();
    if (!dt) {
      window.alert('Selecione o tipo.');
      return;
    }
    const visibleToAll = docVisibleToAll;
    const selectedRoles = DOCUMENT_VIEWER_ROLE_OPTIONS.filter((r) => docViewerRoles[r]);
    if (!visibleToAll && selectedRoles.length === 0) {
      window.alert('Selecione pelo menos um perfil que pode visualizar o documento, ou marque «Todos».');
      return;
    }
    setUploading(true);
    try {
      const f = fileWithReliableMime(file);
      await uploadCondoDocument({
        condoId: effectiveCondoId,
        userId: session.id,
        documentType: dt,
        title: t,
        description: description.trim() || null,
        file: f,
        visibleToAll,
        viewerRoles: visibleToAll ? undefined : [...selectedRoles],
      });
      setUploadOpen(false);
      setTitle('');
      setDescription('');
      setFile(null);
      setDocType(PRESET_DOC_TYPES[0]);
      resetUploadAudience();
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Falha no envio.');
    } finally {
      setUploading(false);
    }
  };

  const openEditForRow = (row: CondoDocumentRow) => {
    setEditingRow(row);
    setEditTitle(str(row.title));
    setEditDescription(str(row.description));
    const p = str(row.document_type);
    if ((PRESET_DOC_TYPES as readonly string[]).includes(p)) {
      setEditDocType(p);
      setEditCustomType('');
    } else if (p) {
      setEditDocType('Outro');
      setEditCustomType(p);
    } else {
      setEditDocType(PRESET_DOC_TYPES[0]);
      setEditCustomType('');
    }
    setEditVisibleToAll(rowVisibleToAll(row));
    setEditViewerRoles(viewerRoleChecksFromRow(row));
  };

  const closeEdit = () => {
    setEditingRow(null);
    setEditSaving(false);
  };

  const submitEdit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || !editingRow || effectiveCondoId < 1) {
      return;
    }
    const t = editTitle.trim();
    if (!t) {
      window.alert('Informe o título do documento.');
      return;
    }
    const dt = editDocType === 'Outro' ? editCustomType.trim() : editDocType.trim();
    if (!dt || dt.length > 80) {
      window.alert('Tipo inválido (até 80 caracteres).');
      return;
    }
    const visibleToAll = editVisibleToAll;
    const selectedRoles = DOCUMENT_VIEWER_ROLE_OPTIONS.filter((r) => editViewerRoles[r]);
    if (!visibleToAll && selectedRoles.length === 0) {
      window.alert('Selecione pelo menos um perfil que pode visualizar o documento, ou marque «Todos».');
      return;
    }
    setEditSaving(true);
    try {
      await updateCondoDocument({
        id: num(editingRow.id),
        condoId: effectiveCondoId,
        userId: session.id,
        documentType: dt,
        title: t,
        description: editDescription.trim() || null,
        visibleToAll,
        viewerRoles: visibleToAll ? [] : [...selectedRoles],
      });
      closeEdit();
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Falha ao guardar.');
    } finally {
      setEditSaving(false);
    }
  };

  const onDelete = async (row: CondoDocumentRow) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const id = num(row.id);
    const tit = str(row.title);
    if (!window.confirm(`Excluir «${tit}»?`)) {
      return;
    }
    try {
      await deleteCondoDocument(id, effectiveCondoId, session.id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  };

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Documentos" backTo="/app">
      <div className="staff-hero">
        <h2>Materiais oficiais do condomínio</h2>
        <p className="staff-muted">
          Lista e transferência via `/api/documents` e ficheiros em `/uploads`, como no app móvel.
        </p>
      </div>

      <div className="portal-inline" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <button type="button" className="portal-btn" onClick={() => void load()}>
          Atualizar
        </button>
        {able ? (
          <button
            type="button"
            className="portal-btn portal-btn--primary"
            onClick={() => {
              resetUploadAudience();
              setUploadOpen(true);
            }}
          >
            Enviar documento
          </button>
        ) : null}
        {picksCondoBeforeContact(session.role) ? (
          <span className="staff-muted">
            Condomínio: {effectiveCondoId} · {labelPt(session.role)}
          </span>
        ) : null}
      </div>

      {effectiveCondoId < 1 ? (
        <p className="staff-error">Selecione um condomínio válido (parâmetro condoId na URL).</p>
      ) : null}

      {err ? <p className="staff-error">{err}</p> : null}

      {loading ? (
        <p>A carregar…</p>
      ) : !docs || docs.length === 0 ? (
        <p className="staff-muted">Nenhum documento registado neste condomínio.</p>
      ) : (
        <ul className="staff-list">
          {docs.map((row) => {
            const id = num(row.id);
            const stor = str(row.storage_path);
            const href = uploadsUrl(stor);
            const created = str(row.created_at);
            return (
              <li key={id}>
                <div>
                  <strong>{str(row.title)}</strong>
                  <div className="staff-muted" style={{ marginTop: 4 }}>
                    {str(row.document_type)} · {str(row.file_name)} ·{' '}
                    {row.byte_size != null ? `${num(row.byte_size)} bytes · ` : ''}
                    {created ? formatWhen(created) : ''}
                    {able && !rowVisibleToAll(row) ? (
                      <>
                        {' · '}
                        <span title={rowViewerRolesLabels(row)}>
                          Visível apenas a: {rowViewerRolesLabels(row) || 'perfis selecionados'}
                        </span>
                      </>
                    ) : null}
                  </div>
                  {str(row.description) ? <p>{str(row.description)}</p> : null}
                  <div className="portal-inline" style={{ marginTop: 8 }}>
                    <a className="portal-btn" href={href} target="_blank" rel="noreferrer">
                      Abrir / transferir
                    </a>
                    {able && canEditDocumentRow(session, row) ? (
                      <button type="button" className="portal-btn" onClick={() => openEditForRow(row)}>
                        Editar
                      </button>
                    ) : null}
                    {able ? (
                      <button type="button" className="portal-link-danger" onClick={() => void onDelete(row)}>
                        Excluir
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {uploadOpen ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 520 }}>
            <h3>Enviar documento</h3>
            <form onSubmit={(e) => void submitUpload(e)}>
              <label>
                Tipo
                <select
                  className="portal-input"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                >
                  {PRESET_DOC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Título
                <input
                  className="portal-input"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Descrição (opcional)
                <textarea
                  className="portal-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </label>
              <label>
                Ficheiro (PDF, Word, Excel, imagens, TXT — até 16 MB)
                <input
                  className="portal-input"
                  type="file"
                  required
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <fieldset
                style={{
                  marginTop: 12,
                  border: '1px solid var(--portal-border, #ddd)',
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <legend className="staff-muted" style={{ padding: '0 6px' }}>
                  Quem pode visualizar
                </legend>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input
                    type="radio"
                    name="docAudience"
                    checked={docVisibleToAll}
                    onChange={() => setDocVisibleToAll(true)}
                  />
                  Todos no condomínio
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <input
                    type="radio"
                    name="docAudience"
                    checked={!docVisibleToAll}
                    onChange={() => setDocVisibleToAll(false)}
                  />
                  Apenas os perfis assinalados abaixo
                </label>
                {!docVisibleToAll ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginLeft: 24 }}>
                    {DOCUMENT_VIEWER_ROLE_OPTIONS.map((roleKey) => (
                      <label key={roleKey} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={docViewerRoles[roleKey] === true}
                          onChange={(e) =>
                            setDocViewerRoles((prev) => ({
                              ...prev,
                              [roleKey]: e.target.checked,
                            }))
                          }
                        />
                        {labelPt(roleKey)}
                      </label>
                    ))}
                  </div>
                ) : null}
              </fieldset>
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={uploading}>
                  {uploading ? 'A enviar…' : 'Enviar'}
                </button>
                <button
                  type="button"
                  className="portal-btn"
                  onClick={() => {
                    setUploadOpen(false);
                    resetUploadAudience();
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editingRow ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 520 }}>
            <h3>Editar documento</h3>
            <p className="staff-muted" style={{ marginTop: 0 }}>
              Ficheiro: {str(editingRow.file_name)} (o arquivo em si não pode ser substituído aqui)
            </p>
            <form onSubmit={(e) => void submitEdit(e)}>
              <label>
                Tipo
                <select
                  className="portal-input"
                  value={editDocType}
                  onChange={(e) => setEditDocType(e.target.value)}
                >
                  {PRESET_DOC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              {editDocType === 'Outro' ? (
                <label>
                  Descreva o tipo
                  <input
                    className="portal-input"
                    required
                    value={editCustomType}
                    onChange={(e) => setEditCustomType(e.target.value)}
                    maxLength={80}
                  />
                </label>
              ) : null}
              <label>
                Título
                <input
                  className="portal-input"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </label>
              <label>
                Descrição (opcional)
                <textarea
                  className="portal-input"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                />
              </label>
              <fieldset
                style={{
                  marginTop: 12,
                  border: '1px solid var(--portal-border, #ddd)',
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <legend className="staff-muted" style={{ padding: '0 6px' }}>
                  Quem pode visualizar
                </legend>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input
                    type="radio"
                    name="editDocAudience"
                    checked={editVisibleToAll}
                    onChange={() => setEditVisibleToAll(true)}
                  />
                  Todos no condomínio
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <input
                    type="radio"
                    name="editDocAudience"
                    checked={!editVisibleToAll}
                    onChange={() => setEditVisibleToAll(false)}
                  />
                  Apenas os perfis assinalados abaixo
                </label>
                {!editVisibleToAll ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginLeft: 24 }}>
                    {DOCUMENT_VIEWER_ROLE_OPTIONS.map((roleKey) => (
                      <label key={roleKey} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={editViewerRoles[roleKey] === true}
                          onChange={(e) =>
                            setEditViewerRoles((prev) => ({
                              ...prev,
                              [roleKey]: e.target.checked,
                            }))
                          }
                        />
                        {labelPt(roleKey)}
                      </label>
                    ))}
                  </div>
                ) : null}
              </fieldset>
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={editSaving}>
                  {editSaving ? 'A guardar…' : 'Guardar'}
                </button>
                <button type="button" className="portal-btn" onClick={() => closeEdit()} disabled={editSaving}>
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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { uploadsUrl } from '../api';
import { CondoUserRoles, isBillingStaff, labelPt, picksCondoBeforeContact } from '../condoUserRoles';
import {
  createLostFoundItem,
  deleteLostFoundItem,
  getLostFoundStats,
  getUnitsForCondo,
  listLostFound,
  patchLostFoundItem,
  postLostFoundAchei,
  uploadLostFoundPhoto,
  type LostFoundRow,
  type UnitRow,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const ACHEI_MAX = 600;

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

function parseAcheiTips(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
}

function photoUrlsFromRow(row: LostFoundRow): string[] {
  const out: string[] = [];
  const raw = row.photo_urls;
  if (Array.isArray(raw)) {
    for (const value of raw) {
      const text = str(value).trim();
      if (text && !out.includes(text)) {
        out.push(text);
      }
    }
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const decoded = JSON.parse(raw) as unknown;
      if (Array.isArray(decoded)) {
        for (const value of decoded) {
          const text = str(value).trim();
          if (text && !out.includes(text)) {
            out.push(text);
          }
        }
      }
    } catch {
      out.push(raw.trim());
    }
  }
  const single = str(row.photo_url).trim();
  if (single && !out.includes(single)) {
    out.unshift(single);
  }
  return out.slice(0, 4);
}

function unitLabel(u: UnitRow): string {
  const t = str(u.tower).trim();
  const n = str(u.number).trim();
  return `${t}${t && n ? ' · ' : ''}${n}` || `Unidade ${num(u.id)}`;
}

export function LostFoundPage() {
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

  const isResident = session?.role === CondoUserRoles.resident;

  const [stats, setStats] = useState<{ totalLost: number; openLost: number; resolvedLost: number } | null>(null);
  const [items, setItems] = useState<LostFoundRow[] | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [kindTab, setKindTab] = useState<'lost' | 'found' | 'all'>('lost');
  const [includeClosed, setIncludeClosed] = useState(false);
  /** Perdidos resolvidos: morador = só os seus; síndico/admin = todas as unidades. */
  const [listMode, setListMode] = useState<'active' | 'history'>('active');

  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [itemModal, setItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<LostFoundRow | null>(null);
  const [formUnit, setFormUnit] = useState<number>(0);
  const [formKind, setFormKind] = useState<'lost' | 'found'>('lost');
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formHint, setFormHint] = useState('');
  const [formPhotoFiles, setFormPhotoFiles] = useState<File[]>([]);
  const [formPhotoUrls, setFormPhotoUrls] = useState<string[]>([]);
  const [itemSaving, setItemSaving] = useState(false);

  const [acheiText, setAcheiText] = useState<Record<number, string>>({});

  const loadUnits = useCallback(async () => {
    if (effectiveCondoId < 1) {
      return;
    }
    try {
      const u = await getUnitsForCondo(effectiveCondoId);
      setUnits(u);
      if (session?.unitId != null) {
        setFormUnit(session.unitId);
      } else if (u.length > 0) {
        setFormUnit(num(u[0].id));
      }
    } catch {
      setUnits([]);
    }
  }, [effectiveCondoId, session?.unitId]);

  const reload = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      setItems([]);
      setStats(null);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const kindParam = kindTab === 'all' ? undefined : kindTab;
      const [list, st] = await Promise.all([
        listMode === 'history'
          ? listLostFound({
              condoId: effectiveCondoId,
              userId: session.id,
              history: true,
            })
          : listLostFound({
              condoId: effectiveCondoId,
              userId: session.id,
              kind: kindParam,
              onlyOpen: includeClosed ? false : true,
            }),
        getLostFoundStats(effectiveCondoId, session.id),
      ]);
      setItems(list);
      setStats(st);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
      setItems(null);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId, kindTab, includeClosed, listMode]);

  useEffect(() => {
    void loadUnits();
  }, [loadUnits]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleEx = (id: number) => {
    const n = new Set(expanded);
    if (n.has(id)) {
      n.delete(id);
    } else {
      n.add(id);
    }
    setExpanded(n);
  };

  const openCreate = () => {
    setEditingItem(null);
    setFormKind('lost');
    setFormTitle('');
    setFormDesc('');
    setFormHint('');
    setFormPhotoFiles([]);
    setFormPhotoUrls([]);
    if (session?.unitId != null) {
      setFormUnit(session.unitId);
    } else if (units.length > 0) {
      setFormUnit(num(units[0].id));
    }
    setItemModal(true);
  };

  const openEdit = (row: LostFoundRow) => {
    setEditingItem(row);
    setFormKind((str(row.kind) as 'lost' | 'found') || 'lost');
    setFormTitle(str(row.title));
    setFormDesc(str(row.description));
    setFormHint(str(row.contact_hint));
    setFormUnit(num(row.unit_id));
    setFormPhotoFiles([]);
    setFormPhotoUrls(photoUrlsFromRow(row));
    setItemModal(true);
  };

  const saveItem = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const title = formTitle.trim();
    if (!title) {
      window.alert('Informe um título.');
      return;
    }
    if (!formUnit || formUnit < 1) {
      window.alert('Selecione a unidade.');
      return;
    }

    setItemSaving(true);
    try {
      const photoUrls = [...formPhotoUrls];
      for (const file of formPhotoFiles.slice(0, Math.max(0, 4 - photoUrls.length))) {
        const up = await uploadLostFoundPhoto(effectiveCondoId, session.id, file);
        if (up.photoUrl) {
          photoUrls.push(up.photoUrl);
        }
      }
      const limitedPhotoUrls = photoUrls.slice(0, 4);
      const photoUrl = limitedPhotoUrls[0] ?? null;

      if (editingItem) {
        await patchLostFoundItem(num(editingItem.id), {
          condoId: effectiveCondoId,
          userId: session.id,
          unitId: formUnit,
          title,
          description: formDesc.trim() || null,
          contactHint: formHint.trim() || null,
          photoUrl: photoUrl ?? null,
          photoUrls: limitedPhotoUrls,
          kind: formKind,
        });
      } else {
        await createLostFoundItem({
          condoId: effectiveCondoId,
          userId: session.id,
          unitId: formUnit,
          kind: formKind,
          title,
          description: formDesc.trim() || null,
          contactHint: formHint.trim() || null,
          photoUrl: photoUrl ?? null,
          photoUrls: limitedPhotoUrls,
        });
      }
      setItemModal(false);
      await reload();
      window.alert(editingItem ? 'Atualizado.' : 'Registo criado.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao guardar.');
    } finally {
      setItemSaving(false);
    }
  };

  const onDelete = async (row: LostFoundRow) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    if (!window.confirm(`Remover «${str(row.title)}»?`)) {
      return;
    }
    try {
      await deleteLostFoundItem(num(row.id), effectiveCondoId, session.id);
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  };

  const onMarkResolved = async (row: LostFoundRow) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    try {
      await patchLostFoundItem(num(row.id), {
        condoId: effectiveCondoId,
        userId: session.id,
        status: 'resolved',
      });
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro.');
    }
  };

  const submitAchei = async (row: LostFoundRow) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const id = num(row.id);
    const msg = (acheiText[id] ?? '').trim();
    if (!msg) {
      return;
    }
    if (msg.length > ACHEI_MAX) {
      window.alert(`Máximo ${ACHEI_MAX} caracteres.`);
      return;
    }
    try {
      await postLostFoundAchei(id, {
        condoId: effectiveCondoId,
        userId: session.id,
        message: msg,
      });
      setAcheiText((t) => ({ ...t, [id]: '' }));
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao enviar.');
    }
  };

  const isCreator = (row: LostFoundRow) => session != null && num(row.created_by_user_id) === session.id;
  const canDeleteRow = (row: LostFoundRow) =>
    session != null && (isCreator(row) || isBillingStaff(session.role));

  if (!session) {
    return null;
  }

  const residentUnitLocked = isResident && session.unitId != null;

  return (
    <StaffLayout title="Achados e perdidos" backTo="/app">
      <div className="staff-hero">
        <h2>Itens perdidos ou encontrados</h2>
        <p className="staff-muted">
          Parceiros não utilizam esta área (`/api/lost-found`). Mensagens «Achei» até {ACHEI_MAX} caracteres.
        </p>
      </div>

      <div className="portal-inline" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          className={`portal-btn ${listMode === 'active' ? 'portal-btn--primary' : ''}`}
          onClick={() => setListMode('active')}
        >
          Lista atual
        </button>
        <button
          type="button"
          className={`portal-btn ${listMode === 'history' ? 'portal-btn--primary' : ''}`}
          onClick={() => setListMode('history')}
        >
          Histórico
        </button>
        {listMode === 'active' ? (
          <>
            <button type="button" className={`portal-btn ${kindTab === 'lost' ? 'portal-btn--primary' : ''}`} onClick={() => setKindTab('lost')}>
              Perdidos
            </button>
            <button type="button" className={`portal-btn ${kindTab === 'found' ? 'portal-btn--primary' : ''}`} onClick={() => setKindTab('found')}>
              Achados
            </button>
            <button type="button" className={`portal-btn ${kindTab === 'all' ? 'portal-btn--primary' : ''}`} onClick={() => setKindTab('all')}>
              Todos
            </button>
            <label className="staff-muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
              Incluir encerrados
            </label>
          </>
        ) : (
          <span className="staff-muted">
            Perdidos já marcados como encontrados/resolvidos.
            {isBillingStaff(session.role) ? ' Todas as unidades do condomínio.' : ' Apenas os seus registos.'}
          </span>
        )}
        <button type="button" className="portal-btn portal-btn--primary" onClick={openCreate}>
          Novo registo
        </button>
        <button type="button" className="portal-btn" onClick={() => void reload()}>
          Atualizar
        </button>
        {picksCondoBeforeContact(session.role) ? (
          <span className="staff-muted">
            Condomínio: {effectiveCondoId} · {labelPt(session.role)}
          </span>
        ) : null}
      </div>

      {stats ? (
        <p className="staff-muted">
          Perdidos: {stats.totalLost} · em aberto: {stats.openLost} · encontrados/resolvidos: {stats.resolvedLost}
        </p>
      ) : null}

      {effectiveCondoId < 1 ? <p className="staff-error">Condomínio inválido.</p> : null}
      {err ? <p className="staff-error">{err}</p> : null}

      {loading && !items?.length ? (
        <p>A carregar…</p>
      ) : !items?.length ? (
        <p className="staff-muted">Nenhum registo neste filtro.</p>
      ) : (
        <ul className="staff-list">
          {items.map((row) => {
            const id = num(row.id);
            const open = expanded.has(id);
            const tips = parseAcheiTips(row.achei_tips);
            const photos = photoUrlsFromRow(row);
            const stOpen = str(row.status) !== 'resolved';
            const historyCompact = listMode === 'history';
            return (
              <li key={id}>
                <button
                  type="button"
                  className="portal-offer-head"
                  onClick={() => toggleEx(id)}
                  style={
                    historyCompact
                      ? { padding: '10px 12px', alignItems: 'center' as const }
                      : undefined
                  }
                >
                  {historyCompact ? (
                    <span
                      style={{
                        display: 'flex',
                        gap: 10,
                        flex: 1,
                        textAlign: 'left' as const,
                        minWidth: 0,
                        alignItems: 'center',
                      }}
                    >
                      {photos.length > 0 ? (
                        <img
                          src={uploadsUrl(photos[0])}
                          alt=""
                          style={{
                            width: 44,
                            height: 44,
                            objectFit: 'cover',
                            borderRadius: 8,
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <span style={{ fontSize: 20, flexShrink: 0 }} aria-hidden>
                          ✓
                        </span>
                      )}
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <strong
                          style={{
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: '0.95rem',
                          }}
                        >
                          {str(row.title)}
                        </strong>
                        <div className="staff-muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {str(row.unit_tower)} {str(row.unit_number)} · Resolvido
                          {row.updated_at ? ` · ${String(row.updated_at).slice(0, 10)}` : ''}
                        </div>
                      </span>
                    </span>
                  ) : (
                    <span style={{ display: 'flex', gap: 12, flex: 1, textAlign: 'left', minWidth: 0 }}>
                      {photos.length > 0 ? (
                        <span style={{ display: 'flex', gap: 4 }}>
                          {photos.slice(0, 2).map((photo) => (
                            <img
                              key={photo}
                              src={uploadsUrl(photo)}
                              alt=""
                              style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }}
                            />
                          ))}
                        </span>
                      ) : (
                        <span style={{ fontSize: 28 }}>{str(row.kind) === 'found' ? '📌' : '🔎'}</span>
                      )}
                      <span style={{ flex: 1 }}>
                        <strong>{str(row.title)}</strong>
                        <div className="staff-muted">
                          {str(row.kind) === 'found' ? 'Achado' : 'Perdido'} ·{' '}
                          {str(row.unit_tower)} {str(row.unit_number)} ·{' '}
                          {stOpen ? 'Aberto' : 'Encerrado'}
                        </div>
                      </span>
                    </span>
                  )}
                  <span>{open ? '▼' : '▶'}</span>
                </button>
                {open ? (
                  <div className="portal-offer-body">
                    <p>{str(row.description) || '—'}</p>
                    {str(row.contact_hint) ? <p>Orientações: {str(row.contact_hint)}</p> : null}
                    <p className="staff-muted">
                      Por {str(row.created_by_name)} · {tips.length} aviso(s) «Achei»
                    </p>
                    {tips.length > 0 ? (
                      <ul style={{ paddingLeft: 18 }}>
                        {tips.map((t, i) => (
                          <li key={num(t.id) || i}>
                            <strong>{str(t.author_name)}</strong>: {str(t.message)}
                            <span className="staff-muted"> · {str(t.created_at)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {stOpen ? (
                      <div style={{ marginTop: 12 }}>
                        <label>
                          Avisar «Achei»
                          <textarea
                            className="portal-input"
                            rows={2}
                            maxLength={ACHEI_MAX}
                            placeholder={`Até ${ACHEI_MAX} caracteres`}
                            value={acheiText[id] ?? ''}
                            onChange={(e) =>
                              setAcheiText((prev) => ({
                                ...prev,
                                [id]: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <button type="button" className="portal-btn portal-btn--primary" onClick={() => void submitAchei(row)}>
                          Publicar aviso
                        </button>
                      </div>
                    ) : null}
                    <div className="portal-charge-actions" style={{ marginTop: 12 }}>
                      {isCreator(row) ? (
                        <>
                          <button type="button" className="portal-btn" onClick={() => openEdit(row)}>
                            Editar
                          </button>
                          {stOpen ? (
                            <button type="button" className="portal-btn" onClick={() => void onMarkResolved(row)}>
                              Marcar encontrado/resolvido
                            </button>
                          ) : null}
                        </>
                      ) : null}
                      {canDeleteRow(row) ? (
                        <button type="button" className="portal-link-danger" onClick={() => void onDelete(row)}>
                          Excluir
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {itemModal ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 480 }}>
            <h3>{editingItem ? 'Editar registo' : 'Novo registo'}</h3>
            <form onSubmit={(e) => void saveItem(e)}>
              <label>
                Tipo
                <select className="portal-input" value={formKind} onChange={(e) => setFormKind(e.target.value as 'lost' | 'found')}>
                  <option value="lost">Perdido</option>
                  <option value="found">Achado</option>
                </select>
              </label>
              <label>
                Unidade *
                <select
                  className="portal-input"
                  value={formUnit || ''}
                  disabled={residentUnitLocked}
                  onChange={(e) => setFormUnit(Number.parseInt(e.target.value, 10))}
                >
                  {units.map((u) => (
                    <option key={num(u.id)} value={num(u.id)}>
                      {unitLabel(u)}
                    </option>
                  ))}
                </select>
              </label>
              {residentUnitLocked ? <p className="staff-muted">Associado à sua unidade.</p> : null}
              <label>
                Título *
                <input className="portal-input" required value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
              </label>
              <label>
                Descrição
                <textarea className="portal-input" rows={3} value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
              </label>
              <label>
                Dicas de contacto / onde deixar
                <textarea className="portal-input" rows={2} value={formHint} onChange={(e) => setFormHint(e.target.value)} />
              </label>
              <label>
                Fotos (JPEG/PNG/GIF/WEBP, opcional, até 4)
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="portal-input"
                  onChange={(e) => {
                    const selected = Array.from(e.target.files ?? []);
                    const available = Math.max(0, 4 - formPhotoUrls.length);
                    setFormPhotoFiles(selected.slice(0, available));
                  }}
                />
              </label>
              {formPhotoUrls.length > 0 || formPhotoFiles.length > 0 ? (
                <div className="staff-muted">
                  Fotos selecionadas: {formPhotoUrls.length + formPhotoFiles.length}/4
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                    {formPhotoUrls.map((url) => (
                      <button
                        key={url}
                        type="button"
                        className="portal-btn"
                        onClick={() => setFormPhotoUrls((prev) => prev.filter((item) => item !== url))}
                      >
                        Remover foto salva
                      </button>
                    ))}
                    {formPhotoFiles.map((file) => (
                      <button
                        key={`${file.name}-${file.size}`}
                        type="button"
                        className="portal-btn"
                        onClick={() => setFormPhotoFiles((prev) => prev.filter((item) => item !== file))}
                      >
                        Remover {file.name || 'nova foto'}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={itemSaving}>
                  Guardar
                </button>
                <button type="button" className="portal-btn" onClick={() => setItemModal(false)}>
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

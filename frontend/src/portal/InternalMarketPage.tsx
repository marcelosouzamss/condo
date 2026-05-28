import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { uploadsUrl } from '../api';
import {
  CondoUserRoles,
  canPostMarketplaceCondominium,
  canPostMarketplaceResidents,
  isBillingStaff,
  labelPt,
  picksCondoBeforeContact,
} from '../condoUserRoles';
import {
  createMarketplaceListing,
  deleteMarketplaceListing,
  deleteMarketplaceListingPhoto,
  listMarketplaceListings,
  patchMarketplaceListing,
  uploadMarketplaceListingPhoto,
  type MarketplaceListingRow,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const MAX_PHOTOS = 8;

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

export type ListingScopeTab = 'condominium' | 'residents';

function parsePortfolioPhotos(raw: unknown): { id: number; photo_url: string }[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: { id: number; photo_url: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const m = item as Record<string, unknown>;
    const idRaw = m.id;
    const urlRaw = m.photo_url ?? m.photoUrl;
    if (idRaw == null || urlRaw == null) {
      continue;
    }
    const id = typeof idRaw === 'number' ? idRaw : num(idRaw);
    if (id < 1) {
      continue;
    }
    out.push({ id, photo_url: String(urlRaw) });
  }
  return out;
}

function priceLine(row: MarketplaceListingRow): string {
  const amt = row.price_amount;
  const note = str(row.price_note).trim();
  if (amt != null && `${amt}`.trim() !== '' && `${amt}` !== 'null') {
    const n = Number.parseFloat(String(amt));
    if (Number.isFinite(n)) {
      const s = n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
      return `R\$ ${s}${note ? ` · ${note}` : ''}`;
    }
  }
  if (note) {
    return note;
  }
  return 'Valor sob consulta';
}

function mayEditListing(row: MarketplaceListingRow, userId: number, role: string): boolean {
  if (isBillingStaff(role)) {
    return false;
  }
  if (num(row.created_by_user_id) !== userId) {
    return false;
  }
  const scope = str(row.listing_scope || 'residents');
  if (role === CondoUserRoles.resident) {
    return scope === 'residents';
  }
  if (role === CondoUserRoles.partner) {
    return scope === 'condominium';
  }
  if (role === CondoUserRoles.collaborator || role === CondoUserRoles.doorman) {
    return true;
  }
  return false;
}

function mayDeleteListing(row: MarketplaceListingRow, userId: number, role: string): boolean {
  if (isBillingStaff(role)) {
    return true;
  }
  if (num(row.created_by_user_id) !== userId) {
    return false;
  }
  const scope = str(row.listing_scope || 'residents');
  if (role === CondoUserRoles.resident) {
    return scope === 'residents';
  }
  if (role === CondoUserRoles.partner) {
    return scope === 'condominium';
  }
  if (role === CondoUserRoles.collaborator || role === CondoUserRoles.doorman) {
    return true;
  }
  return false;
}

function emptyListingForm() {
  return {
    title: '',
    description: '',
    category: '',
    priceAmount: '',
    priceNote: '',
    contactHint: '',
    contactPhone: '',
    contactEmail: '',
    contactWhatsapp: '',
  };
}

export function InternalMarketPage() {
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

  const [tab, setTab] = useState<ListingScopeTab>('condominium');

  const [condoRows, setCondoRows] = useState<MarketplaceListingRow[] | null>(null);
  const [resRows, setResRows] = useState<MarketplaceListingRow[] | null>(null);
  const [errCondo, setErrCondo] = useState<string | null>(null);
  const [errRes, setErrRes] = useState<string | null>(null);
  const [loadingCondo, setLoadingCondo] = useState(true);
  const [loadingRes, setLoadingRes] = useState(true);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MarketplaceListingRow | null>(null);
  const [form, setForm] = useState(() => emptyListingForm());
  const [existingPhotos, setExistingPhotos] = useState<{ id: number; photo_url: string }[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const canPostCondo = session ? canPostMarketplaceCondominium(session.role) : false;
  const canPostResidents = session ? canPostMarketplaceResidents(session.role) : false;

  const loadScope = useCallback(
    async (scope: ListingScopeTab) => {
      if (!session || effectiveCondoId < 1) {
        if (scope === 'condominium') {
          setCondoRows([]);
          setLoadingCondo(false);
        } else {
          setResRows([]);
          setLoadingRes(false);
        }
        return;
      }
      if (scope === 'condominium') {
        setErrCondo(null);
        setLoadingCondo(true);
      } else {
        setErrRes(null);
        setLoadingRes(true);
      }
      try {
        const rows = await listMarketplaceListings({
          condoId: effectiveCondoId,
          listingScope: scope,
        });
        if (scope === 'condominium') {
          setCondoRows(rows);
        } else {
          setResRows(rows);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erro ao carregar.';
        if (scope === 'condominium') {
          setErrCondo(msg);
          setCondoRows(null);
        } else {
          setErrRes(msg);
          setResRows(null);
        }
      } finally {
        if (scope === 'condominium') {
          setLoadingCondo(false);
        } else {
          setLoadingRes(false);
        }
      }
    },
    [session, effectiveCondoId],
  );

  const reloadAll = useCallback(async () => {
    await Promise.all([loadScope('condominium'), loadScope('residents')]);
  }, [loadScope]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  const items = tab === 'condominium' ? condoRows : resRows;
  const loading = tab === 'condominium' ? loadingCondo : loadingRes;
  const err = tab === 'condominium' ? errCondo : errRes;

  const openCreate = () => {
    setEditing(null);
    setForm(emptyListingForm());
    setExistingPhotos([]);
    setPendingFiles([]);
    setEditorOpen(true);
  };

  const openEdit = (row: MarketplaceListingRow) => {
    setEditing(row);
    setForm({
      title: str(row.title),
      description: str(row.description),
      category: str(row.category),
      priceAmount:
        row.price_amount != null && `${row.price_amount}` !== '' && `${row.price_amount}` !== 'null'
          ? String(row.price_amount)
          : '',
      priceNote: str(row.price_note),
      contactHint: str(row.contact_hint),
      contactPhone: str(row.contact_phone),
      contactEmail: str(row.contact_email),
      contactWhatsapp: str(row.contact_whatsapp),
    });
    setExistingPhotos(parsePortfolioPhotos(row.portfolio_photos));
    setPendingFiles([]);
    setEditorOpen(true);
  };

  const photoCount = existingPhotos.length + pendingFiles.length;
  const photoRoom = MAX_PHOTOS - photoCount;

  const toggleExpanded = (id: number) => {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setExpanded(next);
  };

  const onPickFiles = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const list = ev.target.files;
    if (!list?.length || photoRoom <= 0) {
      return;
    }
    const next: File[] = [...pendingFiles];
    for (let i = 0; i < list.length && next.length + existingPhotos.length < MAX_PHOTOS; i++) {
      const f = list.item(i);
      if (f) {
        next.push(f);
      }
    }
    setPendingFiles(next);
    ev.target.value = '';
  };

  const submitEditor = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const title = form.title.trim();
    if (!title) {
      window.alert('Informe o título.');
      return;
    }
    let priceAmount: number | null = null;
    const pt = form.priceAmount.trim();
    if (pt) {
      const p = Number.parseFloat(pt.replace(',', '.'));
      if (!Number.isFinite(p) || p < 0) {
        window.alert('Preço inválido.');
        return;
      }
      priceAmount = p;
    }

    const bodyShared = {
      condoId: effectiveCondoId,
      userId: session.id,
      title,
      description: form.description.trim() || null,
      category: form.category.trim() || null,
      priceAmount,
      priceNote: form.priceNote.trim() || null,
      contactHint: form.contactHint.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
      contactEmail: form.contactEmail.trim() || null,
      contactWhatsapp: form.contactWhatsapp.trim() || null,
    };

    setSaving(true);
    try {
      let listingId: number;
      if (editing) {
        listingId = num(editing.id);
        await patchMarketplaceListing(listingId, bodyShared);
      } else {
        const created = await createMarketplaceListing({
          ...bodyShared,
          listingScope: tab,
        });
        listingId = num(created.id);
      }

      for (const f of pendingFiles) {
        await uploadMarketplaceListingPhoto(listingId, effectiveCondoId, session.id, f);
      }

      setEditorOpen(false);
      await reloadAll();
      window.alert(editing ? 'Anúncio atualizado.' : 'Anúncio criado.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao guardar.');
    } finally {
      setSaving(false);
    }
  };

  const removeExistingPhoto = async (ph: { id: number; photo_url: string }) => {
    if (!session || !editing || effectiveCondoId < 1) {
      return;
    }
    if (!window.confirm('Remover esta imagem do servidor?')) {
      return;
    }
    try {
      await deleteMarketplaceListingPhoto(num(editing.id), ph.id, effectiveCondoId, session.id);
      setExistingPhotos((xs) => xs.filter((x) => x.id !== ph.id));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao remover foto.');
    }
  };

  const onDeleteListing = async (row: MarketplaceListingRow) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const id = num(row.id);
    const tit = str(row.title);
    if (!window.confirm(`Remover «${tit}»?`)) {
      return;
    }
    try {
      await deleteMarketplaceListing(id, effectiveCondoId, session.id);
      await reloadAll();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  };

  if (!session) {
    return null;
  }

  const showFab =
    (tab === 'condominium' && canPostCondo) || (tab === 'residents' && canPostResidents);

  const tabHint =
    tab === 'condominium'
      ? canPostCondo
        ? 'Anúncios da administração, síndico e parceiros.'
        : 'Somente administração, síndico e parceiros publicam nesta aba.'
      : canPostResidents
        ? 'Anúncios de moradores e do síndico.'
        : 'Somente moradores e síndico publicam nesta aba.';

  return (
    <StaffLayout title="Mercado interno" backTo="/app">
      <div className="staff-hero">
        <h2>Anúncios entre condôminos</h2>
        <p className="staff-muted">Duas áreas (`listing_scope`) e mesma API do app móvel.</p>
      </div>

      <div className="portal-inline" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className={`portal-btn ${tab === 'condominium' ? 'portal-btn--primary' : ''}`}
          onClick={() => setTab('condominium')}
        >
          Condomínio
        </button>
        <button
          type="button"
          className={`portal-btn ${tab === 'residents' ? 'portal-btn--primary' : ''}`}
          onClick={() => setTab('residents')}
        >
          Moradores
        </button>
        {showFab ? (
          <button type="button" className="portal-btn portal-btn--primary" onClick={openCreate}>
            {tab === 'condominium' ? 'Anúncio condomínio' : 'Anúncio moradores'}
          </button>
        ) : null}
        <button type="button" className="portal-btn" onClick={() => void reloadAll()}>
          Atualizar
        </button>
        {picksCondoBeforeContact(session.role) ? (
          <span className="staff-muted">
            Condomínio: {effectiveCondoId} · {labelPt(session.role)}
          </span>
        ) : null}
      </div>

      <p className="staff-muted" style={{ marginBottom: 16 }}>
        {tabHint}
      </p>

      {effectiveCondoId < 1 ? (
        <p className="staff-error">Selecione um condomínio válido (query condoId).</p>
      ) : null}

      {err ? <p className="staff-error">{err}</p> : null}

      {loading && (!items || items.length === 0) ? (
        <p>A carregar…</p>
      ) : !items || items.length === 0 ? (
        <p className="staff-muted">
          {tab === 'condominium'
            ? `Nenhum anúncio do condomínio. ${canPostCondo ? 'Use «Anúncio condomínio» para publicar.' : ''}`
            : `Nenhum anúncio dos moradores. ${canPostResidents ? 'Use «Anúncio moradores» para publicar.' : ''}`}
        </p>
      ) : (
        <ul className="staff-list">
          {items.map((row) => {
            const id = num(row.id);
            const open = expanded.has(id);
            const photos = parsePortfolioPhotos(row.portfolio_photos);
            const thumb = photos[0]?.photo_url;
            return (
              <li key={id}>
                <button type="button" className="portal-offer-head" onClick={() => toggleExpanded(id)}>
                  <span style={{ display: 'flex', gap: 12, alignItems: 'stretch', flex: 1 }}>
                    <span
                      style={{
                        width: 72,
                        height: 72,
                        flexShrink: 0,
                        borderRadius: 8,
                        overflow: 'hidden',
                        background: 'rgba(0,0,0,0.06)',
                      }}
                    >
                      {thumb ? (
                        <img
                          src={uploadsUrl(thumb)}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <span
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            fontSize: 28,
                          }}
                        >
                          🏪
                        </span>
                      )}
                    </span>
                    <span style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                      <strong>{str(row.title)}</strong>
                      <div className="staff-muted">{priceLine(row)}</div>
                      {str(row.category) ? <div className="staff-muted">{str(row.category)}</div> : null}
                    </span>
                  </span>
                  <span>{open ? '▼' : '▶'}</span>
                </button>
                {open ? (
                  <div className="portal-offer-body">
                    <p>{str(row.description) || '—'}</p>
                    <p className="staff-muted">
                      {(str(row.created_by_name) && `Publicado por ${str(row.created_by_name)}`) || ''}
                    </p>
                    <div style={{ marginTop: 12 }}>
                      <strong>Contatos</strong>
                      {[str(row.contact_phone), str(row.contact_email), str(row.contact_whatsapp)]
                        .filter(Boolean)
                        .length === 0 && !str(row.contact_hint) ? (
                        <p className="staff-muted">Nenhum contato informado.</p>
                      ) : (
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                          {str(row.contact_phone) ? (
                            <li>
                              Tel.:{' '}
                              <a href={`tel:${str(row.contact_phone).replace(/\s/g, '')}`}>
                                {str(row.contact_phone)}
                              </a>
                            </li>
                          ) : null}
                          {str(row.contact_email) ? (
                            <li>
                              E-mail:{' '}
                              <a href={`mailto:${str(row.contact_email).trim()}`}>{str(row.contact_email)}</a>
                            </li>
                          ) : null}
                          {str(row.contact_whatsapp) ? (
                            <li>
                              WhatsApp:{' '}
                              <a
                                href={`https://wa.me/${str(row.contact_whatsapp).replace(/\D/g, '')}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {str(row.contact_whatsapp)}
                              </a>
                            </li>
                          ) : null}
                          {str(row.contact_hint) ? <li>Obs.: {str(row.contact_hint)}</li> : null}
                        </ul>
                      )}
                    </div>
                    {photos.length > 0 ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                        {photos.map((p) => (
                          <a key={p.id} href={uploadsUrl(p.photo_url)} target="_blank" rel="noreferrer">
                            <img
                              src={uploadsUrl(p.photo_url)}
                              alt=""
                              style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8 }}
                            />
                          </a>
                        ))}
                      </div>
                    ) : null}
                    <div className="portal-charge-actions" style={{ marginTop: 14 }}>
                      {mayEditListing(row, session.id, session.role) ? (
                        <button type="button" className="portal-btn" onClick={() => openEdit(row)}>
                          Editar
                        </button>
                      ) : null}
                      {mayDeleteListing(row, session.id, session.role) ? (
                        <button type="button" className="portal-link-danger" onClick={() => void onDeleteListing(row)}>
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

      {editorOpen ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 520 }}>
            <h3>{editing ? 'Editar anúncio' : 'Novo anúncio'}</h3>
            <form onSubmit={(e) => void submitEditor(e)}>
              {!editing ? (
                <p className="staff-muted">Área: {tab === 'condominium' ? 'do condomínio' : 'dos moradores'}</p>
              ) : null}
              <label>
                Título *
                <input
                  className="portal-input"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>
              <label>
                Descrição
                <textarea
                  className="portal-input"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              <label>
                Categoria
                <input
                  className="portal-input"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </label>
              <label>
                Preço (número, opcional)
                <input
                  className="portal-input"
                  value={form.priceAmount}
                  onChange={(e) => setForm({ ...form, priceAmount: e.target.value })}
                />
              </label>
              <label>
                Detalhe do preço / observação
                <input
                  className="portal-input"
                  value={form.priceNote}
                  onChange={(e) => setForm({ ...form, priceNote: e.target.value })}
                />
              </label>
              <label>
                Observações de contacto
                <textarea
                  className="portal-input"
                  rows={2}
                  value={form.contactHint}
                  onChange={(e) => setForm({ ...form, contactHint: e.target.value })}
                />
              </label>
              <label>
                Telefone
                <input
                  className="portal-input"
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                />
              </label>
              <label>
                E-mail
                <input
                  className="portal-input"
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                />
              </label>
              <label>
                WhatsApp
                <input
                  className="portal-input"
                  value={form.contactWhatsapp}
                  onChange={(e) => setForm({ ...form, contactWhatsapp: e.target.value })}
                />
              </label>

              <p className="staff-muted" style={{ marginTop: 12 }}>
                Fotos (até {MAX_PHOTOS}, JPEG/PNG/GIF/WEBP) — imagens já no servidor são removidas de imediato.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {existingPhotos.map((ph) => (
                  <div key={ph.id} style={{ position: 'relative' }}>
                    <img
                      src={uploadsUrl(ph.photo_url)}
                      alt=""
                      style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 8 }}
                    />
                    {editing ? (
                      <button
                        type="button"
                        className="portal-link-danger"
                        style={{ marginTop: 4, fontSize: 12 }}
                        onClick={() => void removeExistingPhoto(ph)}
                      >
                        Remover
                      </button>
                    ) : null}
                  </div>
                ))}
                {pendingFiles.map((f, i) => (
                  <div key={`${f.name}-${i}`}>
                    <div
                      style={{
                        width: 88,
                        height: 88,
                        borderRadius: 8,
                        background: 'rgba(0,0,0,0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                      }}
                    >
                      Novo
                    </div>
                    <button type="button" className="portal-btn" style={{ marginTop: 4 }} onClick={() => setPendingFiles((xs) => xs.filter((_x, j) => j !== i))}>
                      Remover da fila
                    </button>
                  </div>
                ))}
              </div>
              {photoRoom > 0 ? (
                <label>
                  Adicionar imagens ({photoCount}/{MAX_PHOTOS})
                  <input type="file" accept="image/*" multiple className="portal-input" onChange={onPickFiles} />
                </label>
              ) : null}

              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={saving}>
                  {saving ? 'A guardar…' : editing ? 'Salvar' : 'Publicar'}
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

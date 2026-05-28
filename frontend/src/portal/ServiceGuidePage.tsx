import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { uploadsUrl } from '../api';
import {
  CondoUserRoles,
  canManageServiceGuideCatalog,
  isOperationalStaff,
  labelPt,
  picksCondoBeforeContact,
} from '../condoUserRoles';
import {
  createServiceGuideCatalog,
  createServiceGuideRequest,
  deleteServiceGuideCatalog,
  deleteServiceGuideCatalogPhoto,
  getCondosForContactPicker,
  getServiceGuideOverview,
  listServiceGuideCatalog,
  listServiceGuideRequests,
  patchServiceGuideCatalog,
  patchServiceGuideRequest,
  uploadServiceGuideCatalogPhoto,
  type CondoPickerRow,
  type ServiceGuideCatalogRow,
  type ServiceGuideOverview,
  type ServiceGuideRequestRow,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const MAX_PHOTOS = 12;

type ScopeTab = 'unit' | 'condo';

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

function parsePortfolioPhotos(raw: unknown): { id: number; photo_url: string }[] {
  let decoded: unknown = raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      decoded = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(decoded)) {
    return [];
  }
  const out: { id: number; photo_url: string }[] = [];
  for (const item of decoded) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const m = item as Record<string, unknown>;
    const id = num(m.id);
    const url = m.photo_url ?? m.photoUrl;
    if (id > 0 && url != null) {
      out.push({ id, photo_url: String(url) });
    }
  }
  return out;
}

function emptyCatalogForm(scope: ScopeTab) {
  return {
    title: '',
    description: '',
    category: '',
    providerName: '',
    providerPhone: '',
    providerEmail: '',
    providerWhatsapp: '',
    sortOrder: '0',
    scope,
    visible: true,
    active: true,
  };
}

export function ServiceGuidePage() {
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

  const canManage = session ? canManageServiceGuideCatalog(session.role) : false;
  const isStaff = session ? isOperationalStaff(session.role) : false;
  const isResident = session?.role === CondoUserRoles.resident;
  const canRequestService = !!(session?.unitId != null && isResident);

  const [tab, setTab] = useState<ScopeTab>('unit');
  const [overview, setOverview] = useState<ServiceGuideOverview | null>(null);
  const [catalog, setCatalog] = useState<ServiceGuideCatalogRow[] | null>(null);
  const [requests, setRequests] = useState<ServiceGuideRequestRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [expandedReq, setExpandedReq] = useState<Set<number>>(new Set());

  const [catalogModal, setCatalogModal] = useState(false);
  const [editingSvc, setEditingSvc] = useState<ServiceGuideCatalogRow | null>(null);
  const [svcForm, setSvcForm] = useState(() => emptyCatalogForm('unit'));
  const [existingPhotos, setExistingPhotos] = useState<{ id: number; photo_url: string }[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [svcSaving, setSvcSaving] = useState(false);

  const [newSvcStep, setNewSvcStep] = useState<'condos' | 'details'>('details');
  const [partnerCondoList, setPartnerCondoList] = useState<CondoPickerRow[] | null>(null);
  const [partnerCondoPick, setPartnerCondoPick] = useState<Set<number>>(() => new Set());

  const [reqModal, setReqModal] = useState<ServiceGuideCatalogRow | null>(null);
  const [reqMessage, setReqMessage] = useState('');
  const [reqPreferred, setReqPreferred] = useState('');
  const [reqSaving, setReqSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      setCatalog([]);
      setOverview(null);
      setRequests([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const catalogIncludeInactive = !!(
        canManage &&
        session &&
        (session.role !== CondoUserRoles.partner || session.condoId === effectiveCondoId)
      );
      const parts: Promise<unknown>[] = [
        getServiceGuideOverview(effectiveCondoId, session.id),
        listServiceGuideCatalog(effectiveCondoId, session.id, catalogIncludeInactive),
      ];
      if (isStaff) {
        parts.push(listServiceGuideRequests(effectiveCondoId, session.id));
      }
      const res = await Promise.all(parts);
      setOverview(res[0] as ServiceGuideOverview);
      setCatalog(res[1] as ServiceGuideCatalogRow[]);
      setRequests(isStaff ? (res[2] as ServiceGuideRequestRow[]) : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
      setOverview(null);
      setCatalog(null);
      setRequests(null);
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId, canManage, isStaff]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const itemsForTab = useMemo(
    () => (catalog ?? []).filter((r) => (str(r.scope) || 'unit') === tab),
    [catalog, tab],
  );

  const toggleExpanded = (id: number) => {
    const n = new Set(expanded);
    if (n.has(id)) {
      n.delete(id);
    } else {
      n.add(id);
    }
    setExpanded(n);
  };

  const openNewCatalog = () => {
    setEditingSvc(null);
    setSvcForm(emptyCatalogForm(tab));
    setExistingPhotos([]);
    setPendingPhotos([]);
    if (session?.role === CondoUserRoles.partner) {
      setNewSvcStep('condos');
      setPartnerCondoList(null);
      setPartnerCondoPick(new Set(effectiveCondoId > 0 ? [effectiveCondoId] : []));
      void (async () => {
        if (!session) {
          return;
        }
        try {
          const list = await getCondosForContactPicker(session.id);
          setPartnerCondoList(list);
        } catch {
          setPartnerCondoList([]);
        }
      })();
    } else {
      setNewSvcStep('details');
    }
    setCatalogModal(true);
  };

  const openEditCatalog = (row: ServiceGuideCatalogRow) => {
    setNewSvcStep('details');
    setEditingSvc(row);
    setSvcForm({
      title: str(row.title),
      description: str(row.description),
      category: str(row.category),
      providerName: str(row.provider_name),
      providerPhone: str(row.provider_phone),
      providerEmail: str(row.provider_email),
      providerWhatsapp: str(row.provider_whatsapp),
      sortOrder: String(row.sort_order ?? 0),
      scope: (str(row.scope) as ScopeTab) || 'unit',
      visible: row.visible === true,
      active: row.active !== false,
    });
    setExistingPhotos(parsePortfolioPhotos(row.portfolio_photos));
    setPendingPhotos([]);
    setCatalogModal(true);
  };

  const photoSlots = MAX_PHOTOS - existingPhotos.length - pendingPhotos.length;

  const saveCatalog = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const title = svcForm.title.trim();
    if (!title) {
      window.alert('Informe o título.');
      return;
    }
    const sortOrder = Number.parseInt(svcForm.sortOrder, 10);
    if (!Number.isFinite(sortOrder)) {
      window.alert('Ordem inválida.');
      return;
    }

    setSvcSaving(true);
    try {
      const basePayload = {
        condoId: effectiveCondoId,
        userId: session.id,
        title,
        description: svcForm.description.trim() || null,
        category: svcForm.category.trim() || null,
        providerName: svcForm.providerName.trim() || null,
        providerPhone: svcForm.providerPhone.trim() || null,
        providerEmail: svcForm.providerEmail.trim() || null,
        providerWhatsapp: svcForm.providerWhatsapp.trim() || null,
        sortOrder,
        visible: svcForm.visible,
      };
      if (editingSvc) {
        const sid = num(editingSvc.id);
        const catalogCondoId = num(editingSvc.condo_id) || effectiveCondoId;
        await patchServiceGuideCatalog(sid, {
          ...basePayload,
          condoId: catalogCondoId,
          active: svcForm.active,
          scope: svcForm.scope,
        });
        for (const f of pendingPhotos) {
          await uploadServiceGuideCatalogPhoto(sid, catalogCondoId, session.id, f);
        }
      } else {
        const isPartner = session.role === CondoUserRoles.partner;
        const targets =
          isPartner && partnerCondoPick.size > 0
            ? [...partnerCondoPick].sort((a, b) => a - b)
            : [effectiveCondoId];
        if (isPartner && targets.length === 0) {
          window.alert('Selecione pelo menos um condomínio.');
          return;
        }
        const createBody = isPartner
          ? {
              condoIds: targets,
              userId: session.id,
              title,
              description: svcForm.description.trim() || null,
              category: svcForm.category.trim() || null,
              providerName: svcForm.providerName.trim() || null,
              providerPhone: svcForm.providerPhone.trim() || null,
              providerEmail: svcForm.providerEmail.trim() || null,
              providerWhatsapp: svcForm.providerWhatsapp.trim() || null,
              sortOrder,
              scope: svcForm.scope,
              visible: svcForm.visible,
            }
          : {
              condoId: effectiveCondoId,
              userId: session.id,
              title,
              description: svcForm.description.trim() || null,
              category: svcForm.category.trim() || null,
              providerName: svcForm.providerName.trim() || null,
              providerPhone: svcForm.providerPhone.trim() || null,
              providerEmail: svcForm.providerEmail.trim() || null,
              providerWhatsapp: svcForm.providerWhatsapp.trim() || null,
              sortOrder,
              scope: svcForm.scope,
              visible: svcForm.visible,
            };
        const created = await createServiceGuideCatalog(createBody);
        const rows: ServiceGuideCatalogRow[] =
          created != null &&
          typeof created === 'object' &&
          'catalog' in created &&
          Array.isArray((created as { catalog: ServiceGuideCatalogRow[] }).catalog)
            ? (created as { catalog: ServiceGuideCatalogRow[] }).catalog
            : [created as ServiceGuideCatalogRow];
        for (const row of rows) {
          const sid = num(row.id);
          const cCond = num(row.condo_id);
          for (const f of pendingPhotos) {
            await uploadServiceGuideCatalogPhoto(sid, cCond, session.id, f);
          }
        }
      }
      setCatalogModal(false);
      setNewSvcStep('details');
      await reload();
      window.alert(editingSvc ? 'Serviço atualizado.' : 'Serviço criado.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao guardar.');
    } finally {
      setSvcSaving(false);
    }
  };

  const removePhoto = async (ph: { id: number; photo_url: string }) => {
    if (!session || !editingSvc || effectiveCondoId < 1) {
      return;
    }
    if (!window.confirm('Remover esta foto?')) {
      return;
    }
    try {
      const catalogCondoId = num(editingSvc.condo_id) || effectiveCondoId;
      await deleteServiceGuideCatalogPhoto(num(editingSvc.id), ph.id, catalogCondoId, session.id);
      setExistingPhotos((xs) => xs.filter((x) => x.id !== ph.id));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro.');
    }
  };

  const onDeleteService = async (row: ServiceGuideCatalogRow) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    if (!window.confirm(`Excluir «${str(row.title)}»?`)) {
      return;
    }
    try {
      const rowCondo = num(row.condo_id) || effectiveCondoId;
      await deleteServiceGuideCatalog(num(row.id), rowCondo, session.id);
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Não foi possível excluir.');
    }
  };

  const submitServiceRequest = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || !reqModal || effectiveCondoId < 1 || session.unitId == null) {
      return;
    }
    const msg = reqMessage.trim();
    if (!msg) {
      window.alert('Descreva a solicitação.');
      return;
    }
    const pref =
      reqPreferred.trim() === ''
        ? null
        : /^\d{4}-\d{2}-\d{2}$/.test(reqPreferred.trim())
          ? reqPreferred.trim()
          : null;
    if (reqPreferred.trim() !== '' && !pref) {
      window.alert('Data preferencial: use formato AAAA-MM-DD.');
      return;
    }

    setReqSaving(true);
    try {
      await createServiceGuideRequest({
        condoId: effectiveCondoId,
        userId: session.id,
        serviceId: num(reqModal.id),
        unitId: session.unitId,
        message: msg,
        preferredDate: pref,
      });
      setReqModal(null);
      setReqMessage('');
      setReqPreferred('');
      await reload();
      window.alert('Solicitação enviada.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setReqSaving(false);
    }
  };

  const saveRequestStaff = async (row: ServiceGuideRequestRow, status: string, notes: string) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    try {
      await patchServiceGuideRequest(num(row.id), {
        condoId: effectiveCondoId,
        userId: session.id,
        status: status as 'pending' | 'in_progress' | 'completed' | 'cancelled',
        staffNotes: notes.trim() || null,
      });
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao atualizar.');
    }
  };

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Guia de serviços" backTo="/app">
      <div className="staff-hero">
        <h2>Prestadores e solicitações</h2>
        <p className="staff-muted">Mesma API do app: catálogo, fotos e pedidos para serviços por unidade.</p>
      </div>

      <div className="portal-inline" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button type="button" className={`portal-btn ${tab === 'unit' ? 'portal-btn--primary' : ''}`} onClick={() => setTab('unit')}>
          Unidades
        </button>
        <button type="button" className={`portal-btn ${tab === 'condo' ? 'portal-btn--primary' : ''}`} onClick={() => setTab('condo')}>
          Condomínio
        </button>
        {canManage ? (
          <button type="button" className="portal-btn portal-btn--primary" onClick={openNewCatalog}>
            Novo serviço
          </button>
        ) : null}
        <button type="button" className="portal-btn" onClick={() => void reload()}>
          Atualizar
        </button>
        {picksCondoBeforeContact(session.role) ? (
          <span className="staff-muted">
            Condomínio: {effectiveCondoId} · {labelPt(session.role)}
          </span>
        ) : null}
      </div>

      {overview ? (
        <p className="staff-muted" style={{ marginBottom: 16 }}>
          Listados: {overview.totalListed} · por unidade: {overview.unitServices} · condomínio: {overview.condoServices}
          {overview.categoryCount ? ` · categorias: ${overview.categoryCount}` : ''}
          {overview.hiddenFromResidents != null && overview.hiddenFromResidents > 0
            ? ` · ocultos aos moradores: ${overview.hiddenFromResidents}`
            : ''}
        </p>
      ) : null}

      {effectiveCondoId < 1 ? <p className="staff-error">Condomínio inválido (query condoId).</p> : null}
      {err ? <p className="staff-error">{err}</p> : null}

      {loading && !catalog ? (
        <p>A carregar…</p>
      ) : !itemsForTab.length ? (
        <p className="staff-muted">Nenhum serviço nesta área.</p>
      ) : (
        <ul className="staff-list">
          {itemsForTab.map((row) => {
            const id = num(row.id);
            const open = expanded.has(id);
            const photos = parsePortfolioPhotos(row.portfolio_photos);
            const active = row.active !== false;
            const scope = str(row.scope) || 'unit';
            const canReqThis =
              canRequestService && scope === 'unit' && active && row.visible !== false;
            return (
              <li key={id}>
                <button type="button" className="portal-offer-head" onClick={() => toggleExpanded(id)}>
                  <span style={{ textAlign: 'left' }}>
                    <strong>{str(row.title)}</strong>
                    <span className="staff-muted" style={{ marginLeft: 8 }}>
                      {str(row.category) || '—'}
                      {!active ? ' · inativo' : ''}
                    </span>
                  </span>
                  <span>{open ? '▼' : '▶'}</span>
                </button>
                {open ? (
                  <div className="portal-offer-body">
                    <p>{str(row.description) || '—'}</p>
                    <p>
                      <strong>{str(row.provider_name) || 'Prestador'}</strong>
                    </p>
                    <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
                      {str(row.provider_phone) ? (
                        <li>
                          Tel.: <a href={`tel:${str(row.provider_phone).replace(/\s/g, '')}`}>{str(row.provider_phone)}</a>
                        </li>
                      ) : null}
                      {str(row.provider_email) ? (
                        <li>
                          E-mail: <a href={`mailto:${str(row.provider_email).trim()}`}>{str(row.provider_email)}</a>
                        </li>
                      ) : null}
                      {str(row.provider_whatsapp) ? (
                        <li>
                          WhatsApp:{' '}
                          <a href={`https://wa.me/${str(row.provider_whatsapp).replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                            {str(row.provider_whatsapp)}
                          </a>
                        </li>
                      ) : null}
                    </ul>
                    {scope === 'condo' ? (
                      <p className="staff-muted">Serviço geral do condomínio — contacte o prestador diretamente.</p>
                    ) : null}
                    {photos.length > 0 ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                        {photos.map((p) => (
                          <a key={p.id} href={uploadsUrl(p.photo_url)} target="_blank" rel="noreferrer">
                            <img
                              src={uploadsUrl(p.photo_url)}
                              alt=""
                              style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 8 }}
                            />
                          </a>
                        ))}
                      </div>
                    ) : null}
                    <div className="portal-charge-actions" style={{ marginTop: 12 }}>
                      {canReqThis ? (
                        <button
                          type="button"
                          className="portal-btn portal-btn--primary"
                          onClick={() => {
                            setReqModal(row);
                            setReqMessage('');
                            setReqPreferred('');
                          }}
                        >
                          Solicitar serviço
                        </button>
                      ) : null}
                      {canManage ? (
                        <>
                          <button type="button" className="portal-btn" onClick={() => openEditCatalog(row)}>
                            Editar
                          </button>
                          <button type="button" className="portal-link-danger" onClick={() => void onDeleteService(row)}>
                            Excluir
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {isStaff && requests && requests.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <h3>Solicitações (equipa)</h3>
          <ul className="staff-list">
            {requests.map((r) => {
              const id = num(r.id);
              const ro = expandedReq.has(id);
              return (
                <li key={id}>
                  <button type="button" className="portal-offer-head" onClick={() => {
                    const n = new Set(expandedReq);
                    if (n.has(id)) {
                      n.delete(id);
                    } else {
                      n.add(id);
                    }
                    setExpandedReq(n);
                  }}>
                    <span style={{ textAlign: 'left' }}>
                      <strong>{str(r.service_title)}</strong>
                      <span className="staff-muted" style={{ marginLeft: 8 }}>
                        {str(r.unit_tower)} {str(r.unit_number)} · {str(r.status)}
                      </span>
                    </span>
                    <span>{ro ? '▼' : '▶'}</span>
                  </button>
                  {ro ? (
                    <RequestStaffPanel
                      row={r}
                      onSave={(st, notes) => void saveRequestStaff(r, st, notes)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {catalogModal ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 520 }}>
            <h3>
              {editingSvc
                ? 'Editar serviço'
                : session?.role === CondoUserRoles.partner && newSvcStep === 'condos'
                  ? 'Onde o anúncio aparece'
                  : 'Novo serviço'}
            </h3>
            {!editingSvc &&
            session?.role === CondoUserRoles.partner &&
            newSvcStep === 'condos' ? (
              <div>
                <p className="staff-muted" style={{ marginBottom: 12 }}>
                  Escolha em quais condomínios o serviço deve aparecer no guia. A seguir, preencha os dados do
                  anúncio.
                </p>
                {partnerCondoList == null ? (
                  <p>A carregar condomínios…</p>
                ) : partnerCondoList.length === 0 ? (
                  <p className="staff-error">Não foi possível carregar a lista de condomínios.</p>
                ) : (
                  <ul
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: 0,
                      maxHeight: 280,
                      overflowY: 'auto',
                    }}
                  >
                    {[...partnerCondoList]
                      .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
                      .map((c) => (
                        <li key={c.id} style={{ marginBottom: 8 }}>
                          <label className="staff-muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input
                              type="checkbox"
                              checked={partnerCondoPick.has(c.id)}
                              onChange={() => {
                                setPartnerCondoPick((prev) => {
                                  const n = new Set(prev);
                                  if (n.has(c.id)) {
                                    n.delete(c.id);
                                  } else {
                                    n.add(c.id);
                                  }
                                  return n;
                                });
                              }}
                            />
                            <span style={{ color: 'var(--foreground, inherit)' }}>{c.name}</span>
                            <span>#{c.id}</span>
                          </label>
                        </li>
                      ))}
                  </ul>
                )}
                <div className="portal-form__actions" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="portal-btn portal-btn--primary"
                    disabled={partnerCondoPick.size === 0 || partnerCondoList == null}
                    onClick={() => setNewSvcStep('details')}
                  >
                    Continuar
                  </button>
                  <button
                    type="button"
                    className="portal-btn"
                    onClick={() => {
                      setCatalogModal(false);
                      setNewSvcStep('details');
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
            <form onSubmit={(e) => void saveCatalog(e)}>
              <label>
                Título *
                <input
                  className="portal-input"
                  required
                  value={svcForm.title}
                  onChange={(e) => setSvcForm({ ...svcForm, title: e.target.value })}
                />
              </label>
              <label>
                Descrição
                <textarea
                  className="portal-input"
                  rows={3}
                  value={svcForm.description}
                  onChange={(e) => setSvcForm({ ...svcForm, description: e.target.value })}
                />
              </label>
              <label>
                Categoria
                <input
                  className="portal-input"
                  value={svcForm.category}
                  onChange={(e) => setSvcForm({ ...svcForm, category: e.target.value })}
                />
              </label>
              <label>
                Nome do prestador
                <input
                  className="portal-input"
                  value={svcForm.providerName}
                  onChange={(e) => setSvcForm({ ...svcForm, providerName: e.target.value })}
                />
              </label>
              <label>
                Telefone
                <input
                  className="portal-input"
                  value={svcForm.providerPhone}
                  onChange={(e) => setSvcForm({ ...svcForm, providerPhone: e.target.value })}
                />
              </label>
              <label>
                E-mail
                <input
                  className="portal-input"
                  type="email"
                  value={svcForm.providerEmail}
                  onChange={(e) => setSvcForm({ ...svcForm, providerEmail: e.target.value })}
                />
              </label>
              <label>
                WhatsApp
                <input
                  className="portal-input"
                  value={svcForm.providerWhatsapp}
                  onChange={(e) => setSvcForm({ ...svcForm, providerWhatsapp: e.target.value })}
                />
              </label>
              <label>
                Ordem
                <input
                  className="portal-input"
                  value={svcForm.sortOrder}
                  onChange={(e) => setSvcForm({ ...svcForm, sortOrder: e.target.value })}
                />
              </label>
              <label>
                Área
                <select
                  className="portal-input"
                  value={svcForm.scope}
                  onChange={(e) => setSvcForm({ ...svcForm, scope: e.target.value as ScopeTab })}
                >
                  <option value="unit">Unidades</option>
                  <option value="condo">Condomínio</option>
                </select>
              </label>
              <label className="staff-muted" style={{ display: 'flex', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={svcForm.visible}
                  onChange={(e) => setSvcForm({ ...svcForm, visible: e.target.checked })}
                />
                Visível aos moradores
              </label>
              {editingSvc ? (
                <label className="staff-muted" style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={svcForm.active}
                    onChange={(e) => setSvcForm({ ...svcForm, active: e.target.checked })}
                  />
                  Ativo
                </label>
              ) : null}

              <p className="staff-muted">Fotos (máx. {MAX_PHOTOS})</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {existingPhotos.map((ph) => (
                  <div key={ph.id}>
                    <img src={uploadsUrl(ph.photo_url)} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />
                    {editingSvc ? (
                      <button type="button" className="portal-link-danger" onClick={() => void removePhoto(ph)}>
                        Remover
                      </button>
                    ) : null}
                  </div>
                ))}
                {pendingPhotos.map((f, i) => (
                  <div key={`${f.name}-${i}`}>
                    <div style={{ width: 72, height: 72, background: 'rgba(0,0,0,0.06)', borderRadius: 8 }} />
                    <button type="button" className="portal-btn" onClick={() => setPendingPhotos((xs) => xs.filter((_x, j) => j !== i))}>
                      Tirar fila
                    </button>
                  </div>
                ))}
              </div>
              {photoSlots > 0 ? (
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="portal-input"
                  onChange={(e) => {
                    const list = e.target.files;
                    if (!list) {
                      return;
                    }
                    const next = [...pendingPhotos];
                    for (let i = 0; i < list.length && existingPhotos.length + next.length < MAX_PHOTOS; i++) {
                      const f = list.item(i);
                      if (f) {
                        next.push(f);
                      }
                    }
                    setPendingPhotos(next);
                    e.target.value = '';
                  }}
                />
              ) : null}

              <div className="portal-form__actions">
                {!editingSvc && session?.role === CondoUserRoles.partner ? (
                  <button type="button" className="portal-btn" onClick={() => setNewSvcStep('condos')}>
                    Voltar
                  </button>
                ) : null}
                <button type="submit" className="portal-btn portal-btn--primary" disabled={svcSaving}>
                  {svcSaving ? '…' : 'Guardar'}
                </button>
                <button
                  type="button"
                  className="portal-btn"
                  onClick={() => {
                    setCatalogModal(false);
                    setNewSvcStep('details');
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
      ) : null}

      {reqModal ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 480 }}>
            <h3>Solicitar: {str(reqModal.title)}</h3>
            <form onSubmit={(e) => void submitServiceRequest(e)}>
              <p className="staff-muted">Unidade: {session.unitId}</p>
              <label>
                Mensagem *
                <textarea
                  className="portal-input"
                  required
                  rows={4}
                  value={reqMessage}
                  onChange={(e) => setReqMessage(e.target.value)}
                />
              </label>
              <label>
                Data preferencial (AAAA-MM-DD, opcional)
                <input
                  className="portal-input"
                  type="date"
                  value={reqPreferred}
                  onChange={(e) => setReqPreferred(e.target.value)}
                />
              </label>
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={reqSaving}>
                  Enviar
                </button>
                <button type="button" className="portal-btn" onClick={() => setReqModal(null)}>
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

function RequestStaffPanel({
  row,
  onSave,
}: {
  row: ServiceGuideRequestRow;
  onSave: (status: string, notes: string) => void;
}) {
  const [status, setStatus] = useState(str(row.status) || 'pending');
  const [notes, setNotes] = useState(str(row.staff_notes));
  return (
    <div className="portal-offer-body">
      <p>{str(row.message)}</p>
      {row.preferred_date ? <p className="staff-muted">Preferência: {str(row.preferred_date)}</p> : null}
      <label>
        Estado
        <select className="portal-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pendente</option>
          <option value="in_progress">Em progresso</option>
          <option value="completed">Concluído</option>
          <option value="cancelled">Cancelado</option>
        </select>
      </label>
      <label>
        Notas internas
        <textarea className="portal-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button type="button" className="portal-btn portal-btn--primary" onClick={() => onSave(status, notes)}>
        Atualizar pedido
      </button>
    </div>
  );
}

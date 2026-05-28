import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CondoUserRoles, isBillingStaff, labelPt, picksCondoBeforeContact } from '../condoUserRoles';
import {
  createOffer,
  deleteOffer,
  enrollInOffer,
  listOffers,
  patchOffer,
  type OfferRow,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const CATEGORIES = ['Todas', 'Restaurantes', 'Mercado', 'Serviços', 'Saúde', 'Lazer', 'Outros'] as const;

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

function canPublishOffer(role: string): boolean {
  return (
    role === CondoUserRoles.syndic ||
    role === CondoUserRoles.administrator ||
    role === CondoUserRoles.partner
  );
}

type OfferFormState = {
  title: string;
  description: string;
  partnerLabel: string;
  category: string;
  redemptionKind: 'coupon_code' | 'loyalty_program';
  couponText: string;
  programInstructions: string;
  contactPhone: string;
  contactWhatsapp: string;
  contactEmail: string;
  contactUrl: string;
};

function emptyForm(): OfferFormState {
  return {
    title: '',
    description: '',
    partnerLabel: '',
    category: 'Outros',
    redemptionKind: 'coupon_code',
    couponText: '',
    programInstructions: '',
    contactPhone: '',
    contactWhatsapp: '',
    contactEmail: '',
    contactUrl: '',
  };
}

function rowToForm(row: OfferRow): OfferFormState {
  const rk = str(row.redemption_kind);
  return {
    title: str(row.title),
    description: str(row.description),
    partnerLabel: str(row.partner_label),
    category: CATEGORIES.includes(str(row.category) as (typeof CATEGORIES)[number])
      ? str(row.category)
      : 'Outros',
    redemptionKind: rk === 'loyalty_program' ? 'loyalty_program' : 'coupon_code',
    couponText: str(row.coupon_text),
    programInstructions: str(row.program_instructions),
    contactPhone: str(row.contact_phone),
    contactWhatsapp: str(row.contact_whatsapp),
    contactEmail: str(row.contact_email),
    contactUrl: str(row.contact_url),
  };
}

export function OffersPage() {
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

  const [items, setItems] = useState<OfferRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>('Todas');
  const [showInactive, setShowInactive] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<OfferFormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const canPublish = session ? canPublishOffer(session.role) : false;
  const isPartner = session?.role === CondoUserRoles.partner;
  const isResident = session?.role === CondoUserRoles.resident;

  const toggleExpanded = (id: number) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
      }
      return n;
    });
  };

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const rows = await listOffers({
        condoId: effectiveCondoId,
        category: category !== 'Todas' ? category : undefined,
        includeInactive: canPublish && showInactive ? true : undefined,
        forUserId: isResident ? session.id : undefined,
      });
      setItems(rows);
    } catch (e) {
      setItems(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar ofertas.');
    } finally {
      setLoading(false);
    }
  }, [session, category, showInactive, canPublish, isResident, effectiveCondoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm());
    setEditorOpen(true);
  };

  const openEdit = (row: OfferRow) => {
    setEditingId(num(row.id));
    setForm(rowToForm(row));
    setEditorOpen(true);
  };

  const submitEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) {
      return;
    }
    if (!form.title.trim()) {
      setErr('Título é obrigatório.');
      return;
    }
    if (form.redemptionKind === 'coupon_code' && !form.couponText.trim()) {
      setErr('Informe o texto/código do cupom.');
      return;
    }
    if (form.redemptionKind === 'loyalty_program' && !form.programInstructions.trim()) {
      setErr('Informe as instruções de adesão ao programa.');
      return;
    }

    const scope = isPartner ? 'partner' : 'condo';
    const body = {
      condoId: effectiveCondoId,
      userId: session.id,
      scope,
      title: form.title.trim(),
      description: form.description.trim(),
      partnerLabel: form.partnerLabel.trim() || null,
      category: form.category,
      redemptionKind: form.redemptionKind,
      couponText: form.couponText.trim() || null,
      programInstructions: form.programInstructions.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
      contactWhatsapp: form.contactWhatsapp.trim() || null,
      contactEmail: form.contactEmail.trim() || null,
      contactUrl: form.contactUrl.trim() || null,
    };

    setSaving(true);
    setErr(null);
    try {
      if (editingId != null) {
        await patchOffer(editingId, {
          userId: session.id,
          title: form.title.trim(),
          description: form.description.trim(),
          partnerLabel: form.partnerLabel.trim() || null,
          category: form.category,
          redemptionKind: form.redemptionKind,
          couponText: form.couponText.trim() || null,
          programInstructions: form.programInstructions.trim() || null,
          contactPhone: form.contactPhone.trim() || null,
          contactWhatsapp: form.contactWhatsapp.trim() || null,
          contactEmail: form.contactEmail.trim() || null,
          contactUrl: form.contactUrl.trim() || null,
        });
      } else {
        await createOffer(body);
      }
      setEditorOpen(false);
      await load();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Não foi possível guardar.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: number) => {
    if (!session || !window.confirm('Excluir esta oferta?')) {
      return;
    }
    try {
      await deleteOffer(id, session.id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  };

  const onToggleActive = async (row: OfferRow) => {
    if (!session) {
      return;
    }
    const id = num(row.id);
    const next = !row.active;
    try {
      await patchOffer(id, { userId: session.id, active: next });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro.');
    }
  };

  const onEnroll = async (offerId: number) => {
    if (!session) {
      return;
    }
    try {
      await enrollInOffer(offerId, session.id);
      await load();
      window.alert('Adesão registada (ou já estava aderente).');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Não foi possível aderir.');
    }
  };

  const mayEditRow = useCallback(
    (row: OfferRow): boolean => {
      if (!session) {
        return false;
      }
      if (isBillingStaff(session.role)) {
        return true;
      }
      return num(row.created_by_user_id) === session.id;
    },
    [session],
  );

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Ofertas" backTo="/app">
      <div className="staff-hero">
        <h2>Ofertas e parcerias</h2>
        <p>
          Mesmas categorias e API do app: filtrar por tipo, ver cupom ou programa de fidelidade, e
          contactos do parceiro.
        </p>
      </div>

      <div className="portal-inline" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <label className="staff-muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          Categoria
          <select
            className="portal-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ maxWidth: 200 }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {canPublish ? (
          <label className="staff-muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Mostrar inativas
          </label>
        ) : null}
        {canPublish ? (
          <button type="button" className="portal-btn portal-btn--primary" onClick={openNew}>
            Nova oferta
          </button>
        ) : null}
        <button type="button" className="portal-btn" onClick={() => void load()}>
          Atualizar
        </button>
      </div>

      {err ? <p className="staff-error">{err}</p> : null}

      {loading ? (
        <p>A carregar…</p>
      ) : !items || items.length === 0 ? (
        <p className="staff-muted">Nenhuma oferta neste filtro.</p>
      ) : (
        <ul className="staff-list">
          {items.map((row) => {
            const id = num(row.id);
            const open = expanded.has(id);
            const enrolled = row.viewer_enrolled === true;
            const loyalty = str(row.redemption_kind) === 'loyalty_program';
            const active = row.active === true;
            return (
              <li key={id}>
                <button type="button" className="portal-offer-head" onClick={() => toggleExpanded(id)}>
                  <span>
                    <strong>{str(row.title)}</strong>
                    <span className="staff-muted" style={{ marginLeft: 8 }}>
                      {str(row.category)} · {str(row.scope)}
                      {!active ? ' · inativa' : ''}
                    </span>
                  </span>
                  <span>{open ? '▼' : '▶'}</span>
                </button>
                {open ? (
                  <div className="portal-offer-body">
                    <p>{str(row.description) || '—'}</p>
                    {loyalty ? (
                      <p className="staff-muted">
                        <strong>Programa:</strong> {str(row.program_instructions) || '—'}
                      </p>
                    ) : (
                      <p>
                        <strong>Cupom:</strong>{' '}
                        <code style={{ wordBreak: 'break-all' }}>{str(row.coupon_text) || '—'}</code>{' '}
                        <button
                          type="button"
                          className="portal-link"
                          onClick={() => void navigator.clipboard?.writeText(str(row.coupon_text))}
                        >
                          Copiar
                        </button>
                      </p>
                    )}
                    {(Boolean(str(row.partner_label)) || Boolean(str(row.created_by_name))) && (
                      <p className="staff-muted">
                        Parceiro: {str(row.partner_label) || str(row.created_by_name)}
                      </p>
                    )}
                    <p className="staff-muted">
                      {[str(row.contact_phone), str(row.contact_whatsapp), str(row.contact_email)]
                        .filter(Boolean)
                        .join(' · ') || 'Sem contactos'}
                    </p>
                    {str(row.contact_url) ? (
                      <p>
                        <a href={str(row.contact_url)} target="_blank" rel="noreferrer">
                          Abrir link
                        </a>
                      </p>
                    ) : null}
                    {isResident && loyalty ? (
                      <button
                        type="button"
                        className="portal-btn portal-btn--primary"
                        disabled={!active || enrolled}
                        onClick={() => void onEnroll(id)}
                      >
                        {enrolled ? 'Já aderiu' : 'Aderir ao programa'}
                      </button>
                    ) : null}
                    {canPublish && mayEditRow(row) ? (
                      <div className="portal-charge-actions" style={{ marginTop: 10 }}>
                        <button type="button" className="portal-btn" onClick={() => openEdit(row)}>
                          Editar
                        </button>
                        <button type="button" className="portal-btn" onClick={() => void onToggleActive(row)}>
                          {active ? 'Desativar' : 'Reativar'}
                        </button>
                        <button type="button" className="portal-link-danger" onClick={() => void onDelete(id)}>
                          Excluir
                        </button>
                      </div>
                    ) : null}
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
            <h3>{editingId != null ? 'Editar oferta' : 'Nova oferta'}</h3>
            <form onSubmit={submitEditor}>
              <p className="staff-muted" style={{ marginTop: 0 }}>
                {isPartner ? 'Âmbito parceiro' : `Âmbito condomínio · ${labelPt(session.role)}`}
              </p>
              <label>
                Título
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </label>
              <label>
                Descrição
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                />
              </label>
              {!isPartner && (
                <label>
                  Nome do parceiro (opcional)
                  <input
                    value={form.partnerLabel}
                    onChange={(e) => setForm({ ...form, partnerLabel: e.target.value })}
                  />
                </label>
              )}
              <label>
                Categoria
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {CATEGORIES.filter((c) => c !== 'Todas').map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Modo de resgate
                <select
                  value={form.redemptionKind}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      redemptionKind: e.target.value as OfferFormState['redemptionKind'],
                    })
                  }
                >
                  <option value="coupon_code">Cupom / código</option>
                  <option value="loyalty_program">Programa de fidelidade</option>
                </select>
              </label>
              {form.redemptionKind === 'coupon_code' ? (
                <label>
                  Texto do cupom
                  <input
                    required
                    value={form.couponText}
                    onChange={(e) => setForm({ ...form, couponText: e.target.value })}
                  />
                </label>
              ) : (
                <label>
                  Instruções de adesão
                  <textarea
                    required
                    value={form.programInstructions}
                    onChange={(e) => setForm({ ...form, programInstructions: e.target.value })}
                    rows={3}
                  />
                </label>
              )}
              <label>
                Telefone
                <input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
              </label>
              <label>
                WhatsApp
                <input
                  value={form.contactWhatsapp}
                  onChange={(e) => setForm({ ...form, contactWhatsapp: e.target.value })}
                />
              </label>
              <label>
                E-mail
                <input
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                />
              </label>
              <label>
                URL
                <input value={form.contactUrl} onChange={(e) => setForm({ ...form, contactUrl: e.target.value })} />
              </label>
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={saving}>
                  Guardar
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

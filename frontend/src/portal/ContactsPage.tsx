import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isOperationalStaff, picksCondoBeforeContact } from '../condoUserRoles';
import {
  createContact,
  deleteContact,
  listContacts,
  patchContact,
  type ContactRow,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const CATEGORIES = [
  { id: '', label: 'Todas' },
  { id: 'syndic', label: 'Síndico' },
  { id: 'administration', label: 'Administração' },
  { id: 'intercom', label: 'Ramais / interfones' },
  { id: 'other', label: 'Outros' },
] as const;

const CATEGORY_OPTIONS_EDIT = [
  { value: 'syndic', label: 'Síndico' },
  { value: 'administration', label: 'Administração' },
  { value: 'intercom', label: 'Ramal / interfone' },
  { value: 'other', label: 'Outros' },
] as const;

const VISIBILITY_OPTIONS = [
  { value: 'everyone', label: 'Todos os perfis' },
  { value: 'syndic_only', label: 'Apenas síndico' },
  { value: 'syndic_administration', label: 'Síndico e administração' },
  { value: 'operational_staff', label: 'Equipe (inclui colaboradores e portaria)' },
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

function telHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const digits = trimmed.replace(/[^\d+]/g, '');
  return digits.length > 0 ? `tel:${digits}` : null;
}

function mailHref(email: string): string | null {
  const trimmed = email.trim();
  return trimmed.includes('@') ? `mailto:${trimmed}` : null;
}

function categoryLabel(cat: string): string {
  const o = CATEGORY_OPTIONS_EDIT.find((c) => c.value === cat);
  return o?.label ?? cat;
}

function visibleToLabel(v: string): string {
  switch (v) {
    case 'syndic_only':
      return 'Visível: apenas síndico';
    case 'syndic_administration':
      return 'Visível: síndico e administração';
    case 'operational_staff':
      return 'Visível: equipe (inclui colaboradores)';
    case 'everyone':
    default:
      return 'Visível: todos os perfis';
  }
}

export function ContactsPage() {
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

  const canManage = session ? isOperationalStaff(session.role) : false;

  const [filterCat, setFilterCat] = useState<string>('');
  const [items, setItems] = useState<ContactRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [formCategory, setFormCategory] = useState('syndic');
  const [formVisible, setFormVisible] = useState('everyone');
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formExt, setFormExt] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formOrder, setFormOrder] = useState('0');

  const reload = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      setItems([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const list = await listContacts({
        condoId: effectiveCondoId,
        manage: canManage,
        viewerRole: canManage ? undefined : session.role,
        category: filterCat || undefined,
      });
      setItems(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar contatos.');
      setItems(null);
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId, canManage, filterCat]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openNew = () => {
    setEditing(null);
    setFormCategory('syndic');
    setFormVisible('everyone');
    setFormName('');
    setFormPhone('');
    setFormExt('');
    setFormEmail('');
    setFormNotes('');
    setFormOrder('0');
    setModal(true);
  };

  const openEdit = (row: ContactRow) => {
    setEditing(row);
    setFormCategory(str(row.category) || 'syndic');
    setFormVisible(str(row.visible_to) || 'everyone');
    setFormName(str(row.name));
    setFormPhone(str(row.phone));
    setFormExt(str(row.extension));
    setFormEmail(str(row.email));
    setFormNotes(str(row.notes));
    setFormOrder(String(row.sort_order ?? 0));
    setModal(true);
  };

  const saveContact = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const name = formName.trim();
    if (!name) {
      window.alert('Informe o nome.');
      return;
    }
    const sortOrder = Number.parseInt(formOrder.trim(), 10);
    if (!Number.isFinite(sortOrder)) {
      window.alert('Ordem na lista inválida.');
      return;
    }

    const base = {
      condoId: effectiveCondoId,
      category: formCategory,
      name,
      phone: formPhone.trim() || null,
      extension: formExt.trim() || null,
      email: formEmail.trim() || null,
      notes: formNotes.trim() || null,
      sortOrder,
      visibleTo: formVisible,
    };

    setSaving(true);
    try {
      const id = num(editing?.id);
      if (id > 0) {
        await patchContact(id, base);
      } else {
        await createContact(base);
      }
      setModal(false);
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao guardar.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (row: ContactRow) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const id = num(row.id);
    const name = str(row.name);
    if (
      id < 1 ||
      !window.confirm(`Remover "${name}" da lista?`)
    ) {
      return;
    }
    try {
      await deleteContact(id, effectiveCondoId);
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  };

  const grouped = useMemo(() => {
    const list = items ?? [];
    const m = new Map<string, ContactRow[]>();
    for (const r of list) {
      const c = str(r.category) || 'other';
      if (!m.has(c)) {
        m.set(c, []);
      }
      m.get(c)!.push(r);
    }
    const order = ['syndic', 'administration', 'intercom', 'other'];
    return order.map((k) => ({ cat: k, rows: m.get(k) ?? [] })).filter((g) => g.rows.length > 0);
  }, [items]);

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Contatos">
      {effectiveCondoId < 1 ? (
        <p className="staff-muted">
          Associe ou escolha um condomínio (perfil sem condomínio válido selecionado).
        </p>
      ) : null}

      {canManage ? (
        <p className="staff-section-desc" style={{ marginTop: 0 }}>
          Equipe pode cadastrar ramais, interfones e outros contactos úteis. Moradores apenas veem os
          contactos marcados como visíveis ao seu perfil.
        </p>
      ) : null}

      <div className="portal-charge-actions" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="staff-muted">
          Filtrar por tipo:&nbsp;
          <select className="portal-input" style={{ width: 'auto', display: 'inline-block' }} value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.label} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        {canManage ? (
          <button type="button" className="portal-btn portal-btn--primary" onClick={openNew}>
            Novo contato
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

      {!loading && !err && grouped.length === 0 ? (
        <p className="staff-muted">Nenhum contacto neste conjunto.</p>
      ) : null}

      {!loading && grouped.map(({ cat, rows }) => (
        <section key={cat}>
          <h2 className="staff-section-title">{categoryLabel(cat)}</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {rows.map((row) => {
              const phone = str(row.phone);
              const phoneL = telHref(phone);
              const email = str(row.email);
              const emailL = mailHref(email);
              const ext = str(row.extension);
              return (
                <li key={num(row.id)} className="portal-details" style={{ marginBottom: 10 }}>
                  <div>
                    <strong>{str(row.name)}</strong>
                    {phone ? (
                      <>
                        {' '}
                        · {phoneL ? (
                          <a href={phoneL}>{phone}</a>
                        ) : (
                          phone
                        )}
                      </>
                    ) : null}
                    {ext ? <> · ramal {ext}</> : null}
                    <div className="staff-muted" style={{ marginTop: 4 }}>
                      {visibleToLabel(str(row.visible_to))}
                      {email ? (
                        <>
                          {' '}
                          ·{' '}
                          {emailL ? (
                            <a href={emailL}>{email}</a>
                          ) : (
                            email
                          )}
                        </>
                      ) : null}
                    </div>
                    {str(row.notes) ? (
                      <p style={{ margin: '8px 0 0', fontSize: '0.92rem', lineHeight: 1.45 }}>{str(row.notes)}</p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="portal-charge-actions" style={{ marginTop: 8 }}>
                      <button type="button" className="portal-btn" onClick={() => openEdit(row)}>
                        Editar
                      </button>
                      <button type="button" className="portal-link-danger" onClick={() => void onDelete(row)}>
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

      {modal && canManage ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 460 }}>
            <h3>{editing ? 'Editar contato' : 'Novo contato'}</h3>
            <form onSubmit={(e) => void saveContact(e)}>
              <label>
                Tipo
                <select className="portal-input" value={formCategory} onChange={(e) => setFormCategory(e.target.value)}>
                  {CATEGORY_OPTIONS_EDIT.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Visível para
                <select className="portal-input" value={formVisible} onChange={(e) => setFormVisible(e.target.value)}>
                  {VISIBILITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nome ou identificação *
                <input className="portal-input" required value={formName} onChange={(e) => setFormName(e.target.value)} />
              </label>
              <label>
                Telefone / WhatsApp
                <input className="portal-input" type="tel" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} />
              </label>
              <label>
                Ramal (interfone)
                <input className="portal-input" value={formExt} onChange={(e) => setFormExt(e.target.value)} />
              </label>
              <label>
                E-mail
                <input className="portal-input" type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
              </label>
              <label>
                Observações
                <textarea className="portal-input" rows={3} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
              </label>
              <label>
                Ordem na lista
                <input className="portal-input" inputMode="numeric" value={formOrder} onChange={(e) => setFormOrder(e.target.value)} />
              </label>
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={saving}>
                  {editing ? 'Guardar' : 'Cadastrar'}
                </button>
                <button type="button" className="portal-btn" onClick={() => setModal(false)}>
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

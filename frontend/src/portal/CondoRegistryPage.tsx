import { useCallback, useEffect, useState } from 'react';
import { createCondo, getCondosForContactPicker, type CondoPickerRow } from '../portalApi';
import { RequirePlatformAdmin } from '../staff/StaffGuards';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

function fmtCreatedAt(raw: unknown): string {
  if (raw == null) {
    return '';
  }
  const s = String(raw);
  if (s.length >= 10) {
    return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  }
  return s;
}

function CondoRegistryContent() {
  const session = useStaffSession();
  const [items, setItems] = useState<CondoPickerRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!session) {
      setItems([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const list = await getCondosForContactPicker(session.id);
      setItems(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar condomínios.');
      setItems(null);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session) {
      return;
    }
    const n = name.trim();
    if (!n) {
      window.alert('Informe o nome do condomínio.');
      return;
    }
    if (n.length > 150) {
      window.alert('O nome deve ter no máximo 150 caracteres.');
      return;
    }
    setSaving(true);
    try {
      await createCondo({ userId: session.id, name: n });
      setName('');
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Não foi possível cadastrar.');
    } finally {
      setSaving(false);
    }
  };

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Cadastro de condomínios">
      <p className="staff-section-desc" style={{ marginTop: 0 }}>
        Área exclusiva do{' '}
        <strong>administrador da plataforma</strong>. Aqui são criados registos na tabela de condomínios; utilizadores,
        unidades e demais dados continuam a ser configurados dentro de cada condomínio (síndico, administração, etc.).
      </p>

      <div className="portal-details" style={{ marginBottom: 20 }}>
        <h2 className="staff-section-title" style={{ marginTop: 0 }}>
          Novo condomínio
        </h2>
        <form className="portal-form" style={{ margin: 0, padding: 0, border: 'none', background: 'none' }} onSubmit={(e) => void onSubmit(e)}>
          <label>
            Nome
            <input
              className="portal-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Residencial Verde Mar"
              maxLength={150}
              autoCapitalize="words"
            />
          </label>
          <div className="portal-form__actions" style={{ marginTop: 0 }}>
            <button type="submit" className="portal-btn portal-btn--primary" disabled={saving}>
              {saving ? 'A guardar…' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </div>

      <h2 className="staff-section-title">Condomínios cadastrados</h2>

      {err ? (
        <p className="staff-muted" role="alert">
          {err}
        </p>
      ) : null}
      {loading ? <p className="staff-muted">A carregar…</p> : null}

      {!loading && !err && (items ?? []).length === 0 ? (
        <p className="staff-muted">Nenhum condomínio na lista.</p>
      ) : null}

      <ul className="staff-list">
        {(items ?? []).map((row) => (
          <li key={row.id}>
            <strong>{row.name}</strong>
            {row.created_at != null ? (
              <span className="staff-muted" style={{ marginLeft: 8, fontSize: '0.88rem' }}>
                · criado em {fmtCreatedAt(row.created_at)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="staff-muted" style={{ marginTop: 24, fontSize: '0.85rem' }}>
        Para entrar nesta conta em desenvolvimento use o utilizador criado pela migração da base de dados (ex.: login{' '}
        <code>admin_plataforma</code>, palavra-passe definida no seed — altere em produção).
      </p>
    </StaffLayout>
  );
}

/** Só utilizadores com `role === admin` (API `/api/condos` POST). */
export function CondoRegistryPage() {
  return (
    <RequirePlatformAdmin>
      <CondoRegistryContent />
    </RequirePlatformAdmin>
  );
}

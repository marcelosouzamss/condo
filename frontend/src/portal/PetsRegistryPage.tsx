import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { uploadsUrl } from '../api';
import { CondoUserRoles, isOperationalStaff, picksCondoBeforeContact } from '../condoUserRoles';
import {
  createUnitPet,
  deleteUnitPet,
  getUnitsForCondo,
  listUnitPets,
  patchUnitPet,
  uploadUnitPetPhoto,
  type UnitPetRow,
  type UnitRow,
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

function unitLabelFromRow(p: UnitPetRow): string {
  const t = str(p.unit_tower).trim();
  const n = str(p.unit_number).trim();
  if (t || n) {
    return `Torre ${t || '?'} · ${n || '?'}`;
  }
  return `Unidade ${num(p.unit_id)}`;
}

function unitLabelFromUnit(u: UnitRow): string {
  const t = str(u.tower).trim();
  const n = str(u.number).trim();
  return `${t}${t && n ? ' · ' : ''}${n}` || `Unidade ${num(u.id)}`;
}

function PetThumb({ photoUrl, name }: { photoUrl: string; name: string }) {
  const [err, setErr] = useState(false);
  const has = photoUrl.trim() !== '' && !err;
  return (
    <div
      style={{
        width: 72,
        height: 72,
        borderRadius: 12,
        overflow: 'hidden',
        flexShrink: 0,
        background: 'color-mix(in srgb, var(--ink) 8%, var(--card))',
        display: 'grid',
        placeItems: 'center',
        fontSize: '1.75rem',
      }}
    >
      {has ? (
        <img
          src={uploadsUrl(photoUrl.trim())}
          alt=""
          width={72}
          height={72}
          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
          onError={() => setErr(true)}
        />
      ) : (
        <span aria-hidden title={name}>
          🐾
        </span>
      )}
    </div>
  );
}

export function PetsRegistryPage() {
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

  const isResident =
    session?.role === CondoUserRoles.resident && session.unitId != null;
  const isStaff = session ? isOperationalStaff(session.role) : false;
  const canManagePets = Boolean(
    session && session.role === CondoUserRoles.resident && session.unitId != null,
  );

  const [items, setItems] = useState<UnitPetRow[] | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [staffUnitFilter, setStaffUnitFilter] = useState<number | ''>('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UnitPetRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [formName, setFormName] = useState('');
  const [formSpecies, setFormSpecies] = useState('');
  const [formBreed, setFormBreed] = useState('');
  const [formColor, setFormColor] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [existingPhotoUrl, setExistingPhotoUrl] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const residentUnitLabel = useMemo(() => {
    if (!session?.unitId) {
      return '';
    }
    const u = units.find((x) => num(x.id) === session.unitId);
    return u ? unitLabelFromUnit(u) : '';
  }, [session?.unitId, units]);

  const loadUnits = useCallback(async () => {
    if (effectiveCondoId < 1) {
      return;
    }
    try {
      const list = await getUnitsForCondo(effectiveCondoId);
      setUnits(list);
    } catch {
      setUnits([]);
    }
  }, [effectiveCondoId]);

  const reloadPets = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      setItems([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const list = await listUnitPets(
        effectiveCondoId,
        session.id,
        isStaff && staffUnitFilter !== '' ? Number(staffUnitFilter) : undefined,
      );
      setItems(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar animais.');
      setItems(null);
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId, isStaff, staffUnitFilter]);

  useEffect(() => {
    void loadUnits();
  }, [loadUnits]);

  useEffect(() => {
    void reloadPets();
  }, [reloadPets]);

  const groupedForStaff = useMemo(() => {
    const list = items ?? [];
    const m = new Map<number, UnitPetRow[]>();
    for (const p of list) {
      const uid = num(p.unit_id);
      if (!m.has(uid)) {
        m.set(uid, []);
      }
      m.get(uid)!.push(p);
    }
    const entries = [...m.entries()].map(([unitId, pets]) => ({
      unitId,
      pets,
      title: unitLabelFromRow(pets[0]),
    }));
    entries.sort((a, b) => a.title.localeCompare(b.title, 'pt'));
    return entries;
  }, [items]);

  const openNew = () => {
    if (!session?.unitId) {
      return;
    }
    setEditing(null);
    setFormName('');
    setFormSpecies('');
    setFormBreed('');
    setFormColor('');
    setFormNotes('');
    setExistingPhotoUrl('');
    setPendingFile(null);
    setModalOpen(true);
  };

  const openEdit = (row: UnitPetRow) => {
    setEditing(row);
    setFormName(str(row.name));
    setFormSpecies(str(row.species));
    setFormBreed(str(row.breed));
    setFormColor(str(row.color));
    setFormNotes(str(row.notes));
    setExistingPhotoUrl(str(row.photo_url));
    setPendingFile(null);
    setModalOpen(true);
  };

  const savePet = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1 || !canManagePets || !session.unitId) {
      return;
    }
    const name = formName.trim();
    const species = formSpecies.trim();
    if (!name || !species) {
      window.alert('Informe o nome e o tipo do animal (ex.: cão, gato).');
      return;
    }

    setSaving(true);
    try {
      let uploadedPhotoUrl: string | null | undefined;
      if (pendingFile) {
        const up = await uploadUnitPetPhoto(effectiveCondoId, session.id, pendingFile);
        uploadedPhotoUrl = up.photoUrl ?? null;
      }

      const id = num(editing?.id);
      const breed = formBreed.trim() || null;
      const color = formColor.trim() || null;
      const notes = formNotes.trim() || null;

      if (id > 0) {
        await patchUnitPet(id, {
          condoId: effectiveCondoId,
          userId: session.id,
          name,
          species,
          breed,
          color,
          notes,
          ...(uploadedPhotoUrl !== undefined ? { photoUrl: uploadedPhotoUrl } : {}),
        });
      } else {
        await createUnitPet({
          condoId: effectiveCondoId,
          userId: session.id,
          unitId: session.unitId,
          name,
          species,
          breed,
          color,
          notes,
          photoUrl: uploadedPhotoUrl ?? null,
        });
      }
      setModalOpen(false);
      await reloadPets();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao guardar.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (row: UnitPetRow) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    const id = num(row.id);
    const n = str(row.name);
    if (id < 1 || !window.confirm(`Excluir “${n}” do cadastro?`)) {
      return;
    }
    try {
      await deleteUnitPet(id, effectiveCondoId, session.id);
      await reloadPets();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  };

  if (!session) {
    return null;
  }

  if (!isResident && !isStaff) {
    return (
      <StaffLayout title="Animais de estimação">
        <p className="staff-section-desc" style={{ marginTop: 24, textAlign: 'center' }}>
          O cadastro de animais é feito pelo morador da unidade. A equipe do condomínio consulta os registos
          por apartamento.
        </p>
      </StaffLayout>
    );
  }

  if (isResident && session.unitId == null) {
    return (
      <StaffLayout title="Animais de estimação">
        <p className="staff-section-desc" style={{ marginTop: 24, textAlign: 'center' }}>
          A sua conta não está associada a uma unidade. Peça à administração que actualize o seu cadastro para
          poder registar animais.
        </p>
      </StaffLayout>
    );
  }

  return (
    <StaffLayout title="Animais de estimação">
      {effectiveCondoId < 1 ? (
        <p className="staff-muted">
          Associe ou escolha um condomínio (perfil sem condomínio válido selecionado).
        </p>
      ) : null}

      {isStaff ? (
        <p className="staff-section-desc" style={{ marginTop: 0 }}>
          Consulta dos animais declarados pelas unidades. O cadastro e a fotografia são tratados pelo morador
          na app ou nesta página.
        </p>
      ) : (
        <p className="staff-section-desc" style={{ marginTop: 0 }}>
          Registe o seu animal com foto, nome, tipo e raça. Os dados ficam associados à sua unidade.
        </p>
      )}

      <div className="portal-inline" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {isStaff ? (
          <label className="staff-muted">
            Unidade:&nbsp;
            <select
              className="portal-input"
              style={{ width: 'auto', minWidth: 180, display: 'inline-block' }}
              value={staffUnitFilter === '' ? '' : String(staffUnitFilter)}
              onChange={(e) => {
                const v = e.target.value;
                setStaffUnitFilter(v === '' ? '' : Number.parseInt(v, 10));
              }}
            >
              <option value="">Todas as unidades</option>
              {units.map((u) => (
                <option key={num(u.id)} value={num(u.id)}>
                  {unitLabelFromUnit(u)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span style={{ flex: 1 }} />
        {canManagePets ? (
          <button type="button" className="portal-btn portal-btn--primary" onClick={openNew}>
            Novo animal
          </button>
        ) : null}
        <button type="button" className="portal-btn" onClick={() => void reloadPets()}>
          Atualizar
        </button>
      </div>

      {err ? (
        <p className="staff-muted" role="alert">
          {err}
        </p>
      ) : null}

      {loading ? <p className="staff-muted">A carregar…</p> : null}

      {!loading && !err && (items ?? []).length === 0 ? (
        <p className="staff-muted">
          {isStaff
            ? 'Nenhum animal cadastrado pelas unidades.'
            : 'Nenhum animal cadastrado. Use «Novo animal», envie a foto e preencha nome, tipo e raça.'}
        </p>
      ) : null}

      {!loading &&
        isResident &&
        (items ?? []).map((row) => (
          <div key={num(row.id)} className="portal-details" style={{ marginBottom: 10 }}>
            <div className="portal-inline" style={{ alignItems: 'flex-start', gap: 12 }}>
              <PetThumb photoUrl={str(row.photo_url)} name={str(row.name)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{str(row.name)}</strong>
                <div style={{ marginTop: 4 }}>{str(row.species)}</div>
                {str(row.breed).trim() ? (
                  <div className="staff-muted" style={{ marginTop: 4, fontSize: '0.9rem' }}>
                    Raça: {str(row.breed)}
                  </div>
                ) : null}
                {str(row.color).trim() ? (
                  <div className="staff-muted" style={{ marginTop: 2, fontSize: '0.9rem' }}>
                    Cor: {str(row.color)}
                  </div>
                ) : null}
                {str(row.notes).trim() ? <p style={{ marginTop: 8, lineHeight: 1.45 }}>{str(row.notes)}</p> : null}
                {canManagePets ? (
                  <div className="portal-charge-actions" style={{ marginTop: 10 }}>
                    <button type="button" className="portal-btn" onClick={() => openEdit(row)}>
                      Editar
                    </button>
                    <button type="button" className="portal-link-danger" onClick={() => void onDelete(row)}>
                      Excluir
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}

      {!loading &&
        isStaff &&
        groupedForStaff.map(({ unitId, pets, title }) => (
          <details
            key={unitId}
            className="portal-details"
            style={{ marginBottom: 12 }}
            open={groupedForStaff.length <= 3}
          >
            <summary style={{ cursor: 'pointer', fontWeight: 800 }}>
              {title}
              <span className="staff-muted" style={{ marginLeft: 8, fontWeight: 600, fontSize: '0.88rem' }}>
                ({pets.length} {pets.length === 1 ? 'animal' : 'animais'})
              </span>
            </summary>
            <div style={{ marginTop: 12 }}>
              {pets.map((row) => (
                <div key={num(row.id)} className="portal-details" style={{ marginBottom: 8 }}>
                  <div className="portal-inline" style={{ alignItems: 'flex-start', gap: 12 }}>
                    <PetThumb photoUrl={str(row.photo_url)} name={str(row.name)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>{str(row.name)}</strong>
                      <div style={{ marginTop: 4 }}>{str(row.species)}</div>
                      {str(row.breed).trim() ? (
                        <div className="staff-muted" style={{ marginTop: 4, fontSize: '0.9rem' }}>
                          Raça: {str(row.breed)}
                        </div>
                      ) : null}
                      {str(row.color).trim() ? (
                        <div className="staff-muted" style={{ marginTop: 2, fontSize: '0.9rem' }}>
                          Cor: {str(row.color)}
                        </div>
                      ) : null}
                      {str(row.notes).trim() ? (
                        <p style={{ marginTop: 8, lineHeight: 1.45 }}>{str(row.notes)}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}

      {modalOpen && canManagePets ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 460 }}>
            <h3>{editing ? 'Editar animal' : 'Cadastrar animal'}</h3>
            <form className="portal-form" onSubmit={(e) => void savePet(e)}>
              <p className="staff-muted" style={{ margin: '-4px 0 0' }}>
                Unidade:{' '}
                <strong>
                  {editing
                    ? unitLabelFromRow(editing)
                    : residentUnitLabel || `Unidade ${session.unitId}`}
                </strong>
              </p>
              <p className="staff-muted" style={{ marginTop: 6, fontSize: '0.82rem' }}>
                A unidade vem do seu cadastro de morador.
              </p>
              <label>
                Nome do animal *
                <input className="portal-input" required value={formName} onChange={(e) => setFormName(e.target.value)} />
              </label>
              <label>
                Tipo (ex.: cão, gato) *
                <input className="portal-input" required value={formSpecies} onChange={(e) => setFormSpecies(e.target.value)} />
              </label>
              <label>
                Raça (opcional)
                <input className="portal-input" value={formBreed} onChange={(e) => setFormBreed(e.target.value)} />
              </label>
              <label>
                Cor (opcional)
                <input className="portal-input" value={formColor} onChange={(e) => setFormColor(e.target.value)} />
              </label>
              <label>
                Observações
                <textarea className="portal-input" rows={2} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
              </label>
              <label>
                Foto (JPEG/PNG/GIF/WEBP, até ~5 MB)
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="portal-input"
                  onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {pendingFile ? (
                <p className="staff-muted">Nova foto: {pendingFile.name}</p>
              ) : existingPhotoUrl.trim() ? (
                <p className="staff-muted">
                  Foto atual:{' '}
                  <a href={uploadsUrl(existingPhotoUrl.trim())} target="_blank" rel="noreferrer">
                    ver
                  </a>
                </p>
              ) : null}
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={saving}>
                  {editing ? 'Guardar' : 'Cadastrar'}
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

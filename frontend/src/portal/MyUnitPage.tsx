import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { picksCondoBeforeContact } from '../condoUserRoles';
import {
  deleteMyUnitPet,
  deleteMyUnitResident,
  deleteMyUnitVehicle,
  getMyUnitBundle,
  getUnitsForCondo,
  patchMyUnitPersonalData,
  patchMyUnitPet,
  patchMyUnitResident,
  patchMyUnitVehicle,
  postMyUnitPet,
  postMyUnitResident,
  postMyUnitVehicle,
  type MyUnitBundle,
  type UnitRow,
} from '../portalApi';
import {
  clearResidentSelectedUnitId,
  readResidentSelectedUnitId,
  writeResidentSelectedUnitId,
} from '../residentUnitWebStorage';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const RESIDENT_ROLES = ['owner', 'tenant', 'resident', 'other'] as const;

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

function roleLabelPt(role: string): string {
  switch (role) {
    case 'owner':
      return 'Proprietário';
    case 'tenant':
      return 'Locatário';
    case 'resident':
      return 'Morador';
    default:
      return 'Outro';
  }
}

function unitLabel(u: UnitRow): string {
  return `Torre ${str(u.tower)} · Unidade ${str(u.number)}`;
}

export function MyUnitPage() {
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

  const [units, setUnits] = useState<UnitRow[] | null>(null);
  const [bundle, setBundle] = useState<MyUnitBundle | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [pName, setPName] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pEmail, setPEmail] = useState('');
  const seededForUnitId = useRef<number | null>(null);

  const [resOpen, setResOpen] = useState(false);
  const [resEditingId, setResEditingId] = useState<number | null>(null);
  const [resRole, setResRole] = useState<string>('resident');
  const [resName, setResName] = useState('');
  const [resPhone, setResPhone] = useState('');
  const [resEmail, setResEmail] = useState('');
  const [resNotes, setResNotes] = useState('');

  const [vehOpen, setVehOpen] = useState(false);
  const [vehEditingId, setVehEditingId] = useState<number | null>(null);
  const [vehModel, setVehModel] = useState('');
  const [vehPlate, setVehPlate] = useState('');
  const [vehSpot, setVehSpot] = useState('');
  const [vehColor, setVehColor] = useState('');

  const [petOpen, setPetOpen] = useState(false);
  const [petEditingId, setPetEditingId] = useState<number | null>(null);
  const [petName, setPetName] = useState('');
  const [petSpecies, setPetSpecies] = useState('');
  const [petBreed, setPetBreed] = useState('');
  const [petColor, setPetColor] = useState('');

  const load = useCallback(async () => {
    if (!session || effectiveCondoId < 1) {
      setUnits([]);
      setBundle(null);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const unitRows = await getUnitsForCondo(effectiveCondoId);
      setUnits(unitRows);

      const validIds = new Set(unitRows.map((u) => num(u.id)));
      let stored = readResidentSelectedUnitId(effectiveCondoId);
      if (stored != null && !validIds.has(stored)) {
        clearResidentSelectedUnitId(effectiveCondoId);
        stored = null;
      }
      const fromSession = session.unitId != null && validIds.has(session.unitId) ? session.unitId : null;
      const pick =
        stored ??
        fromSession ??
        (unitRows.length > 0 ? num(unitRows[0].id) : null);

      setSelectedUnitId(pick);

      if (pick == null) {
        setBundle(null);
        setLoading(false);
        return;
      }

      const b = await getMyUnitBundle(effectiveCondoId, pick);
      setBundle(b);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar.');
      setBundle(null);
      setUnits(null);
    } finally {
      setLoading(false);
    }
  }, [session, effectiveCondoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentUnitId = bundle?.unit ? num(bundle.unit.id) : 0;

  useEffect(() => {
    if (currentUnitId > 0 && bundle && seededForUnitId.current !== currentUnitId) {
      seededForUnitId.current = currentUnitId;
      const pd = bundle.personalData;
      setPName(str(pd?.fullName));
      setPPhone(str(pd?.phone));
      setPEmail(str(pd?.email));
    }
  }, [bundle, currentUnitId]);

  const onUnitChange = async (nextId: number | null) => {
    if (nextId == null || !session || effectiveCondoId < 1) {
      return;
    }
    setSelectedUnitId(nextId);
    writeResidentSelectedUnitId(effectiveCondoId, nextId);
    seededForUnitId.current = null;
    setBusy(true);
    setErr(null);
    try {
      const b = await getMyUnitBundle(effectiveCondoId, nextId);
      setBundle(b);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao trocar unidade.');
    } finally {
      setBusy(false);
    }
  };

  const savePersonal = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1 || currentUnitId < 1) {
      return;
    }
    const name = pName.trim();
    if (!name) {
      window.alert('Informe o nome completo.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await patchMyUnitPersonalData({
        condoId: effectiveCondoId,
        unitId: currentUnitId,
        fullName: name,
        phone: pPhone.trim(),
        email: pEmail.trim(),
      });
      await load();
      window.alert('Dados pessoais atualizados.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  const openResident = (row?: Record<string, unknown>) => {
    setResEditingId(row ? num(row.id) : null);
    setResRole(str(row?.role) || 'resident');
    setResName(str(row?.full_name));
    setResPhone(str(row?.phone));
    setResEmail(str(row?.email));
    setResNotes(str(row?.notes));
    setResOpen(true);
  };

  const submitResident = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1 || currentUnitId < 1) {
      return;
    }
    const name = resName.trim();
    if (!name) {
      window.alert('Informe o nome do morador.');
      return;
    }
    if (!RESIDENT_ROLES.includes(resRole as (typeof RESIDENT_ROLES)[number])) {
      window.alert('Papel inválido.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body = {
        condoId: effectiveCondoId,
        unitId: currentUnitId,
        role: resRole,
        fullName: name,
        phone: resPhone.trim(),
        email: resEmail.trim(),
        notes: resNotes.trim(),
      };
      if (resEditingId != null) {
        await patchMyUnitResident(resEditingId, {
          condoId: effectiveCondoId,
          role: resRole,
          fullName: name,
          phone: resPhone.trim(),
          email: resEmail.trim(),
          notes: resNotes.trim(),
        });
      } else {
        await postMyUnitResident(body);
      }
      setResOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar morador.');
    } finally {
      setBusy(false);
    }
  };

  const removeResident = async (id: number) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    if (!window.confirm('Remover este morador do cadastro da unidade?')) {
      return;
    }
    setBusy(true);
    try {
      await deleteMyUnitResident(id, effectiveCondoId);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao remover.');
    } finally {
      setBusy(false);
    }
  };

  const openVehicle = (row?: Record<string, unknown>) => {
    setVehEditingId(row ? num(row.id) : null);
    setVehModel(str(row?.model));
    setVehPlate(str(row?.plate));
    setVehSpot(str(row?.parking_spot));
    setVehColor(str(row?.color));
    setVehOpen(true);
  };

  const submitVehicle = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1 || currentUnitId < 1) {
      return;
    }
    const model = vehModel.trim();
    const plate = vehPlate.trim();
    if (!model || !plate) {
      window.alert('Modelo e placa são obrigatórios.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body = {
        condoId: effectiveCondoId,
        unitId: currentUnitId,
        model,
        plate,
        parkingSpot: vehSpot.trim(),
        color: vehColor.trim(),
      };
      if (vehEditingId != null) {
        await patchMyUnitVehicle(vehEditingId, body);
      } else {
        await postMyUnitVehicle(body);
      }
      setVehOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar veículo.');
    } finally {
      setBusy(false);
    }
  };

  const removeVehicle = async (id: number) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    if (!window.confirm('Remover este veículo?')) {
      return;
    }
    setBusy(true);
    try {
      await deleteMyUnitVehicle(id, effectiveCondoId);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao remover.');
    } finally {
      setBusy(false);
    }
  };

  const openPet = (row?: Record<string, unknown>) => {
    setPetEditingId(row ? num(row.id) : null);
    setPetName(str(row?.name));
    setPetSpecies(str(row?.species));
    setPetBreed(str(row?.breed));
    setPetColor(str(row?.color));
    setPetOpen(true);
  };

  const submitPet = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!session || effectiveCondoId < 1 || currentUnitId < 1) {
      return;
    }
    const name = petName.trim();
    const species = petSpecies.trim();
    if (!name || !species) {
      window.alert('Nome e espécie são obrigatórios.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body = {
        condoId: effectiveCondoId,
        unitId: currentUnitId,
        name,
        species,
        breed: petBreed.trim(),
        color: petColor.trim(),
      };
      if (petEditingId != null) {
        await patchMyUnitPet(petEditingId, body);
      } else {
        await postMyUnitPet(body);
      }
      setPetOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar pet.');
    } finally {
      setBusy(false);
    }
  };

  const removePet = async (id: number) => {
    if (!session || effectiveCondoId < 1) {
      return;
    }
    if (!window.confirm('Remover este pet?')) {
      return;
    }
    setBusy(true);
    try {
      await deleteMyUnitPet(id, effectiveCondoId);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao remover.');
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return null;
  }

  const residents = bundle?.residents ?? [];
  const vehicles = bundle?.vehicles ?? [];
  const pets = bundle?.pets ?? [];

  return (
    <StaffLayout title="Minha Unidade" backTo="/app">
      <div className="staff-hero">
        <h2>Cadastro da sua moradia</h2>
        <p className="staff-muted">
          Escolha a unidade, mantenha moradores, veículos e pets alinhados ao mesmo fluxo do aplicativo móvel (API{' '}
          <code>/api/my-unit</code>).
        </p>
      </div>

      <div className="portal-inline" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <button type="button" className="portal-btn" onClick={() => void load()} disabled={busy || loading}>
          Atualizar
        </button>
        {picksCondoBeforeContact(session.role) ? (
          <span className="staff-muted">
            Condomínio: {effectiveCondoId} · Unidade guardada localmente ao mudar o seletor (como no app).
          </span>
        ) : null}
      </div>

      {effectiveCondoId < 1 ? (
        <p className="staff-error">Condomínio inválido.</p>
      ) : null}
      {err ? <p className="staff-error">{err}</p> : null}

      {loading ? (
        <p>A carregar…</p>
      ) : units == null ? (
        <p className="staff-muted">Não foi possível carregar as unidades. Toque em «Atualizar».</p>
      ) : units.length === 0 ? (
        <p className="staff-muted">Não há unidades cadastradas neste condomínio.</p>
      ) : (
        <>
          <div
            style={{
              padding: 16,
              borderRadius: 16,
              background: 'var(--portal-accent-soft, rgba(37, 99, 235, 0.12))',
              marginBottom: 18,
            }}
          >
            <h3 style={{ margin: '0 0 10px', fontSize: '1.05rem' }}>Selecione a unidade</h3>
            <select
              className="portal-input"
              value={selectedUnitId != null && selectedUnitId > 0 ? String(selectedUnitId) : ''}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(v) && v > 0) {
                  void onUnitChange(v);
                }
              }}
              disabled={busy || !units?.length}
            >
              {!units?.length ? (
                <option value="">—</option>
              ) : (
                units.map((u) => (
                  <option key={num(u.id)} value={num(u.id)}>
                    {unitLabel(u)}
                  </option>
                ))
              )}
            </select>
          </div>

          {currentUnitId < 1 ? (
            <p className="staff-muted">Selecione uma unidade para ver os dados.</p>
          ) : (
            <>
              {busy ? (
                <div style={{ marginBottom: 8 }}>
                  <div
                    style={{
                      height: 3,
                      background: 'linear-gradient(90deg, var(--portal-accent, #2563eb), transparent)',
                      borderRadius: 2,
                    }}
                  />
                </div>
              ) : null}

              <section style={{ marginBottom: 22 }}>
                <div className="portal-inline" style={{ justifyContent: 'space-between', width: '100%', marginBottom: 8 }}>
                  <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Moradores vinculados</h3>
                  <button type="button" className="portal-btn portal-btn--primary" onClick={() => openResident()} disabled={busy}>
                    Adicionar
                  </button>
                </div>
                {residents.length === 0 ? (
                  <p className="staff-muted" style={{ padding: '12px 0' }}>Nenhum morador cadastrado.</p>
                ) : (
                  <ul className="staff-list">
                    {residents.map((r) => {
                      const id = num(r.id);
                      return (
                        <li key={id}>
                          <div>
                            <strong>{str(r.full_name)}</strong>
                            <div className="staff-muted" style={{ marginTop: 4 }}>
                              {roleLabelPt(str(r.role))} · {str(r.phone) || '—'}
                            </div>
                            <div className="portal-inline" style={{ marginTop: 8 }}>
                              <button type="button" className="portal-btn" onClick={() => openResident(r)} disabled={busy}>
                                Editar
                              </button>
                              <button
                                type="button"
                                className="portal-link-danger"
                                onClick={() => void removeResident(id)}
                                disabled={busy}
                              >
                                Excluir
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section style={{ marginBottom: 22 }}>
                <div className="portal-inline" style={{ justifyContent: 'space-between', width: '100%', marginBottom: 8 }}>
                  <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Veículos</h3>
                  <button type="button" className="portal-btn portal-btn--primary" onClick={() => openVehicle()} disabled={busy}>
                    Adicionar
                  </button>
                </div>
                {vehicles.length === 0 ? (
                  <p className="staff-muted" style={{ padding: '12px 0' }}>Nenhum veículo cadastrado.</p>
                ) : (
                  <ul className="staff-list">
                    {vehicles.map((v) => {
                      const id = num(v.id);
                      return (
                        <li key={id}>
                          <div>
                            <strong>{str(v.model)}</strong>
                            <div className="staff-muted" style={{ marginTop: 4 }}>
                              {str(v.plate)} · Vaga {str(v.parking_spot) || '—'}
                            </div>
                            <div className="portal-inline" style={{ marginTop: 8 }}>
                              <button type="button" className="portal-btn" onClick={() => openVehicle(v)} disabled={busy}>
                                Editar
                              </button>
                              <button
                                type="button"
                                className="portal-link-danger"
                                onClick={() => void removeVehicle(id)}
                                disabled={busy}
                              >
                                Excluir
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section style={{ marginBottom: 22 }}>
                <div className="portal-inline" style={{ justifyContent: 'space-between', width: '100%', marginBottom: 8 }}>
                  <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Pets</h3>
                  <button type="button" className="portal-btn portal-btn--primary" onClick={() => openPet()} disabled={busy}>
                    Adicionar
                  </button>
                </div>
                {pets.length === 0 ? (
                  <p className="staff-muted" style={{ padding: '12px 0' }}>Nenhum pet cadastrado.</p>
                ) : (
                  <ul className="staff-list">
                    {pets.map((p) => {
                      const id = num(p.id);
                      return (
                        <li key={id}>
                          <div>
                            <strong>{str(p.name)}</strong>
                            <div className="staff-muted" style={{ marginTop: 4 }}>
                              {str(p.species)} · {str(p.breed) || '—'}
                            </div>
                            <div className="portal-inline" style={{ marginTop: 8 }}>
                              <button type="button" className="portal-btn" onClick={() => openPet(p)} disabled={busy}>
                                Editar
                              </button>
                              <button
                                type="button"
                                className="portal-link-danger"
                                onClick={() => void removePet(id)}
                                disabled={busy}
                              >
                                Excluir
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section style={{ marginBottom: 12 }}>
                <h3 style={{ fontSize: '1.15rem', marginBottom: 8 }}>Atualização de dados pessoais</h3>
                <form
                  onSubmit={savePersonal}
                  style={{
                    padding: 14,
                    borderRadius: 16,
                    border: '1px solid var(--portal-border, #e5e7eb)',
                  }}
                >
                  <label>
                    Nome completo
                    <input className="portal-input" value={pName} onChange={(e) => setPName(e.target.value)} required />
                  </label>
                  <label>
                    Telefone
                    <input className="portal-input" value={pPhone} onChange={(e) => setPPhone(e.target.value)} />
                  </label>
                  <label>
                    E-mail
                    <input className="portal-input" type="email" value={pEmail} onChange={(e) => setPEmail(e.target.value)} />
                  </label>
                  <div className="portal-form__actions">
                    <button type="submit" className="portal-btn portal-btn--primary" disabled={busy}>
                      Salvar dados pessoais
                    </button>
                  </div>
                </form>
              </section>
            </>
          )}
        </>
      )}

      {resOpen ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 480 }}>
            <h3>{resEditingId != null ? 'Editar morador' : 'Novo morador'}</h3>
            <form onSubmit={(e) => void submitResident(e)}>
              <label>
                Papel
                <select className="portal-input" value={resRole} onChange={(e) => setResRole(e.target.value)}>
                  <option value="owner">Proprietário</option>
                  <option value="tenant">Locatário</option>
                  <option value="resident">Morador</option>
                  <option value="other">Outro</option>
                </select>
              </label>
              <label>
                Nome completo
                <input className="portal-input" value={resName} onChange={(e) => setResName(e.target.value)} required />
              </label>
              <label>
                Telefone
                <input className="portal-input" value={resPhone} onChange={(e) => setResPhone(e.target.value)} />
              </label>
              <label>
                E-mail
                <input className="portal-input" type="email" value={resEmail} onChange={(e) => setResEmail(e.target.value)} />
              </label>
              <label>
                Observações
                <textarea className="portal-input" rows={2} value={resNotes} onChange={(e) => setResNotes(e.target.value)} />
              </label>
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={busy}>
                  Salvar
                </button>
                <button type="button" className="portal-btn" onClick={() => setResOpen(false)} disabled={busy}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {vehOpen ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 480 }}>
            <h3>{vehEditingId != null ? 'Editar veículo' : 'Novo veículo'}</h3>
            <form onSubmit={(e) => void submitVehicle(e)}>
              <label>
                Modelo
                <input className="portal-input" value={vehModel} onChange={(e) => setVehModel(e.target.value)} required />
              </label>
              <label>
                Placa
                <input className="portal-input" value={vehPlate} onChange={(e) => setVehPlate(e.target.value)} required />
              </label>
              <label>
                Vaga
                <input className="portal-input" value={vehSpot} onChange={(e) => setVehSpot(e.target.value)} />
              </label>
              <label>
                Cor
                <input className="portal-input" value={vehColor} onChange={(e) => setVehColor(e.target.value)} />
              </label>
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={busy}>
                  Salvar
                </button>
                <button type="button" className="portal-btn" onClick={() => setVehOpen(false)} disabled={busy}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {petOpen ? (
        <div className="portal-modal" role="dialog">
          <div className="portal-modal__card" style={{ maxWidth: 480 }}>
            <h3>{petEditingId != null ? 'Editar pet' : 'Novo pet'}</h3>
            <form onSubmit={(e) => void submitPet(e)}>
              <label>
                Nome
                <input className="portal-input" value={petName} onChange={(e) => setPetName(e.target.value)} required />
              </label>
              <label>
                Espécie
                <input className="portal-input" value={petSpecies} onChange={(e) => setPetSpecies(e.target.value)} required />
              </label>
              <label>
                Raça
                <input className="portal-input" value={petBreed} onChange={(e) => setPetBreed(e.target.value)} />
              </label>
              <label>
                Cor
                <input className="portal-input" value={petColor} onChange={(e) => setPetColor(e.target.value)} />
              </label>
              <div className="portal-form__actions">
                <button type="submit" className="portal-btn portal-btn--primary" disabled={busy}>
                  Salvar
                </button>
                <button type="button" className="portal-btn" onClick={() => setPetOpen(false)} disabled={busy}>
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

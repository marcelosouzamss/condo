/** Mesma chave que `CondoApi.residentSelectedUnitPrefKey` no app móvel. */
const PREFIX = 'resident_selected_unit_v1_';

export function readResidentSelectedUnitId(condoId: number): number | null {
  try {
    const v = sessionStorage.getItem(`${PREFIX}${condoId}`);
    if (v == null || v === '') {
      return null;
    }
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeResidentSelectedUnitId(condoId: number, unitId: number): void {
  sessionStorage.setItem(`${PREFIX}${condoId}`, String(unitId));
}

export function clearResidentSelectedUnitId(condoId: number): void {
  sessionStorage.removeItem(`${PREFIX}${condoId}`);
}

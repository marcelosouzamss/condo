export function homeFeatureOrderStorageKey(condoId: number, userId: number): string {
  return `condo_home_feature_order_v1_${condoId}_${userId}`;
}

export function readHomeFeatureOrder(condoId: number, userId: number): string[] {
  try {
    const raw = localStorage.getItem(homeFeatureOrderStorageKey(condoId, userId));
    if (!raw) {
      return [];
    }
    const decoded = JSON.parse(raw) as unknown;
    if (!Array.isArray(decoded)) {
      return [];
    }
    return decoded
      .map((value) => (value == null ? '' : String(value).trim()))
      .filter((label) => label.length > 0);
  } catch {
    return [];
  }
}

export function writeHomeFeatureOrder(
  condoId: number,
  userId: number,
  labels: string[],
): void {
  localStorage.setItem(homeFeatureOrderStorageKey(condoId, userId), JSON.stringify(labels));
}

export function normalizeHomeFeatureOrder(
  savedOrder: string[],
  visibleLabels: string[],
): string[] {
  const visible = new Set(visibleLabels);
  const next = savedOrder.filter((label) => visible.has(label));
  for (const label of visibleLabels) {
    if (!next.includes(label)) {
      next.push(label);
    }
  }
  return next;
}

export function applyHomeFeatureOrder<T extends { label: string }>(
  items: T[],
  savedOrder: string[],
): T[] {
  if (savedOrder.length === 0) {
    return items;
  }
  const rank = new Map(savedOrder.map((label, index) => [label, index]));
  return [...items].sort((a, b) => {
    const ra = rank.get(a.label) ?? 100000;
    const rb = rank.get(b.label) ?? 100000;
    if (ra !== rb) {
      return ra - rb;
    }
    return a.label.localeCompare(b.label, 'pt-BR');
  });
}

export function reorderHomeFeatureLabels(
  order: string[],
  fromLabel: string,
  toLabel: string,
): string[] {
  if (fromLabel === toLabel) {
    return order;
  }
  const next = [...order];
  const from = next.indexOf(fromLabel);
  const to = next.indexOf(toLabel);
  if (from < 0 || to < 0) {
    return order;
  }
  next.splice(from, 1);
  next.splice(to, 0, fromLabel);
  return next;
}

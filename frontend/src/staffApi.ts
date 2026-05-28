import { apiUrl } from './api';

async function readErrorBody(r: Response): Promise<string> {
  try {
    const t = await r.text();
    if (!t) {
      return r.statusText || `Erro ${r.status}`;
    }
    const j = JSON.parse(t) as { message?: string };
    return j.message ?? t;
  } catch {
    return r.statusText || `Erro ${r.status}`;
  }
}

export async function fetchJson<T>(pathWithQuery: string): Promise<T> {
  const r = await fetch(apiUrl(pathWithQuery));
  if (!r.ok) {
    throw new Error(await readErrorBody(r));
  }
  return r.json() as Promise<T>;
}

export type SyndicDashboard = {
  condoId: number;
  metrics: {
    openOccurrences: number;
    maintenanceRequestsOpen: number;
    recentCommunications: number;
  };
  approvalSummary: {
    pendingReservations: number;
    pendingRegistrations: number;
  };
};

export function getSyndicDashboard(condoId: number) {
  return fetchJson<SyndicDashboard>(
    `/api/syndic/dashboard?condoId=${encodeURIComponent(String(condoId))}`,
  );
}

export type AdminFinancialOverview = {
  invoicesIssued: number;
  delinquencyPercent: number;
  unpaidOpen: number;
  paidCharges: number;
  unitsTotal: number;
  unitsBillingActive: number;
};

export function getAdministratorFinancialOverview(condoId: number, userId: number) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    userId: String(userId),
  });
  return fetchJson<AdminFinancialOverview>(
    `/api/administrator/financial-overview?${q.toString()}`,
  );
}

/** Resposta de `GET /api/administrator/reports/summary`. */
export type AdminReportsSummary = {
  financial: {
    chargesIssued: number;
    chargesOpen: number;
    delinquencyPercent: number;
    amountOpenRough: number;
  };
  delinquencyByUnit: Array<{
    unitId: number;
    tower: string | null;
    number: string | null;
    overdueCount: number;
    pendingCount: number;
    amountDue: number;
  }>;
  occurrencesOpen: number;
  maintenanceOpen: number;
  reservationsLast90Days: number;
  unitsOccupied: number;
  unitsTotal: number;
};

export function getAdministratorReportsSummary(condoId: number, userId: number) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    userId: String(userId),
  });
  return fetchJson<AdminReportsSummary>(
    `/api/administrator/reports/summary?${q.toString()}`,
  );
}

export function getSyndicNotices(condoId: number, userId: number, includeArchived = false) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    userId: String(userId),
  });
  if (includeArchived) {
    q.set('includeArchived', 'true');
  }
  return fetchJson<unknown[]>(`/api/syndic/notices?${q.toString()}`);
}

export function getAdministratorUnits(condoId: number) {
  return fetchJson<unknown[]>(
    `/api/administrator/units?condoId=${encodeURIComponent(String(condoId))}`,
  );
}

export function getAdministratorUnitResidents(condoId: number, unitId: number) {
  const q = new URLSearchParams({ condoId: String(condoId) });
  return fetchJson<unknown[]>(
    `/api/administrator/units/${unitId}/residents?${q.toString()}`,
  );
}

export function getSyndicOccurrences(condoId: number, status?: string) {
  let path = `/api/syndic/occurrences?condoId=${encodeURIComponent(String(condoId))}`;
  if (status) {
    path += `&status=${encodeURIComponent(status)}`;
  }
  return fetchJson<unknown[]>(path);
}

export function getSyndicMaintenanceRequests(condoId: number) {
  return fetchJson<unknown[]>(
    `/api/syndic/maintenance-requests?condoId=${encodeURIComponent(String(condoId))}`,
  );
}

export type RelationInboxRow = {
  thread_id: number;
  unit_id: number | null;
  partner_user_id?: number | null;
  unit_tower?: string;
  unit_number?: string;
  resident_name?: string;
  last_message_body?: string;
  last_message_at?: string;
};

export type RelationInboxStats = {
  threadCount: number;
  conversationCount: number;
  awaitingStaffReplyCount: number;
};

export function getRelationsInbox(condoId: number, channel: 'syndic' | 'administration' | 'doorman' | 'collaborator') {
  const q = new URLSearchParams({
    condoId: String(condoId),
    channel,
  });
  return fetchJson<RelationInboxRow[]>(`/api/relations/inbox?${q.toString()}`);
}

export function getRelationsInboxStats(
  condoId: number,
  channel: 'syndic' | 'administration' | 'doorman' | 'collaborator',
) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    channel,
  });
  return fetchJson<RelationInboxStats>(`/api/relations/inbox-stats?${q.toString()}`);
}

export function getSyndicFinancialReport(condoId: number, month?: string) {
  const q = new URLSearchParams({ condoId: String(condoId) });
  if (month) {
    q.set('month', month);
  }
  return fetchJson<unknown>(`/api/syndic/reports/financial?${q.toString()}`);
}

export function getSyndicAreaUsageReport(condoId: number) {
  return fetchJson<unknown>(
    `/api/syndic/reports/area-usage?condoId=${encodeURIComponent(String(condoId))}`,
  );
}

export function getSyndicOperationsReport(condoId: number) {
  return fetchJson<unknown>(
    `/api/syndic/reports/operations?condoId=${encodeURIComponent(String(condoId))}`,
  );
}

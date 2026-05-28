import {
  deleteVoid,
  getJson,
  patchJson,
  postFormDataJson,
  postJson,
  putJson,
} from './jsonHttp';

export type AccessStats = {
  visitorsExpected: number;
  visitorsInside: number;
  providersActive: number;
  entriesToday: number;
};

export function getAccessStats(condoId: number, userId: number) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    userId: String(userId),
  });
  return getJson<AccessStats>(`/api/access-control/stats?${q}`);
}

export type VisitorPassRow = Record<string, unknown>;

export function getVisitorPasses(condoId: number, userId: number, status: string) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    userId: String(userId),
    status,
  });
  return getJson<VisitorPassRow[]>(`/api/access-control/visitor-passes?${q}`);
}

export function getAccessEvents(condoId: number, userId: number, limit = 120) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    userId: String(userId),
    limit: String(limit),
  });
  return getJson<Record<string, unknown>[]>(`/api/access-control/events?${q}`);
}

export function getServiceProviders(condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return getJson<Record<string, unknown>[]>(`/api/access-control/service-providers?${q}`);
}

export type ValidateResponse = {
  ok?: boolean;
  pass?: VisitorPassRow;
  hint?: string;
};

export function validateAccessPin(
  condoId: number,
  userId: number,
  pinCode: string,
) {
  return postJson<ValidateResponse>('/api/access-control/validate', {
    condoId,
    userId,
    pinCode,
  });
}

export function createVisitorPass(body: {
  condoId: number;
  userId: number;
  unitId: number;
  visitorFullName: string;
  visitorPhone?: string | null;
  documentId?: string | null;
  notes?: string | null;
  validFrom: string;
  validUntil: string;
}) {
  return postJson<VisitorPassRow>('/api/access-control/visitor-passes', body);
}

export function checkInPass(
  passId: number,
  condoId: number,
  userId: number,
  method: string,
) {
  return postJson<unknown>(`/api/access-control/visitor-passes/${passId}/check-in`, {
    condoId,
    userId,
    method,
  });
}

export function checkOutPass(
  passId: number,
  condoId: number,
  userId: number,
  method: string,
) {
  return postJson<unknown>(`/api/access-control/visitor-passes/${passId}/check-out`, {
    condoId,
    userId,
    method,
  });
}

export function revokeVisitorPass(passId: number, condoId: number, userId: number) {
  return patchJson<VisitorPassRow>(`/api/access-control/visitor-passes/${passId}`, {
    condoId,
    userId,
    status: 'revoked',
  });
}

export function createServiceProvider(body: {
  condoId: number;
  userId: number;
  companyName: string;
  notes?: string | null;
}) {
  return postJson<Record<string, unknown>>('/api/access-control/service-providers', body);
}

export type UnitRow = {
  id: number;
  tower: string | null;
  number: string | null;
  billing_active?: boolean;
};

export function getUnitsForCondo(condoId: number) {
  return getJson<UnitRow[]>(
    `/api/units?condoId=${encodeURIComponent(String(condoId))}`,
  );
}

/** Pacote `/api/my-unit` (unidade, dados pessoais exibidos, moradores, veículos, pets). */
export type MyUnitBundle = {
  unit: Record<string, unknown> | null;
  personalData: { fullName?: string; phone?: string; email?: string };
  residents: Record<string, unknown>[];
  vehicles: Record<string, unknown>[];
  pets: Record<string, unknown>[];
};

export function getMyUnitBundle(condoId: number, unitId?: number) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    _ts: String(Date.now()),
  });
  if (unitId != null && unitId > 0) {
    q.set('unitId', String(unitId));
  }
  return getJson<MyUnitBundle>(`/api/my-unit?${q.toString()}`);
}

export function patchMyUnitPersonalData(body: {
  condoId: number;
  unitId: number;
  fullName: string;
  phone: string;
  email: string;
}) {
  return patchJson<Record<string, unknown>>('/api/my-unit/personal-data', body);
}

export function postMyUnitResident(body: {
  condoId: number;
  unitId: number;
  role: string;
  fullName: string;
  phone: string;
  email: string;
  notes: string;
}) {
  return postJson<Record<string, unknown>>('/api/my-unit/residents', body);
}

export function patchMyUnitResident(
  id: number,
  body: {
    condoId: number;
    role: string;
    fullName: string;
    phone: string;
    email: string;
    notes: string;
  },
) {
  return patchJson<Record<string, unknown>>(`/api/my-unit/residents/${id}`, body);
}

export function deleteMyUnitResident(id: number, condoId: number) {
  const q = new URLSearchParams({ condoId: String(condoId) });
  return deleteVoid(`/api/my-unit/residents/${id}?${q}`);
}

export function postMyUnitVehicle(body: {
  condoId: number;
  unitId: number;
  model: string;
  plate: string;
  parkingSpot: string;
  color: string;
}) {
  return postJson<Record<string, unknown>>('/api/my-unit/vehicles', body);
}

export function patchMyUnitVehicle(
  id: number,
  body: {
    condoId: number;
    model: string;
    plate: string;
    parkingSpot: string;
    color: string;
  },
) {
  return patchJson<Record<string, unknown>>(`/api/my-unit/vehicles/${id}`, body);
}

export function deleteMyUnitVehicle(id: number, condoId: number) {
  const q = new URLSearchParams({ condoId: String(condoId) });
  return deleteVoid(`/api/my-unit/vehicles/${id}?${q}`);
}

export function postMyUnitPet(body: {
  condoId: number;
  unitId: number;
  name: string;
  species: string;
  breed: string;
  color: string;
}) {
  return postJson<Record<string, unknown>>('/api/my-unit/pets', body);
}

export function patchMyUnitPet(
  id: number,
  body: { condoId: number; name: string; species: string; breed: string; color: string },
) {
  return patchJson<Record<string, unknown>>(`/api/my-unit/pets/${id}`, body);
}

export function deleteMyUnitPet(id: number, condoId: number) {
  const q = new URLSearchParams({ condoId: String(condoId) });
  return deleteVoid(`/api/my-unit/pets/${id}?${q}`);
}

/** Competências / campanhas de cobrança (síndico ou administração). */
export type BillingCampaignRow = Record<string, unknown>;

export function getBillingCampaigns(condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return getJson<BillingCampaignRow[]>(`/api/billing/campaigns?${q}`);
}

export function createBillingCampaign(body: {
  condoId: number;
  userId: number;
  title: string;
  competence: string;
  dueDate: string;
  notes?: string | null;
  finePercent?: number | null;
  interestPercentMonth?: number | null;
  discountAmount?: number | null;
}) {
  return postJson<BillingCampaignRow>('/api/billing/campaigns', body);
}

export function patchBillingCampaign(
  id: number,
  body: {
    condoId: number;
    userId: number;
    title?: string;
    competence?: string;
    dueDate?: string;
    notes?: string | null;
    finePercent?: number | null;
    interestPercentMonth?: number | null;
    discountAmount?: number | null;
  },
) {
  return patchJson<BillingCampaignRow>(`/api/billing/campaigns/${id}`, body);
}

export function deleteBillingCampaign(id: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/billing/campaigns/${id}?${q}`);
}

export function getBillingCampaign(
  id: number,
  condoId: number,
  userId: number,
) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return getJson<BillingCampaignRow>(`/api/billing/campaigns/${id}?${q}`);
}

export function getBillingCampaignCharges(
  campaignId: number,
  condoId: number,
  userId: number,
) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return getJson<Record<string, unknown>[]>(
    `/api/billing/campaigns/${campaignId}/charges?${q}`,
  );
}

export function postGenerateCampaignCharges(campaignId: number, condoId: number, userId: number) {
  return postJson<{ chargesTotal?: number }>(
    `/api/billing/campaigns/${campaignId}/generate`,
    { condoId, userId },
  );
}

export function postGenerateOneCharge(
  campaignId: number,
  condoId: number,
  userId: number,
  unitId: number,
) {
  return postJson<unknown>(`/api/billing/campaigns/${campaignId}/charges/generate-one`, {
    condoId,
    userId,
    unitId,
  });
}

export function postFinalizeCampaign(campaignId: number, condoId: number, userId: number) {
  return postJson<unknown>(`/api/billing/campaigns/${campaignId}/finalize`, {
    condoId,
    userId,
  });
}

export function postMarkChargePaid(chargeId: number, condoId: number, userId: number) {
  return postJson<unknown>(`/api/billing/charges/${chargeId}/mark-paid`, {
    condoId,
    userId,
  });
}

export function getMyCharges(condoId: number, userId: number, unitId: number) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    userId: String(userId),
    unitId: String(unitId),
  });
  return getJson<Record<string, unknown>[]>(`/api/billing/my-charges?${q}`);
}

export type OfferRow = Record<string, unknown>;

export function listOffers(params: {
  condoId: number;
  category?: string;
  includeInactive?: boolean;
  forUserId?: number;
}) {
  const q = new URLSearchParams({ condoId: String(params.condoId) });
  if (params.category && params.category !== 'Todas') {
    q.set('category', params.category);
  }
  if (params.includeInactive) {
    q.set('includeInactive', 'true');
  }
  if (params.forUserId != null) {
    q.set('forUserId', String(params.forUserId));
  }
  return getJson<OfferRow[]>(`/api/offers?${q.toString()}`);
}

export function createOffer(body: {
  condoId: number;
  userId: number;
  scope: string;
  title: string;
  description: string;
  partnerLabel?: string | null;
  category: string;
  redemptionKind: string;
  couponText?: string | null;
  programInstructions?: string | null;
  contactPhone?: string | null;
  contactWhatsapp?: string | null;
  contactEmail?: string | null;
  contactUrl?: string | null;
}) {
  return postJson<OfferRow>('/api/offers', body);
}

export function patchOffer(
  id: number,
  body: {
    userId: number;
    title?: string;
    description?: string;
    partnerLabel?: string | null;
    category?: string;
    redemptionKind?: string;
    couponText?: string | null;
    programInstructions?: string | null;
    contactPhone?: string | null;
    contactWhatsapp?: string | null;
    contactEmail?: string | null;
    contactUrl?: string | null;
    active?: boolean;
  },
) {
  return patchJson<OfferRow>(`/api/offers/${id}`, body);
}

export function deleteOffer(id: number, userId: number) {
  return deleteVoid(`/api/offers/${id}?userId=${encodeURIComponent(String(userId))}`);
}

export function enrollInOffer(offerId: number, userId: number) {
  return postJson<Record<string, unknown>>(`/api/offers/${offerId}/enroll`, {
    userId,
  });
}

export type CondoPickerRow = { id: number; name: string; created_at?: string };

export function getCondosForContactPicker(userId: number) {
  return getJson<CondoPickerRow[]>(
    `/api/condos?userId=${encodeURIComponent(String(userId))}`,
  );
}

/** Cadastro global de condomínio (apenas `role === admin` na API). */
export function createCondo(body: { userId: number; name: string }) {
  return postJson<CondoPickerRow>('/api/condos', body);
}

export function getRelationUnitSummary(condoId: number, unitId: number) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    unitId: String(unitId),
  });
  return getJson<Record<string, unknown>[]>(`/api/relations/unit-summary?${q}`);
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

export type RelationChannel = 'syndic' | 'administration' | 'doorman' | 'collaborator';

export function getRelationsInboxApi(condoId: number, channel: RelationChannel) {
  const q = new URLSearchParams({ condoId: String(condoId), channel });
  return getJson<RelationInboxRow[]>(`/api/relations/inbox?${q.toString()}`);
}

export type ConversationResponse = {
  thread: Record<string, unknown> | null;
  messages: Record<string, unknown>[];
};

export function getRelationConversation(
  condoId: number,
  unitId: number,
  channel: string,
) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    unitId: String(unitId),
    channel,
  });
  return getJson<ConversationResponse>(`/api/relations/conversation?${q.toString()}`);
}

/** Conversa do parceiro com síndico/administração (sem unidade). */
export function getPartnerRelationConversation(
  condoId: number,
  channel: string,
  userId: number,
) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    channel,
    userId: String(userId),
  });
  return getJson<ConversationResponse>(
    `/api/relations/partner-conversation?${q.toString()}`,
  );
}

export type ThreadResponse = {
  thread: Record<string, unknown>;
  messages: Record<string, unknown>[];
};

export function getRelationThread(threadId: number, condoId: number) {
  const q = new URLSearchParams({ condoId: String(condoId) });
  return getJson<ThreadResponse>(
    `/api/relations/threads/${threadId}?${q.toString()}`,
  );
}

export function postRelationMessage(body: {
  condoId: number;
  body: string;
  senderSide: 'resident' | 'staff' | 'partner';
  threadId?: number;
  unitId?: number;
  channel?: string;
  partnerUserId?: number;
}) {
  return postJson<Record<string, unknown>>('/api/relations/messages', body);
}

/** Mural público (moradores): apenas avisos vigentes. */
export type PublicNoticeRow = Record<string, unknown>;

export function listPublicNotices(
  condoId: number,
  includeArchived = false,
  userRole?: string,
) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    _t: String(Date.now()),
  });
  if (includeArchived) {
    q.set('includeArchived', 'true');
  }
  if (userRole) {
    q.set('userRole', userRole);
  }
  return getJson<PublicNoticeRow[]>(`/api/notices?${q.toString()}`);
}

export function listStaffNotices(condoId: number, userId: number, includeArchived = false) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    userId: String(userId),
    _t: String(Date.now()),
  });
  if (includeArchived) {
    q.set('includeArchived', 'true');
  }
  return getJson<PublicNoticeRow[]>(`/api/syndic/notices?${q.toString()}`);
}

export function createStaffNotice(body: {
  condoId: number;
  userId: number;
  title: string;
  content: string;
  urgency?: 'normal' | 'urgent';
  isPinned?: boolean;
  audience?: string | null;
  publishedAt?: string;
  expiresAt?: string | null;
}) {
  return postJson<PublicNoticeRow>('/api/syndic/notices', body);
}

export function patchStaffNotice(
  noticeId: number,
  body: {
    condoId: number;
    userId: number;
    title?: string;
    content?: string;
    urgency?: 'normal' | 'urgent';
    isPinned?: boolean;
    isArchived?: boolean;
    audience?: string | null;
    publishedAt?: string;
    expiresAt?: string | null;
  },
) {
  return patchJson<PublicNoticeRow>(`/api/syndic/notices/${noticeId}`, body);
}

export function deleteStaffNotice(noticeId: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/syndic/notices/${noticeId}?${q.toString()}`);
}

export type ReservationSpaceRow = Record<string, unknown>;

export function listReservationSpaces(condoId: number) {
  return getJson<ReservationSpaceRow[]>(
    `/api/reservation-spaces?condoId=${encodeURIComponent(String(condoId))}`,
  );
}

export function createReservationSpace(body: {
  condoId: number;
  name: string;
  description: string;
  iconKey?: string;
  capacity?: number | null;
  requiresApproval?: boolean;
  photoUrls?: string[];
}) {
  return postJson<ReservationSpaceRow>('/api/reservation-spaces', body);
}

export function updateReservationSpace(
  spaceId: number,
  body: {
    condoId: number;
    name: string;
    description: string;
    iconKey?: string;
    capacity?: number | null;
    requiresApproval?: boolean;
    photoUrls?: string[];
  },
) {
  return patchJson<ReservationSpaceRow>(`/api/reservation-spaces/${spaceId}`, body);
}

export function deleteReservationSpace(spaceId: number, condoId: number) {
  const q = new URLSearchParams({ condoId: String(condoId) });
  return deleteVoid(`/api/reservation-spaces/${spaceId}?${q}`);
}

export function uploadReservationSpacePhoto(condoId: number, file: File) {
  const fd = new FormData();
  fd.append('photo', file, file.name);
  const q = new URLSearchParams({ condoId: String(condoId) });
  return postFormDataJson<{ photoUrl: string }>(
    `/api/reservation-spaces/upload-photo?${q}`,
    fd,
  );
}

export type CalendarDayBooking = {
  id: number;
  tower: string;
  number: string;
  status: string;
  requesterName: string;
};

export type CalendarDayCell = {
  date: string;
  cell: 'free' | 'pending' | 'approved' | 'past';
  available: boolean;
  bookings?: CalendarDayBooking[];
};

export type SpaceCalendarResponse = {
  year: number;
  month: number;
  spaceId: number;
  days: CalendarDayCell[];
};

export function getReservationSpaceCalendar(
  spaceId: number,
  condoId: number,
  year: number,
  month: number,
  options?: { staffView?: boolean },
) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    year: String(year),
    month: String(month),
  });
  if (options?.staffView) {
    q.set('staffView', '1');
  }
  return getJson<SpaceCalendarResponse>(
    `/api/reservation-spaces/${spaceId}/calendar?${q.toString()}`,
  );
}

export function createSpaceReservation(
  spaceId: number,
  body: {
    condoId: number;
    unitId: number;
    date: string;
    requesterName?: string | null;
  },
) {
  return postJson<Record<string, unknown>>(
    `/api/reservation-spaces/${spaceId}/reservations`,
    body,
  );
}

export function listMySpaceReservations(condoId: number, unitId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), unitId: String(unitId) });
  return getJson<Record<string, unknown>[]>(
    `/api/reservation-spaces/my-reservations?${q.toString()}`,
  );
}

export function cancelSpaceReservation(
  reservationId: number,
  condoId: number,
  unitId: number,
) {
  return patchJson<Record<string, unknown>>(
    `/api/reservation-spaces/reservations/${reservationId}/cancel`,
    { condoId, unitId },
  );
}

export type PendingReservationRow = Record<string, unknown>;

export function listPendingReservationApprovals(condoId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), status: 'pending' });
  return getJson<PendingReservationRow[]>(
    `/api/syndic/approvals/reservations?${q.toString()}`,
  );
}

export function patchReservationApproval(
  reservationId: number,
  body: { status: 'approved' | 'rejected' | 'cancelled' | 'pending'; notes?: string | null },
) {
  return patchJson<Record<string, unknown>>(
    `/api/syndic/approvals/reservations/${reservationId}`,
    body,
  );
}

export type IndividualCommRow = Record<string, unknown>;

export function getIndividualCommsInbox(condoId: number, unitId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), unitId: String(unitId) });
  return getJson<IndividualCommRow[]>(`/api/individual-comms/inbox?${q}`);
}

export function getIndividualCommsSentByUnit(condoId: number, unitId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), unitId: String(unitId) });
  return getJson<IndividualCommRow[]>(`/api/individual-comms/sent-by-unit?${q}`);
}

export function getIndividualCommsStaffSent(condoId: number, role: string) {
  const q = new URLSearchParams({ condoId: String(condoId), role });
  return getJson<IndividualCommRow[]>(`/api/individual-comms/staff-sent?${q}`);
}

export function getIndividualCommAsUnit(condoId: number, id: number, viewerUnitId: number) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    viewerUnitId: String(viewerUnitId),
  });
  return getJson<IndividualCommRow>(`/api/individual-comms/${id}?${q}`);
}

export function getIndividualCommAsStaff(
  condoId: number,
  id: number,
  viewerStaffRole: string,
) {
  const q = new URLSearchParams({ condoId: String(condoId), viewerStaffRole });
  return getJson<IndividualCommRow>(`/api/individual-comms/${id}?${q}`);
}

export function postIndividualComm(body: Record<string, unknown>) {
  return postJson<IndividualCommRow>('/api/individual-comms', body);
}

export function patchIndividualCommRead(id: number, condoId: number, unitId: number) {
  return patchJson<Record<string, unknown>>(`/api/individual-comms/${id}/read`, {
    condoId,
    unitId,
  });
}

export function listResidentMaintenanceRequests(condoId: number, unitId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), unitId: String(unitId) });
  return getJson<Record<string, unknown>[]>(`/api/maintenance-requests?${q}`);
}

export function createMaintenanceRequest(body: {
  condoId: number;
  unitId: number;
  title: string;
  description: string;
  priority?: string;
}) {
  return postJson<Record<string, unknown>>('/api/maintenance-requests', body);
}

export function getResidentMaintenanceRequest(
  id: number,
  condoId: number,
  unitId: number,
  userId: number,
) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    unitId: String(unitId),
    userId: String(userId),
  });
  return getJson<Record<string, unknown>>(`/api/maintenance-requests/${id}?${q}`);
}

export function listResidentMaintenanceMessages(
  id: number,
  condoId: number,
  unitId: number,
  userId: number,
) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    unitId: String(unitId),
    userId: String(userId),
  });
  return getJson<Record<string, unknown>[]>(
    `/api/maintenance-requests/${id}/messages?${q}`,
  );
}

export function postResidentMaintenanceMessage(
  id: number,
  body: { condoId: number; unitId: number; userId: number; body: string },
) {
  return postJson<Record<string, unknown>>(`/api/maintenance-requests/${id}/messages`, body);
}

export function patchResidentMaintenanceComplete(
  id: number,
  condoId: number,
  unitId: number,
  userId: number,
) {
  return patchJson<Record<string, unknown>>(`/api/maintenance-requests/${id}`, {
    condoId,
    unitId,
    userId,
    status: 'completed',
  });
}

export function listSyndicMaintenanceRequests(condoId: number) {
  return getJson<Record<string, unknown>[]>(
    `/api/syndic/maintenance-requests?condoId=${encodeURIComponent(String(condoId))}`,
  );
}

export function getSyndicMaintenanceRequest(id: number, condoId: number) {
  return getJson<Record<string, unknown>>(
    `/api/syndic/maintenance-requests/${id}?condoId=${encodeURIComponent(String(condoId))}`,
  );
}

export function listSyndicMaintenanceMessages(id: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return getJson<Record<string, unknown>[]>(
    `/api/syndic/maintenance-requests/${id}/messages?${q}`,
  );
}

export function postSyndicMaintenanceMessage(
  id: number,
  condoId: number,
  userId: number,
  bodyText: string,
) {
  return postJson<Record<string, unknown>>(`/api/syndic/maintenance-requests/${id}/messages`, {
    condoId,
    userId,
    body: bodyText,
  });
}

export function patchSyndicMaintenanceRequest(
  id: number,
  body: {
    condoId: number;
    userId: number;
    status?: string;
    syndicResponse?: string | null;
  },
) {
  return patchJson<Record<string, unknown>>(`/api/syndic/maintenance-requests/${id}`, body);
}

export function listEmergencyIncidents(condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return getJson<Record<string, unknown>[]>(`/api/emergency-incidents?${q}`);
}

export function createEmergencyIncident(body: {
  condoId: number;
  userId: number;
  incidentKind: string;
  description?: string | null;
  unitId?: number;
}) {
  return postJson<Record<string, unknown>>('/api/emergency-incidents', body);
}

export function patchEmergencyIncident(
  id: number,
  body: { userId: number; status: 'open' | 'acknowledged' | 'closed' },
) {
  return patchJson<Record<string, unknown>>(`/api/emergency-incidents/${id}`, body);
}

/** --- Livro de reclamações (`/api/complaints-book`) */
export type ComplaintsBookRow = Record<string, unknown>;

export function listComplaintsBookEntries(params: {
  condoId: number;
  userId: number;
  entryType?: string;
}) {
  const q = new URLSearchParams({
    condoId: String(params.condoId),
    userId: String(params.userId),
  });
  if (params.entryType) {
    q.set('entryType', params.entryType);
  }
  return getJson<ComplaintsBookRow[]>(`/api/complaints-book?${q}`);
}

export function createComplaintsBookEntry(body: {
  condoId: number;
  userId: number;
  entryType: string;
  subject: string;
  description: string;
  unitId?: number;
}) {
  return postJson<ComplaintsBookRow>('/api/complaints-book', body);
}

export function patchComplaintsBookEntry(
  id: number,
  body: {
    userId: number;
    status?: 'open' | 'in_progress' | 'closed';
    adminResponse?: string | null;
  },
) {
  return patchJson<ComplaintsBookRow>(`/api/complaints-book/${id}`, body);
}

export function deleteComplaintsBookEntry(id: number, userId: number) {
  const q = new URLSearchParams({ userId: String(userId) });
  return deleteVoid(`/api/complaints-book/${id}?${q}`);
}

export function listParcelDeliveries(params: {
  condoId: number;
  userId: number;
  unitId?: number;
  onlyPending?: boolean;
  filterUnitId?: number;
}) {
  const q = new URLSearchParams({
    condoId: String(params.condoId),
    userId: String(params.userId),
  });
  if (params.unitId != null) {
    q.set('unitId', String(params.unitId));
  }
  if (params.onlyPending) {
    q.set('onlyPending', 'true');
  }
  if (params.filterUnitId != null) {
    q.set('filterUnitId', String(params.filterUnitId));
  }
  return getJson<Record<string, unknown>[]>(`/api/parcel-deliveries?${q}`);
}

export function registerParcelDelivery(body: {
  condoId: number;
  userId: number;
  unitId: number;
  carrierHint?: string | null;
  recipientLabel?: string | null;
  notes?: string | null;
}) {
  return postJson<Record<string, unknown>>('/api/parcel-deliveries', body);
}

export function pickupParcelDelivery(
  id: number,
  body: { userId: number; unitId?: number },
) {
  return patchJson<Record<string, unknown>>(`/api/parcel-deliveries/${id}/pickup`, body);
}

/** --- Enquetes / votações (`/api/polls`) — alinhado ao app móvel. */

export type PollKindApi = 'survey' | 'formal_ballot';
export type PollStatusApi = 'draft' | 'open' | 'closed';

export type PollListRow = Record<string, unknown>;

export type PollResultRow = {
  optionId: number;
  label: string;
  sortOrder?: number;
  voteCount: number;
  percent: number;
};

export type PollDetail = Record<string, unknown> & {
  resultsPhase?: 'partial' | 'final';
  totalVotes?: number;
  results?: PollResultRow[];
  myVoteOptionId?: number | null;
  mayVote?: boolean;
  eligibleRoles?: string[];
};

export function listPolls(condoId: number, userId: number, kind?: PollKindApi) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    userId: String(userId),
  });
  if (kind) {
    q.set('kind', kind);
  }
  return getJson<PollListRow[]>(`/api/polls?${q}`);
}

export function getPoll(pollId: number, condoId: number, userId: number) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    userId: String(userId),
  });
  return getJson<PollDetail>(`/api/polls/${pollId}?${q}`);
}

export function createPoll(body: {
  condoId: number;
  userId: number;
  kind?: PollKindApi;
  title: string;
  description?: string | null;
  eligibleRoles: string[];
}) {
  return postJson<PollListRow>('/api/polls', body);
}

export function patchPoll(
  pollId: number,
  body: {
    condoId: number;
    userId: number;
    title?: string;
    description?: string | null;
    status?: PollStatusApi;
    kind?: PollKindApi;
    opensAt?: string | null;
    closesAt?: string | null;
    eligibleRoles?: string[];
  },
) {
  return patchJson<PollListRow>(`/api/polls/${pollId}`, body);
}

export function deletePoll(pollId: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/polls/${pollId}?${q}`);
}

export function addPollOption(pollId: number, body: {
  condoId: number;
  userId: number;
  label: string;
  sortOrder: number;
}) {
  return postJson<Record<string, unknown>>(`/api/polls/${pollId}/options`, body);
}

export function patchPollOption(
  pollId: number,
  optionId: number,
  body: { condoId: number; userId: number; label: string },
) {
  return patchJson<Record<string, unknown>>(
    `/api/polls/${pollId}/options/${optionId}`,
    body,
  );
}

export function deletePollOption(
  pollId: number,
  optionId: number,
  condoId: number,
  userId: number,
) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/polls/${pollId}/options/${optionId}?${q}`);
}

export function votePoll(
  pollId: number,
  body: { condoId: number; userId: number; optionId: number },
) {
  return postJson<{ vote?: Record<string, unknown> }>(
    `/api/polls/${pollId}/vote`,
    body,
  );
}

/** --- Documentos (`/api/documents`) */

export type CondoDocumentRow = Record<string, unknown>;

export function listDocuments(condoId: number, userId: number) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    userId: String(userId),
  });
  return getJson<CondoDocumentRow[]>(`/api/documents?${q}`);
}

export function uploadCondoDocument(params: {
  condoId: number;
  userId: number;
  documentType: string;
  title: string;
  description?: string | null;
  file: File;
  /** Se false, `viewerRoles` deve listar pelo menos um perfil. */
  visibleToAll?: boolean;
  viewerRoles?: string[];
}) {
  const fd = new FormData();
  fd.append('file', params.file, params.file.name);
  fd.append('condoId', String(params.condoId));
  fd.append('userId', String(params.userId));
  fd.append('documentType', params.documentType);
  fd.append('title', params.title);
  if (params.description != null && params.description.trim() !== '') {
    fd.append('description', params.description.trim());
  }
  const all = params.visibleToAll !== false;
  fd.append('visibleToAll', all ? 'true' : 'false');
  if (!all && params.viewerRoles != null && params.viewerRoles.length > 0) {
    fd.append('viewerRoles', JSON.stringify(params.viewerRoles));
  }
  return postFormDataJson<CondoDocumentRow>('/api/documents/upload', fd);
}

export function deleteCondoDocument(id: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/documents/${id}?${q}`);
}

export function updateCondoDocument(params: {
  id: number;
  condoId: number;
  userId: number;
  documentType: string;
  title: string;
  description?: string | null;
  visibleToAll: boolean;
  viewerRoles: string[];
}) {
  const q = new URLSearchParams({
    condoId: String(params.condoId),
    userId: String(params.userId),
  });
  return putJson<CondoDocumentRow>(`/api/documents/${params.id}?${q}`, {
    title: params.title,
    documentType: params.documentType,
    description: params.description ?? null,
    visibleToAll: params.visibleToAll,
    viewerRoles: params.visibleToAll ? [] : params.viewerRoles,
  });
}

/** --- Mercado interno (`/api/marketplace`) */

export type MarketplaceListingRow = Record<string, unknown>;

export function listMarketplaceListings(params: {
  condoId: number;
  listingScope?: 'condominium' | 'residents';
  onlyActive?: boolean;
  category?: string;
}) {
  const q = new URLSearchParams({ condoId: String(params.condoId) });
  if (params.listingScope) {
    q.set('listingScope', params.listingScope);
  }
  if (params.onlyActive === false) {
    q.set('onlyActive', 'false');
  }
  if (params.category) {
    q.set('category', params.category);
  }
  return getJson<MarketplaceListingRow[]>(`/api/marketplace?${q}`);
}

export function getMarketplaceListing(id: number, condoId: number) {
  const q = new URLSearchParams({ condoId: String(condoId) });
  return getJson<MarketplaceListingRow>(`/api/marketplace/${id}?${q}`);
}

export function createMarketplaceListing(body: {
  condoId: number;
  userId: number;
  listingScope: 'condominium' | 'residents';
  title: string;
  description?: string | null;
  category?: string | null;
  priceAmount?: number | null;
  priceNote?: string | null;
  contactHint?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  contactWhatsapp?: string | null;
}) {
  return postJson<MarketplaceListingRow>('/api/marketplace', body);
}

export function patchMarketplaceListing(
  id: number,
  body: {
    condoId: number;
    userId: number;
    title?: string;
    description?: string | null;
    category?: string | null;
    priceAmount?: number | null;
    priceNote?: string | null;
    contactHint?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    contactWhatsapp?: string | null;
    status?: 'active' | 'closed';
  },
) {
  return patchJson<MarketplaceListingRow>(`/api/marketplace/${id}`, body);
}

export function deleteMarketplaceListing(id: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/marketplace/${id}?${q}`);
}

/** Multipart: campo `photo` (JPEG/PNG/GIF/WEBP, até ~6 MB). */
export function uploadMarketplaceListingPhoto(
  listingId: number,
  condoId: number,
  userId: number,
  file: File,
) {
  const fd = new FormData();
  fd.append('photo', file, file.name);
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return postFormDataJson<Record<string, unknown>>(
    `/api/marketplace/listings/${listingId}/upload-photo?${q}`,
    fd,
  );
}

export function deleteMarketplaceListingPhoto(
  listingId: number,
  photoId: number,
  condoId: number,
  userId: number,
) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/marketplace/listings/${listingId}/photos/${photoId}?${q}`);
}

/** --- Agenda / calendário (`/api/agenda`) */

export type AgendaEventRow = Record<string, unknown>;

export type AgendaCalendarResponse = {
  view: 'calendar';
  year: number;
  month: number;
  rangeStart?: string;
  rangeEndExclusive?: string;
  events: AgendaEventRow[];
};

export function getAgendaEventsCalendar(condoId: number, userId: number, year: number, month: number) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    userId: String(userId),
    view: 'calendar',
    year: String(year),
    month: String(month),
  });
  return getJson<AgendaCalendarResponse>(`/api/agenda/events?${q}`);
}

export function createAgendaEvent(body: {
  condoId: number;
  userId: number;
  title: string;
  description?: string | null;
  location?: string | null;
  visibility?: 'public' | 'private';
  eventDate: string;
  eventEnd?: string | null;
}) {
  return postJson<AgendaEventRow>('/api/agenda/events', body);
}

export function patchAgendaEvent(
  id: number,
  body: {
    condoId: number;
    userId: number;
    title?: string;
    description?: string | null;
    location?: string | null;
    visibility?: 'public' | 'private';
    eventDate?: string;
    eventEnd?: string | null;
  },
) {
  return patchJson<AgendaEventRow>(`/api/agenda/events/${id}`, body);
}

export function deleteAgendaEvent(id: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/agenda/events/${id}?${q}`);
}

/** --- Guia de serviços (`/api/service-guide`) */

export type ServiceGuideCatalogRow = Record<string, unknown>;

export type ServiceGuideOverview = {
  totalListed: number;
  unitServices: number;
  condoServices: number;
  categoryCount: number;
  hiddenFromResidents?: number;
};

export function getServiceGuideOverview(condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return getJson<ServiceGuideOverview>(`/api/service-guide/overview?${q}`);
}

export function listServiceGuideCatalog(condoId: number, userId: number, includeInactive?: boolean) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  if (includeInactive) {
    q.set('includeInactive', 'true');
  }
  return getJson<ServiceGuideCatalogRow[]>(`/api/service-guide/catalog?${q}`);
}

export type ServiceGuideRequestRow = Record<string, unknown>;

export function createServiceGuideCatalog(body: {
  condoId?: number;
  condoIds?: number[];
  userId: number;
  title: string;
  description?: string | null;
  category?: string | null;
  providerName?: string | null;
  providerPhone?: string | null;
  providerEmail?: string | null;
  providerWhatsapp?: string | null;
  sortOrder?: number;
  scope: 'unit' | 'condo';
  visible?: boolean;
}) {
  return postJson<ServiceGuideCatalogRow | { catalog: ServiceGuideCatalogRow[] }>(
    '/api/service-guide/catalog',
    body,
  );
}

export function patchServiceGuideCatalog(
  id: number,
  body: {
    condoId: number;
    userId: number;
    title?: string;
    description?: string | null;
    category?: string | null;
    providerName?: string | null;
    providerPhone?: string | null;
    providerEmail?: string | null;
    providerWhatsapp?: string | null;
    sortOrder?: number;
    active?: boolean;
    scope?: 'unit' | 'condo';
    visible?: boolean;
  },
) {
  return patchJson<ServiceGuideCatalogRow>(`/api/service-guide/catalog/${id}`, body);
}

export function deleteServiceGuideCatalog(id: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/service-guide/catalog/${id}?${q}`);
}

export function uploadServiceGuideCatalogPhoto(serviceId: number, condoId: number, userId: number, file: File) {
  const fd = new FormData();
  fd.append('photo', file, file.name);
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return postFormDataJson<Record<string, unknown>>(
    `/api/service-guide/catalog/${serviceId}/upload-photo?${q}`,
    fd,
  );
}

export function deleteServiceGuideCatalogPhoto(
  serviceId: number,
  photoId: number,
  condoId: number,
  userId: number,
) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/service-guide/catalog/${serviceId}/photos/${photoId}?${q}`);
}

export function listServiceGuideRequests(condoId: number, userId: number, status?: string) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  if (status) {
    q.set('status', status);
  }
  return getJson<ServiceGuideRequestRow[]>(`/api/service-guide/requests?${q}`);
}

export function createServiceGuideRequest(body: {
  condoId: number;
  userId: number;
  serviceId: number;
  unitId: number;
  message: string;
  preferredDate?: string | null;
}) {
  return postJson<ServiceGuideRequestRow>('/api/service-guide/requests', body);
}

export function patchServiceGuideRequest(
  id: number,
  body: {
    condoId: number;
    userId: number;
    status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    staffNotes?: string | null;
  },
) {
  return patchJson<ServiceGuideRequestRow>(`/api/service-guide/requests/${id}`, body);
}

/** --- Achados e perdidos (`/api/lost-found`) */

export type LostFoundRow = Record<string, unknown>;

export function uploadLostFoundPhoto(condoId: number, userId: number, file: File) {
  const fd = new FormData();
  fd.append('photo', file, file.name);
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return postFormDataJson<{ photoUrl: string }>(`/api/lost-found/upload-photo?${q}`, fd);
}

export function listLostFound(params: {
  condoId: number;
  userId: number;
  kind?: 'lost' | 'found';
  status?: 'open' | 'resolved';
  onlyOpen?: boolean;
  /** Itens perdidos resolvidos: morador vê só os seus; síndico/admin vê todas as unidades. */
  history?: boolean;
}) {
  const q = new URLSearchParams({
    condoId: String(params.condoId),
    userId: String(params.userId),
  });
  if (params.kind) {
    q.set('kind', params.kind);
  }
  if (params.status) {
    q.set('status', params.status);
  }
  if (params.onlyOpen === false) {
    q.set('onlyOpen', 'false');
  }
  if (params.history === true) {
    q.set('history', 'true');
  }
  return getJson<LostFoundRow[]>(`/api/lost-found?${q}`);
}

export function getLostFoundStats(condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return getJson<{ totalLost: number; openLost: number; resolvedLost: number }>(
    `/api/lost-found/stats?${q}`,
  );
}

export function createLostFoundItem(body: {
  condoId: number;
  userId: number;
  unitId: number;
  kind?: 'lost' | 'found';
  title: string;
  description?: string | null;
  contactHint?: string | null;
  photoUrl?: string | null;
  photoUrls?: string[];
}) {
  return postJson<LostFoundRow>('/api/lost-found', body);
}

export function patchLostFoundItem(
  id: number,
  body: {
    condoId: number;
    userId: number;
    unitId?: number;
    title?: string;
    description?: string | null;
    contactHint?: string | null;
    photoUrl?: string | null;
    photoUrls?: string[];
    kind?: 'lost' | 'found';
    status?: 'open' | 'resolved';
  },
) {
  return patchJson<LostFoundRow>(`/api/lost-found/${id}`, body);
}

export function deleteLostFoundItem(id: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/lost-found/${id}?${q}`);
}

export function postLostFoundAchei(id: number, body: { condoId: number; userId: number; message: string }) {
  return postJson<Record<string, unknown>>(`/api/lost-found/${id}/achei`, body);
}

/** --- Contatos (`/api/contacts`) */

export type ContactRow = Record<string, unknown>;

export function listContacts(params: {
  condoId: number;
  manage?: boolean;
  viewerRole?: string;
  category?: string;
}) {
  const q = new URLSearchParams({ condoId: String(params.condoId) });
  if (params.manage) {
    q.set('manage', 'true');
  }
  if (params.viewerRole?.trim()) {
    q.set('viewerRole', params.viewerRole.trim());
  }
  if (params.category) {
    q.set('category', params.category);
  }
  return getJson<ContactRow[]>(`/api/contacts?${q}`);
}

export function createContact(body: {
  condoId: number;
  category: string;
  name: string;
  phone?: string | null;
  extension?: string | null;
  email?: string | null;
  notes?: string | null;
  sortOrder?: number;
  visibleTo?: string;
}) {
  return postJson<ContactRow>('/api/contacts', body);
}

export function patchContact(
  id: number,
  body: {
    condoId: number;
    category?: string;
    name?: string;
    phone?: string | null;
    extension?: string | null;
    email?: string | null;
    notes?: string | null;
    sortOrder?: number;
    visibleTo?: string;
  },
) {
  return patchJson<ContactRow>(`/api/contacts/${id}`, body);
}

export function deleteContact(id: number, condoId: number) {
  const q = new URLSearchParams({ condoId: String(condoId) });
  return deleteVoid(`/api/contacts/${id}?${q}`);
}

/** --- Quadro de colaboradores (`/api/collaborators`) */

export type CollaboratorRow = Record<string, unknown>;
export type CollaboratorShiftRow = Record<string, unknown>;

export function listCollaborators(condoId: number, userId: number, includeInactive?: boolean) {
  const q = new URLSearchParams({
    condoId: String(condoId),
    userId: String(userId),
  });
  if (includeInactive) {
    q.set('includeInactive', 'true');
  }
  return getJson<CollaboratorRow[]>(`/api/collaborators?${q}`);
}

export function createCollaborator(body: {
  condoId: number;
  userId: number;
  fullName: string;
  jobTitle: string;
  phone?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  notes?: string | null;
  sortOrder?: number;
}) {
  return postJson<CollaboratorRow>('/api/collaborators', body);
}

export function patchCollaborator(
  id: number,
  body: {
    condoId: number;
    userId: number;
    fullName?: string;
    jobTitle?: string;
    phone?: string | null;
    email?: string | null;
    photoUrl?: string | null;
    notes?: string | null;
    sortOrder?: number;
    active?: boolean;
  },
) {
  return patchJson<CollaboratorRow>(`/api/collaborators/${id}`, body);
}

export function deleteCollaborator(id: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/collaborators/${id}?${q}`);
}

export function listCollaboratorSchedule(condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return getJson<CollaboratorShiftRow[]>(`/api/collaborators/schedule?${q}`);
}

export function createCollaboratorShifts(body: {
  condoId: number;
  userId: number;
  collaboratorId: number;
  shiftDate?: string;
  shiftDates?: string[];
  timeStart?: string | null;
  timeEnd?: string | null;
  notes?: string | null;
  sortOrder?: number;
}) {
  return postJson<{ shifts: CollaboratorShiftRow[] }>('/api/collaborators/schedule', body);
}

export function patchCollaboratorShift(
  shiftId: number,
  body: {
    condoId: number;
    userId: number;
    collaboratorId?: number;
    shiftDate?: string;
    timeStart?: string | null;
    timeEnd?: string | null;
    notes?: string | null;
    sortOrder?: number;
  },
) {
  return patchJson<CollaboratorShiftRow>(`/api/collaborators/schedule/${shiftId}`, body);
}

export function deleteCollaboratorShift(shiftId: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/collaborators/schedule/${shiftId}?${q}`);
}

/** --- Passagem de turno (`/api/shift-handovers`) */

export type ShiftHandoverCollaboratorUser = Record<string, unknown>;
export type ShiftHandoverAreaRow = Record<string, unknown>;
export type ShiftHandoverEntryRow = Record<string, unknown>;

export function listShiftHandoverCollaborators(condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return getJson<ShiftHandoverCollaboratorUser[]>(
    `/api/shift-handovers/collaborators?${q}`,
  );
}

export function listShiftHandoverAreas(condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return getJson<ShiftHandoverAreaRow[]>(`/api/shift-handovers/areas?${q}`);
}

export function createShiftHandoverArea(body: {
  condoId: number;
  userId: number;
  name: string;
  serviceName: string;
  instructions?: string | null;
  memberUserIds?: number[];
}) {
  return postJson<ShiftHandoverAreaRow>('/api/shift-handovers/areas', body);
}

export function patchShiftHandoverArea(
  id: number,
  body: {
    condoId: number;
    userId: number;
    name: string;
    serviceName: string;
    instructions?: string | null;
    active?: boolean;
    memberUserIds?: number[];
  },
) {
  return patchJson<ShiftHandoverAreaRow>(`/api/shift-handovers/areas/${id}`, body);
}

export function createShiftHandoverEntry(
  areaId: number,
  body: {
    condoId: number;
    userId: number;
    body: string;
  },
) {
  return postJson<ShiftHandoverEntryRow>(
    `/api/shift-handovers/areas/${areaId}/entries`,
    body,
  );
}

/** --- Animais por unidade (`/api/unit-pets`) */

export type UnitPetRow = Record<string, unknown>;

export function listUnitPets(condoId: number, userId: number, unitId?: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  if (unitId != null) {
    q.set('unitId', String(unitId));
  }
  return getJson<UnitPetRow[]>(`/api/unit-pets?${q}`);
}

export function uploadUnitPetPhoto(condoId: number, userId: number, file: File) {
  const fd = new FormData();
  fd.append('photo', file, file.name);
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return postFormDataJson<{ photoUrl: string }>(`/api/unit-pets/upload-photo?${q}`, fd);
}

export function createUnitPet(body: {
  condoId: number;
  userId: number;
  unitId: number;
  name: string;
  species: string;
  breed?: string | null;
  color?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
}) {
  return postJson<UnitPetRow>('/api/unit-pets', body);
}

export function patchUnitPet(
  id: number,
  body: {
    condoId: number;
    userId: number;
    name?: string;
    species?: string;
    breed?: string | null;
    color?: string | null;
    notes?: string | null;
    photoUrl?: string | null;
  },
) {
  return patchJson<UnitPetRow>(`/api/unit-pets/${id}`, body);
}

export function deleteUnitPet(id: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/unit-pets/${id}?${q}`);
}

/** --- Assembleias virtuais (`/api/virtual-assemblies`) */

export type VirtualAssemblyRow = Record<string, unknown>;

export function listVirtualAssemblies(condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return getJson<VirtualAssemblyRow[]>(`/api/virtual-assemblies?${q}`);
}

export function createVirtualAssembly(body: {
  condoId: number;
  userId: number;
  title: string;
  description?: string | null;
  status?: string;
  videoRoomId?: number | null;
  scheduledStartsAt?: string | null;
  scheduledEndsAt?: string | null;
}) {
  return postJson<VirtualAssemblyRow>('/api/virtual-assemblies', body);
}

export function patchVirtualAssembly(
  id: number,
  body: {
    condoId: number;
    userId: number;
    title?: string;
    description?: string | null;
    status?: string;
    videoRoomId?: number | null;
    scheduledStartsAt?: string | null;
    scheduledEndsAt?: string | null;
  },
) {
  return patchJson<VirtualAssemblyRow>(`/api/virtual-assemblies/${id}`, body);
}

export function deleteVirtualAssembly(id: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/virtual-assemblies/${id}?${q}`);
}

export type AssemblyAttendanceRow = Record<string, unknown>;

export function getVirtualAssemblyAttendance(
  assemblyId: number,
  condoId: number,
  userId: number,
) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return getJson<AssemblyAttendanceRow[]>(
    `/api/virtual-assemblies/${assemblyId}/attendance?${q}`,
  );
}

export function postVirtualAssemblyAttendance(
  assemblyId: number,
  body: { condoId: number; userId: number },
) {
  return postJson<Record<string, unknown>>(`/api/virtual-assemblies/${assemblyId}/attendance`, body);
}

/** --- Salas de videoconferência / Jitsi (`/api/video-rooms`) */

export type VideoRoomRow = Record<string, unknown>;

export function listVideoRooms(condoId: number, userId: number, includeEnded?: boolean) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  if (includeEnded) {
    q.set('includeEnded', 'true');
  }
  return getJson<VideoRoomRow[]>(`/api/video-rooms?${q}`);
}

export function createVideoRoom(body: {
  condoId: number;
  userId: number;
  title: string;
  description?: string | null;
  status?: string;
  jitsiBaseUrl?: string | null;
  scheduledStartsAt?: string | null;
  scheduledEndsAt?: string | null;
}) {
  return postJson<VideoRoomRow>('/api/video-rooms', body);
}

export function patchVideoRoom(
  id: number,
  body: {
    condoId: number;
    userId: number;
    title?: string;
    description?: string | null;
    status?: string;
    jitsiBaseUrl?: string | null;
    scheduledStartsAt?: string | null;
    scheduledEndsAt?: string | null;
  },
) {
  return patchJson<VideoRoomRow>(`/api/video-rooms/${id}`, body);
}

export function deleteVideoRoom(id: number, condoId: number, userId: number) {
  const q = new URLSearchParams({ condoId: String(condoId), userId: String(userId) });
  return deleteVoid(`/api/video-rooms/${id}?${q}`);
}

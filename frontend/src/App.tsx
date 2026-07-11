import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppHomePage } from './AppHomePage';
import { AppSessionLayout } from './AppSessionLayout';
import { LandingPage } from './LandingPage';
import { FolhetoPage } from './FolhetoPage';
import { SelectCondoPage } from './SelectCondoPage';
import { ActivateAccountPage } from './ActivateAccountPage';
import { LoginPage } from './LoginPage';
import { AccessControlPage } from './portal/AccessControlPage';
import { ContactCondoHubPage } from './portal/ContactCondoHubPage';
import { PartnerRelationChatPage } from './portal/PartnerRelationChatPage';
import { DocumentsPage } from './portal/DocumentsPage';
import { EmergencyPage } from './portal/EmergencyPage';
import { EventsCalendarPage } from './portal/EventsCalendarPage';
import { IndividualCommsPage } from './portal/IndividualCommsPage';
import { InternalMarketPage } from './portal/InternalMarketPage';
import { LostFoundPage } from './portal/LostFoundPage';
import { ComplaintsBookPage } from './portal/ComplaintsBookPage';
import { MyUnitPage } from './portal/MyUnitPage';
import { MaintenanceRequestsPage } from './portal/MaintenanceRequestsPage';
import { NoticesMuralPage } from './portal/NoticesMuralPage';
import { PollDetailPage } from './portal/PollDetailPage';
import { PollsHubPage } from './portal/PollsHubPage';
import { OffersPage } from './portal/OffersPage';
import { ParcelDeliveriesPage } from './portal/ParcelDeliveriesPage';
import { ReservationSpacesPage } from './portal/ReservationSpacesPage';
import { ServiceGuidePage } from './portal/ServiceGuidePage';
import { ShiftHandoverPage } from './portal/ShiftHandoverPage';
import { RelationInboxPage } from './portal/RelationInboxPage';
import { RelationThreadPage } from './portal/RelationThreadPage';
import { ResidentRelationChatPage } from './portal/ResidentRelationChatPage';
import { BillingCampaignDetailPage } from './portal/BillingCampaignDetailPage';
import { BillingHubPage } from './portal/BillingHubPage';
import { CollaboratorsBoardPage } from './portal/CollaboratorsBoardPage';
import { ContactsPage } from './portal/ContactsPage';
import { CondoRegistryPage } from './portal/CondoRegistryPage';
import { PetsRegistryPage } from './portal/PetsRegistryPage';
import { VideoConferencePage } from './portal/VideoConferencePage';
import { VirtualAssembliesPage } from './portal/VirtualAssembliesPage';
import { AdministrationRelationsInboxPage } from './staff/admin/AdministrationRelationsInboxPage';
import { AdministratorAreaPage } from './staff/admin/AdministratorAreaPage';
import { AdministratorUnitResidentsPage } from './staff/admin/AdministratorUnitResidentsPage';
import { AdministratorUnitsPage } from './staff/admin/AdministratorUnitsPage';
import {
  RequireAdministrationHub,
  RequireBillingAccess,
  RequireBillingStaff,
  RequireNotPartner,
  RequireSyndic,
} from './staff/StaffGuards';
import { SyndicAreaPage } from './staff/sindico/SyndicAreaPage';
import { SyndicMaintenancePage } from './staff/sindico/SyndicMaintenancePage';
import { SyndicNoticesPage } from './staff/sindico/SyndicNoticesPage';
import { SyndicOccurrencesPage } from './staff/sindico/SyndicOccurrencesPage';
import {
  SyndicReportAreaUsagePage,
  SyndicReportFinancialPage,
  SyndicReportOperationsPage,
} from './staff/sindico/SyndicReportPages';
import { SyndicRelationsInboxPage } from './staff/sindico/SyndicRelationsInboxPage';
import { StaffRelationThreadPage } from './staff/StaffRelationThreadPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/folheto/*" element={<FolhetoPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/ativar" element={<ActivateAccountPage />} />
      <Route path="/select-condo" element={<SelectCondoPage />} />
      <Route path="/app" element={<AppSessionLayout />}>
        <Route index element={<AppHomePage />} />
        <Route path="cadastro-condominios" element={<CondoRegistryPage />} />
        <Route
          path="sindico"
          element={
            <RequireSyndic>
              <Outlet />
            </RequireSyndic>
          }
        >
          <Route index element={<SyndicAreaPage />} />
          <Route path="ocorrencias" element={<SyndicOccurrencesPage />} />
          <Route path="manutencoes" element={<SyndicMaintenancePage />} />
          <Route path="avisos" element={<SyndicNoticesPage />} />
          <Route path="chats" element={<SyndicRelationsInboxPage />} />
          <Route
            path="chats/thread/:threadId"
            element={
              <StaffRelationThreadPage
                backTo="/app/sindico/chats"
                layoutTitle="Chats · Síndico"
              />
            }
          />
          <Route path="relatorio-financeiro" element={<SyndicReportFinancialPage />} />
          <Route path="relatorio-areas" element={<SyndicReportAreaUsagePage />} />
          <Route path="relatorio-operacao" element={<SyndicReportOperationsPage />} />
        </Route>
        <Route
          path="administracao"
          element={
            <RequireAdministrationHub>
              <Outlet />
            </RequireAdministrationHub>
          }
        >
          <Route index element={<AdministratorAreaPage />} />
          <Route path="unidades" element={<AdministratorUnitsPage />} />
          <Route
            path="unidades/:unitId/moradores"
            element={<AdministratorUnitResidentsPage />}
          />
          <Route path="chats" element={<AdministrationRelationsInboxPage />} />
          <Route
            path="chats/thread/:threadId"
            element={
              <StaffRelationThreadPage
                backTo="/app/administracao/chats"
                layoutTitle="Chats · Administração"
              />
            }
          />
        </Route>
        <Route
          path="controle-acesso"
          element={
            <RequireNotPartner>
              <AccessControlPage />
            </RequireNotPartner>
          }
        />
        <Route
          path="boleto-online"
          element={
            <RequireBillingAccess>
              <Outlet />
            </RequireBillingAccess>
          }
        >
          <Route index element={<BillingHubPage />} />
          <Route
            path="campanha/:campaignId"
            element={
              <RequireBillingStaff>
                <BillingCampaignDetailPage />
              </RequireBillingStaff>
            }
          />
        </Route>
        <Route path="emergencia" element={<EmergencyPage />} />
        <Route path="encomendas" element={<ParcelDeliveriesPage />} />
        <Route path="comunicados-individuais" element={<IndividualCommsPage />} />
        <Route path="minha-unidade" element={<MyUnitPage />} />
        <Route path="manutencoes" element={<MaintenanceRequestsPage />} />
        <Route path="mural-avisos" element={<NoticesMuralPage />} />
        <Route path="ofertas" element={<OffersPage />} />
        <Route path="reservas" element={<ReservationSpacesPage />} />
        <Route path="fale-condominio" element={<ContactCondoHubPage />} />
        <Route path="fale-condominio/parceiro/chat/:channel" element={<PartnerRelationChatPage />} />
        <Route path="fale-condominio/inbox/:channel" element={<RelationInboxPage />} />
        <Route path="fale-condominio/thread/:threadId" element={<RelationThreadPage />} />
        <Route path="fale-condominio/chat/:channel" element={<ResidentRelationChatPage />} />
        <Route path="enquetes" element={<PollsHubPage />} />
        <Route path="enquetes/:pollId" element={<PollDetailPage />} />
        <Route path="documentos" element={<DocumentsPage />} />
        <Route path="mercado-interno" element={<InternalMarketPage />} />
        <Route path="calendario-eventos" element={<EventsCalendarPage />} />
        <Route path="guia-servicos" element={<ServiceGuidePage />} />
        <Route
          path="passagem-turno"
          element={
            <RequireAdministrationHub>
              <ShiftHandoverPage />
            </RequireAdministrationHub>
          }
        />
        <Route path="achados-perdidos" element={<LostFoundPage />} />
        <Route path="livro-reclamacoes" element={<ComplaintsBookPage />} />
        <Route path="contatos" element={<ContactsPage />} />
        <Route path="quadro-colaboradores" element={<CollaboratorsBoardPage />} />
        <Route path="animais-estimacao" element={<PetsRegistryPage />} />
        <Route path="assembleias-virtuais" element={<VirtualAssembliesPage />} />
        <Route path="videoconferencia" element={<VideoConferencePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

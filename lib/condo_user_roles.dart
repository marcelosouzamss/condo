/// Perfis retornados pelo login (`app_users.role` na API).
abstract final class CondoUserRoles {
  static const syndic = 'syndic';
  static const administrator = 'administrator';
  static const resident = 'resident';
  static const partner = 'partner';
  static const collaborator = 'collaborator';

  static String labelPt(String role) {
    switch (role) {
      case syndic:
        return 'Síndico';
      case administrator:
        return 'Administração';
      case resident:
        return 'Morador';
      case partner:
        return 'Parceiros';
      case collaborator:
        return 'Colaboradores';
      default:
        return role;
    }
  }

  static bool isBillingStaff(String role) =>
      role == syndic || role == administrator;

  /// Calendário da equipe, cadastro de espaços e aprovação de reservas (síndico e administração).
  static bool canManageReservationSpaces(String role) => isBillingStaff(role);

  /// Área de documentos: envio e exclusão (síndico e administração).
  static bool canManageDocuments(String role) => isBillingStaff(role);

  static bool isOperationalStaff(String role) =>
      role == syndic || role == administrator || role == collaborator;

  /// Role enviada em `/api/individual-comms/staff-sent` e ao redigir como equipe.
  static String? staffMessagingApiRole(String role) =>
      isOperationalStaff(role) ? role : null;

  static bool canOpenAdministrationHub(String role) => isOperationalStaff(role);

  /// Cadastro do quadro e da escala (síndico e administração).
  static bool canManageCollaboratorsBoard(String role) =>
      role == syndic || role == administrator;

  /// Aba «Escala»: síndico, administração e colaboradores (moradores só veem a lista).
  static bool canViewCollaboratorScheduleTab(String role) =>
      role == syndic || role == administrator || role == collaborator;

  /// Cadastro na guia de serviços (síndico, administração e parceiros).
  static bool canManageServiceGuideCatalog(String role) =>
      role == syndic || role == administrator || role == partner;

  /// Mercado interno — aba «do condomínio»: síndico, administração e parceiros.
  static bool canPostMarketplaceCondominium(String role) =>
      role == syndic || role == administrator || role == partner;

  /// Mercado interno — aba «dos moradores»: moradores e síndico.
  static bool canPostMarketplaceResidents(String role) =>
      role == resident || role == syndic;
}

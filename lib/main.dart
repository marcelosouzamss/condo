import 'package:flutter/material.dart';
import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/additional_pages.dart';
import 'package:condo_app/polls_pages.dart';
import 'package:condo_app/contacts_pages.dart';
import 'package:condo_app/documents_pages.dart';
import 'package:condo_app/individual_comms_pages.dart';
import 'package:condo_app/lost_found_page.dart';
import 'package:condo_app/offers_page.dart';
import 'package:condo_app/login_page.dart';
import 'package:condo_app/maintenance_pages.dart';
import 'package:condo_app/my_unit_page.dart';
import 'package:condo_app/pets_registry_page.dart';
import 'package:condo_app/employees_board_page.dart';
import 'package:condo_app/relation_center_pages.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:condo_app/syndic_reports_pages.dart';
import 'package:condo_app/billing_pages.dart';
import 'package:condo_app/video_conference_page.dart';
import 'package:condo_app/virtual_assemblies_page.dart';
import 'package:condo_app/emergency_page.dart';
import 'package:condo_app/parcel_deliveries_page.dart';
import 'package:condo_app/access_control_page.dart';
import 'package:condo_app/administration_area_page.dart';
import 'package:condo_app/login_branding_settings_page.dart';

void main() {
  runApp(const CondoApp());
}

class CondoApp extends StatefulWidget {
  const CondoApp({super.key});

  @override
  State<CondoApp> createState() => _CondoAppState();
}

class _CondoAppState extends State<CondoApp> {
  AppStylePreset _selectedStyle = AppStylePreset.diurno;
  LoginResult? _session;

  void _updateStyle(AppStylePreset style) {
    setState(() {
      _selectedStyle = style;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = _buildTheme(_selectedStyle);

    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Condo App',
      theme: theme,
      home: _session == null
          ? LoginPage(
              onLoggedIn: (session) {
                setState(() {
                  _session = session;
                });
              },
            )
          : HomePage(
              selectedStyle: _selectedStyle,
              onStyleChanged: _updateStyle,
              userName: _session!.fullName,
              userRole: _session!.role,
              userId: _session!.id,
              condoId: _session!.condoId,
              unitId: _session!.unitId,
              onLogout: () {
                setState(() {
                  _session = null;
                });
              },
            ),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({
    super.key,
    required this.selectedStyle,
    required this.onStyleChanged,
    required this.userName,
    required this.userRole,
    required this.userId,
    required this.condoId,
    required this.unitId,
    required this.onLogout,
  });

  final AppStylePreset selectedStyle;
  final ValueChanged<AppStylePreset> onStyleChanged;
  final String userName;
  final String userRole;
  final int userId;
  final int condoId;
  final int? unitId;
  final VoidCallback onLogout;

  static bool _featureVisible(String label, String userRole, int? unitId) {
    switch (label) {
      case 'Área do Síndico':
        return userRole == CondoUserRoles.syndic;
      case 'Administração':
        return CondoUserRoles.canOpenAdministrationHub(userRole);
      case 'Minha Unidade':
        return unitId != null;
      case 'Boleto Online':
        return unitId != null || CondoUserRoles.isBillingStaff(userRole);
      case 'Controle de Acesso':
        return userRole != CondoUserRoles.partner;
      case 'Achados e Perdidos':
        return userRole != CondoUserRoles.partner;
      case 'Emergência':
        return userRole != CondoUserRoles.partner;
      case 'Encomendas':
        return unitId != null || CondoUserRoles.isBillingStaff(userRole);
      default:
        return true;
    }
  }

  static List<_FeatureItem> _featuresForUser(String userRole, int? unitId) {
    return _features
        .where((f) => _featureVisible(f.label, userRole, unitId))
        .toList();
  }

  static const List<_FeatureItem> _features = [
    _FeatureItem('Área do Síndico', Icons.account_balance),
    _FeatureItem('Administração', Icons.business),
    _FeatureItem('Minha Unidade', Icons.apartment),
    _FeatureItem('Controle de Acesso', Icons.badge),
    _FeatureItem('Boleto Online', Icons.receipt_long),
    _FeatureItem('Ofertas', Icons.local_offer),
    _FeatureItem('Fale com o Condomínio', Icons.forum),
    _FeatureItem('Reservas de Espaço', Icons.event_available),
    _FeatureItem('Mural de Avisos', Icons.campaign),
    _FeatureItem('Comunicados Individuais', Icons.mark_email_unread),
    _FeatureItem('Solicitar Manutenção', Icons.build),
    _FeatureItem('Emergência', Icons.emergency_rounded),
    _FeatureItem('Encomendas', Icons.inventory_2_rounded),
    _FeatureItem('Assembleias Virtuais', Icons.groups),
    _FeatureItem('Videoconferência', Icons.videocam),
    _FeatureItem('Enquetes e Votações', Icons.how_to_vote),
    _FeatureItem('Documentos', Icons.folder_open),
    _FeatureItem('Mercado Interno', Icons.storefront),
    _FeatureItem('Calendário de Eventos', Icons.calendar_month),
    _FeatureItem('Guia de Serviços', Icons.room_service),
    _FeatureItem('Achados e Perdidos', Icons.search),
    _FeatureItem('Contatos', Icons.contacts),
    _FeatureItem('Quadro de Colaboradores', Icons.groups_2),
    _FeatureItem('Animais de Estimação com foto', Icons.pets),
  ];

  static const List<_QuickAccessItem> _quickAccess = [
    _QuickAccessItem('Início', Icons.home_rounded),
    _QuickAccessItem('Boletos', Icons.payments_rounded),
    _QuickAccessItem('Avisos', Icons.notifications_rounded),
    _QuickAccessItem('Perfil', Icons.person_rounded),
  ];

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int _navIndex = 0;

  bool get _canOpenBoletos =>
      widget.unitId != null || CondoUserRoles.isBillingStaff(widget.userRole);

  PreferredSizeWidget? _appBarForTab(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    if (_navIndex == 0) {
      return AppBar(
        elevation: 0,
        centerTitle: true,
        backgroundColor: cs.primary,
        foregroundColor: Colors.white,
        title: const Text(
          'Condomínio',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
        actions: [
          IconButton(
            onPressed: () {},
            icon: const Icon(Icons.notifications_none_rounded),
          ),
        ],
      );
    }
    if (_navIndex == 3) {
      return AppBar(
        elevation: 0,
        centerTitle: true,
        backgroundColor: cs.primary,
        foregroundColor: Colors.white,
        title: const Text(
          'Perfil',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
      );
    }
    return null;
  }

  Widget _buildInicioTab(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = Theme.of(context).colorScheme;
    final homeFeatures =
        HomePage._featuresForUser(widget.userRole, widget.unitId);

    return SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: colorScheme.primary,
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [
                    BoxShadow(
                      color: colorScheme.primary.withValues(alpha: 0.20),
                      blurRadius: 18,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Bem-vindo, ${widget.userName}!',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    SizedBox(height: 8),
                    Text(
                      'Perfil atual: ${CondoUserRoles.labelPt(widget.userRole)}',
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.18),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        'Estilo ativo: ${widget.selectedStyle.label}',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Funcionalidades',
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: colorScheme.onSurface,
                ),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: GridView.builder(
                  itemCount: homeFeatures.length,
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 4,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    childAspectRatio: 0.88,
                  ),
                  itemBuilder: (context, index) {
                    final feature = homeFeatures[index];
                    return _FeatureCard(
                      item: feature,
                      displayLabel: feature.label == 'Solicitar Manutenção' &&
                              CondoUserRoles.isOperationalStaff(widget.userRole)
                          ? 'Manutenções solicitadas'
                          : null,
                      onTap: () {
                        if (feature.label == 'Área do Síndico') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => SyndicAreaPage(
                                userId: widget.userId,
                                condoId: widget.condoId,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Administração') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => AdministratorAreaPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Minha Unidade') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => const MyUnitCrudPage(),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Controle de Acesso') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => AccessControlHubPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                                unitId: widget.unitId,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Boleto Online') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => OnlineBillingHubPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                                unitId: widget.unitId,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Ofertas') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => OffersPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                                userName: widget.userName,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Fale com o Condomínio') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => const ContactCondoPage(),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Reservas de Espaço') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) {
                                if (CondoUserRoles.canManageReservationSpaces(
                                    widget.userRole)) {
                                  return SyndicReservationSpacesListPage(
                                    condoId: widget.condoId,
                                  );
                                }
                                return SpaceReservationsPage(
                                  condoId: widget.condoId,
                                  requesterName: widget.userName,
                                );
                              },
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Mural de Avisos') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => NoticeBoardPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Comunicados Individuais') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) =>
                                  IndividualCommunicationsHubPage(
                                userRole: widget.userRole,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Solicitar Manutenção') {
                          if (CondoUserRoles.isOperationalStaff(widget.userRole)) {
                            Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (context) =>
                                    SyndicMaintenanceByUnitPage(
                                  condoId: widget.condoId,
                                  staffUserId: widget.userId,
                                ),
                              ),
                            );
                          } else {
                            Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (context) => ResidentMaintenancePage(
                                  condoId: widget.condoId,
                                  userId: widget.userId,
                                ),
                              ),
                            );
                          }
                          return;
                        }

                        if (feature.label == 'Emergência') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => EmergencyPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                                sessionUnitId: widget.unitId,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Encomendas') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => ParcelDeliveriesPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                                sessionUnitId: widget.unitId,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Assembleias Virtuais') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => VirtualAssembliesPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                                displayName: widget.userName,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Videoconferência') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => VideoConferencePage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                                displayName: widget.userName,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Enquetes e Votações') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => PollsHubPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Documentos') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => DocumentsHubPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Mercado Interno') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => InternalMarketPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Calendário de Eventos') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => EventsCalendarPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Guia de Serviços') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => ServiceGuidePage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Achados e Perdidos') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => LostFoundPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                                unitId: widget.unitId,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Contatos') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => ContactsHubPage(
                                userRole: widget.userRole,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Quadro de Colaboradores') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => EmployeesBoardPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                              ),
                            ),
                          );
                          return;
                        }

                        if (feature.label == 'Animais de Estimação com foto') {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => PetsRegistryPage(
                                condoId: widget.condoId,
                                userId: widget.userId,
                                userRole: widget.userRole,
                                unitId: widget.unitId,
                              ),
                            ),
                          );
                          return;
                        }

                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content:
                                Text('${feature.label} em desenvolvimento'),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
    );
  }

  Widget _buildBoletosTab(BuildContext context) {
    if (!_canOpenBoletos) {
      return SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              'Boletos ficam disponíveis quando sua conta está vinculada a uma unidade. '
              'Peça à administração para associar seu login ou use um perfil com acesso à cobrança.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
          ),
        ),
      );
    }
    return OnlineBillingHubPage(
      condoId: widget.condoId,
      userId: widget.userId,
      userRole: widget.userRole,
      unitId: widget.unitId,
    );
  }

  Widget _buildAvisosTab() {
    return NoticeBoardPage(
      condoId: widget.condoId,
      userId: widget.userId,
      userRole: widget.userRole,
    );
  }

  Widget _buildPerfilTab(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.userName,
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    CondoUserRoles.labelPt(widget.userRole),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: cs.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Estilo ativo: ${widget.selectedStyle.label}',
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          ListTile(
            leading: const Icon(Icons.settings_rounded),
            title: const Text('Configurações'),
            subtitle: const Text('Estilo do app e tela de login'),
            onTap: () async {
              await Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (context) => StyleSettingsPage(
                    selectedStyle: widget.selectedStyle,
                    onStyleChanged: widget.onStyleChanged,
                    condoId: widget.condoId,
                    userId: widget.userId,
                    userRole: widget.userRole,
                  ),
                ),
              );
            },
          ),
          ListTile(
            leading: Icon(Icons.logout_rounded, color: cs.error),
            title: Text('Sair', style: TextStyle(color: cs.error)),
            onTap: widget.onLogout,
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final isDark = theme.brightness == Brightness.dark;

    return Scaffold(
      appBar: _appBarForTab(context),
      body: IndexedStack(
        index: _navIndex,
        children: [
          _buildInicioTab(context),
          _buildBoletosTab(context),
          _buildAvisosTab(),
          _buildPerfilTab(context),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          height: 82,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          decoration: BoxDecoration(
            color: colorScheme.surface,
            boxShadow: [
              BoxShadow(
                color: isDark
                    ? Colors.black.withValues(alpha: 0.28)
                    : const Color(0x14000000),
                blurRadius: 10,
                offset: const Offset(0, -2),
              ),
            ],
          ),
          child: Row(
            children: List.generate(HomePage._quickAccess.length, (i) {
              final item = HomePage._quickAccess[i];
              final selected = _navIndex == i;
              final iconColor = selected
                  ? colorScheme.primary
                  : colorScheme.onSurface.withValues(alpha: 0.55);
              final textColor = selected
                  ? colorScheme.primary
                  : colorScheme.onSurface;
              return Expanded(
                child: InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: () => setState(() => _navIndex = i),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(item.icon, color: iconColor),
                      const SizedBox(height: 4),
                      Text(
                        item.label,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: textColor,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }
}

class _FeatureCard extends StatelessWidget {
  const _FeatureCard({
    required this.item,
    this.displayLabel,
    required this.onTap,
  });

  final _FeatureItem item;
  final String? displayLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = Theme.of(context).colorScheme;

    return Material(
      color: colorScheme.surface,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: colorScheme.outlineVariant),
            boxShadow: [
              BoxShadow(
                color: theme.brightness == Brightness.dark
                    ? Colors.black.withValues(alpha: 0.25)
                    : const Color(0x11000000),
                blurRadius: 8,
                offset: Offset(0, 3),
              ),
            ],
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: colorScheme.primary.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  item.icon,
                  color: colorScheme.primary,
                  size: 22,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                displayLabel ?? item.label,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 11,
                  height: 1.2,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FeatureItem {
  const _FeatureItem(this.label, this.icon);

  final String label;
  final IconData icon;
}

class _QuickAccessItem {
  const _QuickAccessItem(this.label, this.icon);

  final String label;
  final IconData icon;
}

class MyUnitPage extends StatefulWidget {
  const MyUnitPage({super.key});

  @override
  State<MyUnitPage> createState() => _MyUnitPageState();
}

class _MyUnitPageState extends State<MyUnitPage> {
  final TextEditingController _nameController = TextEditingController(
    text: 'Mariana Costa',
  );
  final TextEditingController _phoneController = TextEditingController(
    text: '(11) 99999-0000',
  );
  final TextEditingController _emailController = TextEditingController(
    text: 'mariana@condo.local',
  );

  static const List<_ActionSummary> _residents = [
    _ActionSummary(
      title: 'Mariana Costa',
      subtitle: 'Proprietaria • Telefone e e-mail atualizados',
      icon: Icons.person_rounded,
    ),
    _ActionSummary(
      title: 'Lucas Costa',
      subtitle: 'Morador vinculado • Acesso ativo',
      icon: Icons.person_outline_rounded,
    ),
  ];

  static const List<_ActionSummary> _vehicles = [
    _ActionSummary(
      title: 'Toyota Corolla',
      subtitle: 'Placa BRA2E19 • Vaga 27',
      icon: Icons.directions_car_rounded,
    ),
    _ActionSummary(
      title: 'Honda Biz',
      subtitle: 'Placa MOTO302 • Vaga moto M-04',
      icon: Icons.two_wheeler_rounded,
    ),
  ];

  static const List<_ActionSummary> _pets = [
    _ActionSummary(
      title: 'Thor',
      subtitle: 'Golden Retriever • Cadastro com foto aprovado',
      icon: Icons.pets_rounded,
    ),
  ];

  static const List<_ActionSummary> _paidBills = [
    _ActionSummary(
      title: 'Boleto de abril/2026',
      subtitle: 'Pago em 05/04/2026 • R\$ 780,00',
      icon: Icons.check_circle_rounded,
    ),
    _ActionSummary(
      title: 'Boleto de marco/2026',
      subtitle: 'Pago em 04/03/2026 • R\$ 780,00',
      icon: Icons.check_circle_rounded,
    ),
  ];

  static const List<_ActionSummary> _requests = [
    _ActionSummary(
      title: 'Manutencao na torneira',
      subtitle: 'Concluida • Aberta em 18/04/2026',
      icon: Icons.plumbing_rounded,
    ),
    _ActionSummary(
      title: 'Liberacao de visitante',
      subtitle: 'Finalizada • Solicitada em 20/04/2026',
      icon: Icons.how_to_reg_rounded,
    ),
  ];

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  void _savePersonalData() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Dados pessoais atualizados com sucesso.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Minha Unidade'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: colorScheme.primary,
              borderRadius: BorderRadius.circular(24),
              boxShadow: [
                BoxShadow(
                  color: colorScheme.primary.withValues(alpha: 0.22),
                  blurRadius: 20,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Dados da unidade',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    color: colorScheme.onPrimary,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Torre B • Unidade 202 • 2 vagas • Status adimplente',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onPrimary.withValues(alpha: 0.90),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          const _SectionTitle(
            title: 'Dados da unidade',
            subtitle: 'Informacoes principais vinculadas ao apartamento',
          ),
          const SizedBox(height: 12),
          const _InfoHighlightCard(
            title: 'Resumo da unidade',
            lines: [
              'Condominio: Residencial Jardim Central',
              'Bloco/Torre: B',
              'Unidade: 202',
              'Area comum vinculada: Vagas 27 e M-04',
            ],
            icon: Icons.home_work_rounded,
          ),
          const SizedBox(height: 20),
          const _SectionTitle(
            title: 'Moradores vinculados',
            subtitle: 'Pessoas autorizadas e associadas a unidade',
          ),
          const SizedBox(height: 12),
          ..._residents.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _ActionCard(item: item, actionLabel: 'Ver detalhes'),
            ),
          ),
          const SizedBox(height: 8),
          const _SectionTitle(
            title: 'Veículos',
            subtitle: 'Cadastros de carros e motos associados a unidade',
          ),
          const SizedBox(height: 12),
          ..._vehicles.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _ActionCard(item: item, actionLabel: 'Consultar'),
            ),
          ),
          const SizedBox(height: 8),
          const _SectionTitle(
            title: 'Pets',
            subtitle: 'Animais cadastrados e autorizados no condominio',
          ),
          const SizedBox(height: 12),
          ..._pets.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _ActionCard(item: item, actionLabel: 'Ver cadastro'),
            ),
          ),
          const SizedBox(height: 8),
          const _SectionTitle(
            title: 'Histórico',
            subtitle: 'Acompanhe movimentacoes e registros da unidade',
          ),
          const SizedBox(height: 12),
          const _SubsectionLabel('Boletos pagos'),
          const SizedBox(height: 8),
          ..._paidBills.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _ActionCard(item: item, actionLabel: 'Baixar recibo'),
            ),
          ),
          const SizedBox(height: 4),
          const _SubsectionLabel('Solicitações feitas'),
          const SizedBox(height: 8),
          ..._requests.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _ActionCard(item: item, actionLabel: 'Acompanhar'),
            ),
          ),
          const SizedBox(height: 8),
          const _SectionTitle(
            title: 'Atualização de dados pessoais',
            subtitle: 'Mantenha seus contatos sempre corretos',
          ),
          const SizedBox(height: 12),
          _PersonalDataCard(
            nameController: _nameController,
            phoneController: _phoneController,
            emailController: _emailController,
            onSave: _savePersonalData,
          ),
        ],
      ),
    );
  }
}

class _InfoHighlightCard extends StatelessWidget {
  const _InfoHighlightCard({
    required this.title,
    required this.lines,
    required this.icon,
  });

  final String title;
  final List<String> lines;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: colorScheme.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, color: colorScheme.primary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                ...lines.map(
                  (line) => Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      line,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SubsectionLabel extends StatelessWidget {
  const _SubsectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label,
      style: Theme.of(
        context,
      ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
    );
  }
}

class _PersonalDataCard extends StatelessWidget {
  const _PersonalDataCard({
    required this.nameController,
    required this.phoneController,
    required this.emailController,
    required this.onSave,
  });

  final TextEditingController nameController;
  final TextEditingController phoneController;
  final TextEditingController emailController;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: Column(
        children: [
          TextField(
            controller: nameController,
            decoration: const InputDecoration(
              labelText: 'Nome completo',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: phoneController,
            decoration: const InputDecoration(
              labelText: 'Telefone',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: emailController,
            decoration: const InputDecoration(
              labelText: 'E-mail',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: onSave,
              icon: const Icon(Icons.save_rounded),
              label: const Text('Salvar dados pessoais'),
            ),
          ),
        ],
      ),
    );
  }
}

class SyndicAreaPage extends StatefulWidget {
  const SyndicAreaPage({
    super.key,
    required this.userId,
    required this.condoId,
  });

  final int userId;
  final int condoId;

  @override
  State<SyndicAreaPage> createState() => _SyndicAreaPageState();
}

class _SyndicAreaPageState extends State<SyndicAreaPage> {
  final TextEditingController _subjectController = TextEditingController(
    text: 'Comunicado geral',
  );
  final TextEditingController _messageController = TextEditingController(
    text:
        'Prezados moradores, informamos que havera vistoria preventiva nas areas comuns amanha as 9h.',
  );

  String _selectedAudience = 'Todos os moradores';

  String _occCount = '12';
  String _maintCount = '08';
  String _commCount = '05';

  static const IconData _iconOcc = Icons.warning_amber_rounded;
  static const IconData _iconMaint = Icons.build_circle_rounded;
  static const IconData _iconComm = Icons.mark_email_read_rounded;

  static const List<_ActionSummary> _notices = [
    _ActionSummary(
      title: 'Novo aviso no mural',
      subtitle: 'Publicar comunicado com texto, datas e anexos',
      icon: Icons.post_add_rounded,
    ),
    _ActionSummary(
      title: 'Publicar aviso urgente',
      subtitle: 'Crie avisos para manutencoes, faltas de agua ou alertas',
      icon: Icons.campaign_rounded,
    ),
    _ActionSummary(
      title: 'Gerir mural',
      subtitle: 'Editar, fixar, arquivar, excluir e gerir anexos',
      icon: Icons.edit_notifications_rounded,
    ),
  ];

  static const List<_ActionSummary> _reports = [
    _ActionSummary(
      title: 'Financeiro basico',
      subtitle: 'Receitas, despesas e visao resumida do caixa',
      icon: Icons.pie_chart_rounded,
    ),
    _ActionSummary(
      title: 'Uso de areas',
      subtitle: 'Ocupacao de espacos e horarios mais utilizados',
      icon: Icons.meeting_room_rounded,
    ),
    _ActionSummary(
      title: 'Ocorrencias e manutencao',
      subtitle: 'Volume por tipo, status e tempo medio de resolucao',
      icon: Icons.analytics_rounded,
    ),
  ];

  static const List<String> _audiences = [
    'Todos os moradores',
    'Somente proprietarios',
    'Moradores da Torre A',
    'Visitantes liberados hoje',
  ];

  @override
  void initState() {
    super.initState();
    _refreshDashboardCounts();
  }

  Future<void> _refreshDashboardCounts() async {
    final dash = await SyndicApi.dashboard(widget.condoId);
    if (!mounted || dash == null) {
      return;
    }
    final m = dash['metrics'] as Map<String, dynamic>?;
    if (m == null) {
      return;
    }
    setState(() {
      _occCount = '${m['openOccurrences']}';
      _maintCount = '${m['maintenanceRequestsOpen']}';
      _commCount = '${m['recentCommunications']}';
    });
  }

  @override
  void dispose() {
    _subjectController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  void _sendMassCommunication() {
    final subject = _subjectController.text.trim();
    final message = _messageController.text.trim();

    if (subject.isEmpty || message.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Preencha assunto e mensagem antes de enviar.'),
        ),
      );
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Comunicado enviado para $_selectedAudience.'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    final syndicMetrics = <_DashboardMetric>[
      _DashboardMetric(
        label: 'Ocorrências abertas',
        value: _occCount,
        icon: _iconOcc,
      ),
      _DashboardMetric(
        label: 'Solicitações de manutenção',
        value: _maintCount,
        icon: _iconMaint,
      ),
      _DashboardMetric(
        label: 'Comunicados recentes',
        value: _commCount,
        icon: _iconComm,
      ),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Área do Síndico'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: colorScheme.primary,
              borderRadius: BorderRadius.circular(24),
              boxShadow: [
                BoxShadow(
                  color: colorScheme.primary.withValues(alpha: 0.22),
                  blurRadius: 20,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Painel de gestao do sindico',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    color: colorScheme.onPrimary,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Acompanhe o que precisa de atencao imediata e aprove fluxos do condominio em um unico lugar.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onPrimary.withValues(alpha: 0.90),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          _SectionTitle(
            title: 'Dashboard',
            subtitle: 'Indicadores rapidos para a operacao diaria',
          ),
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, constraints) {
              final isWide = constraints.maxWidth >= 700;
              final w = isWide
                  ? (constraints.maxWidth - 24) / 3
                  : constraints.maxWidth;
              return Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  SizedBox(
                    width: w,
                    child: _MetricCard(
                      metric: syndicMetrics[0],
                      onTap: () async {
                        await Navigator.of(context).push<void>(
                          MaterialPageRoute<void>(
                            builder: (context) => SyndicOccurrencesListPage(
                              condoId: widget.condoId,
                            ),
                          ),
                        );
                        if (context.mounted) {
                          _refreshDashboardCounts();
                        }
                      },
                    ),
                  ),
                  SizedBox(
                    width: w,
                    child: _MetricCard(
                      metric: syndicMetrics[1],
                      onTap: () async {
                        await Navigator.of(context).push<void>(
                          MaterialPageRoute<void>(
                            builder: (context) => SyndicMaintenanceListPage(
                              condoId: widget.condoId,
                              staffUserId: widget.userId,
                            ),
                          ),
                        );
                        if (context.mounted) {
                          _refreshDashboardCounts();
                        }
                      },
                    ),
                  ),
                  SizedBox(
                    width: w,
                    child: _MetricCard(
                      metric: syndicMetrics[2],
                      onTap: () async {
                        await Navigator.of(context).push<void>(
                          MaterialPageRoute<void>(
                            builder: (context) => SyndicNoticesManagePage(
                              condoId: widget.condoId,
                              userId: widget.userId,
                            ),
                          ),
                        );
                        if (context.mounted) {
                          _refreshDashboardCounts();
                        }
                      },
                    ),
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: 20),
          const _SectionTitle(
            title: 'Cobrança e boletos',
            subtitle:
                'Gere boletos para todas as unidades ou uma a uma; moradores apenas baixam PDF, QR e PIX',
          ),
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _ActionCard(
              item: const _ActionSummary(
                title: 'Boleto online',
                subtitle:
                    'Competências, geração em lote ou individual por unidade.',
                icon: Icons.receipt_long_rounded,
              ),
              actionLabel: 'Abrir',
              onAction: () {
                Navigator.of(context).push<void>(
                  MaterialPageRoute<void>(
                    builder: (context) => OnlineBillingHubPage(
                      condoId: widget.condoId,
                      userId: widget.userId,
                      userRole: CondoUserRoles.syndic,
                      unitId: null,
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
          _SectionTitle(
            title: 'Central de relacionamento',
            subtitle: 'Chats diretos com moradores, por apartamento',
          ),
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _ActionCard(
              item: const _ActionSummary(
                title: 'Conversas com moradores',
                subtitle:
                    'Lista identificada por torre e número, pela última mensagem',
                icon: Icons.forum_rounded,
              ),
              actionLabel: 'Abrir',
              onAction: () {
                Navigator.of(context).push<void>(
                  MaterialPageRoute<void>(
                    builder: (context) => StaffRelationInboxPage(
                      condoId: widget.condoId,
                      channel: RelationChannels.syndic,
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
          _SectionTitle(
            title: 'Gestão de avisos',
            subtitle:
                'Novo aviso, urgência e lista para editar, arquivar ou excluir',
          ),
          const SizedBox(height: 12),
          ..._notices.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _ActionCard(
                item: item,
                actionLabel: 'Gerenciar',
                onAction: () {
                  if (item.title == 'Novo aviso no mural') {
                    Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (context) => SyndicNoticeEditorPage(
                          condoId: widget.condoId,
                          userId: widget.userId,
                        ),
                      ),
                    );
                  } else if (item.title == 'Publicar aviso urgente') {
                    Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (context) => SyndicNoticeEditorPage(
                          condoId: widget.condoId,
                          userId: widget.userId,
                          defaultUrgency: 'urgent',
                        ),
                      ),
                    );
                  } else {
                    Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (context) => SyndicNoticesManagePage(
                          condoId: widget.condoId,
                          userId: widget.userId,
                        ),
                      ),
                    );
                  }
                },
              ),
            ),
          ),
          const SizedBox(height: 8),
          _SectionTitle(
            title: 'Relatórios',
            subtitle: 'Acompanhamento basico financeiro e operacional',
          ),
          const SizedBox(height: 12),
          ..._reports.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _ActionCard(
                item: item,
                actionLabel: 'Visualizar',
                onAction: () {
                  if (item.title == 'Financeiro basico') {
                    Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (context) =>
                            SyndicFinancialReportPage(condoId: widget.condoId),
                      ),
                    );
                  } else if (item.title == 'Uso de areas') {
                    Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (context) =>
                            SyndicAreaUsageReportPage(condoId: widget.condoId),
                      ),
                    );
                  } else if (item.title == 'Ocorrencias e manutencao') {
                    Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (context) =>
                            SyndicOperationsReportPage(condoId: widget.condoId),
                      ),
                    );
                  }
                },
              ),
            ),
          ),
          const SizedBox(height: 8),
          _SectionTitle(
            title: 'Envio de comunicados em massa',
            subtitle: 'Dispare mensagens para grupos de moradores',
          ),
          const SizedBox(height: 12),
          _MassCommunicationCard(
            audiences: _audiences,
            selectedAudience: _selectedAudience,
            subjectController: _subjectController,
            messageController: _messageController,
            onAudienceChanged: (value) {
              if (value == null) {
                return;
              }
              setState(() {
                _selectedAudience = value;
              });
            },
            onSend: _sendMassCommunication,
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({
    required this.title,
    required this.subtitle,
  });

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: theme.textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.metric, this.onTap});

  final _DashboardMetric metric;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    final inner = Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: colorScheme.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(metric.icon, color: colorScheme.primary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  metric.value,
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  metric.label,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );

    if (onTap == null) {
      return inner;
    }

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: inner,
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.item,
    required this.actionLabel,
    this.onAction,
  });

  final _ActionSummary item;
  final String actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: colorScheme.secondaryContainer,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(item.icon, color: colorScheme.onSecondaryContainer),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  item.subtitle,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 12),
                FilledButton.tonal(
                  onPressed: () {
                    if (onAction != null) {
                      onAction!();
                      return;
                    }
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('$actionLabel: ${item.title}')),
                    );
                  },
                  child: Text(actionLabel),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MassCommunicationCard extends StatelessWidget {
  const _MassCommunicationCard({
    required this.audiences,
    required this.selectedAudience,
    required this.subjectController,
    required this.messageController,
    required this.onAudienceChanged,
    required this.onSend,
  });

  final List<String> audiences;
  final String selectedAudience;
  final TextEditingController subjectController;
  final TextEditingController messageController;
  final ValueChanged<String?> onAudienceChanged;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          DropdownButtonFormField<String>(
            value: selectedAudience,
            decoration: const InputDecoration(
              labelText: 'Publico-alvo',
              border: OutlineInputBorder(),
            ),
            items: audiences
                .map(
                  (audience) => DropdownMenuItem<String>(
                    value: audience,
                    child: Text(audience),
                  ),
                )
                .toList(),
            onChanged: onAudienceChanged,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: subjectController,
            decoration: const InputDecoration(
              labelText: 'Assunto',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: messageController,
            minLines: 4,
            maxLines: 6,
            decoration: const InputDecoration(
              labelText: 'Mensagem',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: colorScheme.primary.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text(
              'Sugestao: use essa area para avisos gerais, manutencoes, regras temporarias e mensagens urgentes para os moradores.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: colorScheme.onSurface,
              ),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: onSend,
              icon: const Icon(Icons.send_rounded),
              label: const Text('Enviar comunicado em massa'),
            ),
          ),
        ],
      ),
    );
  }
}

class _DashboardMetric {
  const _DashboardMetric({
    required this.label,
    required this.value,
    required this.icon,
  });

  final String label;
  final String value;
  final IconData icon;
}

class _ActionSummary {
  const _ActionSummary({
    required this.title,
    required this.subtitle,
    required this.icon,
  });

  final String title;
  final String subtitle;
  final IconData icon;
}

class StyleSettingsPage extends StatefulWidget {
  const StyleSettingsPage({
    super.key,
    required this.selectedStyle,
    required this.onStyleChanged,
    this.condoId,
    this.userId,
    this.userRole,
  });

  final AppStylePreset selectedStyle;
  final ValueChanged<AppStylePreset> onStyleChanged;
  /// Quando definidos (após login), permite opções extras nas configurações.
  final int? condoId;
  final int? userId;
  final String? userRole;

  @override
  State<StyleSettingsPage> createState() => _StyleSettingsPageState();
}

class _StyleSettingsPageState extends State<StyleSettingsPage> {
  late AppStylePreset _currentStyle;

  @override
  void initState() {
    super.initState();
    _currentStyle = widget.selectedStyle;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    final canEditLoginBranding = widget.condoId != null &&
        widget.userId != null &&
        widget.userRole != null &&
        CondoUserRoles.isBillingStaff(widget.userRole!);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Configurações'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (canEditLoginBranding) ...[
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: colorScheme.surface,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: colorScheme.outlineVariant),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Tela de login',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Defina o nome e o logotipo exibidos na entrada do aplicativo.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.tonalIcon(
                      onPressed: () {
                        Navigator.of(context).push<void>(
                          MaterialPageRoute<void>(
                            builder: (context) => LoginBrandingSettingsPage(
                              condoId: widget.condoId!,
                              userId: widget.userId!,
                            ),
                          ),
                        );
                      },
                      icon: const Icon(Icons.login_rounded),
                      label: const Text('Personalizar tela de login'),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: colorScheme.surface,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: colorScheme.outlineVariant),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Estilo do aplicativo',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Altere as cores do app entre estilos claros, escuros e variações de destaque.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          ...AppStylePreset.values.map(
            (style) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _StyleOptionCard(
                style: style,
                groupValue: _currentStyle,
                onTap: () {
                  setState(() {
                    _currentStyle = style;
                  });
                  widget.onStyleChanged(style);
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StyleOptionCard extends StatelessWidget {
  const _StyleOptionCard({
    required this.style,
    required this.groupValue,
    required this.onTap,
  });

  final AppStylePreset style;
  final AppStylePreset groupValue;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final isSelected = style == groupValue;

    return Material(
      color: colorScheme.surface,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: isSelected ? style.seedColor : colorScheme.outlineVariant,
              width: isSelected ? 2 : 1,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: style.seedColor,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  style.previewIcon,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      style.label,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      style.description,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              Radio<AppStylePreset>(
                value: style,
                groupValue: groupValue,
                onChanged: (_) => onTap(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

enum AppStylePreset {
  diurno(
    label: 'Diurno',
    description: 'Visual claro e equilibrado para uso no dia a dia.',
    seedColor: Color(0xFF0C6B58),
    brightness: Brightness.light,
    previewIcon: Icons.wb_sunny_rounded,
  ),
  noturno(
    label: 'Noturno',
    description:
        'Tema escuro com contraste maior para ambientes com pouca luz.',
    seedColor: Color(0xFF1E293B),
    brightness: Brightness.dark,
    previewIcon: Icons.dark_mode_rounded,
  ),
  blue(
    label: 'Blue',
    description: 'Paleta azul moderna com identidade mais tecnológica.',
    seedColor: Color(0xFF1565C0),
    brightness: Brightness.light,
    previewIcon: Icons.water_drop_rounded,
  ),
  green(
    label: 'Green',
    description: 'Tons verdes vibrantes com destaque para sustentabilidade.',
    seedColor: Color(0xFF2E7D32),
    brightness: Brightness.light,
    previewIcon: Icons.eco_rounded,
  );

  const AppStylePreset({
    required this.label,
    required this.description,
    required this.seedColor,
    required this.brightness,
    required this.previewIcon,
  });

  final String label;
  final String description;
  final Color seedColor;
  final Brightness brightness;
  final IconData previewIcon;
}

ThemeData _buildTheme(AppStylePreset style) {
  final colorScheme = ColorScheme.fromSeed(
    seedColor: style.seedColor,
    brightness: style.brightness,
  );

  final scaffoldColor = style.brightness == Brightness.dark
      ? const Color(0xFF0F172A)
      : _lightBackground(style);

  return ThemeData(
    colorScheme: colorScheme,
    scaffoldBackgroundColor: scaffoldColor,
    appBarTheme: AppBarTheme(
      backgroundColor: colorScheme.primary,
      foregroundColor: colorScheme.onPrimary,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: colorScheme.inverseSurface,
      contentTextStyle: TextStyle(color: colorScheme.onInverseSurface),
    ),
    useMaterial3: true,
  );
}

Color _lightBackground(AppStylePreset style) {
  switch (style) {
    case AppStylePreset.diurno:
      return const Color(0xFFF4F7F9);
    case AppStylePreset.noturno:
      return const Color(0xFF0F172A);
    case AppStylePreset.blue:
      return const Color(0xFFF1F7FF);
    case AppStylePreset.green:
      return const Color(0xFFF3FBF4);
  }
}

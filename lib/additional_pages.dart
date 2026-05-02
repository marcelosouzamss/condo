import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/relation_center_pages.dart';
import 'package:condo_app/resident_unit_storage.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

export 'events_calendar_page.dart' show EventsCalendarPage;
export 'internal_market_page.dart' show InternalMarketPage;
export 'service_guide_page.dart' show ServiceGuidePage;

class ContactCondoPage extends StatefulWidget {
  const ContactCondoPage({super.key});

  static const int _condoId = 1;

  @override
  State<ContactCondoPage> createState() => _ContactCondoPageState();
}

class _ContactCondoPageState extends State<ContactCondoPage> {
  int? _unitId;
  bool _unitLoading = true;
  String? _unitError;
  List<Map<String, dynamic>> _summary = [];

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    setState(() {
      _unitLoading = true;
      _unitError = null;
    });
    final uid = await resolveResidentUnitIdForCondo(ContactCondoPage._condoId);
    if (!mounted) {
      return;
    }
    if (uid == null) {
      setState(() {
        _unitLoading = false;
        _unitError =
            'Não foi possível identificar sua unidade! Selecione em Minha Unidade.';
      });
      return;
    }
    final sum = await fetchRelationUnitSummary(
      condoId: ContactCondoPage._condoId,
      unitId: uid,
    );
    if (!mounted) {
      return;
    }
    setState(() {
      _unitId = uid;
      _summary = sum;
      _unitLoading = false;
    });
  }

  Future<void> _openChat(String channel) async {
    final uid = _unitId;
    if (uid == null) {
      return;
    }
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (ctx) => ResidentRelationChatPage(
          condoId: ContactCondoPage._condoId,
          unitId: uid,
          channel: channel,
        ),
      ),
    );
    if (mounted) {
      final sum = await fetchRelationUnitSummary(
        condoId: ContactCondoPage._condoId,
        unitId: uid,
      );
      setState(() => _summary = sum);
    }
  }

  Future<void> _openOccurrence(String category, String defaultTitle) async {
    final uid = _unitId;
    if (uid == null) {
      return;
    }
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (ctx) => ResidentOccurrenceReportPage(
          condoId: ContactCondoPage._condoId,
          unitId: uid,
          category: category,
          defaultTitle: defaultTitle,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_unitLoading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Fale com o Condomínio')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (_unitError != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Fale com o Condomínio')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(_unitError!, textAlign: TextAlign.center),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _bootstrap,
                  child: const Text('Tentar novamente'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return _ModulePage(
      title: 'Fale com o Condomínio',
      headline: 'Central de relacionamento',
      description:
          'Converse com a equipe do condomínio, abra chamados e acompanhe o histórico de mensagens.',
      metrics: const [
        _ModuleMetric('Conversas ativas', '04', Icons.forum_rounded),
        _ModuleMetric('Chamados abertos', '03', Icons.support_agent_rounded),
        _ModuleMetric('Mensagens no mês', '28', Icons.mark_chat_unread_rounded),
      ],
      sections: [
        _ModuleSection(
          title: 'Chat direto com',
          subtitle: 'Canais imediatos de atendimento',
          actionLabel: 'Conversar',
          items: [
            _ModuleItem(
              'Síndico',
              'Canal prioritário para decisões, avisos e alinhamentos.',
              Icons.account_balance_rounded,
              onPressed: () => _openChat(RelationChannels.syndic),
            ),
            _ModuleItem(
              'Administração',
              'Atendimento para boletos, cadastro e suporte operacional.',
              Icons.business_center_rounded,
              onPressed: () => _openChat(RelationChannels.administration),
            ),
          ],
        ),
        _ModuleSection(
          title: 'Abertura de chamados',
          subtitle: 'Registre demandas e acompanhe a tratativa',
          actionLabel: 'Abrir chamado',
          items: [
            _ModuleItem(
              'Reclamação de ruído',
              'Descreva horário, unidade envolvida e recorrência.',
              Icons.campaign_rounded,
              onPressed: () => _openOccurrence(
                'noise_complaint',
                'Reclamação de ruído',
              ),
            ),
            _ModuleItem(
              'Problema em área comum',
              'Informe o local e detalhes para encaminhar à equipe.',
              Icons.report_problem_rounded,
              onPressed: () => _openOccurrence(
                'common_area_issue',
                'Problema em área comum',
              ),
            ),
          ],
        ),
        _ModuleSection(
          title: 'Histórico de mensagens',
          subtitle: 'Últimas interações nos chats diretos',
          actionLabel: 'Abrir',
          items: [
            _ModuleItem(
              'Conversa com o síndico',
              subtitleFromSummary(_summary, RelationChannels.syndic),
              Icons.history_rounded,
              onPressed: () => _openChat(RelationChannels.syndic),
            ),
            _ModuleItem(
              'Conversa com a administração',
              subtitleFromSummary(_summary, RelationChannels.administration),
              Icons.history_rounded,
              onPressed: () => _openChat(RelationChannels.administration),
            ),
          ],
        ),
      ],
    );
  }
}

class SpaceReservationsPage extends StatefulWidget {
  const SpaceReservationsPage({
    super.key,
    required this.condoId,
    required this.requesterName,
  });

  final int condoId;
  final String requesterName;

  @override
  State<SpaceReservationsPage> createState() => _SpaceReservationsPageState();
}

class _SpaceReservationsPageState extends State<SpaceReservationsPage> {
  late Future<List<dynamic>> _spacesFuture;

  int? _unitId;
  bool _unitLoading = true;
  String? _unitResolveError;
  List<dynamic> _myReservations = const [];
  bool _myReservationsLoading = false;

  @override
  void initState() {
    super.initState();
    _spacesFuture = _loadSpaces();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    await _resolveUnitForPage();
    if (!mounted) {
      return;
    }
    if (_unitId != null) {
      await _refreshMyReservations();
    }
  }

  Future<void> _resolveUnitForPage() async {
    setState(() {
      _unitLoading = true;
      _unitResolveError = null;
    });
    try {
      final savedId = await readResidentSelectedUnitId(
        CondoApi.residentSelectedUnitPrefKey(widget.condoId),
      );
      final r = await http.get(
        CondoApi.uri('/api/units', {'condoId': '${widget.condoId}'}),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        setState(() {
          _unitResolveError = 'Erro ao carregar unidades (${r.statusCode}).';
          _unitLoading = false;
        });
        return;
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      int? matchFromList(int id) {
        for (final raw in list) {
          final u = raw as Map<String, dynamic>;
          final cid = u['condo_id'];
          final uid = u['id'];
          if (cid == widget.condoId &&
              uid != null &&
              (uid as num).toInt() == id) {
            return id;
          }
        }
        return null;
      }

      int? resolved;
      if (savedId != null) {
        resolved = matchFromList(savedId);
      }
      resolved ??= () {
        for (final raw in list) {
          final u = raw as Map<String, dynamic>;
          if (u['condo_id'] == widget.condoId && u['id'] != null) {
            return (u['id'] as num).toInt();
          }
        }
        return null;
      }();

      setState(() {
        _unitId = resolved;
        _unitLoading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _unitResolveError = 'Falha ao identificar sua unidade.';
          _unitLoading = false;
        });
      }
    }
  }

  Future<void> _refreshMyReservations() async {
    if (_unitId == null) {
      return;
    }
    setState(() => _myReservationsLoading = true);
    try {
      final r = await http.get(
        CondoApi.uri('/api/reservation-spaces/my-reservations', {
          'condoId': '${widget.condoId}',
          'unitId': '${_unitId!}',
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode == 200) {
        final list = jsonDecode(r.body) as List<dynamic>;
        setState(() {
          _myReservations = list;
          _myReservationsLoading = false;
        });
      } else {
        setState(() => _myReservationsLoading = false);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _myReservationsLoading = false);
      }
    }
  }

  Future<void> _cancelReservation(int reservationId) async {
    if (_unitId == null) {
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancelar reserva'),
        content: const Text(
          'Deseja cancelar esta reserva? O espaço ficará disponível novamente para essa data.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Voltar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Cancelar reserva'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) {
      return;
    }

    final response = await http.patch(
      CondoApi.uri(
        '/api/reservation-spaces/reservations/$reservationId/cancel',
      ),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'unitId': _unitId,
      }),
    );
    if (!mounted) {
      return;
    }
    if (response.statusCode == 200) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Reserva cancelada.')),
      );
      await _refreshMyReservations();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Não foi possível cancelar (${response.statusCode}).',
          ),
        ),
      );
    }
  }

  Future<void> _refreshAll() async {
    setState(() {
      _spacesFuture = _loadSpaces();
    });
    await Future.wait<void>([
      _spacesFuture.then((_) {}),
      _refreshMyReservations(),
    ]);
  }

  static String _statusLabel(String status) {
    switch (status) {
      case 'pending':
        return 'Pendente';
      case 'approved':
        return 'Aprovada';
      default:
        return status;
    }
  }

  static String _dateFromIso(String iso) {
    if (iso.length >= 10) {
      return iso.substring(0, 10);
    }
    return iso;
  }

  Future<List<dynamic>> _loadSpaces() async {
    final response = await http.get(
      CondoApi.uri('/api/reservation-spaces', {'condoId': '${widget.condoId}'}),
    );
    if (response.statusCode != 200) {
      throw Exception('Erro ao carregar espaços (${response.statusCode})');
    }
    return jsonDecode(response.body) as List<dynamic>;
  }

  Future<void> _refreshSpaces() async {
    await _refreshAll();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Reservas de Espaço')),
      body: RefreshIndicator(
        onRefresh: _refreshSpaces,
        child: FutureBuilder<List<dynamic>>(
          future: _spacesFuture,
          builder: (context, snapshot) {
            final spaces = snapshot.data ?? const <dynamic>[];

            return ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              children: [
                Text(
                  'Áreas comuns',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Veja suas reservas e solicite novos horários nos espaços disponibilizados pelo condomínio. Cadastro de espaços e aprovações ficam com síndico e administração, pelo mesmo atalho Reservas de Espaço no início.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 22),
                Text(
                  'Minhas reservas',
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Reservas futuras da sua unidade. Cancelamento libera a data no calendário.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 12),
                if (_unitLoading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (_unitResolveError != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      _unitResolveError!,
                      style: TextStyle(color: colorScheme.error),
                    ),
                  )
                else if (_unitId == null)
                  Text(
                    'Defina sua unidade em Minha Unidade para ver e cancelar reservas.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colorScheme.onSurfaceVariant,
                    ),
                  )
                else if (_myReservationsLoading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (_myReservations.isEmpty)
                  Text(
                    'Nenhuma reserva ativa.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colorScheme.onSurfaceVariant,
                    ),
                  )
                else
                  ..._myReservations.map((raw) {
                    final row = raw as Map<String, dynamic>;
                    final id = (row['id'] as num).toInt();
                    final spaceName = row['space_name'] as String? ?? '';
                    final starts = row['starts_at']?.toString() ?? '';
                    final status = row['status'] as String? ?? '';
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Card(
                        elevation: 0,
                        color: colorScheme.surfaceContainerHighest.withValues(
                          alpha: 0.35,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                          side: BorderSide(color: colorScheme.outlineVariant),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      spaceName,
                                      style:
                                          theme.textTheme.titleSmall?.copyWith(
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      'Data: ${_dateFromIso(starts)} · ${_statusLabel(status)}',
                                      style:
                                          theme.textTheme.bodySmall?.copyWith(
                                        color: colorScheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              TextButton.icon(
                                onPressed: () => _cancelReservation(id),
                                icon: const Icon(Icons.event_busy_rounded,
                                    size: 20),
                                label: const Text('Cancelar'),
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  }),
                const SizedBox(height: 24),
                Text(
                  'Reserva de',
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Espaços disponíveis para moradores',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 14),
                if (snapshot.connectionState == ConnectionState.waiting)
                  const Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: CircularProgressIndicator(),
                    ),
                  )
                else if (snapshot.hasError)
                  Text(
                    'Não foi possível carregar os espaços. Verifique se o backend está em ${CondoApi.baseUrl}.',
                    style: TextStyle(color: colorScheme.error),
                  )
                else if (spaces.isEmpty)
                  const _EmptyReservationSpaces()
                else
                  ...spaces.map((space) {
                    final item = space as Map<String, dynamic>;
                    final name = item['name'] as String? ?? '';
                    final description = item['description'] as String? ?? '';
                    final iconKey = item['icon_key'] as String? ?? '';
                    final spaceId = (item['id'] as num?)?.toInt() ?? 0;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: _ReservationSpaceCard(
                        name: name,
                        description: description,
                        icon: _reservationIcon(iconKey),
                        onReserve: spaceId > 0
                            ? () {
                                Navigator.of(context)
                                    .push<void>(
                                  MaterialPageRoute<void>(
                                    builder: (ctx) => ReservationCalendarPage(
                                      condoId: widget.condoId,
                                      spaceId: spaceId,
                                      spaceName: name,
                                      icon: _reservationIcon(iconKey),
                                      requesterName: widget.requesterName,
                                    ),
                                  ),
                                )
                                    .then((_) {
                                  if (mounted) {
                                    _refreshMyReservations();
                                  }
                                });
                              }
                            : null,
                      ),
                    );
                  }),
              ],
            );
          },
        ),
      ),
    );
  }

  IconData _reservationIcon(String iconKey) {
    switch (iconKey) {
      case 'celebration':
        return Icons.celebration_rounded;
      case 'outdoor_grill':
        return Icons.outdoor_grill_rounded;
      case 'pool':
        return Icons.pool_rounded;
      case 'sports_soccer':
        return Icons.sports_soccer_rounded;
      case 'fitness_center':
        return Icons.fitness_center_rounded;
      default:
        return Icons.meeting_room_rounded;
    }
  }
}

/// Calendário mensal com dias livres (verde) e indisponíveis (vermelho).
class ReservationCalendarPage extends StatefulWidget {
  const ReservationCalendarPage({
    super.key,
    required this.condoId,
    required this.spaceId,
    required this.spaceName,
    required this.icon,
    required this.requesterName,
  });

  final int condoId;
  final int spaceId;
  final String spaceName;
  final IconData icon;
  final String requesterName;

  @override
  State<ReservationCalendarPage> createState() =>
      _ReservationCalendarPageState();
}

class _ReservationCalendarPageState extends State<ReservationCalendarPage> {
  late DateTime _focusedMonth;

  /// Por data `YYYY-MM-DD`: `free`, `pending`, `approved`, `past`.
  Map<String, String> _dayCell = {};
  bool _loading = true;
  String? _error;
  int? _unitId;

  static const _weekdayLabels = [
    'Seg',
    'Ter',
    'Qua',
    'Qui',
    'Sex',
    'Sáb',
    'Dom',
  ];

  static const _monthNames = [
    '',
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
  ];

  @override
  void initState() {
    super.initState();
    final n = DateTime.now();
    _focusedMonth = DateTime(n.year, n.month);
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    await _resolveUnitId();
    if (!mounted) {
      return;
    }
    if (_unitId != null) {
      await _loadCalendar();
    }
  }

  Future<void> _resolveUnitId() async {
    try {
      final savedId = await readResidentSelectedUnitId(
        CondoApi.residentSelectedUnitPrefKey(widget.condoId),
      );
      final r = await http.get(
        CondoApi.uri('/api/units', {'condoId': '${widget.condoId}'}),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        setState(() {
          _error = 'Erro ao carregar unidades (${r.statusCode})';
          _loading = false;
        });
        return;
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      int? matchFromList(int id) {
        for (final raw in list) {
          final u = raw as Map<String, dynamic>;
          final cid = u['condo_id'];
          final uid = u['id'];
          if (cid == widget.condoId &&
              uid != null &&
              (uid as num).toInt() == id) {
            return id;
          }
        }
        return null;
      }

      if (savedId != null) {
        final resolved = matchFromList(savedId);
        if (resolved != null) {
          setState(() {
            _unitId = resolved;
          });
          return;
        }
      }
      for (final raw in list) {
        final u = raw as Map<String, dynamic>;
        final cid = u['condo_id'];
        final id = u['id'];
        if (cid == widget.condoId && id != null) {
          setState(() {
            _unitId = (id as num).toInt();
          });
          return;
        }
      }
      setState(() {
        _error = 'Nenhuma unidade encontrada para este condomínio.';
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Falha de rede ao carregar unidades.';
          _loading = false;
        });
      }
    }
  }

  Future<void> _loadCalendar() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final uri = CondoApi.uri(
        '/api/reservation-spaces/${widget.spaceId}/calendar',
        {
          'condoId': '${widget.condoId}',
          'year': '${_focusedMonth.year}',
          'month': '${_focusedMonth.month}',
        },
      );
      final r = await http.get(uri);
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        setState(() {
          _error = 'Erro ao carregar calendário (${r.statusCode})';
          _loading = false;
        });
        return;
      }
      final map = jsonDecode(r.body) as Map<String, dynamic>;
      final days = map['days'] as List<dynamic>;
      final next = <String, String>{};
      for (final d in days) {
        final dm = d as Map<String, dynamic>;
        final dateStr = dm['date'] as String;
        final cell = dm['cell'] as String?;
        final available = dm['available'] as bool? ?? false;
        next[dateStr] = cell ?? (available ? 'free' : 'approved');
      }
      setState(() {
        _dayCell = next;
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Falha ao carregar calendário.';
          _loading = false;
        });
      }
    }
  }

  Future<void> _shiftMonth(int delta) async {
    setState(() {
      _focusedMonth = DateTime(_focusedMonth.year, _focusedMonth.month + delta);
    });
    await _loadCalendar();
  }

  Future<void> _onDayTap(String dateStr) async {
    if ((_dayCell[dateStr] ?? '') != 'free') {
      return;
    }

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reserva'),
        content: const Text('Você deseja reservar?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Não'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sim'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted || _unitId == null) {
      return;
    }

    final r = await http.post(
      CondoApi.uri('/api/reservation-spaces/${widget.spaceId}/reservations'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'unitId': _unitId,
        'date': dateStr,
        'requesterName': widget.requesterName.trim(),
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 201) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Aguarde aprovação.')),
      );
      await _loadCalendar();
    } else if (r.statusCode == 409) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Data indisponível.')),
      );
      await _loadCalendar();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro (${r.statusCode}).')),
      );
    }
  }

  Widget _calendarGrid(ThemeData theme, ColorScheme cs) {
    final year = _focusedMonth.year;
    final month = _focusedMonth.month;
    final first = DateTime(year, month, 1);
    final daysInMonth = DateTime(year, month + 1, 0).day;
    final leading = first.weekday - 1;

    final cells = <Widget>[];
    for (var i = 0; i < leading; i++) {
      cells.add(const SizedBox());
    }
    for (var d = 1; d <= daysInMonth; d++) {
      final dateStr =
          '$year-${month.toString().padLeft(2, '0')}-${d.toString().padLeft(2, '0')}';
      final cell = _dayCell[dateStr] ?? 'free';
      final isFree = cell == 'free';
      final isPending = cell == 'pending';
      final Color bg;
      final Color border;
      final Color fg;
      if (isFree) {
        bg = Colors.green.shade100;
        border = Colors.green.shade700;
        fg = Colors.green.shade900;
      } else if (isPending) {
        bg = Colors.amber.shade100;
        border = Colors.amber.shade800;
        fg = Colors.amber.shade900;
      } else {
        bg = Colors.red.shade100;
        border = Colors.red.shade700;
        fg = Colors.red.shade900;
      }
      cells.add(
        Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: isFree ? () => _onDayTap(dateStr) : null,
            borderRadius: BorderRadius.circular(8),
            child: Container(
              margin: const EdgeInsets.all(2),
              decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: border),
              ),
              child: Center(
                child: Text(
                  '$d',
                  style: theme.textTheme.bodyLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: fg,
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    return GridView.count(
      crossAxisCount: 7,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      children: cells,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Icon(widget.icon, size: 26),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                widget.spaceName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _loadCalendar,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                IconButton(
                  onPressed: _loading ? null : () => _shiftMonth(-1),
                  icon: const Icon(Icons.chevron_left_rounded),
                ),
                Expanded(
                  child: Text(
                    '${_monthNames[_focusedMonth.month]} ${_focusedMonth.year}',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: _loading ? null : () => _shiftMonth(1),
                  icon: const Icon(Icons.chevron_right_rounded),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: _weekdayLabels
                  .map(
                    (w) => Expanded(
                      child: Text(
                        w,
                        textAlign: TextAlign.center,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: cs.onSurfaceVariant,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 8),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Text(
                  _error!,
                  style: TextStyle(color: cs.error),
                ),
              ),
            if (_loading)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(32),
                  child: CircularProgressIndicator(),
                ),
              )
            else
              _calendarGrid(theme, cs),
            const SizedBox(height: 24),
            Text(
              'Verde: disponível · Amarelo: pendente de aprovação · Vermelho: confirmado ou data passada',
              style: theme.textTheme.bodySmall?.copyWith(
                color: cs.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReservationSpaceCard extends StatelessWidget {
  const _ReservationSpaceCard({
    required this.name,
    required this.description,
    required this.icon,
    this.onReserve,
  });

  final String name;
  final String description;
  final IconData icon;
  final VoidCallback? onReserve;

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
                  name,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  description,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 12),
                FilledButton.tonal(
                  onPressed: onReserve,
                  child: const Text('Reservar'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyReservationSpaces extends StatelessWidget {
  const _EmptyReservationSpaces();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 24),
      child: Text(
        'Nenhum espaço cadastrado ainda. Solicite ao síndico ou à administração o cadastro de espaços para reserva.',
      ),
    );
  }
}

/// Anexos do aviso no formato retornado pela API.
List<Map<String, dynamic>> _attachmentsFromNoticeMap(Map<String, dynamic> n) {
  final rawAtt = n['attachments'];
  if (rawAtt is List<dynamic>) {
    return rawAtt.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }
  if (rawAtt is String && rawAtt.isNotEmpty) {
    try {
      final dec = jsonDecode(rawAtt) as List<dynamic>;
      return dec.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {}
  }
  return const [];
}

/// Detalhes completos de um aviso do mural.
class NoticeDetailPage extends StatelessWidget {
  const NoticeDetailPage({super.key, required this.notice});

  final Map<String, dynamic> notice;

  String _shortDate(String? iso) {
    if (iso == null || iso.length < 10) {
      return '';
    }
    return iso.substring(0, 10);
  }

  bool _isImageMime(String? m) => m != null && m.startsWith('image/');

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final title = notice['title'] as String? ?? '';
    final content = notice['content'] as String? ?? '';
    final urgent = (notice['urgency'] as String? ?? '') == 'urgent';
    final pinned = notice['is_pinned'] == true;
    final pub = _shortDate(notice['published_at']?.toString());
    final exp = notice['expires_at'];
    final audience = (notice['audience'] as String? ?? '').trim();
    final attachments = _attachmentsFromNoticeMap(notice);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          title.isEmpty ? 'Aviso' : title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (pinned)
            Row(
              children: [
                Icon(Icons.push_pin_rounded, color: cs.primary, size: 22),
                const SizedBox(width: 8),
                Text(
                  'Fixado no mural',
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: cs.primary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          if (pinned) const SizedBox(height: 12),
          if (urgent)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Chip(
                label: const Text('URGENTE'),
                backgroundColor: cs.error,
                labelStyle: TextStyle(
                  color: cs.onError,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          Text(
            title,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            [
              if (pub.isNotEmpty) 'Publicado em $pub',
              if (exp != null) 'Válido até ${_shortDate(exp.toString())}',
              if (audience.isNotEmpty) 'Público: $audience',
            ].join(' · '),
            style: theme.textTheme.bodySmall?.copyWith(
              color: cs.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 20),
          Text(content, style: theme.textTheme.bodyLarge),
          if (attachments.isNotEmpty) ...[
            const SizedBox(height: 24),
            Text(
              'Anexos',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 12),
            ...attachments.map((a) {
              final pathRaw = a['url'] as String? ?? '';
              final fullUrl = CondoApi.uploadsUrl(pathRaw);
              final mime = a['mimeType'] as String? ?? '';
              final fname = a['fileName'] as String? ?? 'Anexo';
              if (_isImageMime(mime)) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: InteractiveViewer(
                      minScale: 0.5,
                      maxScale: 4,
                      child: Image.network(
                        fullUrl,
                        fit: BoxFit.fitWidth,
                        width: double.infinity,
                        errorBuilder: (_, __, ___) => Container(
                          padding: const EdgeInsets.all(24),
                          color: cs.surfaceContainerHighest,
                          child:
                              const Icon(Icons.broken_image_outlined, size: 48),
                        ),
                      ),
                    ),
                  ),
                );
              }
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.attach_file_rounded, color: cs.primary),
                  title: Text(fname),
                  subtitle: Text(mime),
                  trailing: const Icon(Icons.open_in_new_rounded),
                  onTap: () async {
                    final u = Uri.parse(fullUrl);
                    if (await canLaunchUrl(u)) {
                      await launchUrl(
                        u,
                        mode: LaunchMode.externalApplication,
                      );
                    }
                  },
                ),
              );
            }),
          ],
        ],
      ),
    );
  }
}

class NoticeBoardPage extends StatefulWidget {
  const NoticeBoardPage({
    super.key,
    this.condoId = 1,
    this.userId,
    this.userRole,
  });

  final int condoId;

  /// Quando preenchidos com perfil de síndico ou administração, exibe ações de gestão no mural.
  final int? userId;
  final String? userRole;

  @override
  State<NoticeBoardPage> createState() => _NoticeBoardPageState();
}

class _NoticeBoardPageState extends State<NoticeBoardPage> {
  bool _loading = true;
  String? _error;
  List<dynamic> _items = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await http.get(
        CondoApi.uri('/api/notices', {
          'condoId': '${widget.condoId}',
          '_t': '${DateTime.now().millisecondsSinceEpoch}',
        }),
        headers: const {'Cache-Control': 'no-cache'},
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        setState(() {
          _error = 'Erro ${r.statusCode}';
          _loading = false;
        });
        return;
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      setState(() {
        _items = list;
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Não foi possível carregar.';
          _loading = false;
        });
      }
    }
  }

  String _shortDate(String? iso) {
    if (iso == null || iso.length < 10) {
      return '';
    }
    return iso.substring(0, 10);
  }

  bool get _canManageNotices {
    final uid = widget.userId;
    final role = widget.userRole;
    return uid != null && role != null && CondoUserRoles.isBillingStaff(role);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final uid = widget.userId;
    final fabInset = (_canManageNotices && uid != null) ? 96.0 : 0.0;

    Future<void> openNewNotice() async {
      if (uid == null) {
        return;
      }
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (ctx) => SyndicNoticeEditorPage(
            condoId: widget.condoId,
            userId: uid,
          ),
        ),
      );
      if (mounted) {
        await _load();
      }
    }

    Future<void> openManage() async {
      if (uid == null) {
        return;
      }
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (ctx) => SyndicNoticesManagePage(
            condoId: widget.condoId,
            userId: uid,
          ),
        ),
      );
      if (mounted) {
        await _load();
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Mural de Avisos'),
      ),
      floatingActionButton: _canManageNotices && uid != null
          ? Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                FloatingActionButton.small(
                  heroTag: 'notice_board_manage',
                  tooltip: 'Gerir mural',
                  onPressed: openManage,
                  child: const Icon(Icons.edit_notifications_rounded),
                ),
                const SizedBox(height: 12),
                FloatingActionButton.extended(
                  heroTag: 'notice_board_new',
                  onPressed: openNewNotice,
                  icon: const Icon(Icons.post_add_rounded),
                  label: const Text('Novo aviso'),
                ),
              ],
            )
          : null,
      floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Text(
              _canManageNotices
                  ? 'Você pode publicar e gerir avisos pelos botões abaixo ou pela área do síndico / administração.'
                  : 'Somente síndico e administração publicam avisos.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: cs.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: _loading
                  ? ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: const [
                        SizedBox(height: 100),
                        Center(child: CircularProgressIndicator()),
                      ],
                    )
                  : _error != null
                      ? ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: EdgeInsets.fromLTRB(
                            24,
                            24,
                            24,
                            24 + fabInset,
                          ),
                          children: [
                            Text(_error!, style: TextStyle(color: cs.error)),
                            Text(
                              'Backend: ${CondoApi.baseUrl}',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: cs.onSurfaceVariant,
                              ),
                            ),
                          ],
                        )
                      : _items.isEmpty
                          ? ListView(
                              physics: const AlwaysScrollableScrollPhysics(),
                              padding: EdgeInsets.fromLTRB(
                                24,
                                24,
                                24,
                                24 + fabInset,
                              ),
                              children: const [
                                Text('Nenhum aviso no mural no momento.'),
                              ],
                            )
                          : ListView.separated(
                              padding: EdgeInsets.fromLTRB(
                                16,
                                16,
                                16,
                                16 + fabInset,
                              ),
                              itemCount: _items.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 12),
                              itemBuilder: (context, i) {
                                final n = _items[i] as Map<String, dynamic>;
                                final title = n['title'] as String? ?? '';
                                final content = n['content'] as String? ?? '';
                                final urgent =
                                    (n['urgency'] as String? ?? '') == 'urgent';
                                final pinned = n['is_pinned'] == true;
                                final pub =
                                    _shortDate(n['published_at']?.toString());
                                final exp = n['expires_at'];
                                final audience =
                                    (n['audience'] as String? ?? '').trim();
                                final attachments =
                                    _attachmentsFromNoticeMap(n);

                                return Card(
                                  elevation: 0,
                                  clipBehavior: Clip.antiAlias,
                                  color: urgent
                                      ? cs.errorContainer
                                          .withValues(alpha: 0.35)
                                      : cs.surfaceContainerHighest.withValues(
                                          alpha: 0.4,
                                        ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(16),
                                    side: BorderSide(
                                      color: urgent
                                          ? cs.error.withValues(alpha: 0.4)
                                          : cs.outlineVariant,
                                    ),
                                  ),
                                  child: InkWell(
                                    onTap: () {
                                      Navigator.of(context).push<void>(
                                        MaterialPageRoute<void>(
                                          builder: (ctx) => NoticeDetailPage(
                                            notice:
                                                Map<String, dynamic>.from(n),
                                          ),
                                        ),
                                      );
                                    },
                                    child: Padding(
                                      padding: const EdgeInsets.all(16),
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              if (pinned)
                                                Padding(
                                                  padding:
                                                      const EdgeInsets.only(
                                                    right: 8,
                                                  ),
                                                  child: Icon(
                                                    Icons.push_pin_rounded,
                                                    size: 20,
                                                    color: cs.primary,
                                                  ),
                                                ),
                                              Expanded(
                                                child: Text(
                                                  title,
                                                  style: theme
                                                      .textTheme.titleMedium
                                                      ?.copyWith(
                                                    fontWeight: FontWeight.w800,
                                                  ),
                                                ),
                                              ),
                                              Icon(
                                                Icons.chevron_right_rounded,
                                                color: cs.onSurfaceVariant,
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 8),
                                          if (urgent)
                                            Padding(
                                              padding: const EdgeInsets.only(
                                                  bottom: 8),
                                              child: Chip(
                                                label: const Text('URGENTE'),
                                                backgroundColor: cs.error,
                                                labelStyle: TextStyle(
                                                  color: cs.onError,
                                                  fontWeight: FontWeight.w700,
                                                  fontSize: 12,
                                                ),
                                                visualDensity:
                                                    VisualDensity.compact,
                                                materialTapTargetSize:
                                                    MaterialTapTargetSize
                                                        .shrinkWrap,
                                              ),
                                            ),
                                          Text(
                                            content,
                                            maxLines: 5,
                                            overflow: TextOverflow.ellipsis,
                                            style: theme.textTheme.bodyMedium,
                                          ),
                                          if (attachments.isNotEmpty) ...[
                                            const SizedBox(height: 12),
                                            Wrap(
                                              spacing: 8,
                                              runSpacing: 8,
                                              children: attachments.map((a) {
                                                final pathRaw =
                                                    a['url'] as String? ?? '';
                                                final fullUrl =
                                                    CondoApi.uploadsUrl(
                                                        pathRaw);
                                                final mime =
                                                    a['mimeType'] as String? ??
                                                        '';
                                                final fname =
                                                    a['fileName'] as String? ??
                                                        'Anexo';
                                                if (mime.startsWith('image/')) {
                                                  return ClipRRect(
                                                    borderRadius:
                                                        BorderRadius.circular(
                                                            10),
                                                    child: Image.network(
                                                      fullUrl,
                                                      width: 140,
                                                      height: 140,
                                                      fit: BoxFit.cover,
                                                      errorBuilder:
                                                          (_, __, ___) =>
                                                              Container(
                                                        width: 140,
                                                        height: 140,
                                                        color: cs
                                                            .surfaceContainerHigh,
                                                        alignment:
                                                            Alignment.center,
                                                        child: const Icon(
                                                          Icons
                                                              .broken_image_outlined,
                                                        ),
                                                      ),
                                                    ),
                                                  );
                                                }
                                                return ActionChip(
                                                  avatar: Icon(
                                                    Icons.attach_file_rounded,
                                                    size: 18,
                                                    color: cs.primary,
                                                  ),
                                                  label: Text(
                                                    fname.length > 22
                                                        ? '${fname.substring(0, 19)}…'
                                                        : fname,
                                                  ),
                                                  onPressed: () async {
                                                    final u =
                                                        Uri.parse(fullUrl);
                                                    if (await canLaunchUrl(u)) {
                                                      await launchUrl(
                                                        u,
                                                        mode: LaunchMode
                                                            .externalApplication,
                                                      );
                                                    }
                                                  },
                                                );
                                              }).toList(),
                                            ),
                                          ],
                                          const SizedBox(height: 12),
                                          Text(
                                            [
                                              if (pub.isNotEmpty)
                                                'Publicado em $pub',
                                              if (exp != null)
                                                'Até ${_shortDate(exp.toString())}',
                                              if (audience.isNotEmpty)
                                                'Público: $audience',
                                            ].join(' · '),
                                            style: theme.textTheme.bodySmall
                                                ?.copyWith(
                                              color: cs.onSurfaceVariant,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                );
                              },
                            ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ModulePage extends StatelessWidget {
  const _ModulePage({
    required this.title,
    required this.headline,
    required this.description,
    required this.metrics,
    required this.sections,
  });

  final String title;
  final String headline;
  final String description;
  final List<_ModuleMetric> metrics;
  final List<_ModuleSection> sections;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: Text(title)),
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
                  headline,
                  style: theme.textTheme.headlineSmall?.copyWith(
                    color: colorScheme.onPrimary,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  description,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onPrimary.withValues(alpha: 0.90),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          _ModuleSectionTitle(
            title: 'Visão geral',
            subtitle: 'Resumo dos principais indicadores do módulo',
          ),
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, constraints) {
              final isWide = constraints.maxWidth >= 700;
              return Wrap(
                spacing: 12,
                runSpacing: 12,
                children: metrics
                    .map(
                      (metric) => SizedBox(
                        width: isWide
                            ? (constraints.maxWidth - 24) / 3
                            : constraints.maxWidth,
                        child: _ModuleMetricCard(metric: metric),
                      ),
                    )
                    .toList(),
              );
            },
          ),
          const SizedBox(height: 20),
          ...sections.asMap().entries.map((entry) {
            final index = entry.key;
            final section = entry.value;
            return Padding(
              padding: EdgeInsets.only(
                  bottom: index == sections.length - 1 ? 0 : 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _ModuleSectionTitle(
                    title: section.title,
                    subtitle: section.subtitle,
                  ),
                  const SizedBox(height: 12),
                  ...section.items.map(
                    (item) => Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: _ModuleActionCard(
                        item: item,
                        actionLabel: section.actionLabel,
                      ),
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _ModuleSectionTitle extends StatelessWidget {
  const _ModuleSectionTitle({
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

class _ModuleMetricCard extends StatelessWidget {
  const _ModuleMetricCard({required this.metric});

  final _ModuleMetric metric;

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
  }
}

class _ModuleActionCard extends StatelessWidget {
  const _ModuleActionCard({
    required this.item,
    required this.actionLabel,
  });

  final _ModuleItem item;
  final String actionLabel;

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
                    final fn = item.onPressed;
                    if (fn != null) {
                      fn();
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

class _ModuleMetric {
  const _ModuleMetric(this.label, this.value, this.icon);

  final String label;
  final String value;
  final IconData icon;
}

class _ModuleItem {
  const _ModuleItem(
    this.title,
    this.subtitle,
    this.icon, {
    this.onPressed,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback? onPressed;
}

class _ModuleSection {
  const _ModuleSection({
    required this.title,
    required this.subtitle,
    required this.actionLabel,
    required this.items,
  });

  final String title;
  final String subtitle;
  final String actionLabel;
  final List<_ModuleItem> items;
}

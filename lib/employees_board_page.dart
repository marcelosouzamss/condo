import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

/// Quadro de colaboradores e escala. Gestão: síndico e administração.
/// Moradores e parceiros: só a lista. Colaboradores: lista + escala (leitura).
class EmployeesBoardPage extends StatefulWidget {
  const EmployeesBoardPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
  });

  final int condoId;
  final int userId;
  final String userRole;

  @override
  State<EmployeesBoardPage> createState() => _EmployeesBoardPageState();
}

class _EmployeesBoardPageState extends State<EmployeesBoardPage>
    with SingleTickerProviderStateMixin {
  TabController? _tabController;

  bool _loadingPeople = true;
  Object? _peopleError;
  List<Map<String, dynamic>> _people = [];

  bool _loadingShifts = true;
  Object? _shiftsError;
  List<Map<String, dynamic>> _shifts = [];

  /// Mês exibido no calendário da escala.
  DateTime _calendarMonth =
      DateTime(DateTime.now().year, DateTime.now().month);

  bool get _canManage =>
      CondoUserRoles.canManageCollaboratorsBoard(widget.userRole);

  bool get _showScheduleTab =>
      CondoUserRoles.canViewCollaboratorScheduleTab(widget.userRole);

  static const List<String> _mesesPt = [
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

  static String _isoFromYmd(int y, int m, int d) {
    final mm = m.toString().padLeft(2, '0');
    final dd = d.toString().padLeft(2, '0');
    return '$y-$mm-$dd';
  }

  static String _formatShiftDatePt(String? iso) {
    if (iso == null || iso.length < 10) {
      return iso ?? '';
    }
    final p = iso.substring(0, 10).split('-');
    if (p.length != 3) {
      return iso;
    }
    final y = int.tryParse(p[0]);
    final m = int.tryParse(p[1]);
    final d = int.tryParse(p[2]);
    if (y == null || m == null || d == null || m < 1 || m > 12) {
      return iso;
    }
    return '$d de ${_mesesPt[m - 1]} de $y';
  }

  static DateTime? _parseIsoLocal(String? s) {
    if (s == null || s.length < 10) {
      return null;
    }
    final p = s.substring(0, 10).split('-');
    if (p.length != 3) {
      return null;
    }
    final y = int.tryParse(p[0]);
    final m = int.tryParse(p[1]);
    final d = int.tryParse(p[2]);
    if (y == null || m == null || d == null) {
      return null;
    }
    return DateTime(y, m, d);
  }

  static int _daysInMonth(int year, int month) =>
      DateTime(year, month + 1, 0).day;

  Map<String, List<Map<String, dynamic>>> _shiftsByDateInMonth(
    DateTime month,
  ) {
    final prefix =
        '${month.year.toString().padLeft(4, '0')}-${month.month.toString().padLeft(2, '0')}';
    final map = <String, List<Map<String, dynamic>>>{};
    for (final s in _shifts) {
      final raw = s['shift_date'];
      final str = raw is String ? raw : '$raw';
      if (str.length < 10) {
        continue;
      }
      final key = str.substring(0, 10);
      if (key.startsWith(prefix)) {
        map.putIfAbsent(key, () => []).add(s);
      }
    }
    return map;
  }

  static String _apiMessage(http.Response r) {
    try {
      final decoded = jsonDecode(r.body);
      if (decoded is Map && decoded['message'] is String) {
        return decoded['message'] as String;
      }
    } catch (_) {
      /* ignore */
    }
    return 'Erro ${r.statusCode}';
  }

  @override
  void initState() {
    super.initState();
    if (_showScheduleTab) {
      _tabController = TabController(length: 2, vsync: this);
      _tabController!.addListener(_onTabTick);
    }
    _loadCollaborators();
    if (_showScheduleTab) {
      _loadSchedule();
    }
  }

  void _onTabTick() {
    final c = _tabController;
    if (c == null || c.indexIsChanging) {
      return;
    }
    setState(() {});
  }

  @override
  void dispose() {
    _tabController?.removeListener(_onTabTick);
    _tabController?.dispose();
    super.dispose();
  }

  Future<void> _loadCollaborators() async {
    setState(() {
      _loadingPeople = true;
      _peopleError = null;
    });
    try {
      final q = <String, String>{
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
        if (_canManage) 'includeInactive': 'true',
      };
      final r = await http.get(CondoApi.uri('/api/collaborators', q));
      if (r.statusCode != 200) {
        throw Exception(_apiMessage(r));
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      final parsed =
          list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      if (!mounted) {
        return;
      }
      setState(() {
        _people = parsed;
        _loadingPeople = false;
      });
    } catch (e) {
      if (!mounted) {
        return;
      }
      setState(() {
        _peopleError = e;
        _loadingPeople = false;
      });
    }
  }

  Future<void> _loadSchedule() async {
    setState(() {
      _loadingShifts = true;
      _shiftsError = null;
    });
    try {
      final r = await http.get(
        CondoApi.uri('/api/collaborators/schedule', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        }),
      );
      if (r.statusCode != 200) {
        throw Exception(_apiMessage(r));
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      final parsed =
          list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      if (!mounted) {
        return;
      }
      setState(() {
        _shifts = parsed;
        _loadingShifts = false;
      });
    } catch (e) {
      if (!mounted) {
        return;
      }
      setState(() {
        _shiftsError = e;
        _loadingShifts = false;
      });
    }
  }

  Future<void> _reloadAll() async {
    await _loadCollaborators();
    if (_showScheduleTab) {
      await _loadSchedule();
    }
  }

  Widget? get _fab {
    if (!_canManage) {
      return null;
    }
    final idx = _tabController?.index ?? 0;
    if (!_showScheduleTab || idx == 0) {
      return FloatingActionButton.extended(
        onPressed: () => _openCollaboratorSheet(),
        icon: const Icon(Icons.person_add_rounded),
        label: const Text('Colaborador'),
      );
    }
    return FloatingActionButton.extended(
      onPressed: () => _openShiftSheet(),
      icon: const Icon(Icons.more_time_rounded),
      label: const Text('Turno'),
    );
  }

  @override
  Widget build(BuildContext context) {
    final appBar = AppBar(
      title: const Text('Quadro de Colaboradores'),
      actions: [
        IconButton(
          tooltip: 'Atualizar',
          onPressed: _reloadAll,
          icon: const Icon(Icons.refresh_rounded),
        ),
      ],
      bottom: _showScheduleTab && _tabController != null
          ? TabBar(
              controller: _tabController,
              labelColor: Colors.white,
              unselectedLabelColor: Colors.white.withValues(alpha: 0.82),
              indicatorColor: Colors.white,
              indicatorWeight: 3,
              tabs: const [
                Tab(text: 'Colaboradores'),
                Tab(text: 'Escala'),
              ],
            )
          : null,
    );

    final body = _showScheduleTab && _tabController != null
        ? TabBarView(
            controller: _tabController,
            children: [
              _collaboratorsTab(),
              _scheduleTab(),
            ],
          )
        : _collaboratorsTab();

    return Scaffold(
      appBar: appBar,
      body: body,
      floatingActionButton: _fab,
    );
  }

  Widget _collaboratorsTab() {
    if (_loadingPeople) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_peopleError != null) {
      return _errorState(_peopleError!, _loadCollaborators);
    }
    if (_people.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _canManage
                ? 'Nenhum colaborador cadastrado. Toque em «Colaborador» para incluir.'
                : 'Nenhum colaborador cadastrado no momento.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyLarge,
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadCollaborators,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _people.length,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (context, i) {
          final p = _people[i];
          final id = (p['id'] as num).toInt();
          final name = p['full_name'] as String? ?? '';
          final job = p['job_title'] as String? ?? '';
          final phone = p['phone'] as String?;
          final email = p['email'] as String?;
          final notes = p['notes'] as String?;
          final photo = p['photo_url'] as String?;
          final active = p['active'] != false;

          final avatar = CircleAvatar(
            radius: 28,
            backgroundColor:
                Theme.of(context).colorScheme.primaryContainer,
            foregroundImage: photo != null && photo.isNotEmpty
                ? NetworkImage(CondoApi.uploadsUrl(photo))
                : null,
            child: photo == null || photo.isEmpty
                ? Text(
                    name.isNotEmpty ? name[0].toUpperCase() : '?',
                    style: const TextStyle(fontSize: 22),
                  )
                : null,
          );

          return Card(
            clipBehavior: Clip.antiAlias,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 4, 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  avatar,
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Text(
                                name,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 16,
                                ),
                              ),
                            ),
                            if (!active)
                              Padding(
                                padding: const EdgeInsets.only(left: 8),
                                child: Chip(
                                  label: const Text('Inativo'),
                                  visualDensity: VisualDensity.compact,
                                  materialTapTargetSize:
                                      MaterialTapTargetSize.shrinkWrap,
                                  labelStyle:
                                      const TextStyle(fontSize: 11),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(job),
                        if (phone != null && phone.isNotEmpty)
                          Text('Tel. $phone'),
                        if (email != null && email.isNotEmpty) Text(email),
                        if (notes != null && notes.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(
                              notes,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Theme.of(context)
                                    .colorScheme
                                    .outline,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (_canManage)
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          tooltip: 'Editar',
                          icon: const Icon(Icons.edit_rounded),
                          onPressed: () => _openCollaboratorSheet(existing: p),
                        ),
                        IconButton(
                          tooltip: 'Excluir',
                          icon: Icon(
                            Icons.delete_outline_rounded,
                            color: Theme.of(context).colorScheme.error,
                          ),
                          onPressed: () =>
                              _confirmDeleteCollaborator(id, name),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _scheduleTab() {
    if (_loadingShifts) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_shiftsError != null) {
      return _errorState(_shiftsError!, _loadSchedule);
    }

    final theme = Theme.of(context);
    final byDate = _shiftsByDateInMonth(_calendarMonth);
    final first = DateTime(_calendarMonth.year, _calendarMonth.month, 1);
    final lastDay = _daysInMonth(_calendarMonth.year, _calendarMonth.month);
    final lead = first.weekday % 7;
    final rowCount = (lead + lastDay + 6) ~/ 7;
    final cellCount = rowCount * 7;

    return RefreshIndicator(
      onRefresh: _loadSchedule,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(child: _scheduleCalendarHeader()),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
              child: Row(
                children: [
                  for (final w in const [
                    'Dom',
                    'Seg',
                    'Ter',
                    'Qua',
                    'Qui',
                    'Sex',
                    'Sáb',
                  ])
                    Expanded(
                      child: Text(
                        w,
                        textAlign: TextAlign.center,
                        style: theme.textTheme.labelSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            sliver: SliverGrid(
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 7,
                mainAxisSpacing: 6,
                crossAxisSpacing: 6,
                childAspectRatio: 1.05,
              ),
              delegate: SliverChildBuilderDelegate(
                (context, index) {
                  if (index < lead) {
                    return const SizedBox.shrink();
                  }
                  final day = index - lead + 1;
                  if (day > lastDay) {
                    return const SizedBox.shrink();
                  }
                  final iso = _isoFromYmd(
                    _calendarMonth.year,
                    _calendarMonth.month,
                    day,
                  );
                  final dayShifts = byDate[iso] ?? [];
                  final has = dayShifts.isNotEmpty;
                  return Material(
                    color: has
                        ? theme.colorScheme.primaryContainer
                            .withValues(alpha: 0.45)
                        : theme.colorScheme.surfaceContainerHighest
                            .withValues(alpha: 0.35),
                    borderRadius: BorderRadius.circular(10),
                    clipBehavior: Clip.antiAlias,
                    child: InkWell(
                      onTap: () {
                        if (dayShifts.isEmpty) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                _canManage
                                    ? 'Sem turnos em ${_formatShiftDatePt(iso)}. Use «Turno» para cadastrar.'
                                    : 'Sem turnos neste dia.',
                              ),
                            ),
                          );
                          return;
                        }
                        _showDayShiftsSheet(iso, dayShifts);
                      },
                      child: Padding(
                        padding: const EdgeInsets.all(4),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              '$day',
                              style: theme.textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            if (has)
                              Text(
                                '${dayShifts.length}',
                                style: theme.textTheme.labelSmall?.copyWith(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
                childCount: cellCount,
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Turnos neste mês',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (_shifts.isEmpty)
                    Text(
                      _canManage
                          ? 'Nenhum turno cadastrado. Toque em «Turno».'
                          : 'Nenhum turno cadastrado.',
                      style: theme.textTheme.bodyMedium,
                    )
                  else ...[
                    Text(
                      '${byDate.values.fold<int>(0, (a, b) => a + b.length)} turno(s) em ${_mesesPt[_calendarMonth.month - 1]} ${_calendarMonth.year}',
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: 12),
                    ...(() {
                      final inMonth = _shifts.where((s) {
                        final str = s['shift_date'] is String
                            ? s['shift_date'] as String
                            : '${s['shift_date']}';
                        if (str.length < 10) {
                          return false;
                        }
                        return str.startsWith(
                          '${_calendarMonth.year.toString().padLeft(4, '0')}-${_calendarMonth.month.toString().padLeft(2, '0')}',
                        );
                      }).toList()
                        ..sort((a, b) {
                          final sa =
                              '${a['shift_date']}'.substring(0, 10);
                          final sb =
                              '${b['shift_date']}'.substring(0, 10);
                          return sa.compareTo(sb);
                        });
                      if (inMonth.isEmpty) {
                        return [
                          Text(
                            'Nenhum turno neste mês selecionado.',
                            style: theme.textTheme.bodyMedium,
                          ),
                        ];
                      }
                      return inMonth
                          .map((s) => _shiftTile(s))
                          .toList();
                    })(),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _scheduleCalendarHeader() {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Mês anterior',
            onPressed: () {
              setState(() {
                _calendarMonth =
                    DateTime(_calendarMonth.year, _calendarMonth.month - 1);
              });
            },
            icon: const Icon(Icons.chevron_left_rounded),
          ),
          Expanded(
            child: Text(
              '${_mesesPt[_calendarMonth.month - 1]} ${_calendarMonth.year}',
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          IconButton(
            tooltip: 'Próximo mês',
            onPressed: () {
              setState(() {
                _calendarMonth =
                    DateTime(_calendarMonth.year, _calendarMonth.month + 1);
              });
            },
            icon: const Icon(Icons.chevron_right_rounded),
          ),
        ],
      ),
    );
  }

  void _showDayShiftsSheet(String iso, List<Map<String, dynamic>> items) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) {
        final h = MediaQuery.sizeOf(ctx).height * 0.55;
        return SafeArea(
          child: SizedBox(
            height: h,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                  child: Text(
                    _formatShiftDatePt(iso),
                    style: Theme.of(ctx).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                ),
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(8, 0, 8, 16),
                    children:
                        items.map((e) => _shiftTile(e)).toList(),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _shiftTile(Map<String, dynamic> s) {
    final id = (s['id'] as num).toInt();
    final name = s['collaborator_name'] as String? ?? '';
    final job = s['collaborator_job_title'] as String? ?? '';
    final isoRaw = s['shift_date'];
    final str = isoRaw is String ? isoRaw : '$isoRaw';
    final iso = str.length >= 10 ? str.substring(0, 10) : str;
    final ts = (s['time_start'] as String?)?.trim();
    final te = (s['time_end'] as String?)?.trim();
    final notes = s['notes'] as String?;
    final horario = () {
      if (ts != null && ts.isNotEmpty && te != null && te.isNotEmpty) {
        return 'Horário: $ts — $te';
      }
      if (ts != null && ts.isNotEmpty) {
        return 'Início: $ts';
      }
      if (te != null && te.isNotEmpty) {
        return 'Fim: $te';
      }
      return null;
    }();

    final scheme = Theme.of(context).colorScheme;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _formatShiftDatePt(iso.length >= 10 ? iso : null),
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                      color: scheme.primary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    name,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(job),
                  if (horario != null) Text(horario),
                  if (notes != null && notes.isNotEmpty) Text(notes),
                ],
              ),
            ),
            if (_canManage)
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    tooltip: 'Editar',
                    icon: const Icon(Icons.edit_rounded),
                    onPressed: () {
                      Navigator.of(context).maybePop();
                      _openShiftSheet(existing: s);
                    },
                  ),
                  IconButton(
                    tooltip: 'Excluir',
                    icon: Icon(
                      Icons.delete_outline_rounded,
                      color: scheme.error,
                    ),
                    onPressed: () {
                      Navigator.of(context).maybePop();
                      _confirmDeleteShift(
                        id,
                        name,
                        _formatShiftDatePt(iso.length >= 10 ? iso : null),
                      );
                    },
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _errorState(Object err, VoidCallback retry) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.error_outline_rounded,
              size: 48,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 12),
            Text(
              '$err',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: retry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Tentar novamente'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openCollaboratorSheet({Map<String, dynamic>? existing}) async {
    final nameCtrl = TextEditingController(
      text: existing?['full_name'] as String? ?? '',
    );
    final jobCtrl = TextEditingController(
      text: existing?['job_title'] as String? ?? '',
    );
    final phoneCtrl = TextEditingController(
      text: existing?['phone'] as String? ?? '',
    );
    final emailCtrl = TextEditingController(
      text: existing?['email'] as String? ?? '',
    );
    final photoCtrl = TextEditingController(
      text: existing?['photo_url'] as String? ?? '',
    );
    final notesCtrl = TextEditingController(
      text: existing?['notes'] as String? ?? '',
    );
    final sortCtrl = TextEditingController(
      text: '${existing?['sort_order'] ?? 0}',
    );
    var active = existing?['active'] != false;

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            left: 16,
            right: 16,
            top: 16,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
          ),
          child: StatefulBuilder(
            builder: (ctx, setLocal) {
              return SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      existing == null ? 'Novo colaborador' : 'Editar colaborador',
                      style: Theme.of(ctx).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: nameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Nome completo *',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: jobCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Função / cargo *',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: phoneCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Telefone',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: emailCtrl,
                      decoration: const InputDecoration(
                        labelText: 'E-mail',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.emailAddress,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: photoCtrl,
                      decoration: const InputDecoration(
                        labelText: 'URL da foto',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: notesCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Observações',
                        border: OutlineInputBorder(),
                      ),
                      maxLines: 2,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: sortCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Ordem na lista',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.number,
                    ),
                    if (existing != null) ...[
                      const SizedBox(height: 12),
                      SwitchListTile(
                        title: const Text('Ativo no quadro'),
                        value: active,
                        onChanged: (v) => setLocal(() => active = v),
                      ),
                    ],
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: Text(existing == null ? 'Salvar' : 'Atualizar'),
                    ),
                  ],
                ),
              );
            },
          ),
        );
      },
    );

    if (ok != true || !mounted) {
      return;
    }

    final sortOrder = int.tryParse(sortCtrl.text.trim()) ?? 0;
    final body = <String, dynamic>{
      'condoId': widget.condoId,
      'userId': widget.userId,
      'fullName': nameCtrl.text.trim(),
      'jobTitle': jobCtrl.text.trim(),
      'phone': phoneCtrl.text.trim(),
      'email': emailCtrl.text.trim(),
      'photoUrl': photoCtrl.text.trim(),
      'notes': notesCtrl.text.trim(),
      'sortOrder': sortOrder,
      if (existing != null) 'active': active,
    };

    if (body['fullName'] == '' || body['jobTitle'] == '') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Preencha nome e função.')),
      );
      return;
    }

    try {
      http.Response r;
      if (existing == null) {
        r = await http.post(
          CondoApi.uri('/api/collaborators'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        );
      } else {
        final id = (existing['id'] as num).toInt();
        r = await http.patch(
          CondoApi.uri('/api/collaborators/$id'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        );
      }
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200 && r.statusCode != 201) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_apiMessage(r))),
        );
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(existing == null ? 'Colaborador criado.' : 'Alterações salvas.'),
        ),
      );
      await _loadCollaborators();
      if (_showScheduleTab) {
        await _loadSchedule();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$e')),
        );
      }
    }
  }

  Future<void> _confirmDeleteCollaborator(int id, String name) async {
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir colaborador'),
        content: Text('Remover «$name» do quadro? Os turnos da escala ligados a ele também serão removidos.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
    if (go != true || !mounted) {
      return;
    }
    try {
      final r = await http.delete(
        CondoApi.uri('/api/collaborators/$id', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 204 && r.statusCode != 200) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_apiMessage(r))),
        );
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Colaborador removido.')),
      );
      await _loadCollaborators();
      if (_showScheduleTab) {
        await _loadSchedule();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$e')),
        );
      }
    }
  }

  List<Map<String, dynamic>> get _activePeopleForShift =>
      _people.where((p) => p['active'] != false).toList();

  Future<void> _openShiftSheet({Map<String, dynamic>? existing}) async {
    final activePeople = _activePeopleForShift;
    if (activePeople.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Cadastre ao menos um colaborador ativo antes da escala.'),
        ),
      );
      return;
    }

    int collaboratorId = existing != null
        ? (existing['collaborator_id'] as num).toInt()
        : (activePeople.first['id'] as num).toInt();
    if (!activePeople.any((p) => (p['id'] as num).toInt() == collaboratorId)) {
      collaboratorId = (activePeople.first['id'] as num).toInt();
    }

    final now = DateTime.now();
    final existingDt =
        _parseIsoLocal(existing?['shift_date'] as String?) ?? now;

    int selYear = existing != null ? existingDt.year : now.year;
    int selMonth = existing != null ? existingDt.month : now.month;
    final selectedDays = <int>{
      if (existing != null) existingDt.day,
    };

    int editYear = existingDt.year;
    int editMonth = existingDt.month;
    int editDay = existingDt.day;

    final timeStartCtrl = TextEditingController(
      text: (existing?['time_start'] as String?)?.trim() ?? '',
    );
    final timeEndCtrl = TextEditingController(
      text: (existing?['time_end'] as String?)?.trim() ?? '',
    );
    final notesCtrl = TextEditingController(
      text: existing?['notes'] as String? ?? '',
    );
    final sortCtrl = TextEditingController(
      text: '${existing?['sort_order'] ?? 0}',
    );

    final yearChoices = [
      for (var y = now.year - 2; y <= now.year + 6; y++) y,
    ];

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            left: 16,
            right: 16,
            top: 16,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
          ),
          child: StatefulBuilder(
            builder: (ctx, setLocal) {
              void bumpYM({required bool next}) {
                setLocal(() {
                  var y = selYear;
                  var m = selMonth + (next ? 1 : -1);
                  if (m > 12) {
                    m = 1;
                    y++;
                  } else if (m < 1) {
                    m = 12;
                    y--;
                  }
                  selYear = y;
                  selMonth = m;
                  final cap = _daysInMonth(selYear, selMonth);
                  selectedDays.removeWhere((d) => d > cap);
                });
              }

              final daysCap =
                  existing == null ? _daysInMonth(selYear, selMonth) : 31;

              return SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      existing == null ? 'Novo turno' : 'Editar turno',
                      style: Theme.of(ctx).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<int>(
                      value: collaboratorId,
                      decoration: const InputDecoration(
                        labelText: 'Colaborador',
                        border: OutlineInputBorder(),
                      ),
                      items: [
                        for (final p in activePeople)
                          DropdownMenuItem(
                            value: (p['id'] as num).toInt(),
                            child: Text(p['full_name'] as String? ?? ''),
                          ),
                      ],
                      onChanged: (v) =>
                          setLocal(() => collaboratorId = v ?? collaboratorId),
                    ),
                    const SizedBox(height: 16),
                    if (existing == null) ...[
                      Text(
                        'Mês e ano',
                        style: Theme.of(ctx).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          IconButton(
                            onPressed: () => bumpYM(next: false),
                            icon: const Icon(Icons.chevron_left_rounded),
                          ),
                          Expanded(
                            child: DropdownButtonFormField<int>(
                              value: selMonth,
                              decoration: const InputDecoration(
                                labelText: 'Mês',
                                border: OutlineInputBorder(),
                                isDense: true,
                              ),
                              items: [
                                for (var m = 1; m <= 12; m++)
                                  DropdownMenuItem(
                                    value: m,
                                    child: Text(_mesesPt[m - 1]),
                                  ),
                              ],
                              onChanged: (v) {
                                setLocal(() {
                                  selMonth = v ?? selMonth;
                                  final cap = _daysInMonth(selYear, selMonth);
                                  selectedDays.removeWhere((d) => d > cap);
                                });
                              },
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: DropdownButtonFormField<int>(
                              value: selYear,
                              decoration: const InputDecoration(
                                labelText: 'Ano',
                                border: OutlineInputBorder(),
                                isDense: true,
                              ),
                              items: [
                                for (final y in yearChoices)
                                  DropdownMenuItem(
                                    value: y,
                                    child: Text('$y'),
                                  ),
                              ],
                              onChanged: (v) {
                                setLocal(() {
                                  selYear = v ?? selYear;
                                  final cap = _daysInMonth(selYear, selMonth);
                                  selectedDays.removeWhere((d) => d > cap);
                                });
                              },
                            ),
                          ),
                          IconButton(
                            onPressed: () => bumpYM(next: true),
                            icon: const Icon(Icons.chevron_right_rounded),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'Dias com turno (${_mesesPt[selMonth - 1]} $selYear)',
                        style: Theme.of(ctx).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          for (var d = 1; d <= daysCap; d++)
                            FilterChip(
                              label: Text('$d'),
                              selected: selectedDays.contains(d),
                              showCheckmark: true,
                              onSelected: (sel) {
                                setLocal(() {
                                  if (sel) {
                                    selectedDays.add(d);
                                  } else {
                                    selectedDays.remove(d);
                                  }
                                });
                              },
                            ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Selecione um ou mais dias neste mês.',
                        style: Theme.of(ctx).textTheme.bodySmall,
                      ),
                    ] else ...[
                      Text(
                        'Data do turno',
                        style: Theme.of(ctx).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: DropdownButtonFormField<int>(
                              value: editDay,
                              decoration: const InputDecoration(
                                labelText: 'Dia',
                                border: OutlineInputBorder(),
                                isDense: true,
                              ),
                              items: [
                                for (var d = 1;
                                    d <= _daysInMonth(editYear, editMonth);
                                    d++)
                                  DropdownMenuItem(
                                    value: d,
                                    child: Text('$d'),
                                  ),
                              ],
                              onChanged: (v) =>
                                  setLocal(() => editDay = v ?? editDay),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            flex: 2,
                            child: DropdownButtonFormField<int>(
                              value: editMonth,
                              decoration: const InputDecoration(
                                labelText: 'Mês',
                                border: OutlineInputBorder(),
                                isDense: true,
                              ),
                              items: [
                                for (var m = 1; m <= 12; m++)
                                  DropdownMenuItem(
                                    value: m,
                                    child: Text(_mesesPt[m - 1]),
                                  ),
                              ],
                              onChanged: (v) {
                                setLocal(() {
                                  editMonth = v ?? editMonth;
                                  final cap =
                                      _daysInMonth(editYear, editMonth);
                                  if (editDay > cap) {
                                    editDay = cap;
                                  }
                                });
                              },
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: DropdownButtonFormField<int>(
                              value: editYear,
                              decoration: const InputDecoration(
                                labelText: 'Ano',
                                border: OutlineInputBorder(),
                                isDense: true,
                              ),
                              items: [
                                for (final y in yearChoices)
                                  DropdownMenuItem(
                                    value: y,
                                    child: Text('$y'),
                                  ),
                              ],
                              onChanged: (v) {
                                setLocal(() {
                                  editYear = v ?? editYear;
                                  final cap =
                                      _daysInMonth(editYear, editMonth);
                                  if (editDay > cap) {
                                    editDay = cap;
                                  }
                                });
                              },
                            ),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: 16),
                    TextField(
                      controller: timeStartCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Horário de início (ex.: 08:00)',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: timeEndCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Horário de fim (ex.: 17:00)',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: notesCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Observações',
                        border: OutlineInputBorder(),
                      ),
                      maxLines: 2,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: sortCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Ordem no dia',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.number,
                    ),
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: Text(existing == null ? 'Salvar' : 'Atualizar'),
                    ),
                  ],
                ),
              );
            },
          ),
        );
      },
    );

    if (ok != true || !mounted) {
      return;
    }

    if (existing == null && selectedDays.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Selecione ao menos um dia.')),
      );
      return;
    }

    final sortOrder = int.tryParse(sortCtrl.text.trim()) ?? 0;
    final ts = timeStartCtrl.text.trim();
    final te = timeEndCtrl.text.trim();

    try {
      http.Response r;
      if (existing == null) {
        final shiftDates = selectedDays.map((d) {
          return _isoFromYmd(selYear, selMonth, d);
        }).toList()
          ..sort();
        final body = <String, dynamic>{
          'condoId': widget.condoId,
          'userId': widget.userId,
          'collaboratorId': collaboratorId,
          'shiftDates': shiftDates,
          'timeStart': ts,
          'timeEnd': te,
          'notes': notesCtrl.text.trim(),
          'sortOrder': sortOrder,
        };
        r = await http.post(
          CondoApi.uri('/api/collaborators/schedule'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        );
      } else {
        final body = <String, dynamic>{
          'condoId': widget.condoId,
          'userId': widget.userId,
          'collaboratorId': collaboratorId,
          'shiftDate': _isoFromYmd(editYear, editMonth, editDay),
          'timeStart': ts,
          'timeEnd': te,
          'notes': notesCtrl.text.trim(),
          'sortOrder': sortOrder,
        };
        final sid = (existing['id'] as num).toInt();
        r = await http.patch(
          CondoApi.uri('/api/collaborators/schedule/$sid'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        );
      }
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200 && r.statusCode != 201) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_apiMessage(r))),
        );
        return;
      }
      final createdCount = existing == null
          ? (((jsonDecode(r.body) as Map<String, dynamic>)['shifts']
                      as List<dynamic>?)
                  ?.length ??
              0)
          : 1;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            existing == null
                ? (createdCount > 1
                    ? '$createdCount turnos incluídos na escala.'
                    : 'Turno incluído na escala.')
                : 'Escala atualizada.',
          ),
        ),
      );
      await _loadSchedule();
      if (existing == null && mounted) {
        setState(() {
          _calendarMonth = DateTime(selYear, selMonth);
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$e')),
        );
      }
    }
  }

  Future<void> _confirmDeleteShift(int shiftId, String name, String day) async {
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir turno'),
        content: Text('Remover o turno de «$name» em $day?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
    if (go != true || !mounted) {
      return;
    }
    try {
      final r = await http.delete(
        CondoApi.uri('/api/collaborators/schedule/$shiftId', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 204 && r.statusCode != 200) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_apiMessage(r))),
        );
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Turno removido.')),
      );
      await _loadSchedule();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$e')),
        );
      }
    }
  }
}

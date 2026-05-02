import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

/// Calendário de eventos do condomínio (`GET /api/agenda/events?view=calendar`).
/// **Cadastro / edição / exclusão:** apenas síndico e administração (`isBillingStaff`).
/// Demais perfis apenas visualizam (eventos públicos; privados só para síndico/admin na API).
class EventsCalendarPage extends StatefulWidget {
  const EventsCalendarPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
  });

  final int condoId;
  final int userId;
  final String userRole;

  @override
  State<EventsCalendarPage> createState() => _EventsCalendarPageState();
}

class _EventsCalendarPageState extends State<EventsCalendarPage> {
  late DateTime _month;
  bool _loading = true;
  Object? _loadError;
  List<Map<String, dynamic>> _events = [];

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

  bool get _canManage => CondoUserRoles.isBillingStaff(widget.userRole);

  @override
  void initState() {
    super.initState();
    final n = DateTime.now();
    _month = DateTime(n.year, n.month);
    _reload();
  }

  static String _apiMessage(http.Response r) {
    try {
      final decoded = jsonDecode(r.body);
      if (decoded is Map && decoded['message'] is String) {
        return decoded['message'] as String;
      }
    } catch (_) {}
    return 'Erro ${r.statusCode}';
  }

  static int _daysInMonth(int y, int m) => DateTime(y, m + 1, 0).day;

  static String _isoFromYmd(int y, int m, int d) =>
      '${y.toString().padLeft(4, '0')}-'
      '${m.toString().padLeft(2, '0')}-'
      '${d.toString().padLeft(2, '0')}';

  static DateTime _dateOnlyLocal(dynamic raw) {
    final dt = DateTime.parse(raw.toString()).toLocal();
    return DateTime(dt.year, dt.month, dt.day);
  }

  Map<String, List<Map<String, dynamic>>> _eventsByDayInMonth() {
    final y = _month.year;
    final m = _month.month;
    final map = <String, List<Map<String, dynamic>>>{};
    for (final e in _events) {
      final start = _dateOnlyLocal(e['event_date']);
      final endRaw = e['event_end'];
      final end =
          endRaw != null ? _dateOnlyLocal(endRaw) : _dateOnlyLocal(e['event_date']);
      var d = start;
      while (!d.isAfter(end)) {
        if (d.year == y && d.month == m) {
          final key = _isoFromYmd(y, m, d.day);
          map.putIfAbsent(key, () => []).add(e);
        }
        d = d.add(const Duration(days: 1));
      }
    }
    for (final entry in map.entries) {
      entry.value.sort((a, b) {
        final da = DateTime.parse(a['event_date'].toString());
        final db = DateTime.parse(b['event_date'].toString());
        return da.compareTo(db);
      });
    }
    return map;
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final uri = CondoApi.uri('/api/agenda/events', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
        'view': 'calendar',
        'year': '${_month.year}',
        'month': '${_month.month}',
      });
      final r = await http.get(uri);
      if (r.statusCode != 200) {
        throw Exception(_apiMessage(r));
      }
      final body = jsonDecode(r.body) as Map<String, dynamic>;
      final raw = body['events'] as List<dynamic>? ?? [];
      final parsed =
          raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      if (!mounted) {
        return;
      }
      setState(() {
        _events = parsed;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loadError = e;
        _loading = false;
      });
    }
  }

  void _shiftMonth(int delta) {
    setState(() {
      _month = DateTime(_month.year, _month.month + delta);
    });
    _reload();
  }

  String _fmtDateTimePt(dynamic raw) {
    if (raw == null) {
      return '';
    }
    final dt = DateTime.parse(raw.toString()).toLocal();
    final dd = dt.day.toString().padLeft(2, '0');
    final mm = dt.month.toString().padLeft(2, '0');
    final hh = dt.hour.toString().padLeft(2, '0');
    final mi = dt.minute.toString().padLeft(2, '0');
    return '$dd/$mm/${dt.year} $hh:$mi';
  }

  Future<void> _deleteEvent(Map<String, dynamic> row) async {
    final id = (row['id'] as num).toInt();
    final title = row['title'] as String? ?? '';
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir evento'),
        content: Text('Remover «$title»?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
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
        CondoApi.uri('/api/agenda/events/$id', {
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
        const SnackBar(content: Text('Evento removido.')),
      );
      await _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$e')),
        );
      }
    }
  }

  Future<void> _openEventEditor({
    Map<String, dynamic>? existing,
    DateTime? preferredDay,
  }) async {
    if (!_canManage) {
      return;
    }
    final isEdit = existing != null;
    final titleCtrl = TextEditingController(
      text: existing?['title'] as String? ?? '',
    );
    final descCtrl = TextEditingController(
      text: existing?['description'] as String? ?? '',
    );
    final locCtrl = TextEditingController(
      text: existing?['location'] as String? ?? '',
    );
    var visibility =
        (existing?['visibility'] as String?)?.toLowerCase() == 'private'
            ? 'private'
            : 'public';

    DateTime startDt;
    if (existing != null) {
      startDt = DateTime.parse(existing['event_date'].toString()).toLocal();
    } else {
      final base = preferredDay ?? DateTime.now();
      startDt = DateTime(base.year, base.month, base.day, 10, 0);
    }

    DateTime? endDt;
    if (existing?['event_end'] != null) {
      endDt = DateTime.parse(existing!['event_end'].toString()).toLocal();
    }
    var useEnd = endDt != null;

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            left: 16,
            right: 16,
            top: 8,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
          ),
          child: StatefulBuilder(
            builder: (ctx, setLocal) {
              Future<void> pickStart() async {
                final d = await showDatePicker(
                  context: ctx,
                  initialDate: DateTime(
                    startDt.year,
                    startDt.month,
                    startDt.day,
                  ),
                  firstDate: DateTime(_month.year - 2),
                  lastDate: DateTime(_month.year + 3, 12, 31),
                );
                if (d == null || !ctx.mounted) {
                  return;
                }
                final t = await showTimePicker(
                  context: ctx,
                  initialTime: TimeOfDay.fromDateTime(startDt),
                );
                if (t == null || !ctx.mounted) {
                  return;
                }
                setLocal(() {
                  startDt = DateTime(d.year, d.month, d.day, t.hour, t.minute);
                });
              }

              Future<void> pickEnd() async {
                final base = endDt ?? startDt.add(const Duration(hours: 1));
                final d = await showDatePicker(
                  context: ctx,
                  initialDate: DateTime(base.year, base.month, base.day),
                  firstDate: DateTime(_month.year - 2),
                  lastDate: DateTime(_month.year + 3, 12, 31),
                );
                if (d == null || !ctx.mounted) {
                  return;
                }
                final t = await showTimePicker(
                  context: ctx,
                  initialTime: TimeOfDay.fromDateTime(base),
                );
                if (t == null || !ctx.mounted) {
                  return;
                }
                setLocal(() {
                  endDt = DateTime(d.year, d.month, d.day, t.hour, t.minute);
                });
              }

              return SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      isEdit ? 'Editar evento' : 'Novo evento',
                      style: Theme.of(ctx).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: titleCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Título *',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: descCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Descrição',
                        border: OutlineInputBorder(),
                      ),
                      maxLines: 3,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: locCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Local',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: visibility,
                      decoration: const InputDecoration(
                        labelText: 'Visibilidade',
                        border: OutlineInputBorder(),
                      ),
                      items: const [
                        DropdownMenuItem(
                          value: 'public',
                          child: Text('Público (todos os moradores)'),
                        ),
                        DropdownMenuItem(
                          value: 'private',
                          child: Text('Privado (síndico e administração)'),
                        ),
                      ],
                      onChanged: (v) =>
                          setLocal(() => visibility = v ?? 'public'),
                    ),
                    const SizedBox(height: 12),
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Início'),
                      subtitle: Text(_fmtDateTimePt(startDt.toIso8601String())),
                      trailing: const Icon(Icons.edit_calendar_rounded),
                      onTap: pickStart,
                    ),
                    SwitchListTile(
                      title: const Text('Definir término'),
                      value: useEnd,
                      onChanged: (v) => setLocal(() {
                        useEnd = v;
                        if (!v) {
                          endDt = null;
                        } else {
                          endDt ??=
                              startDt.add(const Duration(hours: 1));
                        }
                      }),
                    ),
                    if (useEnd && endDt != null)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Término'),
                        subtitle: Text(_fmtDateTimePt(endDt!.toIso8601String())),
                        trailing: const Icon(Icons.edit_calendar_rounded),
                        onTap: pickEnd,
                      ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: Text(isEdit ? 'Salvar' : 'Publicar'),
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

    final title = titleCtrl.text.trim();
    if (title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe o título do evento.')),
      );
      return;
    }

    try {
      final body = <String, dynamic>{
        'condoId': widget.condoId,
        'userId': widget.userId,
        'title': title,
        'description': descCtrl.text.trim(),
        'location': locCtrl.text.trim(),
        'visibility': visibility,
        'eventDate': startDt.toUtc().toIso8601String(),
        if (useEnd && endDt != null)
          'eventEnd': endDt!.toUtc().toIso8601String()
        else if (isEdit && !useEnd)
          'eventEnd': null,
      };

      late http.Response r;
      if (isEdit) {
        final id = (existing['id'] as num).toInt();
        r = await http.patch(
          CondoApi.uri('/api/agenda/events/$id'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        );
      } else {
        r = await http.post(
          CondoApi.uri('/api/agenda/events'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        );
      }

      if (!mounted) {
        return;
      }
      if ((isEdit && r.statusCode != 200) ||
          (!isEdit && r.statusCode != 201)) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_apiMessage(r))),
        );
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(isEdit ? 'Evento atualizado.' : 'Evento criado.'),
        ),
      );
      await _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$e')),
        );
      }
    }
  }

  void _showDaySheet(String iso, List<Map<String, dynamic>> dayEvents) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                iso,
                style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
              const SizedBox(height: 12),
              if (dayEvents.isEmpty) ...[
                Text(
                  'Nenhum evento neste dia.',
                  style: Theme.of(ctx).textTheme.bodyMedium,
                ),
                if (_canManage) ...[
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: () {
                      Navigator.pop(ctx);
                      final parts = iso.split('-');
                      if (parts.length == 3) {
                        final y = int.tryParse(parts[0]);
                        final m = int.tryParse(parts[1]);
                        final d = int.tryParse(parts[2]);
                        if (y != null && m != null && d != null) {
                          _openEventEditor(
                            preferredDay: DateTime(y, m, d),
                          );
                        }
                      }
                    },
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Novo evento neste dia'),
                  ),
                ],
              ] else
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.sizeOf(ctx).height * 0.55,
                  ),
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: dayEvents.length,
                    separatorBuilder: (_, __) => const Divider(height: 20),
                    itemBuilder: (_, i) {
                      final e = dayEvents[i];
                      final title = e['title'] as String? ?? '';
                      final loc = e['location'] as String?;
                      final desc = e['description'] as String?;
                      final vis = e['visibility'] as String? ?? 'public';
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Text(
                                  title,
                                  style: Theme.of(ctx)
                                      .textTheme
                                      .titleSmall
                                      ?.copyWith(fontWeight: FontWeight.w800),
                                ),
                              ),
                              if (_canManage) ...[
                                IconButton(
                                  tooltip: 'Editar',
                                  icon: const Icon(Icons.edit_rounded, size: 20),
                                  onPressed: () {
                                    Navigator.pop(ctx);
                                    _openEventEditor(existing: e);
                                  },
                                ),
                                IconButton(
                                  tooltip: 'Excluir',
                                  icon: Icon(
                                    Icons.delete_outline_rounded,
                                    size: 20,
                                    color: Theme.of(ctx).colorScheme.error,
                                  ),
                                  onPressed: () {
                                    Navigator.pop(ctx);
                                    _deleteEvent(e);
                                  },
                                ),
                              ],
                            ],
                          ),
                          Text(
                            _fmtDateTimePt(e['event_date']),
                            style: Theme.of(ctx).textTheme.labelMedium?.copyWith(
                                  color: Theme.of(ctx).colorScheme.primary,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                          if (vis == 'private')
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Chip(
                                label: const Text('Privado'),
                                visualDensity: VisualDensity.compact,
                                padding: EdgeInsets.zero,
                                materialTapTargetSize:
                                    MaterialTapTargetSize.shrinkWrap,
                              ),
                            ),
                          if (loc != null && loc.trim().isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 6),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Icon(
                                    Icons.place_outlined,
                                    size: 18,
                                    color: Theme.of(ctx).colorScheme.outline,
                                  ),
                                  const SizedBox(width: 6),
                                  Expanded(child: Text(loc)),
                                ],
                              ),
                            ),
                          if (desc != null && desc.trim().isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(desc),
                            ),
                        ],
                      );
                    },
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _calendarGrid(ThemeData theme, ColorScheme cs) {
    final byDate = _eventsByDayInMonth();
    final first = DateTime(_month.year, _month.month, 1);
    final lastDay = _daysInMonth(_month.year, _month.month);
    final lead = first.weekday % 7;
    final rowCount = (lead + lastDay + 6) ~/ 7;
    final cellCount = rowCount * 7;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 4, 8),
          child: Row(
            children: [
              IconButton(
                tooltip: 'Mês anterior',
                onPressed: _loading ? null : () => _shiftMonth(-1),
                icon: const Icon(Icons.chevron_left_rounded),
              ),
              Expanded(
                child: Text(
                  '${_mesesPt[_month.month - 1]} ${_month.year}',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Próximo mês',
                onPressed: _loading ? null : () => _shiftMonth(1),
                icon: const Icon(Icons.chevron_right_rounded),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
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
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 7,
            mainAxisSpacing: 6,
            crossAxisSpacing: 6,
            childAspectRatio: 1.05,
          ),
          itemCount: cellCount,
          itemBuilder: (context, index) {
            if (index < lead) {
              return const SizedBox.shrink();
            }
            final day = index - lead + 1;
            if (day > lastDay) {
              return const SizedBox.shrink();
            }
            final iso =
                _isoFromYmd(_month.year, _month.month, day);
            final dayEv = byDate[iso] ?? [];
            final has = dayEv.isNotEmpty;
            final today = DateTime.now();
            final isToday = today.year == _month.year &&
                today.month == _month.month &&
                today.day == day;

            return Material(
              color: has
                  ? cs.primaryContainer.withValues(alpha: 0.42)
                  : cs.surfaceContainerHighest.withValues(alpha: 0.35),
              borderRadius: BorderRadius.circular(10),
              elevation: isToday ? 1 : 0,
              shadowColor: cs.primary.withValues(alpha: 0.35),
              child: InkWell(
                borderRadius: BorderRadius.circular(10),
                onTap: () => _showDaySheet(iso, dayEv),
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            '$day',
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w800,
                              color: isToday ? cs.primary : null,
                            ),
                          ),
                          if (has)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: cs.primary.withValues(alpha: 0.22),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                '${dayEv.length}',
                                style: theme.textTheme.labelSmall?.copyWith(
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                        ],
                      ),
                      if (has)
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                for (final ev in dayEv.take(2))
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 2),
                                    child: Text(
                                      ev['title'] as String? ?? '',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: theme.textTheme.labelSmall?.copyWith(
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                if (dayEv.length > 2)
                                  Text(
                                    '+${dayEv.length - 2}',
                                    style: theme.textTheme.labelSmall?.copyWith(
                                      color: cs.primary,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Calendário de Eventos'),
        actions: [
          IconButton(
            tooltip: 'Atualizar',
            onPressed: _loading ? null : _reload,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(
          padding: const EdgeInsets.all(16),
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            Text(
              _canManage
                  ? 'Toque em um dia para ver os eventos ou criar um novo.'
                  : 'Visualização dos eventos públicos do condomínio. Apenas síndico e administração cadastram eventos.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: cs.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 16),
            if (_loading && _events.isEmpty)
              const Padding(
                padding: EdgeInsets.all(48),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_loadError != null && _events.isEmpty)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    Text('$_loadError', textAlign: TextAlign.center),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _reload,
                      child: const Text('Tentar novamente'),
                    ),
                  ],
                ),
              )
            else ...[
              Text(
                '${_events.length} evento(s) neste mês',
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 12),
              _calendarGrid(theme, cs),
            ],
          ],
        ),
      ),
      floatingActionButton: _canManage
          ? FloatingActionButton.extended(
              onPressed: () => _openEventEditor(
                preferredDay: DateTime(_month.year, _month.month),
              ),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Novo evento'),
            )
          : null,
    );
  }
}

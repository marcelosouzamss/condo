import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/resident_unit_storage.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

String incidentKindPt(String k) {
  switch (k) {
    case 'incendio':
      return 'Incêndio';
    case 'invasao':
      return 'Invasão';
    case 'briga':
      return 'Briga ou tumulto';
    case 'agressao_mulher':
      return 'Agressão à mulher';
    case 'maus_tratos_animais':
      return 'Maus-tratos a animais';
    case 'maus_tratos_idosos':
      return 'Maus-tratos a idosos';
    case 'maus_tratos_criancas':
      return 'Maus-tratos a crianças';
    default:
      return 'Outro';
  }
}

const List<Map<String, String>> kIncidentKinds = [
  {'id': 'incendio', 'label': 'Incêndio'},
  {'id': 'invasao', 'label': 'Invasão'},
  {'id': 'briga', 'label': 'Briga ou tumulto'},
  {'id': 'agressao_mulher', 'label': 'Agressão à mulher'},
  {'id': 'maus_tratos_animais', 'label': 'Maus-tratos a animais'},
  {'id': 'maus_tratos_idosos', 'label': 'Maus-tratos a idosos'},
  {'id': 'maus_tratos_criancas', 'label': 'Maus-tratos a crianças'},
  {'id': 'outro', 'label': 'Outro'},
];

/// Chamados de urgência abertos pelo morador; síndico/administração acompanham.
class EmergencyPage extends StatefulWidget {
  const EmergencyPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
    required this.sessionUnitId,
  });

  final int condoId;
  final int userId;
  final String userRole;
  final int? sessionUnitId;

  @override
  State<EmergencyPage> createState() => _EmergencyPageState();
}

class _EmergencyPageState extends State<EmergencyPage> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  int? _resolvedUnitId;

  bool get _isStaff => CondoUserRoles.isBillingStaff(widget.userRole);
  bool get _isResident => widget.userRole == CondoUserRoles.resident;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    if (widget.sessionUnitId != null) {
      _resolvedUnitId = widget.sessionUnitId;
    } else if (_isResident) {
      await _resolveUnitFromPrefs();
    }
    if (!mounted) return;
    await _reload();
  }

  Future<void> _resolveUnitFromPrefs() async {
    try {
      final saved = await readResidentSelectedUnitId(
        CondoApi.residentSelectedUnitPrefKey(widget.condoId),
      );
      final r = await http.get(
        CondoApi.uri('/api/units', {'condoId': '${widget.condoId}'}),
      );
      if (!mounted || r.statusCode != 200) return;
      final list = jsonDecode(r.body) as List<dynamic>;
      int? pick(int id) {
        for (final raw in list) {
          final u = raw as Map<String, dynamic>;
          if (u['condo_id'] == widget.condoId && u['id'] == id) {
            return id;
          }
        }
        return null;
      }

      int? resolved;
      if (saved != null) {
        resolved = pick(saved);
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

      setState(() => _resolvedUnitId = resolved);
    } catch (_) {}
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await http.get(
        CondoApi.uri('/api/emergency-incidents', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        }),
      );
      if (!mounted) return;
      if (r.statusCode != 200) {
        setState(() {
          _error = 'Erro ao carregar (${r.statusCode}).';
          _loading = false;
        });
        return;
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      setState(() {
        _rows = list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Falha de rede.';
          _loading = false;
        });
      }
    }
  }

  Future<void> _submit(String kind, String description) async {
    final uid = widget.sessionUnitId ?? _resolvedUnitId;
    if (uid == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Defina sua unidade em Minha Unidade ou complete o cadastro.',
          ),
        ),
      );
      return;
    }

    final r = await http.post(
      CondoApi.uri('/api/emergency-incidents'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'userId': widget.userId,
        'incidentKind': kind,
        'description': description.trim(),
        'unitId': uid,
      }),
    );
    if (!mounted) return;
    if (r.statusCode == 201) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Chamado registrado. Priorize sua segurança e use os canais oficiais (bombeiros, PM).',
          ),
        ),
      );
      await _reload();
    } else {
      final msg = r.body.isNotEmpty
          ? (jsonDecode(r.body) as Map)['message']?.toString()
          : '${r.statusCode}';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg ?? 'Erro ao registrar.')),
      );
    }
  }

  Future<void> _patchStatus(int id, String status) async {
    final r = await http.patch(
      CondoApi.uri('/api/emergency-incidents/$id'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'userId': widget.userId,
        'status': status,
      }),
    );
    if (!mounted) return;
    if (r.statusCode == 200) {
      await _reload();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro (${r.statusCode}).')),
      );
    }
  }

  String _statusPt(String s) {
    switch (s) {
      case 'acknowledged':
        return 'Em atendimento';
      case 'closed':
        return 'Encerrado';
      default:
        return 'Aberto';
    }
  }

  void _openReportSheet() {
    String kind = kIncidentKinds.first['id']!;
    final descCtrl = TextEditingController();

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(ctx).bottom,
          ),
          child: StatefulBuilder(
            builder: (ctx, setModal) {
              return SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Novo chamado de urgência',
                      style: Theme.of(ctx).textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Em risco imediato, ligue 190/193/192 conforme o caso.',
                      style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                            color: Theme.of(ctx).colorScheme.error,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<String>(
                      value: kind,
                      decoration: const InputDecoration(
                        labelText: 'Tipo de sinistro',
                        border: OutlineInputBorder(),
                      ),
                      items: kIncidentKinds
                          .map(
                            (e) => DropdownMenuItem(
                              value: e['id'],
                              child: Text(e['label']!),
                            ),
                          )
                          .toList(),
                      onChanged: (v) {
                        if (v != null) setModal(() => kind = v);
                      },
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: descCtrl,
                      minLines: 3,
                      maxLines: 6,
                      decoration: const InputDecoration(
                        labelText: 'Detalhes (local, pessoas envolvidas…)',
                        border: OutlineInputBorder(),
                        alignLabelWithHint: true,
                      ),
                    ),
                    const SizedBox(height: 18),
                    FilledButton.icon(
                      onPressed: () async {
                        Navigator.pop(ctx);
                        await _submit(kind, descCtrl.text);
                      },
                      icon: const Icon(Icons.report_problem_rounded),
                      label: const Text('Registrar chamado'),
                    ),
                  ],
                ),
              );
            },
          ),
        );
      },
    ).whenComplete(descCtrl.dispose);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Emergência'),
        backgroundColor: cs.error,
        foregroundColor: cs.onError,
        iconTheme: IconThemeData(color: cs.onError),
        elevation: 0,
        surfaceTintColor: Colors.transparent,
      ),
      floatingActionButton: _isResident
          ? FloatingActionButton.extended(
              onPressed: _openReportSheet,
              backgroundColor: cs.error,
              foregroundColor: cs.onError,
              icon: const Icon(Icons.emergency_rounded),
              label: const Text('Abrir chamado'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: cs.errorContainer.withValues(alpha: 0.25),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: cs.error.withValues(alpha: 0.35)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Situações graves',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Incêndio, invasão, brigas, violência contra mulher, '
                    'maus-tratos a animais, idosos ou crianças. '
                    'O condomínio registra e pode acionar protocolos internos; '
                    'em perigo imediato ligue aos serviços públicos de emergência.',
                    style: theme.textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            Text(
              'Registros',
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              Text(_error!, style: TextStyle(color: cs.error))
            else if (_rows.isEmpty)
              Text(
                'Nenhum chamado registrado.',
                style: theme.textTheme.bodyLarge?.copyWith(
                  color: cs.onSurfaceVariant,
                ),
              )
            else
              ..._rows.map((row) {
                final id = (row['id'] as num).toInt();
                final kind = row['incident_kind'] as String? ?? '';
                final desc = row['description'] as String? ?? '';
                final status = row['status'] as String? ?? 'open';
                final reporter = row['reporter_name'] as String? ?? '';
                final tower = row['unit_tower'] as String? ?? '';
                final unitNumStr = row['unit_number'] as String? ?? '';
                final unitLab =
                    tower.isNotEmpty ? '$tower-$unitNumStr' : '—';

                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.warning_rounded, color: cs.error),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                incidentKindPt(kind),
                                style: theme.textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            Chip(
                              label: Text(_statusPt(status)),
                              visualDensity: VisualDensity.compact,
                            ),
                          ],
                        ),
                        if (_isStaff) ...[
                          const SizedBox(height: 6),
                          Text(
                            '$unitLab · $reporter',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: cs.onSurfaceVariant,
                            ),
                          ),
                        ],
                        if (desc.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Text(desc),
                        ],
                        if (_isStaff) ...[
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            children: [
                              if (status == 'open')
                                TextButton(
                                  onPressed: () =>
                                      _patchStatus(id, 'acknowledged'),
                                  child: const Text('Marcar em atendimento'),
                                ),
                              if (status != 'closed')
                                FilledButton.tonal(
                                  onPressed: () =>
                                      _patchStatus(id, 'closed'),
                                  child: const Text('Encerrar'),
                                ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }
}

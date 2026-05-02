import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/maintenance_format_utils.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

/// Base URL do backend usada por [CondoApi.uri] e [CondoApi.uploadsUrl].
///
/// Prioridade: `API_BASE_URL` via `--dart-define=...` (obrigatório em muitos
/// aparelhos físicos: use o IP da máquina na LAN, ex. `http://192.168.0.10:3333`).
///
/// Sem define: Web e desktop usam `http://localhost:3333`. **No Android, o
/// padrão é `http://10.0.2.2:3333`** — é o alias do host no emulador; em
/// **dispositivo físico** defina `API_BASE_URL` ou use `adb reverse tcp:3333 tcp:3333`
/// e aponte para `http://127.0.0.1:3333` via define.
class CondoApi {
  static String get baseUrl {
    const fromEnv = String.fromEnvironment('API_BASE_URL', defaultValue: '');
    if (fromEnv.isNotEmpty) {
      return fromEnv;
    }
    if (kIsWeb) {
      return 'http://localhost:3333';
    }
    if (defaultTargetPlatform == TargetPlatform.android) {
      return 'http://10.0.2.2:3333';
    }
    return 'http://localhost:3333';
  }

  static Uri uri(String path, [Map<String, String>? query]) {
    return Uri.parse('$baseUrl$path').replace(queryParameters: query);
  }

  /// URL absoluta para arquivos servidos em `/uploads/...`.
  ///
  /// O backend monta `app.use('/uploads', express.static(.../uploads'))`.
  /// Vários endpoints gravam na BD só o caminho *dentro* de `uploads/`
  /// (ex.: `documents/condo-1/arquivo.pdf`). Nesse caso é preciso prefixar
  /// `/uploads/` — caso contrário o pedido cai na rota 404 genérica.
  static String uploadsUrl(String relativePath) {
    if (relativePath.startsWith('http://') ||
        relativePath.startsWith('https://')) {
      return relativePath;
    }
    var p = relativePath.trim().replaceAll(r'\', '/');
    if (p.isEmpty) {
      return CondoApi.baseUrl;
    }
    if (!p.startsWith('/')) {
      p = '/$p';
    }
    if (!p.startsWith('/uploads/')) {
      p = '/uploads$p';
    }
    return '${CondoApi.baseUrl}$p';
  }

  /// Chave para persistir a unidade escolhida em Minha Unidade (reservas usam o mesmo id).
  static String residentSelectedUnitPrefKey(int condoId) =>
      'resident_selected_unit_v1_$condoId';
}

class SyndicApi {
  static Future<Map<String, dynamic>?> dashboard(int condoId) async {
    try {
      final r = await http.get(
        CondoApi.uri('/api/syndic/dashboard', {'condoId': '$condoId'}),
      );
      if (r.statusCode != 200) {
        return null;
      }
      return jsonDecode(r.body) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> financialReport(
    int condoId, {
    String? month,
  }) async {
    try {
      final q = <String, String>{'condoId': '$condoId'};
      if (month != null && month.trim().isNotEmpty) {
        q['month'] = month.trim();
      }
      final r = await http.get(
        CondoApi.uri('/api/syndic/reports/financial', q),
      );
      if (r.statusCode != 200) {
        return null;
      }
      return jsonDecode(r.body) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> areaUsageReport(int condoId) async {
    try {
      final r = await http.get(
        CondoApi.uri('/api/syndic/reports/area-usage', {
          'condoId': '$condoId',
        }),
      );
      if (r.statusCode != 200) {
        return null;
      }
      return jsonDecode(r.body) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> operationsReport(int condoId) async {
    try {
      final r = await http.get(
        CondoApi.uri('/api/syndic/reports/operations', {
          'condoId': '$condoId',
        }),
      );
      if (r.statusCode != 200) {
        return null;
      }
      return jsonDecode(r.body) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }
}

/// Lista: ocorrências abertas (painel do síndico).
class SyndicOccurrencesListPage extends StatefulWidget {
  const SyndicOccurrencesListPage({super.key, this.condoId = 1});

  final int condoId;

  @override
  State<SyndicOccurrencesListPage> createState() =>
      _SyndicOccurrencesListPageState();
}

class _SyndicOccurrencesListPageState extends State<SyndicOccurrencesListPage> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<dynamic>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/syndic/occurrences', {
        'condoId': '${widget.condoId}',
        'status': 'open',
      }),
    );
    if (r.statusCode != 200) {
      throw Exception('Falha ao carregar (${r.statusCode})');
    }
    return jsonDecode(r.body) as List<dynamic>;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ocorrências abertas'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() {
            _future = _load();
          });
          await _future;
        },
        child: FutureBuilder<List<dynamic>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(24),
                children: [
                  Text(
                    'Não foi possível carregar a lista. '
                    'Confira se o backend está em ${CondoApi.baseUrl}.',
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ],
              );
            }
            final items = snap.data!;
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text('Nenhuma ocorrência aberta.'),
                    ),
                  ),
                ],
              );
            }
            return ListView.builder(
              itemCount: items.length,
              itemBuilder: (context, i) {
                final o = items[i] as Map<String, dynamic>;
                final title = o['title'] as String? ?? '';
                final desc = o['description'] as String? ?? '';
                final id = o['id'] as num;
                return ListTile(
                  title: Text(title),
                  subtitle: Text(
                    desc.length > 120 ? '${desc.substring(0, 120)}…' : desc,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () async {
                    await Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (context) => SyndicOccurrenceDetailPage(
                          condoId: widget.condoId,
                          occurrenceId: id.toInt(),
                        ),
                      ),
                    );
                    if (context.mounted) {
                      setState(() => _future = _load());
                    }
                  },
                );
              },
            );
          },
        ),
      ),
    );
  }
}

/// Detalhe da ocorrência + resposta do síndico.
class SyndicOccurrenceDetailPage extends StatefulWidget {
  const SyndicOccurrenceDetailPage({
    super.key,
    required this.condoId,
    required this.occurrenceId,
  });

  final int condoId;
  final int occurrenceId;

  @override
  State<SyndicOccurrenceDetailPage> createState() =>
      _SyndicOccurrenceDetailPageState();
}

class _SyndicOccurrenceDetailPageState
    extends State<SyndicOccurrenceDetailPage> {
  late Future<Map<String, dynamic>> _future;
  final TextEditingController _responseCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _responseCtrl.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> _load() async {
    final r = await http.get(
      CondoApi.uri(
        '/api/syndic/occurrences/${widget.occurrenceId}',
        {'condoId': '${widget.condoId}'},
      ),
    );
    if (r.statusCode != 200) {
      throw Exception('Ocorrência não encontrada (${r.statusCode})');
    }
    final map = jsonDecode(r.body) as Map<String, dynamic>;
    if (mounted) {
      final sr = map['syndic_response'] as String?;
      _responseCtrl.text = sr ?? '';
    }
    return map;
  }

  Future<void> _saveResponse() async {
    final body = jsonEncode({
      'syndicResponse':
          _responseCtrl.text.trim().isEmpty ? null : _responseCtrl.text.trim(),
    });
    final r = await http.patch(
      CondoApi.uri('/api/syndic/occurrences/${widget.occurrenceId}'),
      headers: {'Content-Type': 'application/json'},
      body: body,
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 200) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Resposta do síndico salva.')),
      );
      setState(() => _future = _load());
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro ao salvar (${r.statusCode}).'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Detalhe da ocorrência')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(child: Text('${snap.error}'));
          }
          final o = snap.data!;
          final title = o['title'] as String? ?? '';
          final description = o['description'] as String? ?? '';
          final category = o['category'] as String?;
          final status = o['status'] as String? ?? '';
          final reporter = o['reporter_name'] as String?;
          final tower = o['unit_tower'] as String?;
          final number = o['unit_number'] as String?;
          String? unitLabel;
          if (tower != null && number != null) {
            unitLabel = 'Unidade $tower-$number';
          }

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(title, style: theme.textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(
                'Situação: $status'
                '${category != null ? ' · $category' : ''}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              if (unitLabel != null) ...[
                const SizedBox(height: 4),
                Text(
                  unitLabel,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
              if (reporter != null && reporter.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  'Relatado por',
                  style: theme.textTheme.labelLarge,
                ),
                Text(reporter),
              ],
              const SizedBox(height: 16),
              Text(
                'Relato',
                style: theme.textTheme.labelLarge,
              ),
              const SizedBox(height: 6),
              Text(description),
              const SizedBox(height: 24),
              Text(
                'Resposta do síndico',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _responseCtrl,
                minLines: 4,
                maxLines: 8,
                decoration: const InputDecoration(
                  hintText:
                      'Ex.: Providências tomadas, prazo de retorno, contato com morador…',
                  border: OutlineInputBorder(),
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _saveResponse,
                icon: const Icon(Icons.save_rounded),
                label: const Text('Salvar resposta'),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Lista de solicitações de manutenção do condomínio.
class SyndicMaintenanceListPage extends StatefulWidget {
  const SyndicMaintenanceListPage({
    super.key,
    required this.condoId,
    required this.staffUserId,
  });

  final int condoId;
  final int staffUserId;

  @override
  State<SyndicMaintenanceListPage> createState() =>
      _SyndicMaintenanceListPageState();
}

class _SyndicMaintenanceListPageState extends State<SyndicMaintenanceListPage> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<dynamic>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/syndic/maintenance-requests', {
        'condoId': '${widget.condoId}',
      }),
    );
    if (r.statusCode != 200) {
      throw Exception('Falha ao carregar (${r.statusCode})');
    }
    final list = jsonDecode(r.body) as List<dynamic>;
    list.sort((a, b) {
      final sa = (a as Map)['status'] as String? ?? '';
      final sb = (b as Map)['status'] as String? ?? '';
      const order = {'open': 0, 'in_progress': 1, 'completed': 2};
      final ia = order[sa] ?? 9;
      final ib = order[sb] ?? 9;
      if (ia != ib) {
        return ia.compareTo(ib);
      }
      return 0;
    });
    return list;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Solicitações de manutenção')),
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() => _future = _load());
          await _future;
        },
        child: FutureBuilder<List<dynamic>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(24),
                children: [
                  Text(
                    'Não foi possível carregar. Backend em ${CondoApi.baseUrl}?',
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ],
              );
            }
            final items = snap.data!;
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text('Nenhuma solicitação.'),
                    ),
                  ),
                ],
              );
            }
            return ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: items.length,
              itemBuilder: (context, i) {
                final m = items[i] as Map<String, dynamic>;
                final title = m['title'] as String? ?? '';
                final st = m['status'] as String? ?? '';
                final tower = m['tower'] as String? ?? '';
                final number = m['number'] as String? ?? '';
                final desc = m['description'] as String? ?? '';
                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: () async {
                      final id = m['id'] as num;
                      await Navigator.of(context).push<void>(
                        MaterialPageRoute<void>(
                          builder: (context) => SyndicMaintenanceDetailPage(
                            condoId: widget.condoId,
                            maintenanceId: id.toInt(),
                            staffUserId: widget.staffUserId,
                          ),
                        ),
                      );
                      if (context.mounted) {
                        setState(() => _future = _load());
                      }
                    },
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  title,
                                  style: Theme.of(context)
                                      .textTheme
                                      .titleMedium
                                      ?.copyWith(fontWeight: FontWeight.w700),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  'Unidade $tower-$number · Status: $st',
                                  style: Theme.of(context)
                                      .textTheme
                                      .bodySmall
                                      ?.copyWith(
                                        color: Theme.of(context)
                                            .colorScheme
                                            .onSurfaceVariant,
                                      ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  desc.length > 120
                                      ? '${desc.substring(0, 120)}…'
                                      : desc,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 12),
                          const Icon(Icons.chevron_right_rounded),
                        ],
                      ),
                    ),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

/// Detalhe da solicitação: diálogo contínuo, situação e conclusão (síndico/administração).
class SyndicMaintenanceDetailPage extends StatefulWidget {
  const SyndicMaintenanceDetailPage({
    super.key,
    required this.condoId,
    required this.maintenanceId,
    required this.staffUserId,
  });

  final int condoId;
  final int maintenanceId;
  final int staffUserId;

  @override
  State<SyndicMaintenanceDetailPage> createState() =>
      _SyndicMaintenanceDetailPageState();
}

class _SyndicMaintenanceDetailPageState
    extends State<SyndicMaintenanceDetailPage> {
  late Future<Map<String, dynamic>> _future;
  final TextEditingController _msgCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _future = _loadAll();
  }

  @override
  void dispose() {
    _msgCtrl.dispose();
    super.dispose();
  }

  String _statusPt(String s) {
    switch (s) {
      case 'open':
        return 'Aberto';
      case 'in_progress':
        return 'Em andamento';
      case 'completed':
        return 'Concluído';
      case 'closed':
        return 'Encerrado';
      default:
        return s;
    }
  }

  Future<Map<String, dynamic>> _loadAll() async {
    final detailUrl = CondoApi.uri(
      '/api/syndic/maintenance-requests/${widget.maintenanceId}',
      {'condoId': '${widget.condoId}'},
    );
    final msgUrl = CondoApi.uri(
      '/api/syndic/maintenance-requests/${widget.maintenanceId}/messages',
      {
        'condoId': '${widget.condoId}',
        'userId': '${widget.staffUserId}',
      },
    );
    final dr = await http.get(detailUrl);
    if (dr.statusCode != 200) {
      throw Exception('Solicitação não encontrada (${dr.statusCode})');
    }
    final detail = jsonDecode(dr.body) as Map<String, dynamic>;
    final mr = await http.get(msgUrl);
    List<dynamic> messages = [];
    if (mr.statusCode == 200) {
      messages = jsonDecode(mr.body) as List<dynamic>;
    }
    return {'detail': detail, 'messages': messages};
  }

  Future<void> _reload() async {
    setState(() => _future = _loadAll());
    await _future;
  }

  Future<void> _patch(Map<String, dynamic> fields) async {
    final r = await http.patch(
      CondoApi.uri(
        '/api/syndic/maintenance-requests/${widget.maintenanceId}',
      ),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'userId': widget.staffUserId,
        ...fields,
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 200) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Atualizado.')),
      );
      await _reload();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro (${r.statusCode}).')),
      );
    }
  }

  Future<void> _sendMessage() async {
    final text = _msgCtrl.text.trim();
    if (text.isEmpty) {
      return;
    }
    final r = await http.post(
      CondoApi.uri(
        '/api/syndic/maintenance-requests/${widget.maintenanceId}/messages',
      ),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'userId': widget.staffUserId,
        'body': text,
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 201) {
      _msgCtrl.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Mensagem enviada.')),
      );
      await _reload();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro (${r.statusCode}).')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Detalhe da manutenção')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(child: Text('${snap.error}'));
          }

          final bundle = snap.data!;
          final m = bundle['detail']! as Map<String, dynamic>;
          final messages = bundle['messages']! as List<dynamic>;

          final title = m['title'] as String? ?? '';
          final description = m['description'] as String? ?? '';
          final priority = m['priority'] as String? ?? '';
          final status = m['status'] as String? ?? '';
          final tower = m['tower'] as String? ?? '';
          final number = m['number'] as String? ?? '';
          final resident = m['resident_name'] as String?;
          final legacy = (m['syndic_response'] as String?)?.trim();

          final canChat = status != 'completed' && status != 'closed';
          final durationLine = maintenanceProcessDurationLine(
            createdAtRaw: m['created_at'],
            updatedAtRaw: m['updated_at'],
            status: status,
          );

          return RefreshIndicator(
            onRefresh: _reload,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(title, style: theme.textTheme.titleLarge),
                const SizedBox(height: 8),
                Text(
                  'Unidade $tower-$number · ${_statusPt(status)} · Prioridade: $priority',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: cs.onSurfaceVariant,
                  ),
                ),
                if (resident != null && resident.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Contato/unidade: $resident',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: cs.onSurfaceVariant,
                    ),
                  ),
                ],
                if (durationLine.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    durationLine,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: cs.onSurfaceVariant,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                Text('Situação do chamado', style: theme.textTheme.labelLarge),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  value: status.isEmpty ? 'open' : status,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    labelText: 'Status',
                  ),
                  items: const [
                    DropdownMenuItem(value: 'open', child: Text('Aberto')),
                    DropdownMenuItem(
                      value: 'in_progress',
                      child: Text('Em andamento'),
                    ),
                    DropdownMenuItem(
                      value: 'completed',
                      child: Text('Concluído'),
                    ),
                    DropdownMenuItem(
                      value: 'closed',
                      child: Text('Encerrado'),
                    ),
                  ],
                  onChanged: (v) {
                    if (v != null && v != status) {
                      _patch({'status': v});
                    }
                  },
                ),
                if (status != 'completed' && status != 'closed') ...[
                  const SizedBox(height: 12),
                  FilledButton.tonalIcon(
                    onPressed: () => _patch({'status': 'completed'}),
                    icon: const Icon(Icons.check_circle_outline_rounded),
                    label: const Text('Marcar como concluída'),
                  ),
                ],
                const SizedBox(height: 20),
                Text('Descrição', style: theme.textTheme.labelLarge),
                const SizedBox(height: 6),
                Text(description),
                if (legacy != null && legacy.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Card(
                    color: cs.surfaceContainerHighest.withValues(alpha: 0.5),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Resposta registrada (histórico)',
                            style: theme.textTheme.labelMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(legacy, style: theme.textTheme.bodyMedium),
                        ],
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 20),
                Text(
                  'Diálogo',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  canChat
                      ? 'Mensagens entre a equipe e o morador ficam abaixo.'
                      : 'Chamado encerrado — não é possível novas mensagens.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: cs.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 12),
                ...messages.map((raw) {
                  final row = raw as Map<String, dynamic>;
                  final role = row['author_role'] as String? ?? '';
                  final isStaff = role == 'staff';
                  final name = row['full_name'] as String? ?? '';
                  final body = row['body'] as String? ?? '';
                  final when = maintenanceMessageTimestamp(row['created_at']);
                  final ur = row['user_role'] as String? ?? '';
                  return Align(
                    alignment:
                        isStaff ? Alignment.centerRight : Alignment.centerLeft,
                    child: ConstrainedBox(
                      constraints: BoxConstraints(
                        maxWidth: MediaQuery.of(context).size.width * 0.84,
                      ),
                      child: Card(
                        color: isStaff
                            ? cs.primaryContainer.withValues(alpha: 0.65)
                            : cs.surfaceContainerHighest.withValues(alpha: 0.9),
                        margin: const EdgeInsets.only(bottom: 10),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                isStaff
                                    ? 'Equipe · ${CondoUserRoles.labelPt(ur)}${name.isNotEmpty ? ' · $name' : ''}'
                                    : (name.isNotEmpty ? name : 'Morador'),
                                style: theme.textTheme.labelSmall?.copyWith(
                                  fontWeight: FontWeight.w700,
                                  color: cs.onSurfaceVariant,
                                ),
                              ),
                              Text(
                                when,
                                style: theme.textTheme.labelSmall?.copyWith(
                                  color: cs.onSurfaceVariant,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(body),
                            ],
                          ),
                        ),
                      ),
                    ),
                  );
                }),
                if (canChat) ...[
                  const SizedBox(height: 8),
                  TextField(
                    controller: _msgCtrl,
                    minLines: 2,
                    maxLines: 6,
                    decoration: const InputDecoration(
                      labelText: 'Nova mensagem da equipe',
                      border: OutlineInputBorder(),
                      alignLabelWithHint: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: _sendMessage,
                    icon: const Icon(Icons.send_rounded),
                    label: const Text('Enviar mensagem'),
                  ),
                ],
                const SizedBox(height: 24),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// Comunicados recentes (avisos do mural).
class SyndicRecentNoticesPage extends StatefulWidget {
  const SyndicRecentNoticesPage({super.key, this.condoId = 1});

  final int condoId;

  @override
  State<SyndicRecentNoticesPage> createState() =>
      _SyndicRecentNoticesPageState();
}

class _SyndicRecentNoticesPageState extends State<SyndicRecentNoticesPage> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<dynamic>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/notices', {
        'condoId': '${widget.condoId}',
        '_t': '${DateTime.now().millisecondsSinceEpoch}',
      }),
      headers: const {'Cache-Control': 'no-cache'},
    );
    if (r.statusCode != 200) {
      throw Exception('Falha ao carregar (${r.statusCode})');
    }
    return jsonDecode(r.body) as List<dynamic>;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Comunicados recentes')),
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() => _future = _load());
          await _future;
        },
        child: FutureBuilder<List<dynamic>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(24),
                children: [
                  Text(
                    'Não foi possível carregar. Backend em ${CondoApi.baseUrl}?',
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ],
              );
            }
            final items = snap.data!;
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text('Nenhum comunicado.'),
                    ),
                  ),
                ],
              );
            }
            return ListView.builder(
              itemCount: items.length,
              itemBuilder: (context, i) {
                final n = items[i] as Map<String, dynamic>;
                final title = n['title'] as String? ?? '';
                final content = n['content'] as String? ?? '';
                final published = n['published_at'] as String?;
                return ListTile(
                  title: Text(title),
                  subtitle: Text(
                    published != null
                        ? '${published.substring(0, published.length > 16 ? 16 : published.length)} · '
                            '${content.length > 80 ? '${content.substring(0, 80)}…' : content}'
                        : content.length > 100
                            ? '${content.substring(0, 100)}…'
                            : content,
                    maxLines: 2,
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () {
                    Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (context) => SyndicNoticeDetailPage(
                          title: title,
                          content: content,
                          publishedAt: published,
                          urgency: n['urgency'] as String?,
                          audience: n['audience'] as String?,
                        ),
                      ),
                    );
                  },
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class SyndicNoticeDetailPage extends StatelessWidget {
  const SyndicNoticeDetailPage({
    super.key,
    required this.title,
    required this.content,
    this.publishedAt,
    this.urgency,
    this.audience,
  });

  final String title;
  final String content;
  final String? publishedAt;
  final String? urgency;
  final String? audience;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Comunicado')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(title, style: theme.textTheme.headlineSmall),
          const SizedBox(height: 8),
          if (publishedAt != null)
            Text(
              'Publicado em $publishedAt',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          if (urgency != null || audience != null) ...[
            const SizedBox(height: 8),
            Text(
              [
                if (urgency != null) 'Urgência: $urgency',
                if (audience != null) 'Público: $audience',
              ].join(' · '),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
          const SizedBox(height: 16),
          Text(content),
        ],
      ),
    );
  }
}

/// Lista e ações: mural / avisos urgentes / arquivar / fixar.
class SyndicNoticesManagePage extends StatefulWidget {
  const SyndicNoticesManagePage({
    super.key,
    required this.condoId,
    required this.userId,
  });

  final int condoId;
  final int userId;

  @override
  State<SyndicNoticesManagePage> createState() =>
      _SyndicNoticesManagePageState();
}

class _SyndicNoticesManagePageState extends State<SyndicNoticesManagePage> {
  bool _loading = true;
  String? _error;
  List<dynamic> _rows = const [];
  bool _includeArchived = false;

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
        CondoApi.uri('/api/syndic/notices', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
          'includeArchived': '$_includeArchived',
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
        _rows = list;
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Falha de rede';
          _loading = false;
        });
      }
    }
  }

  Future<void> _patch(int id, Map<String, dynamic> body) async {
    final r = await http.patch(
      CondoApi.uri('/api/syndic/notices/$id'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(
          {...body, 'condoId': widget.condoId, 'userId': widget.userId}),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 200) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Atualizado.')),
      );
      await _load();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro (${r.statusCode}).')),
      );
    }
  }

  Future<void> _openNewNoticeEditor() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (ctx) => SyndicNoticeEditorPage(
          condoId: widget.condoId,
          userId: widget.userId,
        ),
      ),
    );
    if (mounted) {
      await _load();
    }
  }

  Future<void> _confirmDelete(int id, String title) async {
    final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Excluir aviso'),
            content: Text(
              title.isEmpty
                  ? 'Este aviso será removido permanentemente do mural.'
                  : 'Excluir «$title»? Esta ação não pode ser desfeita.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancelar'),
              ),
              FilledButton(
                style: FilledButton.styleFrom(
                  foregroundColor: Theme.of(ctx).colorScheme.onError,
                  backgroundColor: Theme.of(ctx).colorScheme.error,
                ),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Excluir'),
              ),
            ],
          ),
        ) ??
        false;
    if (!ok || !mounted) {
      return;
    }
    try {
      final r = await http.delete(
        CondoApi.uri('/api/syndic/notices/$id', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode == 204) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Aviso excluído.')),
        );
        await _load();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro (${r.statusCode}).')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Falha ao excluir.')),
        );
      }
    }
  }

  String _ymd(String? iso) {
    if (iso == null || iso.length < 10) {
      return '-';
    }
    return iso.substring(0, 10);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Gestão do mural de avisos'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilterChip(
              label: const Text('Arquivados'),
              selected: _includeArchived,
              onSelected: (v) {
                setState(() => _includeArchived = v);
                _load();
              },
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openNewNoticeEditor,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Novo aviso'),
      ),
      body: RefreshIndicator(
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
                    padding: const EdgeInsets.all(24),
                    children: [
                      Text(_error!, style: TextStyle(color: cs.error)),
                    ],
                  )
                : _rows.isEmpty
                    ? ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.all(24),
                        children: const [
                          Text(
                            'Nenhum aviso. Use o botão Novo aviso abaixo para publicar.',
                          ),
                        ],
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
                        itemCount: _rows.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (context, i) {
                          final row = _rows[i] as Map<String, dynamic>;
                          final id = (row['id'] as num).toInt();
                          final title = row['title'] as String? ?? '';
                          final urgent =
                              (row['urgency'] as String? ?? '') == 'urgent';
                          final pinned = row['is_pinned'] == true;
                          final archived = row['is_archived'] == true;
                          final pub = _ymd(row['published_at']?.toString());
                          final exp = row['expires_at'];
                          final expStr = exp == null
                              ? 'Sem término'
                              : 'Até ${_ymd(exp.toString())}';

                          return Card(
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                              side: BorderSide(color: cs.outlineVariant),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          title,
                                          style: theme.textTheme.titleSmall
                                              ?.copyWith(
                                            fontWeight: FontWeight.w800,
                                          ),
                                        ),
                                        const SizedBox(height: 6),
                                        Wrap(
                                          spacing: 6,
                                          runSpacing: 4,
                                          children: [
                                            if (urgent)
                                              Chip(
                                                label: const Text('Urgente'),
                                                visualDensity:
                                                    VisualDensity.compact,
                                                labelStyle: const TextStyle(
                                                  fontSize: 11,
                                                ),
                                                padding: EdgeInsets.zero,
                                                materialTapTargetSize:
                                                    MaterialTapTargetSize
                                                        .shrinkWrap,
                                              ),
                                            if (pinned)
                                              Chip(
                                                avatar: const Icon(
                                                  Icons.push_pin_rounded,
                                                  size: 14,
                                                ),
                                                label: const Text('Fixado'),
                                                visualDensity:
                                                    VisualDensity.compact,
                                                labelStyle: const TextStyle(
                                                  fontSize: 11,
                                                ),
                                              ),
                                            if (archived)
                                              Chip(
                                                label: const Text('Arquivado'),
                                                visualDensity:
                                                    VisualDensity.compact,
                                                labelStyle: TextStyle(
                                                  fontSize: 11,
                                                  color: cs.error,
                                                ),
                                              ),
                                          ],
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          'Publicação: $pub · $expStr',
                                          style: theme.textTheme.bodySmall
                                              ?.copyWith(
                                            color: cs.onSurfaceVariant,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  IconButton(
                                    tooltip: 'Editar',
                                    icon: Icon(
                                      Icons.edit_rounded,
                                      color: cs.primary,
                                    ),
                                    onPressed: () async {
                                      await Navigator.of(context).push<void>(
                                        MaterialPageRoute<void>(
                                          builder: (ctx) =>
                                              SyndicNoticeEditorPage(
                                            condoId: widget.condoId,
                                            userId: widget.userId,
                                            initialRow: row,
                                          ),
                                        ),
                                      );
                                      if (mounted) {
                                        await _load();
                                      }
                                    },
                                  ),
                                  PopupMenuButton<String>(
                                    onSelected: (v) async {
                                      if (v == 'edit') {
                                        await Navigator.of(context).push<void>(
                                          MaterialPageRoute<void>(
                                            builder: (ctx) =>
                                                SyndicNoticeEditorPage(
                                              condoId: widget.condoId,
                                              userId: widget.userId,
                                              initialRow: row,
                                            ),
                                          ),
                                        );
                                        if (mounted) {
                                          await _load();
                                        }
                                      } else if (v == 'pin') {
                                        await _patch(id, {
                                          'isPinned': !pinned,
                                        });
                                      } else if (v == 'archive') {
                                        await _patch(id, {
                                          'isArchived': !archived,
                                        });
                                      } else if (v == 'delete') {
                                        await _confirmDelete(id, title);
                                      }
                                    },
                                    itemBuilder: (ctx) => [
                                      const PopupMenuItem(
                                        value: 'edit',
                                        child: Text('Editar'),
                                      ),
                                      PopupMenuItem(
                                        value: 'pin',
                                        child: Text(
                                          pinned
                                              ? 'Desfixar'
                                              : 'Fixar no mural',
                                        ),
                                      ),
                                      PopupMenuItem(
                                        value: 'archive',
                                        child: Text(
                                          archived
                                              ? 'Restaurar do arquivo'
                                              : 'Arquivar',
                                        ),
                                      ),
                                      PopupMenuItem(
                                        value: 'delete',
                                        child: Text(
                                          'Excluir',
                                          style: TextStyle(
                                            color:
                                                Theme.of(ctx).colorScheme.error,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
      ),
    );
  }
}

/// Cria ou edita aviso (mural normal ou urgente).
class SyndicNoticeEditorPage extends StatefulWidget {
  const SyndicNoticeEditorPage({
    super.key,
    required this.condoId,
    required this.userId,
    this.initialRow,
    this.defaultUrgency = 'normal',
  });

  final int condoId;
  final int userId;
  final Map<String, dynamic>? initialRow;
  final String defaultUrgency;

  @override
  State<SyndicNoticeEditorPage> createState() => _SyndicNoticeEditorPageState();
}

class _SyndicNoticeEditorPageState extends State<SyndicNoticeEditorPage> {
  final _titleCtrl = TextEditingController();
  final _contentCtrl = TextEditingController();
  final _audienceCtrl = TextEditingController();

  bool _urgent = false;
  bool _pinned = false;
  late DateTime _publishDate;
  bool _hasEnd = false;
  DateTime? _endDate;
  bool _saving = false;
  final List<PlatformFile> _pendingFiles = [];
  List<Map<String, dynamic>> _existingAttachments = [];

  int? get _editId => widget.initialRow != null
      ? (widget.initialRow!['id'] as num).toInt()
      : null;

  @override
  void initState() {
    super.initState();
    final init = widget.initialRow;
    if (init != null) {
      _titleCtrl.text = init['title'] as String? ?? '';
      _contentCtrl.text = init['content'] as String? ?? '';
      _audienceCtrl.text = init['audience'] as String? ?? '';
      _urgent = (init['urgency'] as String? ?? '') == 'urgent';
      _pinned = init['is_pinned'] == true;
      final p = init['published_at']?.toString();
      _publishDate = p != null && p.length >= 10
          ? DateTime.parse(p.substring(0, 10))
          : DateTime.now();
      final e = init['expires_at'];
      if (e != null) {
        _hasEnd = true;
        final es = e.toString();
        _endDate = es.length >= 10
            ? DateTime.parse(es.substring(0, 10))
            : DateTime.now().add(const Duration(days: 7));
      } else {
        _endDate = DateTime.now().add(const Duration(days: 7));
      }
      final att = init['attachments'];
      if (att is List<dynamic>) {
        _existingAttachments =
            att.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      } else if (att is String && att.isNotEmpty) {
        try {
          final dec = jsonDecode(att) as List<dynamic>;
          _existingAttachments =
              dec.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        } catch (_) {}
      }
    } else {
      _urgent = widget.defaultUrgency == 'urgent';
      _publishDate = DateTime.now();
      _endDate = DateTime.now().add(const Duration(days: 7));
    }
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _contentCtrl.dispose();
    _audienceCtrl.dispose();
    super.dispose();
  }

  DateTime _utcNoon(DateTime localDate) {
    return DateTime.utc(
      localDate.year,
      localDate.month,
      localDate.day,
      12,
      0,
      0,
    );
  }

  DateTime _utcEndOfDay(DateTime localDate) {
    return DateTime.utc(
      localDate.year,
      localDate.month,
      localDate.day,
      23,
      59,
      59,
    );
  }

  Future<void> _pickPublish() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _publishDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (d != null) {
      setState(() => _publishDate = d);
    }
  }

  bool _isImageMime(String? m) => m != null && m.startsWith('image/');

  Future<void> _pickFiles() async {
    final r = await FilePicker.platform.pickFiles(
      allowMultiple: true,
      withData: true,
      type: FileType.custom,
      allowedExtensions: [
        'jpg',
        'jpeg',
        'png',
        'gif',
        'webp',
        'pdf',
        'doc',
        'docx',
      ],
    );
    if (r == null || !mounted) {
      return;
    }
    final withBytes = r.files.where((f) => f.bytes != null).toList();
    if (withBytes.isEmpty && r.files.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Não foi possível ler os arquivos (tente novamente).'),
        ),
      );
      return;
    }
    setState(() => _pendingFiles.addAll(withBytes));
  }

  Future<bool> _uploadPending(int noticeId) async {
    if (_pendingFiles.isEmpty) {
      return true;
    }
    try {
      final uri = CondoApi.uri('/api/syndic/notices/$noticeId/attachments');
      final req = http.MultipartRequest('POST', uri);
      req.fields['condoId'] = '${widget.condoId}';
      req.fields['userId'] = '${widget.userId}';
      for (final f in _pendingFiles) {
        if (f.bytes != null) {
          req.files.add(
            http.MultipartFile.fromBytes(
              'files',
              f.bytes!,
              filename: f.name,
            ),
          );
        }
      }
      final streamed = await req.send();
      final resp = await http.Response.fromStream(streamed);
      if (resp.statusCode == 201 && mounted) {
        setState(() => _pendingFiles.clear());
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  Future<void> _deleteServerAttachment(Map<String, dynamic> att) async {
    final nid = _editId;
    if (nid == null) {
      return;
    }
    final aid = (att['id'] as num).toInt();
    final r = await http.delete(
      CondoApi.uri(
        '/api/syndic/notices/$nid/attachments/$aid',
        {'condoId': '${widget.condoId}', 'userId': '${widget.userId}'},
      ),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 204) {
      setState(() {
        _existingAttachments =
            _existingAttachments.where((e) => e['id'] != aid).toList();
      });
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao remover anexo (${r.statusCode}).')),
      );
    }
  }

  Future<void> _pickEnd() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _endDate ?? DateTime.now(),
      firstDate: _publishDate,
      lastDate: DateTime(2100),
    );
    if (d != null) {
      setState(() => _endDate = d);
    }
  }

  Future<void> _save() async {
    final title = _titleCtrl.text.trim();
    final content = _contentCtrl.text.trim();
    if (title.isEmpty || content.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Preencha título e texto.')),
      );
      return;
    }

    final pubIso = _utcNoon(_publishDate).toIso8601String();
    final String? expIso = _hasEnd && _endDate != null
        ? _utcEndOfDay(_endDate!).toIso8601String()
        : null;

    if (_hasEnd &&
        _endDate != null &&
        _utcEndOfDay(_endDate!).isBefore(_utcNoon(_publishDate))) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
              'Data de término deve ser no mesmo dia ou após a publicação.'),
        ),
      );
      return;
    }

    setState(() => _saving = true);
    try {
      final id = _editId;
      final http.Response r;
      if (id != null) {
        r = await http.patch(
          CondoApi.uri('/api/syndic/notices/$id'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'condoId': widget.condoId,
            'userId': widget.userId,
            'title': title,
            'content': content,
            'urgency': _urgent ? 'urgent' : 'normal',
            'isPinned': _pinned,
            'audience': _audienceCtrl.text.trim().isEmpty
                ? null
                : _audienceCtrl.text.trim(),
            'publishedAt': pubIso,
            'expiresAt': expIso,
          }),
        );
      } else {
        r = await http.post(
          CondoApi.uri('/api/syndic/notices'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'condoId': widget.condoId,
            'userId': widget.userId,
            'title': title,
            'content': content,
            'urgency': _urgent ? 'urgent' : 'normal',
            'isPinned': _pinned,
            'audience': _audienceCtrl.text.trim().isEmpty
                ? null
                : _audienceCtrl.text.trim(),
            'publishedAt': pubIso,
            'expiresAt': expIso,
          }),
        );
      }
      if (!mounted) {
        return;
      }
      if (r.statusCode == 200 || r.statusCode == 201) {
        final body = jsonDecode(r.body) as Map<String, dynamic>;
        final nid = (body['id'] as num?)?.toInt() ?? _editId;
        if (nid != null && _pendingFiles.isNotEmpty) {
          final upOk = await _uploadPending(nid);
          if (!mounted) {
            return;
          }
          if (!upOk) {
            setState(() => _saving = false);
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text(
                  'Aviso salvo, mas o envio de anexos falhou. Edite o aviso e tente novamente.',
                ),
              ),
            );
            Navigator.of(context).pop();
            return;
          }
        }
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Salvo.')),
        );
        Navigator.of(context).pop();
      } else {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro (${r.statusCode}).')),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Falha ao salvar.')),
        );
      }
    }
  }

  Future<void> _confirmDeleteNotice() async {
    final id = _editId;
    if (id == null || _saving || !mounted) {
      return;
    }
    final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Excluir aviso'),
            content: const Text(
              'Este aviso será removido permanentemente do mural, incluindo anexos.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancelar'),
              ),
              FilledButton(
                style: FilledButton.styleFrom(
                  foregroundColor: Theme.of(ctx).colorScheme.onError,
                  backgroundColor: Theme.of(ctx).colorScheme.error,
                ),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Excluir'),
              ),
            ],
          ),
        ) ??
        false;
    if (!ok || !mounted) {
      return;
    }
    setState(() => _saving = true);
    try {
      final r = await http.delete(
        CondoApi.uri('/api/syndic/notices/$id', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        }),
      );
      if (!mounted) {
        return;
      }
      setState(() => _saving = false);
      if (r.statusCode == 204) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Aviso excluído.')),
        );
        Navigator.of(context).pop();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro (${r.statusCode}).')),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Falha ao excluir.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final pubStr =
        '${_publishDate.year.toString().padLeft(4, '0')}-${_publishDate.month.toString().padLeft(2, '0')}-${_publishDate.day.toString().padLeft(2, '0')}';

    return Scaffold(
      appBar: AppBar(
        title: Text(_editId != null ? 'Editar aviso' : 'Novo aviso'),
        actions: [
          if (_editId != null)
            IconButton(
              tooltip: 'Excluir aviso',
              icon: Icon(Icons.delete_outline_rounded, color: cs.error),
              onPressed: _saving ? null : _confirmDeleteNotice,
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Urgência determina destaque no mural (urgente = aviso crítico). '
            'Sem urgência segue como comunicado normal.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: cs.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 16),
          SwitchListTile(
            title: const Text('Aviso urgente'),
            subtitle: const Text('Exibido com prioridade no mural'),
            value: _urgent,
            onChanged: _saving
                ? null
                : (v) {
                    setState(() => _urgent = v);
                  },
          ),
          SwitchListTile(
            title: const Text('Fixar no topo do mural'),
            value: _pinned,
            onChanged: _saving
                ? null
                : (v) {
                    setState(() => _pinned = v);
                  },
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _titleCtrl,
            decoration: const InputDecoration(
              labelText: 'Título',
              border: OutlineInputBorder(),
            ),
            enabled: !_saving,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _contentCtrl,
            decoration: const InputDecoration(
              labelText: 'Texto do aviso',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
            ),
            minLines: 5,
            maxLines: 14,
            enabled: !_saving,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _audienceCtrl,
            decoration: const InputDecoration(
              labelText: 'Público (opcional)',
              hintText: 'Ex.: Todos os moradores',
              border: OutlineInputBorder(),
            ),
            enabled: !_saving,
          ),
          const SizedBox(height: 20),
          Text(
            'Anexos e imagens',
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'JPG, PNG, GIF, WebP, PDF ou Word. Até 8 MB por arquivo.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: cs.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 8),
          for (final a in _existingAttachments)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                _isImageMime(a['mimeType'] as String?)
                    ? Icons.image_rounded
                    : Icons.attach_file_rounded,
              ),
              title: Text(a['fileName'] as String? ?? 'arquivo'),
              subtitle: Text(a['mimeType'] as String? ?? ''),
              trailing: IconButton(
                icon: const Icon(Icons.delete_outline_rounded),
                onPressed: _saving ? null : () => _deleteServerAttachment(a),
              ),
            ),
          for (var i = 0; i < _pendingFiles.length; i++)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.upload_rounded),
              title: Text(_pendingFiles[i].name),
              subtitle: const Text('Será enviado ao salvar'),
              trailing: IconButton(
                icon: const Icon(Icons.close_rounded),
                onPressed: _saving
                    ? null
                    : () => setState(() => _pendingFiles.removeAt(i)),
              ),
            ),
          OutlinedButton.icon(
            onPressed: _saving ? null : _pickFiles,
            icon: const Icon(Icons.add_photo_alternate_outlined),
            label: const Text('Adicionar arquivos'),
          ),
          const SizedBox(height: 16),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Data de publicação'),
            subtitle: Text(pubStr),
            trailing: IconButton(
              icon: const Icon(Icons.calendar_month_rounded),
              onPressed: _saving ? null : _pickPublish,
            ),
          ),
          SwitchListTile(
            title: const Text('Definir data de término'),
            subtitle: const Text(
              'Após essa data o aviso some do mural (permanece no arquivo do síndico).',
            ),
            value: _hasEnd,
            onChanged: _saving
                ? null
                : (v) {
                    setState(() => _hasEnd = v);
                  },
          ),
          if (_hasEnd && _endDate != null)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Último dia visível no mural'),
              subtitle: Text(
                '${_endDate!.year}-${_endDate!.month.toString().padLeft(2, '0')}-${_endDate!.day.toString().padLeft(2, '0')}',
              ),
              trailing: IconButton(
                icon: const Icon(Icons.event_rounded),
                onPressed: _saving ? null : _pickEnd,
              ),
            ),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: _saving ? null : _save,
            icon: _saving
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.save_rounded),
            label: Text(_saving ? 'Salvando…' : 'Salvar'),
          ),
        ],
      ),
    );
  }
}

IconData _syndicReservationSpaceIcon(String iconKey) {
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

/// Cadastro de novo espaço reservável (síndico / administração).
class ReservationSpaceFormDialog extends StatefulWidget {
  const ReservationSpaceFormDialog({super.key, required this.condoId});

  final int condoId;

  @override
  State<ReservationSpaceFormDialog> createState() =>
      _ReservationSpaceFormDialogState();
}

class _ReservationSpaceFormDialogState
    extends State<ReservationSpaceFormDialog> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _capacityController = TextEditingController();
  String _selectedIcon = 'meeting_room';
  bool _requiresApproval = true;
  bool _saving = false;

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _capacityController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    setState(() => _saving = true);
    try {
      final response = await http.post(
        CondoApi.uri('/api/reservation-spaces'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'name': _nameController.text.trim(),
          'description': _descriptionController.text.trim(),
          'iconKey': _selectedIcon,
          'capacity': _capacityController.text.trim().isEmpty
              ? null
              : int.parse(_capacityController.text.trim()),
          'requiresApproval': _requiresApproval,
        }),
      );
      if (!mounted) {
        return;
      }
      if (response.statusCode == 201) {
        Navigator.of(context).pop(true);
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao cadastrar (${response.statusCode}).')),
      );
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Cadastrar espaço'),
      content: SingleChildScrollView(
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(
                  labelText: 'Nome do espaço',
                  hintText: 'Ex.: Salão gourmet',
                ),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Informe o nome.';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _descriptionController,
                decoration: const InputDecoration(
                  labelText: 'Descrição',
                  hintText: 'Regras, uso permitido e observações.',
                ),
                minLines: 2,
                maxLines: 4,
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Informe a descrição.';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _capacityController,
                decoration: const InputDecoration(
                  labelText: 'Capacidade (opcional)',
                ),
                keyboardType: TextInputType.number,
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return null;
                  }
                  final parsed = int.tryParse(value.trim());
                  if (parsed == null || parsed < 1) {
                    return 'Informe um número válido.';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: _selectedIcon,
                decoration: const InputDecoration(labelText: 'Ícone'),
                items: const [
                  DropdownMenuItem(
                    value: 'meeting_room',
                    child: Text('Espaço comum'),
                  ),
                  DropdownMenuItem(
                    value: 'celebration',
                    child: Text('Festas'),
                  ),
                  DropdownMenuItem(
                    value: 'outdoor_grill',
                    child: Text('Churrasqueira'),
                  ),
                  DropdownMenuItem(
                    value: 'pool',
                    child: Text('Piscina'),
                  ),
                  DropdownMenuItem(
                    value: 'sports_soccer',
                    child: Text('Quadra'),
                  ),
                  DropdownMenuItem(
                    value: 'fitness_center',
                    child: Text('Academia'),
                  ),
                ],
                onChanged: (value) {
                  if (value != null) {
                    setState(() => _selectedIcon = value);
                  }
                },
              ),
              const SizedBox(height: 8),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Exige aprovação'),
                value: _requiresApproval,
                onChanged: (value) {
                  setState(() => _requiresApproval = value);
                },
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: _saving ? null : _submit,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Salvar'),
        ),
      ],
    );
  }
}

/// Lista de espaços: calendário da equipe e aprovações (síndico / administração).
class SyndicReservationSpacesListPage extends StatefulWidget {
  const SyndicReservationSpacesListPage({super.key, this.condoId = 1});

  final int condoId;

  @override
  State<SyndicReservationSpacesListPage> createState() =>
      _SyndicReservationSpacesListPageState();
}

class _SyndicReservationSpacesListPageState
    extends State<SyndicReservationSpacesListPage> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<dynamic>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/reservation-spaces', {'condoId': '${widget.condoId}'}),
    );
    if (r.statusCode != 200) {
      throw Exception('Erro ao carregar espaços (${r.statusCode})');
    }
    return jsonDecode(r.body) as List<dynamic>;
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  Future<void> _openCreateSpaceDialog() async {
    final created = await showDialog<bool>(
      context: context,
      builder: (context) => ReservationSpaceFormDialog(condoId: widget.condoId),
    );
    if (created == true && mounted) {
      await _refresh();
    }
  }

  void _openSpaceActions(Map<String, dynamic> space) {
    final name = space['name'] as String? ?? '';
    final description = space['description'] as String? ?? '';
    final id = (space['id'] as num?)?.toInt() ?? 0;
    final iconKey = space['icon_key'] as String? ?? '';
    if (id <= 0) {
      return;
    }

    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Icon(_syndicReservationSpaceIcon(iconKey)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        name,
                        style: Theme.of(ctx).textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                      ),
                    ),
                  ],
                ),
                if (description.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    description,
                    style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(ctx).colorScheme.onSurfaceVariant,
                        ),
                  ),
                ],
                const SizedBox(height: 8),
                ListTile(
                  leading: const Icon(Icons.calendar_view_month_rounded),
                  title: const Text('Visualizar disponibilidade'),
                  subtitle: const Text(
                    'Grade do mês com bloco e apartamento em cada dia reservado',
                  ),
                  onTap: () {
                    Navigator.pop(ctx);
                    Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (_) => SyndicSpaceCalendarPage(
                          condoId: widget.condoId,
                          spaceId: id,
                          spaceName: name,
                          icon: _syndicReservationSpaceIcon(iconKey),
                        ),
                      ),
                    );
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.fact_check_rounded),
                  title: const Text('Aprovar reservas'),
                  subtitle: const Text('Solicitações pendentes deste espaço'),
                  onTap: () {
                    Navigator.pop(ctx);
                    Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (_) => SyndicSpaceReservationsApprovalPage(
                          condoId: widget.condoId,
                          spaceId: id,
                          spaceName: name,
                        ),
                      ),
                    );
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Reservas de Espaço')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openCreateSpaceDialog,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Cadastrar espaço'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<dynamic>>(
          future: _future,
          builder: (context, snapshot) {
            Widget intro() {
              return Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Gestão pela equipe',
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Consulte disponibilidade, aprove solicitações e cadastre novos espaços para os moradores reservarem.',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: cs.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              );
            }

            if (snapshot.connectionState == ConnectionState.waiting) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                children: [
                  intro(),
                  const SizedBox(height: 80),
                  const Center(child: CircularProgressIndicator()),
                ],
              );
            }
            if (snapshot.hasError) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                children: [
                  intro(),
                  Text(
                    'Não foi possível carregar. Verifique ${CondoApi.baseUrl}.',
                    style: TextStyle(color: cs.error),
                  ),
                ],
              );
            }
            final items = snapshot.data ?? const <dynamic>[];
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                children: [
                  intro(),
                  const Text(
                    'Nenhum espaço cadastrado ainda no condomínio. Use o botão Cadastrar espaço.',
                  ),
                ],
              );
            }
            return ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
              children: [
                intro(),
                for (var index = 0; index < items.length; index++) ...[
                  if (index > 0) const SizedBox(height: 12),
                  Builder(
                    builder: (context) {
                      final space = items[index] as Map<String, dynamic>;
                      final name = space['name'] as String? ?? '';
                      final description = space['description'] as String? ?? '';
                      final iconKey = space['icon_key'] as String? ?? '';
                      return Material(
                        color: cs.surface,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(20),
                          side: BorderSide(color: cs.outlineVariant),
                        ),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(20),
                          onTap: () => _openSpaceActions(space),
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Container(
                                  width: 46,
                                  height: 46,
                                  decoration: BoxDecoration(
                                    color: cs.primary.withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(14),
                                  ),
                                  child: Icon(
                                    _syndicReservationSpaceIcon(iconKey),
                                    color: cs.primary,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        name,
                                        style: theme.textTheme.titleMedium
                                            ?.copyWith(
                                          fontWeight: FontWeight.w800,
                                        ),
                                      ),
                                      const SizedBox(height: 6),
                                      Text(
                                        description,
                                        style: theme.textTheme.bodyMedium
                                            ?.copyWith(
                                          color: cs.onSurfaceVariant,
                                        ),
                                      ),
                                      const SizedBox(height: 8),
                                      Text(
                                        'Toque para opções',
                                        style: theme.textTheme.labelMedium
                                            ?.copyWith(
                                          color: cs.primary,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                Icon(
                                  Icons.chevron_right_rounded,
                                  color: cs.onSurfaceVariant,
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Calendário do síndico: exibe torre e apartamento nos dias reservados.
class SyndicSpaceCalendarPage extends StatefulWidget {
  const SyndicSpaceCalendarPage({
    super.key,
    required this.condoId,
    required this.spaceId,
    required this.spaceName,
    required this.icon,
  });

  final int condoId;
  final int spaceId;
  final String spaceName;
  final IconData icon;

  @override
  State<SyndicSpaceCalendarPage> createState() =>
      _SyndicSpaceCalendarPageState();
}

class _SyndicSpaceCalendarPageState extends State<SyndicSpaceCalendarPage> {
  late DateTime _focusedMonth;
  List<Map<String, dynamic>> _dayRows = [];
  bool _loading = true;
  String? _error;

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
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final uri = CondoApi.uri(
        '/api/syndic/reservation-spaces/${widget.spaceId}/calendar',
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
          _error = 'Erro (${r.statusCode})';
          _loading = false;
        });
        return;
      }
      final map = jsonDecode(r.body) as Map<String, dynamic>;
      final days = (map['days'] as List<dynamic>)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      setState(() {
        _dayRows = days;
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
    await _load();
  }

  Map<String, dynamic>? _rowForDate(String dateStr) {
    for (final row in _dayRows) {
      if ((row['date'] as String?) == dateStr) {
        return row;
      }
    }
    return null;
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
      final row = _rowForDate(dateStr);
      final cell = row?['cell'] as String? ?? 'free';
      final bookings = (row?['bookings'] as List<dynamic>?) ?? const [];

      late Color bg;
      late Color border;
      late Color fg;
      if (cell == 'past') {
        if (bookings.isEmpty) {
          bg = Colors.grey.shade200;
          border = Colors.grey.shade500;
          fg = Colors.grey.shade700;
        } else {
          bg = Colors.blueGrey.shade100;
          border = Colors.blueGrey.shade600;
          fg = Colors.blueGrey.shade900;
        }
      } else if (cell == 'free') {
        bg = Colors.green.shade100;
        border = Colors.green.shade700;
        fg = Colors.green.shade900;
      } else if (cell == 'pending') {
        bg = Colors.amber.shade100;
        border = Colors.amber.shade800;
        fg = Colors.amber.shade900;
      } else {
        bg = Colors.red.shade100;
        border = Colors.red.shade700;
        fg = Colors.red.shade900;
      }

      cells.add(
        Container(
          margin: const EdgeInsets.all(2),
          padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 4),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: border),
          ),
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  '$d',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: fg,
                  ),
                ),
                if (bookings.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  for (final raw in bookings.take(3))
                    Builder(
                      builder: (_) {
                        final b = raw as Map<String, dynamic>;
                        final tw = b['tower'] as String? ?? '';
                        final unitNo = b['number'] as String? ?? '';
                        final st = b['status'] as String? ?? '';
                        final reqName =
                            (b['requesterName'] as String? ?? '').trim();
                        final suffix = st == 'pending' ? ' (pend.)' : '';
                        return Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              'Bl. $tw · $unitNo$suffix',
                              textAlign: TextAlign.center,
                              maxLines: 2,
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: fg,
                                fontWeight: FontWeight.w600,
                                fontSize: 9,
                              ),
                            ),
                            if (reqName.isNotEmpty)
                              Text(
                                reqName,
                                textAlign: TextAlign.center,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.labelSmall?.copyWith(
                                  color: fg,
                                  fontWeight: FontWeight.w500,
                                  fontSize: 8,
                                ),
                              ),
                          ],
                        );
                      },
                    ),
                  if (bookings.length > 3)
                    Text(
                      '+${bookings.length - 3}',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: fg,
                        fontSize: 8,
                      ),
                    ),
                ],
              ],
            ),
          ),
        ),
      );
    }

    return GridView.count(
      crossAxisCount: 7,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      childAspectRatio: 0.72,
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
        onRefresh: _load,
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
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error!, style: TextStyle(color: cs.error)),
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
            const SizedBox(height: 16),
            Text(
              'Verde: livre · Amarelo: pendente · Vermelho: aprovada · Cinza: passado · Nos dias reservados: bloco, apartamento e nome do solicitante.',
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

/// Aprovação de reservas pendentes filtradas por espaço.
class SyndicSpaceReservationsApprovalPage extends StatefulWidget {
  const SyndicSpaceReservationsApprovalPage({
    super.key,
    required this.condoId,
    required this.spaceId,
    required this.spaceName,
  });

  final int condoId;
  final int spaceId;
  final String spaceName;

  @override
  State<SyndicSpaceReservationsApprovalPage> createState() =>
      _SyndicSpaceReservationsApprovalPageState();
}

class _SyndicSpaceReservationsApprovalPageState
    extends State<SyndicSpaceReservationsApprovalPage> {
  bool _loading = true;
  String? _loadError;
  List<dynamic> _rows = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool showGlobalLoading = true}) async {
    if (showGlobalLoading) {
      setState(() {
        _loading = true;
        _loadError = null;
      });
    }
    try {
      final r = await http.get(
        CondoApi.uri('/api/syndic/approvals/reservations', {
          'condoId': '${widget.condoId}',
          'status': 'pending',
          'spaceId': '${widget.spaceId}',
          '_t': '${DateTime.now().millisecondsSinceEpoch}',
        }),
        headers: const {'Cache-Control': 'no-cache'},
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        setState(() {
          _loadError = 'Erro (${r.statusCode})';
          _loading = false;
        });
        return;
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      setState(() {
        _rows = list;
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _loadError = 'Falha ao carregar.';
          _loading = false;
        });
      }
    }
  }

  Future<void> _refresh() => _load(showGlobalLoading: true);

  String _splitDate(String iso) {
    if (iso.length >= 10) {
      return iso.substring(0, 10);
    }
    return iso;
  }

  Future<void> _setStatus(int id, String status) async {
    final r = await http.patch(
      CondoApi.uri('/api/syndic/approvals/reservations/$id'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'status': status}),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 200) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            status == 'approved' ? 'Reserva aprovada.' : 'Reserva recusada.',
          ),
        ),
      );
      await _load(showGlobalLoading: false);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro (${r.statusCode}).')),
      );
    }
  }

  Future<void> _confirmAndSet(int id, String status) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(status == 'approved' ? 'Aprovar?' : 'Recusar?'),
        content: Text(
          status == 'approved'
              ? 'Confirmar aprovação desta reserva?'
              : 'Confirmar recusa desta reserva?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Confirmar'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await _setStatus(id, status);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text('Pendentes · ${widget.spaceName}'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: Builder(
          builder: (context) {
            if (_loading) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 80),
                  Center(child: CircularProgressIndicator()),
                ],
              );
            }
            if (_loadError != null) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: [
                  Text(
                    'Falha ao carregar. ${CondoApi.baseUrl}',
                    style: TextStyle(color: cs.error),
                  ),
                ],
              );
            }
            final rows = _rows;
            if (rows.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: const [
                  Text('Nenhuma solicitação pendente para este espaço.'),
                ],
              );
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              itemCount: rows.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final row = rows[index] as Map<String, dynamic>;
                final id = (row['id'] as num).toInt();
                final tower = row['tower'] as String? ?? '';
                final number = row['number'] as String? ?? '';
                final requester =
                    (row['requester_name'] as String? ?? '').trim();
                final starts = _splitDate(row['starts_at']?.toString() ?? '');
                final ends = _splitDate(row['ends_at']?.toString() ?? '');

                return Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: cs.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: cs.outlineVariant),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Bl. $tower · Apartamento $number',
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (requester.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          'Solicitante: $requester',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                      const SizedBox(height: 6),
                      Text(
                        'Período: $starts → $ends',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: cs.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () => _confirmAndSet(id, 'rejected'),
                              child: const Text('Recusar'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: FilledButton(
                              onPressed: () => _confirmAndSet(id, 'approved'),
                              child: const Text('Aprovar'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

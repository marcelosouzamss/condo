import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/maintenance_format_utils.dart';
import 'package:condo_app/relation_center_pages.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

/// Morador: solicita manutenção apenas para a unidade resolvida em [resolveResidentUnitIdForCondo].
class ResidentMaintenancePage extends StatefulWidget {
  const ResidentMaintenancePage({
    super.key,
    required this.condoId,
    required this.userId,
  });

  final int condoId;
  final int userId;

  @override
  State<ResidentMaintenancePage> createState() =>
      _ResidentMaintenancePageState();
}

class _ResidentMaintenancePageState extends State<ResidentMaintenancePage> {
  int? _unitId;
  String _unitLabel = '';
  bool _loadingUnit = true;
  String? _unitError;

  List<Map<String, dynamic>> _requests = [];
  bool _loadingList = false;
  bool _submitting = false;

  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  String _priority = 'normal';

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    setState(() {
      _loadingUnit = true;
      _unitError = null;
    });
    final uid = await resolveResidentUnitIdForCondo(widget.condoId);
    if (!mounted) {
      return;
    }
    if (uid == null) {
      setState(() {
        _loadingUnit = false;
        _unitError =
            'Não foi possível identificar sua unidade. Defina em Minha Unidade.';
      });
      return;
    }
    final label = await _fetchUnitLabel(uid);
    if (!mounted) {
      return;
    }
    setState(() {
      _unitId = uid;
      _unitLabel = label;
      _loadingUnit = false;
    });
    await _loadRequests();
  }

  Future<String> _fetchUnitLabel(int unitId) async {
    try {
      final r = await http.get(
        CondoApi.uri('/api/units', {'condoId': '${widget.condoId}'}),
      );
      if (r.statusCode != 200) {
        return 'Unidade #$unitId';
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      for (final raw in list) {
        final u = raw as Map<String, dynamic>;
        if ((u['id'] as num).toInt() == unitId) {
          final t = u['tower'] as String? ?? '';
          final n = u['number'] as String? ?? '';
          return 'Torre $t · $n';
        }
      }
    } catch (_) {}
    return 'Unidade #$unitId';
  }

  Future<void> _loadRequests() async {
    final uid = _unitId;
    if (uid == null) {
      return;
    }
    setState(() => _loadingList = true);
    try {
      final r = await http.get(
        CondoApi.uri('/api/maintenance-requests', {
          'condoId': '${widget.condoId}',
          'unitId': '$uid',
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        setState(() => _loadingList = false);
        return;
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      setState(() {
        _requests =
            list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _loadingList = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _loadingList = false);
      }
    }
  }

  static String _statusPt(String? s) {
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
        return s ?? '';
    }
  }

  static String _priorityPt(String? p) {
    switch (p) {
      case 'low':
        return 'Baixa';
      case 'high':
        return 'Alta';
      default:
        return 'Normal';
    }
  }

  Future<void> _submit() async {
    final uid = _unitId;
    if (uid == null) {
      return;
    }
    final title = _titleCtrl.text.trim();
    final desc = _descCtrl.text.trim();
    if (title.isEmpty || desc.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Preencha título e descrição.')),
      );
      return;
    }
    setState(() => _submitting = true);
    try {
      final r = await http.post(
        CondoApi.uri('/api/maintenance-requests'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'unitId': uid,
          'title': title,
          'description': desc,
          'priority': _priority,
        }),
      );
      if (!mounted) {
        return;
      }
      setState(() => _submitting = false);
      if (r.statusCode != 201) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Não foi possível enviar (${r.statusCode}).')),
        );
        return;
      }
      _titleCtrl.clear();
      _descCtrl.clear();
      setState(() => _priority = 'normal');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Solicitação registrada.')),
      );
      await _loadRequests();
    } catch (_) {
      if (mounted) {
        setState(() => _submitting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Falha de rede.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    if (_loadingUnit) {
      return Scaffold(
        appBar: AppBar(title: const Text('Solicitar manutenção')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (_unitError != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Solicitar manutenção')),
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
                    child: const Text('Tentar novamente')),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Solicitar manutenção')),
      body: RefreshIndicator(
        onRefresh: _loadRequests,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Chamados relacionados à sua unidade: $_unitLabel',
              style: theme.textTheme.titleSmall?.copyWith(
                color: cs.primary,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Nova solicitação',
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _titleCtrl,
              decoration: const InputDecoration(
                labelText: 'Título',
                border: OutlineInputBorder(),
              ),
              textCapitalization: TextCapitalization.sentences,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _descCtrl,
              decoration: const InputDecoration(
                labelText: 'Descrição do problema',
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
              minLines: 3,
              maxLines: 8,
              textCapitalization: TextCapitalization.sentences,
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _priority,
              decoration: const InputDecoration(
                labelText: 'Prioridade',
                border: OutlineInputBorder(),
              ),
              items: const [
                DropdownMenuItem(value: 'low', child: Text('Baixa')),
                DropdownMenuItem(value: 'normal', child: Text('Normal')),
                DropdownMenuItem(value: 'high', child: Text('Alta')),
              ],
              onChanged: _submitting
                  ? null
                  : (v) {
                      if (v != null) {
                        setState(() => _priority = v);
                      }
                    },
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _submitting ? null : _submit,
              child: _submitting
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Enviar solicitação'),
            ),
            const SizedBox(height: 32),
            Row(
              children: [
                Text(
                  'Meus chamados',
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                if (_loadingList) ...[
                  const SizedBox(width: 12),
                  const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 8),
            if (!_loadingList && _requests.isEmpty)
              Text(
                'Nenhuma solicitação ainda.',
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: cs.onSurfaceVariant),
              ),
            ..._requests.map((m) {
              final id = (m['id'] as num).toInt();
              final title = m['title'] as String? ?? '';
              final st = m['status'] as String? ?? '';
              final resp = m['syndic_response'] as String?;
              final uid = _unitId;
              return Card(
                margin: const EdgeInsets.only(bottom: 10),
                child: InkWell(
                  onTap: uid == null
                      ? null
                      : () async {
                          await Navigator.of(context).push<void>(
                            MaterialPageRoute<void>(
                              builder: (ctx) => ResidentMaintenanceDetailPage(
                                condoId: widget.condoId,
                                unitId: uid,
                                userId: widget.userId,
                                maintenanceId: id,
                              ),
                            ),
                          );
                          if (mounted) {
                            await _loadRequests();
                          }
                        },
                  borderRadius: BorderRadius.circular(12),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                title,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            Icon(
                              Icons.chat_bubble_outline_rounded,
                              size: 18,
                              color: cs.onSurfaceVariant,
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${_statusPt(st)} · Prioridade: ${_priorityPt(m['priority'] as String?)} · Toque para conversa',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: cs.onSurfaceVariant,
                          ),
                        ),
                        if (resp != null && resp.trim().isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Text(
                            'Resposta (histórico): $resp',
                            style: theme.textTheme.bodySmall,
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              );
            }),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

/// Detalhe do chamado: mensagens e marcação de concluído (morador).
class ResidentMaintenanceDetailPage extends StatefulWidget {
  const ResidentMaintenanceDetailPage({
    super.key,
    required this.condoId,
    required this.unitId,
    required this.userId,
    required this.maintenanceId,
  });

  final int condoId;
  final int unitId;
  final int userId;
  final int maintenanceId;

  @override
  State<ResidentMaintenanceDetailPage> createState() =>
      _ResidentMaintenanceDetailPageState();
}

class _ResidentMaintenanceDetailPageState
    extends State<ResidentMaintenanceDetailPage> {
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

  Future<Map<String, dynamic>> _loadAll() async {
    final q = {
      'condoId': '${widget.condoId}',
      'unitId': '${widget.unitId}',
      'userId': '${widget.userId}',
    };
    final detailUrl = CondoApi.uri(
      '/api/maintenance-requests/${widget.maintenanceId}',
      q,
    );
    final msgUrl = CondoApi.uri(
      '/api/maintenance-requests/${widget.maintenanceId}/messages',
      q,
    );
    final dr = await http.get(detailUrl);
    if (dr.statusCode != 200) {
      throw Exception('Chamado não encontrado (${dr.statusCode})');
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

  Future<void> _sendMessage() async {
    final text = _msgCtrl.text.trim();
    if (text.isEmpty) {
      return;
    }
    final r = await http.post(
      CondoApi.uri(
        '/api/maintenance-requests/${widget.maintenanceId}/messages',
      ),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'unitId': widget.unitId,
        'userId': widget.userId,
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

  Future<void> _markCompleted() async {
    final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Concluir chamado'),
            content: const Text(
              'Confirma que a manutenção foi concluída? A equipe será informada pelo histórico.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancelar'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Marcar concluída'),
              ),
            ],
          ),
        ) ??
        false;
    if (!ok || !mounted) {
      return;
    }
    final r = await http.patch(
      CondoApi.uri('/api/maintenance-requests/${widget.maintenanceId}'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'unitId': widget.unitId,
        'userId': widget.userId,
        'status': 'completed',
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 200) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Chamado marcado como concluído.')),
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
      appBar: AppBar(title: const Text('Chamado de manutenção')),
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
          final status = m['status'] as String? ?? '';
          final legacy = (m['syndic_response'] as String?)?.trim();
          final canChat = status != 'completed' && status != 'closed';
          final canComplete = status != 'completed' && status != 'closed';
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
                  '${_maintenanceStatusPt(status)} · Prioridade: ${_maintenancePriorityPt(m['priority'] as String?)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: cs.onSurfaceVariant,
                  ),
                ),
                if (durationLine.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    durationLine,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: cs.onSurfaceVariant,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
                if (canComplete) ...[
                  const SizedBox(height: 12),
                  FilledButton.tonalIcon(
                    onPressed: _markCompleted,
                    icon: const Icon(Icons.task_alt_rounded),
                    label: const Text('Marcar manutenção como concluída'),
                  ),
                ],
                const SizedBox(height: 16),
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
                            'Mensagem da equipe (histórico)',
                            style: theme.textTheme.labelMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(legacy),
                        ],
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 20),
                Text(
                  'Conversa',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  canChat
                      ? 'Responda à equipe ou acrescente informações.'
                      : 'Este chamado está encerrado.',
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
                        isStaff ? Alignment.centerLeft : Alignment.centerRight,
                    child: ConstrainedBox(
                      constraints: BoxConstraints(
                        maxWidth: MediaQuery.of(context).size.width * 0.84,
                      ),
                      child: Card(
                        color: isStaff
                            ? cs.primaryContainer.withValues(alpha: 0.55)
                            : cs.secondaryContainer.withValues(alpha: 0.65),
                        margin: const EdgeInsets.only(bottom: 10),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                isStaff
                                    ? 'Equipe · ${CondoUserRoles.labelPt(ur)}${name.isNotEmpty ? ' · $name' : ''}'
                                    : (name.isNotEmpty ? name : 'Você'),
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
                      labelText: 'Sua mensagem',
                      border: OutlineInputBorder(),
                      alignLabelWithHint: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: _sendMessage,
                    icon: const Icon(Icons.send_rounded),
                    label: const Text('Enviar'),
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

String _maintenanceStatusPt(String st) {
  switch (st) {
    case 'open':
      return 'Aberto';
    case 'in_progress':
      return 'Em andamento';
    case 'completed':
      return 'Concluído';
    case 'closed':
      return 'Encerrado';
    default:
      return st;
  }
}

String _maintenancePriorityPt(String? p) {
  switch (p) {
    case 'low':
      return 'Baixa';
    case 'high':
      return 'Alta';
    default:
      return 'Normal';
  }
}

/// Síndico: pedidos agrupados por unidade.
class SyndicMaintenanceByUnitPage extends StatefulWidget {
  const SyndicMaintenanceByUnitPage({
    super.key,
    required this.condoId,
    required this.staffUserId,
  });

  final int condoId;
  final int staffUserId;

  @override
  State<SyndicMaintenanceByUnitPage> createState() =>
      _SyndicMaintenanceByUnitPageState();
}

class _SyndicMaintenanceByUnitPageState
    extends State<SyndicMaintenanceByUnitPage> {
  List<Map<String, dynamic>> _groups = [];
  bool _loading = true;
  Object? _error;

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
        CondoApi.uri('/api/syndic/maintenance-requests-by-unit', {
          'condoId': '${widget.condoId}',
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        setState(() {
          _loading = false;
          _error = Exception('${r.statusCode}');
        });
        return;
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      setState(() {
        _groups = list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  List<Map<String, dynamic>> _parseRequests(dynamic raw) {
    if (raw is List) {
      return raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    }
    return [];
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Manutenções solicitadas')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 120),
                  Center(child: CircularProgressIndicator()),
                ],
              )
            : _error != null
                ? ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(24),
                    children: [
                      Text(
                        'Erro ao carregar. Verifique ${CondoApi.baseUrl}.',
                        style: TextStyle(color: cs.error),
                      ),
                      const SizedBox(height: 16),
                      FilledButton(
                          onPressed: _load,
                          child: const Text('Tentar novamente')),
                    ],
                  )
                : _groups.isEmpty
                    ? ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        children: const [
                          Padding(
                            padding: EdgeInsets.all(24),
                            child: Text('Nenhuma solicitação por unidade.'),
                          ),
                        ],
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: _groups.length,
                        itemBuilder: (context, i) {
                          final g = _groups[i];
                          final tower = g['tower'] as String? ?? '';
                          final number = g['number'] as String? ?? '';
                          final resident = g['resident_name'] as String? ?? '';
                          final reqs = _parseRequests(g['requests']);
                          return Card(
                            margin: const EdgeInsets.only(bottom: 12),
                            child: ExpansionTile(
                              leading: CircleAvatar(
                                child: Text(
                                  number.isNotEmpty ? number : '?',
                                  style: const TextStyle(fontSize: 14),
                                ),
                              ),
                              title: Text(
                                'Torre $tower · $number',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w700),
                              ),
                              subtitle: Text(
                                resident.isNotEmpty
                                    ? resident
                                    : '${reqs.length} pedido(s)',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              children: reqs.map((m) {
                                final id = (m['id'] as num).toInt();
                                final title = m['title'] as String? ?? '';
                                final st = m['status'] as String? ?? '';
                                return ListTile(
                                  title: Text(
                                    title,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  subtitle: Text(_maintenanceStatusPt(st)),
                                  trailing:
                                      const Icon(Icons.chevron_right_rounded),
                                  onTap: () async {
                                    await Navigator.of(context).push<void>(
                                      MaterialPageRoute<void>(
                                        builder: (ctx) =>
                                            SyndicMaintenanceDetailPage(
                                          condoId: widget.condoId,
                                          maintenanceId: id,
                                          staffUserId: widget.staffUserId,
                                        ),
                                      ),
                                    );
                                    if (context.mounted) {
                                      await _load();
                                    }
                                  },
                                );
                              }).toList(),
                            ),
                          );
                        },
                      ),
      ),
    );
  }
}

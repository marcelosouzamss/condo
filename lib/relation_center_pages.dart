import 'dart:convert';

import 'package:condo_app/resident_unit_storage.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

/// Canal de atendimento na central de relacionamento.
abstract final class RelationChannels {
  static const syndic = 'syndic';
  static const administration = 'administration';
}

String relationChannelLabel(String channel) {
  switch (channel) {
    case RelationChannels.syndic:
      return 'Síndico';
    case RelationChannels.administration:
      return 'Administração';
    default:
      return channel;
  }
}

String _shortTime(String? iso) {
  if (iso == null || iso.isEmpty) {
    return '';
  }
  final d = DateTime.tryParse(iso);
  if (d == null) {
    return '';
  }
  final loc = d.toLocal();
  final dd = loc.day.toString().padLeft(2, '0');
  final mm = loc.month.toString().padLeft(2, '0');
  final hh = loc.hour.toString().padLeft(2, '0');
  final min = loc.minute.toString().padLeft(2, '0');
  return '$dd/$mm $hh:$min';
}

/// Lista de conversas por apartamento (síndico ou administração).
class StaffRelationInboxPage extends StatefulWidget {
  const StaffRelationInboxPage({
    super.key,
    required this.condoId,
    required this.channel,
  });

  final int condoId;
  /// [RelationChannels.syndic] ou [RelationChannels.administration].
  final String channel;

  @override
  State<StaffRelationInboxPage> createState() => _StaffRelationInboxPageState();
}

class _StaffRelationInboxPageState extends State<StaffRelationInboxPage> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<dynamic>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/relations/inbox', {
        'condoId': '${widget.condoId}',
        'channel': widget.channel,
      }),
    );
    if (r.statusCode != 200) {
      throw Exception('Erro ${r.statusCode}');
    }
    return jsonDecode(r.body) as List<dynamic>;
  }

  @override
  Widget build(BuildContext context) {
    final title = 'Conversas · ${relationChannelLabel(widget.channel)}';
    return Scaffold(
      appBar: AppBar(title: Text(title)),
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
                    'Não foi possível carregar. Verifique o backend em ${CondoApi.baseUrl}.',
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ],
              );
            }
            final rows = snap.data!;
            if (rows.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'Nenhuma conversa ainda. As threads aparecem quando um morador enviar a primeira mensagem.',
                    ),
                  ),
                ],
              );
            }
            return ListView.builder(
              itemCount: rows.length,
              itemBuilder: (context, i) {
                final m = rows[i] as Map<String, dynamic>;
                final tid = (m['thread_id'] as num).toInt();
                final tower = m['unit_tower'] as String? ?? '';
                final number = m['unit_number'] as String? ?? '';
                final resident = m['resident_name'] as String? ?? '';
                final lastBody = m['last_message_body'] as String? ?? '';
                final lastAt = m['last_message_at']?.toString();
                final subtitle = lastBody.isEmpty
                    ? (resident.isNotEmpty ? resident : 'Sem mensagens')
                    : (lastBody.length > 100
                        ? '${lastBody.substring(0, 97)}…'
                        : lastBody);
                return ListTile(
                  leading: CircleAvatar(
                    child: Text(
                      number.isNotEmpty ? number : '?',
                      style: const TextStyle(fontSize: 14),
                    ),
                  ),
                  title: Text(
                    'Torre $tower · $number',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  subtitle: Text(
                    [
                      if (_shortTime(lastAt).isNotEmpty) _shortTime(lastAt),
                      subtitle,
                    ].join(' · '),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () async {
                    await Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (ctx) => StaffRelationChatPage(
                          condoId: widget.condoId,
                          threadId: tid,
                          channel: widget.channel,
                          unitTower: tower,
                          unitNumber: number,
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

/// Tela de chat para morador (identifica thread por unidade + canal).
class ResidentRelationChatPage extends StatefulWidget {
  const ResidentRelationChatPage({
    super.key,
    required this.condoId,
    required this.unitId,
    required this.channel,
  });

  final int condoId;
  final int unitId;
  final String channel;

  @override
  State<ResidentRelationChatPage> createState() => _ResidentRelationChatPageState();
}

class _ResidentRelationChatPageState extends State<ResidentRelationChatPage> {
  final _ctrl = TextEditingController();
  List<Map<String, dynamic>> _messages = [];
  bool _loading = true;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await http.get(
        CondoApi.uri('/api/relations/conversation', {
          'condoId': '${widget.condoId}',
          'unitId': '${widget.unitId}',
          'channel': widget.channel,
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        setState(() {
          _loading = false;
          _error = 'Erro ao carregar (${r.statusCode}).';
        });
        return;
      }
      final decoded = jsonDecode(r.body) as Map<String, dynamic>;
      final raw = decoded['messages'] as List<dynamic>? ?? [];
      setState(() {
        _messages = raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Falha de rede.';
        });
      }
    }
  }

  Future<void> _send() async {
    final text = _ctrl.text.trim();
    if (text.isEmpty || _sending) {
      return;
    }
    setState(() => _sending = true);
    try {
      final r = await http.post(
        CondoApi.uri('/api/relations/messages'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'unitId': widget.unitId,
          'channel': widget.channel,
          'body': text,
          'senderSide': 'resident',
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 201) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Não enviado (${r.statusCode}).')),
        );
        setState(() => _sending = false);
        return;
      }
      _ctrl.clear();
      await _refresh();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Falha ao enviar.')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text('Chat · ${relationChannelLabel(widget.channel)}'),
      ),
      body: Column(
        children: [
          if (_loading)
            const Expanded(child: Center(child: CircularProgressIndicator()))
          else if (_error != null)
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!, textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: _refresh,
                        child: const Text('Tentar novamente'),
                      ),
                    ],
                  ),
                ),
              ),
            )
          else
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                itemCount: _messages.length,
                itemBuilder: (context, i) {
                  final msg = _messages[i];
                  final side = msg['sender_side'] as String? ?? '';
                  final isResident = side == 'resident';
                  final body = msg['body'] as String? ?? '';
                  final at = _shortTime(msg['created_at']?.toString());
                  return Align(
                    alignment:
                        isResident ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      constraints: BoxConstraints(
                        maxWidth: MediaQuery.sizeOf(context).width * 0.82,
                      ),
                      decoration: BoxDecoration(
                        color: isResident
                            ? cs.primaryContainer
                            : cs.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(16).copyWith(
                          bottomRight: isResident ? const Radius.circular(4) : null,
                          bottomLeft: !isResident ? const Radius.circular(4) : null,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            body,
                            style: theme.textTheme.bodyMedium,
                          ),
                          if (at.isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Text(
                              at,
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: cs.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _ctrl,
                      minLines: 1,
                      maxLines: 5,
                      decoration: const InputDecoration(
                        hintText: 'Digite sua mensagem…',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      textCapitalization: TextCapitalization.sentences,
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _sending ? null : _send,
                    icon: _sending
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send_rounded),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Chat na equipe (síndico/admin) com [threadId] fixo.
class StaffRelationChatPage extends StatefulWidget {
  const StaffRelationChatPage({
    super.key,
    required this.condoId,
    required this.threadId,
    required this.channel,
    required this.unitTower,
    required this.unitNumber,
  });

  final int condoId;
  final int threadId;
  final String channel;
  final String unitTower;
  final String unitNumber;

  @override
  State<StaffRelationChatPage> createState() => _StaffRelationChatPageState();
}

class _StaffRelationChatPageState extends State<StaffRelationChatPage> {
  final _ctrl = TextEditingController();
  List<Map<String, dynamic>> _messages = [];
  bool _loading = true;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await http.get(
        CondoApi.uri(
          '/api/relations/threads/${widget.threadId}',
          {'condoId': '${widget.condoId}'},
        ),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        setState(() {
          _loading = false;
          _error = 'Erro ao carregar (${r.statusCode}).';
        });
        return;
      }
      final decoded = jsonDecode(r.body) as Map<String, dynamic>;
      final raw = decoded['messages'] as List<dynamic>? ?? [];
      setState(() {
        _messages = raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Falha de rede.';
        });
      }
    }
  }

  Future<void> _send() async {
    final text = _ctrl.text.trim();
    if (text.isEmpty || _sending) {
      return;
    }
    setState(() => _sending = true);
    try {
      final r = await http.post(
        CondoApi.uri('/api/relations/messages'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'threadId': widget.threadId,
          'body': text,
          'senderSide': 'staff',
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 201) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Não enviado (${r.statusCode}).')),
        );
        setState(() => _sending = false);
        return;
      }
      _ctrl.clear();
      await _refresh();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Falha ao enviar.')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final unitLabel = 'Torre ${widget.unitTower} · ${widget.unitNumber}';

    return Scaffold(
      appBar: AppBar(
        title: Text(
          '${relationChannelLabel(widget.channel)} · $unitLabel',
          maxLines: 2,
        ),
      ),
      body: Column(
        children: [
          if (_loading)
            const Expanded(child: Center(child: CircularProgressIndicator()))
          else if (_error != null)
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!, textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: _refresh,
                        child: const Text('Tentar novamente'),
                      ),
                    ],
                  ),
                ),
              ),
            )
          else
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                itemCount: _messages.length,
                itemBuilder: (context, i) {
                  final msg = _messages[i];
                  final side = msg['sender_side'] as String? ?? '';
                  final isStaff = side == 'staff';
                  final body = msg['body'] as String? ?? '';
                  final at = _shortTime(msg['created_at']?.toString());
                  return Align(
                    alignment: isStaff ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      constraints: BoxConstraints(
                        maxWidth: MediaQuery.sizeOf(context).width * 0.82,
                      ),
                      decoration: BoxDecoration(
                        color: isStaff
                            ? cs.tertiaryContainer
                            : cs.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(16).copyWith(
                          bottomRight: isStaff ? const Radius.circular(4) : null,
                          bottomLeft: !isStaff ? const Radius.circular(4) : null,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(body, style: theme.textTheme.bodyMedium),
                          if (at.isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Text(
                              at,
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: cs.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _ctrl,
                      minLines: 1,
                      maxLines: 5,
                      decoration: const InputDecoration(
                        hintText: 'Resposta ao morador…',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      textCapitalization: TextCapitalization.sentences,
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _sending ? null : _send,
                    icon: _sending
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send_rounded),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Formulário de chamado: ruído ou área comum (`noise_complaint` / `common_area_issue`).
class ResidentOccurrenceReportPage extends StatefulWidget {
  const ResidentOccurrenceReportPage({
    super.key,
    required this.condoId,
    required this.unitId,
    required this.category,
    required this.defaultTitle,
  });

  final int condoId;
  final int unitId;
  final String category;
  final String defaultTitle;

  @override
  State<ResidentOccurrenceReportPage> createState() =>
      _ResidentOccurrenceReportPageState();
}

class _ResidentOccurrenceReportPageState extends State<ResidentOccurrenceReportPage> {
  late final TextEditingController _titleCtrl;
  late final TextEditingController _descCtrl;
  late final TextEditingController _nameCtrl;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _titleCtrl = TextEditingController(text: widget.defaultTitle);
    _descCtrl = TextEditingController();
    _nameCtrl = TextEditingController();
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _nameCtrl.dispose();
    super.dispose();
  }

  String get _pageTitle {
    if (widget.category == 'noise_complaint') {
      return 'Reclamação de ruído';
    }
    if (widget.category == 'common_area_issue') {
      return 'Problema em área comum';
    }
    return 'Novo chamado';
  }

  Future<void> _submit() async {
    final title = _titleCtrl.text.trim();
    final desc = _descCtrl.text.trim();
    if (title.isEmpty || desc.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Preencha título e descrição.'),
        ),
      );
      return;
    }
    setState(() => _sending = true);
    try {
      final r = await http.post(
        CondoApi.uri('/api/resident/occurrences'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'unitId': widget.unitId,
          'title': title,
          'description': desc,
          'category': widget.category,
          if (_nameCtrl.text.trim().isNotEmpty)
            'reporterName': _nameCtrl.text.trim(),
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 201) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Não registrado (${r.statusCode}).')),
        );
        setState(() => _sending = false);
        return;
      }
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Chamado registrado'),
          content: const Text(
            'Sua solicitação foi enviada ao síndico. Você pode acompanhar pelo painel de ocorrências.',
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('OK'),
            ),
          ],
        ),
      );
      if (mounted) {
        Navigator.of(context).pop();
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Falha de rede.')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isNoise = widget.category == 'noise_complaint';

    return Scaffold(
      appBar: AppBar(title: Text(_pageTitle)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            isNoise
                ? 'Descreva horário, unidade ou origem do barulho e a recorrência.'
                : 'Informe o local da área comum e o que precisa de reparo ou atenção.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _titleCtrl,
            decoration: const InputDecoration(
              labelText: 'Título resumido',
              border: OutlineInputBorder(),
            ),
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _descCtrl,
            decoration: InputDecoration(
              labelText: isNoise
                  ? 'Detalhes (horários, torre/apto, tipo de ruído)'
                  : 'Detalhes (local, desde quando, risco ou urgência)',
              border: const OutlineInputBorder(),
            ),
            minLines: 5,
            maxLines: 12,
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _nameCtrl,
            decoration: const InputDecoration(
              labelText: 'Seu nome (opcional)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _sending ? null : _submit,
            child: _sending
                ? const SizedBox(
                    height: 22,
                    width: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Enviar chamado'),
          ),
        ],
      ),
    );
  }
}

Future<List<Map<String, dynamic>>> fetchRelationUnitSummary({
  required int condoId,
  required int unitId,
}) async {
  final r = await http.get(
    CondoApi.uri('/api/relations/unit-summary', {
      'condoId': '$condoId',
      'unitId': '$unitId',
    }),
  );
  if (r.statusCode != 200) {
    return [];
  }
  final list = jsonDecode(r.body) as List<dynamic>;
  return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
}

/// Resolve [unitId] do morador (mesmo fluxo de reservas / mural).
Future<int?> resolveResidentUnitIdForCondo(int condoId) async {
  try {
    final savedId = await readResidentSelectedUnitId(
      CondoApi.residentSelectedUnitPrefKey(condoId),
    );
    final resp = await http.get(
      CondoApi.uri('/api/units', {'condoId': '$condoId'}),
    );
    if (resp.statusCode != 200) {
      return null;
    }
    final list = jsonDecode(resp.body) as List<dynamic>;
    int? matchFromList(int id) {
      for (final raw in list) {
        final u = raw as Map<String, dynamic>;
        final cid = u['condo_id'];
        final uid = u['id'];
        if (cid == condoId &&
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
        if (u['condo_id'] == condoId && u['id'] != null) {
          return (u['id'] as num).toInt();
        }
      }
      return null;
    }();
    return resolved;
  } catch (_) {
    return null;
  }
}

String subtitleFromSummary(List<Map<String, dynamic>> summary, String channel) {
  for (final r in summary) {
    if (r['channel'] == channel) {
      final body = r['last_message_body'] as String?;
      final at = r['last_message_at']?.toString();
      if (body != null && body.trim().isNotEmpty) {
        final short =
            body.length > 72 ? '${body.substring(0, 69)}…' : body;
        final t = _shortTime(at);
        return t.isEmpty ? short : '$short · $t';
      }
    }
  }
  return 'Nenhuma mensagem ainda. Toque para conversar.';
}

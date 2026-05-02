import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

/// Perfis elegíveis na API (`eligible_roles`).
const Map<String, String> _kPollAudienceRoleLabels = {
  'resident': 'Moradores',
  'collaborator': 'Colaboradores',
  'partner': 'Parceiros',
  'syndic': 'Síndico',
  'administrator': 'Administração',
};

String? _pollsApiMessage(http.Response r) {
  try {
    final m = jsonDecode(r.body);
    if (m is Map && m['message'] is String) {
      return m['message'] as String;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

class PollsHubPage extends StatefulWidget {
  const PollsHubPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
  });

  final int condoId;
  final int userId;
  final String userRole;

  @override
  State<PollsHubPage> createState() => _PollsHubPageState();
}

class _PollsHubPageState extends State<PollsHubPage> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;

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
        CondoApi.uri('/api/polls', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        }),
      );
      if (r.statusCode != 200) {
        throw Exception('Erro ${r.statusCode}');
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      if (!mounted) {
        return;
      }
      setState(() {
        _rows = list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  String _statusPt(String? s) {
    switch (s) {
      case 'draft':
        return 'Rascunho';
      case 'open':
        return 'Aberta';
      case 'closed':
        return 'Encerrada';
      default:
        return s ?? '';
    }
  }

  List<String> _eligibleLabels(dynamic raw) {
    if (raw is! List) {
      return [];
    }
    return raw
        .map((e) => _kPollAudienceRoleLabels[e.toString()] ?? e.toString())
        .toList();
  }

  bool _canEditRow(Map<String, dynamic> row) {
    final createdBy = (row['created_by_user_id'] as num?)?.toInt();
    if (createdBy == widget.userId) {
      return true;
    }
    return CondoUserRoles.isBillingStaff(widget.userRole);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Enquetes e Votações')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openCreatePoll(context),
        icon: const Icon(Icons.add_chart_rounded),
        label: const Text('Nova enquete'),
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Text(
              'Consultas e votações do condomínio.',
              style: theme.textTheme.titleMedium?.copyWith(
                color: cs.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: _buildBody(theme, cs),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(ThemeData theme, ColorScheme cs) {
    if (_loading) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: const [
          SizedBox(height: 120),
          Center(child: CircularProgressIndicator()),
        ],
      );
    }
    if (_error != null) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: [
          Text(_error!, style: TextStyle(color: cs.error)),
          const SizedBox(height: 16),
          FilledButton(onPressed: _load, child: const Text('Tentar novamente')),
        ],
      );
    }
    if (_rows.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            'Nenhuma enquete ainda. Use «Nova enquete» para criar.',
            style: theme.textTheme.bodyLarge?.copyWith(color: cs.onSurfaceVariant),
          ),
        ],
      );
    }
    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 88),
      itemCount: _rows.length,
      itemBuilder: (context, i) {
        final row = _rows[i];
        final title = row['title'] as String? ?? '';
        final status = row['status'] as String? ?? '';
        final votes = row['total_votes'];
        final aud = _eligibleLabels(row['eligible_roles']).join(', ');
        final id = (row['id'] as num).toInt();

        return Card(
          margin: const EdgeInsets.only(bottom: 10),
          child: ListTile(
            title: Text(title, maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: Text(
              [
                _statusPt(status),
                if (votes is num) '${votes.toInt()} voto(s)',
                if (aud.isNotEmpty) 'Quem responde: $aud',
              ].join(' · '),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
            trailing: _canEditRow(row)
                ? IconButton(
                    icon: const Icon(Icons.delete_outline_rounded),
                    onPressed: () => _confirmDeletePoll(context, id, title),
                  )
                : null,
            onTap: () async {
              await Navigator.of(context).push<void>(
                MaterialPageRoute<void>(
                  builder: (ctx) => PollDetailPage(
                    condoId: widget.condoId,
                    userId: widget.userId,
                    userRole: widget.userRole,
                    pollId: id,
                  ),
                ),
              );
              await _load();
            },
          ),
        );
      },
    );
  }

  Future<void> _confirmDeletePoll(
    BuildContext context,
    int pollId,
    String title,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir enquete'),
        content: Text('Remover «$title»? Esta ação não pode ser desfeita.'),
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
        CondoApi.uri('/api/polls/$pollId', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 204) {
        messenger.showSnackBar(
          SnackBar(content: Text('Falha ao excluir (${r.statusCode}).')),
        );
        return;
      }
      messenger.showSnackBar(
        const SnackBar(content: Text('Enquete removida.')),
      );
      await _load();
    } catch (_) {
      if (!mounted) {
        return;
      }
      messenger.showSnackBar(
        const SnackBar(content: Text('Erro de rede.')),
      );
    }
  }

  Future<void> _openCreatePoll(BuildContext context) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => _CreatePollSheet(
        condoId: widget.condoId,
        userId: widget.userId,
      ),
    );
    await _load();
  }
}

class _CreatePollSheet extends StatefulWidget {
  const _CreatePollSheet({
    required this.condoId,
    required this.userId,
  });

  final int condoId;
  final int userId;

  @override
  State<_CreatePollSheet> createState() => _CreatePollSheetState();
}

class _CreatePollSheetState extends State<_CreatePollSheet> {
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final List<TextEditingController> _optionCtrls = [
    TextEditingController(),
    TextEditingController(),
  ];
  final Map<String, bool> _roleOn = {
    for (final k in _kPollAudienceRoleLabels.keys) k: k == 'resident',
  };

  DateTime? _closesLocal;
  bool _submitting = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    for (final c in _optionCtrls) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _pickCloseDateTime() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(days: 7)),
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: 365 * 3)),
    );
    if (d == null || !mounted) {
      return;
    }
    final t = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 23, minute: 59),
    );
    if (t == null || !mounted) {
      return;
    }
    setState(() {
      _closesLocal = DateTime(d.year, d.month, d.day, t.hour, t.minute);
    });
  }

  List<String> _selectedRoles() =>
      _roleOn.entries.where((e) => e.value).map((e) => e.key).toList();

  Future<void> _submit() async {
    final messenger = ScaffoldMessenger.of(context);
    final title = _titleCtrl.text.trim();
    if (title.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Informe o título da enquete.')),
      );
      return;
    }
    final opts = _optionCtrls.map((c) => c.text.trim()).where((s) => s.isNotEmpty).toList();
    if (opts.length < 2) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Defina pelo menos duas opções de resposta.')),
      );
      return;
    }
    final roles = _selectedRoles();
    if (roles.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Selecione quem pode responder.')),
      );
      return;
    }
    if (_closesLocal == null) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Escolha data e hora de encerramento.')),
      );
      return;
    }
    if (!_closesLocal!.isAfter(DateTime.now())) {
      messenger.showSnackBar(
        const SnackBar(content: Text('A data de encerramento deve ser no futuro.')),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      final createRes = await http.post(
        CondoApi.uri('/api/polls'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'userId': widget.userId,
          'kind': 'survey',
          'title': title,
          if (_descCtrl.text.trim().isNotEmpty) 'description': _descCtrl.text.trim(),
          'eligibleRoles': roles,
        }),
      );
      if (createRes.statusCode != 201) {
        throw Exception(_pollsApiMessage(createRes) ?? 'Erro ao criar (${createRes.statusCode})');
      }
      final poll = jsonDecode(createRes.body) as Map<String, dynamic>;
      final pollId = (poll['id'] as num).toInt();

      for (var i = 0; i < opts.length; i++) {
        final or = await http.post(
          CondoApi.uri('/api/polls/$pollId/options'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'condoId': widget.condoId,
            'userId': widget.userId,
            'label': opts[i],
            'sortOrder': i,
          }),
        );
        if (or.statusCode != 201) {
          throw Exception(_pollsApiMessage(or) ?? 'Erro ao criar opção (${or.statusCode})');
        }
      }

      final closesIso = _closesLocal!.toUtc().toIso8601String();
      final patch = await http.patch(
        CondoApi.uri('/api/polls/$pollId'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'userId': widget.userId,
          'status': 'open',
          'closesAt': closesIso,
        }),
      );
      if (patch.statusCode != 200) {
        throw Exception(_pollsApiMessage(patch) ?? 'Erro ao publicar (${patch.statusCode})');
      }

      if (!mounted) {
        return;
      }
      Navigator.pop(context);
      messenger.showSnackBar(
        const SnackBar(content: Text('Enquete publicada.')),
      );
    } catch (e) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Nova enquete', style: theme.textTheme.titleLarge),
            const SizedBox(height: 12),
            TextField(
              controller: _titleCtrl,
              decoration: const InputDecoration(
                labelText: 'Pergunta / título',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _descCtrl,
              decoration: const InputDecoration(
                labelText: 'Descrição (opcional)',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
            ),
            const SizedBox(height: 16),
            Text('Opções de resposta', style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            ...List.generate(_optionCtrls.length, (i) {
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _optionCtrls[i],
                        decoration: InputDecoration(
                          labelText: 'Opção ${i + 1}',
                          border: const OutlineInputBorder(),
                        ),
                      ),
                    ),
                    if (_optionCtrls.length > 2)
                      IconButton(
                        onPressed: () {
                          setState(() {
                            _optionCtrls.removeAt(i).dispose();
                          });
                        },
                        icon: const Icon(Icons.remove_circle_outline_rounded),
                      ),
                  ],
                ),
              );
            }),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () {
                  setState(() => _optionCtrls.add(TextEditingController()));
                },
                icon: const Icon(Icons.add_rounded),
                label: const Text('Adicionar opção'),
              ),
            ),
            const SizedBox(height: 8),
            Text('Quem pode responder', style: theme.textTheme.titleSmall),
            const SizedBox(height: 4),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: _kPollAudienceRoleLabels.entries.map((e) {
                return FilterChip(
                  label: Text(e.value),
                  selected: _roleOn[e.key] ?? false,
                  onSelected: (v) => setState(() => _roleOn[e.key] = v),
                );
              }).toList(),
            ),
            const SizedBox(height: 12),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Encerramento'),
              subtitle: Text(
                _closesLocal == null
                    ? 'Toque para definir data e hora'
                    : '${_closesLocal!.day.toString().padLeft(2, '0')}/${_closesLocal!.month.toString().padLeft(2, '0')}/${_closesLocal!.year} '
                        '${_closesLocal!.hour.toString().padLeft(2, '0')}:${_closesLocal!.minute.toString().padLeft(2, '0')}',
              ),
              trailing: const Icon(Icons.event_rounded),
              onTap: _pickCloseDateTime,
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
                  : const Text('Publicar enquete'),
            ),
          ],
        ),
      ),
    );
  }
}

class PollDetailPage extends StatefulWidget {
  const PollDetailPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
    required this.pollId,
  });

  final int condoId;
  final int userId;
  final String userRole;
  final int pollId;

  @override
  State<PollDetailPage> createState() => _PollDetailPageState();
}

class _PollDetailPageState extends State<PollDetailPage> {
  Map<String, dynamic>? _data;
  String? _error;
  bool _loading = true;
  int? _selectedOptionId;

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
        CondoApi.uri('/api/polls/${widget.pollId}', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        }),
      );
      if (r.statusCode != 200) {
        throw Exception('Erro ${r.statusCode}');
      }
      final map = Map<String, dynamic>.from(jsonDecode(r.body) as Map);
      if (!mounted) {
        return;
      }
      setState(() {
        _data = map;
        final my = map['myVoteOptionId'];
        _selectedOptionId = my is num ? my.toInt() : null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  Future<void> _submitVote() async {
    final optId = _selectedOptionId;
    if (optId == null || _data == null) {
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    try {
      final r = await http.post(
        CondoApi.uri('/api/polls/${widget.pollId}/vote'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'userId': widget.userId,
          'optionId': optId,
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 201) {
        final msg = _pollsApiMessage(r);
        messenger.showSnackBar(
          SnackBar(content: Text(msg ?? 'Não foi possível votar (${r.statusCode}).')),
        );
        return;
      }
      await _load();
      if (!mounted) {
        return;
      }
      messenger.showSnackBar(
        const SnackBar(content: Text('Voto registrado.')),
      );
    } catch (_) {
      if (!mounted) {
        return;
      }
      messenger.showSnackBar(
        const SnackBar(content: Text('Erro de rede.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Enquete')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: TextStyle(color: cs.error)))
              : _buildContent(theme, cs),
    );
  }

  Widget _buildContent(ThemeData theme, ColorScheme cs) {
    final d = _data!;
    final title = d['title'] as String? ?? '';
    final desc = (d['description'] as String?)?.trim();
    final status = d['status'] as String? ?? '';
    final phase = d['resultsPhase'] as String? ?? 'partial';
    final closesAt = d['closes_at']?.toString();
    final eligible = d['eligible_roles'] as List<dynamic>? ?? [];
    final totalVotes = d['totalVotes'];
    final results = d['results'] as List<dynamic>? ?? [];
    final mayVote = d['mayVote'] == true;
    final myVote = d['myVoteOptionId'];

    final phaseLabel =
        phase == 'final' ? 'Resultado final' : 'Resultados parciais';

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Text(title, style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
          if (desc != null && desc.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(desc, style: theme.textTheme.bodyMedium),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              Chip(label: Text(_statusChip(status))),
              Chip(
                avatar: Icon(
                  phase == 'final' ? Icons.flag_rounded : Icons.timelapse_rounded,
                  size: 18,
                  color: cs.primary,
                ),
                label: Text(phaseLabel),
              ),
            ],
          ),
          if (closesAt != null && closesAt.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'Encerra em ${_formatDt(closesAt)}',
              style: theme.textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant),
            ),
          ],
          if (eligible.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'Quem pode responder: ${eligible.map((e) => _kPollAudienceRoleLabels[e.toString()] ?? e).join(', ')}',
              style: theme.textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant),
            ),
          ],
          const SizedBox(height: 8),
          Text(
            'Total de votos: ${totalVotes is num ? totalVotes.toInt() : 0}',
            style: theme.textTheme.titleSmall,
          ),
          const SizedBox(height: 16),
          Text('Apuração', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          ...results.map((raw) {
            final m = Map<String, dynamic>.from(raw as Map);
            final label = m['label'] as String? ?? '';
            final pct = (m['percent'] as num?)?.toDouble() ?? 0;
            final count = m['voteCount'];
            final oid = (m['optionId'] as num).toInt();
            final voting = mayVote && status == 'open' && myVote == null;

            final bar = ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: pct > 0 ? (pct / 100).clamp(0.0, 1.0) : 0,
                minHeight: 10,
              ),
            );

            if (voting) {
              return Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: RadioListTile<int>(
                  contentPadding: EdgeInsets.zero,
                  value: oid,
                  groupValue: _selectedOptionId,
                  onChanged: (v) => setState(() => _selectedOptionId = v),
                  title: Text(label, style: theme.textTheme.titleSmall),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const SizedBox(height: 6),
                      bar,
                      const SizedBox(height: 4),
                      Text(
                        '${pct.toStringAsFixed(1)}% · ${count is num ? count.toInt() : 0} voto(s)',
                        style: theme.textTheme.labelSmall?.copyWith(color: cs.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
              );
            }

            return Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text(label, style: theme.textTheme.titleSmall)),
                      Text(
                        '${pct.toStringAsFixed(1)}% (${count is num ? count.toInt() : 0})',
                        style: theme.textTheme.labelMedium?.copyWith(color: cs.onSurfaceVariant),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  bar,
                ],
              ),
            );
          }),
          if (mayVote && status == 'open' && myVote == null) ...[
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _selectedOptionId == null ? null : _submitVote,
              child: const Text('Confirmar voto'),
            ),
          ],
          if (!mayVote && status == 'open') ...[
            const SizedBox(height: 16),
            Text(
              'Seu perfil não está autorizado a votar nesta enquete.',
              style: TextStyle(color: cs.onSurfaceVariant),
            ),
          ],
          if (status == 'draft') ...[
            const SizedBox(height: 16),
            Text(
              'Esta enquete ainda é rascunho.',
              style: TextStyle(color: cs.error),
            ),
          ],
        ],
      ),
    );
  }

  String _statusChip(String s) {
    switch (s) {
      case 'open':
        return 'Aberta';
      case 'closed':
        return 'Encerrada';
      case 'draft':
        return 'Rascunho';
      default:
        return s;
    }
  }

  String _formatDt(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) {
      return iso;
    }
    final l = d.toLocal();
    return '${l.day.toString().padLeft(2, '0')}/${l.month.toString().padLeft(2, '0')}/${l.year} '
        '${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }
}

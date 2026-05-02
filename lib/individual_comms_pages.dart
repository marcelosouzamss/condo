import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/relation_center_pages.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

/// Comunicados entre unidades e da equipe (síndico/administradora) para unidades.
class IndividualCommunicationsHubPage extends StatefulWidget {
  const IndividualCommunicationsHubPage({
    super.key,
    required this.userRole,
  });

  final String userRole;

  static const int condoId = 1;

  @override
  State<IndividualCommunicationsHubPage> createState() =>
      _IndividualCommunicationsHubPageState();
}

class _IndividualCommunicationsHubPageState extends State<IndividualCommunicationsHubPage> {
  int? _unitId;
  bool _loadingUnit = true;
  String? _unitError;

  bool get _isStaff => CondoUserRoles.isOperationalStaff(widget.userRole);

  String? get _staffApiRole =>
      CondoUserRoles.staffMessagingApiRole(widget.userRole);

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    if (_isStaff) {
      setState(() {
        _loadingUnit = false;
        _unitId = null;
        _unitError = null;
      });
      return;
    }
    setState(() {
      _loadingUnit = true;
      _unitError = null;
    });
    final uid = await resolveResidentUnitIdForCondo(IndividualCommunicationsHubPage.condoId);
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
    setState(() {
      _unitId = uid;
      _loadingUnit = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Comunicados Individuais'),
      ),
      body: _loadingUnit
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: cs.primary,
                    borderRadius: BorderRadius.circular(24),
                    boxShadow: [
                      BoxShadow(
                        color: cs.primary.withValues(alpha: 0.22),
                        blurRadius: 20,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Comunicação por unidade',
                        style: theme.textTheme.headlineSmall?.copyWith(
                          color: cs.onPrimary,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _isStaff
                            ? 'Envie comunicados privados para qualquer apartamento. '
                                'Os moradores leem na caixa de entrada da unidade.'
                            : 'Receba mensagens do síndico, da administradora ou de outras unidades. '
                                'Você também pode escrever para qualquer outro apartamento.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: cs.onPrimary.withValues(alpha: 0.9),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                if (_unitError != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(_unitError!),
                            const SizedBox(height: 12),
                            FilledButton(
                              onPressed: _bootstrap,
                              child: const Text('Tentar novamente'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                if (!_isStaff && _unitId != null) ...[
                  _HubTile(
                    icon: Icons.inbox_rounded,
                    title: 'Caixa de entrada',
                    subtitle: 'Comunicados recebidos nesta unidade',
                    onTap: () {
                      Navigator.of(context).push<void>(
                        MaterialPageRoute<void>(
                          builder: (ctx) => IndividualCommInboxPage(
                            condoId: IndividualCommunicationsHubPage.condoId,
                            unitId: _unitId!,
                          ),
                        ),
                      );
                    },
                  ),
                  _HubTile(
                    icon: Icons.edit_outlined,
                    title: 'Novo comunicado',
                    subtitle: 'Enviar mensagem para outra unidade',
                    onTap: () {
                      Navigator.of(context).push<void>(
                        MaterialPageRoute<void>(
                          builder: (ctx) => IndividualCommComposeResidentPage(
                            condoId: IndividualCommunicationsHubPage.condoId,
                            fromUnitId: _unitId!,
                          ),
                        ),
                      );
                    },
                  ),
                  _HubTile(
                    icon: Icons.outbox_rounded,
                    title: 'Enviados',
                    subtitle: 'Histórico do que esta unidade enviou',
                    onTap: () {
                      Navigator.of(context).push<void>(
                        MaterialPageRoute<void>(
                          builder: (ctx) => IndividualCommSentByUnitPage(
                            condoId: IndividualCommunicationsHubPage.condoId,
                            unitId: _unitId!,
                          ),
                        ),
                      );
                    },
                  ),
                ],
                if (_isStaff && _staffApiRole != null) ...[
                  _HubTile(
                    icon: Icons.send_rounded,
                    title: 'Novo para unidade',
                    subtitle:
                        'Enviar comunicado privado a qualquer apartamento',
                    onTap: () {
                      Navigator.of(context).push<void>(
                        MaterialPageRoute<void>(
                          builder: (ctx) => IndividualCommComposeStaffPage(
                            condoId: IndividualCommunicationsHubPage.condoId,
                            fromStaffRole: _staffApiRole!,
                          ),
                        ),
                      );
                    },
                  ),
                  _HubTile(
                    icon: Icons.history_rounded,
                    title: 'Meus envios',
                    subtitle: 'Leitura e confirmação por unidade destino',
                    onTap: () {
                      Navigator.of(context).push<void>(
                        MaterialPageRoute<void>(
                          builder: (ctx) => IndividualCommStaffSentPage(
                            condoId: IndividualCommunicationsHubPage.condoId,
                            staffRole: _staffApiRole!,
                          ),
                        ),
                      );
                    },
                  ),
                ],
              ],
            ),
    );
  }
}

class _HubTile extends StatelessWidget {
  const _HubTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: cs.outlineVariant),
      ),
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: cs.primaryContainer,
          child: Icon(icon, color: cs.onPrimaryContainer),
        ),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: onTap,
      ),
    );
  }
}

String _unitLabel(Map<String, dynamic> m, String towerKey, String numberKey) {
  final t = m[towerKey] as String? ?? '';
  final n = m[numberKey] as String? ?? '';
  return 'Torre $t · $n';
}

String _senderLabel(Map<String, dynamic> m) {
  final sr = m['from_staff_role'] as String?;
  if (sr == 'syndic') {
    return 'Síndico';
  }
  if (sr == 'administrator') {
    return 'Administração';
  }
  if (sr == 'collaborator') {
    return 'Colaboradores';
  }
  return _unitLabel(m, 'from_tower', 'from_number');
}

String _formatCommTime(String? iso) {
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
  final yyyy = loc.year.toString();
  final hh = loc.hour.toString().padLeft(2, '0');
  final min = loc.minute.toString().padLeft(2, '0');
  return '$dd/$mm/$yyyy $hh:$min';
}

class IndividualCommInboxPage extends StatefulWidget {
  const IndividualCommInboxPage({
    super.key,
    required this.condoId,
    required this.unitId,
  });

  final int condoId;
  final int unitId;

  @override
  State<IndividualCommInboxPage> createState() => _IndividualCommInboxPageState();
}

class _IndividualCommInboxPageState extends State<IndividualCommInboxPage> {
  late Future<List<Map<String, dynamic>>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/individual-comms/inbox', {
        'condoId': '${widget.condoId}',
        'unitId': '${widget.unitId}',
      }),
    );
    if (r.statusCode != 200) {
      throw Exception('Erro ${r.statusCode}');
    }
    final list = jsonDecode(r.body) as List<dynamic>;
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Caixa de entrada')),
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() => _future = _load());
          await _future;
        },
        child: FutureBuilder<List<Map<String, dynamic>>>(
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
                    'Não foi possível carregar. Verifique ${CondoApi.baseUrl}.',
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ],
              );
            }
            final items = snap.data!;
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('Nenhum comunicado recebido.'),
                  ),
                ],
              );
            }
            return ListView.builder(
              itemCount: items.length,
              itemBuilder: (context, i) {
                final it = items[i];
                final id = (it['id'] as num).toInt();
                final subject = it['subject'] as String? ?? '';
                final readAt = it['read_at'];
                final isUnread = readAt == null;
                return ListTile(
                  leading: Icon(
                    isUnread ? Icons.mark_email_unread_rounded : Icons.mark_email_read_rounded,
                  ),
                  title: Text(
                    subject,
                    style: TextStyle(
                      fontWeight: isUnread ? FontWeight.w800 : FontWeight.w600,
                    ),
                  ),
                  subtitle: Text(
                    '${_senderLabel(it)} · ${_formatCommTime(it['created_at']?.toString())}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () async {
                    await Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (ctx) => IndividualCommDetailPage(
                          condoId: widget.condoId,
                          commId: id,
                          viewerUnitId: widget.unitId,
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

class IndividualCommSentByUnitPage extends StatefulWidget {
  const IndividualCommSentByUnitPage({
    super.key,
    required this.condoId,
    required this.unitId,
  });

  final int condoId;
  final int unitId;

  @override
  State<IndividualCommSentByUnitPage> createState() =>
      _IndividualCommSentByUnitPageState();
}

class _IndividualCommSentByUnitPageState extends State<IndividualCommSentByUnitPage> {
  late Future<List<Map<String, dynamic>>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/individual-comms/sent-by-unit', {
        'condoId': '${widget.condoId}',
        'unitId': '${widget.unitId}',
      }),
    );
    if (r.statusCode != 200) {
      throw Exception('Erro ${r.statusCode}');
    }
    final list = jsonDecode(r.body) as List<dynamic>;
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Enviados')),
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() => _future = _load());
          await _future;
        },
        child: FutureBuilder<List<Map<String, dynamic>>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    'Erro ao carregar.',
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ),
              );
            }
            final items = snap.data!;
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('Nenhum envio registrado.'),
                  ),
                ],
              );
            }
            return ListView.builder(
              itemCount: items.length,
              itemBuilder: (context, i) {
                final it = items[i];
                final id = (it['id'] as num).toInt();
                final subject = it['subject'] as String? ?? '';
                return ListTile(
                  title: Text(subject, style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text(
                    'Para ${_unitLabel(it, 'to_tower', 'to_number')} · '
                    '${_formatCommTime(it['created_at']?.toString())}',
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () {
                    Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (ctx) => IndividualCommDetailPage(
                          condoId: widget.condoId,
                          commId: id,
                          viewerUnitId: widget.unitId,
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

class IndividualCommStaffSentPage extends StatefulWidget {
  const IndividualCommStaffSentPage({
    super.key,
    required this.condoId,
    required this.staffRole,
  });

  final int condoId;
  final String staffRole;

  @override
  State<IndividualCommStaffSentPage> createState() => _IndividualCommStaffSentPageState();
}

class _IndividualCommStaffSentPageState extends State<IndividualCommStaffSentPage> {
  late Future<List<Map<String, dynamic>>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/individual-comms/staff-sent', {
        'condoId': '${widget.condoId}',
        'role': widget.staffRole,
      }),
    );
    if (r.statusCode != 200) {
      throw Exception('Erro ${r.statusCode}');
    }
    final list = jsonDecode(r.body) as List<dynamic>;
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Meus envios')),
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() => _future = _load());
          await _future;
        },
        child: FutureBuilder<List<Map<String, dynamic>>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return Center(
                child: Text(
                  'Erro ao carregar.',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              );
            }
            final items = snap.data!;
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('Nenhum comunicado enviado ainda.'),
                  ),
                ],
              );
            }
            return ListView.builder(
              itemCount: items.length,
              itemBuilder: (context, i) {
                final it = items[i];
                final id = (it['id'] as num).toInt();
                final subject = it['subject'] as String? ?? '';
                final read = it['read_at'] != null;
                return ListTile(
                  leading: Icon(
                    read ? Icons.mark_email_read_rounded : Icons.mark_email_unread_rounded,
                  ),
                  title: Text(subject, style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text(
                    'Para ${_unitLabel(it, 'to_tower', 'to_number')} · '
                    '${read ? 'Lido' : 'Não lido'} · '
                    '${_formatCommTime(it['created_at']?.toString())}',
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () {
                    Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (ctx) => IndividualCommDetailPage(
                          condoId: widget.condoId,
                          commId: id,
                          viewerStaffRole: widget.staffRole,
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

class IndividualCommDetailPage extends StatefulWidget {
  const IndividualCommDetailPage({
    super.key,
    required this.condoId,
    required this.commId,
    this.viewerUnitId,
    this.viewerStaffRole,
  }) : assert(
          (viewerUnitId != null) != (viewerStaffRole != null),
          'Informe viewerUnitId OU viewerStaffRole',
        );

  final int condoId;
  final int commId;
  final int? viewerUnitId;
  final String? viewerStaffRole;

  @override
  State<IndividualCommDetailPage> createState() => _IndividualCommDetailPageState();
}

class _IndividualCommDetailPageState extends State<IndividualCommDetailPage> {
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Map<String, dynamic>> _load() async {
    final q = widget.viewerUnitId != null
        ? {
            'condoId': '${widget.condoId}',
            'viewerUnitId': '${widget.viewerUnitId}',
          }
        : {
            'condoId': '${widget.condoId}',
            'viewerStaffRole': widget.viewerStaffRole!,
          };
    final r = await http.get(
      CondoApi.uri('/api/individual-comms/${widget.commId}', q),
    );
    if (r.statusCode != 200) {
      throw Exception('Erro ${r.statusCode}');
    }
    final data = Map<String, dynamic>.from(jsonDecode(r.body) as Map);
    await _markReadIfRecipient(data);
    return data;
  }

  Future<void> _markReadIfRecipient(Map<String, dynamic> data) async {
    final toId = (data['to_unit_id'] as num).toInt();
    if (widget.viewerUnitId != null && widget.viewerUnitId == toId) {
      await http.patch(
        CondoApi.uri('/api/individual-comms/${widget.commId}/read'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'unitId': widget.viewerUnitId,
        }),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Comunicado')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError || !snap.hasData) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  'Não foi possível abrir este comunicado.',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            );
          }
          final d = snap.data!;

          final toTxt = _unitLabel(d, 'to_tower', 'to_number');
          final fromTxt = _senderLabel(d);
          final readAt = d['read_at']?.toString();
          final isRecipient =
              widget.viewerUnitId != null &&
              (d['to_unit_id'] as num).toInt() == widget.viewerUnitId;

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                d['subject'] as String? ?? '',
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'De: $fromTxt',
                style: theme.textTheme.bodyMedium,
              ),
              Text(
                'Para: $toTxt',
                style: theme.textTheme.bodyMedium,
              ),
              Text(
                'Enviado em ${_formatCommTime(d['created_at']?.toString())}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              if (isRecipient) ...[
                const SizedBox(height: 4),
                Text(
                  readAt != null
                      ? 'Lido em ${_formatCommTime(readAt)}'
                      : 'Ainda não marcado como lido',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              if (widget.viewerStaffRole != null && readAt != null) ...[
                const SizedBox(height: 4),
                Text(
                  'Lido pelo destinatário em ${_formatCommTime(readAt)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.tertiary,
                  ),
                ),
              ],
              const Divider(height: 32),
              Text(
                d['body'] as String? ?? '',
                style: theme.textTheme.bodyLarge,
              ),
            ],
          );
        },
      ),
    );
  }
}

mixin _UnitPickerMixin<T extends StatefulWidget> on State<T> {
  int condoId = 1;
  List<Map<String, dynamic>> units = [];
  bool unitsLoading = true;
  int? selectedToUnitId;

  Future<void> loadUnits({required int? excludeUnitId}) async {
    setState(() {
      unitsLoading = true;
    });
    try {
      final r = await http.get(
        CondoApi.uri('/api/units', {'condoId': '$condoId'}),
      );
      if (!mounted || r.statusCode != 200) {
        setState(() => unitsLoading = false);
        return;
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      var mapped =
          list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      if (excludeUnitId != null) {
        mapped = mapped
            .where((u) => (u['id'] as num).toInt() != excludeUnitId)
            .toList();
      }
      setState(() {
        units = mapped;
        unitsLoading = false;
        if (mapped.isNotEmpty) {
          selectedToUnitId ??= (mapped.first['id'] as num).toInt();
        }
      });
    } catch (_) {
      if (mounted) {
        setState(() => unitsLoading = false);
      }
    }
  }

  String unitLine(Map<String, dynamic> u) {
    final t = u['tower'] as String? ?? '';
    final n = u['number'] as String? ?? '';
    return 'Torre $t · $n';
  }
}

class IndividualCommComposeResidentPage extends StatefulWidget {
  const IndividualCommComposeResidentPage({
    super.key,
    required this.condoId,
    required this.fromUnitId,
  });

  final int condoId;
  final int fromUnitId;

  @override
  State<IndividualCommComposeResidentPage> createState() =>
      _IndividualCommComposeResidentPageState();
}

class _IndividualCommComposeResidentPageState extends State<IndividualCommComposeResidentPage>
    with _UnitPickerMixin {
  final _subject = TextEditingController();
  final _body = TextEditingController();
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    condoId = widget.condoId;
    loadUnits(excludeUnitId: widget.fromUnitId);
  }

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final to = selectedToUnitId;
    if (to == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Selecione a unidade destino.')),
      );
      return;
    }
    final sub = _subject.text.trim();
    final bd = _body.text.trim();
    if (sub.isEmpty || bd.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Preencha assunto e mensagem.')),
      );
      return;
    }
    setState(() => _sending = true);
    try {
      final r = await http.post(
        CondoApi.uri('/api/individual-comms'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'toUnitId': to,
          'fromUnitId': widget.fromUnitId,
          'subject': sub,
          'body': bd,
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 201) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Falha ao enviar (${r.statusCode}).')),
        );
        setState(() => _sending = false);
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Comunicado enviado.')),
      );
      Navigator.of(context).pop();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erro de rede.')),
        );
        setState(() => _sending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Novo comunicado')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'A mensagem será entregue apenas à unidade selecionada.',
          ),
          const SizedBox(height: 16),
          if (unitsLoading)
            const Center(child: Padding(
              padding: EdgeInsets.all(24),
              child: CircularProgressIndicator(),
            ))
          else if (units.isEmpty)
            const Text('Nenhuma outra unidade disponível.')
          else
            DropdownButtonFormField<int>(
              value: selectedToUnitId,
              decoration: const InputDecoration(
                labelText: 'Unidade destino',
                border: OutlineInputBorder(),
              ),
              items: units
                  .map(
                    (u) => DropdownMenuItem<int>(
                      value: (u['id'] as num).toInt(),
                      child: Text(
                        '${unitLine(u)} (${u['resident_name'] ?? ''})'.trim(),
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (v) => setState(() => selectedToUnitId = v),
            ),
          const SizedBox(height: 16),
          TextField(
            controller: _subject,
            decoration: const InputDecoration(
              labelText: 'Assunto',
              border: OutlineInputBorder(),
            ),
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _body,
            decoration: const InputDecoration(
              labelText: 'Mensagem',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
            ),
            minLines: 5,
            maxLines: 14,
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _sending ? null : _send,
            child: _sending
                ? const SizedBox(
                    height: 22,
                    width: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Enviar'),
          ),
        ],
      ),
    );
  }
}

class IndividualCommComposeStaffPage extends StatefulWidget {
  const IndividualCommComposeStaffPage({
    super.key,
    required this.condoId,
    required this.fromStaffRole,
  });

  final int condoId;
  final String fromStaffRole;

  @override
  State<IndividualCommComposeStaffPage> createState() =>
      _IndividualCommComposeStaffPageState();
}

class _IndividualCommComposeStaffPageState extends State<IndividualCommComposeStaffPage>
    with _UnitPickerMixin {
  final _subject = TextEditingController();
  final _body = TextEditingController();
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    condoId = widget.condoId;
    loadUnits(excludeUnitId: null);
  }

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final to = selectedToUnitId;
    if (to == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Selecione a unidade destino.')),
      );
      return;
    }
    final sub = _subject.text.trim();
    final bd = _body.text.trim();
    if (sub.isEmpty || bd.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Preencha assunto e mensagem.')),
      );
      return;
    }
    setState(() => _sending = true);
    try {
      final r = await http.post(
        CondoApi.uri('/api/individual-comms'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'toUnitId': to,
          'fromStaffRole': widget.fromStaffRole,
          'subject': sub,
          'body': bd,
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 201) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Falha ao enviar (${r.statusCode}).')),
        );
        setState(() => _sending = false);
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Comunicado enviado à unidade.')),
      );
      Navigator.of(context).pop();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erro de rede.')),
        );
        setState(() => _sending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final who = CondoUserRoles.labelPt(widget.fromStaffRole);
    return Scaffold(
      appBar: AppBar(title: Text('Enviar como $who')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'O comunicado aparece na caixa de entrada do apartamento escolhido.',
            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 16),
          if (unitsLoading)
            const Center(child: CircularProgressIndicator())
          else
            DropdownButtonFormField<int>(
              value: selectedToUnitId,
              decoration: const InputDecoration(
                labelText: 'Unidade destino',
                border: OutlineInputBorder(),
              ),
              items: units
                  .map(
                    (u) => DropdownMenuItem<int>(
                      value: (u['id'] as num).toInt(),
                      child: Text(
                        '${unitLine(u)} (${u['resident_name'] ?? ''})'.trim(),
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (v) => setState(() => selectedToUnitId = v),
            ),
          const SizedBox(height: 16),
          TextField(
            controller: _subject,
            decoration: const InputDecoration(
              labelText: 'Assunto',
              border: OutlineInputBorder(),
            ),
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _body,
            decoration: const InputDecoration(
              labelText: 'Mensagem',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
            ),
            minLines: 5,
            maxLines: 14,
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _sending ? null : _send,
            child: _sending
                ? const SizedBox(
                    height: 22,
                    width: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Enviar'),
          ),
        ],
      ),
    );
  }
}

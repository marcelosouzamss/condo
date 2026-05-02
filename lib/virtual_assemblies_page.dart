import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

/// Assembleias virtuais: cadastro, vínculo com sala Jitsi e registro de presença.
class VirtualAssembliesPage extends StatefulWidget {
  const VirtualAssembliesPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
    required this.displayName,
  });

  final int condoId;
  final int userId;
  final String userRole;
  final String displayName;

  bool get canBillingManage => CondoUserRoles.isBillingStaff(userRole);

  @override
  State<VirtualAssembliesPage> createState() => _VirtualAssembliesPageState();
}

class _VirtualAssembliesPageState extends State<VirtualAssembliesPage> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<dynamic>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/virtual-assemblies', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      }),
    );
    if (r.statusCode != 200) {
      throw Exception('Falha ao carregar (${r.statusCode})');
    }
    final decoded = jsonDecode(r.body);
    return decoded as List<dynamic>;
  }

  Future<List<dynamic>> _loadVideoRooms() async {
    final r = await http.get(
      CondoApi.uri('/api/video-rooms', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
        'includeEnded': 'true',
      }),
    );
    if (r.statusCode != 200) {
      throw Exception('Falha ao carregar salas (${r.statusCode})');
    }
    return jsonDecode(r.body) as List<dynamic>;
  }

  Future<void> _openJoinUrl(String? url) async {
    if (url == null || url.isEmpty) {
      return;
    }
    final uri = Uri.parse(url);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!mounted) {
      return;
    }
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível abrir o link da sala.')),
      );
    }
  }

  Future<void> _refresh() async {
    setState(() {
      _future = _load();
    });
    await _future;
  }

  Future<void> _markAttendance(int assemblyId) async {
    final r = await http.post(
      CondoApi.uri('/api/virtual-assemblies/$assemblyId/attendance'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'userId': widget.userId,
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode != 201 && r.statusCode != 200) {
      final msg = r.body.isNotEmpty ? r.body : 'Erro ${r.statusCode}';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Presença: $msg')),
      );
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Presença registrada.')),
    );
    await _refresh();
  }

  Future<void> _deleteAssembly(int assemblyId) async {
    final uri = CondoApi.uri(
      '/api/virtual-assemblies/$assemblyId',
      {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      },
    );
    final r = await http.delete(uri);
    if (!mounted) {
      return;
    }
    if (r.statusCode != 204) {
      var msg = 'Erro ao excluir (${r.statusCode}).';
      if (r.statusCode == 409 && r.body.isNotEmpty) {
        try {
          final j = jsonDecode(r.body) as Map<String, dynamic>;
          final m = j['message'] as String?;
          if (m != null && m.isNotEmpty) {
            msg = m;
          }
        } catch (_) {}
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg)),
      );
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Assembleia excluída.')),
    );
    await _refresh();
  }

  Future<void> _confirmDelete(int assemblyId, String title) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir assembleia?'),
        content: Text('Confirma a exclusão de «$title»?'),
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
    if (ok == true && mounted) {
      await _deleteAssembly(assemblyId);
    }
  }

  Future<void> _createAssembly() async {
    List<dynamic> rooms = [];
    try {
      rooms = await _loadVideoRooms();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Não foi possível carregar as salas. Crie a assembleia sem vínculo.',
            ),
          ),
        );
      }
    }

    if (!mounted) {
      return;
    }

    final titleCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    var status = 'scheduled';
    int? videoRoomId;

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx2, setSt) => AlertDialog(
          title: const Text('Nova assembleia virtual'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: titleCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Título',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: descCtrl,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Descrição / pauta (opcional)',
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: status,
                  decoration: const InputDecoration(labelText: 'Situação'),
                  items: const [
                    DropdownMenuItem(value: 'draft', child: Text('Rascunho')),
                    DropdownMenuItem(
                      value: 'scheduled',
                      child: Text('Agendada'),
                    ),
                    DropdownMenuItem(value: 'live', child: Text('Ao vivo')),
                    DropdownMenuItem(
                      value: 'completed',
                      child: Text('Encerrada'),
                    ),
                    DropdownMenuItem(
                      value: 'cancelled',
                      child: Text('Cancelada'),
                    ),
                  ],
                  onChanged: (v) {
                    if (v != null) {
                      setSt(() {
                        status = v;
                      });
                    }
                  },
                ),
                const SizedBox(height: 12),
                if (rooms.isNotEmpty)
                  DropdownButtonFormField<int?>(
                    value: videoRoomId,
                    decoration: const InputDecoration(
                      labelText: 'Sala de videoconferência (opcional)',
                    ),
                    items: [
                      const DropdownMenuItem<int?>(
                        value: null,
                        child: Text('Nenhuma'),
                      ),
                      ...rooms.map((raw) {
                        final m = raw as Map<String, dynamic>;
                        final id = (m['id'] as num).toInt();
                        final t = m['title'] as String? ?? 'Sala $id';
                        return DropdownMenuItem<int?>(
                          value: id,
                          child: Text(t),
                        );
                      }),
                    ],
                    onChanged: (v) => setSt(() => videoRoomId = v),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Criar'),
            ),
          ],
        ),
      ),
    );

    if (ok != true || !mounted) {
      return;
    }

    final title = titleCtrl.text.trim();
    if (title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe o título.')),
      );
      return;
    }

    final body = <String, dynamic>{
      'condoId': widget.condoId,
      'userId': widget.userId,
      'title': title,
      'status': status,
      if (descCtrl.text.trim().isNotEmpty) 'description': descCtrl.text.trim(),
      if (videoRoomId != null) 'videoRoomId': videoRoomId,
    };

    final r = await http.post(
      CondoApi.uri('/api/virtual-assemblies'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );

    if (!mounted) {
      return;
    }

    if (r.statusCode != 201) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao criar (${r.statusCode}).')),
      );
      return;
    }

    await _refresh();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Assembleia criada.')),
      );
    }
  }

  Future<void> _editAssembly(Map<String, dynamic> row) async {
    List<dynamic> rooms = [];
    try {
      rooms = await _loadVideoRooms();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Não foi possível carregar as salas. A edição segue sem alterar o vínculo por lista.',
            ),
          ),
        );
      }
    }

    if (!mounted) {
      return;
    }

    final assemblyId = (row['id'] as num).toInt();
    final titleCtrl =
        TextEditingController(text: row['title'] as String? ?? '');
    final descCtrl =
        TextEditingController(text: row['description'] as String? ?? '');
    var status = row['status'] as String? ?? 'scheduled';
    final vidRaw = row['video_room_id'];
    int? videoRoomId = vidRaw == null ? null : (vidRaw as num).toInt();

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx2, setSt) => AlertDialog(
          title: const Text('Editar assembleia virtual'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: titleCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Título',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: descCtrl,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Descrição / pauta (opcional)',
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: status,
                  decoration: const InputDecoration(labelText: 'Situação'),
                  items: const [
                    DropdownMenuItem(value: 'draft', child: Text('Rascunho')),
                    DropdownMenuItem(
                      value: 'scheduled',
                      child: Text('Agendada'),
                    ),
                    DropdownMenuItem(value: 'live', child: Text('Ao vivo')),
                    DropdownMenuItem(
                      value: 'completed',
                      child: Text('Encerrada'),
                    ),
                    DropdownMenuItem(
                      value: 'cancelled',
                      child: Text('Cancelada'),
                    ),
                  ],
                  onChanged: (v) {
                    if (v != null) {
                      setSt(() {
                        status = v;
                      });
                    }
                  },
                ),
                const SizedBox(height: 12),
                if (rooms.isNotEmpty)
                  DropdownButtonFormField<int?>(
                    value: videoRoomId,
                    decoration: const InputDecoration(
                      labelText: 'Sala de videoconferência (opcional)',
                    ),
                    items: [
                      const DropdownMenuItem<int?>(
                        value: null,
                        child: Text('Nenhuma'),
                      ),
                      ...rooms.map((raw) {
                        final m = raw as Map<String, dynamic>;
                        final id = (m['id'] as num).toInt();
                        final t = m['title'] as String? ?? 'Sala $id';
                        return DropdownMenuItem<int?>(
                          value: id,
                          child: Text(t),
                        );
                      }),
                    ],
                    onChanged: (v) => setSt(() => videoRoomId = v),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Salvar'),
            ),
          ],
        ),
      ),
    );

    if (ok != true || !mounted) {
      return;
    }

    final title = titleCtrl.text.trim();
    if (title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe o título.')),
      );
      return;
    }

    final body = <String, dynamic>{
      'condoId': widget.condoId,
      'userId': widget.userId,
      'title': title,
      'status': status,
      'description': descCtrl.text.trim().isEmpty ? null : descCtrl.text.trim(),
      'videoRoomId': videoRoomId,
    };

    final r = await http.patch(
      CondoApi.uri('/api/virtual-assemblies/$assemblyId'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );

    if (!mounted) {
      return;
    }

    if (r.statusCode != 200) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao salvar (${r.statusCode}).')),
      );
      return;
    }

    await _refresh();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Assembleia atualizada.')),
      );
    }
  }

  Future<void> _showAttendanceList(int assemblyId, String assemblyTitle) async {
    final uri = CondoApi.uri('/api/virtual-assemblies/$assemblyId/attendance', {
      'condoId': '${widget.condoId}',
      'userId': '${widget.userId}',
    });
    final r = await http.get(uri);
    if (!mounted) {
      return;
    }
    if (r.statusCode != 200) {
      final msg = r.body.isNotEmpty ? r.body : 'Erro ${r.statusCode}';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Lista de presença: $msg')),
      );
      return;
    }
    final list = jsonDecode(r.body) as List<dynamic>;

    if (!mounted) {
      return;
    }

    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Presença registrada · $assemblyTitle'),
        content: SizedBox(
          width: double.maxFinite,
          height: 360,
          child: list.isEmpty
              ? Center(
                  child: Text(
                    'Ninguém registrou presença ainda.',
                    style: Theme.of(ctx).textTheme.bodyMedium,
                  ),
                )
              : ListView.separated(
                  itemCount: list.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (c, i) {
                    final m = list[i] as Map<String, dynamic>;
                    final name = m['full_name'] as String? ?? '';
                    final login = m['login'] as String? ?? '';
                    final role = m['role'] as String? ?? '';
                    final marked = m['marked_at']?.toString() ?? '';
                    String when = marked;
                    if (marked.length >= 16) {
                      when =
                          '${marked.substring(8, 10)}/${marked.substring(5, 7)}/${marked.substring(0, 4)} ${marked.substring(11, 16)}';
                    }
                    return ListTile(
                      dense: true,
                      title: Text(
                        name.isEmpty ? 'Usuário ${m['user_id']}' : name,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      subtitle: Text(
                        [
                          CondoUserRoles.labelPt(role),
                          if (login.isNotEmpty) '@$login',
                          if (when.isNotEmpty) when,
                        ].join(' · '),
                      ),
                    );
                  },
                ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Fechar'),
          ),
        ],
      ),
    );
  }

  String _statusLabel(String s) {
    switch (s) {
      case 'draft':
        return 'Rascunho';
      case 'scheduled':
        return 'Agendada';
      case 'live':
        return 'Ao vivo';
      case 'completed':
        return 'Encerrada';
      case 'cancelled':
        return 'Cancelada';
      default:
        return s;
    }
  }

  String? _fmtSchedule(Map<String, dynamic> row) {
    final start = row['scheduled_starts_at'];
    final end = row['scheduled_ends_at'];
    if (start == null && end == null) {
      return null;
    }
    String fmt(Object? v) {
      if (v == null) {
        return '';
      }
      final s = v.toString();
      if (s.length >= 16) {
        return '${s.substring(8, 10)}/${s.substring(5, 7)}/${s.substring(0, 4)} ${s.substring(11, 16)}';
      }
      return s;
    }

    if (start != null && end != null) {
      return '${fmt(start)} — ${fmt(end)}';
    }
    if (start != null) {
      return 'Início: ${fmt(start)}';
    }
    return 'Fim: ${fmt(end)}';
  }

  bool _asBool(dynamic v) {
    if (v is bool) {
      return v;
    }
    if (v is String) {
      return v.toLowerCase() == 'true' || v == 't';
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Assembleias Virtuais'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _refresh,
            tooltip: 'Atualizar',
          ),
        ],
      ),
      floatingActionButton: widget.canBillingManage
          ? FloatingActionButton.extended(
              onPressed: _createAssembly,
              icon: const Icon(Icons.add_rounded),
              label: const Text('Nova assembleia'),
            )
          : null,
      body: FutureBuilder<List<dynamic>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.cloud_off_rounded, size: 48, color: cs.error),
                    const SizedBox(height: 16),
                    Text(
                      'Não foi possível carregar as assembleias.\n${CondoApi.baseUrl}',
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _refresh,
                      child: const Text('Tentar de novo'),
                    ),
                  ],
                ),
              ),
            );
          }
          final list = snap.data ?? [];
          if (list.isEmpty) {
            return ListView(
              padding: const EdgeInsets.all(24),
              children: [
                Icon(Icons.groups_outlined, size: 56, color: cs.outline),
                const SizedBox(height: 16),
                Text(
                  widget.canBillingManage
                      ? 'Nenhuma assembleia cadastrada. Use «Nova assembleia», opcionalmente vinculada a uma sala Jitsi.'
                      : 'Não há assembleias publicadas no momento.',
                  style: Theme.of(context).textTheme.bodyLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  'Registre sua presença no dia do evento. A sala abre no navegador ou no app Jitsi Meet.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: cs.onSurfaceVariant,
                      ),
                  textAlign: TextAlign.center,
                ),
              ],
            );
          }

          return ListView.builder(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
            itemCount: list.length,
            itemBuilder: (context, i) {
              final row = list[i] as Map<String, dynamic>;
              final id = (row['id'] as num).toInt();
              final title = row['title'] as String? ?? '';
              final desc = row['description'] as String? ?? '';
              final status = row['status'] as String? ?? '';
              final joinUrl = row['joinUrl'] as String?;
              final vTitle = row['video_room_title'] as String?;
              final schedule = _fmtSchedule(row);
              final attCount = row['attendance_count'];
              final nPresent = attCount is num
                  ? attCount.toInt()
                  : int.tryParse('$attCount') ?? 0;
              final present = _asBool(row['i_present']);
              final canJoin = joinUrl != null &&
                  joinUrl.isNotEmpty &&
                  status != 'cancelled' &&
                  status != 'draft';
              final canMarkPresence =
                  status != 'draft' && status != 'cancelled';

              final canDelete = status != 'completed';

              return Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ListTile(
                        leading: CircleAvatar(
                          backgroundColor: status == 'live'
                              ? cs.primaryContainer
                              : cs.surfaceContainerHighest,
                          child: Icon(
                            Icons.groups_rounded,
                            color:
                                status == 'live' ? cs.onPrimaryContainer : null,
                          ),
                        ),
                        title: Text(title),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (desc.isNotEmpty) Text(desc),
                            if (schedule != null) Text(schedule),
                            if (vTitle != null && vTitle.isNotEmpty)
                              Text(
                                'Sala: $vTitle',
                                style: Theme.of(context)
                                    .textTheme
                                    .labelSmall
                                    ?.copyWith(color: cs.onSurfaceVariant),
                              ),
                            const SizedBox(height: 4),
                            Text(
                              'Situação: ${_statusLabel(status)} · '
                              '$nPresent participante(s)'
                              '${present ? ' · Você confirmou presença' : ''}',
                              style: Theme.of(context)
                                  .textTheme
                                  .labelMedium
                                  ?.copyWith(color: cs.primary),
                            ),
                          ],
                        ),
                        isThreeLine: desc.isNotEmpty || schedule != null,
                        trailing: widget.canBillingManage
                            ? PopupMenuButton<String>(
                                onSelected: (v) {
                                  if (v == 'edit') {
                                    _editAssembly(row);
                                  } else if (v == 'attendance') {
                                    _showAttendanceList(id, title);
                                  } else if (v == 'delete') {
                                    _confirmDelete(id, title);
                                  }
                                },
                                itemBuilder: (context) => [
                                  const PopupMenuItem(
                                    value: 'edit',
                                    child: Text('Editar'),
                                  ),
                                  const PopupMenuItem(
                                    value: 'attendance',
                                    child: Text('Lista de presença'),
                                  ),
                                  if (canDelete)
                                    const PopupMenuItem(
                                      value: 'delete',
                                      child: Text('Excluir'),
                                    ),
                                ],
                              )
                            : null,
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                        child: Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            FilledButton.tonal(
                              onPressed:
                                  canJoin ? () => _openJoinUrl(joinUrl) : null,
                              child: const Text('Entrar na sala'),
                            ),
                            OutlinedButton(
                              onPressed: canMarkPresence && !present
                                  ? () => _markAttendance(id)
                                  : null,
                              child: Text(
                                present ? 'Presença ok' : 'Registrar presença',
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

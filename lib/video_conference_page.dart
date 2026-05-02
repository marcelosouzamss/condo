import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

/// Salas de videoconferência (Jitsi Meet): dados no backend, abertura no navegador/app.
class VideoConferencePage extends StatefulWidget {
  const VideoConferencePage({
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

  bool get canManageStaff => CondoUserRoles.isOperationalStaff(userRole);

  @override
  State<VideoConferencePage> createState() => _VideoConferencePageState();
}

class _VideoConferencePageState extends State<VideoConferencePage> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<dynamic>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/video-rooms', {
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

  Future<void> _openJoinUrl(String url) async {
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

  Future<void> _createRoom() async {
    final titleCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    var status = 'live';

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx2, setSt) => AlertDialog(
          title: const Text('Nova sala (Jitsi Meet)'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: titleCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Título da reunião',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: descCtrl,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'Descrição (opcional)',
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: status,
                  decoration: const InputDecoration(labelText: 'Situação'),
                  items: const [
                    DropdownMenuItem(value: 'scheduled', child: Text('Agendada')),
                    DropdownMenuItem(
                      value: 'live',
                      child: Text('Ao vivo / aberta'),
                    ),
                    DropdownMenuItem(value: 'ended', child: Text('Encerrada')),
                  ],
                  onChanged: (v) {
                    if (v != null) {
                      setSt(() {
                        status = v;
                      });
                    }
                  },
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
      if (descCtrl.text.trim().isNotEmpty) 'description': descCtrl.text.trim(),
      'status': status,
    };

    final r = await http.post(
      CondoApi.uri('/api/video-rooms'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );

    if (!mounted) {
      return;
    }

    if (r.statusCode != 201) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao criar sala (${r.statusCode}).')),
      );
      return;
    }

    await _refresh();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Sala criada. Toque em Entrar para abrir o Jitsi Meet.',
          ),
        ),
      );
    }
  }

  String _statusLabel(String s) {
    switch (s) {
      case 'live':
        return 'Ao vivo';
      case 'scheduled':
        return 'Agendada';
      case 'ended':
        return 'Encerrada';
      default:
        return s;
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Videoconferência'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () => _refresh(),
            tooltip: 'Atualizar',
          ),
        ],
      ),
      floatingActionButton: widget.canManageStaff
          ? FloatingActionButton.extended(
              onPressed: _createRoom,
              icon: const Icon(Icons.video_call_rounded),
              label: const Text('Nova sala'),
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
                      'Não foi possível carregar as salas.\n${CondoApi.baseUrl}',
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
                Icon(Icons.videocam_off_outlined, size: 56, color: cs.outline),
                const SizedBox(height: 16),
                Text(
                  widget.canManageStaff
                      ? 'Nenhuma sala ativa. Use “Nova sala” para criar uma reunião Jitsi Meet.'
                      : 'Nenhuma sala disponível no momento.',
                  style: Theme.of(context).textTheme.bodyLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  'As reuniões abrem no Jitsi Meet (navegador ou app). '
                  'Identifique-se com seu nome ao entrar.',
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
              final title = row['title'] as String? ?? '';
              final desc = row['description'] as String? ?? '';
              final status = row['status'] as String? ?? '';
              final joinUrl = row['joinUrl'] as String? ?? '';
              return Card(
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: status == 'live'
                        ? cs.primaryContainer
                        : cs.surfaceContainerHighest,
                    child: Icon(
                      Icons.video_camera_front_rounded,
                      color: status == 'live' ? cs.onPrimaryContainer : null,
                    ),
                  ),
                  title: Text(title),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (desc.isNotEmpty) Text(desc),
                      const SizedBox(height: 4),
                      Text(
                        'Situação: ${_statusLabel(status)}',
                        style: Theme.of(context).textTheme.labelMedium?.copyWith(
                              color: cs.primary,
                            ),
                      ),
                    ],
                  ),
                  isThreeLine: desc.isNotEmpty,
                  trailing: FilledButton(
                    onPressed:
                        joinUrl.isEmpty ? null : () => _openJoinUrl(joinUrl),
                    child: const Text('Entrar'),
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

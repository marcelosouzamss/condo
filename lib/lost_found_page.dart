import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

/// Achados e perdidos: item perdido + avisos «Achei» de outros moradores.
/// Parceiros não acessam (API + menu).
class LostFoundPage extends StatefulWidget {
  const LostFoundPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
    this.unitId,
  });

  final int condoId;
  final int userId;
  final String userRole;
  final int? unitId;

  @override
  State<LostFoundPage> createState() => _LostFoundPageState();
}

class _LostFoundPageState extends State<LostFoundPage> {
  bool _loading = true;
  Object? _loadError;
  List<Map<String, dynamic>> _items = [];
  List<Map<String, dynamic>> _units = [];

  int _totalLost = 0;
  int _openLost = 0;
  int _resolvedLost = 0;

  bool get _isResident => widget.userRole == CondoUserRoles.resident;

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
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    await _loadUnits();
    await _reload();
  }

  Future<void> _loadUnits() async {
    try {
      final r = await http.get(
        CondoApi.uri('/api/units', {'condoId': '${widget.condoId}'}),
      );
      if (r.statusCode != 200 || !mounted) {
        return;
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      setState(() {
        _units = list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      });
    } catch (_) {
      /* ignore */
    }
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final listUri = CondoApi.uri('/api/lost-found', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
        'kind': 'lost',
        'onlyOpen': 'true',
      });
      final statsUri = CondoApi.uri('/api/lost-found/stats', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      });

      final responses = await Future.wait([
        http.get(listUri),
        http.get(statsUri),
      ]);

      final listResp = responses[0];
      final statsResp = responses[1];

      if (listResp.statusCode != 200) {
        throw Exception(_apiMessage(listResp));
      }
      if (statsResp.statusCode != 200) {
        throw Exception(_apiMessage(statsResp));
      }

      final list = jsonDecode(listResp.body) as List<dynamic>;
      final parsed =
          list.map((e) => Map<String, dynamic>.from(e as Map)).toList();

      final statsMap =
          jsonDecode(statsResp.body) as Map<String, dynamic>;
      final total =
          (statsMap['totalLost'] as num?)?.toInt() ?? 0;
      final open =
          (statsMap['openLost'] as num?)?.toInt() ?? 0;
      final resolved =
          (statsMap['resolvedLost'] as num?)?.toInt() ?? 0;

      if (!mounted) {
        return;
      }
      setState(() {
        _items = parsed;
        _totalLost = total;
        _openLost = open;
        _resolvedLost = resolved;
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

  bool _isCreator(Map<String, dynamic> row) {
    final creator = (row['created_by_user_id'] as num?)?.toInt();
    return creator != null && creator == widget.userId;
  }

  /// Só quem registrou pode editar texto/unidade/foto.
  bool _canEditItem(Map<String, dynamic> row) => _isCreator(row);

  /// Criador ou síndico/administração (excluem inclusive post de terceiros).
  bool _canDeleteItem(Map<String, dynamic> row) {
    if (_isCreator(row)) {
      return true;
    }
    return CondoUserRoles.isBillingStaff(widget.userRole);
  }

  /// Só quem registrou pode marcar como encontrado (remove da lista).
  bool _canMarkResolvedItem(Map<String, dynamic> row) => _isCreator(row);

  static const int _acheiMessageMaxLen = 600;

  List<Map<String, dynamic>> _acheiTipsFromRow(Map<String, dynamic> row) {
    final raw = row['achei_tips'];
    if (raw is! List<dynamic>) {
      return [];
    }
    return raw
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
  }

  Future<String?> _uploadPhoto(List<int> bytes, String filename) async {
    final uri = CondoApi.uri('/api/lost-found/upload-photo', {
      'condoId': '${widget.condoId}',
      'userId': '${widget.userId}',
    });
    final req = http.MultipartRequest('POST', uri)
      ..files.add(
        http.MultipartFile.fromBytes(
          'photo',
          bytes,
          filename: filename.isEmpty ? 'foto.jpg' : filename,
        ),
      );
    final streamed = await req.send();
    final resp = await http.Response.fromStream(streamed);
    if (resp.statusCode != 201) {
      return null;
    }
    final map = jsonDecode(resp.body) as Map<String, dynamic>;
    return map['photoUrl'] as String?;
  }

  Future<void> _showItemForm({Map<String, dynamic>? existing}) async {
    if (_units.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Nenhuma unidade cadastrada no condomínio.')),
      );
      return;
    }

    final isEdit = existing != null;
    final existingUnitId = existing != null
        ? (existing['unit_id'] as num?)?.toInt()
        : null;

    int? selectedUnit = widget.unitId ?? existingUnitId;
    if (_isResident && widget.unitId != null) {
      selectedUnit = widget.unitId;
    } else {
      selectedUnit ??= (_units.first['id'] as num).toInt();
    }

    final titleCtrl = TextEditingController(
      text: existing?['title'] as String? ?? '',
    );
    final descCtrl = TextEditingController(
      text: existing?['description'] as String? ?? '',
    );
    final contactCtrl = TextEditingController(
      text: existing?['contact_hint'] as String? ?? '',
    );
    String? photoUrl = existing?['photo_url'] as String?;
    List<int>? pendingBytes;
    String pendingName = '';

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
              return SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      isEdit ? 'Editar item perdido' : 'Registrar item perdido',
                      style: Theme.of(ctx).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 16),
                    if (_isResident && widget.unitId != null)
                      InputDecorator(
                        decoration: const InputDecoration(
                          labelText: 'Unidade',
                          border: OutlineInputBorder(),
                        ),
                        child: Text(
                          _unitLabelById(widget.unitId!) ??
                              'Unidade #${widget.unitId}',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      )
                    else
                      DropdownButtonFormField<int>(
                        value: selectedUnit,
                        decoration: const InputDecoration(
                          labelText: 'Unidade *',
                          border: OutlineInputBorder(),
                        ),
                        items: [
                          for (final u in _units)
                            DropdownMenuItem(
                              value: (u['id'] as num).toInt(),
                              child: Text(
                                'Torre ${u['tower'] ?? '?'} · ${u['number'] ?? '?'}',
                              ),
                            ),
                        ],
                        onChanged: _isResident && widget.unitId != null
                            ? null
                            : (v) => setLocal(() => selectedUnit = v),
                      ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: titleCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Descrição do item *',
                        hintText: 'Ex.: mochila azul, carteira marrom',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: descCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Detalhes (opcional)',
                        border: OutlineInputBorder(),
                      ),
                      maxLines: 3,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: contactCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Contato (opcional)',
                        hintText: 'Telefone, WhatsApp ou outra forma de contato',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: () async {
                        final pick = await FilePicker.platform.pickFiles(
                          type: FileType.image,
                          withData: true,
                        );
                        if (pick == null || pick.files.isEmpty) {
                          return;
                        }
                        final f = pick.files.single;
                        final bytes = f.bytes;
                        if (bytes == null) {
                          return;
                        }
                        setLocal(() {
                          pendingBytes = bytes;
                          pendingName = f.name;
                        });
                      },
                      icon: const Icon(Icons.add_photo_alternate_rounded),
                      label: Text(
                        pendingBytes != null
                            ? 'Nova foto: ${pendingName.isEmpty ? 'selecionada' : pendingName}'
                            : (photoUrl != null && photoUrl.isNotEmpty
                                ? 'Trocar foto'
                                : 'Adicionar foto (opcional)'),
                      ),
                    ),
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: Text(isEdit ? 'Salvar alterações' : 'Publicar'),
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

    final uid = selectedUnit;
    if (uid == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Selecione a unidade.')),
      );
      return;
    }

    final title = titleCtrl.text.trim();
    if (title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Descreva o item.')),
      );
      return;
    }

    String? finalPhoto = photoUrl;
    if (pendingBytes != null) {
      final uploaded = await _uploadPhoto(pendingBytes!, pendingName);
      if (uploaded == null) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Falha ao enviar a foto.')),
          );
        }
        return;
      }
      finalPhoto = uploaded;
    }

    try {
      if (isEdit) {
        final id = (existing['id'] as num).toInt();
        final body = <String, dynamic>{
          'condoId': widget.condoId,
          'userId': widget.userId,
          'unitId': uid,
          'title': title,
          'description': descCtrl.text.trim(),
          'contactHint': contactCtrl.text.trim(),
          if (finalPhoto != null && finalPhoto.isNotEmpty) 'photoUrl': finalPhoto,
        };
        final r = await http.patch(
          CondoApi.uri('/api/lost-found/$id'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        );
        if (!mounted) {
          return;
        }
        if (r.statusCode != 200) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(_apiMessage(r))),
          );
          return;
        }
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Item atualizado.')),
        );
      } else {
        final body = <String, dynamic>{
          'condoId': widget.condoId,
          'userId': widget.userId,
          'unitId': uid,
          'kind': 'lost',
          'title': title,
          'description': descCtrl.text.trim(),
          'contactHint': contactCtrl.text.trim(),
          if (finalPhoto != null && finalPhoto.isNotEmpty) 'photoUrl': finalPhoto,
        };
        final r = await http.post(
          CondoApi.uri('/api/lost-found'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        );
        if (!mounted) {
          return;
        }
        if (r.statusCode != 201) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(_apiMessage(r))),
          );
          return;
        }
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Item registrado.')),
        );
      }
      await _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$e')),
        );
      }
    }
  }

  String? _unitLabelById(int id) {
    for (final u in _units) {
      if ((u['id'] as num).toInt() == id) {
        return 'Torre ${u['tower'] ?? '?'} · ${u['number'] ?? '?'}';
      }
    }
    return null;
  }

  Future<void> _markResolved(Map<String, dynamic> row) async {
    final id = (row['id'] as num).toInt();
    final title = row['title'] as String? ?? '';

    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Item encontrado'),
        content: Text(
          'Marcar «$title» como encontrado? Ele deixa de aparecer na lista de perdidos.',
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
    if (go != true || !mounted) {
      return;
    }

    try {
      final r = await http.patch(
        CondoApi.uri('/api/lost-found/$id'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'userId': widget.userId,
          'status': 'resolved',
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_apiMessage(r))),
        );
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Item marcado como encontrado.')),
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

  Future<void> _showAcheiDialog(Map<String, dynamic> row) async {
    final id = (row['id'] as num).toInt();
    final title = row['title'] as String? ?? '';
    final msgCtrl = TextEditingController();

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Achei'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Se você encontrou ou viu este objeto, deixe uma mensagem para «$title». '
                'Quem cadastrou verá o aviso no card.',
                style: Theme.of(ctx).textTheme.bodySmall,
              ),
              const SizedBox(height: 16),
              TextField(
                controller: msgCtrl,
                decoration: const InputDecoration(
                  labelText: 'Sua mensagem *',
                  hintText: 'Ex.: entreguei na portaria / está na garagem',
                  border: OutlineInputBorder(),
                ),
                maxLines: 4,
                maxLength: _acheiMessageMaxLen,
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
            child: const Text('Publicar aviso'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) {
      return;
    }

    final text = msgCtrl.text.trim();
    if (text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Escreva uma mensagem.')),
      );
      return;
    }

    try {
      final r = await http.post(
        CondoApi.uri('/api/lost-found/$id/achei'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'userId': widget.userId,
          'message': text,
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 201) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_apiMessage(r))),
        );
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Aviso publicado no card.')),
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

  Future<void> _confirmDelete(Map<String, dynamic> row) async {
    final id = (row['id'] as num).toInt();
    final title = row['title'] as String? ?? '';

    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir registro'),
        content: Text(
          'Remover permanentemente «$title»? Esta ação não pode ser desfeita.',
        ),
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
        CondoApi.uri('/api/lost-found/$id', {
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
        const SnackBar(content: Text('Item removido.')),
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

  Widget _statsBar(ThemeData theme) {
    final cs = theme.colorScheme;
    Widget chip(String label, int value, Color bg) {
      return Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: [
              Text(
                '$value',
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                label,
                textAlign: TextAlign.center,
                style: theme.textTheme.labelSmall,
              ),
            ],
          ),
        ),
      );
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        chip('Total de itens perdidos', _totalLost, cs.primaryContainer.withValues(alpha: 0.55)),
        const SizedBox(width: 8),
        chip('Encontrados', _resolvedLost, cs.tertiaryContainer.withValues(alpha: 0.7)),
        const SizedBox(width: 8),
        chip('Ainda não encontrados', _openLost, cs.secondaryContainer.withValues(alpha: 0.65)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Achados e Perdidos'),
        actions: [
          IconButton(
            tooltip: 'Atualizar',
            onPressed: _reload,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _loading && _items.isEmpty && _loadError == null
          ? const Center(child: CircularProgressIndicator())
          : _loadError != null && _items.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('$_loadError', textAlign: TextAlign.center),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: _reload,
                          child: const Text('Tentar novamente'),
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _reload,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _statsBar(theme),
                      const SizedBox(height: 20),
                      Text(
                        'Itens perdidos (em aberto)',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Quem cadastrou pode marcar como encontrado. Qualquer morador pode clicar em «Achei» e deixar um aviso no card.',
                        style: theme.textTheme.bodySmall,
                      ),
                      const SizedBox(height: 16),
                      if (_items.isEmpty)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 32),
                          child: Text(
                            'Nenhum item perdido em aberto.',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodyLarge,
                          ),
                        )
                      else
                        ..._items.map((row) => _itemCard(row)),
                    ],
                  ),
                ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showItemForm(),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Item perdido'),
      ),
    );
  }

  Widget _itemCard(Map<String, dynamic> row) {
    final title = row['title'] as String? ?? '';
    final desc = row['description'] as String?;
    final contact = (row['contact_hint'] as String?)?.trim();
    final tower = row['unit_tower'] as String?;
    final number = row['unit_number'] as String?;
    final unitStr = (tower != null && number != null)
        ? 'Torre $tower · $number'
        : 'Unidade #${row['unit_id'] ?? '?'}';
    final photo = row['photo_url'] as String?;
    final created = row['created_at'] as String?;
    final tips = _acheiTipsFromRow(row);
    final canEdit = _canEditItem(row);
    final canDelete = _canDeleteItem(row);
    final canResolve = _canMarkResolvedItem(row);
    final showStaffActions = canEdit || canDelete || canResolve;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (photo != null && photo.isNotEmpty)
            AspectRatio(
              aspectRatio: 16 / 9,
              child: Image.network(
                CondoApi.uploadsUrl(photo),
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Container(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  alignment: Alignment.center,
                  child: const Icon(Icons.broken_image_rounded),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  unitStr,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.primary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (contact != null && contact.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.contact_phone_rounded,
                        size: 18,
                        color: Theme.of(context).colorScheme.outline,
                      ),
                      const SizedBox(width: 6),
                      Expanded(child: Text(contact)),
                    ],
                  ),
                ],
                if (desc != null && desc.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(desc),
                ],
                if (created != null && created.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      'Registrado em ${created.length >= 10 ? created.substring(0, 10) : created}',
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ),
                if (tips.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    'Avisos «Achei»',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 6),
                  ...tips.map((t) {
                    final who =
                        (t['author_name'] as String?)?.trim() ?? 'Morador';
                    final when = t['created_at'] as String?;
                    final whenShort = when != null && when.length >= 10
                        ? when.substring(0, 10)
                        : when;
                    final body =
                        (t['message'] as String?)?.trim() ?? '';
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Material(
                        color: Theme.of(context)
                            .colorScheme
                            .surfaceContainerHighest
                            .withValues(alpha: 0.65),
                        borderRadius: BorderRadius.circular(10),
                        child: Padding(
                          padding: const EdgeInsets.all(10),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Icon(
                                    Icons.forum_rounded,
                                    size: 16,
                                    color: Theme.of(context)
                                        .colorScheme
                                        .primary,
                                  ),
                                  const SizedBox(width: 6),
                                  Expanded(
                                    child: Text(
                                      who +
                                          (whenShort != null
                                              ? ' · $whenShort'
                                              : ''),
                                      style: Theme.of(context)
                                          .textTheme
                                          .labelMedium
                                          ?.copyWith(
                                            fontWeight: FontWeight.w600,
                                          ),
                                    ),
                                  ),
                                ],
                              ),
                              if (body.isNotEmpty) ...[
                                const SizedBox(height: 6),
                                Text(body),
                              ],
                            ],
                          ),
                        ),
                      ),
                    );
                  }),
                ],
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: FilledButton.tonalIcon(
                    onPressed: () => _showAcheiDialog(row),
                    icon: const Icon(Icons.touch_app_rounded, size: 20),
                    label: const Text('Achei'),
                  ),
                ),
                if (showStaffActions) ...[
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    alignment: WrapAlignment.end,
                    children: [
                      if (canEdit)
                        OutlinedButton.icon(
                          onPressed: () => _showItemForm(existing: row),
                          icon: const Icon(Icons.edit_rounded, size: 18),
                          label: const Text('Editar'),
                        ),
                      if (canDelete)
                        OutlinedButton.icon(
                          onPressed: () => _confirmDelete(row),
                          icon: Icon(
                            Icons.delete_outline_rounded,
                            size: 18,
                            color: Theme.of(context).colorScheme.error,
                          ),
                          label: Text(
                            'Excluir',
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ),
                      if (canResolve)
                        FilledButton.tonalIcon(
                          onPressed: () => _markResolved(row),
                          icon:
                              const Icon(Icons.check_circle_outline_rounded),
                          label: const Text('Marcar como encontrado'),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

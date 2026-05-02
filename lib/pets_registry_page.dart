import 'dart:convert';
import 'dart:typed_data';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

/// Animais por unidade: morador cadastra (nome, tipo, raça, foto); equipe só visualiza por unidade.
class PetsRegistryPage extends StatefulWidget {
  const PetsRegistryPage({
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
  State<PetsRegistryPage> createState() => _PetsRegistryPageState();
}

class _PetsRegistryPageState extends State<PetsRegistryPage> {
  bool _loading = true;
  Object? _loadError;
  List<Map<String, dynamic>> _items = [];
  String? _residentTower;
  String? _residentNumber;

  bool get _isResident =>
      widget.userRole == CondoUserRoles.resident && widget.unitId != null;

  bool get _isStaff => CondoUserRoles.isOperationalStaff(widget.userRole);

  @override
  void initState() {
    super.initState();
    _loadPets();
    _loadUnitLabel();
  }

  @override
  void didUpdateWidget(PetsRegistryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.condoId != widget.condoId ||
        oldWidget.userId != widget.userId ||
        oldWidget.unitId != widget.unitId ||
        oldWidget.userRole != widget.userRole) {
      _loadPets();
      _loadUnitLabel();
    }
  }

  Future<void> _loadUnitLabel() async {
    if (!_isResident || widget.unitId == null) {
      return;
    }
    try {
      final r = await http.get(
        CondoApi.uri('/api/units', {'condoId': '${widget.condoId}'}),
      );
      if (r.statusCode != 200 || !mounted) {
        return;
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      for (final raw in list) {
        final u = raw as Map<String, dynamic>;
        if ((u['id'] as num).toInt() == widget.unitId) {
          if (mounted) {
            setState(() {
              _residentTower = u['tower'] as String?;
              _residentNumber = u['number'] as String?;
            });
          }
          break;
        }
      }
    } catch (_) {
      /* ignore */
    }
  }

  Future<void> _reload() => _loadPets();

  Future<void> _loadPets() async {
    if (!mounted) {
      return;
    }
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final r = await http.get(
        CondoApi.uri('/api/unit-pets', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        }),
      );
      if (r.statusCode != 200) {
        throw Exception('Erro ${r.statusCode}');
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      final parsed =
          list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      if (!mounted) {
        return;
      }
      setState(() {
        _items = parsed;
        _loading = false;
        _loadError = null;
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

  Future<String?> _uploadPhoto(List<int> bytes, String filename) async {
    final uri = CondoApi.uri('/api/unit-pets/upload-photo', {
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

  Future<void> _openEditor({Map<String, dynamic>? existing}) async {
    if (!_isResident || widget.unitId == null) {
      return;
    }

    final isEdit = existing != null;
    final id = existing != null ? (existing['id'] as num).toInt() : null;

    final nameCtrl =
        TextEditingController(text: existing?['name'] as String? ?? '');
    final speciesCtrl =
        TextEditingController(text: existing?['species'] as String? ?? '');
    final breedCtrl =
        TextEditingController(text: existing?['breed'] as String? ?? '');
    String? photoUrl = existing?['photo_url'] as String?;
    List<int>? pendingPhotoBytes;
    String pendingPhotoName = '';

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (dialogCtx, setLocal) {
          return AlertDialog(
            title: Text(isEdit ? 'Editar animal' : 'Cadastrar animal'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Unidade',
                      border: OutlineInputBorder(),
                    ),
                    child: Text(
                      existing != null
                          ? 'Torre ${existing['unit_tower'] ?? '?'} · ${existing['unit_number'] ?? '?'}'
                          : (_residentTower != null && _residentNumber != null
                              ? 'Torre $_residentTower · $_residentNumber'
                              : 'Unidade #${widget.unitId}'),
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Unidade definida pelo seu cadastro de morador.',
                    style: TextStyle(
                      fontSize: 12,
                      color: Theme.of(dialogCtx).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Nome do animal',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: speciesCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Tipo (ex.: cão, gato)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: breedCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Raça (opcional)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      FilledButton.tonalIcon(
                        onPressed: () async {
                          final pick = await FilePicker.platform.pickFiles(
                            type: FileType.image,
                            withData: true,
                          );
                          if (pick == null || pick.files.isEmpty) {
                            return;
                          }
                          final f = pick.files.first;
                          final bytes = f.bytes;
                          if (bytes == null) {
                            if (!dialogCtx.mounted) {
                              return;
                            }
                            ScaffoldMessenger.of(dialogCtx).showSnackBar(
                              const SnackBar(
                                content: Text(
                                  'Não foi possível ler a imagem. Tente outro arquivo.',
                                ),
                              ),
                            );
                            return;
                          }
                          setLocal(() {
                            pendingPhotoBytes = bytes;
                            pendingPhotoName =
                                f.name.isEmpty ? 'foto.jpg' : f.name;
                            photoUrl = null;
                          });
                        },
                        icon: const Icon(Icons.add_photo_alternate_rounded),
                        label: const Text('Escolher foto'),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          pendingPhotoBytes != null
                              ? pendingPhotoName
                              : (photoUrl != null && photoUrl!.isNotEmpty
                                  ? 'Foto atual'
                                  : 'Nenhuma foto'),
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(dialogCtx).textTheme.bodySmall,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (pendingPhotoBytes != null)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: Image.memory(
                        Uint8List.fromList(pendingPhotoBytes!),
                        height: 120,
                        fit: BoxFit.cover,
                      ),
                    )
                  else if (photoUrl != null && photoUrl!.isNotEmpty)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: Image.network(
                        CondoApi.uploadsUrl(photoUrl!),
                        height: 120,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const SizedBox(
                          height: 80,
                          child: Center(child: Icon(Icons.pets)),
                        ),
                      ),
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
                child: Text(isEdit ? 'Salvar' : 'Cadastrar'),
              ),
            ],
          );
        },
      ),
    );

    if (ok != true || !mounted) {
      nameCtrl.dispose();
      speciesCtrl.dispose();
      breedCtrl.dispose();
      return;
    }

    final name = nameCtrl.text.trim();
    final species = speciesCtrl.text.trim();
    final breed = breedCtrl.text.trim();
    nameCtrl.dispose();
    speciesCtrl.dispose();
    breedCtrl.dispose();
    if (name.isEmpty || species.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe nome e tipo do animal.')),
      );
      return;
    }

    String? finalPhoto = photoUrl;
    if (pendingPhotoBytes != null) {
      final uploaded =
          await _uploadPhoto(pendingPhotoBytes!, pendingPhotoName);
      if (!mounted) {
        return;
      }
      if (uploaded == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Falha ao enviar a foto.')),
        );
        return;
      }
      finalPhoto = uploaded;
    }

    try {
      if (isEdit && id != null) {
        final r = await http.patch(
          CondoApi.uri('/api/unit-pets/$id'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'condoId': widget.condoId,
            'userId': widget.userId,
            'name': name,
            'species': species,
            'breed': breed.isEmpty ? '' : breed,
            if (finalPhoto != null) 'photoUrl': finalPhoto,
          }),
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
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Animal atualizado.')),
        );
      } else {
        final r = await http.post(
          CondoApi.uri('/api/unit-pets'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'condoId': widget.condoId,
            'userId': widget.userId,
            'unitId': widget.unitId,
            'name': name,
            'species': species,
            'breed': breed.isEmpty ? null : breed,
            if (finalPhoto != null) 'photoUrl': finalPhoto,
          }),
        );
        if (!mounted) {
          return;
        }
        if (r.statusCode != 201) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Erro ao cadastrar (${r.statusCode}).')),
          );
          return;
        }
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Animal cadastrado.')),
        );
      }
      if (!mounted) {
        return;
      }
      await _loadPets();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Falha de rede.')),
        );
      }
    }
  }

  Future<void> _confirmDelete(Map<String, dynamic> row) async {
    final id = (row['id'] as num).toInt();
    final name = row['name'] as String? ?? '';
    final proceed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remover animal'),
        content: Text('Excluir “$name” do cadastro?'),
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
    if (proceed != true || !mounted) {
      return;
    }
    try {
      final r = await http.delete(
        CondoApi.uri('/api/unit-pets/$id', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 204) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro (${r.statusCode}).')),
        );
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Animal removido.')),
      );
      await _reload();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Falha de rede.')),
        );
      }
    }
  }

  static String _unitKey(Map<String, dynamic> p) {
    final t = p['unit_tower'] as String? ?? '';
    final n = p['unit_number'] as String? ?? '';
    return '$t|$n';
  }

  static String _unitTitle(Map<String, dynamic> p) {
    final t = p['unit_tower'] as String? ?? '';
    final n = p['unit_number'] as String? ?? '';
    return 'Torre $t · $n';
  }

  Widget _petTile(Map<String, dynamic> row, ThemeData theme, ColorScheme cs) {
    final name = row['name'] as String? ?? '';
    final species = row['species'] as String? ?? '';
    final breed = (row['breed'] as String?)?.trim();
    final photoUrl = row['photo_url'] as String?;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: photoUrl != null && photoUrl.isNotEmpty
                  ? Image.network(
                      CondoApi.uploadsUrl(photoUrl),
                      width: 72,
                      height: 72,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(
                        width: 72,
                        height: 72,
                        color: cs.surfaceContainerHighest,
                        child: Icon(Icons.pets, color: cs.primary),
                      ),
                    )
                  : Container(
                      width: 72,
                      height: 72,
                      color: cs.surfaceContainerHighest,
                      child: Icon(Icons.pets, color: cs.primary),
                    ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    species,
                    style: theme.textTheme.bodyMedium,
                  ),
                  if (breed != null && breed.isNotEmpty)
                    Text(
                      'Raça: $breed',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: cs.onSurfaceVariant,
                      ),
                    ),
                  if (_isResident) ...[
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        TextButton.icon(
                          onPressed: () => _openEditor(existing: row),
                          icon: const Icon(Icons.edit_rounded, size: 18),
                          label: const Text('Editar'),
                        ),
                        TextButton.icon(
                          onPressed: () => _confirmDelete(row),
                          icon: Icon(Icons.delete_outline_rounded,
                              size: 18, color: cs.error),
                          label: Text(
                            'Excluir',
                            style: TextStyle(color: cs.error),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    if (!_isResident && !_isStaff) {
      return Scaffold(
        appBar: AppBar(title: const Text('Animais de estimação')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              'O cadastro de animais é feito pelo morador da unidade. '
              'A equipe do condomínio consulta os registros por apartamento.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyLarge?.copyWith(
                color: cs.onSurfaceVariant,
              ),
            ),
          ),
        ),
      );
    }

    if (_isResident && widget.unitId == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Animais de estimação')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              'Sua conta não está vinculada a uma unidade. '
              'Atualize seus dados com a administradora para cadastrar animais.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyLarge?.copyWith(
                color: cs.onSurfaceVariant,
              ),
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Animais de estimação'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () => _reload(),
          ),
        ],
      ),
      floatingActionButton: _isResident
          ? FloatingActionButton.extended(
              onPressed: () => _openEditor(),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Novo animal'),
            )
          : null,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _loadError != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Não foi possível carregar ($_loadError).',
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: _loadPets,
                          child: const Text('Tentar novamente'),
                        ),
                      ],
                    ),
                  ),
                )
              : _buildPetList(theme, cs),
    );
  }

  Widget _buildPetList(ThemeData theme, ColorScheme cs) {
    final items = _items;

    if (items.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            _isStaff
                ? 'Nenhum animal cadastrado pelas unidades.'
                : 'Nenhum animal cadastrado. Toque em “Novo animal”, envie a foto e preencha nome, tipo e raça.',
            style: theme.textTheme.bodyLarge?.copyWith(
              color: cs.onSurfaceVariant,
            ),
          ),
        ],
      );
    }

    if (_isResident) {
      return ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
        itemCount: items.length,
        itemBuilder: (_, i) => _petTile(items[i], theme, cs),
      );
    }

    final grouped = <String, List<Map<String, dynamic>>>{};
    for (final p in items) {
      final k = _unitKey(p);
      grouped.putIfAbsent(k, () => []).add(p);
    }
    final keys = grouped.keys.toList()..sort((a, b) => a.compareTo(b));

    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      itemCount: keys.length,
      itemBuilder: (_, i) {
        final key = keys[i];
        final pets = grouped[key]!;
        final headerTitle = _unitTitle(pets.first);
        return ExpansionTile(
          key: PageStorageKey<String>('pet-unit-$key'),
          initiallyExpanded: keys.length <= 3,
          title: Text(
            headerTitle,
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
          subtitle: Text(
            '${pets.length} animal(is)',
            style: theme.textTheme.bodySmall,
          ),
          children: pets.map((row) => _petTile(row, theme, cs)).toList(),
        );
      },
    );
  }
}

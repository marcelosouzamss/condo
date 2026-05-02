import 'dart:convert';
import 'dart:typed_data';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

const int _kPortfolioMaxPhotos = 12;

class _PendingPortfolioPhoto {
  _PendingPortfolioPhoto({required this.bytes, required this.name});

  final List<int> bytes;
  final String name;
}

/// Guia de serviços: dados da API, abas por área (unidades / condomínio).
/// Cadastro: síndico, administração e parceiros (`canManageServiceGuideCatalog`).
class ServiceGuidePage extends StatefulWidget {
  const ServiceGuidePage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
  });

  final int condoId;
  final int userId;
  final String userRole;

  @override
  State<ServiceGuidePage> createState() => _ServiceGuidePageState();
}

class _ServiceGuidePageState extends State<ServiceGuidePage>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  bool _loading = true;
  Object? _loadError;
  List<Map<String, dynamic>> _catalog = [];
  Map<String, dynamic>? _overview;

  bool get _canManage =>
      CondoUserRoles.canManageServiceGuideCatalog(widget.userRole);

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _reload();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  static String _apiMessage(http.Response r) {
    try {
      final decoded = jsonDecode(r.body);
      if (decoded is Map && decoded['message'] is String) {
        return decoded['message'] as String;
      }
    } catch (_) {}
    return 'Erro ${r.statusCode}';
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final base = <String, String>{
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      };
      final catalogQs = Map<String, String>.from(base);
      if (_canManage) {
        catalogQs['includeInactive'] = 'true';
      }
      final res = await Future.wait([
        http.get(CondoApi.uri('/api/service-guide/overview', base)),
        http.get(CondoApi.uri('/api/service-guide/catalog', catalogQs)),
      ]);
      if (res[0].statusCode != 200) {
        throw Exception(_apiMessage(res[0]));
      }
      if (res[1].statusCode != 200) {
        throw Exception(_apiMessage(res[1]));
      }
      final overviewMap = jsonDecode(res[0].body) as Map<String, dynamic>;
      final rawList = jsonDecode(res[1].body) as List<dynamic>;
      final parsed =
          rawList.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      if (!mounted) {
        return;
      }
      setState(() {
        _overview = overviewMap;
        _catalog = parsed;
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

  List<Map<String, dynamic>> _itemsForScope(String scope) {
    return _catalog
        .where((r) => (r['scope'] as String? ?? 'unit') == scope)
        .toList();
  }

  Future<void> _launchTel(String? raw) async {
    if (raw == null || raw.trim().isEmpty) {
      return;
    }
    final digits = raw.replaceAll(RegExp(r'[^\d+]'), '');
    if (digits.isEmpty) {
      return;
    }
    final uri = Uri(scheme: 'tel', path: digits);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  Future<void> _launchMail(String? raw) async {
    if (raw == null || raw.trim().isEmpty) {
      return;
    }
    final uri = Uri.parse('mailto:${raw.trim()}');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  List<Map<String, dynamic>> _portfolioPhotos(Map<String, dynamic> row) {
    final raw = row['portfolio_photos'];
    if (raw is! List<dynamic>) {
      return [];
    }
    return raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Future<bool> _uploadPortfolioPhoto(
    int serviceId,
    List<int> bytes,
    String filename,
  ) async {
    final uri = CondoApi.uri(
      '/api/service-guide/catalog/$serviceId/upload-photo',
      {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      },
    );
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
    return resp.statusCode == 201;
  }

  Future<bool> _deletePortfolioPhoto(int serviceId, int photoId) async {
    final r = await http.delete(
      CondoApi.uri(
        '/api/service-guide/catalog/$serviceId/photos/$photoId',
        {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        },
      ),
    );
    return r.statusCode == 204 || r.statusCode == 200;
  }

  void _openPortfolioViewer(List<String> urls, int initialIndex) {
    if (urls.isEmpty) {
      return;
    }
    final controller = PageController(initialPage: initialIndex);
    showDialog<void>(
      context: context,
      builder: (ctx) {
        return Dialog.fullscreen(
          backgroundColor: Colors.black,
          child: Stack(
            fit: StackFit.expand,
            children: [
              PageView.builder(
                controller: controller,
                itemCount: urls.length,
                itemBuilder: (_, i) {
                  return InteractiveViewer(
                    minScale: 0.6,
                    maxScale: 4,
                    child: Center(
                      child: Image.network(
                        CondoApi.uploadsUrl(urls[i]),
                        fit: BoxFit.contain,
                        errorBuilder: (_, __, ___) => const Icon(
                          Icons.broken_image_outlined,
                          color: Colors.white54,
                          size: 64,
                        ),
                      ),
                    ),
                  );
                },
              ),
              SafeArea(
                child: Align(
                  alignment: Alignment.topRight,
                  child: IconButton(
                    icon: const Icon(Icons.close_rounded, color: Colors.white),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    ).then((_) => controller.dispose());
  }

  Future<void> _confirmDelete(Map<String, dynamic> row) async {
    final id = (row['id'] as num).toInt();
    final title = row['title'] as String? ?? '';
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir serviço'),
        content: Text('Remover «$title» da guia?'),
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
        CondoApi.uri('/api/service-guide/catalog/$id', {
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
        const SnackBar(content: Text('Serviço removido.')),
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

  Future<void> _openServiceForm({Map<String, dynamic>? existing}) async {
    final isEdit = existing != null;
    final titleCtrl = TextEditingController(
      text: existing?['title'] as String? ?? '',
    );
    final descCtrl = TextEditingController(
      text: existing?['description'] as String? ?? '',
    );
    final catCtrl = TextEditingController(
      text: existing?['category'] as String? ?? '',
    );
    final nameCtrl = TextEditingController(
      text: existing?['provider_name'] as String? ?? '',
    );
    final phoneCtrl = TextEditingController(
      text: existing?['provider_phone'] as String? ?? '',
    );
    final emailCtrl = TextEditingController(
      text: existing?['provider_email'] as String? ?? '',
    );
    final sortCtrl = TextEditingController(
      text: '${existing?['sort_order'] ?? 0}',
    );
    String scope =
        (existing?['scope'] as String?)?.toLowerCase() == 'condo'
            ? 'condo'
            : 'unit';
    bool visible = existing?['visible'] != false;
    bool active = existing?['active'] != false;

    final existingPhotos =
        List<Map<String, dynamic>>.from(_portfolioPhotos(existing ?? {}));
    final pendingPhotos = <_PendingPortfolioPhoto>[];

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
                      isEdit ? 'Editar serviço' : 'Novo serviço na guia',
                      style: Theme.of(ctx).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: titleCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Nome do serviço *',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: descCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Descrição',
                        border: OutlineInputBorder(),
                      ),
                      maxLines: 3,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: catCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Categoria',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: nameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Prestador / empresa',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: phoneCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Telefone',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: emailCtrl,
                      decoration: const InputDecoration(
                        labelText: 'E-mail',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.emailAddress,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: sortCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Ordem na lista',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.number,
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: scope,
                      decoration: const InputDecoration(
                        labelText: 'Área',
                        border: OutlineInputBorder(),
                      ),
                      items: const [
                        DropdownMenuItem(
                          value: 'unit',
                          child: Text('Serviços para unidades'),
                        ),
                        DropdownMenuItem(
                          value: 'condo',
                          child: Text('Serviços para o condomínio'),
                        ),
                      ],
                      onChanged: (v) => setLocal(() => scope = v ?? 'unit'),
                    ),
                    const SizedBox(height: 8),
                    SwitchListTile(
                      title: const Text('Visível no guia para moradores'),
                      subtitle: const Text(
                        'Desligado: oculto na lista pública; gestão ainda vê ao editar.',
                      ),
                      value: visible,
                      onChanged: (v) => setLocal(() => visible = v),
                    ),
                    if (isEdit)
                      SwitchListTile(
                        title: const Text('Ativo'),
                        subtitle: const Text(
                          'Inativo não aparece nas listagens.',
                        ),
                        value: active,
                        onChanged: (v) => setLocal(() => active = v),
                      ),
                    const Divider(height: 28),
                    Text(
                      'Fotos de trabalhos realizados (opcional)',
                      style: Theme.of(ctx).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Até $_kPortfolioMaxPhotos imagens. Ajuda moradores a ver exemplos do serviço.',
                      style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                            color: Theme.of(ctx).colorScheme.onSurfaceVariant,
                          ),
                    ),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final ph in existingPhotos)
                          Stack(
                            clipBehavior: Clip.none,
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(10),
                                child: Image.network(
                                  CondoApi.uploadsUrl(
                                    ph['photo_url'] as String? ?? '',
                                  ),
                                  width: 76,
                                  height: 76,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) => Container(
                                    width: 76,
                                    height: 76,
                                    color: Theme.of(ctx)
                                        .colorScheme
                                        .surfaceContainerHighest,
                                    alignment: Alignment.center,
                                    child: const Icon(Icons.broken_image),
                                  ),
                                ),
                              ),
                              if (isEdit)
                                Positioned(
                                  right: -6,
                                  top: -6,
                                  child: Material(
                                    color: Theme.of(ctx).colorScheme.error,
                                    shape: const CircleBorder(),
                                    child: InkWell(
                                      customBorder: const CircleBorder(),
                                      onTap: () async {
                                        final pid =
                                            (ph['id'] as num?)?.toInt();
                                        final sid =
                                            (existing['id'] as num).toInt();
                                        if (pid == null) {
                                          return;
                                        }
                                        final removed =
                                            await _deletePortfolioPhoto(
                                          sid,
                                          pid,
                                        );
                                        if (removed && ctx.mounted) {
                                          setLocal(() => existingPhotos
                                              .removeWhere(
                                                (e) =>
                                                    (e['id'] as num?)?.toInt() ==
                                                    pid,
                                              ));
                                        } else if (ctx.mounted) {
                                          ScaffoldMessenger.of(ctx)
                                              .showSnackBar(
                                            const SnackBar(
                                              content: Text(
                                                'Não foi possível remover a foto.',
                                              ),
                                            ),
                                          );
                                        }
                                      },
                                      child: const Padding(
                                        padding: EdgeInsets.all(4),
                                        child: Icon(
                                          Icons.close_rounded,
                                          size: 16,
                                          color: Colors.white,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ...List.generate(pendingPhotos.length, (pi) {
                          final idx = pi;
                          return Stack(
                            clipBehavior: Clip.none,
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(10),
                                child: Image.memory(
                                  Uint8List.fromList(pendingPhotos[idx].bytes),
                                  width: 76,
                                  height: 76,
                                  fit: BoxFit.cover,
                                ),
                              ),
                              Positioned(
                                right: -6,
                                top: -6,
                                child: Material(
                                  color: Theme.of(ctx).colorScheme.secondary,
                                  shape: const CircleBorder(),
                                  child: InkWell(
                                    customBorder: const CircleBorder(),
                                    onTap: () => setLocal(
                                      () => pendingPhotos.removeAt(idx),
                                    ),
                                    child: const Padding(
                                      padding: EdgeInsets.all(4),
                                      child: Icon(
                                        Icons.close_rounded,
                                        size: 16,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          );
                        }),
                      ],
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: () async {
                        final used =
                            existingPhotos.length + pendingPhotos.length;
                        final slots = _kPortfolioMaxPhotos - used;
                        if (slots <= 0) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(
                              content: Text(
                                'Limite de $_kPortfolioMaxPhotos fotos.',
                              ),
                            ),
                          );
                          return;
                        }
                        final pick = await FilePicker.platform.pickFiles(
                          type: FileType.image,
                          allowMultiple: true,
                          withData: true,
                        );
                        if (pick == null || pick.files.isEmpty) {
                          return;
                        }
                        setLocal(() {
                          var left = slots;
                          for (final f in pick.files) {
                            if (left <= 0) {
                              break;
                            }
                            final bytes = f.bytes;
                            if (bytes == null) {
                              continue;
                            }
                            pendingPhotos.add(
                              _PendingPortfolioPhoto(
                                bytes: bytes,
                                name: f.name,
                              ),
                            );
                            left--;
                          }
                        });
                      },
                      icon: const Icon(Icons.add_photo_alternate_rounded),
                      label: const Text('Adicionar fotos'),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: Text(isEdit ? 'Salvar' : 'Cadastrar'),
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

    final title = titleCtrl.text.trim();
    if (title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe o nome do serviço.')),
      );
      return;
    }
    final sortParsed = int.tryParse(sortCtrl.text.trim());
    final sortOrder = sortParsed ?? 0;

    try {
      final body = <String, dynamic>{
        'condoId': widget.condoId,
        'userId': widget.userId,
        'title': title,
        'description': descCtrl.text.trim(),
        'category': catCtrl.text.trim(),
        'providerName': nameCtrl.text.trim(),
        'providerPhone': phoneCtrl.text.trim(),
        'providerEmail': emailCtrl.text.trim(),
        'sortOrder': sortOrder,
        'scope': scope,
        'visible': visible,
      };
      final http.Response r;
      if (isEdit) {
        final id = (existing['id'] as num).toInt();
        body['active'] = active;
        r = await http.patch(
          CondoApi.uri('/api/service-guide/catalog/$id'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        );
      } else {
        r = await http.post(
          CondoApi.uri('/api/service-guide/catalog'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        );
      }
      if (!mounted) {
        return;
      }
      if ((isEdit && r.statusCode != 200) ||
          (!isEdit && r.statusCode != 201)) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_apiMessage(r))),
        );
        return;
      }
      final sidInt = isEdit
          ? (existing['id'] as num).toInt()
          : ((jsonDecode(r.body) as Map<String, dynamic>)['id'] as num)
              .toInt();
      var uploadFailures = 0;
      for (final p in pendingPhotos) {
        final okUp =
            await _uploadPortfolioPhoto(sidInt, p.bytes, p.name);
        if (!okUp) {
          uploadFailures++;
        }
      }
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            uploadFailures > 0
                ? '${isEdit ? 'Serviço salvo' : 'Serviço criado'}, mas $uploadFailures foto(s) falharam no envio.'
                : (isEdit ? 'Serviço atualizado.' : 'Serviço cadastrado.'),
          ),
        ),
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

  Widget _overviewSection(ThemeData theme, ColorScheme cs) {
    if (_loading && _overview == null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Visão geral',
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          const SizedBox(
            height: 100,
            child: Center(child: CircularProgressIndicator()),
          ),
        ],
      );
    }
    if (_loadError != null && _overview == null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Visão geral',
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Indicadores indisponíveis até a lista carregar.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: cs.onSurfaceVariant,
            ),
          ),
        ],
      );
    }
    final ov = _overview;
    if (ov == null) {
      return const SizedBox.shrink();
    }
    final total = (ov['totalListed'] as num?)?.toInt() ?? 0;
    final cats = (ov['categoryCount'] as num?)?.toInt() ?? 0;
    final unitN = (ov['unitServices'] as num?)?.toInt() ?? 0;
    final condoN = (ov['condoServices'] as num?)?.toInt() ?? 0;
    final hidden = (ov['hiddenFromResidents'] as num?)?.toInt();

    Widget metric(String label, String value, IconData icon) {
      return Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
          decoration: BoxDecoration(
            color: cs.surfaceContainerHighest.withValues(alpha: 0.65),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: [
              Icon(icon, color: cs.primary, size: 22),
              const SizedBox(height: 6),
              Text(
                value,
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
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

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Visão geral',
          style: theme.textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'Indicadores com base nos serviços que o seu perfil pode ver na guia.',
          style: theme.textTheme.bodySmall?.copyWith(
            color: cs.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            metric('Serviços na guia', '$total', Icons.handyman_rounded),
            const SizedBox(width: 8),
            metric('Categorias', '$cats', Icons.list_alt_rounded),
            const SizedBox(width: 8),
            metric(
              'Unidades / Cond.',
              '$unitN / $condoN',
              Icons.apartment_rounded,
            ),
          ],
        ),
        if (_canManage && hidden != null && hidden > 0) ...[
          const SizedBox(height: 10),
          Text(
            '$hidden serviço(s) ativo(s) oculto(s) para moradores.',
            style: theme.textTheme.labelMedium?.copyWith(
              color: cs.tertiary,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ],
    );
  }

  Widget _serviceCard(Map<String, dynamic> row) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final title = row['title'] as String? ?? '';
    final desc = row['description'] as String?;
    final category = row['category'] as String?;
    final phone = row['provider_phone'] as String?;
    final email = row['provider_email'] as String?;
    final provider = row['provider_name'] as String?;
    final visible = row['visible'] != false;
    final active = row['active'] != false;
    final scope = row['scope'] as String? ?? 'unit';

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                if (_canManage) ...[
                  IconButton(
                    tooltip: 'Editar',
                    icon: const Icon(Icons.edit_rounded, size: 20),
                    onPressed: () => _openServiceForm(existing: row),
                  ),
                  IconButton(
                    tooltip: 'Excluir',
                    icon: Icon(
                      Icons.delete_outline_rounded,
                      size: 20,
                      color: cs.error,
                    ),
                    onPressed: () => _confirmDelete(row),
                  ),
                ],
              ],
            ),
            if (_canManage)
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  if (!visible)
                    Chip(
                      label: const Text('Oculto'),
                      visualDensity: VisualDensity.compact,
                      backgroundColor:
                          cs.errorContainer.withValues(alpha: 0.5),
                    ),
                  if (!active)
                    const Chip(
                      label: Text('Inativo'),
                      visualDensity: VisualDensity.compact,
                    ),
                  Chip(
                    label: Text(
                      scope == 'condo' ? 'Condomínio' : 'Unidades',
                    ),
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
            if (_portfolioPhotos(row).isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                'Trabalhos realizados',
                style: theme.textTheme.labelLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              SizedBox(
                height: 104,
                child: Builder(
                  builder: (context) {
                    final photos = _portfolioPhotos(row);
                    final urls = photos
                        .map((p) => p['photo_url'] as String? ?? '')
                        .where((u) => u.isNotEmpty)
                        .toList();
                    return ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: urls.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 8),
                      itemBuilder: (_, i) {
                        return GestureDetector(
                          onTap: () => _openPortfolioViewer(urls, i),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: AspectRatio(
                              aspectRatio: 1,
                              child: Image.network(
                                CondoApi.uploadsUrl(urls[i]),
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) => Container(
                                  color: cs.surfaceContainerHighest,
                                  alignment: Alignment.center,
                                  child: const Icon(Icons.broken_image),
                                ),
                              ),
                            ),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
            ],
            if (category != null && category.trim().isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                category,
                style: theme.textTheme.labelLarge?.copyWith(
                  color: cs.primary,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
            if (provider != null && provider.trim().isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(provider, style: theme.textTheme.bodyMedium),
            ],
            if (desc != null && desc.trim().isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(desc, style: theme.textTheme.bodySmall),
            ],
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (phone != null && phone.trim().isNotEmpty)
                  OutlinedButton.icon(
                    onPressed: () => _launchTel(phone),
                    icon: const Icon(Icons.phone_rounded, size: 18),
                    label: const Text('Ligar'),
                  ),
                if (email != null && email.trim().isNotEmpty)
                  OutlinedButton.icon(
                    onPressed: () => _launchMail(email),
                    icon: const Icon(Icons.mail_outline_rounded, size: 18),
                    label: const Text('E-mail'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _scopeTab(String scope, String emptyMsg) {
    final items = _itemsForScope(scope);
    if (_loading && items.isEmpty && _loadError == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_loadError != null && !_loading && items.isEmpty && _catalog.isEmpty) {
      return Center(
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
      );
    }

    if (items.isEmpty) {
      return RefreshIndicator(
        onRefresh: _reload,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 88),
          children: [
            SizedBox(
              height: MediaQuery.of(context).size.height * 0.28,
              child: Center(
                child: Text(
                  emptyMsg,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _reload,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 88),
        itemCount: items.length,
        itemBuilder: (_, i) => _serviceCard(items[i]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Guia de Serviços'),
        actions: [
          IconButton(
            tooltip: 'Atualizar',
            onPressed: _reload,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
            child: _overviewSection(theme, cs),
          ),
          Material(
            color: cs.surface,
            child: TabBar(
              controller: _tabController,
              labelColor: cs.primary,
              tabs: const [
                Tab(text: 'Para unidades'),
                Tab(text: 'Para o condomínio'),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _scopeTab(
                  'unit',
                  'Nenhum serviço para unidades.\n'
                  '${_canManage ? 'Toque em Novo serviço para cadastrar.' : ''}',
                ),
                _scopeTab(
                  'condo',
                  'Nenhum serviço para o condomínio.\n'
                  '${_canManage ? 'Toque em Novo serviço para cadastrar.' : ''}',
                ),
              ],
            ),
          ),
        ],
      ),
      floatingActionButton: _canManage
          ? FloatingActionButton.extended(
              onPressed: () => _openServiceForm(),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Novo serviço'),
            )
          : null,
    );
  }
}

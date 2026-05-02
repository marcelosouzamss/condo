import 'dart:convert';
import 'dart:typed_data';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

const int _kMaxPhotos = 8;

String _marketApiMessage(http.Response r) {
  try {
    final decoded = jsonDecode(r.body);
    if (decoded is Map && decoded['message'] is String) {
      return decoded['message'] as String;
    }
  } catch (_) {}
  return 'Erro ${r.statusCode}';
}

/// Mercado interno em duas áreas (`listing_scope`): condomínio vs moradores.
/// Fotos: até $_kMaxPhotos por anúncio (multipart em mobile/desktop; JSON+base64 na Web).
class InternalMarketPage extends StatefulWidget {
  const InternalMarketPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
  });

  final int condoId;
  final int userId;
  final String userRole;

  @override
  State<InternalMarketPage> createState() => _InternalMarketPageState();
}

class _InternalMarketPageState extends State<InternalMarketPage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  bool _loadingCondo = true;
  bool _loadingResident = true;
  Object? _errorCondo;
  Object? _errorResident;
  List<Map<String, dynamic>> _condoItems = [];
  List<Map<String, dynamic>> _residentItems = [];

  bool get _canPostCondo =>
      CondoUserRoles.canPostMarketplaceCondominium(widget.userRole);

  bool get _canPostResidents =>
      CondoUserRoles.canPostMarketplaceResidents(widget.userRole);

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (mounted) setState(() {});
    });
    _reloadAll();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _reloadAll() async {
    await Future.wait([_reloadScope('condominium'), _reloadScope('residents')]);
  }

  Future<void> _reloadScope(String scope) async {
    final isCondo = scope == 'condominium';
    setState(() {
      if (isCondo) {
        _loadingCondo = true;
        _errorCondo = null;
      } else {
        _loadingResident = true;
        _errorResident = null;
      }
    });
    try {
      final r = await http.get(
        CondoApi.uri('/api/marketplace', {
          'condoId': '${widget.condoId}',
          'listingScope': scope,
        }),
      );
      if (r.statusCode != 200) {
        throw Exception(_marketApiMessage(r));
      }
      final raw = jsonDecode(r.body) as List<dynamic>;
      final list =
          raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      if (!mounted) return;
      setState(() {
        if (isCondo) {
          _condoItems = list;
          _loadingCondo = false;
        } else {
          _residentItems = list;
          _loadingResident = false;
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        if (isCondo) {
          _errorCondo = e;
          _loadingCondo = false;
        } else {
          _errorResident = e;
          _loadingResident = false;
        }
      });
    }
  }

  bool _mayEditListing(Map<String, dynamic> row) {
    if (CondoUserRoles.isBillingStaff(widget.userRole)) {
      return false;
    }
    final creator = (row['created_by_user_id'] as num?)?.toInt();
    if (creator != widget.userId) {
      return false;
    }
    final scope = row['listing_scope'] as String? ?? 'residents';
    if (widget.userRole == CondoUserRoles.resident) {
      return scope == 'residents';
    }
    if (widget.userRole == CondoUserRoles.partner) {
      return scope == 'condominium';
    }
    if (widget.userRole == CondoUserRoles.collaborator) {
      return true;
    }
    return false;
  }

  bool _mayDeleteListing(Map<String, dynamic> row) {
    if (CondoUserRoles.isBillingStaff(widget.userRole)) {
      return true;
    }
    final creator = (row['created_by_user_id'] as num?)?.toInt();
    if (creator != widget.userId) {
      return false;
    }
    final scope = row['listing_scope'] as String? ?? 'residents';
    if (widget.userRole == CondoUserRoles.resident) {
      return scope == 'residents';
    }
    if (widget.userRole == CondoUserRoles.partner) {
      return scope == 'condominium';
    }
    if (widget.userRole == CondoUserRoles.collaborator) {
      return true;
    }
    return false;
  }

  Future<void> _uploadPhoto(int listingId, List<int> bytes, String filename) async {
    if (kIsWeb) {
      final uri = CondoApi.uri(
        '/api/marketplace/listings/$listingId/upload-photo-json',
        {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        },
      );
      final r = await http.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'userId': widget.userId,
          'filename': filename.isEmpty ? 'foto.jpg' : filename,
          'imageBase64': base64Encode(bytes),
        }),
      );
      if (r.statusCode != 201) {
        throw Exception(_marketApiMessage(r));
      }
      return;
    }

    final uri = CondoApi.uri(
      '/api/marketplace/listings/$listingId/upload-photo',
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
    if (resp.statusCode != 201) {
      throw Exception(_marketApiMessage(resp));
    }
  }

  Future<void> _deletePhoto(int listingId, int photoId) async {
    final r = await http.delete(
      CondoApi.uri(
        '/api/marketplace/listings/$listingId/photos/$photoId',
        {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        },
      ),
    );
    if (r.statusCode != 204 && r.statusCode != 200) {
      throw Exception(_marketApiMessage(r));
    }
  }

  Future<void> _deleteListing(Map<String, dynamic> row) async {
    final id = (row['id'] as num).toInt();
    final title = row['title'] as String? ?? '';
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir anúncio'),
        content: Text('Remover «$title»?'),
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
    if (go != true || !mounted) return;
    try {
      final r = await http.delete(
        CondoApi.uri('/api/marketplace/$id', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        }),
      );
      if (r.statusCode != 204 && r.statusCode != 200) {
        throw Exception(_marketApiMessage(r));
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Anúncio removido.')),
        );
      }
      await _reloadAll();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  void _openEditor({
    required String listingScope,
    Map<String, dynamic>? existing,
  }) {
    Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (ctx) => _MarketListingEditorPage(
          condoId: widget.condoId,
          userId: widget.userId,
          listingScope: listingScope,
          existing: existing,
          uploadPhoto: _uploadPhoto,
          deletePhoto: _deletePhoto,
          onSaved: () async {
            Navigator.pop(ctx);
            await _reloadAll();
          },
        ),
      ),
    );
  }

  void _showDetail(Map<String, dynamic> row) {
    final scope = row['listing_scope'] as String? ?? 'residents';
    final photos = _parsePhotos(row['portfolio_photos']);
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) {
        final theme = Theme.of(ctx);
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.72,
          minChildSize: 0.45,
          maxChildSize: 0.94,
          builder: (_, scrollCtrl) {
            return ListView(
              controller: scrollCtrl,
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
              children: [
                Text(
                  row['title'] as String? ?? '',
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    Chip(
                      label: Text(
                        scope == 'condominium'
                            ? 'Área do condomínio'
                            : 'Área dos moradores',
                      ),
                      visualDensity: VisualDensity.compact,
                    ),
                    if ((row['category'] as String?)?.trim().isNotEmpty == true)
                      Chip(
                        label: Text(row['category'] as String),
                        visualDensity: VisualDensity.compact,
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  _priceLine(row),
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if ((row['created_by_name'] as String?)?.isNotEmpty == true)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'Publicado por ${row['created_by_name']}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                if ((row['description'] as String?)?.trim().isNotEmpty == true) ...[
                  const SizedBox(height: 16),
                  Text(row['description'] as String),
                ],
                const SizedBox(height: 16),
                Text(
                  'Contatos',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                ..._contactTiles(ctx, row),
                if (photos.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  Text(
                    'Fotos',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 120,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: photos.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 10),
                      itemBuilder: (_, i) {
                        final url = photos[i];
                        return ClipRRect(
                          borderRadius: BorderRadius.circular(12),
                          child: AspectRatio(
                            aspectRatio: 1,
                            child: Image.network(
                              CondoApi.uploadsUrl(url),
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => Container(
                                color: theme.colorScheme.surfaceContainerHighest,
                                child: const Icon(Icons.broken_image_outlined),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ],
                if (_mayEditListing(row) || _mayDeleteListing(row)) ...[
                  const SizedBox(height: 24),
                  Row(
                    children: [
                      if (_mayEditListing(row))
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () {
                              Navigator.pop(ctx);
                              _openEditor(
                                listingScope: row['listing_scope'] as String? ??
                                    'residents',
                                existing: row,
                              );
                            },
                            icon: const Icon(Icons.edit_rounded),
                            label: const Text('Editar'),
                          ),
                        ),
                      if (_mayEditListing(row) && _mayDeleteListing(row))
                        const SizedBox(width: 12),
                      if (_mayDeleteListing(row))
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: () {
                              Navigator.pop(ctx);
                              _deleteListing(row);
                            },
                            icon: const Icon(Icons.delete_outline_rounded),
                            label: const Text('Excluir'),
                            style: FilledButton.styleFrom(
                              backgroundColor: theme.colorScheme.error,
                              foregroundColor: theme.colorScheme.onError,
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            );
          },
        );
      },
    );
  }

  static List<String> _parsePhotos(dynamic raw) {
    if (raw == null) return [];
    if (raw is! List) return [];
    final out = <String>[];
    for (final e in raw) {
      if (e is Map && e['photo_url'] != null) {
        out.add(e['photo_url'].toString());
      }
    }
    return out;
  }

  static String _priceLine(Map<String, dynamic> row) {
    final amt = row['price_amount'];
    final note = row['price_note'] as String?;
    if (amt != null && '$amt'.trim().isNotEmpty && amt != 'null') {
      final n = num.tryParse(amt.toString());
      if (n != null) {
        final s =
            n % 1 == 0 ? n.toStringAsFixed(0) : n.toStringAsFixed(2);
        final tail =
            note != null && note.trim().isNotEmpty ? ' · $note' : '';
        return 'R\$ $s$tail';
      }
    }
    if (note != null && note.trim().isNotEmpty) {
      return note;
    }
    return 'Valor sob consulta';
  }

  List<Widget> _contactTiles(BuildContext ctx, Map<String, dynamic> row) {
    final hint = row['contact_hint'] as String?;
    final phone = row['contact_phone'] as String?;
    final email = row['contact_email'] as String?;
    final wa = row['contact_whatsapp'] as String?;
    final tiles = <Widget>[];

    void addRow({
      required IconData icon,
      required String label,
      required String value,
      VoidCallback? onTap,
    }) {
      tiles.add(
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(icon, size: 22),
          title: Text(label),
          subtitle: Text(value),
          onTap: onTap,
        ),
      );
    }

    if (phone != null && phone.trim().isNotEmpty) {
      final cleaned = phone.replaceAll(RegExp(r'\s'), '');
      addRow(
        icon: Icons.phone_rounded,
        label: 'Telefone',
        value: phone,
        onTap: () async {
          final u = Uri(scheme: 'tel', path: cleaned);
          if (await canLaunchUrl(u)) await launchUrl(u);
        },
      );
    }
    if (email != null && email.trim().isNotEmpty) {
      addRow(
        icon: Icons.email_outlined,
        label: 'E-mail',
        value: email,
        onTap: () async {
          final u = Uri(scheme: 'mailto', path: email.trim());
          if (await canLaunchUrl(u)) await launchUrl(u);
        },
      );
    }
    if (wa != null && wa.trim().isNotEmpty) {
      final digits = wa.replaceAll(RegExp(r'\D'), '');
      addRow(
        icon: Icons.chat_rounded,
        label: 'WhatsApp',
        value: wa,
        onTap: () async {
          final u = Uri.parse(
            digits.isEmpty
                ? 'https://wa.me/'
                : 'https://wa.me/$digits',
          );
          if (await canLaunchUrl(u)) {
            await launchUrl(u, mode: LaunchMode.externalApplication);
          }
        },
      );
    }
    if (hint != null && hint.trim().isNotEmpty) {
      addRow(
        icon: Icons.notes_rounded,
        label: 'Observações',
        value: hint,
      );
    }

    if (tiles.isEmpty) {
      tiles.add(
        Text(
          'Nenhum contato informado.',
          style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(
                color: Theme.of(ctx).colorScheme.onSurfaceVariant,
              ),
        ),
      );
    }
    return tiles;
  }

  Widget _buildTabBody({
    required bool loading,
    required Object? error,
    required List<Map<String, dynamic>> items,
    required String scope,
    required String emptyHint,
  }) {
    if (loading && items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (error != null && items.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('$error', textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => _reloadScope(scope),
                child: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }
    if (items.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            emptyHint,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => _reloadScope(scope),
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (_, i) {
          final row = items[i];
          final photos = _parsePhotos(row['portfolio_photos']);
          final thumb =
              photos.isNotEmpty ? CondoApi.uploadsUrl(photos.first) : null;
          return Card(
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => _showDetail(row),
              child: IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (thumb != null)
                      SizedBox(
                        width: 100,
                        child: Image.network(
                          thumb,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => Container(
                            color: Theme.of(context)
                                .colorScheme
                                .surfaceContainerHighest,
                            child: const Icon(Icons.image_not_supported_outlined),
                          ),
                        ),
                      )
                    else
                      Container(
                        width: 100,
                        color: Theme.of(context)
                            .colorScheme
                            .surfaceContainerHighest,
                        child: Icon(
                          Icons.storefront_rounded,
                          color: Theme.of(context).colorScheme.outline,
                        ),
                      ),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              row['title'] as String? ?? '',
                              style: Theme.of(context)
                                  .textTheme
                                  .titleSmall
                                  ?.copyWith(fontWeight: FontWeight.w800),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              _priceLine(row),
                              style: Theme.of(context)
                                  .textTheme
                                  .labelLarge
                                  ?.copyWith(
                                    color: Theme.of(context).colorScheme.primary,
                                    fontWeight: FontWeight.w700,
                                  ),
                            ),
                            if ((row['category'] as String?)
                                    ?.trim()
                                    .isNotEmpty ==
                                true)
                              Padding(
                                padding: const EdgeInsets.only(top: 6),
                                child: Text(
                                  row['category'] as String,
                                  style: Theme.of(context).textTheme.labelMedium,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget? _fab() {
    final idx = _tabController.index;
    if (idx == 0 && _canPostCondo) {
      return FloatingActionButton.extended(
        onPressed: () => _openEditor(listingScope: 'condominium'),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Anúncio condomínio'),
      );
    }
    if (idx == 1 && _canPostResidents) {
      return FloatingActionButton.extended(
        onPressed: () => _openEditor(listingScope: 'residents'),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Anúncio moradores'),
      );
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tabOnPrimary = cs.onPrimary;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Mercado Interno'),
        actions: [
          IconButton(
            tooltip: 'Atualizar',
            onPressed: _reloadAll,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          labelColor: tabOnPrimary,
          unselectedLabelColor: tabOnPrimary.withValues(alpha: 0.78),
          indicatorColor: tabOnPrimary,
          indicatorWeight: 3,
          labelStyle: const TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 14,
          ),
          unselectedLabelStyle: const TextStyle(
            fontWeight: FontWeight.w600,
            fontSize: 14,
          ),
          dividerColor: tabOnPrimary.withValues(alpha: 0.28),
          tabs: const [
            Tab(text: 'Condomínio'),
            Tab(text: 'Moradores'),
          ],
        ),
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Text(
              _tabController.index == 0
                  ? (_canPostCondo
                      ? 'Anúncios da administração, síndico e parceiros.'
                      : 'Somente administração, síndico e parceiros publicam nesta aba.')
                  : (_canPostResidents
                      ? 'Anúncios de moradores e do síndico.'
                      : 'Somente moradores e síndico publicam nesta aba.'),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: cs.onSurfaceVariant,
                  ),
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _buildTabBody(
                  loading: _loadingCondo,
                  error: _errorCondo,
                  items: _condoItems,
                  scope: 'condominium',
                  emptyHint:
                      'Nenhum anúncio do condomínio. ${_canPostCondo ? 'Toque em «Anúncio condomínio» para publicar.' : ''}',
                ),
                _buildTabBody(
                  loading: _loadingResident,
                  error: _errorResident,
                  items: _residentItems,
                  scope: 'residents',
                  emptyHint:
                      'Nenhum anúncio dos moradores. ${_canPostResidents ? 'Toque em «Anúncio moradores» para publicar.' : ''}',
                ),
              ],
            ),
          ),
        ],
      ),
      floatingActionButton: _fab(),
    );
  }
}

class _PendingPhoto {
  _PendingPhoto({required this.bytes, required this.filename});

  final List<int> bytes;
  final String filename;
}

class _MarketListingEditorPage extends StatefulWidget {
  const _MarketListingEditorPage({
    required this.condoId,
    required this.userId,
    required this.listingScope,
    required this.existing,
    required this.uploadPhoto,
    required this.deletePhoto,
    required this.onSaved,
  });

  final int condoId;
  final int userId;
  final String listingScope;
  final Map<String, dynamic>? existing;
  final Future<void> Function(int listingId, List<int> bytes, String filename)
      uploadPhoto;
  final Future<void> Function(int listingId, int photoId) deletePhoto;
  final VoidCallback onSaved;

  @override
  State<_MarketListingEditorPage> createState() =>
      _MarketListingEditorPageState();
}

class _MarketListingEditorPageState extends State<_MarketListingEditorPage> {
  final _formKey = GlobalKey<FormState>();
  late TextEditingController _titleCtrl;
  late TextEditingController _descCtrl;
  late TextEditingController _catCtrl;
  late TextEditingController _priceCtrl;
  late TextEditingController _priceNoteCtrl;
  late TextEditingController _phoneCtrl;
  late TextEditingController _emailCtrl;
  late TextEditingController _waCtrl;
  late TextEditingController _hintCtrl;

  final List<_PendingPhoto> _pending = [];
  List<Map<String, dynamic>> _existingPhotos = [];

  bool _saving = false;

  bool get _isEdit => widget.existing != null;

  /// Normaliza resposta da API (`portfolio_photos` em snake_case ou camelCase).
  static List<Map<String, dynamic>> _parsePortfolioPhotos(dynamic raw) {
    if (raw is! List) {
      return [];
    }
    final out = <Map<String, dynamic>>[];
    for (final item in raw) {
      if (item is! Map) {
        continue;
      }
      final m = Map<String, dynamic>.from(item);
      final idRaw = m['id'];
      final urlRaw = m['photo_url'] ?? m['photoUrl'];
      if (idRaw == null || urlRaw == null) {
        continue;
      }
      final id = idRaw is num ? idRaw.toInt() : int.tryParse('$idRaw');
      if (id == null) {
        continue;
      }
      out.add({
        ...m,
        'id': id,
        'photo_url': urlRaw.toString(),
      });
    }
    return out;
  }

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    _titleCtrl = TextEditingController(text: e?['title'] as String? ?? '');
    _descCtrl = TextEditingController(text: e?['description'] as String? ?? '');
    _catCtrl = TextEditingController(text: e?['category'] as String? ?? '');
    final pa = e?['price_amount'];
    _priceCtrl = TextEditingController(
      text: pa != null && '$pa'.trim().isNotEmpty && pa != 'null'
          ? pa.toString()
          : '',
    );
    _priceNoteCtrl =
        TextEditingController(text: e?['price_note'] as String? ?? '');
    _phoneCtrl =
        TextEditingController(text: e?['contact_phone'] as String? ?? '');
    _emailCtrl =
        TextEditingController(text: e?['contact_email'] as String? ?? '');
    _waCtrl =
        TextEditingController(text: e?['contact_whatsapp'] as String? ?? '');
    _hintCtrl =
        TextEditingController(text: e?['contact_hint'] as String? ?? '');

    _existingPhotos = _parsePortfolioPhotos(e?['portfolio_photos']);
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _catCtrl.dispose();
    _priceCtrl.dispose();
    _priceNoteCtrl.dispose();
    _phoneCtrl.dispose();
    _emailCtrl.dispose();
    _waCtrl.dispose();
    _hintCtrl.dispose();
    super.dispose();
  }

  int get _photoCount => _existingPhotos.length + _pending.length;

  Future<void> _pickPhotos() async {
    final room = _kMaxPhotos - _photoCount;
    if (room <= 0) return;
    final pick = await FilePicker.platform.pickFiles(
      allowMultiple: true,
      type: FileType.image,
      withData: true,
    );
    if (pick == null || pick.files.isEmpty) return;
    setState(() {
      for (final f in pick.files) {
        if (_photoCount >= _kMaxPhotos) break;
        final bytes = f.bytes;
        if (bytes == null || bytes.isEmpty) continue;
        _pending.add(
          _PendingPhoto(
            bytes: bytes,
            filename: f.name.isEmpty ? 'foto.jpg' : f.name,
          ),
        );
      }
    });
  }

  void _removePending(int i) {
    setState(() => _pending.removeAt(i));
  }

  Future<void> _confirmRemoveExisting(Map<String, dynamic> ph) async {
    if (!_isEdit) {
      return;
    }
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remover imagem'),
        content: const Text(
          'A foto será apagada agora no servidor. Não é necessário tocar em «Salvar alterações».',
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
            child: const Text('Remover'),
          ),
        ],
      ),
    );
    if (go == true && mounted) {
      await _removeExisting(ph);
    }
  }

  Future<void> _removeExisting(Map<String, dynamic> ph) async {
    final listingId = (widget.existing!['id'] as num).toInt();
    final photoId = ph['id'] is num ? (ph['id'] as num).toInt() : int.parse('${ph['id']}');
    try {
      await widget.deletePhoto(listingId, photoId);
      if (mounted) {
        setState(() => _existingPhotos.remove(ph));
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Imagem removida.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final title = _titleCtrl.text.trim();
    if (title.isEmpty) return;

    setState(() => _saving = true);
    try {
      double? priceAmount;
      final priceTxt = _priceCtrl.text.trim();
      if (priceTxt.isNotEmpty) {
        priceAmount = double.tryParse(priceTxt.replaceAll(',', '.'));
        if (priceAmount == null) {
          throw Exception('Preço inválido.');
        }
      }

      final body = <String, dynamic>{
        'condoId': widget.condoId,
        'userId': widget.userId,
        'title': title,
        if (!_isEdit) 'listingScope': widget.listingScope,
        'description': _descCtrl.text.trim().isEmpty
            ? null
            : _descCtrl.text.trim(),
        'category':
            _catCtrl.text.trim().isEmpty ? null : _catCtrl.text.trim(),
        'priceNote': _priceNoteCtrl.text.trim().isEmpty
            ? null
            : _priceNoteCtrl.text.trim(),
        'contactHint': _hintCtrl.text.trim().isEmpty
            ? null
            : _hintCtrl.text.trim(),
        'contactPhone': _phoneCtrl.text.trim().isEmpty
            ? null
            : _phoneCtrl.text.trim(),
        'contactEmail': _emailCtrl.text.trim().isEmpty
            ? null
            : _emailCtrl.text.trim(),
        'contactWhatsapp': _waCtrl.text.trim().isEmpty
            ? null
            : _waCtrl.text.trim(),
        'priceAmount': priceAmount,
      };

      late int listingId;

      if (_isEdit) {
        listingId = (widget.existing!['id'] as num).toInt();
        final r = await http.patch(
          CondoApi.uri('/api/marketplace/$listingId'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        );
        if (r.statusCode != 200) {
          throw Exception(_marketApiMessage(r));
        }
      } else {
        final r = await http.post(
          CondoApi.uri('/api/marketplace'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        );
        if (r.statusCode != 201) {
          throw Exception(_marketApiMessage(r));
        }
        final decoded = jsonDecode(r.body) as Map<String, dynamic>;
        listingId = (decoded['id'] as num).toInt();
      }

      for (final p in _pending) {
        await widget.uploadPhoto(listingId, p.bytes, p.filename);
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_isEdit ? 'Anúncio atualizado.' : 'Anúncio criado.'),
          ),
        );
        widget.onSaved();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scopeLabel = widget.listingScope == 'condominium'
        ? 'Área do condomínio'
        : 'Área dos moradores';

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? 'Editar anúncio' : 'Novo anúncio'),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Chip(label: Text(scopeLabel)),
            const SizedBox(height: 12),
            TextFormField(
              controller: _titleCtrl,
              decoration: const InputDecoration(
                labelText: 'Título',
                border: OutlineInputBorder(),
              ),
              validator: (v) =>
                  v == null || v.trim().isEmpty ? 'Informe o título.' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _descCtrl,
              decoration: const InputDecoration(
                labelText: 'Descrição',
                border: OutlineInputBorder(),
              ),
              maxLines: 4,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _catCtrl,
              decoration: const InputDecoration(
                labelText: 'Categoria (opcional)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  flex: 2,
                  child: TextFormField(
                    controller: _priceCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Preço (opcional)',
                      hintText: 'Ex.: 150 ou 99.90',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 3,
                  child: TextFormField(
                    controller: _priceNoteCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Detalhe do valor',
                      hintText: 'Ex.: Troca, negociável',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            Text(
              'Contatos',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: _phoneCtrl,
              decoration: const InputDecoration(
                labelText: 'Telefone',
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _emailCtrl,
              decoration: const InputDecoration(
                labelText: 'E-mail',
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.emailAddress,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _waCtrl,
              decoration: const InputDecoration(
                labelText: 'WhatsApp',
                hintText: 'DDD + número',
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _hintCtrl,
              decoration: const InputDecoration(
                labelText: 'Observações de contato (opcional)',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
            ),
            const SizedBox(height: 20),
            Text(
              'Imagens',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: 6),
            Text(
              _isEdit
                  ? 'Remover uma foto já publicada apaga-a na hora no servidor. '
                      'Para incluir novas fotos, use «Adicionar imagens» e depois '
                      '«Salvar alterações».'
                  : 'Adicione até $_kMaxPhotos imagens; serão enviadas ao publicar.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
            const SizedBox(height: 14),
            if (_existingPhotos.isNotEmpty) ...[
              Text(
                'Fotos do anúncio',
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: 8),
              for (var i = 0; i < _existingPhotos.length; i++)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Material(
                    color: Theme.of(context)
                        .colorScheme
                        .surfaceContainerHighest
                        .withValues(alpha: 0.55),
                    borderRadius: BorderRadius.circular(12),
                    child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: Image.network(
                              CondoApi.uploadsUrl(
                                _existingPhotos[i]['photo_url'].toString(),
                              ),
                              width: 72,
                              height: 72,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => Container(
                                width: 72,
                                height: 72,
                                color: Theme.of(context)
                                    .colorScheme
                                    .surfaceContainerHighest,
                                child:
                                    const Icon(Icons.broken_image_outlined),
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Foto ${i + 1}',
                                  style: Theme.of(context)
                                      .textTheme
                                      .titleSmall
                                      ?.copyWith(fontWeight: FontWeight.w700),
                                ),
                                const SizedBox(height: 2),
                                TextButton.icon(
                                  onPressed: () => _confirmRemoveExisting(
                                    _existingPhotos[i],
                                  ),
                                  icon: Icon(
                                    Icons.delete_outline_rounded,
                                    size: 20,
                                    color:
                                        Theme.of(context).colorScheme.error,
                                  ),
                                  label: Text(
                                    'Remover imagem',
                                    style: TextStyle(
                                      color: Theme.of(context)
                                          .colorScheme
                                          .error,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
            if (_pending.isNotEmpty) ...[
              Text(
                'Novas imagens (envio ao salvar)',
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: 8),
              for (var i = 0; i < _pending.length; i++)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Material(
                    color: Theme.of(context)
                        .colorScheme
                        .primaryContainer
                        .withValues(alpha: 0.42),
                    borderRadius: BorderRadius.circular(12),
                    child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: Image.memory(
                              Uint8List.fromList(_pending[i].bytes),
                              width: 72,
                              height: 72,
                              fit: BoxFit.cover,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Nova imagem ${i + 1}',
                                  style: Theme.of(context)
                                      .textTheme
                                      .titleSmall
                                      ?.copyWith(fontWeight: FontWeight.w700),
                                ),
                                TextButton.icon(
                                  onPressed: () => _removePending(i),
                                  icon: const Icon(Icons.close_rounded, size: 20),
                                  label: const Text('Descartar'),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
            if (_photoCount == 0)
              Padding(
                padding: const EdgeInsets.only(top: 4, bottom: 8),
                child: Text(
                  'Nenhuma imagem.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ),
            OutlinedButton.icon(
              onPressed: _photoCount >= _kMaxPhotos ? null : _pickPhotos,
              icon: const Icon(Icons.add_photo_alternate_outlined),
              label: Text(
                _photoCount >= _kMaxPhotos
                    ? 'Limite de $_kMaxPhotos imagens'
                    : 'Adicionar imagens (${_kMaxPhotos - _photoCount} vagas)',
              ),
            ),
            const SizedBox(height: 28),
            FilledButton.icon(
              onPressed: _saving ? null : _submit,
              icon: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save_rounded),
              label: Text(_isEdit ? 'Salvar alterações' : 'Publicar'),
            ),
          ],
        ),
      ),
    );
  }
}

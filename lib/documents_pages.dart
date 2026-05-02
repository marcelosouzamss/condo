import 'dart:async';
import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:url_launcher/url_launcher.dart';

const List<String> _kPresetDocTypes = [
  'Ata',
  'Regimento interno',
  'Convenção',
  'Contrato',
  'Financeiro',
  'Manutenção',
  'Comunicado',
  'Outro',
];

/// Documentos do condomínio: moradores visualizam e baixam; síndico e administração enviam e excluem.
class DocumentsHubPage extends StatefulWidget {
  const DocumentsHubPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
  });

  final int condoId;
  final int userId;
  final String userRole;

  @override
  State<DocumentsHubPage> createState() => _DocumentsHubPageState();
}

class _DocumentsHubPageState extends State<DocumentsHubPage> {
  List<Map<String, dynamic>> _docs = [];
  bool _loadingDocs = true;
  Object? _docsLoadError;

  bool get _canManage => CondoUserRoles.canManageDocuments(widget.userRole);

  int _docId(Map<String, dynamic> d) => (d['id'] as num).toInt();

  /// Na web o multipart sem Content-Type vira `application/octet-stream` e o multer rejeita.
  static MediaType? _documentMimeTypeFromFilename(String name) {
    final dot = name.lastIndexOf('.');
    final ext = dot >= 0 ? name.substring(dot).toLowerCase() : '';
    switch (ext) {
      case '.pdf':
        return MediaType('application', 'pdf');
      case '.doc':
        return MediaType('application', 'msword');
      case '.docx':
        return MediaType(
          'application',
          'vnd.openxmlformats-officedocument.wordprocessingml.document',
        );
      case '.xls':
        return MediaType('application', 'vnd.ms-excel');
      case '.xlsx':
        return MediaType(
          'application',
          'vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
      case '.txt':
        return MediaType('text', 'plain');
      case '.jpg':
      case '.jpeg':
        return MediaType('image', 'jpeg');
      case '.png':
        return MediaType('image', 'png');
      case '.gif':
        return MediaType('image', 'gif');
      case '.webp':
        return MediaType('image', 'webp');
      default:
        return null;
    }
  }

  @override
  void initState() {
    super.initState();
    _reloadDocs(initial: true);
  }

  Future<List<Map<String, dynamic>>> _fetchDocsFromApi() async {
    final r = await http.get(
      CondoApi.uri('/api/documents', {
        'condoId': '${widget.condoId}',
      }),
    );
    if (r.statusCode != 200) {
      throw Exception('Erro ${r.statusCode}');
    }
    final list = jsonDecode(r.body) as List<dynamic>;
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Future<void> _reloadDocs({bool initial = false}) async {
    if (initial && mounted) {
      setState(() {
        _loadingDocs = true;
        _docsLoadError = null;
      });
    }
    try {
      final list = await _fetchDocsFromApi();
      if (!mounted) {
        return;
      }
      setState(() {
        _docs = list;
        _loadingDocs = false;
        _docsLoadError = null;
      });
    } catch (e) {
      if (!mounted) {
        return;
      }
      setState(() {
        _docsLoadError = e;
        _loadingDocs = false;
      });
    }
  }

  void _upsertDocAtTop(Map<String, dynamic> row) {
    final id = _docId(row);
    if (!mounted) {
      return;
    }
    setState(() {
      _docs = [
        row,
        ..._docs.where((d) => _docId(d) != id),
      ];
      _docsLoadError = null;
    });
  }

  void _removeDocById(int id) {
    if (!mounted) {
      return;
    }
    setState(() {
      _docs = _docs.where((d) => _docId(d) != id).toList();
    });
  }

  String _formatDate(String? iso) {
    if (iso == null || iso.isEmpty) {
      return '';
    }
    final d = DateTime.tryParse(iso);
    if (d == null) {
      return '';
    }
    final loc = d.toLocal();
    return '${loc.day.toString().padLeft(2, '0')}/${loc.month.toString().padLeft(2, '0')}/${loc.year}';
  }

  Future<void> _download(Map<String, dynamic> doc) async {
    final rel = doc['storage_path'] as String? ?? '';
    final url = CondoApi.uploadsUrl(rel);
    final u = Uri.parse(url);
    if (!await canLaunchUrl(u)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Não foi possível abrir o arquivo.')),
        );
      }
      return;
    }
    await launchUrl(u, mode: LaunchMode.externalApplication);
  }

  Future<void> _confirmDelete(Map<String, dynamic> doc) async {
    final id = (doc['id'] as num).toInt();
    final title = doc['title'] as String? ?? '';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir documento'),
        content: Text(
          'Remover permanentemente “$title”? O arquivo será apagado do servidor.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) {
      return;
    }
    try {
      final r = await http.delete(
        CondoApi.uri('/api/documents/$id', {
          'condoId': '${widget.condoId}',
          'userId': '${widget.userId}',
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 204) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Falha ao excluir (${r.statusCode}).')),
        );
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Documento removido.')),
      );
      _removeDocById(id);
      unawaited(_reloadDocs());
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erro de rede.')),
        );
      }
    }
  }

  Future<void> _uploadNew() async {
    final created = await showDialog<Map<String, dynamic>?>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _DocumentUploadFlowDialog(
        condoId: widget.condoId,
        userId: widget.userId,
        mimeLookup: _documentMimeTypeFromFilename,
      ),
    );
    if (!mounted || created == null) {
      return;
    }
    _upsertDocAtTop(created);
    unawaited(_reloadDocs());
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Documentos'),
      ),
      floatingActionButton: _canManage
          ? FloatingActionButton.extended(
              onPressed: _uploadNew,
              icon: const Icon(Icons.upload_file_rounded),
              label: const Text('Adicionar'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () => _reloadDocs(),
        child: _buildDocsBody(theme, cs),
      ),
    );
  }

  Widget _buildDocsBody(ThemeData theme, ColorScheme cs) {
    if (_loadingDocs && _docs.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: const [
          SizedBox(height: 120),
          Center(child: CircularProgressIndicator()),
        ],
      );
    }
    if (_docsLoadError != null && _docs.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            'Não foi possível carregar os documentos. '
            'Confira o backend em ${CondoApi.baseUrl}.',
            style: TextStyle(color: cs.error),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () => _reloadDocs(initial: true),
            child: const Text('Tentar novamente'),
          ),
        ],
      );
    }
    if (_docs.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            _canManage
                ? 'Nenhum documento ainda. Toque em “Adicionar” para enviar o primeiro arquivo.'
                : 'Nenhum documento publicado ainda.',
            style: theme.textTheme.bodyLarge?.copyWith(
              color: cs.onSurfaceVariant,
            ),
          ),
        ],
      );
    }
    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
      itemCount: _docs.length,
      itemBuilder: (context, i) {
        final d = _docs[i];
        final title = d['title'] as String? ?? '';
        final docType = (d['document_type'] as String?)?.trim() ?? '';
        final fname = d['file_name'] as String? ?? '';
        final desc = (d['description'] as String?)?.trim();
        final created = d['created_at']?.toString();
        final size = d['byte_size'];
        final sizeStr = size is num ? _formatBytes(size.toInt()) : '';

        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.insert_drive_file_rounded, color: cs.primary),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          if (docType.isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Text(
                              docType,
                              style: theme.textTheme.labelLarge?.copyWith(
                                color: cs.primary,
                              ),
                            ),
                          ],
                          Text(
                            fname,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: cs.onSurfaceVariant,
                            ),
                          ),
                          if (desc != null && desc.isNotEmpty) ...[
                            const SizedBox(height: 6),
                            Text(desc, style: theme.textTheme.bodyMedium),
                          ],
                          const SizedBox(height: 4),
                          Text(
                            [
                              if (_formatDate(created).isNotEmpty)
                                'Publicado em ${_formatDate(created)}',
                              if (sizeStr.isNotEmpty) sizeStr,
                            ].join(' · '),
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: cs.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    FilledButton.tonalIcon(
                      onPressed: () => _download(d),
                      icon: const Icon(Icons.download_rounded),
                      label: const Text('Download'),
                    ),
                    if (_canManage)
                      FilledButton.tonalIcon(
                        onPressed: () => _confirmDelete(d),
                        icon: Icon(Icons.delete_outline_rounded, color: cs.error),
                        label: Text(
                          'Excluir',
                          style: TextStyle(color: cs.error),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  static String _formatBytes(int bytes) {
    if (bytes < 1024) {
      return '$bytes B';
    }
    if (bytes < 1024 * 1024) {
      return '${(bytes / 1024).toStringAsFixed(1)} KB';
    }
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

enum _DocUploadPhase { form, uploading, confirm }

String _documentsUploadErrorMessage(http.Response response) {
  try {
    final decoded = jsonDecode(response.body);
    if (decoded is Map && decoded['message'] is String) {
      final m = (decoded['message'] as String).trim();
      if (m.isNotEmpty) {
        return m;
      }
    }
  } catch (_) {
    /* ignore */
  }
  return 'Upload falhou (${response.statusCode}). '
      'Tipos: PDF, Word, Excel, imagens, TXT (até 16 MB).';
}

/// Fluxo: formulário → progresso no upload → Salvar / Cancelar.
/// Ao premir Salvar devolve o registo criado (corpo JSON do POST); caso contrário `null`.
class _DocumentUploadFlowDialog extends StatefulWidget {
  const _DocumentUploadFlowDialog({
    required this.condoId,
    required this.userId,
    required this.mimeLookup,
  });

  final int condoId;
  final int userId;
  final MediaType? Function(String filename) mimeLookup;

  @override
  State<_DocumentUploadFlowDialog> createState() =>
      _DocumentUploadFlowDialogState();
}

class _DocumentUploadFlowDialogState extends State<_DocumentUploadFlowDialog> {
  final _nomeCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _customTypeCtrl = TextEditingController();

  String _selectedType = _kPresetDocTypes.last;
  PlatformFile? _picked;
  MediaType? _pickedMime;

  _DocUploadPhase _phase = _DocUploadPhase.form;
  String? _inlineError;
  Map<String, dynamic>? _createdRow;

  @override
  void dispose() {
    _nomeCtrl.dispose();
    _descCtrl.dispose();
    _customTypeCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickFile() async {
    final messenger = ScaffoldMessenger.of(context);
    final result = await FilePicker.platform.pickFiles(withData: kIsWeb);
    if (!mounted || result == null || result.files.isEmpty) {
      return;
    }
    final f = result.files.single;
    final mime = widget.mimeLookup(f.name);
    if (mime == null) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text(
            'Extensão não suportada. Use PDF, Word, Excel, TXT ou imagem '
            '(JPEG, PNG, GIF, WEBP).',
          ),
        ),
      );
      return;
    }
    setState(() {
      _picked = f;
      _pickedMime = mime;
      _inlineError = null;
    });
  }

  bool _validateMeta() {
    final messenger = ScaffoldMessenger.of(context);
    final nome = _nomeCtrl.text.trim();
    if (nome.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Informe o nome do documento.')),
      );
      return false;
    }
    final documentType = _selectedType == 'Outro'
        ? _customTypeCtrl.text.trim()
        : _selectedType;
    if (documentType.isEmpty || documentType.length > 80) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Tipo inválido (até 80 caracteres).')),
      );
      return false;
    }
    if (_picked == null || _pickedMime == null) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Selecione um arquivo para enviar.')),
      );
      return false;
    }
    return true;
  }

  Future<void> _runUpload() async {
    if (!_validateMeta()) {
      return;
    }

    setState(() {
      _phase = _DocUploadPhase.uploading;
      _inlineError = null;
    });

    final nome = _nomeCtrl.text.trim();
    final title = nome.length > 200 ? nome.substring(0, 200) : nome;
    final documentType = _selectedType == 'Outro'
        ? _customTypeCtrl.text.trim()
        : _selectedType;
    final desc = _descCtrl.text.trim();

    final uri = CondoApi.uri('/api/documents/upload');
    final request = http.MultipartRequest('POST', uri);
    request.fields['condoId'] = '${widget.condoId}';
    request.fields['userId'] = '${widget.userId}';
    request.fields['documentType'] = documentType;
    request.fields['title'] = title;
    if (desc.isNotEmpty) {
      request.fields['description'] = desc;
    }

    try {
      final platformFile = _picked!;
      final mime = _pickedMime!;

      if (kIsWeb) {
        final bytes = platformFile.bytes;
        if (bytes == null) {
          throw Exception('bytes nulos');
        }
        request.files.add(
          http.MultipartFile.fromBytes(
            'file',
            bytes,
            filename: platformFile.name,
            contentType: mime,
          ),
        );
      } else {
        final path = platformFile.path;
        if (path == null) {
          throw Exception('caminho indisponível');
        }
        request.files.add(
          await http.MultipartFile.fromPath(
            'file',
            path,
            filename: platformFile.name,
            contentType: mime,
          ),
        );
      }

      final streamed = await request.send();
      final response = await http.Response.fromStream(streamed);

      if (!mounted) {
        return;
      }
      if (response.statusCode != 201) {
        setState(() {
          _phase = _DocUploadPhase.form;
          _inlineError = _documentsUploadErrorMessage(response);
        });
        return;
      }
      final decoded = jsonDecode(response.body);
      Map<String, dynamic>? row;
      if (decoded is Map) {
        row = Map<String, dynamic>.from(decoded);
      }
      if (!mounted) {
        return;
      }
      if (row == null) {
        setState(() {
          _phase = _DocUploadPhase.form;
          _inlineError = 'Resposta inválida do servidor.';
        });
        return;
      }
      setState(() {
        _createdRow = row;
        _phase = _DocUploadPhase.confirm;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() {
        _phase = _DocUploadPhase.form;
        _inlineError = 'Falha no envio. Verifique a rede e tente de novo.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final canPop = _phase != _DocUploadPhase.uploading;

    return PopScope(
      canPop: canPop,
      child: AlertDialog(
        title: Text(
          _phase == _DocUploadPhase.confirm
              ? 'Envio concluído'
              : 'Adicionar documento',
        ),
        content: SizedBox(
          width: double.maxFinite,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_phase == _DocUploadPhase.uploading) ...[
                  Text(
                    _picked?.name ?? '',
                    style: theme.textTheme.bodyMedium,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 16),
                  const LinearProgressIndicator(),
                  const SizedBox(height: 12),
                  Text(
                    'A enviar o arquivo…',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ] else if (_phase == _DocUploadPhase.confirm) ...[
                  Text(
                    'O arquivo foi enviado ao servidor. Toque em Salvar para '
                    'mostrar na lista ou Cancelar para fechar sem atualizar.',
                    style: theme.textTheme.bodyMedium,
                  ),
                ] else ...[
                  if (_inlineError != null) ...[
                    Text(
                      _inlineError!,
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                    const SizedBox(height: 12),
                  ],
                  DropdownButtonFormField<String>(
                    value: _selectedType,
                    decoration: const InputDecoration(
                      labelText: 'Tipo de documento',
                      border: OutlineInputBorder(),
                    ),
                    items: _kPresetDocTypes
                        .map(
                          (t) => DropdownMenuItem<String>(
                            value: t,
                            child: Text(t),
                          ),
                        )
                        .toList(),
                    onChanged: (v) {
                      if (v != null) {
                        setState(() => _selectedType = v);
                      }
                    },
                  ),
                  if (_selectedType == 'Outro') ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: _customTypeCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Descreva o tipo',
                        border: OutlineInputBorder(),
                      ),
                      maxLength: 80,
                    ),
                  ],
                  const SizedBox(height: 12),
                  TextField(
                    controller: _nomeCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Nome do documento',
                      hintText: 'Ex.: Ata assembleia abril',
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
                    maxLines: 3,
                  ),
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    onPressed: _pickFile,
                    icon: const Icon(Icons.attach_file_rounded),
                    label: Text(
                      _picked == null
                          ? 'Selecionar arquivo'
                          : 'Arquivo: ${_picked!.name}',
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        actions: [
          if (_phase == _DocUploadPhase.form) ...[
            TextButton(
              onPressed: () => Navigator.pop<Map<String, dynamic>?>(context, null),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: _runUpload,
              child: const Text('Enviar'),
            ),
          ] else if (_phase == _DocUploadPhase.uploading) ...[
            const SizedBox.shrink(),
          ] else ...[
            TextButton(
              onPressed: () => Navigator.pop<Map<String, dynamic>?>(context, null),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: _createdRow == null
                  ? null
                  : () => Navigator.pop<Map<String, dynamic>?>(
                        context,
                        _createdRow,
                      ),
              child: const Text('Salvar'),
            ),
          ],
        ],
      ),
    );
  }
}

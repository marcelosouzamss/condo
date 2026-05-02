import 'dart:convert';

import 'package:condo_app/syndic_metric_pages.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

String _backendErr(http.Response r) {
  try {
    final m = jsonDecode(r.body);
    if (m is Map && m['message'] != null) {
      return '${m['message']}';
    }
  } catch (_) {}
  return 'Erro ${r.statusCode}.';
}

/// Configuração do nome e logotipo exibidos na tela de login (síndico / administração).
class LoginBrandingSettingsPage extends StatefulWidget {
  const LoginBrandingSettingsPage({
    super.key,
    required this.condoId,
    required this.userId,
  });

  final int condoId;
  final int userId;

  @override
  State<LoginBrandingSettingsPage> createState() =>
      _LoginBrandingSettingsPageState();
}

class _LoginBrandingSettingsPageState extends State<LoginBrandingSettingsPage> {
  final TextEditingController _nameCtrl = TextEditingController();
  bool _loading = true;
  String? _loadError;
  String? _logoRelativePath;

  Uri _getUri() => CondoApi.uri('/api/administrator/condo-login-branding', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      });

  @override
  void dispose() {
    _nameCtrl.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final r = await http.get(_getUri());
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        setState(() {
          _loading = false;
          _loadError = _backendErr(r);
        });
        return;
      }
      final m = jsonDecode(r.body) as Map<String, dynamic>;
      final name = m['condominiumName'] as String? ?? '';
      final lp = m['logoRelativePath'] as String?;
      setState(() {
        _nameCtrl.text = name;
        _logoRelativePath =
            lp != null && lp.trim().isNotEmpty ? lp.trim() : null;
        _loading = false;
        _loadError = null;
      });
    } catch (e) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _loadError = '$e';
      });
    }
  }

  Future<void> _saveName() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe o nome do condomínio.')),
      );
      return;
    }
    try {
      final r = await http.patch(
        CondoApi.uri('/api/administrator/condo-login-branding'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'userId': widget.userId,
          'condominiumName': name,
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_backendErr(r))),
        );
        return;
      }
      final m = jsonDecode(r.body) as Map<String, dynamic>;
      final lp = m['logoRelativePath'] as String?;
      setState(() {
        _logoRelativePath =
            lp != null && lp.trim().isNotEmpty ? lp.trim() : null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Nome salvo.')),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Falha: $e')),
        );
      }
    }
  }

  Future<void> _pickLogo() async {
    final pick = await FilePicker.platform.pickFiles(
      type: FileType.image,
      withData: true,
    );
    if (pick == null || pick.files.isEmpty || !mounted) {
      return;
    }
    final f = pick.files.first;
    final bytes = f.bytes;
    if (bytes == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Não foi possível ler a imagem. Tente outro arquivo.',
          ),
        ),
      );
      return;
    }
    final fn = f.name.isEmpty ? 'logo.png' : f.name;
    final uri = CondoApi.uri('/api/administrator/condo-login-logo', {
      'condoId': '${widget.condoId}',
      'userId': '${widget.userId}',
    });
    try {
      final req = http.MultipartRequest('POST', uri)
        ..files.add(
          http.MultipartFile.fromBytes(
            'logo',
            bytes,
            filename: fn,
          ),
        );
      final streamed = await req.send();
      final resp = await http.Response.fromStream(streamed);
      if (!mounted) {
        return;
      }
      if (resp.statusCode != 201) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_backendErr(resp))),
        );
        return;
      }
      final m = jsonDecode(resp.body) as Map<String, dynamic>;
      final lp = m['logoRelativePath'] as String?;
      setState(() {
        _logoRelativePath =
            lp != null && lp.trim().isNotEmpty ? lp.trim() : null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Logo atualizado.')),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Falha no envio: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Tela de login'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _loadError != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text('$_loadError', textAlign: TextAlign.center),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: _reload,
                          child: const Text('Tentar de novo'),
                        ),
                      ],
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text(
                      'Nome e imagem aparecem na tela de entrada do aplicativo para todos os usuários.',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: cs.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: _nameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Nome do condomínio',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: _saveName,
                        child: const Text('Salvar nome'),
                      ),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      'Logotipo',
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (_logoRelativePath != null)
                      ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Image.network(
                          CondoApi.uploadsUrl(_logoRelativePath!),
                          height: 120,
                          fit: BoxFit.contain,
                          errorBuilder: (_, __, ___) => Container(
                            height: 120,
                            alignment: Alignment.center,
                            color: cs.surfaceContainerHighest,
                            child: Icon(Icons.broken_image_outlined, color: cs.primary),
                          ),
                        ),
                      )
                    else
                      Container(
                        height: 100,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: cs.surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          'Nenhuma imagem',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: cs.onSurfaceVariant,
                          ),
                        ),
                      ),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: _pickLogo,
                      icon: const Icon(Icons.image_outlined),
                      label: const Text('Escolher imagem (PNG, JPEG, WebP ou GIF)'),
                    ),
                  ],
                ),
    );
  }
}

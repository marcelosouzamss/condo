import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

/// Contatos do condomínio: síndico, administração, ramais de interfone, etc.
class ContactsHubPage extends StatefulWidget {
  const ContactsHubPage({super.key, required this.userRole});

  final String userRole;

  static const int condoId = 1;

  @override
  State<ContactsHubPage> createState() => _ContactsHubPageState();
}

class _ContactsHubPageState extends State<ContactsHubPage> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  Object? _loadError;

  bool get _canManage => CondoUserRoles.isOperationalStaff(widget.userRole);

  @override
  void initState() {
    super.initState();
    _loadContacts();
  }

  Future<List<Map<String, dynamic>>> _fetchList() async {
    final q = <String, String>{
      'condoId': '${ContactsHubPage.condoId}',
      if (_canManage) 'manage': 'true',
      if (!_canManage) 'viewerRole': widget.userRole,
    };
    final r = await http.get(
      CondoApi.uri('/api/contacts', q),
    );
    if (r.statusCode != 200) {
      throw Exception('Erro ${r.statusCode}');
    }
    final list = jsonDecode(r.body) as List<dynamic>;
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Future<void> _loadContacts({bool showFullScreenLoading = true}) async {
    if (showFullScreenLoading) {
      setState(() {
        _loading = true;
        _loadError = null;
      });
    } else if (mounted) {
      setState(() => _loadError = null);
    }
    try {
      final list = await _fetchList();
      if (!mounted) {
        return;
      }
      setState(() {
        _items = list;
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

  Future<void> _refresh() => _loadContacts(showFullScreenLoading: true);

  static String categoryLabel(String? cat) {
    switch (cat) {
      case 'syndic':
        return 'Síndico';
      case 'administration':
        return 'Administração';
      case 'intercom':
        return 'Ramais / interfones';
      case 'other':
        return 'Outros';
      default:
        return cat ?? '';
    }
  }

  static String visibleToLabel(String? v) {
    switch (v) {
      case 'syndic_only':
        return 'Visível: apenas síndico';
      case 'syndic_administration':
        return 'Visível: síndico e administração';
      case 'operational_staff':
        return 'Visível: equipe (inclui colaboradores)';
      case 'everyone':
        return 'Visível: todos os perfis';
      default:
        return 'Visível: todos os perfis';
    }
  }

  static IconData categoryIcon(String? cat) {
    switch (cat) {
      case 'syndic':
        return Icons.account_balance_rounded;
      case 'administration':
        return Icons.business_center_rounded;
      case 'intercom':
        return Icons.phone_in_talk_rounded;
      default:
        return Icons.contact_phone_rounded;
    }
  }

  Future<void> _launchTel(String? raw) async {
    if (raw == null || raw.trim().isEmpty) {
      return;
    }
    final digits = raw.replaceAll(RegExp(r'[^\d+]'), '');
    if (digits.isEmpty) {
      return;
    }
    final u = Uri.parse('tel:$digits');
    if (await canLaunchUrl(u)) {
      await launchUrl(u);
    }
  }

  Future<void> _launchMail(String? email) async {
    if (email == null || email.trim().isEmpty) {
      return;
    }
    final addr = email.trim();
    final u = Uri(scheme: 'mailto', path: addr);
    if (await canLaunchUrl(u)) {
      await launchUrl(u);
    }
  }

  Future<void> _openEditor({Map<String, dynamic>? existing}) async {
    final isEdit = existing != null;
    final id = existing != null ? (existing['id'] as num).toInt() : null;

    final nameCtrl = TextEditingController(text: existing?['name'] as String? ?? '');
    final phoneCtrl = TextEditingController(text: existing?['phone'] as String? ?? '');
    final extCtrl = TextEditingController(text: existing?['extension'] as String? ?? '');
    final emailCtrl = TextEditingController(text: existing?['email'] as String? ?? '');
    final notesCtrl = TextEditingController(text: existing?['notes'] as String? ?? '');
    final orderCtrl = TextEditingController(
      text: existing != null
          ? '${existing['sort_order'] ?? 0}'
          : '0',
    );

    String category = (existing?['category'] as String?) ?? 'syndic';
    String visibleTo = (existing?['visible_to'] as String?) ?? 'everyone';

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setLocal) {
          return AlertDialog(
            title: Text(isEdit ? 'Editar contato' : 'Novo contato'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DropdownButtonFormField<String>(
                    value: category,
                    decoration: const InputDecoration(
                      labelText: 'Tipo',
                      border: OutlineInputBorder(),
                    ),
                    items: const [
                      DropdownMenuItem(value: 'syndic', child: Text('Síndico')),
                      DropdownMenuItem(
                        value: 'administration',
                        child: Text('Administração'),
                      ),
                      DropdownMenuItem(
                        value: 'intercom',
                        child: Text('Ramal / interfone'),
                      ),
                      DropdownMenuItem(value: 'other', child: Text('Outros')),
                    ],
                    onChanged: (v) {
                      if (v != null) {
                        setLocal(() => category = v);
                      }
                    },
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: visibleTo,
                    decoration: const InputDecoration(
                      labelText: 'Visível para',
                      border: OutlineInputBorder(),
                    ),
                    items: const [
                      DropdownMenuItem(
                        value: 'everyone',
                        child: Text('Todos os perfis'),
                      ),
                      DropdownMenuItem(
                        value: 'syndic_only',
                        child: Text('Apenas síndico'),
                      ),
                      DropdownMenuItem(
                        value: 'syndic_administration',
                        child: Text('Síndico e administração'),
                      ),
                      DropdownMenuItem(
                        value: 'operational_staff',
                        child: Text(
                          'Equipe (síndico, administração e colaboradores)',
                        ),
                      ),
                    ],
                    onChanged: (v) {
                      if (v != null) {
                        setLocal(() => visibleTo = v);
                      }
                    },
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Nome ou identificação',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: phoneCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Telefone / WhatsApp',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.phone,
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: extCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Ramal (interfone, se houver)',
                      border: OutlineInputBorder(),
                    ),
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
                    controller: notesCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Observações',
                      border: OutlineInputBorder(),
                    ),
                    maxLines: 3,
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: orderCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Ordem na lista',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.number,
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
      phoneCtrl.dispose();
      extCtrl.dispose();
      emailCtrl.dispose();
      notesCtrl.dispose();
      orderCtrl.dispose();
      return;
    }

    final name = nameCtrl.text.trim();
    if (name.isEmpty) {
      nameCtrl.dispose();
      phoneCtrl.dispose();
      extCtrl.dispose();
      emailCtrl.dispose();
      notesCtrl.dispose();
      orderCtrl.dispose();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe o nome.')),
      );
      return;
    }

    final sortOrder = int.tryParse(orderCtrl.text.trim()) ?? 0;

    try {
      if (isEdit && id != null) {
        final r = await http.patch(
          CondoApi.uri('/api/contacts/$id'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'condoId': ContactsHubPage.condoId,
            'category': category,
            'name': name,
            'phone': phoneCtrl.text.trim(),
            'extension': extCtrl.text.trim(),
            'email': emailCtrl.text.trim(),
            'notes': notesCtrl.text.trim(),
            'sortOrder': sortOrder,
            'visibleTo': visibleTo,
          }),
        );
        if (!mounted) {
          return;
        }
        if (r.statusCode != 200) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Erro ao salvar (${r.statusCode}).')),
          );
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Contato atualizado.')),
          );
          await _loadContacts(showFullScreenLoading: false);
        }
      } else {
        final r = await http.post(
          CondoApi.uri('/api/contacts'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'condoId': ContactsHubPage.condoId,
            'category': category,
            'name': name,
            'phone': phoneCtrl.text.trim(),
            'extension': extCtrl.text.trim(),
            'email': emailCtrl.text.trim(),
            'notes': notesCtrl.text.trim(),
            'sortOrder': sortOrder,
            'visibleTo': visibleTo,
          }),
        );
        if (!mounted) {
          return;
        }
        if (r.statusCode != 201) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Erro ao cadastrar (${r.statusCode}).')),
          );
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Contato cadastrado.')),
          );
          await _loadContacts(showFullScreenLoading: false);
        }
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Falha de rede.')),
        );
      }
    }

    nameCtrl.dispose();
    phoneCtrl.dispose();
    extCtrl.dispose();
    emailCtrl.dispose();
    notesCtrl.dispose();
    orderCtrl.dispose();
  }

  Future<void> _confirmDelete(Map<String, dynamic> row) async {
    final id = (row['id'] as num).toInt();
    final name = row['name'] as String? ?? '';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir contato'),
        content: Text('Remover “$name” da lista?'),
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
        CondoApi.uri('/api/contacts/$id', {
          'condoId': '${ContactsHubPage.condoId}',
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
        const SnackBar(content: Text('Contato removido.')),
      );
      await _loadContacts(showFullScreenLoading: false);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Falha de rede.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Contatos')),
      floatingActionButton: _canManage
          ? FloatingActionButton.extended(
              onPressed: () => _openEditor(),
              icon: const Icon(Icons.person_add_rounded),
              label: const Text('Novo contato'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: Builder(
          builder: (context) {
            if (_loading) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 120),
                  Center(child: CircularProgressIndicator()),
                ],
              );
            }
            if (_loadError != null) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(24),
                children: [
                  Text(
                    'Não foi possível carregar. Verifique ${CondoApi.baseUrl}.',
                    style: TextStyle(color: cs.error),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _loadContacts,
                    child: const Text('Tentar novamente'),
                  ),
                ],
              );
            }

            final items = _items;
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(24),
                children: [
                  Text(
                    _canManage
                        ? 'Nenhum contato cadastrado. Use “Novo contato” para adicionar síndico, administração, ramais etc.'
                        : 'Nenhum contato publicado ainda.',
                    style: theme.textTheme.bodyLarge?.copyWith(color: cs.onSurfaceVariant),
                  ),
                ],
              );
            }

            final byCat = <String, List<Map<String, dynamic>>>{};
            for (final m in items) {
              final c = m['category'] as String? ?? 'other';
              byCat.putIfAbsent(c, () => []).add(m);
            }

            final order = ['syndic', 'administration', 'intercom', 'other'];

            return ListView.builder(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
              itemCount: order.length,
              itemBuilder: (context, sectionIdx) {
                final cat = order[sectionIdx];
                final rows = byCat[cat];
                if (rows == null || rows.isEmpty) {
                  return const SizedBox.shrink();
                }
                var isFirstVisible = true;
                for (var j = 0; j < sectionIdx; j++) {
                  final prev = byCat[order[j]];
                  if (prev != null && prev.isNotEmpty) {
                    isFirstVisible = false;
                    break;
                  }
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: EdgeInsets.only(
                        bottom: 8,
                        top: isFirstVisible ? 0 : 16,
                      ),
                      child: Row(
                        children: [
                          Icon(categoryIcon(cat), size: 22, color: cs.primary),
                          const SizedBox(width: 8),
                          Text(
                            categoryLabel(cat),
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                    ),
                    ...rows.map((row) {
                      final name = row['name'] as String? ?? '';
                      final phone = row['phone'] as String?;
                      final ext = row['extension'] as String?;
                      final email = row['email'] as String?;
                      final notes = (row['notes'] as String?)?.trim();

                      return Card(
                        margin: const EdgeInsets.only(bottom: 10),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                name,
                                style: theme.textTheme.titleSmall?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              if (_canManage) ...[
                                const SizedBox(height: 4),
                                Text(
                                  visibleToLabel(
                                    row['visible_to'] as String?,
                                  ),
                                  style: theme.textTheme.labelMedium?.copyWith(
                                    color: cs.primary,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                              if (ext != null && ext.isNotEmpty) ...[
                                const SizedBox(height: 6),
                                Row(
                                  children: [
                                    Icon(Icons.dialpad_rounded, size: 18, color: cs.tertiary),
                                    const SizedBox(width: 6),
                                    Text(
                                      'Ramal $ext',
                                      style: theme.textTheme.titleSmall?.copyWith(
                                        color: cs.tertiary,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                              if (phone != null && phone.isNotEmpty) ...[
                                const SizedBox(height: 4),
                                SelectableText(phone, style: theme.textTheme.bodyMedium),
                              ],
                              if (email != null && email.isNotEmpty) ...[
                                const SizedBox(height: 4),
                                SelectableText(email, style: theme.textTheme.bodyMedium),
                              ],
                              if (notes != null && notes.isNotEmpty) ...[
                                const SizedBox(height: 8),
                                Text(
                                  notes,
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: cs.onSurfaceVariant,
                                  ),
                                ),
                              ],
                              const SizedBox(height: 12),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  if (phone != null && phone.isNotEmpty)
                                    FilledButton.tonalIcon(
                                      onPressed: () => _launchTel(phone),
                                      icon: const Icon(Icons.call_rounded),
                                      label: const Text('Ligar'),
                                    ),
                                  if (email != null && email.isNotEmpty)
                                    FilledButton.tonalIcon(
                                      onPressed: () => _launchMail(email),
                                      icon: const Icon(Icons.email_rounded),
                                      label: const Text('E-mail'),
                                    ),
                                  if (_canManage) ...[
                                    IconButton.outlined(
                                      tooltip: 'Editar',
                                      onPressed: () => _openEditor(existing: row),
                                      icon: const Icon(Icons.edit_rounded),
                                    ),
                                    IconButton.outlined(
                                      tooltip: 'Excluir',
                                      onPressed: () => _confirmDelete(row),
                                      icon: Icon(Icons.delete_outline_rounded, color: cs.error),
                                    ),
                                  ],
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    }),
                  ],
                );
              },
            );
          },
        ),
      ),
    );
  }
}

import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

const List<String> kOfferCategories = [
  'Todas',
  'Restaurantes',
  'Mercado',
  'Serviços',
  'Saúde',
  'Lazer',
  'Outros',
];

class OffersPage extends StatefulWidget {
  const OffersPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
    required this.userName,
  });

  final int condoId;
  final int userId;
  final String userRole;
  final String userName;

  @override
  State<OffersPage> createState() => _OffersPageState();
}

class _OffersPageState extends State<OffersPage> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;
  String _selectedCategory = 'Todas';
  bool _showInactive = false;

  bool get _canPublish =>
      widget.userRole == CondoUserRoles.syndic ||
      widget.userRole == CondoUserRoles.administrator ||
      widget.userRole == CondoUserRoles.partner;

  bool get _isPartner => widget.userRole == CondoUserRoles.partner;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final query = <String, String>{
        'condoId': '${widget.condoId}',
        if (_selectedCategory != 'Todas') 'category': _selectedCategory,
        if (_canPublish && _showInactive) 'includeInactive': 'true',
        if (widget.userRole == CondoUserRoles.resident)
          'forUserId': '${widget.userId}',
      };
      final r = await http.get(CondoApi.uri('/api/offers', query));
      if (!mounted) return;
      if (r.statusCode != 200) {
        setState(() {
          _error = 'Erro ao carregar ofertas (${r.statusCode}).';
          _loading = false;
        });
        return;
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      setState(() {
        _items = list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Falha de rede.';
          _loading = false;
        });
      }
    }
  }

  Future<void> _openEditor({Map<String, dynamic>? existing}) async {
    if (!_canPublish) return;

    final scope = _isPartner ? 'partner' : 'condo';

    final titleCtrl =
        TextEditingController(text: existing?['title'] as String? ?? '');
    final descCtrl =
        TextEditingController(text: existing?['description'] as String? ?? '');
    final partnerCtrl = TextEditingController(
        text: existing?['partner_label'] as String? ?? '');
    final couponCtrl =
        TextEditingController(text: existing?['coupon_text'] as String? ?? '');
    final programCtrl = TextEditingController(
      text: existing?['program_instructions'] as String? ?? '',
    );
    final phoneCtrl = TextEditingController(
        text: existing?['contact_phone'] as String? ?? '');
    final waCtrl = TextEditingController(
        text: existing?['contact_whatsapp'] as String? ?? '');
    final emailCtrl = TextEditingController(
        text: existing?['contact_email'] as String? ?? '');
    final urlCtrl =
        TextEditingController(text: existing?['contact_url'] as String? ?? '');

    String category = existing?['category'] as String? ?? 'Outros';
    if (!kOfferCategories.contains(category)) {
      category = 'Outros';
    }

    String redemption =
        existing?['redemption_kind'] as String? ?? 'coupon_code';
    if (redemption != 'coupon_code' && redemption != 'loyalty_program') {
      redemption = 'coupon_code';
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(ctx).bottom,
          ),
          child: StatefulBuilder(
            builder: (ctx, setModal) {
              return SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      existing == null ? 'Nova oferta' : 'Editar oferta',
                      style: Theme.of(ctx).textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    const SizedBox(height: 8),
                    if (!_isPartner)
                      Text(
                        'Publicação pelo ${CondoUserRoles.labelPt(widget.userRole)} · âmbito condomínio',
                        style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                              color: Theme.of(ctx).colorScheme.onSurfaceVariant,
                            ),
                      )
                    else
                      Text(
                        'Oferta de parceiro',
                        style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                              color: Theme.of(ctx).colorScheme.onSurfaceVariant,
                            ),
                      ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: titleCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Título',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: descCtrl,
                      minLines: 2,
                      maxLines: 5,
                      decoration: const InputDecoration(
                        labelText: 'Descrição do desconto ou promoção',
                        border: OutlineInputBorder(),
                        alignLabelWithHint: true,
                      ),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: category,
                      decoration: const InputDecoration(
                        labelText: 'Categoria',
                        border: OutlineInputBorder(),
                      ),
                      items: kOfferCategories
                          .where((c) => c != 'Todas')
                          .map(
                            (c) => DropdownMenuItem(value: c, child: Text(c)),
                          )
                          .toList(),
                      onChanged: (v) {
                        if (v != null) {
                          setModal(() => category = v);
                        }
                      },
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Como o morador obtém o benefício',
                      style: Theme.of(ctx).textTheme.labelLarge?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                    const SizedBox(height: 8),
                    SegmentedButton<String>(
                      segments: const [
                        ButtonSegment(
                          value: 'coupon_code',
                          label: Text('Cupom'),
                          icon: Icon(Icons.local_activity_rounded),
                        ),
                        ButtonSegment(
                          value: 'loyalty_program',
                          label: Text('Programa'),
                          icon: Icon(Icons.groups_rounded),
                        ),
                      ],
                      selected: {redemption},
                      onSelectionChanged: (s) {
                        setModal(() => redemption = s.first);
                      },
                    ),
                    const SizedBox(height: 12),
                    if (redemption == 'coupon_code')
                      TextField(
                        controller: couponCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Frase ou código do cupom',
                          hintText: 'Ex.: CONDOMINIO10',
                          border: OutlineInputBorder(),
                        ),
                      )
                    else
                      TextField(
                        controller: programCtrl,
                        minLines: 2,
                        maxLines: 4,
                        decoration: const InputDecoration(
                          labelText: 'Como aderir ao programa',
                          hintText:
                              'Ex.: Cadastre-se no balcão informando a torre e o apto.',
                          border: OutlineInputBorder(),
                          alignLabelWithHint: true,
                        ),
                      ),
                    const SizedBox(height: 20),
                    Text(
                      'Contatos (opcional)',
                      style: Theme.of(ctx).textTheme.labelLarge?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: partnerCtrl,
                      decoration: InputDecoration(
                        labelText: _isPartner
                            ? 'Nome do estabelecimento'
                            : 'Marca / estabelecimento',
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: phoneCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Telefone',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: waCtrl,
                      decoration: const InputDecoration(
                        labelText: 'WhatsApp',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: emailCtrl,
                      decoration: const InputDecoration(
                        labelText: 'E-mail',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.emailAddress,
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: urlCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Site ou link',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.url,
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed: () async {
                        final messenger = ScaffoldMessenger.of(context);
                        final payload = <String, dynamic>{
                          'condoId': widget.condoId,
                          'userId': widget.userId,
                          'scope': scope,
                          'title': titleCtrl.text.trim(),
                          'description': descCtrl.text.trim(),
                          'category': category,
                          'redemptionKind': redemption,
                          'couponText': couponCtrl.text.trim(),
                          'programInstructions': programCtrl.text.trim(),
                          'partnerLabel': partnerCtrl.text.trim(),
                          'contactPhone': phoneCtrl.text.trim(),
                          'contactWhatsapp': waCtrl.text.trim(),
                          'contactEmail': emailCtrl.text.trim(),
                          'contactUrl': urlCtrl.text.trim(),
                        };

                        if (existing != null) {
                          payload.remove('scope');
                          payload.remove('condoId');
                          final id = (existing['id'] as num).toInt();
                          final res = await http.patch(
                            CondoApi.uri('/api/offers/$id'),
                            headers: {'Content-Type': 'application/json'},
                            body: jsonEncode(payload),
                          );
                          if (!ctx.mounted) return;
                          Navigator.pop(ctx);
                          if (!mounted) return;
                          if (res.statusCode == 200) {
                            messenger.showSnackBar(
                              const SnackBar(
                                  content: Text('Oferta atualizada.')),
                            );
                            _reload();
                          } else {
                            messenger.showSnackBar(
                              SnackBar(
                                  content: Text('Erro (${res.statusCode}).')),
                            );
                          }
                          return;
                        }

                        final res = await http.post(
                          CondoApi.uri('/api/offers'),
                          headers: {'Content-Type': 'application/json'},
                          body: jsonEncode(payload),
                        );
                        if (!ctx.mounted) return;
                        Navigator.pop(ctx);
                        if (!mounted) return;
                        if (res.statusCode == 201) {
                          messenger.showSnackBar(
                            const SnackBar(content: Text('Oferta publicada.')),
                          );
                          _reload();
                        } else {
                          final msg = res.body.isNotEmpty
                              ? (jsonDecode(res.body) as Map)['message']
                                  ?.toString()
                              : '${res.statusCode}';
                          messenger.showSnackBar(
                            SnackBar(content: Text(msg ?? 'Erro ao publicar.')),
                          );
                        }
                      },
                      icon: const Icon(Icons.save_rounded),
                      label: Text(existing == null ? 'Publicar' : 'Salvar'),
                    ),
                  ],
                ),
              );
            },
          ),
        );
      },
    );

    titleCtrl.dispose();
    descCtrl.dispose();
    partnerCtrl.dispose();
    couponCtrl.dispose();
    programCtrl.dispose();
    phoneCtrl.dispose();
    waCtrl.dispose();
    emailCtrl.dispose();
    urlCtrl.dispose();
  }

  Future<void> _deleteOffer(Map<String, dynamic> row) async {
    final id = (row['id'] as num).toInt();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir oferta?'),
        content: const Text('Esta ação não pode ser desfeita.'),
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
    if (ok != true || !mounted) return;

    final r = await http.delete(
      CondoApi.uri('/api/offers/$id', {'userId': '${widget.userId}'}),
    );
    if (!mounted) return;
    if (r.statusCode == 204) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Oferta removida.')),
      );
      _reload();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro (${r.statusCode}).')),
      );
    }
  }

  Future<void> _toggleActive(Map<String, dynamic> row, bool active) async {
    final id = (row['id'] as num).toInt();
    final r = await http.patch(
      CondoApi.uri('/api/offers/$id'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'userId': widget.userId,
        'active': active,
      }),
    );
    if (!mounted) return;
    if (r.statusCode == 200) {
      _reload();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro (${r.statusCode}).')),
      );
    }
  }

  Future<void> _enroll(Map<String, dynamic> row) async {
    final id = (row['id'] as num).toInt();
    final r = await http.post(
      CondoApi.uri('/api/offers/$id/enroll'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'userId': widget.userId}),
    );
    if (!mounted) return;
    if (r.statusCode == 200 || r.statusCode == 201) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Adesão registrada.')),
      );
      _reload();
    } else {
      final msg = r.body.isNotEmpty
          ? (jsonDecode(r.body) as Map)['message']?.toString()
          : '${r.statusCode}';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg ?? 'Não foi possível aderir.')),
      );
    }
  }

  Future<void> _launchTel(String v) async {
    final u = Uri(scheme: 'tel', path: v.replaceAll(RegExp(r'\s'), ''));
    if (await canLaunchUrl(u)) await launchUrl(u);
  }

  Future<void> _launchWa(String v) async {
    final digits = v.replaceAll(RegExp(r'\D'), '');
    final u = Uri.parse('https://wa.me/$digits');
    if (await canLaunchUrl(u)) {
      await launchUrl(u, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _launchMail(String v) async {
    final u = Uri(scheme: 'mailto', path: v);
    if (await canLaunchUrl(u)) await launchUrl(u);
  }

  Future<void> _launchHttp(String v) async {
    var s = v.trim();
    if (!s.startsWith('http')) {
      s = 'https://$s';
    }
    final u = Uri.tryParse(s);
    if (u != null && await canLaunchUrl(u)) {
      await launchUrl(u, mode: LaunchMode.externalApplication);
    }
  }

  String _scopePt(String s) {
    switch (s) {
      case 'partner':
        return 'Parceiro';
      case 'resident':
        return 'Morador';
      default:
        return 'Condomínio';
    }
  }

  Widget _offerCard(Map<String, dynamic> row) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final title = row['title'] as String? ?? '';
    final description = row['description'] as String? ?? '';
    final category = row['category'] as String? ?? 'Outros';
    final scope = row['scope'] as String? ?? '';
    final partnerLabel = row['partner_label'] as String? ?? '';
    final redemption = row['redemption_kind'] as String? ?? 'coupon_code';
    final coupon = row['coupon_text'] as String? ?? '';
    final program = row['program_instructions'] as String? ?? '';
    final phone = row['contact_phone'] as String? ?? '';
    final wa = row['contact_whatsapp'] as String? ?? '';
    final email = row['contact_email'] as String? ?? '';
    final url = row['contact_url'] as String? ?? '';
    final active = row['active'] == true;
    final createdBy = row['created_by_user_id'];
    final viewerEnrolled = row['viewer_enrolled'] == true;

    final canEdit = _canPublish &&
        (widget.userRole == CondoUserRoles.syndic ||
            widget.userRole == CondoUserRoles.administrator ||
            (widget.userRole == CondoUserRoles.partner &&
                createdBy == widget.userId));

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
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        children: [
                          Chip(
                            label: Text(category),
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                            labelStyle: theme.textTheme.labelSmall,
                          ),
                          Chip(
                            label: Text(_scopePt(scope)),
                            visualDensity: VisualDensity.compact,
                          ),
                          if (!active && _canPublish && _showInactive)
                            Chip(
                              label: const Text('Inativa'),
                              visualDensity: VisualDensity.compact,
                              backgroundColor: cs.errorContainer,
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (canEdit)
                  PopupMenuButton<String>(
                    onSelected: (v) {
                      if (v == 'edit') {
                        _openEditor(existing: row);
                      } else if (v == 'del') {
                        _deleteOffer(row);
                      } else if (v == 'off') {
                        _toggleActive(row, false);
                      } else if (v == 'on') {
                        _toggleActive(row, true);
                      }
                    },
                    itemBuilder: (ctx) => [
                      const PopupMenuItem(value: 'edit', child: Text('Editar')),
                      if (active)
                        const PopupMenuItem(
                          value: 'off',
                          child: Text('Desativar'),
                        )
                      else
                        const PopupMenuItem(
                          value: 'on',
                          child: Text('Reativar'),
                        ),
                      const PopupMenuItem(value: 'del', child: Text('Excluir')),
                    ],
                  ),
              ],
            ),
            if (partnerLabel.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                partnerLabel,
                style: theme.textTheme.titleSmall?.copyWith(
                  color: cs.primary,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
            if (description.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(description, style: theme.textTheme.bodyMedium),
            ],
            const SizedBox(height: 12),
            if (redemption == 'coupon_code' && coupon.isNotEmpty) ...[
              Text(
                'Cupom',
                style: theme.textTheme.labelLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: cs.secondaryContainer.withValues(alpha: 0.45),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: SelectableText(
                        coupon,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Copiar',
                      onPressed: () async {
                        await Clipboard.setData(ClipboardData(text: coupon));
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Cupom copiado.')),
                          );
                        }
                      },
                      icon: const Icon(Icons.copy_rounded),
                    ),
                  ],
                ),
              ),
            ] else if (redemption == 'loyalty_program') ...[
              Text(
                'Programa da oferta',
                style: theme.textTheme.labelLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              Text(program, style: theme.textTheme.bodyMedium),
              if (widget.userRole == CondoUserRoles.resident) ...[
                const SizedBox(height: 10),
                if (viewerEnrolled)
                  Text(
                    'Você já aderiu a esta oferta.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: cs.primary,
                      fontWeight: FontWeight.w600,
                    ),
                  )
                else if (active)
                  FilledButton.tonalIcon(
                    onPressed: () => _enroll(row),
                    icon: const Icon(Icons.how_to_reg_rounded),
                    label: const Text('Aderir ao programa'),
                  ),
              ],
            ],
            if (phone.isNotEmpty ||
                wa.isNotEmpty ||
                email.isNotEmpty ||
                url.isNotEmpty) ...[
              const SizedBox(height: 14),
              Text(
                'Contatos',
                style: theme.textTheme.labelLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (phone.isNotEmpty)
                    ActionChip(
                      avatar: const Icon(Icons.phone_rounded, size: 18),
                      label: Text(phone),
                      onPressed: () => _launchTel(phone),
                    ),
                  if (wa.isNotEmpty)
                    ActionChip(
                      avatar: const Icon(Icons.chat_rounded, size: 18),
                      label: Text(wa),
                      onPressed: () => _launchWa(wa),
                    ),
                  if (email.isNotEmpty)
                    ActionChip(
                      avatar: const Icon(Icons.email_rounded, size: 18),
                      label: Text(email),
                      onPressed: () => _launchMail(email),
                    ),
                  if (url.isNotEmpty)
                    ActionChip(
                      avatar: const Icon(Icons.link_rounded, size: 18),
                      label: const Text('Site / link'),
                      onPressed: () => _launchHttp(url),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Ofertas')),
      floatingActionButton: _canPublish
          ? FloatingActionButton.extended(
              onPressed: () => _openEditor(),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Nova oferta'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
          children: [
            Text(
              'Descontos e parcerias',
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Síndico, administração e parceiros publicam promoções. '
              'Os moradores usam cupom ou aderem ao programa, conforme cada oferta.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: cs.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 20),
            const Text(
              'Filtros por categoria',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: kOfferCategories.map((c) {
                return ChoiceChip(
                  label: Text(c),
                  selected: _selectedCategory == c,
                  onSelected: (_) {
                    setState(() => _selectedCategory = c);
                    _reload();
                  },
                );
              }).toList(),
            ),
            if (_canPublish) ...[
              const SizedBox(height: 12),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Mostrar ofertas inativas'),
                value: _showInactive,
                onChanged: (v) {
                  setState(() => _showInactive = v);
                  _reload();
                },
              ),
            ],
            const SizedBox(height: 16),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(48),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              Text(_error!, style: TextStyle(color: cs.error))
            else if (_items.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 24),
                child: Text(
                  _selectedCategory == 'Todas'
                      ? 'Nenhuma oferta publicada.'
                      : 'Nenhuma oferta nesta categoria.',
                  style: theme.textTheme.bodyLarge?.copyWith(
                    color: cs.onSurfaceVariant,
                  ),
                ),
              )
            else
              ..._items.map(_offerCard),
          ],
        ),
      ),
    );
  }
}

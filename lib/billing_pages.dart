import 'dart:convert';
import 'dart:math' as math;

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

String _brl(dynamic raw) {
  final n = raw is num
      ? raw.toDouble()
      : double.tryParse('${raw ?? 0}'.replaceAll(',', '.')) ?? 0;
  return 'R\$ ${n.toStringAsFixed(2).replaceAll('.', ',')}';
}

void _showPixQrDialog(BuildContext context, String data) {
  showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('PIX — QR Code'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
              ),
              child: QrImageView(
                data: data,
                size: 220,
                backgroundColor: Colors.white,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Escaneie no app do seu banco. Em produção, o QR segue o padrão EMV do PIX.',
              style: Theme.of(ctx).textTheme.bodySmall,
            ),
          ],
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

String _formatBillingDue(dynamic raw) {
  if (raw == null) return '';
  final s = '${raw ?? ''}'.trim();
  if (s.isEmpty) return '';
  final d = DateTime.tryParse(s);
  if (d != null) {
    final l = d.toLocal();
    return '${l.day.toString().padLeft(2, '0')}/${l.month.toString().padLeft(2, '0')}/${l.year}';
  }
  return s;
}

String _apiMessageFromBody(String body, {required String fallback}) {
  try {
    final j = jsonDecode(body);
    if (j is Map &&
        j['message'] != null &&
        '${j['message']}'.trim().isNotEmpty) {
      return '${j['message']}';
    }
  } catch (_) {}
  return fallback;
}

/// Morador: paga e consulta boletos. Staff: competências e geração em lote.
class OnlineBillingHubPage extends StatelessWidget {
  const OnlineBillingHubPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
    required this.unitId,
  });

  final int condoId;
  final int userId;
  final String userRole;
  final int? unitId;

  bool get _isStaff => CondoUserRoles.isBillingStaff(userRole);

  @override
  Widget build(BuildContext context) {
    if (_isStaff) {
      return _StaffBillingHomePage(
        condoId: condoId,
        userId: userId,
      );
    }
    return _ResidentBillingPage(
      condoId: condoId,
      userId: userId,
      unitId: unitId,
    );
  }
}

class _StaffBillingHomePage extends StatefulWidget {
  const _StaffBillingHomePage({
    required this.condoId,
    required this.userId,
  });

  final int condoId;
  final int userId;

  @override
  State<_StaffBillingHomePage> createState() => _StaffBillingHomePageState();
}

class _StaffBillingHomePageState extends State<_StaffBillingHomePage> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<dynamic>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/billing/campaigns', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      }),
    );
    if (r.statusCode != 200) {
      throw Exception('Erro ${r.statusCode}');
    }
    return jsonDecode(r.body) as List<dynamic>;
  }

  Future<void> _refresh() async {
    setState(() {
      _future = _load();
    });
    await _future;
  }

  String _statusLabel(String s) {
    switch (s) {
      case 'draft':
        return 'Rascunho';
      case 'generated':
        return 'Boletos gerados';
      case 'closed':
        return 'Encerrada';
      default:
        return s;
    }
  }

  String _dueYmdForField(dynamic raw) {
    final d = DateTime.tryParse('${raw ?? ''}');
    if (d == null) return '';
    final l = d.toLocal();
    return '${l.year}-${l.month.toString().padLeft(2, '0')}-${l.day.toString().padLeft(2, '0')}';
  }

  String _numFieldText(dynamic raw) {
    if (raw == null) return '';
    final n =
        raw is num ? raw.toDouble() : double.tryParse('$raw'.replaceAll(',', '.'));
    if (n == null || n.isNaN) return '';
    if ((n - n.round()).abs() < 1e-9) return '${n.round()}';
    return n.toStringAsFixed(2).replaceAll('.', ',');
  }

  Future<void> _deleteCampaignRow(Map<String, dynamic> row) async {
    final id = (row['id'] as num).toInt();
    final nCharges = row['charges_count'] is num
        ? (row['charges_count'] as num).toInt()
        : 0;
    final status = row['status'] as String? ?? '';
    if (status != 'draft' || nCharges > 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Só é possível excluir competências em rascunho e sem cobranças geradas.',
          ),
        ),
      );
      return;
    }
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir competência?'),
        content: Text('Remover “${row['title'] ?? ''}” (${row['competence'] ?? ''})? Esta ação não pode ser desfeita.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(foregroundColor: Colors.white, backgroundColor: Colors.red.shade700),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) {
      return;
    }
    final r = await http.delete(
      CondoApi.uri('/api/billing/campaigns/$id', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 204) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Competência excluída.')),
      );
      await _refresh();
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(_apiMessageFromBody(
          r.body,
          fallback: 'Não foi possível excluir (${r.statusCode}).',
        )),
      ),
    );
  }

  Future<void> _openCampaignForm({Map<String, dynamic>? existing}) async {
    final row = existing;
    final isEdit = row != null;
    final editingId = isEdit ? (row['id'] as num).toInt() : null;
    final now = DateTime.now();
    final titleCtrl = TextEditingController(
      text: isEdit ? (row['title'] as String? ?? '') : '',
    );
    final compCtrl = TextEditingController(
      text: isEdit
          ? (row['competence'] as String? ??
              '${now.month.toString().padLeft(2, '0')}/${now.year}')
          : '${now.month.toString().padLeft(2, '0')}/${now.year}',
    );
    final dueCtrl = TextEditingController(
      text: isEdit
          ? _dueYmdForField(row['due_date'])
          : '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}',
    );
    final notesCtrl = TextEditingController(
      text: isEdit ? ((row['notes'] as String?) ?? '') : '',
    );
    final fineCtrl = TextEditingController(
      text: isEdit ? _numFieldText(row['fine_percent']) : '',
    );
    final interestCtrl = TextEditingController(
      text: isEdit ? _numFieldText(row['interest_percent_month']) : '',
    );
    final discountCtrl = TextEditingController(
      text: isEdit ? _numFieldText(row['discount_amount']) : '',
    );

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(
          isEdit ? 'Editar competência' : 'Nova competência de cobrança',
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'PIX, boleto e código de barras são gerados automaticamente ao você emitir as cobranças. '
                'A conta ou gateway do condomínio fica configurado na integração — não pedimos dados de banco a cada cobrança.',
                style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                      color: Theme.of(ctx).colorScheme.onSurfaceVariant,
                    ),
              ),
              if (isEdit) ...[
                const SizedBox(height: 8),
                Text(
                  'Só é possível editar enquanto a competência está em rascunho.',
                  style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                        color: Theme.of(ctx).colorScheme.tertiary,
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ],
              const SizedBox(height: 16),
              TextField(
                controller: titleCtrl,
                decoration: const InputDecoration(
                  labelText: 'Título (ex.: Condomínio maio/2026)',
                ),
              ),
              TextField(
                controller: compCtrl,
                decoration: const InputDecoration(
                  labelText: 'Competência (ex.: 05/2026)',
                  helperText: 'Valor único por condomínio — se der erro 409, altere este campo.',
                ),
              ),
              TextField(
                controller: dueCtrl,
                decoration: const InputDecoration(
                  labelText: 'Vencimento (AAAA-MM-DD)',
                ),
              ),
              TextField(
                controller: fineCtrl,
                decoration: const InputDecoration(
                  labelText: 'Multa % (opcional)',
                ),
                keyboardType: TextInputType.number,
              ),
              TextField(
                controller: interestCtrl,
                decoration: const InputDecoration(
                  labelText: 'Juros ao mês % (opcional)',
                ),
                keyboardType: TextInputType.number,
              ),
              TextField(
                controller: discountCtrl,
                decoration: const InputDecoration(
                  labelText: 'Desconto fixo R\$ por unidade (opcional)',
                ),
                keyboardType: TextInputType.number,
              ),
              TextField(
                controller: notesCtrl,
                maxLines: 2,
                decoration: const InputDecoration(labelText: 'Observações'),
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
            child: Text(isEdit ? 'Salvar alterações' : 'Salvar rascunho'),
          ),
        ],
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
      'competence': compCtrl.text.trim().isEmpty
          ? '—'
          : compCtrl.text.trim(),
      'dueDate': dueCtrl.text.trim(),
      if (notesCtrl.text.trim().isNotEmpty) 'notes': notesCtrl.text.trim(),
      if (fineCtrl.text.trim().isNotEmpty)
        'finePercent': double.tryParse(fineCtrl.text.replaceAll(',', '.')),
      if (interestCtrl.text.trim().isNotEmpty)
        'interestPercentMonth':
            double.tryParse(interestCtrl.text.replaceAll(',', '.')),
      if (discountCtrl.text.trim().isNotEmpty)
        'discountAmount':
            double.tryParse(discountCtrl.text.replaceAll(',', '.')),
    };
    late final http.Response r;
    if (isEdit) {
      r = await http.patch(
        CondoApi.uri('/api/billing/campaigns/$editingId'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
    } else {
      r = await http.post(
        CondoApi.uri('/api/billing/campaigns'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
    }
    if (!mounted) {
      return;
    }
    final success = (!isEdit && r.statusCode == 201) || (isEdit && r.statusCode == 200);
    if (!success) {
      final msg = _apiMessageFromBody(
        r.body,
        fallback:
            'Não foi possível salvar (${r.statusCode}). Verifique sua conexão.',
      );
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg)),
      );
      return;
    }
    await _refresh();
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          isEdit ? 'Competência atualizada.' : 'Competência criada em rascunho.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Cobrança e boletos'),
        actions: [
          IconButton(
            onPressed: _refresh,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openCampaignForm(),
        icon: const Icon(Icons.playlist_add_rounded),
        label: const Text('Nova competência'),
      ),
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
                    Icon(Icons.error_outline, size: 48, color: cs.error),
                    const SizedBox(height: 12),
                    Text('Falha ao carregar. ${CondoApi.baseUrl}'),
                    FilledButton(
                      onPressed: _refresh,
                      child: const Text('Tentar de novo'),
                    ),
                  ],
                ),
              ),
            );
          }
          final rows = snap.data ?? [];
          if (rows.isEmpty) {
            return ListView(
              padding: const EdgeInsets.all(24),
              children: [
                Text(
                  'Crie uma competência (ex.: “Condomínio maio/2026”). Na competência, use “Gerar para todas as unidades” ou “Gerar para uma unidade”; moradores só baixam PDF, QR e PIX.',
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const SizedBox(height: 12),
                Text(
                  'Valores por unidade: taxa + fundo de reserva menos o desconto fixo da competência. '
                  'Garanta taxas cadastradas em Administração → unidades. '
                  'Integração Asaas/Efi usa a conta de recebimento do condomínio — sem dados de banco por competência.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: cs.onSurfaceVariant,
                      ),
                ),
              ],
            );
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
            children: [
              Card(
                color: cs.primaryContainer.withValues(alpha: 0.35),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Emissão de PIX e boleto',
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Ao gerar cobranças por unidade, o app preenche PIX, código de barras e link/PDF usando o modo simulado '
                        '(ou seu gateway já configurado no servidor para o condomínio). O síndico não informa conta corrente a cada cobrança.',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: cs.onPrimaryContainer.withValues(alpha: 0.9),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              ...rows.map<Widget>((dynamic row) {
                final m = row as Map<String, dynamic>;
                final id = (m['id'] as num).toInt();
                final title = m['title'] as String? ?? '';
                final comp = m['competence'] as String? ?? '';
                final status = m['status'] as String? ?? '';
                final due = _formatBillingDue(m['due_date']);
                final nCharges = m['charges_count'] is num
                    ? (m['charges_count'] as num).toInt()
                    : 0;
                return Card(
                  child: ListTile(
                    title: Text(title),
                    subtitle: Text(
                      '$comp · Venc.: $due · ${_statusLabel(status)} · $nCharges cobrança(s)',
                    ),
                    onTap: () async {
                      await Navigator.of(context).push<void>(
                        MaterialPageRoute<void>(
                          builder: (context) => _StaffCampaignDetailPage(
                            condoId: widget.condoId,
                            userId: widget.userId,
                            campaignId: id,
                            title: title,
                            status: status,
                          ),
                        ),
                      );
                      await _refresh();
                    },
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (status == 'draft')
                          PopupMenuButton<String>(
                            tooltip: 'Opções',
                            onSelected: (v) async {
                              if (v == 'edit') {
                                await _openCampaignForm(existing: m);
                              } else if (v == 'delete') {
                                await _deleteCampaignRow(m);
                              }
                            },
                            itemBuilder: (ctx) => [
                              const PopupMenuItem(
                                value: 'edit',
                                child: Text('Editar rascunho'),
                              ),
                              if (nCharges == 0)
                                const PopupMenuItem(
                                  value: 'delete',
                                  child: Text(
                                    'Excluir competência',
                                    style: TextStyle(color: Colors.red),
                                  ),
                                ),
                            ],
                          ),
                        const Icon(Icons.chevron_right_rounded),
                      ],
                    ),
                  ),
                );
              }),
            ],
          );
        },
      ),
    );
  }
}

class _StaffCampaignDetailPage extends StatefulWidget {
  const _StaffCampaignDetailPage({
    required this.condoId,
    required this.userId,
    required this.campaignId,
    required this.title,
    required this.status,
  });

  final int condoId;
  final int userId;
  final int campaignId;
  final String title;
  final String status;

  @override
  State<_StaffCampaignDetailPage> createState() =>
      _StaffCampaignDetailPageState();
}

class _StaffCampaignDetailPageState extends State<_StaffCampaignDetailPage> {
  late Future<List<dynamic>> _future;
  late String _campaignStatus;

  @override
  void initState() {
    super.initState();
    _campaignStatus = widget.status;
    _future = _load();
    _syncCampaignStatus();
  }

  Future<void> _syncCampaignStatus() async {
    final r = await http.get(
      CondoApi.uri('/api/billing/campaigns/${widget.campaignId}', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      }),
    );
    if (!mounted || r.statusCode != 200) {
      return;
    }
    final m = jsonDecode(r.body) as Map<String, dynamic>;
    final st = m['status'] as String?;
    if (st != null) {
      setState(() => _campaignStatus = st);
    }
  }

  Future<List<dynamic>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/billing/campaigns/${widget.campaignId}/charges', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      }),
    );
    if (r.statusCode != 200) {
      throw Exception('Erro ${r.statusCode}');
    }
    return jsonDecode(r.body) as List<dynamic>;
  }

  Future<void> _refresh() async {
    await _syncCampaignStatus();
    setState(() => _future = _load());
    await _future;
  }

  Future<void> _generateBatch() async {
    final r = await http.post(
      CondoApi.uri(
        '/api/billing/campaigns/${widget.campaignId}/generate',
      ),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'userId': widget.userId,
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode != 201) {
      final msg = _apiMessageFromBody(
        r.body,
        fallback:
            'Geração em lote não concluída (${r.statusCode}). Veja mensagem do servidor.',
      );
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg)),
      );
      if (r.statusCode == 422) {
        await _refresh();
      }
      return;
    }
    final body = jsonDecode(r.body) as Map<String, dynamic>;
    final total = body['chargesTotal'];
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Boletos gerados para todas as unidades ativas. Total: $total')),
    );
    await _refresh();
  }

  Future<void> _generateForOneUnit() async {
    final unitsR = await http.get(
      CondoApi.uri('/api/administrator/units', {
        'condoId': '${widget.condoId}',
      }),
    );
    if (!mounted) {
      return;
    }
    if (unitsR.statusCode != 200) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Não foi possível carregar unidades (${unitsR.statusCode}).')),
      );
      return;
    }
    final chargesR = await http.get(
      CondoApi.uri('/api/billing/campaigns/${widget.campaignId}/charges', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      }),
    );
    if (!mounted) {
      return;
    }
    if (chargesR.statusCode != 200) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível carregar cobranças existentes.')),
      );
      return;
    }
    final units = jsonDecode(unitsR.body) as List<dynamic>;
    final charges = jsonDecode(chargesR.body) as List<dynamic>;
    final billed = charges
        .map((e) => (e as Map<String, dynamic>)['unit_id'] as num?)
        .whereType<num>()
        .map((id) => id.toInt())
        .toSet();
    final eligible = units.where((u) {
      final m = u as Map<String, dynamic>;
      final id = (m['id'] as num).toInt();
      final billingActive = m['billing_active'] == true;
      return billingActive && !billed.contains(id);
    }).toList();

    if (!mounted) {
      return;
    }
    if (eligible.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Nenhuma unidade elegível (todas já têm cobrança ou cobrança inativa).'),
        ),
      );
      return;
    }

    eligible.sort((a, b) {
      final ma = a as Map<String, dynamic>;
      final mb = b as Map<String, dynamic>;
      final ta = '${ma['tower']}';
      final tb = '${mb['tower']}';
      final c = ta.compareTo(tb);
      if (c != 0) {
        return c;
      }
      return '${ma['number']}'.compareTo('${mb['number']}');
    });

    final theme = Theme.of(context);
    final mq = MediaQuery.of(context);
    final sheetMaxH = math.min(280.0, mq.size.height * 0.38);

    final picked = await showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      constraints: BoxConstraints(maxHeight: sheetMaxH),
      builder: (ctx) => SafeArea(
        child: SizedBox(
          height: sheetMaxH,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 2, 16, 8),
                child: Text(
                  'Escolha a unidade',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              Expanded(
                child: ListView.separated(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 0),
                  itemCount: eligible.length,
                  separatorBuilder: (_, __) => Divider(
                    height: 1,
                    color: theme.colorScheme.outlineVariant,
                  ),
                  itemBuilder: (context, i) {
                    final m = eligible[i] as Map<String, dynamic>;
                    final id = (m['id'] as num).toInt();
                    final tower = m['tower'] as String? ?? '';
                    final number = m['number'] as String? ?? '';
                    return ListTile(
                      dense: true,
                      visualDensity: VisualDensity.compact,
                      title: Text(
                        'Bl. $tower · $number',
                        style: theme.textTheme.bodyMedium,
                      ),
                      onTap: () => Navigator.pop(ctx, id),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );

    if (picked == null || !mounted) {
      return;
    }

    final r = await http.post(
      CondoApi.uri(
        '/api/billing/campaigns/${widget.campaignId}/charges/generate-one',
      ),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'userId': widget.userId,
        'unitId': picked,
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode != 201) {
      String msg = 'Falha (${r.statusCode}).';
      try {
        final b = jsonDecode(r.body);
        if (b is Map && b['message'] != null) {
          msg = '${b['message']}';
        }
      } catch (_) {}
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Boleto gerado para a unidade selecionada.')),
    );
    await _refresh();
  }

  Future<void> _finalizeCampaign() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Encerrar competência?'),
        content: const Text(
          'A competência passa ao status “boletos gerados”. '
          'Use quando já tiver gerado os boletos unidade a unidade, ou antes de comunicar aos moradores.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Confirmar')),
        ],
      ),
    );
    if (ok != true || !mounted) {
      return;
    }

    final r = await http.post(
      CondoApi.uri('/api/billing/campaigns/${widget.campaignId}/finalize'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'userId': widget.userId,
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode != 200) {
      String msg = 'Não foi possível finalizar.';
      try {
        final b = jsonDecode(r.body);
        if (b is Map && b['message'] != null) {
          msg = '${b['message']}';
        }
      } catch (_) {}
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Competência encerrada para geração.')),
    );
    await _refresh();
  }

  Future<void> _markPaid(int chargeId) async {
    final r = await http.post(
      CondoApi.uri('/api/billing/charges/$chargeId/mark-paid'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'userId': widget.userId,
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode != 200) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível marcar como pago.')),
      );
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Marcado como pago.')),
    );
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final isDraft = _campaignStatus == 'draft';

    Widget? bottomBar;
    if (isDraft) {
      bottomBar = SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: FutureBuilder<List<dynamic>>(
            future: _future,
            builder: (context, snap) {
              final hasCharges = (snap.data ?? []).isNotEmpty;
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  FilledButton.icon(
                    onPressed: _generateBatch,
                    icon: const Icon(Icons.layers_rounded),
                    label: const Text('Gerar para todas as unidades'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: _generateForOneUnit,
                    icon: const Icon(Icons.single_bed_rounded),
                    label: const Text('Gerar para uma unidade'),
                  ),
                  if (hasCharges) ...[
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: _finalizeCampaign,
                      child: const Text('Encerrar competência (marcar como gerada)'),
                    ),
                  ],
                ],
              );
            },
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh_rounded)),
        ],
      ),
      bottomNavigationBar: bottomBar,
      body: FutureBuilder<List<dynamic>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(child: Text('Erro: ${snap.error}'));
          }
          final list = snap.data ?? [];
          if (list.isEmpty) {
            return ListView(
              padding: const EdgeInsets.all(24),
              children: [
                Text(
                  isDraft
                      ? 'Nenhuma cobrança ainda. Use “Gerar para todas as unidades” para criar boletos para todas as unidades ativas, ou “Gerar para uma unidade” para emitir individualmente (simulado até integrar o gateway).'
                      : 'Sem itens.',
                ),
              ],
            );
          }
          return ListView.builder(
            padding: EdgeInsets.fromLTRB(16, 16, 16, isDraft ? 200 : 16),
            itemCount: list.length,
            itemBuilder: (context, i) {
              final m = list[i] as Map<String, dynamic>;
              final id = (m['id'] as num).toInt();
              final tower = m['tower'] as String? ?? '';
              final number = m['number'] as String? ?? '';
              final amount = _brl(m['amount']);
              final st = m['status'] as String? ?? '';
              return Card(
                child: ListTile(
                  title: Text('Torre $tower · $number'),
                  subtitle: Text('$amount · $st'),
                  trailing: st == 'pending'
                      ? TextButton(
                          onPressed: () => _markPaid(id),
                          child: const Text('Marcar pago'),
                        )
                      : null,
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class _ResidentBillingPage extends StatefulWidget {
  const _ResidentBillingPage({
    required this.condoId,
    required this.userId,
    required this.unitId,
  });

  final int condoId;
  final int userId;
  final int? unitId;

  @override
  State<_ResidentBillingPage> createState() => _ResidentBillingPageState();
}

class _ResidentBillingPageState extends State<_ResidentBillingPage> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<dynamic>> _load() async {
    if (widget.unitId == null) {
      throw Exception('no_unit');
    }
    final r = await http.get(
      CondoApi.uri('/api/billing/my-charges', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
        'unitId': '${widget.unitId}',
      }),
    );
    if (r.statusCode != 200) {
      throw Exception('Erro ${r.statusCode}');
    }
    return jsonDecode(r.body) as List<dynamic>;
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  Future<void> _openUrl(String? url) async {
    if (url == null || url.isEmpty) {
      return;
    }
    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (mounted && !ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível abrir o link.')),
      );
    }
  }

  void _copy(String label, String? text) {
    if (text == null || text.isEmpty) {
      return;
    }
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$label copiado.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    if (widget.unitId == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Boleto online')),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'Sua conta não está vinculada a uma unidade. Peça à administradora para associar seu login à sua unidade.',
            style: Theme.of(context).textTheme.bodyLarge,
          ),
        ),
      );
    }

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Boleto online'),
          actions: [
            IconButton(
              onPressed: _refresh,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(46),
            child: TabBar(
              labelColor: Colors.white,
              unselectedLabelColor:
                  Colors.white.withValues(alpha: 0.88),
              labelStyle: const TextStyle(
                fontWeight: FontWeight.w800,
                fontSize: 14,
              ),
              unselectedLabelStyle: const TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 14,
              ),
              indicatorColor: Colors.white,
              indicatorWeight: 3,
              indicatorSize: TabBarIndicatorSize.tab,
              dividerHeight: 0,
              dividerColor: Colors.white24,
              tabs: const [
                Tab(text: 'Pendentes'),
                Tab(text: 'Histórico'),
              ],
            ),
          ),
        ),
        body: FutureBuilder<List<dynamic>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              final err = snap.error.toString();
              if (err.contains('no_unit')) {
                return const SizedBox.shrink();
              }
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.cloud_off_rounded, size: 48, color: cs.error),
                      const SizedBox(height: 12),
                      Text(err),
                      FilledButton(
                        onPressed: _refresh,
                        child: const Text('Tentar de novo'),
                      ),
                    ],
                  ),
                ),
              );
            }
            final rows = snap.data ?? [];
            if (rows.isEmpty) {
              return TabBarView(
                children: [
                  ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      Text(
                        'Não há boletos pendentes. Quando o síndico ou a administradora gerarem a cobrança, você poderá baixar o PDF, ver o QR Code e copiar o PIX.',
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                    ],
                  ),
                  ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      Text(
                        'Ainda não há boletos pagos no histórico.',
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                    ],
                  ),
                ],
              );
            }

            final pendingRows = rows
                .where((e) =>
                    ((e as Map<String, dynamic>)['status'] as String? ?? '') ==
                    'pending')
                .toList();
            final paidRows = rows
                .where((e) =>
                    ((e as Map<String, dynamic>)['status'] as String? ?? '') ==
                    'paid')
                .toList();

            Widget buildChargeCard(Map<String, dynamic> m, {required bool forPending}) {
              final title = m['campaign_title'] as String? ?? '';
              final comp = m['competence'] as String? ?? '';
              final due = '${m['due_date'] ?? ''}';
              final amount = _brl(m['amount']);
              final st = m['status'] as String? ?? '';
              final pdfRaw = m['boleto_pdf_url'] as String?;
              final boleto = m['boleto_url'] as String?;
              final pdfUrl = (pdfRaw != null && pdfRaw.isNotEmpty)
                  ? pdfRaw
                  : (boleto != null && boleto.isNotEmpty)
                      ? '$boleto.pdf'
                      : null;
              final bar = m['barcode'] as String?;
              final pix = m['pix_copia_cola'] as String?;
              final paidAt = m['paid_at'] != null ? '${m['paid_at']}' : null;

              return Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                      const SizedBox(height: 4),
                      Text('$comp · Venc. $due · $amount'),
                      const SizedBox(height: 6),
                      Text(
                        st == 'paid'
                            ? 'Pago${paidAt != null ? ' · $paidAt' : ''}'
                            : 'Aguardando pagamento',
                        style: TextStyle(
                          color: st == 'paid' ? cs.primary : cs.error,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (forPending) ...[
                        const SizedBox(height: 12),
                        Text(
                          'Apenas download e pagamento via banco/app — a geração do boleto é feita pelo síndico ou pela administradora.',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: cs.onSurfaceVariant,
                              ),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            FilledButton.icon(
                              onPressed: () => _openUrl(pdfUrl),
                              icon: const Icon(Icons.picture_as_pdf_rounded, size: 18),
                              label: const Text('Baixar PDF'),
                            ),
                            OutlinedButton.icon(
                              onPressed: pix == null || pix.isEmpty
                                  ? null
                                  : () => _showPixQrDialog(context, pix),
                              icon: const Icon(Icons.qr_code_rounded, size: 18),
                              label: const Text('QR Code PIX'),
                            ),
                            OutlinedButton.icon(
                              onPressed: () => _copy('Chave PIX (copiar e colar)', pix),
                              icon: const Icon(Icons.key_rounded, size: 18),
                              label: const Text('PIX copia e cola'),
                            ),
                            TextButton.icon(
                              onPressed: () => _copy('Linha digitável', bar),
                              icon: const Icon(Icons.tag_rounded, size: 18),
                              label: const Text('Copiar linha digitável'),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              );
            }

            Widget listOrEmpty(List<dynamic> list, String emptyHint) {
              if (list.isEmpty) {
                return ListView(
                  padding: const EdgeInsets.all(24),
                  children: [
                    Text(emptyHint, style: Theme.of(context).textTheme.bodyLarge),
                  ],
                );
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: list.length,
                itemBuilder: (context, i) {
                  return buildChargeCard(
                    list[i] as Map<String, dynamic>,
                    forPending: true,
                  );
                },
              );
            }

            return TabBarView(
              children: [
                listOrEmpty(
                  pendingRows,
                  'Não há boletos pendentes no momento.',
                ),
                paidRows.isEmpty
                    ? ListView(
                        padding: const EdgeInsets.all(24),
                        children: [
                          Text(
                            'Nenhum boleto pago registrado ainda.',
                            style: Theme.of(context).textTheme.bodyLarge,
                          ),
                        ],
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: paidRows.length,
                        itemBuilder: (context, i) {
                          return buildChargeCard(
                            paidRows[i] as Map<String, dynamic>,
                            forPending: false,
                          );
                        },
                      ),
              ],
            );
          },
        ),
      ),
    );
  }
}

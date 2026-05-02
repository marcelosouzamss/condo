import 'dart:convert';

import 'package:condo_app/admin_pages.dart';
import 'package:condo_app/billing_pages.dart';
import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/relation_center_pages.dart';
import 'package:condo_app/syndic_metric_pages.dart';
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

class AdministratorAreaPage extends StatefulWidget {
  const AdministratorAreaPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
  });

  final int condoId;
  final int userId;
  final String userRole;

  @override
  State<AdministratorAreaPage> createState() => _AdministratorAreaPageState();
}

class _AdministratorAreaPageState extends State<AdministratorAreaPage> {
  Map<String, dynamic>? _financial;
  Object? _finError;

  Uri _finUri() => CondoApi.uri('/api/administrator/financial-overview', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      });

  @override
  void initState() {
    super.initState();
    _loadFinancial();
  }

  Future<void> _loadFinancial() async {
    setState(() {
      _finError = null;
    });
    try {
      final r = await http.get(_finUri());
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        setState(() {
          _financial = null;
          _finError = _backendErr(r);
        });
        return;
      }
      final m = jsonDecode(r.body) as Map<String, dynamic>;
      setState(() {
        _financial = m;
        _finError = null;
      });
    } catch (e) {
      if (!mounted) {
        return;
      }
      setState(() {
        _financial = null;
        _finError = e;
      });
    }
  }

  Widget _metricWrap() {
    if (_finError != null && _financial == null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Nao foi possivel carregar indicadores financeiros.',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              Text('$_finError'),
              TextButton(onPressed: _loadFinancial, child: const Text('Tentar de novo')),
            ],
          ),
        ),
      );
    }

    final f = _financial;
    final inv = '${f != null ? f['invoicesIssued'] ?? 0 : '…'}';
    final delPct = '${f != null ? f['delinquencyPercent'] ?? 0 : '…'}%';
    final units = '${f != null ? f['unitsBillingActive'] ?? f['unitsTotal'] ?? 0 : '…'}';
    final open = '${f != null ? f['unpaidOpen'] ?? 0 : '…'}';

    final metrics = [
      ('Boletos emitidos', inv, Icons.receipt_long_rounded),
      ('Inadimplencia (aberto sobre emitidos)', '$delPct ($open)', Icons.trending_down_rounded),
      ('Unidades com cobranca ativa', units, Icons.apartment_rounded),
    ];

    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 700;
        final w = wide ? (constraints.maxWidth - 24) / 3 : constraints.maxWidth;
        return Wrap(
          spacing: 12,
          runSpacing: 12,
          children: metrics
              .map(
                (row) => SizedBox(
                  width: w,
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(row.$3, color: cs.primary),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  row.$2,
                                  style: theme.textTheme.titleLarge?.copyWith(
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                Text(
                                  row.$1,
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: cs.onSurfaceVariant,
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
              )
              .toList(),
        );
      },
    );
  }

  bool get _canBill => CondoUserRoles.isBillingStaff(widget.userRole);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Administracao'),
        actions: [
          IconButton(onPressed: _loadFinancial, icon: const Icon(Icons.refresh_rounded)),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: colorScheme.primary,
              borderRadius: BorderRadius.circular(24),
              boxShadow: [
                BoxShadow(
                  color: colorScheme.primary.withValues(alpha: 0.22),
                  blurRadius: 20,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Painel da administracao',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    color: colorScheme.onPrimary,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Indicadores reais vindos da API — mantenha cadastros atualizados e contratos sob controle.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onPrimary.withValues(alpha: 0.92),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              Text(
                'Controle financeiro',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
              ),
              const Spacer(),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Com base em cobracas cadastradas (nao inclui apenas rascunhos sem titulos gerados)',
            style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          _metricWrap(),
          if (_canBill) ...[
            const SizedBox(height: 20),
            Text(
              'Cobranca e boletos',
              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            _ActionStubCard(
              title: 'Boleto online',
              subtitle: 'Competencias e geracao de titulos.',
              icon: Icons.receipt_long_rounded,
              actionLabel: 'Abrir',
              onTap: () {
                Navigator.of(context).push<void>(
                  MaterialPageRoute<void>(
                    builder: (context) => OnlineBillingHubPage(
                      condoId: widget.condoId,
                      userId: widget.userId,
                      userRole: widget.userRole,
                      unitId: null,
                    ),
                  ),
                );
              },
            ),
          ],
          const SizedBox(height: 20),
          Text(
            'Cadastros',
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          _ActionStubCard(
            title: 'Cadastro de unidades',
            subtitle: 'Blocos, torres e numeros.',
            icon: Icons.domain_add_rounded,
            actionLabel: 'Gerenciar',
            onTap: () {
              Navigator.of(context).push<void>(
                MaterialPageRoute<void>(
                  builder: (context) => AdministratorUnitsPage(condoId: widget.condoId),
                ),
              );
            },
          ),
          const SizedBox(height: 12),
          _ActionStubCard(
            title: 'Cadastro de moradores',
            subtitle: 'Moradores por unidade.',
            icon: Icons.group_add_rounded,
            actionLabel: 'Gerenciar',
            onTap: () {
              Navigator.of(context).push<void>(
                MaterialPageRoute<void>(
                  builder: (context) => AdministratorResidentsPage(condoId: widget.condoId),
                ),
              );
            },
          ),
          if (_canBill) ...[
            const SizedBox(height: 12),
            _ActionStubCard(
              title: 'Cadastro de usuarios do app',
              subtitle: 'Logins do aplicativo por perfil (sindico, morador etc.).',
              icon: Icons.manage_accounts_rounded,
              actionLabel: 'Gerenciar',
              onTap: () {
                Navigator.of(context).push<void>(
                  MaterialPageRoute<void>(
                    builder: (context) => AdministratorAppUsersPage(
                      condoId: widget.condoId,
                      userId: widget.userId,
                    ),
                  ),
                );
              },
            ),
          ],
          const SizedBox(height: 16),
          Text(
            'Central de relacionamento',
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          _ActionStubCard(
            title: 'Chats · Administracao',
            subtitle: 'Atendimento aos moradores.',
            icon: Icons.support_agent_rounded,
            actionLabel: 'Abrir',
            onTap: () {
              Navigator.of(context).push<void>(
                MaterialPageRoute<void>(
                  builder: (context) => StaffRelationInboxPage(
                    condoId: widget.condoId,
                    channel: RelationChannels.administration,
                  ),
                ),
              );
            },
          ),
          if (_canBill) ...[
            const SizedBox(height: 16),
            Text(
              'Mural',
              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            _ActionStubCard(
              title: 'Novo aviso',
              subtitle: 'Publicar no mural.',
              icon: Icons.post_add_rounded,
              actionLabel: 'Publicar',
              onTap: () {
                Navigator.of(context).push<void>(
                  MaterialPageRoute<void>(
                    builder: (context) => SyndicNoticeEditorPage(
                      condoId: widget.condoId,
                      userId: widget.userId,
                    ),
                  ),
                );
              },
            ),
            const SizedBox(height: 12),
            _ActionStubCard(
              title: 'Gerir mural de avisos',
              subtitle: 'Editar, fixar ou arquivar.',
              icon: Icons.edit_notifications_rounded,
              actionLabel: 'Abrir',
              onTap: () {
                Navigator.of(context).push<void>(
                  MaterialPageRoute<void>(
                    builder: (context) => SyndicNoticesManagePage(
                      condoId: widget.condoId,
                      userId: widget.userId,
                    ),
                  ),
                );
              },
            ),
          ],
          const SizedBox(height: 16),
          Text(
            'Relatorios gerenciais',
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          _ActionStubCard(
            title: 'Relatorios gerenciais',
            subtitle: 'Resumo financeiro, ocupacao e operacao.',
            icon: Icons.assessment_rounded,
            actionLabel: 'Visualizar',
            onTap: () {
              Navigator.of(context).push<void>(
                MaterialPageRoute<void>(
                  builder: (context) => AdministratorManagementReportsPage(
                    condoId: widget.condoId,
                    userId: widget.userId,
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: 12),
          _ActionStubCard(
            title: 'Resumo de inadimplencia',
            subtitle: 'Unidades em aberto (ate 50 registros ordenados por valor).',
            icon: Icons.bar_chart_rounded,
            actionLabel: 'Visualizar',
            onTap: () {
              Navigator.of(context).push<void>(
                MaterialPageRoute<void>(
                  builder: (context) => AdministratorManagementReportsPage(
                    condoId: widget.condoId,
                    userId: widget.userId,
                    initialSection: ReportsSection.delinquency,
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: 16),
          Text(
            'Gestao de contratos e documentos',
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          _ActionStubCard(
            title: 'Gestao de contratos',
            subtitle: 'Fornecedores, vigencias e observacoes.',
            icon: Icons.description_rounded,
            actionLabel: 'Abrir',
            onTap: () {
              Navigator.of(context).push<void>(
                MaterialPageRoute<void>(
                  builder: (context) => AdministratorContractsPage(
                    condoId: widget.condoId,
                    userId: widget.userId,
                    userRole: widget.userRole,
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: 12),
          _ActionStubCard(
            title: 'Gestao de documentos administrativos',
            subtitle: 'Atas, termos e anexos cadastrais.',
            icon: Icons.folder_copy_rounded,
            actionLabel: 'Abrir',
            onTap: () {
              Navigator.of(context).push<void>(
                MaterialPageRoute<void>(
                  builder: (context) => AdministratorRegistryDocumentsPage(
                    condoId: widget.condoId,
                    userId: widget.userId,
                    userRole: widget.userRole,
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _ActionStubCard extends StatelessWidget {
  const _ActionStubCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.actionLabel,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final String actionLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Card(
      child: ListTile(
        leading: Icon(icon, color: cs.primary),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text(subtitle),
        trailing: FilledButton.tonal(
          onPressed: onTap,
          child: Text(actionLabel),
        ),
      ),
    );
  }
}

enum ReportsSection { overview, delinquency }

class AdministratorManagementReportsPage extends StatefulWidget {
  const AdministratorManagementReportsPage({
    super.key,
    required this.condoId,
    required this.userId,
    this.initialSection = ReportsSection.overview,
  });

  final int condoId;
  final int userId;
  final ReportsSection initialSection;

  @override
  State<AdministratorManagementReportsPage> createState() =>
      _AdministratorManagementReportsPageState();
}

class _AdministratorManagementReportsPageState extends State<AdministratorManagementReportsPage> {
  late Future<http.Response> _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<http.Response> _fetch() {
    return http.get(
      CondoApi.uri('/api/administrator/reports/summary', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Relatorios gerenciais'),
        actions: [
          IconButton(
            onPressed: () => setState(() => _future = _fetch()),
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: FutureBuilder<http.Response>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final r = snap.data!;
          if (r.statusCode != 200) {
            return Center(child: Text(_backendErr(r)));
          }
          final data = jsonDecode(r.body) as Map<String, dynamic>;
          final fin = data['financial'] as Map<String, dynamic>? ?? {};
          final units = data;

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (widget.initialSection == ReportsSection.overview) ...[
                _ReportCard(
                  title: 'Financeiro',
                  body: [
                    'Cobrancas emitidas: ${fin['chargesIssued']}',
                    'Em aberto: ${fin['chargesOpen']} (${fin['delinquencyPercent']}%)',
                    'Valor aproximado em aberto: R\$ ${fin['amountOpenRough']}',
                  ].join('\n'),
                ),
                _ReportCard(
                  title: 'Ocupacao',
                  body:
                      'Unidades com morador cadastrado: ${units['unitsOccupied']} de ${units['unitsTotal']}.',
                ),
                _ReportCard(
                  title: 'Operacao',
                  body:
                      'Ocorrencias abertas: ${units['occurrencesOpen']}. Manutencoes abertas: ${units['maintenanceOpen']}. '
                      'Reservas (90 dias): ${units['reservationsLast90Days']}.',
                ),
              ] else ...[
                Text(
                  'Inadimplencia por unidade',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 8),
                if ((data['delinquencyByUnit'] as List<dynamic>).isEmpty)
                  const Text('Sem titulos em aberto no momento.')
                else
                  ...[
                    for (final row in data['delinquencyByUnit'] as List<dynamic>)
                      Builder(
                        builder: (_) {
                          final m = row as Map<String, dynamic>;
                          final due = m['amountDue'];
                          final n = due is num
                              ? due.toDouble()
                              : double.tryParse('$due') ?? 0;
                          return Card(
                            child: ListTile(
                              title: Text('Torre ${m['tower']} · ${m['number']}'),
                              subtitle: Text(
                                'Pend.: ${m['pendingCount']} • Venc.: ${m['overdueCount']} '
                                '• Valor devido: ${n.toStringAsFixed(2)}',
                              ),
                            ),
                          );
                        },
                      ),
                  ],
              ],
            ],
          );
        },
      ),
    );
  }
}

class _ReportCard extends StatelessWidget {
  const _ReportCard({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Text(body, style: Theme.of(context).textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}

class AdministratorContractsPage extends StatefulWidget {
  const AdministratorContractsPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
  });

  final int condoId;
  final int userId;
  final String userRole;

  @override
  State<AdministratorContractsPage> createState() => _AdministratorContractsPageState();
}

class _AdministratorContractsPageState extends State<AdministratorContractsPage> {
  Future<List<Map<String, dynamic>>> _future = Future.value([]);
  int _tick = 0;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/administrator/contracts', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      }),
    );
    if (r.statusCode != 200) {
      throw Exception(_backendErr(r));
    }
    final list = jsonDecode(r.body) as List<dynamic>;
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  bool get _canWrite => CondoUserRoles.isBillingStaff(widget.userRole);

  Future<void> _openEditor([Map<String, dynamic>? existing]) async {
    final titleCtrl = TextEditingController(text: '${existing?['title'] ?? ''}');
    final partyCtrl = TextEditingController(text: '${existing?['counterparty_name'] ?? ''}');
    final notesCtrl = TextEditingController(text: '${existing?['notes'] ?? ''}');
    final urlCtrl = TextEditingController(text: '${existing?['attachment_url'] ?? ''}');
    var status = '${existing?['status'] ?? 'active'}';

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx2, setD) => AlertDialog(
          title: Text(existing == null ? 'Novo contrato' : 'Editar contrato'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: titleCtrl, decoration: const InputDecoration(labelText: 'Titulo')),
                TextField(
                  controller: partyCtrl,
                  decoration: const InputDecoration(labelText: 'Contraparte'),
                ),
                DropdownButtonFormField<String>(
                  value: status,
                  decoration: const InputDecoration(labelText: 'Status'),
                  items: const [
                    DropdownMenuItem(value: 'active', child: Text('Ativo')),
                    DropdownMenuItem(value: 'expiring', child: Text('Em renovacao')),
                    DropdownMenuItem(value: 'archived', child: Text('Arquivado')),
                  ],
                  onChanged: (v) => setD(() => status = v ?? 'active'),
                ),
                TextField(
                  controller: notesCtrl,
                  maxLines: 2,
                  decoration: const InputDecoration(labelText: 'Observacoes'),
                ),
                TextField(
                  controller: urlCtrl,
                  decoration: const InputDecoration(labelText: 'URL do anexo (opcional)'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Salvar')),
          ],
        ),
      ),
    );

    final title = titleCtrl.text.trim();
    final party = partyCtrl.text.trim();
    titleCtrl.dispose();
    partyCtrl.dispose();
    final notesTxt = notesCtrl.text.trim();
    final urlTxt = urlCtrl.text.trim();
    notesCtrl.dispose();
    urlCtrl.dispose();

    if (ok != true || !mounted || title.isEmpty || party.isEmpty) {
      return;
    }

    final body = <String, dynamic>{
      'condoId': widget.condoId,
      'userId': widget.userId,
      'title': title,
      'counterpartyName': party,
      'status': status,
      'notes': notesTxt.isEmpty ? null : notesTxt,
      'attachmentUrl': urlTxt.isEmpty ? null : urlTxt,
    };

    late http.Response res;
    if (existing == null) {
      res = await http.post(
        CondoApi.uri('/api/administrator/contracts'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
    } else {
      res = await http.patch(
        CondoApi.uri('/api/administrator/contracts/${existing['id']}'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
    }

    if (!mounted) {
      return;
    }
    if (res.statusCode >= 400) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_backendErr(res))));
    } else {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Contrato gravado.')));
      _reloadContracts();
    }
  }

  void _reloadContracts() {
    setState(() {
      _tick++;
      _future = _load();
    });
  }

  Future<void> _delete(int id) async {
    final r = await http.delete(
      CondoApi.uri('/api/administrator/contracts/$id', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode >= 400) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_backendErr(r))));
    } else {
      _reloadContracts();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Contratos')),
      floatingActionButton: _canWrite
          ? FloatingActionButton(
              onPressed: () => _openEditor(null),
              child: const Icon(Icons.add),
            )
          : null,
      body: FutureBuilder<List<Map<String, dynamic>>>(
        key: ValueKey(_tick),
        future: _future,
        builder: (context, snap) {
          if (snap.hasError) {
            return Center(child: Text('${snap.error}'));
          }
          if (!snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final rows = snap.data!;
          if (rows.isEmpty) {
            return const Center(child: Text('Nenhum contrato cadastrado.'));
          }
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: rows.length,
            itemBuilder: (context, i) {
              final row = rows[i];
              return Card(
                child: ListTile(
                  title: Text('${row['title']}'),
                  subtitle: Text(
                    '${row['counterparty_name']} • ${row['status']}'
                    '${row['ends_at'] != null ? '\nFim vigencia: ${row['ends_at']}' : ''}',
                  ),
                  isThreeLine: true,
                  trailing: _canWrite
                      ? PopupMenuButton<String>(
                          onSelected: (v) async {
                            if (v == 'edit') {
                              await _openEditor(row);
                            } else if (v == 'del') {
                              await _delete((row['id'] as num).toInt());
                            }
                          },
                          itemBuilder: (ctx) => const [
                            PopupMenuItem(value: 'edit', child: Text('Editar')),
                            PopupMenuItem(value: 'del', child: Text('Excluir')),
                          ],
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

class AdministratorRegistryDocumentsPage extends StatefulWidget {
  const AdministratorRegistryDocumentsPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
  });

  final int condoId;
  final int userId;
  final String userRole;

  @override
  State<AdministratorRegistryDocumentsPage> createState() => _AdministratorRegistryDocumentsPageState();
}

class _AdministratorRegistryDocumentsPageState extends State<AdministratorRegistryDocumentsPage> {
  Future<List<Map<String, dynamic>>> _future = Future.value([]);
  int _tick = 0;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/administrator/registry-documents', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      }),
    );
    if (r.statusCode != 200) {
      throw Exception(_backendErr(r));
    }
    final list = jsonDecode(r.body) as List<dynamic>;
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  bool get _canWrite => CondoUserRoles.isBillingStaff(widget.userRole);

  Future<void> _openEditor([Map<String, dynamic>? existing]) async {
    final titleCtrl = TextEditingController(text: '${existing?['title'] ?? ''}');
    final catCtrl = TextEditingController(text: '${existing?['category'] ?? 'ata'}');
    final notesCtrl = TextEditingController(text: '${existing?['notes'] ?? ''}');
    final urlCtrl = TextEditingController(text: '${existing?['attachment_url'] ?? ''}');

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(existing == null ? 'Novo documento' : 'Editar'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: titleCtrl, decoration: const InputDecoration(labelText: 'Titulo')),
              TextField(
                controller: catCtrl,
                decoration: const InputDecoration(labelText: 'Categoria (ex.: ata, comprovante)'),
              ),
              TextField(
                controller: notesCtrl,
                maxLines: 2,
                decoration: const InputDecoration(labelText: 'Observacoes'),
              ),
              TextField(
                controller: urlCtrl,
                decoration: const InputDecoration(labelText: 'URL do arquivo (opcional)'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Salvar')),
        ],
      ),
    );

    final title = titleCtrl.text.trim();
    final cat = catCtrl.text.trim();
    titleCtrl.dispose();
    catCtrl.dispose();
    final n = notesCtrl.text.trim();
    final u = urlCtrl.text.trim();
    notesCtrl.dispose();
    urlCtrl.dispose();

    if (ok != true || !mounted || title.isEmpty) {
      return;
    }

    final body = <String, dynamic>{
      'condoId': widget.condoId,
      'userId': widget.userId,
      'title': title,
      'category': cat.isEmpty ? 'other' : cat,
      'notes': n.isEmpty ? null : n,
      'attachmentUrl': u.isEmpty ? null : u,
    };

    late http.Response res;
    if (existing == null) {
      res = await http.post(
        CondoApi.uri('/api/administrator/registry-documents'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
    } else {
      res = await http.patch(
        CondoApi.uri('/api/administrator/registry-documents/${existing['id']}'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
    }

    if (!mounted) {
      return;
    }
    if (res.statusCode >= 400) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_backendErr(res))));
    } else {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Documento gravado.')));
      _reloadDocs();
    }
  }

  void _reloadDocs() {
    setState(() {
      _tick++;
      _future = _load();
    });
  }

  Future<void> _delete(int id) async {
    final r = await http.delete(
      CondoApi.uri('/api/administrator/registry-documents/$id', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode >= 400) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_backendErr(r))));
    } else {
      _reloadDocs();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Documentos administrativos')),
      floatingActionButton: _canWrite
          ? FloatingActionButton(
              onPressed: () => _openEditor(null),
              child: const Icon(Icons.add),
            )
          : null,
      body: FutureBuilder<List<Map<String, dynamic>>>(
        key: ValueKey(_tick),
        future: _future,
        builder: (context, snap) {
          if (snap.hasError) {
            return Center(child: Text('${snap.error}'));
          }
          if (!snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final rows = snap.data!;
          if (rows.isEmpty) {
            return const Center(child: Text('Nenhum documento cadastrado.'));
          }
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: rows.length,
            itemBuilder: (context, i) {
              final row = rows[i];
              return Card(
                child: ListTile(
                  title: Text('${row['title']}'),
                  subtitle: Text('${row['category']} • ${row['document_date'] ?? '-'}'),
                  trailing: _canWrite
                      ? PopupMenuButton<String>(
                          onSelected: (v) async {
                            if (v == 'edit') {
                              await _openEditor(row);
                            } else if (v == 'del') {
                              await _delete((row['id'] as num).toInt());
                            }
                          },
                          itemBuilder: (ctx) => const [
                            PopupMenuItem(value: 'edit', child: Text('Editar')),
                            PopupMenuItem(value: 'del', child: Text('Excluir')),
                          ],
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

class AdministratorAppUsersPage extends StatefulWidget {
  const AdministratorAppUsersPage({
    super.key,
    required this.condoId,
    required this.userId,
  });

  final int condoId;
  final int userId;

  @override
  State<AdministratorAppUsersPage> createState() => _AdministratorAppUsersPageState();
}

class _AdministratorAppUsersPageState extends State<AdministratorAppUsersPage>
    with SingleTickerProviderStateMixin {
  late TabController _tabs;
  List<Map<String, dynamic>> _units = [];
  final _loginCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  String _role = 'resident';
  int? _unitIdPick;
  int _listVersion = 0;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _loadUnits();
  }

  @override
  void dispose() {
    _tabs.dispose();
    _loginCtrl.dispose();
    _passCtrl.dispose();
    _nameCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadUnits() async {
    try {
      final r = await http.get(
        CondoApi.uri('/api/administrator/units', {'condoId': '${widget.condoId}'}),
      );
      if (r.statusCode == 200) {
        final list = jsonDecode(r.body) as List<dynamic>;
        if (mounted) {
          setState(() {
            _units = list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
          });
        }
      }
    } catch (_) {}
  }

  Future<List<Map<String, dynamic>>> _loadUsers() async {
    final r = await http.get(
      CondoApi.uri('/api/administrator/app-users', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      }),
    );
    if (r.statusCode != 200) {
      throw Exception(_backendErr(r));
    }
    final list = jsonDecode(r.body) as List<dynamic>;
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Future<void> _patchUser(int id, Map<String, dynamic> body) async {
    final r = await http.patch(
      CondoApi.uri('/api/administrator/app-users/$id'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'userId': widget.userId,
        ...body,
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode >= 400) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_backendErr(r))));
    } else {
      setState(() => _listVersion++);
    }
  }

  Future<void> _createUser() async {
    final login = _loginCtrl.text.trim().toLowerCase();
    final pass = _passCtrl.text.trim();
    final name = _nameCtrl.text.trim();
    if (login.isEmpty || pass.isEmpty || name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Preencha nome, login e senha.')),
      );
      return;
    }
    final r = await http.post(
      CondoApi.uri('/api/administrator/app-users'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'userId': widget.userId,
        'fullName': name,
        'login': login,
        'password': pass,
        'role': _role,
        if (_unitIdPick != null) 'unitId': _unitIdPick,
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode >= 400) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_backendErr(r))));
    } else {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Usuario criado.')));
      _loginCtrl.clear();
      _passCtrl.clear();
      _nameCtrl.clear();
      setState(() {
        _listVersion++;
        _tabs.animateTo(0);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Usuarios do app'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(46),
          child: TabBar(
            controller: _tabs,
            isScrollable: false,
            tabAlignment: TabAlignment.fill,
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white.withValues(alpha: 0.88),
            labelStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
            unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
            indicatorColor: Colors.white,
            indicatorWeight: 3,
            indicatorSize: TabBarIndicatorSize.tab,
            dividerHeight: 0,
            dividerColor: Colors.white24,
            tabs: const [
              Tab(text: 'Lista'),
              Tab(text: 'Novo usuario'),
            ],
          ),
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: [
          FutureBuilder<List<Map<String, dynamic>>>(
            key: ValueKey(_listVersion),
            future: _loadUsers(),
            builder: (context, snap) {
              if (snap.hasError) {
                return Center(child: Text('${snap.error}'));
              }
              if (!snap.hasData) {
                return const Center(child: CircularProgressIndicator());
              }
              final rows = snap.data!;
              return ListView.builder(
                padding: const EdgeInsets.all(12),
                itemCount: rows.length,
                itemBuilder: (context, i) {
                  final u = rows[i];
                  final active = u['active'] == true;
                  final id = (u['id'] as num).toInt();
                  return Card(
                    child: ListTile(
                      title: Text('${u['full_name']}'),
                      subtitle: Text(
                        '${u['login']} • ${CondoUserRoles.labelPt('${u['role']}')}',
                      ),
                      trailing: Switch(
                        value: active,
                        onChanged: id == widget.userId
                            ? null
                            : (v) => _patchUser(id, {'active': v}),
                      ),
                    ),
                  );
                },
              );
            },
          ),
          SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _nameCtrl,
                  decoration: const InputDecoration(labelText: 'Nome completo', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _loginCtrl,
                  decoration: const InputDecoration(labelText: 'Login', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _passCtrl,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Senha', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: _role,
                  decoration: const InputDecoration(labelText: 'Perfil'),
                  items: const [
                    DropdownMenuItem(value: 'syndic', child: Text('Sindico')),
                    DropdownMenuItem(value: 'administrator', child: Text('Administracao')),
                    DropdownMenuItem(value: 'resident', child: Text('Morador')),
                    DropdownMenuItem(value: 'partner', child: Text('Parceiros')),
                    DropdownMenuItem(value: 'collaborator', child: Text('Colaboradores')),
                  ],
                  onChanged: (v) => setState(() => _role = v ?? 'resident'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<int?>(
                  value: _unitIdPick,
                  decoration: const InputDecoration(labelText: 'Unidade (opcional)', border: OutlineInputBorder()),
                  items: [
                    const DropdownMenuItem<int?>(value: null, child: Text('Sem unidade')),
                    ..._units.map(
                      (un) => DropdownMenuItem<int?>(
                        value: (un['id'] as num).toInt(),
                        child: Text('${un['tower']} · ${un['number']}'),
                      ),
                    ),
                  ],
                  onChanged: (v) => setState(() => _unitIdPick = v),
                ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: _createUser,
                  icon: const Icon(Icons.person_add_alt_1),
                  label: const Text('Cadastrar'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

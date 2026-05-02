import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';

String _brl(dynamic n) {
  final v =
      n is num ? n.toDouble() : double.tryParse('${n ?? 0}'.replaceAll(',', '.')) ?? 0;
  return 'R\$ ${v.toStringAsFixed(2).replaceAll('.', ',')}';
}

String _occStatusPt(String? s) {
  switch (s) {
    case 'open':
      return 'Abertas';
    case 'in_progress':
      return 'Em andamento';
    case 'closed':
      return 'Encerradas';
    default:
      return s ?? '-';
  }
}

String _maintStatusPt(String? s) {
  switch (s) {
    case 'open':
      return 'Abertas';
    case 'in_progress':
      return 'Em andamento';
    case 'completed':
      return 'Concluidas';
    case 'cancelled':
      return 'Canceladas';
    default:
      return s ?? '-';
  }
}

String _entryTypePt(dynamic t) =>
    '${t ?? ''}'.toLowerCase() == 'revenue' ? 'Receita' : 'Despesa';

/// Receitas e despesas do mês lançadas em «Lançamentos financeiros» (`financial_entries`).
class SyndicFinancialReportPage extends StatefulWidget {
  const SyndicFinancialReportPage({super.key, required this.condoId});

  final int condoId;

  @override
  State<SyndicFinancialReportPage> createState() => _SyndicFinancialReportPageState();
}

class _SyndicFinancialReportPageState extends State<SyndicFinancialReportPage> {
  late String _month;
  Future<Map<String, dynamic>?>? _future;

  static Iterable<String> _lastMonths({int count = 24}) sync* {
    var d = DateTime.now();
    for (var i = 0; i < count; i++) {
      yield '${d.year}-${d.month.toString().padLeft(2, '0')}';
      d = DateTime(d.year, d.month - 1);
    }
  }

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month =
        '${now.year}-${now.month.toString().padLeft(2, '0')}';
    _future = SyndicApi.financialReport(widget.condoId, month: _month);
  }

  void _reload() {
    setState(() {
      _future = SyndicApi.financialReport(widget.condoId, month: _month);
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Financeiro'),
        actions: [
          IconButton(onPressed: _reload, icon: const Icon(Icons.refresh_rounded)),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DropdownButtonFormField<String>(
              value: _month,
              decoration: const InputDecoration(
                labelText: 'Competência (YYYY-MM)',
                border: OutlineInputBorder(),
              ),
              items: [
                for (final ym in _lastMonths())
                  DropdownMenuItem(value: ym, child: Text(ym)),
              ],
              onChanged: (v) {
                if (v == null) {
                  return;
                }
                setState(() {
                  _month = v;
                  _future = SyndicApi.financialReport(widget.condoId, month: _month);
                });
              },
            ),
            const SizedBox(height: 16),
            Expanded(
              child: FutureBuilder<Map<String, dynamic>?>(
                future: _future,
                builder: (context, snap) {
                  if (snap.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  final data = snap.data;
                  if (data == null) {
                    return ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.all(8),
                      children: [
                        Text(
                          'Não foi possível carregar o relatório. '
                          'Verifique o backend (${CondoApi.baseUrl}).',
                          style: theme.textTheme.bodyLarge?.copyWith(
                            color: theme.colorScheme.error,
                          ),
                        ),
                      ],
                    );
                  }
                  final summary = data['summary'] as Map<String, dynamic>? ?? {};
                  final byCat =
                      data['byCategory'] as List<dynamic>? ?? <dynamic>[];

                  return RefreshIndicator(
                    onRefresh: () async {
                      final f = SyndicApi.financialReport(
                        widget.condoId,
                        month: _month,
                      );
                      setState(() => _future = f);
                      await f;
                    },
                    child: ListView(
                      children: [
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Resumo do mês',
                                  style: theme.textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text('Receitas: ${_brl(summary['revenue'])}'),
                                Text('Despesas: ${_brl(summary['expense'])}'),
                                Text(
                                  'Saldo: ${_brl(summary['balance'])}',
                                  style: theme.textTheme.titleSmall?.copyWith(
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'Por categoria',
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 8),
                        if (byCat.isEmpty)
                          const Padding(
                            padding: EdgeInsets.all(24),
                            child: Text('Nenhum lançamento neste período.'),
                          ),
                        for (final row in byCat)
                          Builder(
                            builder: (_) {
                              final m =
                                  Map<String, dynamic>.from(row as Map);
                              final tot = m['total'];
                              return Card(
                                child: ListTile(
                                  title:
                                      Text('${m['category'] ?? '-'}'),
                                  subtitle: Text(_entryTypePt(m['type'])),
                                  trailing: Text(_brl(tot)),
                                ),
                              );
                            },
                          ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Reservas aprovadas por espaço nos últimos 90 dias.
class SyndicAreaUsageReportPage extends StatefulWidget {
  const SyndicAreaUsageReportPage({super.key, required this.condoId});

  final int condoId;

  @override
  State<SyndicAreaUsageReportPage> createState() => _SyndicAreaUsageReportPageState();
}

class _SyndicAreaUsageReportPageState extends State<SyndicAreaUsageReportPage> {
  late Future<Map<String, dynamic>?> _future;

  @override
  void initState() {
    super.initState();
    _future = SyndicApi.areaUsageReport(widget.condoId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Uso de áreas'),
        actions: [
          IconButton(
            onPressed: () => setState(
              () => _future = SyndicApi.areaUsageReport(widget.condoId),
            ),
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: FutureBuilder<Map<String, dynamic>?>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final data = snap.data;
          if (data == null) {
            return Center(
              child: Text(
                'Falha ao carregar (${CondoApi.baseUrl}).',
                textAlign: TextAlign.center,
              ),
            );
          }
          final list = data['usageBySpace'] as List<dynamic>? ?? [];
          if (list.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child:
                    Text('Nenhuma reserva aprovada nos últimos 90 dias.'),
              ),
            );
          }
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: list.length,
            itemBuilder: (context, i) {
              final m = Map<String, dynamic>.from(list[i] as Map);
              return Card(
                child: ListTile(
                  title: Text('${m['space_name']}'),
                  subtitle: const Text(
                    'Reservas aprovadas (últimos 90 dias)',
                  ),
                  trailing: Chip(
                    label: Text('${m['reservation_count']}'),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

/// Ocorrências e manutenções agregadas por status.
class SyndicOperationsReportPage extends StatefulWidget {
  const SyndicOperationsReportPage({super.key, required this.condoId});

  final int condoId;

  @override
  State<SyndicOperationsReportPage> createState() => _SyndicOperationsReportPageState();
}

class _SyndicOperationsReportPageState extends State<SyndicOperationsReportPage> {
  late Future<Map<String, dynamic>?> _future;

  @override
  void initState() {
    super.initState();
    _future = SyndicApi.operationsReport(widget.condoId);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Ocorrências e manutenção'),
        actions: [
          IconButton(
            onPressed: () => setState(
              () => _future = SyndicApi.operationsReport(widget.condoId),
            ),
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: FutureBuilder<Map<String, dynamic>?>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final data = snap.data;
          if (data == null) {
            return Center(child: Text('Falha ao carregar (${CondoApi.baseUrl}).'));
          }
          final occ = data['occurrencesByStatus'] as List<dynamic>? ?? [];
          final maint = data['maintenanceByStatus'] as List<dynamic>? ?? [];
          final avgH =
              '${data['avgHoursToResolveOccurrences'] ?? 0}';

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Tempo médio de encerramento (ocorrências)',
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text('$avgH horas (apenas já encerradas com data).'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Ocorrências por status',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              if (occ.isEmpty)
                const Text('Sem dados.'),
              ...occ.map((raw) {
                final m = Map<String, dynamic>.from(raw as Map);
                return Card(
                  child: ListTile(
                    title: Text(_occStatusPt('${m['status']}')),
                    trailing: Chip(label: Text('${m['c']}')),
                  ),
                );
              }),
              const SizedBox(height: 16),
              Text(
                'Manutenções por status',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              if (maint.isEmpty)
                const Text('Sem dados.'),
              ...maint.map((raw) {
                final m = Map<String, dynamic>.from(raw as Map);
                return Card(
                  child: ListTile(
                    title: Text(_maintStatusPt('${m['status']}')),
                    trailing: Chip(label: Text('${m['c']}')),
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

import 'dart:convert';

import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

String _moneyFieldText(dynamic raw) {
  if (raw == null) return '';
  double? n;
  if (raw is num) {
    n = raw.toDouble();
  } else {
    n = double.tryParse(raw.toString().replaceAll(',', '.'));
  }
  if (n == null) return '';
  if ((n - n.round()).abs() < 1e-9) return '${n.round()}';
  return n.toStringAsFixed(2).replaceAll('.', ',');
}

double _parseMoneyInput(String text) {
  final t = text.trim();
  if (t.isEmpty) return 0;
  final comma = t.lastIndexOf(',');
  final dot = t.lastIndexOf('.');
  String normalized;
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
        ? t.replaceAll('.', '').replaceAll(',', '.')
        : t.replaceAll(',', '');
  } else if (comma >= 0) {
    normalized = t.replaceAll(',', '.');
  } else {
    normalized = t;
  }
  return double.tryParse(normalized) ?? 0;
}

String _brlFromNum(double n) =>
    'R\$ ${n.toStringAsFixed(2).replaceAll('.', ',')}';

double _moneyFromBackend(dynamic raw) {
  if (raw == null) return 0;
  if (raw is num) return raw.toDouble();
  return double.tryParse('$raw'.replaceAll(',', '.')) ?? 0;
}

/// Telas da área **Administradora**: unidades (manual / automático) e moradores.
class AdministratorUnitsPage extends StatefulWidget {
  const AdministratorUnitsPage({super.key, this.condoId = 1});

  final int condoId;

  @override
  State<AdministratorUnitsPage> createState() => _AdministratorUnitsPageState();
}

class _AdministratorUnitsPageState extends State<AdministratorUnitsPage>
    with SingleTickerProviderStateMixin {
  late TabController _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Cadastro de unidades'),
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
              Tab(text: 'Manual'),
              Tab(text: 'Automático'),
            ],
          ),
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: [
          _UnitsManualTab(condoId: widget.condoId),
          _UnitsAutoTab(condoId: widget.condoId),
        ],
      ),
    );
  }
}

class _UnitsManualTab extends StatefulWidget {
  const _UnitsManualTab({required this.condoId});

  final int condoId;

  @override
  State<_UnitsManualTab> createState() => _UnitsManualTabState();
}

class _UnitsManualTabState extends State<_UnitsManualTab> {
  late Future<List<dynamic>> _future;
  final _towerCtrl = TextEditingController();
  final _numberCtrl = TextEditingController();
  final _residentCtrl = TextEditingController();
  final _monthlyFeeCtrl = TextEditingController(text: '0');
  final _reserveFeeCtrl = TextEditingController(text: '0');
  bool _billingActiveNew = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _towerCtrl.dispose();
    _numberCtrl.dispose();
    _residentCtrl.dispose();
    _monthlyFeeCtrl.dispose();
    _reserveFeeCtrl.dispose();
    super.dispose();
  }

  Future<List<dynamic>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/administrator/units', {'condoId': '${widget.condoId}'}),
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

  Future<void> _addUnit() async {
    final tower = _towerCtrl.text.trim();
    final number = _numberCtrl.text.trim();
    if (tower.isEmpty || number.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe bloco e apartamento.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      final r = await http.post(
        CondoApi.uri('/api/administrator/units'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'tower': tower,
          'number': number,
          'monthlyFee': _parseMoneyInput(_monthlyFeeCtrl.text),
          'reserveFundFee': _parseMoneyInput(_reserveFeeCtrl.text),
          'billingActive': _billingActiveNew,
          if (_residentCtrl.text.trim().isNotEmpty)
            'residentName': _residentCtrl.text.trim(),
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode == 201) {
        _towerCtrl.clear();
        _numberCtrl.clear();
        _residentCtrl.clear();
        _monthlyFeeCtrl.text = '0';
        _reserveFeeCtrl.text = '0';
        setState(() => _billingActiveNew = true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Unidade cadastrada.')),
        );
        await _refresh();
      } else if (r.statusCode == 409) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Já existe unidade com este bloco e número.'),
          ),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro (${r.statusCode}).')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  Future<void> _editUnitFinance(Map<String, dynamic> u) async {
    final id = (u['id'] as num).toInt();
    final monthlyCtrl =
        TextEditingController(text: _moneyFieldText(u['monthly_fee']));
    final reserveCtrl =
        TextEditingController(text: _moneyFieldText(u['reserve_fund_fee']));
    var billingActive = u['billing_active'] == true;

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setSt) {
          return AlertDialog(
            title: const Text('Taxa condominial e fundo de reserva'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Bloco ${u['tower']} · Apt. ${u['number']}',
                    style: Theme.of(ctx).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: monthlyCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Taxa condominial (R\$)',
                      hintText: 'Ex.: 450 ou 450,50',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: reserveCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Fundo de reserva (R\$)',
                      hintText: 'Ex.: 50',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                  ),
                  const SizedBox(height: 8),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Gerar cobrança / boleto'),
                    subtitle: const Text(
                      'Desligado: unidade ficará de fora da geração de boletos.',
                    ),
                    value: billingActive,
                    onChanged: (v) => setSt(() => billingActive = v),
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
                child: const Text('Salvar'),
              ),
            ],
          );
        },
      ),
    );

    final mf = _parseMoneyInput(monthlyCtrl.text);
    final rf = _parseMoneyInput(reserveCtrl.text);
    final ba = billingActive;
    monthlyCtrl.dispose();
    reserveCtrl.dispose();

    if (ok != true || !mounted) {
      return;
    }

    setState(() => _saving = true);
    try {
      final r = await http.patch(
        CondoApi.uri('/api/administrator/units/$id'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'monthlyFee': mf,
          'reserveFundFee': rf,
          'billingActive': ba,
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode == 200) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Valores de cobrança atualizados.')),
        );
        await _refresh();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro (${r.statusCode}).')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  Future<void> _deleteUnit(int id, String label) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir unidade?'),
        content: Text('Remover $label? Chamados e reservas vinculados podem ser afetados.'),
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
    if (ok != true || !mounted) {
      return;
    }
    final r = await http.delete(
      CondoApi.uri(
        '/api/administrator/units/$id',
        {'condoId': '${widget.condoId}'},
      ),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 204) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Unidade removida.')),
      );
      await _refresh();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro (${r.statusCode}).')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return RefreshIndicator(
      onRefresh: _refresh,
      child: FutureBuilder<List<dynamic>>(
        future: _future,
        builder: (context, snapshot) {
          final units = snapshot.data ?? const <dynamic>[];
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                'Inclusão unitária',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Informe taxa condominial e fundo de reserva — esses valores são usados para gerar os boletos. '
                'Unidades criadas na aba Automático ficam com valores em zero até você editar com o ícone de pagamento.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: cs.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _towerCtrl,
                decoration: const InputDecoration(
                  labelText: 'Bloco / torre',
                  hintText: 'Ex.: A',
                  border: OutlineInputBorder(),
                ),
                textCapitalization: TextCapitalization.characters,
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _numberCtrl,
                decoration: const InputDecoration(
                  labelText: 'Apartamento',
                  hintText: 'Ex.: 101',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _residentCtrl,
                decoration: const InputDecoration(
                  labelText: 'Nome no cadastro (opcional)',
                  hintText: 'Morador principal ou “—” se vazio',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _monthlyFeeCtrl,
                decoration: const InputDecoration(
                  labelText: 'Taxa condominial (R\$)',
                  hintText: 'Obrigatório para boletos — ex.: 450,00',
                  border: OutlineInputBorder(),
                ),
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _reserveFeeCtrl,
                decoration: const InputDecoration(
                  labelText: 'Fundo de reserva (R\$)',
                  border: OutlineInputBorder(),
                  hintText: 'Ex.: 50,00 ou 0',
                ),
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Incluir em boletos'),
                subtitle: const Text(
                  'Se desligado, esta unidade não entra na emissão automática de cobrança.',
                ),
                value: _billingActiveNew,
                onChanged: (v) =>
                    setState(() => _billingActiveNew = v),
              ),
              const SizedBox(height: 8),
              FilledButton.icon(
                onPressed: _saving ? null : _addUnit,
                icon: _saving
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.save_rounded),
                label: Text(_saving ? 'Salvando…' : 'Salvar unidade'),
              ),
              const SizedBox(height: 28),
              Text(
                'Unidades cadastradas (${snapshot.connectionState == ConnectionState.waiting ? '…' : '${units.length}'})',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              if (snapshot.hasError)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    'Não foi possível carregar. Confira ${CondoApi.baseUrl}.',
                    style: TextStyle(color: cs.error),
                  ),
                )
              else if (snapshot.connectionState == ConnectionState.waiting)
                const Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (units.isEmpty)
                const Text('Nenhuma unidade neste condomínio.')
              else
                ...units.map((raw) {
                  final u = raw as Map<String, dynamic>;
                  final id = (u['id'] as num).toInt();
                  final tower = u['tower'] as String? ?? '';
                  final number = u['number'] as String? ?? '';
                  final rn = u['resident_name'] as String? ?? '';
                  final rc = u['residents_count'];
                  final rcN =
                      rc is num ? rc.toInt() : int.tryParse('$rc') ?? 0;
                  final mf = _moneyFromBackend(u['monthly_fee']);
                  final rf = _moneyFromBackend(u['reserve_fund_fee']);
                  final billOn = u['billing_active'] == true;
                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      title: Text('Bl. $tower · $number'),
                      subtitle: Text(
                        '${_brlFromNum(mf)} taxa · ${_brlFromNum(rf)} fundo · '
                        '${billOn ? 'Boletos ligados' : 'Boletos desligados'}\n'
                        '$rn · $rcN morador(es) detalhado(s)',
                        maxLines: 3,
                      ),
                      isThreeLine: true,
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            tooltip: 'Taxa condominial e fundo',
                            icon: Icon(
                              Icons.payments_rounded,
                              color: cs.primary,
                            ),
                            onPressed: _saving
                                ? null
                                : () => _editUnitFinance(u),
                          ),
                          IconButton(
                            icon: const Icon(Icons.delete_outline_rounded),
                            tooltip: 'Excluir',
                            onPressed: () =>
                                _deleteUnit(id, 'Bl. $tower · $number'),
                          ),
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

class _UnitsAutoTab extends StatefulWidget {
  const _UnitsAutoTab({required this.condoId});

  final int condoId;

  @override
  State<_UnitsAutoTab> createState() => _UnitsAutoTabState();
}

class _UnitsAutoTabState extends State<_UnitsAutoTab> {
  final _blocksCtrl = TextEditingController(text: '2');
  final _floorsCtrl = TextEditingController(text: '10');
  final _perFloorCtrl = TextEditingController(text: '4');
  bool _busy = false;

  @override
  void dispose() {
    _blocksCtrl.dispose();
    _floorsCtrl.dispose();
    _perFloorCtrl.dispose();
    super.dispose();
  }

  Future<void> _generate() async {
    final bc = int.tryParse(_blocksCtrl.text.trim());
    final fp = int.tryParse(_floorsCtrl.text.trim());
    final up = int.tryParse(_perFloorCtrl.text.trim());
    if (bc == null || fp == null || up == null || bc < 1 || fp < 1 || up < 1) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe números inteiros válidos.')),
      );
      return;
    }
    if (bc * fp * up > 5000) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Máximo 5000 unidades por geração.'),
        ),
      );
      return;
    }

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Gerar unidades'),
        content: Text(
          'Serão criadas até ${bc * fp * up} unidades '
          '($bc bloco(s), $fp andar(es), $up por andar). '
          'Registros já existentes (mesmo bloco/número) serão ignorados.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Gerar'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) {
      return;
    }

    setState(() => _busy = true);
    try {
      final r = await http.post(
        CondoApi.uri('/api/administrator/units/generate'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'blockCount': bc,
          'floorsPerBlock': fp,
          'unitsPerFloor': up,
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode == 201) {
        final map = jsonDecode(r.body) as Map<String, dynamic>;
        final created = map['created'];
        final skipped = map['skipped'];
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Criadas: $created · Ignoradas (já existentes): $skipped',
            ),
          ),
        );
      } else {
        final body = r.body;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Erro (${r.statusCode}). ${body.length > 120 ? body.substring(0, 120) : body}',
            ),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'Geração em lote',
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Blocos serão nomeados A, B, C… (após Z, Q1, Q2…). '
          'Apartamentos: andar × 100 + sequência (ex.: andar 3, 2ª unidade → 302). '
          'As unidades são criadas com taxa zero: na aba Manual, edite valores com o ícone de pagamentos ao lado da unidade.',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 20),
        TextField(
          controller: _blocksCtrl,
          decoration: const InputDecoration(
            labelText: 'Quantidade de blocos',
            border: OutlineInputBorder(),
          ),
          keyboardType: TextInputType.number,
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _floorsCtrl,
          decoration: const InputDecoration(
            labelText: 'Andares por bloco',
            border: OutlineInputBorder(),
          ),
          keyboardType: TextInputType.number,
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _perFloorCtrl,
          decoration: const InputDecoration(
            labelText: 'Unidades por andar',
            border: OutlineInputBorder(),
          ),
          keyboardType: TextInputType.number,
        ),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: _busy ? null : _generate,
          icon: _busy
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.auto_fix_high_rounded),
          label: Text(_busy ? 'Gerando…' : 'Gerar unidades'),
        ),
      ],
    );
  }
}

String _roleLabelPt(String role) {
  switch (role) {
    case 'owner':
      return 'Proprietário';
    case 'tenant':
      return 'Locatário';
    case 'resident':
      return 'Morador';
    default:
      return 'Outro';
  }
}

/// Lista de unidades para escolher e cadastrar moradores.
class AdministratorResidentsPage extends StatefulWidget {
  const AdministratorResidentsPage({super.key, this.condoId = 1});

  final int condoId;

  @override
  State<AdministratorResidentsPage> createState() =>
      _AdministratorResidentsPageState();
}

class _AdministratorResidentsPageState extends State<AdministratorResidentsPage> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<dynamic>> _load() async {
    final r = await http.get(
      CondoApi.uri('/api/administrator/units', {'condoId': '${widget.condoId}'}),
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Cadastro de moradores')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<dynamic>>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 100),
                  Center(child: CircularProgressIndicator()),
                ],
              );
            }
            if (snapshot.hasError) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: [
                  Text(
                    'Falha ao carregar. ${CondoApi.baseUrl}',
                    style: TextStyle(color: cs.error),
                  ),
                ],
              );
            }
            final units = snapshot.data ?? const <dynamic>[];
            if (units.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: const [
                  Text('Cadastre unidades primeiro na área de unidades.'),
                ],
              );
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              itemCount: units.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final u = units[index] as Map<String, dynamic>;
                final id = (u['id'] as num).toInt();
                final tower = u['tower'] as String? ?? '';
                final number = u['number'] as String? ?? '';
                final rn = u['resident_name'] as String? ?? '';
                final rc = u['residents_count'];
                final rcN = rc is num ? rc.toInt() : int.tryParse('$rc') ?? 0;
                return Material(
                  color: cs.surface,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                    side: BorderSide(color: cs.outlineVariant),
                  ),
                  child: ListTile(
                    title: Text(
                      'Bl. $tower · $number',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    subtitle: Text(
                      '$rn · $rcN pessoa(s) no cadastro detalhado',
                      maxLines: 2,
                    ),
                    trailing: Icon(Icons.chevron_right_rounded, color: cs.primary),
                    onTap: () async {
                      await Navigator.of(context).push<void>(
                        MaterialPageRoute<void>(
                          builder: (context) => AdministratorUnitResidentsDetailPage(
                            condoId: widget.condoId,
                            unitId: id,
                            tower: tower,
                            number: number,
                          ),
                        ),
                      );
                      if (context.mounted) {
                        await _refresh();
                      }
                    },
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class AdministratorUnitResidentsDetailPage extends StatefulWidget {
  const AdministratorUnitResidentsDetailPage({
    super.key,
    required this.condoId,
    required this.unitId,
    required this.tower,
    required this.number,
  });

  final int condoId;
  final int unitId;
  final String tower;
  final String number;

  @override
  State<AdministratorUnitResidentsDetailPage> createState() =>
      _AdministratorUnitResidentsDetailPageState();
}

class _AdministratorUnitResidentsDetailPageState
    extends State<AdministratorUnitResidentsDetailPage> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<dynamic>> _load() async {
    final r = await http.get(
      CondoApi.uri(
        '/api/administrator/units/${widget.unitId}/residents',
        {'condoId': '${widget.condoId}'},
      ),
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

  Future<void> _addDialog() async {
    String role = 'owner';
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    final emailCtrl = TextEditingController();

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) {
          return AlertDialog(
            title: const Text('Novo morador'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    value: role,
                    decoration: const InputDecoration(labelText: 'Papel'),
                    items: const [
                      DropdownMenuItem(
                        value: 'owner',
                        child: Text('Proprietário'),
                      ),
                      DropdownMenuItem(
                        value: 'tenant',
                        child: Text('Locatário'),
                      ),
                      DropdownMenuItem(
                        value: 'resident',
                        child: Text('Morador'),
                      ),
                      DropdownMenuItem(value: 'other', child: Text('Outro')),
                    ],
                    onChanged: (v) => setSt(() => role = v ?? 'owner'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Nome completo',
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
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: emailCtrl,
                    decoration: const InputDecoration(
                      labelText: 'E-mail',
                      border: OutlineInputBorder(),
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
                child: const Text('Salvar'),
              ),
            ],
          );
        },
      ),
    );

    final name = nameCtrl.text.trim();
    final phone = phoneCtrl.text.trim();
    final email = emailCtrl.text.trim();
    nameCtrl.dispose();
    phoneCtrl.dispose();
    emailCtrl.dispose();

    if (ok != true || !mounted) {
      return;
    }

    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe o nome.')),
      );
      return;
    }

    final r = await http.post(
      CondoApi.uri('/api/administrator/units/${widget.unitId}/residents'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'role': role,
        'fullName': name,
        if (phone.isNotEmpty) 'phone': phone,
        if (email.isNotEmpty) 'email': email,
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 201) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Morador cadastrado.')),
      );
      await _refresh();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro (${r.statusCode}).')),
      );
    }
  }

  Future<void> _deleteResident(int id, String name) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remover morador?'),
        content: Text('Excluir $name desta unidade?'),
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
    if (ok != true || !mounted) {
      return;
    }
    final r = await http.delete(
      CondoApi.uri(
        '/api/administrator/residents/$id',
        {'condoId': '${widget.condoId}'},
      ),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 204) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Registro removido.')),
      );
      await _refresh();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro (${r.statusCode}).')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final title =
        'Bl. ${widget.tower} · ${widget.number}';

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _addDialog,
        icon: const Icon(Icons.person_add_rounded),
        label: const Text('Adicionar'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<dynamic>>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 80),
                  Center(child: CircularProgressIndicator()),
                ],
              );
            }
            if (snapshot.hasError) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: [
                  Text(
                    'Erro ao carregar. ${CondoApi.baseUrl}',
                    style: TextStyle(color: cs.error),
                  ),
                ],
              );
            }
            final rows = snapshot.data ?? const <dynamic>[];
            if (rows.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: const [
                  Text(
                    'Nenhum morador detalhado. Use Adicionar para proprietário, locatário ou outros.',
                  ),
                ],
              );
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
              itemCount: rows.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final row = rows[index] as Map<String, dynamic>;
                final id = (row['id'] as num).toInt();
                final rl = row['role'] as String? ?? '';
                final fn = row['full_name'] as String? ?? '';
                final ph = row['phone'] as String? ?? '';
                final em = row['email'] as String? ?? '';
                return Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: cs.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: cs.outlineVariant),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              fn,
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.delete_outline_rounded),
                            onPressed: () => _deleteResident(id, fn),
                          ),
                        ],
                      ),
                      Text(
                        _roleLabelPt(rl),
                        style: theme.textTheme.labelLarge?.copyWith(
                          color: cs.primary,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (ph.isNotEmpty)
                        Text('Tel. $ph', style: theme.textTheme.bodySmall),
                      if (em.isNotEmpty)
                        Text(em, style: theme.textTheme.bodySmall),
                    ],
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
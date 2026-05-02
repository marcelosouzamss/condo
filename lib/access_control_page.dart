import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/resident_unit_storage.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:qr_flutter/qr_flutter.dart';

/// Controle de acesso: visitantes, validação na portaria, prestadores e histórico.
class AccessControlHubPage extends StatefulWidget {
  const AccessControlHubPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
    this.unitId,
  });

  final int condoId;
  final int userId;
  final String userRole;
  final int? unitId;

  @override
  State<AccessControlHubPage> createState() => _AccessControlHubPageState();
}

class _AccessControlHubPageState extends State<AccessControlHubPage>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  bool _bootstrapDone = false;
  bool _loading = true;
  Map<String, dynamic>? _stats;
  List<Map<String, dynamic>> _passes = [];
  List<Map<String, dynamic>> _events = [];
  List<Map<String, dynamic>> _providers = [];
  List<Map<String, dynamic>> _units = [];
  int? _effectiveResidentUnitId;
  final TextEditingController _pinCtrl = TextEditingController();
  Map<String, dynamic>? _validatedPass;
  bool _busy = false;

  bool get _staff => CondoUserRoles.isOperationalStaff(widget.userRole);

  String _accessErr(http.Response r) {
    try {
      final decoded = jsonDecode(r.body);
      if (decoded is Map && decoded['message'] != null) {
        return '${decoded['message']}';
      }
    } catch (_) {}
    return 'Falha na requisicao (${r.statusCode}). Verifique ${CondoApi.baseUrl}.';
  }

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _staff ? 3 : 2, vsync: this);
    _tabController.addListener(() {
      if (_tabController.indexIsChanging) {
        return;
      }
      setState(() {});
    });
    _start();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _pinCtrl.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    setState(() => _loading = true);
    await _maybeResolveUnit();
    await _reload();
    if (mounted) {
      setState(() {
        _loading = false;
        _bootstrapDone = true;
      });
    }
  }

  Future<void> _maybeResolveUnit() async {
    if (widget.userRole != CondoUserRoles.resident) {
      return;
    }
    if (widget.unitId != null) {
      _effectiveResidentUnitId = widget.unitId;
      return;
    }
    try {
      final saved = await readResidentSelectedUnitId(
        CondoApi.residentSelectedUnitPrefKey(widget.condoId),
      );
      final r = await http.get(
        CondoApi.uri('/api/units', {'condoId': '${widget.condoId}'}),
      );
      if (!mounted || r.statusCode != 200) {
        return;
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      int? pick(int id) {
        for (final raw in list) {
          final u = raw as Map<String, dynamic>;
          if (u['id'] == id) {
            return id;
          }
        }
        return null;
      }

      int? resolved;
      if (saved != null) {
        resolved = pick(saved);
      }
      resolved ??= () {
        for (final raw in list) {
          final u = raw as Map<String, dynamic>;
          if (u['id'] != null) {
            return (u['id'] as num).toInt();
          }
        }
        return null;
      }();

      _effectiveResidentUnitId = resolved;
    } catch (_) {}
  }

  Future<void> _reload() async {
    await Future.wait<void>([
      _pullStats(),
      _pullPasses(),
      _pullEvents(),
      if (_staff) ...[_pullProviders(), _pullUnits()],
    ]);
    if (mounted) setState(() {});
  }

  Uri _statsUri() =>
      CondoApi.uri('/api/access-control/stats', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      });

  Uri _passesUri() =>
      CondoApi.uri('/api/access-control/visitor-passes', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
        'status': 'all',
      });

  Uri _eventsUri() =>
      CondoApi.uri('/api/access-control/events', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
        'limit': '120',
      });

  Uri _providersUri() =>
      CondoApi.uri('/api/access-control/service-providers', {
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      });

  Future<void> _pullStats() async {
    try {
      final r = await http.get(_statsUri());
      if (!mounted) {
        return;
      }
      if (r.statusCode == 200) {
        setState(() => _stats = jsonDecode(r.body) as Map<String, dynamic>);
      }
    } catch (_) {}
  }

  Future<void> _pullPasses() async {
    try {
      final r = await http.get(_passesUri());
      if (!mounted) {
        return;
      }
      if (r.statusCode == 200) {
        final list = jsonDecode(r.body) as List<dynamic>;
        setState(
          () =>
              _passes = list.map((e) => Map<String, dynamic>.from(e as Map)).toList(),
        );
      }
    } catch (_) {}
  }

  Future<void> _pullEvents() async {
    try {
      final r = await http.get(_eventsUri());
      if (!mounted) {
        return;
      }
      if (r.statusCode == 200) {
        final list = jsonDecode(r.body) as List<dynamic>;
        setState(
          () =>
              _events = list.map((e) => Map<String, dynamic>.from(e as Map)).toList(),
        );
      }
    } catch (_) {}
  }

  Future<void> _pullProviders() async {
    try {
      final r = await http.get(_providersUri());
      if (!mounted) {
        return;
      }
      if (r.statusCode == 200) {
        final list = jsonDecode(r.body) as List<dynamic>;
        setState(
          () => _providers =
              list.map((e) => Map<String, dynamic>.from(e as Map)).toList(),
        );
      }
    } catch (_) {}
  }

  Future<void> _pullUnits() async {
    try {
      final r = await http.get(
        CondoApi.uri('/api/units', {'condoId': '${widget.condoId}'}),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode == 200) {
        final list = jsonDecode(r.body) as List<dynamic>;
        setState(
          () => _units = list.map((e) => Map<String, dynamic>.from(e as Map)).toList(),
        );
      }
    } catch (_) {}
  }

  static String _passName(Map<String, dynamic> p) =>
      '${p['visitor_full_name'] ?? p['visitorFullName'] ?? ''}'.trim();

  static String _unitLabel(Map<String, dynamic> p) {
    final t = '${p['tower'] ?? ''}'.trim();
    final n = '${p['number'] ?? ''}'.trim();
    if (t.isEmpty && n.isEmpty) {
      return 'Unidade';
    }
    return '$t · $n';
  }

  static String _statusPt(String? s) {
    switch (s) {
      case 'pending':
        return 'Pendente entrada';
      case 'inside':
        return 'Dentro do condominio';
      case 'completed':
        return 'Concluido';
      case 'revoked':
        return 'Revogado';
      case 'expired':
        return 'Expirado';
      default:
        return s ?? '-';
    }
  }

  static String _fmtDt(dynamic raw) {
    if (raw == null) {
      return '-';
    }
    final d = DateTime.tryParse(raw.toString());
    if (d == null) {
      return raw.toString();
    }
    final l = d.toLocal();
    return '${l.day.toString().padLeft(2, '0')}/${l.month.toString().padLeft(2, '0')}/${l.year} '
        '${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }

  Map<String, List<Map<String, dynamic>>> _groupPassesByUnit() {
    final m = <String, List<Map<String, dynamic>>>{};
    for (final p in _passes) {
      final label = _unitLabel(p);
      (m[label] ??= []).add(p);
    }
    final keys = m.keys.toList()..sort();
    return {for (final k in keys) k: m[k]!};
  }

  Future<void> _validatePin() async {
    final pin = _pinCtrl.text.trim();
    if (pin.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Informe o PIN de 6 digitos.')));
      return;
    }
    setState(() => _busy = true);
    try {
      final r = await http.post(
        CondoApi.uri('/api/access-control/validate'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'userId': widget.userId,
          'pinCode': pin,
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode != 200) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_accessErr(r))));
        return;
      }
      final decoded = jsonDecode(r.body) as Map<String, dynamic>;
      final passRaw = decoded['pass'];
      if (passRaw is Map) {
        setState(() {
          _validatedPass = Map<String, dynamic>.from(passRaw.cast<String, dynamic>());
        });
      }
      final hint = '${decoded['hint'] ?? ''}';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(hint)));
      await _reload();
    } catch (e) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Erro: $e')));
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _checkIn(int passId, {String method = 'manual'}) async {
    setState(() => _busy = true);
    try {
      final r = await http.post(
        CondoApi.uri('/api/access-control/visitor-passes/$passId/check-in'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'userId': widget.userId,
          'method': method,
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode >= 400) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_accessErr(r))));
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Entrada registrada.')),
        );
        setState(() => _validatedPass = null);
      }
      await _reload();
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _checkOut(int passId, {String method = 'manual'}) async {
    setState(() => _busy = true);
    try {
      final r = await http.post(
        CondoApi.uri('/api/access-control/visitor-passes/$passId/check-out'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'userId': widget.userId,
          'method': method,
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode >= 400) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_accessErr(r))));
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Saida registrada.')),
        );
        setState(() => _validatedPass = null);
      }
      await _reload();
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _revokePass(int passId) async {
    setState(() => _busy = true);
    try {
      final r = await http.patch(
        CondoApi.uri('/api/access-control/visitor-passes/$passId'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'userId': widget.userId,
          'status': 'revoked',
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode >= 400) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_accessErr(r))));
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Liberacao revogada.')),
        );
      }
      await _reload();
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _addServiceProvider() async {
    final nameCtrl = TextEditingController();
    final notesCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cadastrar prestador'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameCtrl,
              decoration: const InputDecoration(
                labelText: 'Nome da empresa',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: notesCtrl,
              decoration: const InputDecoration(
                labelText: 'Observacoes (opcional)',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Salvar')),
        ],
      ),
    );
    final name = nameCtrl.text.trim();
    final notesText = notesCtrl.text.trim();
    nameCtrl.dispose();
    notesCtrl.dispose();
    if (ok != true || name.isEmpty) {
      return;
    }

    final r = await http.post(
      CondoApi.uri('/api/access-control/service-providers'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'userId': widget.userId,
        'companyName': name,
        'notes': notesText.isEmpty ? null : notesText,
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode >= 400) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_accessErr(r))),
      );
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Prestador cadastrado.')),
    );
    await _reload();
  }

  Future<void> _openVisitorDialog({int? preselectedUnitId}) async {
    if (_staff && _units.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Cadastre unidades no condominio antes de liberar visitantes.'),
        ),
      );
      return;
    }
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    final docCtrl = TextEditingController();
    final notesCtrl = TextEditingController();
    var unitPick = _staff
        ? (preselectedUnitId ?? (_units.isNotEmpty ? (_units.first['id'] as num?)?.toInt() : null))
        : _effectiveResidentUnitId ?? widget.unitId;

    DateTime validFrom = DateTime.now().subtract(const Duration(minutes: 1));
    DateTime validUntil = DateTime.now().add(const Duration(days: 1));

    Future<void> pickFrom() async {
      final d = await showDatePicker(
        context: context,
        firstDate: DateTime.now().subtract(const Duration(days: 1)),
        lastDate: DateTime.now().add(const Duration(days: 365)),
        initialDate: validFrom.toLocal(),
      );
      if (d == null || !mounted) {
        return;
      }
      final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(validFrom));
      if (t == null || !mounted) {
        return;
      }
      validFrom = DateTime(d.year, d.month, d.day, t.hour, t.minute);
    }

    Future<void> pickUntil() async {
      final d = await showDatePicker(
        context: context,
        firstDate: DateTime.now(),
        lastDate: DateTime.now().add(const Duration(days: 400)),
        initialDate: validUntil.toLocal(),
      );
      if (d == null || !mounted) {
        return;
      }
      final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(validUntil));
      if (t == null || !mounted) {
        return;
      }
      validUntil = DateTime(d.year, d.month, d.day, t.hour, t.minute);
    }

    final submitted = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx2, setD) => AlertDialog(
          title: const Text('Nova liberacao para visitante'),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_staff) ...[
                  DropdownButtonFormField<int>(
                    value: unitPick,
                    decoration: const InputDecoration(labelText: 'Unidade'),
                    items: [
                      for (final u in _units)
                        DropdownMenuItem<int>(
                          value: (u['id'] as num).toInt(),
                          child: Text('${u['tower']} · ${u['number']}'),
                        ),
                    ],
                    onChanged: (v) => setD(() => unitPick = v),
                  ),
                  const SizedBox(height: 12),
                ],
                TextField(
                  controller: nameCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Nome completo',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: phoneCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Telefone (opcional)',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: docCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Documento (opcional)',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: notesCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Observacoes (opcional)',
                    border: OutlineInputBorder(),
                  ),
                  maxLines: 2,
                ),
                const SizedBox(height: 12),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('Valido desde: ${_fmtDt(validFrom.toIso8601String())}'),
                  trailing: const Icon(Icons.calendar_today),
                  onTap: () async {
                    await pickFrom();
                    setD(() {});
                  },
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('Data limite: ${_fmtDt(validUntil.toIso8601String())}'),
                  trailing: const Icon(Icons.event_busy),
                  onTap: () async {
                    await pickUntil();
                    setD(() {});
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Gerar liberacao'),
            ),
          ],
        ),
      ),
    );

    final fullName = nameCtrl.text.trim();
    final phoneTxt = phoneCtrl.text.trim();
    final docTxt = docCtrl.text.trim();
    final notesTxt = notesCtrl.text.trim();
    nameCtrl.dispose();
    phoneCtrl.dispose();
    docCtrl.dispose();
    notesCtrl.dispose();

    if (submitted != true || fullName.isEmpty) {
      return;
    }

    final uid = _staff ? unitPick : (_effectiveResidentUnitId ?? widget.unitId);
    if (uid == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Selecione a unidade no app (Minha Unidade) antes de liberar um visitante.'),
          ),
        );
      }
      return;
    }

    if (!mounted) {
      return;
    }
    if (validUntil.isBefore(validFrom) || validUntil.isAtSameMomentAs(validFrom)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('A data limite deve ser apos o inicio da validade.')),
      );
      return;
    }

    setState(() => _busy = true);
    try {
      final r = await http.post(
        CondoApi.uri('/api/access-control/visitor-passes'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'condoId': widget.condoId,
          'userId': widget.userId,
          'unitId': uid,
          'visitorFullName': fullName,
          'visitorPhone': phoneTxt.isEmpty ? null : phoneTxt,
          'documentId': docTxt.isEmpty ? null : docTxt,
          'notes': notesTxt.isEmpty ? null : notesTxt,
          'validFrom': validFrom.toUtc().toIso8601String(),
          'validUntil': validUntil.toUtc().toIso8601String(),
        }),
      );
      if (!mounted) {
        return;
      }
      if (r.statusCode >= 400) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_accessErr(r))),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Visitante autorizado — PIN e QR gerados.')),
        );
      }
      await _reload();
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Widget _statsWrap() {
    if (_stats == null) {
      return const SizedBox.shrink();
    }
    final s = _stats!;
    int g(String k) => (s[k] is num) ? (s[k] as num).toInt() : int.tryParse('${s[k]}') ?? 0;
    final items = <_KpiItem>[
      _KpiItem('Aguardados', '${g('visitorsExpected')}', Icons.schedule),
      _KpiItem('Dentro', '${g('visitorsInside')}', Icons.login),
      _KpiItem('Prestadores', '${g('providersActive')}', Icons.engineering),
      _KpiItem('Entradas hoje', '${g('entriesToday')}', Icons.timeline),
    ];

    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return LayoutBuilder(
      builder: (context, constraints) {
        final w =
            constraints.maxWidth >= 620 ? (constraints.maxWidth - 12) / 2 : constraints.maxWidth;
        return Wrap(
          spacing: 12,
          runSpacing: 12,
          children: items
              .map(
                (k) => SizedBox(
                  width: w.clamp(0, double.infinity),
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Row(
                        children: [
                          Icon(k.icon, color: cs.primary, size: 28),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  k.value,
                                  style: theme.textTheme.titleLarge?.copyWith(
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                Text(
                                  k.label,
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

  Widget _passCard(Map<String, dynamic> p) {
    final id = (p['id'] as num?)?.toInt();
    final status = '${p['status'] ?? ''}';
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final pin = '${p['pin_code'] ?? p['pinCode'] ?? ''}';
    final qr = '${p['qr_token'] ?? p['qrToken'] ?? ''}';

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
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
                        _passName(p),
                        style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      Text(_unitLabel(p), style: theme.textTheme.bodySmall),
                      Chip(
                        label: Text(_statusPt(status)),
                        visualDensity: VisualDensity.compact,
                        padding: EdgeInsets.zero,
                      ),
                      Text(
                        'Validade: ${_fmtDt(p['valid_from'] ?? p['validFrom'])} — '
                        '${_fmtDt(p['valid_until'] ?? p['validUntil'])}',
                        style: theme.textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                if (qr.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: cs.outlineVariant),
                    ),
                    child: QrImageView(data: qr, size: 72, backgroundColor: Colors.white),
                  ),
              ],
            ),
            if (pin.isNotEmpty) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Text('PIN ', style: theme.textTheme.labelLarge),
                  Text(pin, style: theme.textTheme.titleMedium?.copyWith(letterSpacing: 2)),
                  IconButton(
                    tooltip: 'Copiar PIN',
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: pin));
                      ScaffoldMessenger.of(
                        context,
                      ).showSnackBar(const SnackBar(content: Text('PIN copiado.')));
                    },
                    icon: const Icon(Icons.copy, size: 20),
                  ),
                ],
              ),
            ],
            if (_staff && id != null && (status == 'pending' || status == 'inside')) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (status == 'pending')
                    FilledButton.tonalIcon(
                      onPressed: _busy ? null : () => _checkIn(id),
                      icon: const Icon(Icons.login_rounded),
                      label: const Text('Entrada'),
                    ),
                  if (status == 'inside')
                    FilledButton.icon(
                      onPressed: _busy ? null : () => _checkOut(id),
                      icon: const Icon(Icons.logout_rounded),
                      label: const Text('Saida'),
                    ),
                  if (status != 'completed' && status != 'revoked')
                    OutlinedButton(
                      onPressed: _busy ? null : () => _revokePass(id),
                      child: const Text('Revogar'),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _eventsListView() {
    if (_events.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: const [
          Center(child: Text('Nenhum registro no historico ainda.')),
        ],
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _events.length,
      itemBuilder: (context, i) {
        final e = _events[i];
        final dir = '${e['direction']}';
        final inOut = dir == 'in' ? 'Entrada' : 'Saida';
        final unit = '${e['tower'] ?? ''} · ${e['number'] ?? ''}'.replaceAll(RegExp(r'^\s*·\s*|^·\s*|\s*·\s*$'), '');
        final name = '${e['subject_name'] ?? e['subjectName'] ?? ''}'.trim();

        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          child: ListTile(
            leading: Icon(dir == 'in' ? Icons.login : Icons.logout, color: Theme.of(context).colorScheme.primary),
            title: Text(name.isEmpty ? 'Registro sem nome' : name),
            subtitle: Text(
              '$inOut · ${_fmtDt(e['recorded_at'] ?? e['recordedAt'])}\n'
              '${unit.isEmpty || unit == '·' ? '' : '$unit · '}${e['method'] ?? ''}',
            ),
            isThreeLine: true,
          ),
        );
      },
    );
  }

  Widget _staffSummaryTab() {
    final theme = Theme.of(context);
    final pending = _passes.where((p) => '${p['status']}' == 'pending').toList();
    final inside = _passes.where((p) => '${p['status']}' == 'inside').toList();

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        _statsWrap(),
        const SizedBox(height: 20),
        Text('Validar na portaria', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _pinCtrl,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(
                  labelText: 'PIN de 6 digitos',
                  border: OutlineInputBorder(),
                  counterText: '',
                ),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton(
              onPressed: _busy ? null : _validatePin,
              child: const Text('Validar'),
            ),
          ],
        ),
        if (_validatedPass != null) ...[
          const SizedBox(height: 12),
          Card(
            color: theme.colorScheme.primaryContainer.withValues(alpha: 0.35),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _passName(_validatedPass!),
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  Text(_unitLabel(_validatedPass!)),
                  Text(_statusPt('${_validatedPass!['status']}')),
                  const SizedBox(height: 8),
                  Builder(
                    builder: (context) {
                      final id = (_validatedPass!['id'] as num?)?.toInt();
                      if (id == null) {
                        return const SizedBox.shrink();
                      }
                      final st = '${_validatedPass!['status']}';
                      return Wrap(
                        spacing: 8,
                        children: [
                          if (st == 'pending')
                            FilledButton(
                              onPressed: _busy ? null : () => _checkIn(id, method: 'pin'),
                              child: const Text('Registrar entrada'),
                            ),
                          if (st == 'inside')
                            FilledButton(
                              onPressed: _busy ? null : () => _checkOut(id, method: 'pin'),
                              child: const Text('Registrar saida'),
                            ),
                        ],
                      );
                    },
                  ),
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 20),
        Text('Fila rapida', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        if (pending.isEmpty && inside.isEmpty)
          Text('Nenhum visitante pendente ou dentro.', style: theme.textTheme.bodyMedium),
        ...pending.map(_passCard),
        ...inside.map(_passCard),
        const SizedBox(height: 20),
        Row(
          children: [
            Expanded(
              child: Text(
                'Prestadores de servico',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            FilledButton.tonal(
              onPressed: _busy ? null : _addServiceProvider,
              child: const Text('Novo'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_providers.isEmpty)
          Text('Nenhum prestador cadastrado.', style: theme.textTheme.bodyMedium)
        else
          ..._providers.map(
            (sp) => ListTile(
              leading: Icon(
                (sp['active'] == false) ? Icons.pause_circle_outline : Icons.engineering_outlined,
                color: theme.colorScheme.primary,
              ),
              title: Text('${sp['company_name'] ?? sp['companyName'] ?? '-'}'),
              subtitle: Text('${sp['notes'] ?? ''}'),
            ),
          ),
      ],
    );
  }

  Widget _byUnitTab() {
    final g = _groupPassesByUnit();
    if (g.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: const [
          SizedBox(height: 80),
          Center(child: Text('Nenhuma liberacao cadastrada.')),
        ],
      );
    }
    final theme = Theme.of(context);
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: g.length,
      itemBuilder: (context, i) {
        final unit = g.keys.elementAt(i);
        final list = g[unit]!;
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: ExpansionTile(
            title: Text(unit, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            subtitle: Text('${list.length} liberacoes'),
            childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            children: list.map(_passCard).toList(),
          ),
        );
      },
    );
  }

  Widget _residentVisitorsTab() {
    final missingUnit = widget.userRole == CondoUserRoles.resident &&
        (_effectiveResidentUnitId == null && widget.unitId == null);

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        if (missingUnit)
          Card(
            color: Theme.of(context).colorScheme.errorContainer.withValues(alpha: 0.25),
            child: const Padding(
              padding: EdgeInsets.all(12),
              child: Text(
                'Associe sua unidade em «Minha Unidade» ou selecione a unidade moradia '
                'para cadastrar visitantes e liberar acessos pela API.',
              ),
            ),
          )
        else
          _statsWrap(),
        const SizedBox(height: 12),
        if (_passes.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: Center(
              child: Text(_bootstrapDone ? 'Nenhuma liberacao cadastrada.' : 'Carregando...'),
            ),
          )
        else
          ..._passes.map(_passCard),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Controle de Acesso'),
        actions: [
          IconButton(
            tooltip: 'Atualizar',
            onPressed: _busy ? null : () => _reload(),
            icon: const Icon(Icons.refresh),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(46),
          child: TabBar(
            controller: _tabController,
            isScrollable: false,
            tabAlignment: TabAlignment.fill,
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white.withValues(alpha: 0.88),
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
            tabs: _staff
                ? const [
                    Tab(text: 'Resumo'),
                    Tab(text: 'Unidades autorizadas'),
                    Tab(text: 'Historico'),
                  ]
                : const [
                    Tab(text: 'Visitantes'),
                    Tab(text: 'Historico'),
                  ],
          ),
        ),
      ),
      floatingActionButton:
          (!_staff && _tabController.index == 0 && _bootstrapDone)
              ? FloatingActionButton.extended(
                  onPressed:
                      (_busy || (_effectiveResidentUnitId == null && widget.unitId == null))
                          ? null
                          : () => _openVisitorDialog(),
                  icon: const Icon(Icons.person_add_alt_1),
                  label: const Text('Visitante'),
                )
              : _staff && _tabController.index == 0 && _bootstrapDone
                  ? FloatingActionButton.extended(
                      onPressed: _busy || _units.isEmpty ? null : () => _openVisitorDialog(),
                      icon: const Icon(Icons.add),
                      label: const Text('Liberacao'),
                    )
                  : null,
      body: Stack(
        children: [
          TabBarView(
            controller: _tabController,
            children: _staff
                ? [
                    RefreshIndicator(onRefresh: _reload, child: _staffSummaryTab()),
                    RefreshIndicator(onRefresh: _reload, child: _byUnitTab()),
                    RefreshIndicator(onRefresh: _reload, child: _eventsListView()),
                  ]
                : [
                    RefreshIndicator(
                      onRefresh: _reload,
                      child: _residentVisitorsTab(),
                    ),
                    RefreshIndicator(onRefresh: _reload, child: _eventsListView()),
                  ],
          ),
          if (_loading)
            const ColoredBox(
              color: Color(0x33000000),
              child: Center(child: CircularProgressIndicator()),
            ),
        ],
      ),
    );
  }
}

class _KpiItem {
  _KpiItem(this.label, this.value, this.icon);

  final String label;
  final String value;
  final IconData icon;
}

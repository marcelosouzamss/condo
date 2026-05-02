import 'dart:convert';

import 'package:condo_app/resident_unit_storage.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class MyUnitCrudPage extends StatefulWidget {
  const MyUnitCrudPage({super.key, this.condoId = 1});

  final int condoId;

  @override
  State<MyUnitCrudPage> createState() => _MyUnitCrudPageState();
}

class _MyUnitCrudPageState extends State<MyUnitCrudPage> {
  final TextEditingController _nameCtrl = TextEditingController();
  final TextEditingController _phoneCtrl = TextEditingController();
  final TextEditingController _emailCtrl = TextEditingController();

  int? _selectedUnitId;
  int? _seededUnitId;

  bool _initialLoad = true;
  bool _busy = false;
  String? _errorMessage;
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _emailCtrl.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> _fetchPayload() async {
    if (_selectedUnitId == null) {
      final saved = await readResidentSelectedUnitId(
        CondoApi.residentSelectedUnitPrefKey(widget.condoId),
      );
      if (saved != null) {
        _selectedUnitId = saved;
      }
    }

    final ts = DateTime.now().millisecondsSinceEpoch.toString();
    final unitsResponse = await http.get(
      CondoApi.uri('/api/units', {
        'condoId': '${widget.condoId}',
        '_ts': ts,
      }),
      headers: const {'Cache-Control': 'no-cache'},
    );
    if (unitsResponse.statusCode != 200) {
      throw Exception('Erro ${unitsResponse.statusCode}');
    }
    final unitsRaw = jsonDecode(unitsResponse.body) as List<dynamic>;
    final units =
        unitsRaw.map((row) => Map<String, dynamic>.from(row as Map)).toList();
    final validUnitIds = units.map((u) => (u['id'] as num).toInt()).toSet();
    if (_selectedUnitId != null &&
        !validUnitIds.contains(_selectedUnitId)) {
      _selectedUnitId = null;
      await removeResidentSelectedUnitId(
        CondoApi.residentSelectedUnitPrefKey(widget.condoId),
      );
    }
    final unitId = _selectedUnitId ??
        (units.isNotEmpty ? (units.first['id'] as num).toInt() : null);

    final query = <String, String>{
      'condoId': '${widget.condoId}',
      '_ts': ts,
    };
    if (unitId != null) {
      query['unitId'] = '$unitId';
    }
    final r = await http.get(
      CondoApi.uri('/api/my-unit', query),
      headers: const {'Cache-Control': 'no-cache'},
    );
    if (r.statusCode != 200) {
      throw Exception('Erro ${r.statusCode}');
    }
    final payload = jsonDecode(r.body) as Map<String, dynamic>;
    payload['units'] = units;
    final unit = payload['unit'] as Map<String, dynamic>?;
    final loadedUnitId = (unit?['id'] as num?)?.toInt();
    if (_selectedUnitId == null && loadedUnitId != null) {
      _selectedUnitId = loadedUnitId;
    }
    return payload;
  }

  Future<void> _load() async {
    if (!mounted) {
      return;
    }
    setState(() {
      _busy = true;
      _errorMessage = null;
    });
    try {
      final payload = await _fetchPayload();
      if (!mounted) {
        return;
      }
      setState(() {
        _data = payload;
        _busy = false;
        _initialLoad = false;
      });
    } catch (e) {
      if (!mounted) {
        return;
      }
      setState(() {
        _busy = false;
        _initialLoad = false;
        _errorMessage = e.toString();
      });
    }
  }

  List<Map<String, dynamic>> _cloneList(String key) {
    final raw = (_data![key] as List<dynamic>? ?? const <dynamic>[])
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
    return raw;
  }

  void _mergeResidentFromServer(Map<String, dynamic> row) {
    if (_data == null) {
      return;
    }
    final id = row['id'];
    final list = _cloneList('residents');
    final idx = list.indexWhere((r) => r['id'] == id);
    if (idx >= 0) {
      list[idx] = Map<String, dynamic>.from(row);
    } else {
      list.add(Map<String, dynamic>.from(row));
    }
    list.sort((a, b) {
      final ra = a['role']?.toString() ?? '';
      final rb = b['role']?.toString() ?? '';
      final oa = _roleOrder(ra);
      final ob = _roleOrder(rb);
      if (oa != ob) {
        return oa.compareTo(ob);
      }
      return (a['full_name']?.toString() ?? '')
          .compareTo(b['full_name']?.toString() ?? '');
    });
    setState(() {
      _data!['residents'] = list;
    });
  }

  void _removeResidentLocal(int id) {
    if (_data == null) {
      return;
    }
    final list = _cloneList('residents')
        .where((r) => (r['id'] as num).toInt() != id)
        .toList();
    setState(() {
      _data!['residents'] = list;
    });
  }

  void _mergeVehicleFromServer(Map<String, dynamic> row) {
    if (_data == null) {
      return;
    }
    final id = row['id'];
    final list = _cloneList('vehicles');
    final idx = list.indexWhere((r) => r['id'] == id);
    if (idx >= 0) {
      list[idx] = Map<String, dynamic>.from(row);
    } else {
      list.insert(0, Map<String, dynamic>.from(row));
    }
    setState(() {
      _data!['vehicles'] = list;
    });
  }

  void _removeVehicleLocal(int id) {
    if (_data == null) {
      return;
    }
    final list = _cloneList('vehicles')
        .where((r) => (r['id'] as num).toInt() != id)
        .toList();
    setState(() {
      _data!['vehicles'] = list;
    });
  }

  void _mergePetFromServer(Map<String, dynamic> row) {
    if (_data == null) {
      return;
    }
    final id = row['id'];
    final list = _cloneList('pets');
    final idx = list.indexWhere((r) => r['id'] == id);
    if (idx >= 0) {
      list[idx] = Map<String, dynamic>.from(row);
    } else {
      list.insert(0, Map<String, dynamic>.from(row));
    }
    setState(() {
      _data!['pets'] = list;
    });
  }

  void _removePetLocal(int id) {
    if (_data == null) {
      return;
    }
    final list = _cloneList('pets')
        .where((r) => (r['id'] as num).toInt() != id)
        .toList();
    setState(() {
      _data!['pets'] = list;
    });
  }

  int _roleOrder(String role) {
    switch (role) {
      case 'owner':
        return 1;
      case 'tenant':
        return 2;
      case 'resident':
        return 3;
      default:
        return 4;
    }
  }

  Future<void> _savePersonalData(
    int unitId,
    String name,
    String phone,
    String email,
  ) async {
    final r = await http.patch(
      CondoApi.uri('/api/my-unit/personal-data'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'unitId': unitId,
        'fullName': name.trim(),
        'phone': phone.trim(),
        'email': email.trim(),
      }),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 200) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Dados pessoais atualizados.')),
      );
      await _load();
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Erro ao salvar (${r.statusCode}).')),
    );
  }

  Future<void> _addOrEditResident(
      {Map<String, dynamic>? row, required int unitId}) async {
    String role = row?['role'] as String? ?? 'resident';
    final nameCtrl =
        TextEditingController(text: row?['full_name'] as String? ?? '');
    final phoneCtrl =
        TextEditingController(text: row?['phone'] as String? ?? '');
    final emailCtrl =
        TextEditingController(text: row?['email'] as String? ?? '');
    final notesCtrl =
        TextEditingController(text: row?['notes'] as String? ?? '');
    final editing = row != null;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: Text(editing ? 'Editar morador' : 'Novo morador'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  value: role,
                  decoration: const InputDecoration(labelText: 'Papel'),
                  items: const [
                    DropdownMenuItem(
                        value: 'owner', child: Text('Proprietario')),
                    DropdownMenuItem(value: 'tenant', child: Text('Locatario')),
                    DropdownMenuItem(value: 'resident', child: Text('Morador')),
                    DropdownMenuItem(value: 'other', child: Text('Outro')),
                  ],
                  onChanged: (v) => setSt(() => role = v ?? 'resident'),
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
                const SizedBox(height: 12),
                TextField(
                  controller: notesCtrl,
                  minLines: 2,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Observacoes',
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
        ),
      ),
    );

    final name = nameCtrl.text.trim();
    final phone = phoneCtrl.text.trim();
    final email = emailCtrl.text.trim();
    final notes = notesCtrl.text.trim();
    nameCtrl.dispose();
    phoneCtrl.dispose();
    emailCtrl.dispose();
    notesCtrl.dispose();

    if (ok != true || !mounted) {
      return;
    }
    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe o nome do morador.')),
      );
      return;
    }

    final uri = editing
        ? CondoApi.uri('/api/my-unit/residents/${row['id']}')
        : CondoApi.uri('/api/my-unit/residents');
    final method = editing ? 'PATCH' : 'POST';
    final req = http.Request(method, uri)
      ..headers['Content-Type'] = 'application/json'
      ..body = jsonEncode({
        'condoId': widget.condoId,
        'unitId': unitId,
        'role': role,
        'fullName': name,
        'phone': phone,
        'email': email,
        'notes': notes,
      });
    final response = await http.Response.fromStream(await req.send());
    if (!mounted) {
      return;
    }
    if (response.statusCode == 200 || response.statusCode == 201) {
      final rowJson = jsonDecode(response.body) as Map<String, dynamic>;
      _mergeResidentFromServer(rowJson);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content:
                Text(editing ? 'Morador atualizado.' : 'Morador cadastrado.')),
      );
      await _load();
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Erro (${response.statusCode}).')),
    );
  }

  Future<void> _deleteResident(int id) async {
    final r = await http.delete(
      CondoApi.uri(
          '/api/my-unit/residents/$id', {'condoId': '${widget.condoId}'}),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 204) {
      _removeResidentLocal(id);
      await _load();
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Erro ao remover (${r.statusCode}).')),
    );
  }

  Future<void> _saveAsset({
    required String title,
    required String path,
    required int unitId,
    required List<_FieldDef> fields,
    Map<String, dynamic>? row,
  }) async {
    final ctrls = <String, TextEditingController>{};
    for (final f in fields) {
      ctrls[f.key] = TextEditingController(text: row?[f.key]?.toString() ?? '');
    }
    final editing = row != null;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(editing ? 'Editar $title' : 'Novo $title'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: fields
                .map(
                  (f) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: TextField(
                      controller: ctrls[f.key],
                      decoration: InputDecoration(
                        labelText: f.label,
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  ),
                )
                .toList(),
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
      ),
    );

    final body = <String, dynamic>{
      'condoId': widget.condoId,
      'unitId': unitId,
    };
    for (final f in fields) {
      body[f.key] = ctrls[f.key]!.text.trim();
      ctrls[f.key]!.dispose();
    }

    if (ok != true || !mounted) {
      return;
    }
    final requiredEmpty = fields.where((f) => f.required).any(
          (f) => (body[f.key] as String).isEmpty,
        );
    if (requiredEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Preencha os campos obrigatorios.')),
      );
      return;
    }

    final uri =
        editing ? CondoApi.uri('$path/${row['id']}') : CondoApi.uri(path);
    final method = editing ? 'PATCH' : 'POST';
    final req = http.Request(method, uri)
      ..headers['Content-Type'] = 'application/json'
      ..body = jsonEncode(body);
    final response = await http.Response.fromStream(await req.send());
    if (!mounted) {
      return;
    }
    if (response.statusCode == 200 || response.statusCode == 201) {
      final map = jsonDecode(response.body) as Map<String, dynamic>;
      if (path.contains('vehicles')) {
        _mergeVehicleFromServer(map);
      } else if (path.contains('pets')) {
        _mergePetFromServer(map);
      }
      await _load();
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Erro ao salvar (${response.statusCode}).')),
    );
  }

  Future<void> _deleteAsset(String path, int id) async {
    final r = await http.delete(
      CondoApi.uri('$path/$id', {'condoId': '${widget.condoId}'}),
    );
    if (!mounted) {
      return;
    }
    if (r.statusCode == 204) {
      if (path.contains('vehicles')) {
        _removeVehicleLocal(id);
      } else if (path.contains('pets')) {
        _removePetLocal(id);
      }
      await _load();
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Erro ao remover (${r.statusCode}).')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    if (_initialLoad && _data == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Minha Unidade')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_errorMessage != null && _data == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Minha Unidade')),
        body: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Falha ao carregar. Verifique ${CondoApi.baseUrl}.\n$_errorMessage',
              style: TextStyle(color: cs.error),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _load,
              child: const Text('Tentar novamente'),
            ),
          ],
        ),
      );
    }

    final data = _data ?? <String, dynamic>{};
    final units = (data['units'] as List<dynamic>? ?? const <dynamic>[])
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
    final unit = (data['unit'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final personal =
        (data['personalData'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final unitId = (unit['id'] as num?)?.toInt() ?? 0;
    final residents = (data['residents'] as List<dynamic>? ?? const <dynamic>[])
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
    final vehicles = (data['vehicles'] as List<dynamic>? ?? const <dynamic>[])
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();
    final pets = (data['pets'] as List<dynamic>? ?? const <dynamic>[])
        .map((row) => Map<String, dynamic>.from(row as Map))
        .toList();

    if (_seededUnitId != unitId) {
      _nameCtrl.text = personal['fullName']?.toString() ?? '';
      _phoneCtrl.text = personal['phone']?.toString() ?? '';
      _emailCtrl.text = personal['email']?.toString() ?? '';
      _seededUnitId = unitId;
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Minha Unidade')),
      body: Stack(
        children: [
          RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: cs.primary,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Selecione a unidade',
                        style: theme.textTheme.titleMedium?.copyWith(
                          color: cs.onPrimary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 10),
                      DropdownButtonFormField<int>(
                        value: unitId > 0 ? unitId : null,
                        dropdownColor: cs.surface,
                        decoration: InputDecoration(
                          filled: true,
                          fillColor: cs.surface,
                          border: const OutlineInputBorder(),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                        ),
                        items: units
                            .map(
                              (u) => DropdownMenuItem<int>(
                                value: (u['id'] as num).toInt(),
                                child: Text(
                                  'Torre ${u['tower']} • Unidade ${u['number']}',
                                ),
                              ),
                            )
                            .toList(),
                        onChanged: (value) async {
                          if (value == null || value == _selectedUnitId) {
                            return;
                          }
                          setState(() {
                            _selectedUnitId = value;
                            _seededUnitId = null;
                          });
                          await writeResidentSelectedUnitId(
                            CondoApi.residentSelectedUnitPrefKey(widget.condoId),
                            value,
                          );
                          await _load();
                        },
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                _SectionHeader(
                  title: 'Moradores vinculados',
                  onAdd: unitId > 0
                      ? () => _addOrEditResident(unitId: unitId)
                      : null,
                ),
                if (residents.isEmpty)
                  const _EmptySectionList(message: 'Nenhum morador cadastrado.')
                else
                  ...residents.map(
                    (r) => _CrudCard(
                      title: r['full_name']?.toString() ?? '',
                      subtitle:
                          '${_roleLabel(r['role']?.toString() ?? '')} • ${r['phone'] ?? '-'}',
                      onEdit: unitId > 0
                          ? () => _addOrEditResident(unitId: unitId, row: r)
                          : null,
                      onDelete: () => _deleteResident((r['id'] as num).toInt()),
                    ),
                  ),
                const SizedBox(height: 10),
                _SectionHeader(
                  title: 'Veiculos',
                  onAdd: unitId > 0
                      ? () => _saveAsset(
                            title: 'veiculo',
                            path: '/api/my-unit/vehicles',
                            unitId: unitId,
                            fields: const [
                              _FieldDef('model', 'Modelo', true),
                              _FieldDef('plate', 'Placa', true),
                              _FieldDef('parkingSpot', 'Vaga', false),
                              _FieldDef('color', 'Cor', false),
                            ],
                          )
                      : null,
                ),
                if (vehicles.isEmpty)
                  const _EmptySectionList(message: 'Nenhum veiculo cadastrado.')
                else
                  ...vehicles.map(
                    (v) => _CrudCard(
                      title: v['model']?.toString() ?? '',
                      subtitle:
                          '${v['plate']} • Vaga ${v['parking_spot'] ?? '-'}',
                      onEdit: () => _saveAsset(
                        title: 'veiculo',
                        path: '/api/my-unit/vehicles',
                        unitId: unitId,
                        row: v,
                        fields: const [
                          _FieldDef('model', 'Modelo', true),
                          _FieldDef('plate', 'Placa', true),
                          _FieldDef('parkingSpot', 'Vaga', false),
                          _FieldDef('color', 'Cor', false),
                        ],
                      ),
                      onDelete: () => _deleteAsset(
                          '/api/my-unit/vehicles', (v['id'] as num).toInt()),
                    ),
                  ),
                const SizedBox(height: 10),
                _SectionHeader(
                  title: 'Pets',
                  onAdd: unitId > 0
                      ? () => _saveAsset(
                            title: 'pet',
                            path: '/api/my-unit/pets',
                            unitId: unitId,
                            fields: const [
                              _FieldDef('name', 'Nome', true),
                              _FieldDef('species', 'Especie', true),
                              _FieldDef('breed', 'Raca', false),
                              _FieldDef('color', 'Cor', false),
                            ],
                          )
                      : null,
                ),
                if (pets.isEmpty)
                  const _EmptySectionList(message: 'Nenhum pet cadastrado.')
                else
                  ...pets.map(
                    (p) => _CrudCard(
                      title: p['name']?.toString() ?? '',
                      subtitle: '${p['species']} • ${p['breed'] ?? '-'}',
                      onEdit: () => _saveAsset(
                        title: 'pet',
                        path: '/api/my-unit/pets',
                        unitId: unitId,
                        row: p,
                        fields: const [
                          _FieldDef('name', 'Nome', true),
                          _FieldDef('species', 'Especie', true),
                          _FieldDef('breed', 'Raca', false),
                          _FieldDef('color', 'Cor', false),
                        ],
                      ),
                      onDelete: () => _deleteAsset(
                          '/api/my-unit/pets', (p['id'] as num).toInt()),
                    ),
                  ),
                const SizedBox(height: 10),
                Text(
                  'Atualizacao de dados pessoais',
                  style: theme.textTheme.titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: cs.outlineVariant),
                  ),
                  child: Column(
                    children: [
                      TextField(
                        controller: _nameCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Nome completo',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: _phoneCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Telefone',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: _emailCtrl,
                        decoration: const InputDecoration(
                          labelText: 'E-mail',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          onPressed: unitId > 0
                              ? () => _savePersonalData(
                                    unitId,
                                    _nameCtrl.text,
                                    _phoneCtrl.text,
                                    _emailCtrl.text,
                                  )
                              : null,
                          icon: const Icon(Icons.save_rounded),
                          label: const Text('Salvar dados pessoais'),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (_busy)
            const Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: LinearProgressIndicator(minHeight: 3),
            ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.onAdd});

  final String title;
  final VoidCallback? onAdd;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
          ),
          FilledButton.tonalIcon(
            onPressed: onAdd,
            icon: const Icon(Icons.add_rounded),
            label: const Text('Adicionar'),
          ),
        ],
      ),
    );
  }
}

class _EmptySectionList extends StatelessWidget {
  const _EmptySectionList({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: cs.outlineVariant),
      ),
      child: Text(
        message,
        style: TextStyle(color: cs.onSurfaceVariant),
      ),
    );
  }
}

class _CrudCard extends StatelessWidget {
  const _CrudCard({
    required this.title,
    required this.subtitle,
    required this.onEdit,
    required this.onDelete,
  });

  final String title;
  final String subtitle;
  final VoidCallback? onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: cs.outlineVariant),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                Text(subtitle),
              ],
            ),
          ),
          IconButton(onPressed: onEdit, icon: const Icon(Icons.edit_outlined)),
          IconButton(
              onPressed: onDelete,
              icon: const Icon(Icons.delete_outline_rounded)),
        ],
      ),
    );
  }
}

class _FieldDef {
  const _FieldDef(this.key, this.label, this.required);

  final String key;
  final String label;
  final bool required;
}

String _roleLabel(String role) {
  switch (role) {
    case 'owner':
      return 'Proprietario';
    case 'tenant':
      return 'Locatario';
    case 'resident':
      return 'Morador';
    default:
      return 'Outro';
  }
}

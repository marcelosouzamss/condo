import 'dart:convert';

import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/resident_unit_storage.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

/// Encomendas na portaria: equipe cadastra chegada; morador confirma retirada.
class ParcelDeliveriesPage extends StatefulWidget {
  const ParcelDeliveriesPage({
    super.key,
    required this.condoId,
    required this.userId,
    required this.userRole,
    required this.sessionUnitId,
  });

  final int condoId;
  final int userId;
  final String userRole;
  final int? sessionUnitId;

  @override
  State<ParcelDeliveriesPage> createState() => _ParcelDeliveriesPageState();
}

class _ParcelDeliveriesPageState extends State<ParcelDeliveriesPage> {
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _units = [];
  bool _loading = true;
  String? _error;
  int? _resolvedUnitId;
  bool _staffOnlyPending = true;

  bool get _isStaff => CondoUserRoles.isBillingStaff(widget.userRole);
  bool get _isResident => widget.userRole == CondoUserRoles.resident;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    if (_isStaff) {
      await _loadUnits();
    } else if (widget.sessionUnitId != null) {
      _resolvedUnitId = widget.sessionUnitId;
    } else if (_isResident) {
      await _resolveUnitFromPrefs();
    }
    if (!mounted) return;
    await _reload();
  }

  Future<void> _loadUnits() async {
    try {
      final r = await http.get(
        CondoApi.uri('/api/units', {'condoId': '${widget.condoId}'}),
      );
      if (!mounted || r.statusCode != 200) return;
      final list = jsonDecode(r.body) as List<dynamic>;
      setState(() {
        _units = list
            .map((e) => Map<String, dynamic>.from(e as Map))
            .where((u) => u['condo_id'] == widget.condoId)
            .toList();
      });
    } catch (_) {}
  }

  Future<void> _resolveUnitFromPrefs() async {
    try {
      final saved = await readResidentSelectedUnitId(
        CondoApi.residentSelectedUnitPrefKey(widget.condoId),
      );
      final r = await http.get(
        CondoApi.uri('/api/units', {'condoId': '${widget.condoId}'}),
      );
      if (!mounted || r.statusCode != 200) return;
      final list = jsonDecode(r.body) as List<dynamic>;
      int? pick(int id) {
        for (final raw in list) {
          final u = raw as Map<String, dynamic>;
          if (u['condo_id'] == widget.condoId && u['id'] == id) {
            return id;
          }
        }
        return null;
      }

      int? resolved;
      if (saved != null) resolved = pick(saved);
      resolved ??= () {
        for (final raw in list) {
          final u = raw as Map<String, dynamic>;
          if (u['condo_id'] == widget.condoId && u['id'] != null) {
            return (u['id'] as num).toInt();
          }
        }
        return null;
      }();

      setState(() => _resolvedUnitId = resolved);
    } catch (_) {}
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final q = <String, String>{
        'condoId': '${widget.condoId}',
        'userId': '${widget.userId}',
      };
      if (_isStaff && _staffOnlyPending) {
        q['onlyPending'] = 'true';
      }
      if (_isResident) {
        final uidParam = widget.sessionUnitId ?? _resolvedUnitId;
        if (uidParam != null) {
          q['unitId'] = '$uidParam';
        }
      }

      final r = await http.get(CondoApi.uri('/api/parcel-deliveries', q));
      if (!mounted) return;
      if (r.statusCode != 200) {
        setState(() {
          _error = 'Erro ao carregar (${r.statusCode}).';
          _loading = false;
        });
        return;
      }
      final list = jsonDecode(r.body) as List<dynamic>;
      setState(() {
        _rows = list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
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

  Future<void> _registerParcel({
    required int unitId,
    required String carrier,
    required String recipient,
    required String notes,
  }) async {
    final r = await http.post(
      CondoApi.uri('/api/parcel-deliveries'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'condoId': widget.condoId,
        'userId': widget.userId,
        'unitId': unitId,
        'carrierHint': carrier.trim(),
        'recipientLabel': recipient.trim(),
        'notes': notes.trim(),
      }),
    );
    if (!mounted) return;
    if (r.statusCode == 201) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Encomenda registrada.')),
      );
      await _reload();
    } else {
      final msg = r.body.isNotEmpty
          ? (jsonDecode(r.body) as Map)['message']?.toString()
          : '${r.statusCode}';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg ?? 'Erro ao registrar.')),
      );
    }
  }

  Future<void> _pickup(int parcelId) async {
    final body = <String, dynamic>{'userId': widget.userId};
    final uid = widget.sessionUnitId ?? _resolvedUnitId;
    if (uid != null) {
      body['unitId'] = uid;
    }

    final r = await http.patch(
      CondoApi.uri('/api/parcel-deliveries/$parcelId/pickup'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    if (!mounted) return;
    if (r.statusCode == 200) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Retirada confirmada.')),
      );
      await _reload();
    } else {
      final msg = r.body.isNotEmpty
          ? (jsonDecode(r.body) as Map)['message']?.toString()
          : '${r.statusCode}';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg ?? 'Não foi possível dar baixa.')),
      );
    }
  }

  void _openRegisterSheet() {
    int? selUnit = _units.isNotEmpty ? (_units.first['id'] as num?)?.toInt() : null;
    final carrierCtrl = TextEditingController();
    final recipientCtrl = TextEditingController();
    final notesCtrl = TextEditingController();

    showModalBottomSheet<void>(
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
                      'Registrar encomenda',
                      style: Theme.of(ctx).textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    const SizedBox(height: 16),
                    if (_units.isEmpty)
                      const Text('Carregando unidades…')
                    else
                      DropdownButtonFormField<int>(
                        value: selUnit,
                        decoration: const InputDecoration(
                          labelText: 'Unidade destinatária',
                          border: OutlineInputBorder(),
                        ),
                        items: _units.map((u) {
                          final id = (u['id'] as num).toInt();
                          final t = u['tower'] as String? ?? '';
                          final n = u['number'] as String? ?? '';
                          return DropdownMenuItem(
                            value: id,
                            child: Text('$t-$n'),
                          );
                        }).toList(),
                        onChanged: (v) => setModal(() => selUnit = v),
                      ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: carrierCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Transportadora / obs. da etiqueta',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: recipientCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Nome na encomenda (opcional)',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: notesCtrl,
                      minLines: 2,
                      maxLines: 4,
                      decoration: const InputDecoration(
                        labelText: 'Observações para o morador',
                        border: OutlineInputBorder(),
                        alignLabelWithHint: true,
                      ),
                    ),
                    const SizedBox(height: 18),
                    FilledButton.icon(
                      onPressed: selUnit == null
                          ? null
                          : () async {
                              Navigator.pop(ctx);
                              await _registerParcel(
                                unitId: selUnit!,
                                carrier: carrierCtrl.text,
                                recipient: recipientCtrl.text,
                                notes: notesCtrl.text,
                              );
                            },
                      icon: const Icon(Icons.inventory_rounded),
                      label: const Text('Salvar e notificar'),
                    ),
                  ],
                ),
              );
            },
          ),
        );
      },
    ).whenComplete(() {
      carrierCtrl.dispose();
      recipientCtrl.dispose();
      notesCtrl.dispose();
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Encomendas')),
      floatingActionButton: _isStaff
          ? FloatingActionButton.extended(
              onPressed: () async {
                final messenger = ScaffoldMessenger.of(context);
                if (_units.isEmpty) {
                  await _loadUnits();
                }
                if (!mounted) return;
                if (_units.isEmpty) {
                  messenger.showSnackBar(
                    const SnackBar(
                      content: Text('Não foi possível carregar unidades.'),
                    ),
                  );
                  return;
                }
                _openRegisterSheet();
              },
              icon: const Icon(Icons.add_rounded),
              label: const Text('Nova encomenda'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
          children: [
            Text(
              'Chegadas na portaria',
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _isStaff
                  ? 'Cadastre a encomenda recebida; o morador vê o aviso e confirma a retirada.'
                  : 'Confira avisos da sua unidade e dê baixa ao retirar na recepção.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: cs.onSurfaceVariant,
              ),
            ),
            if (_isStaff) ...[
              const SizedBox(height: 12),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Somente aguardando retirada'),
                value: _staffOnlyPending,
                onChanged: (v) {
                  setState(() => _staffOnlyPending = v);
                  _reload();
                },
              ),
            ],
            if (_isResident &&
                widget.sessionUnitId == null &&
                _resolvedUnitId == null) ...[
              const SizedBox(height: 12),
              Text(
                'Defina sua unidade em Minha Unidade para ver encomendas.',
                style: TextStyle(color: cs.error),
              ),
            ],
            const SizedBox(height: 16),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              Text(_error!, style: TextStyle(color: cs.error))
            else if (_rows.isEmpty)
              Text(
                _isStaff
                    ? 'Nenhuma encomenda neste filtro.'
                    : 'Nenhuma encomenda pendente para sua unidade.',
                style: theme.textTheme.bodyLarge?.copyWith(
                  color: cs.onSurfaceVariant,
                ),
              )
            else
              ..._rows.map((row) {
                final id = (row['id'] as num).toInt();
                final tower = row['unit_tower'] as String? ?? '';
                final number = row['unit_number'] as String? ?? '';
                final carrier = row['carrier_hint'] as String? ?? '';
                final recipient = row['recipient_label'] as String? ?? '';
                final notes = row['notes'] as String? ?? '';
                final status = row['status'] as String? ?? '';
                final pickedAt = row['picked_up_at']?.toString() ?? '';

                final pending = status == 'awaiting_pickup';

                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                              pending
                                  ? Icons.mark_email_unread_rounded
                                  : Icons.check_circle_outline_rounded,
                              color: pending ? cs.primary : cs.outline,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'Unidade $tower-$number',
                                style: theme.textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            Chip(
                              label: Text(
                                pending ? 'Aguardando' : 'Retirada ok',
                              ),
                              visualDensity: VisualDensity.compact,
                            ),
                          ],
                        ),
                        if (carrier.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Text('Transportadora / ref.: $carrier'),
                        ],
                        if (recipient.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text('Nome na etiqueta: $recipient'),
                        ],
                        if (notes.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Text(notes),
                        ],
                        if (!pending && pickedAt.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Text(
                            'Retirada registrada em '
                            '${pickedAt.length >= 16 ? pickedAt.substring(0, 16) : pickedAt}',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: cs.onSurfaceVariant,
                            ),
                          ),
                        ],
                        if (_isResident && pending) ...[
                          const SizedBox(height: 12),
                          FilledButton.icon(
                            onPressed:
                                (widget.sessionUnitId ?? _resolvedUnitId) ==
                                        null
                                    ? null
                                    : () => _pickup(id),
                            icon: const Icon(Icons.how_to_reg_rounded),
                            label: const Text(
                              'Confirmar retirada na recepção',
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }
}

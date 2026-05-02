// Formatação de datas e duração para chamados de manutenção (morador e síndico).

DateTime? maintenanceParseLocal(Object? raw) {
  final d = DateTime.tryParse(raw?.toString() ?? '');
  return d?.toLocal();
}

/// Data e hora da mensagem (DD/MM/AAAA · HH:mm), em horário local.
String maintenanceMessageTimestamp(Object? raw) {
  final d = maintenanceParseLocal(raw);
  if (d == null) return raw?.toString() ?? '';
  final dd = d.day.toString().padLeft(2, '0');
  final mm = d.month.toString().padLeft(2, '0');
  final yyyy = d.year.toString();
  final hh = d.hour.toString().padLeft(2, '0');
  final min = d.minute.toString().padLeft(2, '0');
  return '$dd/$mm/$yyyy · $hh:$min';
}

String maintenanceDateOnlyLocal(DateTime d) {
  final dd = d.day.toString().padLeft(2, '0');
  final mm = d.month.toString().padLeft(2, '0');
  final yyyy = d.year.toString();
  return '$dd/$mm/$yyyy';
}

/// Dias corridos inclusivos entre duas datas locais (mesmo dia = 1).
int maintenanceInclusiveCalendarDays(DateTime start, DateTime end) {
  final s = DateTime(start.year, start.month, start.day);
  final e = DateTime(end.year, end.month, end.day);
  return e.difference(s).inDays + 1;
}

/// Linha única: dias desde abertura até encerramento (ou até hoje se aberto).
String maintenanceProcessDurationLine({
  required Object? createdAtRaw,
  required Object? updatedAtRaw,
  required String status,
}) {
  final created = maintenanceParseLocal(createdAtRaw);
  if (created == null) return '';
  final terminal = status == 'completed' || status == 'closed';
  final updated = maintenanceParseLocal(updatedAtRaw);
  var end = terminal ? (updated ?? DateTime.now()) : DateTime.now();
  if (end.isBefore(created)) end = created;
  final days = maintenanceInclusiveCalendarDays(created, end);
  final d0 = maintenanceDateOnlyLocal(created);
  final d1 = maintenanceDateOnlyLocal(end);
  if (terminal) {
    return 'Tempo total: $days dias corridos ($d0 → $d1).';
  }
  return 'Em aberto: $days dias corridos (desde $d0 até $d1).';
}

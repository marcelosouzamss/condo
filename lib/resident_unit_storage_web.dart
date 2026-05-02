// Armazenamento na web; import condicional a partir de resident_unit_storage.dart.
// ignore_for_file: avoid_web_libraries_in_flutter

import 'dart:html' as html;

Future<int?> readResidentSelectedUnitId(String prefKey) async {
  final v = html.window.localStorage[prefKey];
  if (v == null || v.isEmpty) {
    return null;
  }
  return int.tryParse(v);
}

Future<void> writeResidentSelectedUnitId(String prefKey, int unitId) async {
  html.window.localStorage[prefKey] = '$unitId';
}

Future<void> removeResidentSelectedUnitId(String prefKey) async {
  html.window.localStorage.remove(prefKey);
}

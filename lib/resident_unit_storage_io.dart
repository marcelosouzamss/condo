import 'package:shared_preferences/shared_preferences.dart';

Future<int?> readResidentSelectedUnitId(String prefKey) async {
  final p = await SharedPreferences.getInstance();
  return p.getInt(prefKey);
}

Future<void> writeResidentSelectedUnitId(String prefKey, int unitId) async {
  final p = await SharedPreferences.getInstance();
  await p.setInt(prefKey, unitId);
}

Future<void> removeResidentSelectedUnitId(String prefKey) async {
  final p = await SharedPreferences.getInstance();
  await p.remove(prefKey);
}

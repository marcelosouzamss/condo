import 'resident_unit_storage_stub.dart'
    if (dart.library.io) 'resident_unit_storage_io.dart'
    if (dart.library.html) 'resident_unit_storage_web.dart' as impl;

Future<int?> readResidentSelectedUnitId(String prefKey) =>
    impl.readResidentSelectedUnitId(prefKey);

Future<void> writeResidentSelectedUnitId(String prefKey, int unitId) =>
    impl.writeResidentSelectedUnitId(prefKey, unitId);

Future<void> removeResidentSelectedUnitId(String prefKey) =>
    impl.removeResidentSelectedUnitId(prefKey);

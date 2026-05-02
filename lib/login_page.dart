import 'dart:convert';

import 'package:condo_app/resident_unit_storage.dart';
import 'package:condo_app/syndic_metric_pages.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class LoginResult {
  const LoginResult({
    required this.id,
    required this.condoId,
    required this.unitId,
    required this.fullName,
    required this.login,
    required this.role,
  });

  final int id;
  final int condoId;
  final int? unitId;
  final String fullName;
  final String login;
  final String role;
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.onLoggedIn});

  final ValueChanged<LoginResult> onLoggedIn;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final TextEditingController _loginCtrl = TextEditingController();
  final TextEditingController _passwordCtrl = TextEditingController();
  bool _loading = false;

  String _condominiumTitle = 'Acesso ao Condomínio';
  String? _logoRelativePath;

  static int _appearanceCondoId() {
    const raw = String.fromEnvironment('LOGIN_CONDO_ID', defaultValue: '1');
    return int.tryParse(raw) ?? 1;
  }

  @override
  void initState() {
    super.initState();
    _loadLoginAppearance();
  }

  Future<void> _loadLoginAppearance() async {
    try {
      final r = await http.get(
        CondoApi.uri('/api/auth/login-appearance', {
          'condoId': '${_appearanceCondoId()}',
        }),
      );
      if (!mounted || r.statusCode != 200) {
        return;
      }
      final m = jsonDecode(r.body) as Map<String, dynamic>;
      final title = m['condominiumName'] as String?;
      final logo = m['logoRelativePath'] as String?;
      if (!mounted) {
        return;
      }
      setState(() {
        if (title != null && title.trim().isNotEmpty) {
          _condominiumTitle = title.trim();
        }
        _logoRelativePath =
            logo != null && logo.trim().isNotEmpty ? logo.trim() : null;
      });
    } catch (_) {
      /* mantém padrão */
    }
  }

  @override
  void dispose() {
    _loginCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final login = _loginCtrl.text.trim();
    final password = _passwordCtrl.text.trim();
    if (login.isEmpty || password.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe login e senha.')),
      );
      return;
    }

    setState(() => _loading = true);
    try {
      final response = await http.post(
        CondoApi.uri('/api/auth/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'login': login, 'password': password}),
      );
      if (!mounted) {
        return;
      }
      if (response.statusCode != 200) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Falha no login (${response.statusCode}).')),
        );
        return;
      }
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final user = body['user'] as Map<String, dynamic>;
      final condoId = (user['condoId'] as num).toInt();
      final unitId = (user['unitId'] as num?)?.toInt();
      if (unitId != null) {
        await writeResidentSelectedUnitId(
          CondoApi.residentSelectedUnitPrefKey(condoId),
          unitId,
        );
      }
      widget.onLoggedIn(
        LoginResult(
          id: (user['id'] as num).toInt(),
          condoId: condoId,
          unitId: unitId,
          fullName: user['fullName'] as String? ?? '',
          login: user['login'] as String? ?? '',
          role: user['role'] as String? ?? 'resident',
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: SingleChildScrollView(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (_logoRelativePath != null) ...[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(16),
                      child: Image.network(
                        CondoApi.uploadsUrl(_logoRelativePath!),
                        height: 100,
                        width: 280,
                        fit: BoxFit.contain,
                        errorBuilder: (_, __, ___) =>
                            Icon(Icons.apartment_rounded, size: 56, color: cs.primary),
                      ),
                    ),
                  ] else ...[
                    Icon(Icons.apartment_rounded, size: 56, color: cs.primary),
                  ],
                  const SizedBox(height: 10),
                  Text(
                    _condominiumTitle,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                  const SizedBox(height: 20),
                TextField(
                  controller: _loginCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Login',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _passwordCtrl,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Senha',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _loading ? null : _submit,
                    child: _loading
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Entrar'),
                  ),
                ),
                const SizedBox(height: 14),
                const Text(
                  'Contas de demonstração:\n'
                  'sindico / sindico · administradora / administradora · '
                  'morador / morador · parceiro / parceiro · colaborador / colaborador',
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
      ),
    );
  }
}

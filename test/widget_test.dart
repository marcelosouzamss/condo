import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:condo_app/billing_pages.dart';
import 'package:condo_app/condo_user_roles.dart';
import 'package:condo_app/events_calendar_page.dart';
import 'package:condo_app/internal_market_page.dart';
import 'package:condo_app/main.dart';
import 'package:condo_app/polls_pages.dart';
import 'package:condo_app/service_guide_page.dart';
import 'package:condo_app/virtual_assemblies_page.dart';

Future<void> _openFeature(WidgetTester tester, String label) async {
  await tester.pumpWidget(const CondoApp());
  await tester.scrollUntilVisible(
    find.text(label),
    200,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).first);
  await tester.pumpAndSettle();
}

Future<void> _scrollToText(
  WidgetTester tester,
  String label, {
  double delta = 220,
}) async {
  await tester.scrollUntilVisible(
    find.text(label),
    delta,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('renders home screen and changes style', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const CondoApp());

    expect(find.text('Condomínio'), findsOneWidget);
    expect(
      find.text('Personalizado para a sua administradora!'),
      findsOneWidget,
    );
    expect(find.text('Área do Síndico'), findsOneWidget);
    expect(find.text('Controle de Acesso'), findsOneWidget);
    expect(find.text('Perfil'), findsOneWidget);
    expect(find.text('Estilo ativo: Diurno'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.settings_rounded));
    await tester.pumpAndSettle();

    expect(find.text('Configurações de estilo'), findsOneWidget);
    expect(find.text('Green'), findsOneWidget);

    await tester.tap(find.text('Green'));
    await tester.pumpAndSettle();

    await tester.pageBack();
    await tester.pumpAndSettle();

    expect(find.text('Estilo ativo: Green'), findsOneWidget);
  });

  testWidgets('opens syndic area dashboard', (WidgetTester tester) async {
    await tester.pumpWidget(const CondoApp());

    await tester.tap(find.text('Área do Síndico'));
    await tester.pumpAndSettle();

    expect(find.text('Área do Síndico'), findsWidgets);
    expect(find.text('Dashboard'), findsOneWidget);
    expect(find.text('Ocorrências abertas'), findsOneWidget);
    expect(find.text('Solicitações de manutenção'), findsOneWidget);
    expect(find.text('Comunicados recentes'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Cadastros'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Cadastros pendentes'), findsOneWidget);
    expect(find.text('Cadastros'), findsOneWidget);
    expect(find.text('Gestão de avisos'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Relatórios'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Relatórios'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Enviar comunicado em massa'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Enviar comunicado em massa'), findsOneWidget);
  });

  testWidgets('opens administrator area', (WidgetTester tester) async {
    await tester.pumpWidget(const CondoApp());

    await tester.tap(find.text('Administração'));
    await tester.pumpAndSettle();

    expect(find.text('Administração'), findsWidgets);
    expect(find.text('Controle financeiro'), findsOneWidget);
    expect(find.text('Boletos emitidos'), findsOneWidget);
    expect(find.text('Inadimplência'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Cadastro de unidades'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Cadastro de unidades'), findsOneWidget);
    expect(find.text('Cadastro de moradores'), findsOneWidget);
    expect(find.text('Relatórios gerenciais'), findsWidgets);

    await tester.scrollUntilVisible(
      find.text('Gestão de contratos/documentos'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Gestão de contratos/documentos'), findsOneWidget);
    expect(find.text('Gestão de contratos'), findsOneWidget);
    expect(find.text('Gestão de documentos'), findsOneWidget);
  });

  testWidgets('opens my unit area', (WidgetTester tester) async {
    await tester.pumpWidget(const CondoApp());

    await tester.tap(find.text('Minha Unidade'));
    await tester.pumpAndSettle();

    expect(find.text('Minha Unidade'), findsWidgets);
    expect(find.text('Dados da unidade'), findsWidgets);
    expect(find.text('Moradores vinculados'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Veículos'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Veículos'), findsOneWidget);
    expect(find.text('Pets'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Histórico'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Histórico'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Boletos pagos'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Boletos pagos'), findsOneWidget);
    expect(find.text('Solicitações feitas'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Atualização de dados pessoais'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Atualização de dados pessoais'), findsOneWidget);
    expect(find.text('Salvar dados pessoais'), findsOneWidget);
  });

  testWidgets('opens access control area', (WidgetTester tester) async {
    await tester.pumpWidget(const CondoApp());

    await tester.tap(find.text('Controle de Acesso'));
    await tester.pumpAndSettle();

    expect(find.text('Controle de Acesso'), findsWidgets);
    expect(find.text('Cadastro de visitantes'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Cadastro de prestadores de serviço'),
      220,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Cadastro de prestadores de serviço'), findsOneWidget);
    expect(find.text('Geração de acesso'), findsOneWidget);
    expect(find.text('QR Code'), findsWidgets);

    await tester.scrollUntilVisible(
      find.text('Registro de entradas/saídas'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Registro de entradas/saídas'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Integração (futuro)'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Integração (futuro)'), findsOneWidget);
    expect(find.text('Portaria remota'), findsOneWidget);
    expect(find.text('Câmeras'), findsOneWidget);
  });

  testWidgets('online billing hub loads for resident',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: OnlineBillingHubPage(
          condoId: 1,
          userId: 1,
          userRole: 'resident',
          unitId: 101,
        ),
      ),
    );

    expect(find.text('Boleto online'), findsOneWidget);
    expect(find.text('Pendentes'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.pumpAndSettle(const Duration(seconds: 6));
    expect(find.text('Tentar de novo'), findsOneWidget);
  });

  testWidgets('opens offers area', (WidgetTester tester) async {
    await tester.pumpWidget(const CondoApp());

    await tester.scrollUntilVisible(
      find.text('Ofertas'),
      180,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Ofertas'));
    await tester.pumpAndSettle();

    expect(find.text('Ofertas'), findsWidgets);
    expect(find.text('Descontos e parcerias'), findsOneWidget);
    expect(find.text('Filtros por categoria'), findsOneWidget);
    expect(find.text('Todas'), findsWidgets);
    expect(find.text('Restaurantes'), findsOneWidget);
  });

  testWidgets('opens contact condo area', (WidgetTester tester) async {
    await _openFeature(tester, 'Fale com o Condomínio');

    expect(find.text('Fale com o Condomínio'), findsWidgets);
    expect(find.text('Chat direto com'), findsOneWidget);
    expect(find.text('Síndico'), findsOneWidget);
    expect(find.text('Administração'), findsOneWidget);
    await _scrollToText(tester, 'Histórico de mensagens');
    expect(find.text('Histórico de mensagens'), findsOneWidget);
  });

  testWidgets('opens space reservations area', (WidgetTester tester) async {
    await _openFeature(tester, 'Reservas de Espaço');

    expect(find.text('Reservas de Espaço'), findsWidgets);
    expect(find.text('Áreas comuns'), findsOneWidget);
    expect(find.text('Minhas reservas'), findsOneWidget);
    expect(find.text('Cadastrar espaço'), findsNothing);
    expect(find.text('Salão de festas'), findsNothing);
    expect(find.text('Salao de festas'), findsNothing);
    expect(find.text('Churrasqueira'), findsNothing);
  });

  testWidgets('opens notice board area', (WidgetTester tester) async {
    await _openFeature(tester, 'Mural de Avisos');

    expect(find.text('Mural de Avisos'), findsWidgets);
    expect(find.text('Feed de avisos gerais'), findsOneWidget);
    await _scrollToText(tester, 'Fixar avisos importantes', delta: 140);
    expect(find.text('Fixar avisos importantes'), findsOneWidget);
    await _scrollToText(tester, 'Anexos');
    expect(find.text('Anexos'), findsOneWidget);
    expect(find.text('PDF'), findsOneWidget);
  });

  testWidgets('opens individual communications area', (
    WidgetTester tester,
  ) async {
    await _openFeature(tester, 'Comunicados Individuais');

    expect(find.text('Comunicados Individuais'), findsWidgets);
    expect(find.text('Envio direto para'), findsOneWidget);
    expect(find.text('Unidade específica'), findsOneWidget);
    await _scrollToText(tester, 'Controle de leitura', delta: 140);
    expect(find.text('Controle de leitura'), findsOneWidget);
    await _scrollToText(tester, 'Histórico');
    expect(find.text('Histórico'), findsOneWidget);
  });

  testWidgets('opens maintenance request area', (WidgetTester tester) async {
    await _openFeature(tester, 'Solicitar Manutenção');

    expect(find.text('Solicitar Manutenção'), findsWidgets);
    expect(find.text('Abertura de chamado com'), findsOneWidget);
    expect(find.text('Descrição'), findsOneWidget);
    expect(find.text('Fotos'), findsOneWidget);
    await _scrollToText(tester, 'Atribuição de responsável');
    expect(find.text('Status'), findsOneWidget);
    expect(find.text('Atribuição de responsável'), findsOneWidget);
  });

  testWidgets('virtual assemblies page loads list from api', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: VirtualAssembliesPage(
          condoId: 1,
          userId: 1,
          userRole: 'resident',
          displayName: 'Teste',
        ),
      ),
    );

    expect(find.text('Assembleias Virtuais'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.pumpAndSettle(const Duration(seconds: 6));
    expect(find.text('Tentar de novo'), findsOneWidget);
  });

  testWidgets('opens videoconference area', (WidgetTester tester) async {
    await _openFeature(tester, 'Videoconferência');

    expect(find.text('Videoconferência'), findsWidgets);
    expect(find.text('Integração com'), findsOneWidget);
    expect(find.text('WebRTC'), findsOneWidget);
    expect(find.text('Jitsi'), findsOneWidget);
    expect(find.text('Zoom'), findsOneWidget);
    await _scrollToText(tester, 'Chat durante reunião');
    expect(find.text('Salas por evento'), findsOneWidget);
    expect(find.text('Chat durante reunião'), findsOneWidget);
  });

  testWidgets('polls hub shows header and create action', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: PollsHubPage(
          condoId: 1,
          userId: 1,
          userRole: CondoUserRoles.resident,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Enquetes e Votações'), findsOneWidget);
    expect(find.text('Consultas e votações do condomínio.'), findsOneWidget);
    expect(find.text('Nova enquete'), findsOneWidget);
  });

  testWidgets('opens documents area', (WidgetTester tester) async {
    await _openFeature(tester, 'Documentos');

    expect(find.text('Documentos'), findsWidgets);
    expect(find.text('Upload de'), findsOneWidget);
    expect(find.text('Regimento interno'), findsOneWidget);
    expect(find.text('Atas'), findsOneWidget);
    await _scrollToText(tester, 'Download');
    expect(find.text('Organização por categoria'), findsOneWidget);
    expect(find.text('Download'), findsOneWidget);
  });

  testWidgets('internal market shows condominium and residents tabs', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: InternalMarketPage(
          condoId: 1,
          userId: 1,
          userRole: CondoUserRoles.resident,
        ),
      ),
    );
    await tester.pumpAndSettle(const Duration(seconds: 15));

    expect(find.text('Mercado Interno'), findsOneWidget);
    expect(find.text('Condomínio'), findsWidgets);
    expect(find.text('Moradores'), findsWidgets);
  });

  testWidgets('events calendar shows resident read-only (API stub)', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: EventsCalendarPage(
          condoId: 1,
          userId: 1,
          userRole: CondoUserRoles.resident,
        ),
      ),
    );
    await tester.pumpAndSettle(const Duration(seconds: 15));

    expect(find.text('Calendário de Eventos'), findsOneWidget);
    expect(find.text('Tentar novamente'), findsOneWidget);
    expect(find.text('Novo evento'), findsNothing);
  });

  testWidgets('events calendar shows FAB for syndic (API stub)', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: EventsCalendarPage(
          condoId: 1,
          userId: 1,
          userRole: CondoUserRoles.syndic,
        ),
      ),
    );
    await tester.pumpAndSettle(const Duration(seconds: 15));

    expect(find.text('Novo evento'), findsOneWidget);
    expect(find.text('Tentar novamente'), findsOneWidget);
  });

  testWidgets('opens service guide area', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ServiceGuidePage(
          condoId: 1,
          userId: 1,
          userRole: CondoUserRoles.syndic,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Guia de Serviços'), findsOneWidget);
    expect(find.text('Visão geral'), findsOneWidget);
    expect(find.text('Para unidades'), findsWidgets);
    expect(find.text('Para o condomínio'), findsWidgets);
  });

  testWidgets('opens lost and found area', (WidgetTester tester) async {
    await _openFeature(tester, 'Achados e Perdidos');

    expect(find.text('Achados e Perdidos'), findsWidgets);
    expect(find.text('Itens perdidos (em aberto)'), findsOneWidget);
    expect(find.text('Item perdido'), findsOneWidget);
  });

  testWidgets('opens contacts area', (WidgetTester tester) async {
    await _openFeature(tester, 'Contatos');

    expect(find.text('Contatos'), findsWidgets);
    expect(find.text('Lista de'), findsOneWidget);
    expect(find.text('Síndico'), findsOneWidget);
    expect(find.text('Porteiros'), findsOneWidget);
    expect(find.text('Emergência'), findsOneWidget);
    await _scrollToText(tester, 'Clique para ligar/WhatsApp');
    expect(find.text('Clique para ligar/WhatsApp'), findsOneWidget);
  });

  testWidgets('opens employees board area', (WidgetTester tester) async {
    await _openFeature(tester, 'Quadro de Colaboradores');

    expect(find.text('Quadro de Colaboradores'), findsWidgets);
    expect(find.text('Lista de funcionários'), findsOneWidget);
    expect(find.text('Nome'), findsOneWidget);
    expect(find.text('Função'), findsOneWidget);
    expect(find.text('Foto'), findsOneWidget);
    await _scrollToText(tester, 'Escala (opcional)');
    expect(find.text('Escala (opcional)'), findsOneWidget);
  });

  testWidgets('opens pets registry area', (WidgetTester tester) async {
    await _openFeature(tester, 'Animais de Estimação com foto');

    expect(find.text('Animais de Estimação'), findsOneWidget);
    expect(find.text('Cadastro de pets'), findsOneWidget);
    expect(find.text('Nome'), findsOneWidget);
    expect(find.text('Foto'), findsOneWidget);
    expect(find.text('Tipo/raça'), findsOneWidget);
    await _scrollToText(tester, 'Controle');
    expect(find.text('Vinculação à unidade'), findsOneWidget);
    expect(find.text('Controle'), findsOneWidget);
  });
}

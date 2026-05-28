import {
  canOpenAdministrationHub,
  isBillingStaff,
  isOperationalStaff,
  isPlatformAdmin,
  CondoUserRoles,
} from './condoUserRoles';

export type HomeFeatureDef = {
  /** Etiqueta igual ao app móvel (para filtros e mensagens). */
  label: string;
  /** Ícone aproximado ao Material (emoji único). */
  icon: string;
  /**
   * Caminho da rota sob `/app` (sem barras), quando o módulo já existe na web.
   * Evita depender só da comparação de strings do rótulo (Unicode / grafia).
   */
  webAppPath?: string;
};

/** Mesma ordem e rótulos que `HomePage._features` em `lib/main.dart`. */
export const HOME_FEATURE_LIST: HomeFeatureDef[] = [
  { label: 'Área do Síndico', icon: '🏛️', webAppPath: 'sindico' },
  { label: 'Cadastro de condomínios', icon: '📝', webAppPath: 'cadastro-condominios' },
  { label: 'Administração', icon: '🏢', webAppPath: 'administracao' },
  { label: 'Minha Unidade', icon: '🏠', webAppPath: 'minha-unidade' },
  { label: 'Controle de Acesso', icon: '🪪', webAppPath: 'controle-acesso' },
  { label: 'Boleto Online', icon: '🧾', webAppPath: 'boleto-online' },
  { label: 'Ofertas', icon: '🏷️', webAppPath: 'ofertas' },
  { label: 'Fale com o Condomínio', icon: '💬', webAppPath: 'fale-condominio' },
  { label: 'Reservas de Espaço', icon: '📅', webAppPath: 'reservas' },
  { label: 'Mural de Avisos', icon: '📣', webAppPath: 'mural-avisos' },
  { label: 'Comunicados Individuais', icon: '✉️', webAppPath: 'comunicados-individuais' },
  { label: 'Solicitar Manutenção', icon: '🔧', webAppPath: 'manutencoes' },
  { label: 'Emergência', icon: '🚨', webAppPath: 'emergencia' },
  { label: 'Encomendas', icon: '📦', webAppPath: 'encomendas' },
  { label: 'Assembleias Virtuais', icon: '👥', webAppPath: 'assembleias-virtuais' },
  { label: 'Videoconferência', icon: '📹', webAppPath: 'videoconferencia' },
  { label: 'Enquetes e Votações', icon: '🗳️', webAppPath: 'enquetes' },
  { label: 'Documentos', icon: '📂', webAppPath: 'documentos' },
  { label: 'Mercado Interno', icon: '🏪', webAppPath: 'mercado-interno' },
  { label: 'Calendário de Eventos', icon: '🗓️', webAppPath: 'calendario-eventos' },
  { label: 'Guia de Serviços', icon: '🛎️', webAppPath: 'guia-servicos' },
  { label: 'Achados e Perdidos', icon: '🔍', webAppPath: 'achados-perdidos' },
  { label: 'Livro de Reclamações', icon: '📖', webAppPath: 'livro-reclamacoes' },
  { label: 'Contatos', icon: '👤', webAppPath: 'contatos' },
  { label: 'Quadro de Colaboradores', icon: '👷', webAppPath: 'quadro-colaboradores' },
  { label: 'Passagem de Turno', icon: '🔁', webAppPath: 'passagem-turno' },
  { label: 'Animais de Estimação com foto', icon: '🐾', webAppPath: 'animais-estimacao' },
];

/** Parceiros só veem estes módulos na home e nas rotas sob `/app` (alinhado ao produto). */
const PARTNER_VISIBLE_LABELS = new Set([
  'Ofertas',
  'Documentos',
  'Calendário de Eventos',
  'Guia de Serviços',
  'Contatos',
  'Fale com o Condomínio',
]);

/** Caminhos permitidos para `role === partner` dentro de `/app` (inclui sub-rotas quando existirem). */
export function isPartnerAllowedAppPath(pathname: string): boolean {
  const norm = pathname.replace(/\/+$/, '') || '/app';
  if (norm === '/app') {
    return true;
  }
  const allowed = HOME_FEATURE_LIST.filter(
    (f) => PARTNER_VISIBLE_LABELS.has(f.label) && f.webAppPath,
  ).map((f) => `/app/${f.webAppPath!.replace(/^\//, '')}`);
  return allowed.some((p) => norm === p || norm.startsWith(`${p}/`));
}

export function isHomeFeatureVisible(
  label: string,
  role: string,
  unitId: number | null,
): boolean {
  if (role === CondoUserRoles.partner) {
    return PARTNER_VISIBLE_LABELS.has(label);
  }
  switch (label) {
    case 'Área do Síndico':
      return role === CondoUserRoles.syndic;
    case 'Administração':
      return canOpenAdministrationHub(role);
    case 'Minha Unidade':
      return unitId != null;
    case 'Boleto Online':
      return unitId != null || isBillingStaff(role);
    case 'Encomendas':
      return unitId != null || isOperationalStaff(role);
    case 'Livro de Reclamações':
      return unitId != null || isOperationalStaff(role);
    case 'Cadastro de condomínios':
      return isPlatformAdmin(role);
    case 'Passagem de Turno':
      return isOperationalStaff(role);
    default:
      return true;
  }
}

export function homeFeaturesForUser(
  role: string,
  unitId: number | null,
): HomeFeatureDef[] {
  return HOME_FEATURE_LIST.filter((f) =>
    isHomeFeatureVisible(f.label, role, unitId),
  );
}

/** Rótulo do card (ex.: manutenção para equipa). */
export function displayLabelForFeature(
  label: string,
  role: string,
): string | null {
  if (
    label === 'Solicitar Manutenção' &&
    isOperationalStaff(role)
  ) {
    return 'Manutenções solicitadas';
  }
  return null;
}

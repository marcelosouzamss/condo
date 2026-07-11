/** Rótulos dos cards da home (alinhado ao app móvel e portal web). */
export const HOME_FEATURE_LABELS = [
  'Área do Síndico',
  'Cadastro de condomínios',
  'Administração',
  'Minha Unidade',
  'Controle de Acesso',
  'Boleto Online',
  'Ofertas',
  'Fale com o Condomínio',
  'Reservas de Espaço',
  'Mural de Avisos',
  'Comunicados Individuais',
  'Solicitar Manutenção',
  'Emergência',
  'Encomendas',
  'Assembleias Virtuais',
  'Videoconferência',
  'Enquetes e Votações',
  'Documentos',
  'Mercado Interno',
  'Calendário de Eventos',
  'Guia de Serviços',
  'Achados e Perdidos',
  'Livro de Reclamações',
  'Contatos',
  'Quadro de Colaboradores',
  'Passagem de Turno',
  'Animais de Estimação com foto',
] as const;

const LABEL_SET = new Set<string>(HOME_FEATURE_LABELS);

export const HOME_STYLE_PRESETS = new Set(['diurno', 'noturno', 'blue', 'green']);

export function sanitizeFeatureOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const label = String(item ?? '').trim();
    if (!label || !LABEL_SET.has(label) || seen.has(label)) {
      continue;
    }
    seen.add(label);
    out.push(label);
  }
  return out;
}

export function parseGridColumns(raw: unknown): number | null {
  const n = Number(raw);
  if (n === 2 || n === 3 || n === 4) {
    return n;
  }
  return null;
}

export function parseStylePreset(raw: unknown): string | null {
  const v = String(raw ?? '').trim().toLowerCase();
  return HOME_STYLE_PRESETS.has(v) ? v : null;
}

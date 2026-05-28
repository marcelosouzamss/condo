import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import './App.css';

type Feature = {
  icon: string;
  title: string;
  description: string;
};

const FEATURES: Feature[] = [
  {
    icon: '🏛️',
    title: 'Área do síndico e administração',
    description:
      'Painel operacional, relatórios, avisos, cobrança e configurações do condomínio.',
  },
  {
    icon: '🏠',
    title: 'Minha unidade',
    description:
      'Dados do apartamento, moradores, veículos e histórico da unidade.',
  },
  {
    icon: '🎫',
    title: 'Boleto online',
    description:
      'Consulta e acesso a boletos conforme perfil da unidade ou equipe de cobrança.',
  },
  {
    icon: '📢',
    title: 'Mural e comunicados',
    description:
      'Avisos gerais, comunicados individuais e canal com a administração.',
  },
  {
    icon: '📅',
    title: 'Reservas e calendário',
    description:
      'Espaços comuns, eventos e fluxos de aprovação quando aplicável.',
  },
  {
    icon: '🔧',
    title: 'Manutenção e ocorrências',
    description:
      'Solicitações por unidade e gestão pela equipe e pelo síndico.',
  },
  {
    icon: '📦',
    title: 'Encomendas e controle de acesso',
    description:
      'Entregas, visitantes e prestadores conforme as regras do condomínio.',
  },
  {
    icon: '🛒',
    title: 'Ofertas e guia de serviços',
    description: 'Parcerias, cupons e prestadores com contatos e portfólio.',
  },
  {
    icon: '📄',
    title: 'Documentos',
    description: 'Regulamentos, atas e arquivos com controle de acesso.',
  },
  {
    icon: '🗳️',
    title: 'Enquetes e assembleias',
    description: 'Votações e participação em assembleias virtuais.',
  },
  {
    icon: '🎥',
    title: 'Videoconferência',
    description: 'Salas de reunião integradas para a comunidade.',
  },
  {
    icon: '🐕',
    title: 'Comunidade',
    description:
      'Achados e perdidos, pets, quadro de colaboradores e mercado interno.',
  },
];

function useLoginHref(): string {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('login')?.trim();
    if (fromQuery) {
      return fromQuery;
    }
    const fromEnv = import.meta.env.VITE_LOGIN_URL?.trim();
    if (fromEnv) {
      return fromEnv;
    }
    return '/login';
  }, []);
}

function LoginCta({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const external = /^https?:\/\//i.test(href) || href.startsWith('//');
  if (external) {
    return (
      <a className={className} href={href}>
        {children}
      </a>
    );
  }
  return (
    <Link className={className} to={href}>
      {children}
    </Link>
  );
}

const CARGO_OPTIONS = [
  { value: '', label: 'Cargo' },
  { value: 'sindico', label: 'Síndico' },
  { value: 'administrador', label: 'Administrador' },
  { value: 'gerente', label: 'Gerente / Coordenador' },
  { value: 'comercial', label: 'Comercial' },
  { value: 'outro', label: 'Outro' },
];

const CARTEIRA_OPTIONS = [
  { value: '', label: 'Carteira de Condomínios' },
  { value: '1-5', label: '1 a 5' },
  { value: '6-20', label: '6 a 20' },
  { value: '21-50', label: '21 a 50' },
  { value: '51-100', label: '51 a 100' },
  { value: '100+', label: 'Mais de 100' },
];

type LeadFormState = {
  nome: string;
  sobrenome: string;
  email: string;
  telefone: string;
  empresa: string;
  cargo: string;
  carteira: string;
  aceitoTermos: boolean;
};

const initialLeadForm: LeadFormState = {
  nome: '',
  sobrenome: '',
  email: '',
  telefone: '',
  empresa: '',
  cargo: '',
  carteira: '',
  aceitoTermos: false,
};

type FaqItemData = {
  question: string;
  answer: string;
};

const FAQ_ITEMS: FaqItemData[] = [
  {
    question: 'Como funciona a demonstração do sistema?',
    answer:
      'Agendamos uma sessão online com sua equipe, mostramos os fluxos do morador, do síndico e da administração e tiramos dúvidas. Não é necessário instalar nada para a primeira conversa.',
  },
  {
    question: 'Qual o valor do sistema?',
    answer:
      'O investimento varia conforme porte da carteira, módulos ativos e número de unidades. Envie seus dados pelo formulário de contato para receber uma proposta alinhada ao seu perfil.',
  },
  {
    question: 'Tem aplicativo para morador?',
    answer:
      'Sim. Os moradores acessam pelo aplicativo (Android e iOS) com funcionalidades como boletos, reservas, comunicados e ocorrências, conforme as permissões definidas pelo condomínio.',
  },
  {
    question: 'O Condo App é uma administradora?',
    answer:
      'Não. Somos uma plataforma de software para administradoras e condomínios. Quem presta o serviço de administração continua sendo a empresa ou o síndico; o app organiza rotinas e comunicação.',
  },
  {
    question: 'O que é o Condo App?',
    answer:
      'É o ecossistema digital do condomínio: comunicação, áreas do morador e da gestão, financeiro (conforme configuração), reservas, manutenção e parcerias, com papéis e permissões por perfil.',
  },
  {
    question: 'Como contratar o sistema?',
    answer:
      'Preencha o formulário de demonstração ou fale com nosso time. Após alinhar escopo e condições comerciais, seguimos com implantação, treinamento e suporte.',
  },
];

function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function toggle(idx: number) {
    setOpenIndex((current) => (current === idx ? null : idx));
  }

  return (
    <section className="faq-section" id="duvidas" aria-labelledby="faq-title">
      <div className="faq-inner">
        <h2 id="faq-title" className="faq-title">
          Tire suas dúvidas
        </h2>
        <p className="faq-sub">
          Respondemos as principais questões sobre o Condo App.
        </p>
        <ul className="faq-list">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = openIndex === idx;
            const panelId = `faq-panel-${idx}`;
            const headerId = `faq-header-${idx}`;
            return (
              <li key={item.question} className="faq-item">
                <button
                  type="button"
                  id={headerId}
                  className="faq-trigger"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(idx)}
                >
                  <span className="faq-question-text">{item.question}</span>
                  <span
                    className={`faq-chevron${isOpen ? ' faq-chevron--open' : ''}`}
                    aria-hidden
                  />
                </button>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={headerId}
                  aria-hidden={!isOpen}
                  className={`faq-panel${isOpen ? ' faq-panel--open' : ''}`}
                >
                  <p className="faq-answer">{item.answer}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function DemoLeadSection() {
  const [form, setForm] = useState<LeadFormState>(initialLeadForm);
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.aceitoTermos) {
      window.alert('É necessário aceitar os termos e a política de privacidade.');
      return;
    }
    if (!form.email.trim() || !form.nome.trim()) {
      window.alert('Preencha pelo menos nome e e-mail.');
      return;
    }
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 5000);
    setForm(initialLeadForm);
  }

  return (
    <section className="lead-section" id="demonstracao">
      <div className="lead-inner">
        <div className="lead-copy">
          <div className="lead-copy-accent" aria-hidden />
          <h2 className="lead-heading">
            De pequenas a grandes administradoras, planos sob medida para cada
            perfil
          </h2>
          <p className="lead-sub">Agende uma demonstração gratuita</p>
        </div>
        <div className="lead-card-wrap">
          <form className="lead-form" onSubmit={handleSubmit} noValidate>
            <div className="lead-form-row lead-form-row--2">
              <input
                type="text"
                name="nome"
                placeholder="Nome"
                autoComplete="given-name"
                value={form.nome}
                onChange={(e) =>
                  setForm((s) => ({ ...s, nome: e.target.value }))
                }
              />
              <input
                type="text"
                name="sobrenome"
                placeholder="Sobrenome"
                autoComplete="family-name"
                value={form.sobrenome}
                onChange={(e) =>
                  setForm((s) => ({ ...s, sobrenome: e.target.value }))
                }
              />
            </div>
            <div className="lead-form-row">
              <input
                type="email"
                name="email"
                placeholder="E-mail"
                autoComplete="email"
                value={form.email}
                onChange={(e) =>
                  setForm((s) => ({ ...s, email: e.target.value }))
                }
              />
            </div>
            <div className="lead-form-row lead-form-row--2">
              <input
                type="tel"
                name="telefone"
                placeholder="Telefone"
                autoComplete="tel"
                value={form.telefone}
                onChange={(e) =>
                  setForm((s) => ({ ...s, telefone: e.target.value }))
                }
              />
              <input
                type="text"
                name="empresa"
                placeholder="Nome da Empresa"
                autoComplete="organization"
                value={form.empresa}
                onChange={(e) =>
                  setForm((s) => ({ ...s, empresa: e.target.value }))
                }
              />
            </div>
            <div className="lead-form-row lead-form-row--2">
              <select
                name="cargo"
                value={form.cargo}
                onChange={(e) =>
                  setForm((s) => ({ ...s, cargo: e.target.value }))
                }
                aria-label="Cargo"
              >
                {CARGO_OPTIONS.map((o, i) => (
                  <option key={`cargo-${i}`} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                name="carteira"
                value={form.carteira}
                onChange={(e) =>
                  setForm((s) => ({ ...s, carteira: e.target.value }))
                }
                aria-label="Carteira de condomínios"
              >
                {CARTEIRA_OPTIONS.map((o, i) => (
                  <option key={`carteira-${i}`} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="lead-consent">
              <input
                type="checkbox"
                checked={form.aceitoTermos}
                onChange={(e) =>
                  setForm((s) => ({ ...s, aceitoTermos: e.target.checked }))
                }
              />
              <span>
                Li e concordo com os{' '}
                <a href="#termos" className="lead-link">
                  Termos de uso
                </a>{' '}
                e{' '}
                <a href="#privacidade" className="lead-link">
                  Política de privacidade
                </a>
              </span>
            </label>
            <button type="submit" className="lead-submit">
              Solicite contato
            </button>
            {submitted && (
              <p className="lead-success" role="status">
                Obrigado! Em breve entraremos em contato.
              </p>
            )}
          </form>
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ icon, title, description }: Feature) {
  return (
    <article className="card">
      <div className="card-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}

export function LandingPage() {
  const loginHref = useLoginHref();

  return (
    <>
      <header className="hero">
        <div className="hero-inner">
          <div>
            <span className="badge">Condomínio digital</span>
            <h1>Tudo o que o seu condomínio precisa, num só app</h1>
            <p className="lead">
              Comunicação, financeiro, reservas, manutenção e parcerias —
              moradores, síndico e administração conectados com segurança e
              praticidade.
            </p>
            <div className="hero-actions">
              <LoginCta className="btn btn-primary" href={loginHref}>
                Entrar
              </LoginCta>
              <a className="btn btn-ghost" href="#funcionalidades">
                Ver funcionalidades
              </a>
              <a className="btn btn-ghost" href="/folheto">
                Folheto CondoLM
              </a>
            </div>
          </div>
          <div className="hero-visual" aria-hidden>
            <div className="phone-mock">
              <div className="phone-screen">
                <div className="mock-row w-60" />
                <div className="mock-row w-80" />
                <div className="mock-tiles">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="mock-tile" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main>
        <section id="funcionalidades">
          <h2 className="section-title">Funcionalidades principais</h2>
          <p className="section-sub">
            O mesmo ecossistema do aplicativo: atalhos organizados, papéis por
            perfil (morador, síndico, parceiro, equipe) e evolução contínua.
          </p>
          <div className="grid">
            {FEATURES.map((f) => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </div>
        </section>

        <DemoLeadSection />

        <FaqSection />

        <section className="cta-bar" aria-labelledby="cta-title">
          <h2 id="cta-title">Pronto para entrar?</h2>
          <p>Acesse com sua conta do condomínio na tela de login.</p>
          <LoginCta className="btn btn-primary cta-btn" href={loginHref}>
            Ir para o login
          </LoginCta>
        </section>
      </main>

      <footer className="footer">
        <p>
          <strong>Condo App</strong> · gestão e comunicação para condomínios
        </p>
      </footer>
    </>
  );
}

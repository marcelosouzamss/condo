import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CondoUserRoles, isOperationalStaff, picksCondoBeforeContact } from '../condoUserRoles';
import { getCondosForContactPicker, type CondoPickerRow } from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const CH_SYNDIC = 'syndic';
const CH_ADMIN = 'administration';
const CH_DOORMAN = 'doorman';
const CH_COLLABORATOR = 'collaborator';

export function ContactCondoHubPage() {
  const session = useStaffSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const staffPick = session ? picksCondoBeforeContact(session.role) : false;
  const operationalInbox = session ? isOperationalStaff(session.role) && !staffPick : false;

  const [condos, setCondos] = useState<CondoPickerRow[] | null>(null);
  const [condoErr, setCondoErr] = useState<string | null>(null);
  const [loadingCondos, setLoadingCondos] = useState(false);

  const condoIdRaw = searchParams.get('condoId');
  const selectedCondoId =
    condoIdRaw != null && String(condoIdRaw).trim() !== ''
      ? Number.parseInt(condoIdRaw, 10)
      : null;

  useEffect(() => {
    if (!session || !staffPick) {
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingCondos(true);
      setCondoErr(null);
      try {
        const list = await getCondosForContactPicker(session.id);
        if (!cancelled) {
          setCondos(list);
        }
      } catch (e) {
        if (!cancelled) {
          setCondos(null);
          setCondoErr(e instanceof Error ? e.message : 'Erro ao listar condomínios.');
        }
      } finally {
        if (!cancelled) {
          setLoadingCondos(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, staffPick]);

  if (!session) {
    return null;
  }

  if (staffPick || operationalInbox) {
    if (loadingCondos && !condos) {
      return (
        <StaffLayout title="Fale com o Condomínio" backTo="/app">
          <p>A carregar condomínios…</p>
        </StaffLayout>
      );
    }
    if (condoErr) {
      return (
        <StaffLayout title="Fale com o Condomínio" backTo="/app">
          <p className="staff-error">{condoErr}</p>
          <button type="button" className="portal-btn" onClick={() => navigate(0)}>
            Tentar novamente
          </button>
        </StaffLayout>
      );
    }

    const effectiveSelectedCondoId = operationalInbox ? session.condoId : selectedCondoId;

    if (
      effectiveSelectedCondoId == null ||
      !Number.isFinite(effectiveSelectedCondoId) ||
      effectiveSelectedCondoId < 1
    ) {
      const isPartner = session.role === CondoUserRoles.partner;
      return (
        <StaffLayout title="Fale com o Condomínio" backTo="/app">
          <div className="staff-hero">
            <h2>Escolha o condomínio</h2>
            <p>
              {isPartner ? (
                <>
                  Selecione primeiro o condomínio com o qual deseja falar; em seguida poderá escolher síndico,
                  administração, portaria ou colaborador.
                </>
              ) : (
                <>
                  Igual ao app: síndico, administração, parceiros e admin da plataforma escolhem o condomínio para
                  atender.
                </>
              )}
            </p>
          </div>
          {!condos || condos.length === 0 ? (
            <p className="staff-muted">Nenhum condomínio cadastrado.</p>
          ) : (
            <ul className="staff-list">
              {condos.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="portal-offer-head"
                    onClick={() => navigate(`/app/fale-condominio?condoId=${c.id}`)}
                  >
                    <span>
                      <strong>{c.name}</strong>
                      <span className="staff-muted" style={{ marginLeft: 8 }}>
                        ID {c.id}
                      </span>
                    </span>
                    <span>→</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </StaffLayout>
      );
    }

    const sel = operationalInbox
      ? { id: session.condoId, name: 'Condomínio' }
      : condos?.find((c) => c.id === effectiveSelectedCondoId);
    const isPartner = session.role === CondoUserRoles.partner;

    if (isPartner) {
      return (
        <StaffLayout title="Fale com o Condomínio" backTo="/app">
          <p className="staff-muted" style={{ marginBottom: 12 }}>
            <button type="button" className="portal-link" onClick={() => navigate('/app/fale-condominio')}>
              ← Escolher outro condomínio
            </button>
          </p>
          <div className="staff-hero">
            <h2>{sel?.name ?? `Condomínio #${effectiveSelectedCondoId}`}</h2>
            <p>Com quem deseja falar neste condomínio?</p>
          </div>
          <Link
            className="staff-card"
            to={`/app/fale-condominio/parceiro/chat/${CH_SYNDIC}?condoId=${effectiveSelectedCondoId}`}
          >
            <span className="staff-card__icon" aria-hidden>
              🏛️
            </span>
            <span className="staff-card__body">
              <strong>Síndico</strong>
              <span>Mensagens sobre alinhamentos e decisões do condomínio</span>
            </span>
            <span className="staff-card__action">Conversar</span>
          </Link>
          <Link
            className="staff-card"
            to={`/app/fale-condominio/parceiro/chat/${CH_ADMIN}?condoId=${effectiveSelectedCondoId}`}
          >
            <span className="staff-card__icon" aria-hidden>
              🏢
            </span>
            <span className="staff-card__body">
              <strong>Administração</strong>
              <span>Contratos, operação e outros assuntos administrativos</span>
            </span>
            <span className="staff-card__action">Conversar</span>
          </Link>
          <Link
            className="staff-card"
            to={`/app/fale-condominio/parceiro/chat/${CH_DOORMAN}?condoId=${effectiveSelectedCondoId}`}
          >
            <span className="staff-card__icon" aria-hidden>
              🛎️
            </span>
            <span className="staff-card__body">
              <strong>Portaria</strong>
              <span>Recepção, acesso, visitantes e encomendas</span>
            </span>
            <span className="staff-card__action">Conversar</span>
          </Link>
          <Link
            className="staff-card"
            to={`/app/fale-condominio/parceiro/chat/${CH_COLLABORATOR}?condoId=${effectiveSelectedCondoId}`}
          >
            <span className="staff-card__icon" aria-hidden>
              👷
            </span>
            <span className="staff-card__body">
              <strong>Colaborador</strong>
              <span>Apoio operacional, manutenção e rotinas do condomínio</span>
            </span>
            <span className="staff-card__action">Conversar</span>
          </Link>
        </StaffLayout>
      );
    }

    return (
      <StaffLayout title="Fale com o Condomínio" backTo="/app">
        <p className="staff-muted" style={{ marginBottom: 12 }}>
          {staffPick ? (
            <button type="button" className="portal-link" onClick={() => navigate('/app/fale-condominio')}>
              ← Escolher outro condomínio
            </button>
          ) : null}
        </p>
        <div className="staff-hero">
          <h2>{sel?.name ?? `Condomínio #${effectiveSelectedCondoId}`}</h2>
          <p>Caixas de entrada da equipa para este condomínio.</p>
        </div>
        <Link className="staff-card" to={`/app/fale-condominio/inbox/${CH_SYNDIC}?condoId=${effectiveSelectedCondoId}`}>
          <span className="staff-card__icon" aria-hidden>
            🏛️
          </span>
          <span className="staff-card__body">
            <strong>Síndico</strong>
            <span>Filas de atendimento e respostas por unidade</span>
          </span>
          <span className="staff-card__action">Abrir</span>
        </Link>
        <Link className="staff-card" to={`/app/fale-condominio/inbox/${CH_ADMIN}?condoId=${effectiveSelectedCondoId}`}>
          <span className="staff-card__icon" aria-hidden>
            🏢
          </span>
          <span className="staff-card__body">
            <strong>Administração</strong>
            <span>Demandas administrativas e operacionais</span>
          </span>
          <span className="staff-card__action">Abrir</span>
        </Link>
        <Link className="staff-card" to={`/app/fale-condominio/inbox/${CH_DOORMAN}?condoId=${effectiveSelectedCondoId}`}>
          <span className="staff-card__icon" aria-hidden>
            🛎️
          </span>
          <span className="staff-card__body">
            <strong>Portaria</strong>
            <span>Atendimentos de recepção, acesso e encomendas</span>
          </span>
          <span className="staff-card__action">Abrir</span>
        </Link>
        <Link className="staff-card" to={`/app/fale-condominio/inbox/${CH_COLLABORATOR}?condoId=${effectiveSelectedCondoId}`}>
          <span className="staff-card__icon" aria-hidden>
            👷
          </span>
          <span className="staff-card__body">
            <strong>Colaborador</strong>
            <span>Demandas operacionais enviadas pelos moradores</span>
          </span>
          <span className="staff-card__action">Abrir</span>
        </Link>
      </StaffLayout>
    );
  }

  if (session.unitId == null) {
    return (
      <StaffLayout title="Fale com o Condomínio" backTo="/app">
        <p className="staff-banner">
          Não foi possível identificar a sua unidade. Associe a unidade ao seu login (como em «Minha Unidade» no
          aplicativo).
        </p>
      </StaffLayout>
    );
  }

  return (
    <StaffLayout title="Fale com o Condomínio" backTo="/app">
      <div className="staff-hero">
        <h2>Central de relacionamento</h2>
        <p>Converse com a equipa do condomínio pelos mesmos canais do app móvel.</p>
      </div>
      <Link className="staff-card" to={`/app/fale-condominio/chat/${CH_SYNDIC}`}>
        <span className="staff-card__icon" aria-hidden>
          🏛️
        </span>
        <span className="staff-card__body">
          <strong>Síndico</strong>
          <span>Decisões, avisos e alinhamentos</span>
        </span>
        <span className="staff-card__action">Conversar</span>
      </Link>
      <Link className="staff-card" to={`/app/fale-condominio/chat/${CH_ADMIN}`}>
        <span className="staff-card__icon" aria-hidden>
          🏢
        </span>
        <span className="staff-card__body">
          <strong>Administração</strong>
          <span>Boletos, cadastro e suporte operacional</span>
        </span>
        <span className="staff-card__action">Conversar</span>
      </Link>
      <Link className="staff-card" to={`/app/fale-condominio/chat/${CH_DOORMAN}`}>
        <span className="staff-card__icon" aria-hidden>
          🛎️
        </span>
        <span className="staff-card__body">
          <strong>Portaria</strong>
          <span>Entrada, visitantes, acesso e encomendas</span>
        </span>
        <span className="staff-card__action">Conversar</span>
      </Link>
      <Link className="staff-card" to={`/app/fale-condominio/chat/${CH_COLLABORATOR}`}>
        <span className="staff-card__icon" aria-hidden>
          👷
        </span>
        <span className="staff-card__body">
          <strong>Colaborador</strong>
          <span>Manutenção, apoio operacional e rotinas do condomínio</span>
        </span>
        <span className="staff-card__action">Conversar</span>
      </Link>
    </StaffLayout>
  );
}

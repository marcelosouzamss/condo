import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchCondoHomeLayout, saveCondoHomeLayout, type CondoHomeLayout } from './condoHomeLayoutApi';
import { canManageCondoHomeLayout, isOperationalStaff, labelPt } from './condoUserRoles';
import { displayLabelForFeature, HOME_FEATURE_LIST, homeFeaturesForUser, type HomeFeatureDef } from './homeFeatures';
import {
  applyHomeFeatureOrder,
  clearPersonalHomeFeatureOrder,
  normalizeHomeFeatureOrder,
  readPersonalHomeFeatureOrder,
  reorderHomeFeatureLabels,
  writePersonalHomeFeatureOrder,
} from './homeFeatureOrder';
import {
  listEmergencyIncidents,
  listParcelDeliveries,
  listPolls,
  listResidentMaintenanceRequests,
  listSyndicMaintenanceRequests,
} from './portalApi';
import { logoutWebSession } from './jsonHttp';
import { loadWebUserSession } from './webSession';
import './AppHomePage.css';

function searchKey(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function dismissedAlertsKey(condoId: number, userId: number): string {
  return `condo_feature_alert_dismissed_v1_${condoId}_${userId}`;
}

function readDismissedAlerts(condoId: number, userId: number): Record<string, number> {
  try {
    const raw = localStorage.getItem(dismissedAlertsKey(condoId, userId));
    if (!raw) {
      return {};
    }
    const decoded = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(decoded)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeDismissedAlerts(condoId: number, userId: number, values: Record<string, number>): void {
  localStorage.setItem(dismissedAlertsKey(condoId, userId), JSON.stringify(values));
}

function notificationSubtitle(label: string, count: number): string {
  switch (label) {
    case 'Emergência':
      return count === 1 ? '1 ocorrência aberta' : `${count} ocorrências abertas`;
    case 'Encomendas':
      return count === 1
        ? '1 encomenda aguardando retirada'
        : `${count} encomendas aguardando retirada`;
    case 'Solicitar Manutenção':
      return count === 1 ? '1 solicitação pendente' : `${count} solicitações pendentes`;
    case 'Enquetes e Votações':
      return count === 1 ? '1 enquete aberta' : `${count} enquetes abertas`;
    default:
      return count === 1 ? '1 item pendente' : `${count} itens pendentes`;
  }
}

export function AppHomePage() {
  const navigate = useNavigate();
  const [session] = useState(() => loadWebUserSession()!);
  const [toast, setToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [alertCounts, setAlertCounts] = useState<Record<string, number>>({});
  const [dismissedAlertCounts, setDismissedAlertCounts] = useState<Record<string, number>>(() =>
    readDismissedAlerts(session.condoId, session.id),
  );
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [condoLayout, setCondoLayout] = useState<CondoHomeLayout | null>(null);
  const [personalFeatureOrder, setPersonalFeatureOrder] = useState<string[]>(() =>
    readPersonalHomeFeatureOrder(session.condoId, session.id),
  );
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null);
  const [dropTargetLabel, setDropTargetLabel] = useState<string | null>(null);

  const canEditCondoLayout =
    condoLayout?.canEdit === true || canManageCondoHomeLayout(session.role);
  const canPersonalizeOrder =
    !canEditCondoLayout && (condoLayout?.allowResidentOrderOverride ?? true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const layout = await fetchCondoHomeLayout(session.condoId, session.id);
      if (!cancelled) {
        setCondoLayout(layout);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.condoId, session.id]);

  const onFeatureClick = useCallback(
    (feature: HomeFeatureDef) => {
      const count = alertCounts[feature.label] ?? 0;
      if (count > 0) {
        const nextDismissed = {
          ...dismissedAlertCounts,
          [feature.label]: count,
        };
        setDismissedAlertCounts(nextDismissed);
        setAlertCounts((current) => {
          const next = { ...current };
          delete next[feature.label];
          return next;
        });
        writeDismissedAlerts(session.condoId, session.id, nextDismissed);
      }
      const path = feature.webAppPath?.trim();
      if (path) {
        navigate(`/app/${path}`);
        return;
      }
      setToast(
        `"${feature.label}" — módulo web em preparação. Utilize o app móvel Condo App para esta função.`,
      );
      window.setTimeout(() => setToast(null), 5200);
    },
    [alertCounts, dismissedAlertCounts, navigate, session.condoId, session.id],
  );

  const features = useMemo(
    () => homeFeaturesForUser(session.role, session.unitId),
    [session.role, session.unitId],
  );

  const filteredFeatures = useMemo(() => {
    const query = searchKey(searchQuery);
    if (!query) {
      return features;
    }
    return features.filter((feature) => {
      const label = displayLabelForFeature(feature.label, session.role) ?? feature.label;
      return searchKey(label).includes(query);
    });
  }, [features, searchQuery, session.role]);

  const canReorderCards =
    searchQuery.trim().length === 0 && (canEditCondoLayout || canPersonalizeOrder);

  const effectiveFeatureOrder = useMemo(() => {
    const labels = features.map((feature) => feature.label);
    const base = condoLayout?.featureOrder ?? [];
    if (canEditCondoLayout) {
      return normalizeHomeFeatureOrder(base, labels);
    }
    if (personalFeatureOrder.length > 0 && condoLayout?.allowResidentOrderOverride !== false) {
      return normalizeHomeFeatureOrder(personalFeatureOrder, labels);
    }
    return normalizeHomeFeatureOrder(base, labels);
  }, [canEditCondoLayout, condoLayout, features, personalFeatureOrder]);

  const orderedFeatures = useMemo(() => {
    return applyHomeFeatureOrder(filteredFeatures, effectiveFeatureOrder);
  }, [filteredFeatures, effectiveFeatureOrder]);

  const onCardDragStart = useCallback((label: string) => {
    setDraggingLabel(label);
  }, []);

  const onCardDragEnd = useCallback(() => {
    setDraggingLabel(null);
    setDropTargetLabel(null);
  }, []);

  const onCardDrop = useCallback(
    (targetLabel: string) => {
      if (!draggingLabel || draggingLabel === targetLabel) {
        onCardDragEnd();
        return;
      }
      const labels = orderedFeatures.map((feature) => feature.label);
      const normalized = normalizeHomeFeatureOrder(effectiveFeatureOrder, labels);
      const next = reorderHomeFeatureLabels(normalized, draggingLabel, targetLabel);
      if (canEditCondoLayout) {
        setCondoLayout((current) =>
          current
            ? { ...current, featureOrder: next }
            : {
                condoId: session.condoId,
                featureOrder: next,
                gridColumns: 2,
                stylePreset: 'diurno',
                allowResidentOrderOverride: true,
                canEdit: true,
              },
        );
        void saveCondoHomeLayout({
          condoId: session.condoId,
          userId: session.id,
          featureOrder: next,
        });
      } else if (canPersonalizeOrder) {
        setPersonalFeatureOrder(next);
        writePersonalHomeFeatureOrder(session.condoId, session.id, next);
      }
      onCardDragEnd();
    },
    [
      canEditCondoLayout,
      canPersonalizeOrder,
      draggingLabel,
      effectiveFeatureOrder,
      onCardDragEnd,
      orderedFeatures,
      session.condoId,
      session.id,
    ],
  );

  const restoreCondoFeatureOrder = useCallback(() => {
    clearPersonalHomeFeatureOrder(session.condoId, session.id);
    setPersonalFeatureOrder([]);
  }, [session.condoId, session.id]);

  const logout = useCallback(() => {
    void logoutWebSession();
    navigate('/login', { replace: true });
  }, [navigate]);

  useEffect(() => {
    document.title = 'Condomínio — Condo App';
    return () => {
      document.title = 'Condo App — Gestão do condomínio';
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAlerts() {
      const next: Record<string, number> = {};

      if (isOperationalStaff(session.role)) {
        try {
          const rows = await listEmergencyIncidents(session.condoId, session.id);
          const count = rows.filter((row) => str(row.status) === 'open').length;
          if (count > 0) {
            next['Emergência'] = count;
          }
        } catch {
          /* Mantem as demais notificações. */
        }
      }

      if (session.unitId != null || isOperationalStaff(session.role)) {
        try {
          const rows = await listParcelDeliveries({
            condoId: session.condoId,
            userId: session.id,
            unitId: session.unitId ?? undefined,
            onlyPending: true,
          });
          const count = rows.filter((row) => str(row.status) === 'awaiting_pickup').length;
          if (count > 0) {
            next.Encomendas = count;
          }
        } catch {
          /* Mantem as demais notificações. */
        }
      }

      try {
        const rows = isOperationalStaff(session.role)
          ? await listSyndicMaintenanceRequests(session.condoId)
          : session.unitId != null
            ? await listResidentMaintenanceRequests(session.condoId, session.unitId)
            : [];
        const count = rows.filter((row) => {
          const status = str(row.status);
          return status !== 'completed' && status !== 'closed';
        }).length;
        if (count > 0) {
          next['Solicitar Manutenção'] = count;
        }
      } catch {
        /* Mantem as demais notificações. */
      }

      try {
        const rows = await listPolls(session.condoId, session.id);
        const count = rows.filter((row) => str(row.status) === 'open').length;
        if (count > 0) {
          next['Enquetes e Votações'] = count;
        }
      } catch {
        /* Mantem as demais notificações. */
      }

      if (!cancelled) {
        setAlertCounts(() => {
          const dismissed = readDismissedAlerts(session.condoId, session.id);
          const nextDismissed = { ...dismissed };
          let dismissedChanged = false;
          for (const key of Object.keys(nextDismissed)) {
            if ((next[key] ?? 0) <= 0) {
              delete nextDismissed[key];
              dismissedChanged = true;
            }
          }
          if (dismissedChanged) {
            writeDismissedAlerts(session.condoId, session.id, nextDismissed);
            setDismissedAlertCounts(nextDismissed);
          }
          return Object.fromEntries(
            Object.entries(next).filter(([key, value]) => value > (nextDismissed[key] ?? 0)),
          );
        });
      }
    }

    void loadAlerts();
    const id = window.setInterval(() => {
      void loadAlerts();
    }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [session]);

  const totalAlerts = useMemo(
    () => Object.values(alertCounts).reduce((sum, count) => sum + count, 0),
    [alertCounts],
  );

  const hasEmergencyAlerts = (alertCounts['Emergência'] ?? 0) > 0;

  const notificationEntries = useMemo(() => {
    return Object.entries(alertCounts).sort(([labelA, countA], [labelB, countB]) => {
      if (labelA === 'Emergência') {
        return -1;
      }
      if (labelB === 'Emergência') {
        return 1;
      }
      return countB - countA;
    });
  }, [alertCounts]);

  const onNotificationClick = useCallback(
    (label: string) => {
      setNotificationsOpen(false);
      const feature =
        features.find((item) => item.label === label) ??
        HOME_FEATURE_LIST.find((item) => item.label === label);
      if (feature) {
        onFeatureClick(feature);
      }
    },
    [features, onFeatureClick],
  );

  return (
    <div className="app-home">
      <header className="app-home__bar">
        <Link to="/" className="app-home__brand">
          ← Site
        </Link>
        <h1 className="app-home__title">Condomínio</h1>
        <div className="app-home__search" role="search">
          <span aria-hidden>🔎</span>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Buscar cards"
            aria-label="Buscar funcionalidades"
          />
          {searchQuery.trim() ? (
            <button type="button" onClick={() => setSearchQuery('')} aria-label="Limpar busca">
              ×
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="app-home__bell"
          onClick={() => setNotificationsOpen(true)}
          aria-label={
            totalAlerts > 0
              ? `${totalAlerts} notificação${totalAlerts === 1 ? '' : 'ões'} pendente${totalAlerts === 1 ? '' : 's'}`
              : 'Notificações'
          }
        >
          <span aria-hidden>🔔</span>
          {totalAlerts > 0 ? (
            <span
              className={
                hasEmergencyAlerts
                  ? 'app-home__bell-badge'
                  : 'app-home__bell-badge app-home__bell-badge--info'
              }
            >
              {totalAlerts > 99 ? '99+' : totalAlerts}
            </span>
          ) : null}
        </button>
        <button type="button" className="app-home__ghost" onClick={logout}>
          Sair
        </button>
      </header>

      <main className="app-home__main">
        <section className="app-home__hero">
          <p className="app-home__welcome">
            Bem-vindo, <strong>{session.fullName || session.login}</strong>!
          </p>
          <p className="app-home__role">
            Perfil atual: <strong>{labelPt(session.role)}</strong>
          </p>
        </section>

        <h2 className="app-home__section-title">Funcionalidades</h2>
        {canReorderCards && orderedFeatures.length > 1 ? (
          <p className="app-home__reorder-hint">
            {canEditCondoLayout
              ? 'Segure e arraste para definir a ordem para todos do condomínio.'
              : 'Segure e arraste para personalizar só para você.'}
          </p>
        ) : null}
        {canPersonalizeOrder && personalFeatureOrder.length > 0 ? (
          <p className="app-home__reorder-hint">
            <button type="button" className="app-home__ghost" onClick={restoreCondoFeatureOrder}>
              Restaurar ordem do condomínio
            </button>
          </p>
        ) : null}
        {orderedFeatures.length === 0 ? (
          <p className="app-home__empty">
            Nenhuma funcionalidade encontrada para “{searchQuery.trim()}”.
          </p>
        ) : (
          <ul className="app-home__grid" aria-label="Funcionalidades do condomínio">
            {orderedFeatures.map((f) => {
              const cardLabel = displayLabelForFeature(f.label, session.role);
              const count = alertCounts[f.label] ?? 0;
              const isEmergency = f.label === 'Emergência';
              const isDragging = draggingLabel === f.label;
              const isDropTarget = dropTargetLabel === f.label && draggingLabel != null;
              return (
                <li
                  key={f.label}
                  className={
                    isDropTarget
                      ? 'app-home__grid-item app-home__grid-item--drop-target'
                      : 'app-home__grid-item'
                  }
                  draggable={canReorderCards}
                  onDragStart={() => onCardDragStart(f.label)}
                  onDragEnd={onCardDragEnd}
                  onDragOver={(event) => {
                    if (!canReorderCards || draggingLabel == null) {
                      return;
                    }
                    event.preventDefault();
                    setDropTargetLabel(f.label);
                  }}
                  onDragLeave={() => {
                    setDropTargetLabel((current) => (current === f.label ? null : current));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    onCardDrop(f.label);
                  }}
                >
                  <button
                    type="button"
                    className={
                      isEmergency && count > 0
                        ? 'app-home__card app-home__card--emergency'
                        : 'app-home__card'
                    }
                    style={isDragging ? { opacity: 0.45 } : undefined}
                    onClick={() => onFeatureClick(f)}
                  >
                    {count > 0 ? (
                      <span
                        className={
                          isEmergency
                            ? 'app-home__card-badge'
                            : 'app-home__card-badge app-home__card-badge--info'
                        }
                        aria-label={`${count} ações pendentes`}
                      >
                        {count}
                      </span>
                    ) : null}
                    <span className="app-home__card-icon" aria-hidden>
                      {f.icon}
                    </span>
                    <span className="app-home__card-label">
                      {cardLabel ?? f.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="app-home__hint">
          Os mesmos atalhos do aplicativo móvel. Já na web: <strong>Área do Síndico</strong>,{' '}
          <strong>Administração</strong>, <strong>Controle de Acesso</strong>,{' '}
          <strong>Boleto Online</strong>, <strong>Ofertas</strong>,{' '}
          <strong>Fale com o Condomínio</strong>, <strong>Reservas de Espaço</strong>,{' '}
          <strong>Mural de Avisos</strong>, <strong>Comunicados Individuais</strong>,{' '}
          <strong>Manutenção</strong>, <strong>Emergência</strong>, <strong>Encomendas</strong> e{' '}
          <strong>Minha Unidade</strong>; os restantes módulos seguem em integração.
        </p>
      </main>

      {toast ? (
        <div className="app-home__toast" role="status">
          {toast}
        </div>
      ) : null}

      {notificationsOpen ? (
        <div
          className="app-home__notifications-backdrop"
          role="presentation"
          onClick={() => setNotificationsOpen(false)}
        >
          <div
            className="app-home__notifications-modal"
            role="dialog"
            aria-labelledby="app-home-notifications-title"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="app-home__notifications-header">
              <h2 id="app-home-notifications-title">Notificações</h2>
              <button
                type="button"
                className="app-home__notifications-close"
                aria-label="Fechar notificações"
                onClick={() => setNotificationsOpen(false)}
              >
                ×
              </button>
            </header>
            {notificationEntries.length === 0 ? (
              <p className="app-home__notifications-empty">Nenhuma notificação pendente.</p>
            ) : (
              <ul className="app-home__notifications-list">
                {notificationEntries.map(([label, count]) => {
                  const feature =
                    features.find((item) => item.label === label) ??
                    HOME_FEATURE_LIST.find((item) => item.label === label);
                  const cardLabel =
                    displayLabelForFeature(label, session.role) ?? label;
                  const isEmergency = label === 'Emergência';
                  return (
                    <li key={label}>
                      <button
                        type="button"
                        className={
                          isEmergency
                            ? 'app-home__notification-item app-home__notification-item--emergency'
                            : 'app-home__notification-item'
                        }
                        onClick={() => onNotificationClick(label)}
                      >
                        <span className="app-home__notification-icon" aria-hidden>
                          {feature?.icon ?? '🔔'}
                        </span>
                        <span className="app-home__notification-body">
                          <span className="app-home__notification-title">{cardLabel}</span>
                          <span className="app-home__notification-subtitle">
                            {notificationSubtitle(label, count)}
                          </span>
                        </span>
                        <span
                          className={
                            isEmergency
                              ? 'app-home__notification-count'
                              : 'app-home__notification-count app-home__notification-count--info'
                          }
                        >
                          {count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

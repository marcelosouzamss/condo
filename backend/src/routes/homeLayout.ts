import { Router } from 'express';

import { canManageCondoHomeLayout } from '../authz';
import { query } from '../db';
import {
  parseGridColumns,
  parseStylePreset,
  sanitizeFeatureOrder,
} from '../homeFeatureLabels';
import { loadLegacyUserRow } from '../userContext';

const router = Router();

function parseCondoId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePositive(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

type LayoutRow = {
  condo_id: number;
  feature_order: unknown;
  grid_columns: number;
  style_preset: string;
  allow_resident_order_override: boolean;
  updated_at: string;
  updated_by_user_id: number | null;
};

const DEFAULT_LAYOUT = {
  featureOrder: [] as string[],
  gridColumns: 2,
  stylePreset: 'diurno',
  allowResidentOrderOverride: true,
};

function mapLayoutRow(row: LayoutRow | null, condoId: number, canEdit: boolean) {
  const featureOrder = row
    ? sanitizeFeatureOrder(row.feature_order)
    : DEFAULT_LAYOUT.featureOrder;
  return {
    condoId,
    featureOrder,
    gridColumns: row?.grid_columns ?? DEFAULT_LAYOUT.gridColumns,
    stylePreset: row?.style_preset ?? DEFAULT_LAYOUT.stylePreset,
    allowResidentOrderOverride:
      row?.allow_resident_order_override ?? DEFAULT_LAYOUT.allowResidentOrderOverride,
    updatedAt: row?.updated_at ?? null,
    updatedByUserId: row?.updated_by_user_id ?? null,
    canEdit,
  };
}

async function loadLayoutRow(condoId: number): Promise<LayoutRow | null> {
  const r = await query(
    `select condo_id, feature_order, grid_columns, style_preset,
            allow_resident_order_override, updated_at, updated_by_user_id
     from condo_home_layout
     where condo_id = $1
     limit 1`,
    [condoId],
  );
  if (r.rows.length === 0) {
    return null;
  }
  return r.rows[0] as LayoutRow;
}

router.get('/', async (req, res, next) => {
  try {
    const condoId = parseCondoId(req.query.condoId);
    const userId = parsePositive(req.query.userId);
    if (condoId == null || userId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }

    const user = await loadLegacyUserRow(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(403).json({ message: 'Sem acesso a este condominio.' });
    }

    const row = await loadLayoutRow(condoId);
    const canEdit = canManageCondoHomeLayout(user.role);
    return res.json(mapLayoutRow(row, condoId, canEdit));
  } catch (error) {
    return next(error);
  }
});

router.patch('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const condoId = parseCondoId(body.condoId);
    const userId = parsePositive(body.userId);
    if (condoId == null || userId == null) {
      return res.status(400).json({ message: 'condoId e userId sao obrigatorios.' });
    }

    const user = await loadLegacyUserRow(userId, condoId);
    if (user == null || user.active !== true) {
      return res.status(403).json({ message: 'Sem acesso a este condominio.' });
    }
    if (!canManageCondoHomeLayout(user.role)) {
      return res.status(403).json({
        message: 'Apenas sindico, administracao ou admin da plataforma podem editar o layout da home.',
      });
    }

    const existing = await loadLayoutRow(condoId);
    const nextFeatureOrder =
      body.featureOrder !== undefined
        ? sanitizeFeatureOrder(body.featureOrder)
        : existing
          ? sanitizeFeatureOrder(existing.feature_order)
          : DEFAULT_LAYOUT.featureOrder;

    const nextGrid =
      body.gridColumns !== undefined
        ? parseGridColumns(body.gridColumns)
        : existing?.grid_columns ?? DEFAULT_LAYOUT.gridColumns;
    if (nextGrid == null) {
      return res.status(400).json({ message: 'gridColumns deve ser 2, 3 ou 4.' });
    }

    const nextStyle =
      body.stylePreset !== undefined
        ? parseStylePreset(body.stylePreset)
        : existing?.style_preset ?? DEFAULT_LAYOUT.stylePreset;
    if (nextStyle == null) {
      return res.status(400).json({ message: 'stylePreset invalido.' });
    }

    const nextAllowOverride =
      body.allowResidentOrderOverride !== undefined
        ? Boolean(body.allowResidentOrderOverride)
        : existing?.allow_resident_order_override ?? DEFAULT_LAYOUT.allowResidentOrderOverride;

    await query(
      `insert into condo_home_layout (
         condo_id, feature_order, grid_columns, style_preset,
         allow_resident_order_override, updated_by_user_id, updated_at
       ) values ($1, $2::jsonb, $3, $4, $5, $6, now())
       on conflict (condo_id) do update set
         feature_order = excluded.feature_order,
         grid_columns = excluded.grid_columns,
         style_preset = excluded.style_preset,
         allow_resident_order_override = excluded.allow_resident_order_override,
         updated_by_user_id = excluded.updated_by_user_id,
         updated_at = now()`,
      [
        condoId,
        JSON.stringify(nextFeatureOrder),
        nextGrid,
        nextStyle,
        nextAllowOverride,
        userId,
      ],
    );

    const row = await loadLayoutRow(condoId);
    return res.json(mapLayoutRow(row, condoId, true));
  } catch (error) {
    return next(error);
  }
});

export default router;

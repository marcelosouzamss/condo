import { getJson, patchJson } from './jsonHttp';

export type CondoHomeLayout = {
  condoId: number;
  featureOrder: string[];
  gridColumns: number;
  stylePreset: string;
  allowResidentOrderOverride: boolean;
  canEdit: boolean;
};

export function defaultCondoHomeLayout(condoId: number): CondoHomeLayout {
  return {
    condoId,
    featureOrder: [],
    gridColumns: 2,
    stylePreset: 'diurno',
    allowResidentOrderOverride: true,
    canEdit: false,
  };
}

export async function fetchCondoHomeLayout(
  condoId: number,
  userId: number,
): Promise<CondoHomeLayout> {
  try {
    const data = await getJson<CondoHomeLayout>(
      `/api/home-layout?condoId=${condoId}&userId=${userId}`,
    );
    return {
      ...defaultCondoHomeLayout(condoId),
      ...data,
      featureOrder: Array.isArray(data.featureOrder) ? data.featureOrder : [],
    };
  } catch {
    return defaultCondoHomeLayout(condoId);
  }
}

export async function saveCondoHomeLayout(input: {
  condoId: number;
  userId: number;
  featureOrder?: string[];
  gridColumns?: number;
  stylePreset?: string;
  allowResidentOrderOverride?: boolean;
}): Promise<CondoHomeLayout | null> {
  try {
    return await patchJson<CondoHomeLayout>('/api/home-layout', input);
  } catch {
    return null;
  }
}

import { useMemo } from 'react';
import { loadWebUserSession, type WebUserPayload } from '../webSession';

export function useStaffSession(): WebUserPayload | null {
  return useMemo(() => loadWebUserSession(), []);
}

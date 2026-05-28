import { useCallback, useEffect, useState } from 'react';
import {
  getSyndicFinancialReport,
  getSyndicAreaUsageReport,
  getSyndicOperationsReport,
} from '../../staffApi';
import { useStaffSession } from '../useStaffSession';
import { StaffLayout } from '../StaffLayout';

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre className="staff-json-preview">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export function SyndicReportFinancialPage() {
  const session = useStaffSession();
  const [data, setData] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setErr(null);
    try {
      setData(await getSyndicFinancialReport(session.condoId));
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : 'Erro.');
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Relatório financeiro" backTo="/app/sindico">
      {err ? <p className="staff-error">{err}</p> : null}
      {data != null ? <JsonBlock data={data} /> : !err ? <p>Carregando…</p> : null}
    </StaffLayout>
  );
}

export function SyndicReportAreaUsagePage() {
  const session = useStaffSession();
  const [data, setData] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setErr(null);
    try {
      setData(await getSyndicAreaUsageReport(session.condoId));
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : 'Erro.');
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Uso de áreas" backTo="/app/sindico">
      {err ? <p className="staff-error">{err}</p> : null}
      {data != null ? <JsonBlock data={data} /> : !err ? <p>Carregando…</p> : null}
    </StaffLayout>
  );
}

export function SyndicReportOperationsPage() {
  const session = useStaffSession();
  const [data, setData] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setErr(null);
    try {
      setData(await getSyndicOperationsReport(session.condoId));
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : 'Erro.');
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) {
    return null;
  }

  return (
    <StaffLayout title="Relatório de operação" backTo="/app/sindico">
      {err ? <p className="staff-error">{err}</p> : null}
      {data != null ? <JsonBlock data={data} /> : !err ? <p>Carregando…</p> : null}
    </StaffLayout>
  );
}

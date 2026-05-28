import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { uploadsUrl } from '../api';
import { isBillingStaff } from '../condoUserRoles';
import {
  createBillingCampaign,
  deleteBillingCampaign,
  getBillingCampaigns,
  getMyCharges,
  type BillingCampaignRow,
} from '../portalApi';
import { StaffLayout } from '../staff/StaffLayout';
import { useStaffSession } from '../staff/useStaffSession';
import '../staff/staffPages.css';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function campaignStatusPt(s: string): string {
  switch (s) {
    case 'draft':
      return 'Rascunho';
    case 'generated':
      return 'Boletos gerados';
    case 'closed':
      return 'Encerrada';
    default:
      return s;
  }
}

function openBoletoPdf(m: Record<string, unknown>): string | null {
  const raw = str(m.boleto_pdf_url).trim();
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  const boleto = str(m.boleto_url).trim();
  if (boleto.startsWith('http://') || boleto.startsWith('https://')) {
    return boleto.endsWith('.pdf') ? boleto : `${boleto}.pdf`;
  }
  if (raw) {
    return uploadsUrl(raw.replace(/^\/?uploads\/?/, ''));
  }
  return null;
}

function StaffBillingSection() {
  const session = useStaffSession();
  const [rows, setRows] = useState<BillingCampaignRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [competence, setCompetence] = useState(() => {
    const d = new Date();
    return `${d.getMonth() + 1}`.padStart(2, '0') + `/${d.getFullYear()}`;
  });
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
  });
  const [notes, setNotes] = useState('');
  const [finePercent, setFinePercent] = useState('');
  const [interestPercentMonth, setInterestPercentMonth] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    setErr(null);
    try {
      setRows(await getBillingCampaigns(session.condoId, session.id));
    } catch (e) {
      setRows(null);
      setErr(e instanceof Error ? e.message : 'Erro ao carregar competências.');
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !title.trim()) {
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await createBillingCampaign({
        condoId: session.condoId,
        userId: session.id,
        title: title.trim(),
        competence: competence.trim() || '—',
        dueDate: dueDate.trim(),
        notes: notes.trim() || null,
        finePercent: finePercent.trim()
          ? Number.parseFloat(finePercent.replace(',', '.'))
          : null,
        interestPercentMonth: interestPercentMonth.trim()
          ? Number.parseFloat(interestPercentMonth.replace(',', '.'))
          : null,
        discountAmount: discountAmount.trim()
          ? Number.parseFloat(discountAmount.replace(',', '.'))
          : null,
      });
      setShowNew(false);
      setTitle('');
      await load();
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Erro ao criar.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (m: BillingCampaignRow) => {
    if (!session) {
      return;
    }
    const id = num(m.id);
    const status = str(m.status);
    const nCharges = num(m.charges_count);
    if (status !== 'draft' || nCharges > 0) {
      window.alert('Só é possível excluir competências em rascunho sem cobranças.');
      return;
    }
    if (!window.confirm(`Excluir competência «${str(m.title)}»?`)) {
      return;
    }
    try {
      await deleteBillingCampaign(id, session.condoId, session.id);
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  };

  return (
    <>
      <div className="staff-hero">
        <h2>Cobrança e boletos</h2>
        <p>
          Compatível com o hub móvel: competências em rascunho, geração por lote ou unidade,
          PIX e boleto simulado pelo servidor.
        </p>
      </div>

      <button type="button" className="portal-btn portal-btn--primary" onClick={() => setShowNew((v) => !v)}>
        {showNew ? 'Fechar formulário' : 'Nova competência'}
      </button>

      {showNew ? (
        <form className="portal-form" onSubmit={onCreate}>
          <label>
            Título
            <input required value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Condomínio maio/2026" />
          </label>
          <label>
            Competência
            <input value={competence} onChange={(ev) => setCompetence(ev.target.value)} placeholder="05/2026" />
          </label>
          <label>
            Vencimento (AAAA-MM-DD)
            <input required type="date" value={dueDate} onChange={(ev) => setDueDate(ev.target.value)} />
          </label>
          <label>
            Multa % (opcional)
            <input value={finePercent} onChange={(ev) => setFinePercent(ev.target.value)} inputMode="decimal" />
          </label>
          <label>
            Juros ao mês % (opcional)
            <input value={interestPercentMonth} onChange={(ev) => setInterestPercentMonth(ev.target.value)} inputMode="decimal" />
          </label>
          <label>
            Desconto fixo R$ por unidade (opcional)
            <input value={discountAmount} onChange={(ev) => setDiscountAmount(ev.target.value)} inputMode="decimal" />
          </label>
          <label>
            Observações
            <textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={2} />
          </label>
          <div className="portal-form__actions">
            <button type="submit" className="portal-btn portal-btn--primary" disabled={saving}>
              Salvar rascunho
            </button>
            <button type="button" className="portal-btn" onClick={() => setShowNew(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      {err ? <p className="staff-error">{err}</p> : null}

      {!rows ? (
        <p>Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="staff-muted">Nenhuma competência. Crie a primeira acima.</p>
      ) : (
        <ul className="staff-list portal-bill-list">
          {rows.map((m) => {
            const id = num(m.id);
            return (
              <li key={id}>
                <Link className="portal-bill-row" to={`/app/boleto-online/campanha/${id}`}>
                  <div>
                    <strong>{str(m.title)}</strong>
                    <div className="staff-muted">
                      {str(m.competence)} · Venc.: {str(m.due_date).slice(0, 10)} ·{' '}
                      {campaignStatusPt(str(m.status))} · {num(m.charges_count)} cobrança(s)
                    </div>
                  </div>
                  <span className="staff-card__action">Abrir →</span>
                </Link>
                {str(m.status) === 'draft' && num(m.charges_count) === 0 ? (
                  <button type="button" className="portal-link-danger" onClick={() => void onDelete(m)}>
                    Excluir rascunho
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function ResidentBillingSection() {
  const session = useStaffSession();
  const [tab, setTab] = useState<'pending' | 'paid'>('pending');
  const [charges, setCharges] = useState<Record<string, unknown>[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pixOpenId, setPixOpenId] = useState<number | null>(null);

  const unitId = session?.unitId;

  const load = useCallback(async () => {
    if (!session || unitId == null) {
      return;
    }
    setErr(null);
    try {
      setCharges(await getMyCharges(session.condoId, session.id, unitId));
    } catch (e) {
      setCharges(null);
      setErr(e instanceof Error ? e.message : 'Erro.');
    }
  }, [session, unitId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingRows = useMemo(
    () =>
      (charges ?? []).filter(
        (r) => str(r.status) === 'pending',
      ),
    [charges],
  );
  const paidRows = useMemo(
    () =>
      (charges ?? []).filter(
        (r) => str(r.status) === 'paid',
      ),
    [charges],
  );

  if (!session) {
    return null;
  }

  if (unitId == null) {
    return (
      <p className="staff-banner">
        Sua conta não está vinculada a uma unidade. Peça à administradora para associar o seu
        login à sua unidade — igual ao aplicativo móvel.
      </p>
    );
  }

  const display = tab === 'pending' ? pendingRows : paidRows;

  return (
    <>
      <div className="staff-hero">
        <h2>Boleto online</h2>
        <p>Segunda via, PDF, PIX e linha digitável — mesmos dados de «Minha cobrança» no app.</p>
      </div>

      <div className="portal-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pending'}
          className={tab === 'pending' ? 'portal-tabs__btn portal-tabs__btn--on' : 'portal-tabs__btn'}
          onClick={() => setTab('pending')}
        >
          Pendentes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'paid'}
          className={tab === 'paid' ? 'portal-tabs__btn portal-tabs__btn--on' : 'portal-tabs__btn'}
          onClick={() => setTab('paid')}
        >
          Histórico
        </button>
      </div>

      {err ? <p className="staff-error">{err}</p> : null}

      {!charges ? (
        <p>Carregando…</p>
      ) : display.length === 0 ? (
        <p className="staff-muted">
          {tab === 'pending'
            ? 'Não há boletos pendentes com status «pending». Quando a administração gerar a cobrança, os links aparecem aqui.'
            : 'Ainda não há boletos pagos no histórico.'}
        </p>
      ) : (
        <ul className="staff-list">
          {display.map((m) => {
            const id = num(m.id);
            const pdfHref = openBoletoPdf(m);
            const pix = str(m.pix_copia_cola);
            const bar = str(m.barcode);
            return (
              <li key={id}>
                <strong>{str(m.campaign_title)}</strong>
                <div className="staff-muted">
                  {str(m.competence)} · Venc.: {str(m.due_date)?.slice(0, 10)} · {brl.format(num(m.amount))}
                </div>
                <div style={{ marginTop: 8 }}>{str(m.status)}</div>
                {tab === 'pending' ? (
                  <div className="portal-charge-actions">
                    {pdfHref ? (
                      <a className="portal-btn portal-btn--primary" href={pdfHref} target="_blank" rel="noreferrer">
                        Baixar PDF
                      </a>
                    ) : null}
                    {pix ? (
                      <button type="button" className="portal-btn" onClick={() => setPixOpenId((x) => (x === id ? null : id))}>
                        QR Code PIX
                      </button>
                    ) : null}
                    {pix ? (
                      <button
                        type="button"
                        className="portal-btn"
                        onClick={() => void navigator.clipboard?.writeText(pix)}
                      >
                        PIX copia e cola
                      </button>
                    ) : null}
                    {bar ? (
                      <button type="button" className="portal-btn" onClick={() => void navigator.clipboard?.writeText(bar)}>
                        Copiar linha digitável
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {pixOpenId === id && pix ? (
                  <div className="portal-pix-box">
                    <QRCode value={pix} size={160} />
                    <p className="staff-muted">Escaneie no app do banco (simulação).</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export function BillingHubPage() {
  const session = useStaffSession();
  const staff = session && isBillingStaff(session.role);

  return (
    <StaffLayout title={staff ? 'Cobrança e boletos' : 'Boleto online'} backTo="/app">
      {staff ? <StaffBillingSection /> : <ResidentBillingSection />}
    </StaffLayout>
  );
}

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, ArrowUpDown, BarChart3, BriefcaseBusiness, CalendarDays, FileBarChart, Flag, FolderKanban, Layers, Pencil, PieChart, Plus, ReceiptText, RefreshCw, Search, Sparkles, Target, Trash2, UserPlus, Users, Wallet, Workflow, X } from 'lucide-react';
import { localAuth, request } from '../../api/client';
import { getCurrentCognitoUser, getCognitoOrganizationInfo, signOutFromCognito } from '../../auth/cognito';
import TopNav from './TopNav';
import CustomSelect from '../../components/CustomSelect';
import PageHeader from '../../components/PageHeader';
import Modal from '../../components/Modal';
import { BudgetSummaryModal, PortfolioObjectivesModal, ProjectMilestonesModal, TaskDetailModal } from './DomainModals';
import OrbitalPanel from './OrbitalPanel';
import TeamAvailabilityPanel from './TeamAvailabilityPanel';
import { MembershipsPanel, OrganizationProfileBanner } from './OrganizationAdminPanels';
import { formatCurrency, formatDate, isDateOverdue, StatusBadge, UserAvatar } from '../../components/StatusBadge';
import {
  formatAlertEventLabel,
  formatFileSize,
  formatFileTypeBadge,
  formatFlowFrequency,
  formatFlowType,
  formatResourceType,
  formatTaskStatus,
  isOpaqueId,
} from '../../utils/display';
import { navigate, usePathname } from '../../hooks/navigation';
import '../../style.css';
import './workspace-premium.css';
import './dashboard-identity.css';

const DecisionLab = lazy(() => import('../../DecisionLab'));

type Item = Record<string, unknown> & { pk?: string; sk?: string };
type Module = { key: string; path: string; title: string; icon: React.ComponentType<{ size?: number }>; fields: string[]; required: string[] };
const modules: Module[] = [
  { key: 'portfolio', path: 'portfolios', title: 'Portafolios', icon: Layers, fields: ['name', 'description', 'ownerId', 'status'], required: ['name'] },
  { key: 'project', path: 'projects', title: 'Proyectos', icon: FolderKanban, fields: ['name', 'portfolioId', 'ownerId', 'status', 'startDate', 'endDate'], required: ['name'] },
  { key: 'resource', path: 'resources', title: 'Recursos', icon: Users, fields: ['name', 'type', 'capacity', 'status'], required: ['name'] },
  { key: 'budget', path: 'budgets', title: 'Presupuestos', icon: Wallet, fields: ['projectId', 'allocated', 'spent', 'currency'], required: ['projectId'] },
  { key: 'priority', path: 'priorities', title: 'Prioridades', icon: ArrowUpDown, fields: ['projectId', 'impact', 'urgency', 'risk', 'alignment'], required: ['projectId'] },
  { key: 'identity', path: 'users', title: 'Usuarios', icon: Users, fields: ['name', 'email', 'role', 'status'], required: ['name'] },
];

const fieldLabels: Record<string, string> = {
  name: 'Nombre',
  description: 'Descripción',
  ownerId: 'Responsable',
  status: 'Estado',
  portfolioId: 'Portafolio',
  projectId: 'Proyecto',
  startDate: 'Fecha de inicio',
  endDate: 'Fecha de cierre',
  type: 'Tipo',
  capacity: 'Capacidad',
  allocated: 'Asignado',
  spent: 'Gastado',
  currency: 'Moneda',
  impact: 'Impacto',
  urgency: 'Urgencia',
  risk: 'Riesgo',
  alignment: 'Alineación',
  email: 'Correo',
  role: 'Rol',
  resourceId: 'Recurso',
  allocation: 'Asignación',
  amount: 'Importe',
  createdAt: 'Fecha de registro',
  rank: 'Posición',
  score: 'Puntaje',
};
const fieldLabel = (field: string) => fieldLabels[field] || field;
const PRIORITY_FIELDS = ['impact', 'urgency', 'risk', 'alignment'] as const;
function clampPriorityValue(value: unknown, fallback = 50): number {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(100, Math.max(0, num));
}
function computePriorityScore(values: Record<string, unknown>): number {
  const impact = clampPriorityValue(values.impact);
  const urgency = clampPriorityValue(values.urgency);
  const risk = clampPriorityValue(values.risk);
  const alignment = clampPriorityValue(values.alignment);
  return Math.round((0.35 * impact + 0.25 * urgency + 0.25 * alignment + 0.15 * (100 - risk)) * 100) / 100;
}
function priorityScoreTone(score: number): 'emerald' | 'sky' | 'amber' {
  return score >= 70 ? 'emerald' : score >= 40 ? 'sky' : 'amber';
}
function hasInvalidPriorityRange(values: Record<string, unknown>, requireAll = false): boolean {
  return PRIORITY_FIELDS.some(field => {
    const raw = values[field];
    if (raw === undefined || raw === null || String(raw).trim() === '') return requireAll;
    const num = Number(raw);
    return !Number.isFinite(num) || num < 0 || num > 100;
  });
}
function itemId(item: Item) { return typeof item.sk === 'string' ? item.sk.replace(/^ITEM#/, '') : String(item.id || ''); }
function readable(value: unknown) { return value === undefined || value === null || value === '' ? '—' : String(value); }
function valueEmpty(value: unknown) { return value === undefined || value === null || value === ''; }

function renderFormattedCell(field: string, row: Item, entityNames: Record<string, string> = {}) {
  const val = row[field];
  if (val === undefined || val === null || valueEmpty(val)) return <span className="muted-cell">—</span>;
  if (field === 'status' || field === 'role') {
    return <StatusBadge value={val} />;
  }
  if (field === 'type') {
    return formatResourceType(val);
  }
  if (field === 'name') {
    return <strong>{readable(val)}</strong>;
  }
  if (field === 'ownerId' || field === 'resourceId' || field === 'assigneeId') {
    const resolved = entityNames[String(val)];
    if (!resolved && isOpaqueId(val)) return <span className="muted-cell">Sin asignar</span>;
    return <UserAvatar name={resolved || val} />;
  }
  if (field === 'portfolioId' || field === 'projectId') {
    const resolved = entityNames[String(val)];
    if (!resolved && isOpaqueId(val)) return <span className="muted-cell">Sin vincular</span>;
    return <strong>{resolved || readable(val)}</strong>;
  }
  if (field === 'allocated' && row.spent !== undefined) {
    const allocatedNum = Number(val);
    const spentNum = Number(row.spent);
    const balance = allocatedNum - spentNum;
    return (
      <div className="budget-cell">
        <span className="currency-cell">{formatCurrency(val, row.currency)}</span>
        <small className={`budget-balance-hint ${balance < 0 ? 'hint-danger' : 'hint-muted'}`}>
          Saldo: {formatCurrency(balance, row.currency)}
        </small>
      </div>
    );
  }
  if (field === 'spent' && row.allocated !== undefined) {
    const allocatedNum = Number(row.allocated);
    const spentNum = Number(val);
    const pct = allocatedNum > 0 ? Math.round((spentNum / allocatedNum) * 100) : 0;
    return (
      <div className="budget-cell">
        <span className="currency-cell">{formatCurrency(val, row.currency)}</span>
        <div className="budget-pct-meter">
          <div className="inline-meter-track">
            <span
              className={`inline-meter-fill ${spentNum > allocatedNum ? 'fill-rose' : pct > 80 ? 'fill-amber' : 'fill-emerald'}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <small>{pct}%</small>
        </div>
      </div>
    );
  }
  if (field === 'allocated' || field === 'spent' || field === 'amount') {
    return <span className="currency-cell">{formatCurrency(val, row.currency)}</span>;
  }
  if (field === 'allocation' || field === 'capacity') {
    const pct = Number(val) <= 1 ? Math.round(Number(val) * 100) : Math.round(Number(val));
    return (
      <div className="inline-meter">
        <div className="inline-meter-track">
          <span className="inline-meter-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </div>
        <span>{Number.isFinite(pct) ? `${pct}%` : readable(val)}</span>
      </div>
    );
  }
  if (['score', 'impact', 'urgency', 'risk', 'alignment'].includes(field)) {
    const num = Number(val);
    if (Number.isFinite(num)) {
      const tone = field === 'risk' ? (num > 70 ? 'rose' : num > 40 ? 'amber' : 'emerald') : num >= 70 ? 'emerald' : num >= 40 ? 'sky' : 'amber';
      return (
        <div className="inline-meter">
          <div className="inline-meter-track">
            <span className={`inline-meter-fill fill-${tone}`} style={{ width: `${Math.min(100, Math.max(0, num))}%` }} />
          </div>
          <strong>{num}</strong>
        </div>
      );
    }
  }
  if (field.endsWith('Date') || field === 'createdAt' || field === 'updatedAt') {
    const overdue = field === 'endDate' && isDateOverdue(val, row.status);
    return (
      <span className={`date-cell ${overdue ? 'date-overdue' : ''}`}>
        {formatDate(val)}
        {overdue && <span className="overdue-pill">Vencido</span>}
      </span>
    );
  }
  return readable(val);
}

const PAGE_SIZE = 10;

function PaginationBar({
  page,
  totalItems,
  pageSize = PAGE_SIZE,
  onPageChange,
  hasMore = false,
  busy = false,
  onLoadMore,
}: {
  page: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (next: number) => void;
  hasMore?: boolean;
  busy?: boolean;
  onLoadMore?: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems <= pageSize && !hasMore) return null;
  const start = totalItems ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(totalItems, page * pageSize);
  return (
    <div className="pagination-bar">
      <span className="pagination-info">
        Mostrando {start}–{end} de {totalItems} · Página {page} de {totalPages}
      </span>
      <div className="pagination-actions">
        <button type="button" className="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Anterior
        </button>
        <button type="button" className="secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Siguiente
        </button>
        {hasMore && onLoadMore && (
          <button type="button" className="secondary" disabled={busy} onClick={onLoadMore}>
            {busy ? 'Cargando…' : 'Cargar más'}
          </button>
        )}
      </div>
    </div>
  );
}

function DataTable({ title, rows, fields, entityNames = {} }: { title: string; rows: Item[]; fields: string[]; entityNames?: Record<string, string> }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pagedRows = useMemo(() => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [rows, page]);

  return (
    <section className="panel">
      <div className="panelHeading">
        <div>
          <h2>{title}</h2>
          <span>{rows.length} registros visibles</span>
        </div>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>{fields.map(f => <th key={f}>{fieldLabel(f)}</th>)}</tr>
          </thead>
          <tbody>
            {pagedRows.map((row, i) => (
              <tr key={itemId(row) || i}>
                {fields.map(f => <td key={f}>{renderFormattedCell(f, row, entityNames)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">No hay registros todavía.</div>}
      </div>
      <PaginationBar page={page} totalItems={rows.length} onPageChange={setPage} />
    </section>
  );
}

function NotificationCenter({ refreshToken = 0 }: { refreshToken?: number }) {
  const defaultPrefs = { enabled: false, anytime: false, timezone: 'America/Lima', allowedHours: { start: '08:00', end: '18:00' }, frequency: 'immediate', alertTypes: [] as string[], emailConsent: false };
  const defaultEmailChannel = { status: 'unavailable', providerAvailable: false, alertTypes: [] as string[], anytime: true, allowedHours: { start: '08:00', end: '18:00' }, timezone: 'America/Lima', items: [] as any[] };
  const [prefs, setPrefs] = useState<any>(defaultPrefs);
  const [emailChannel, setEmailChannel] = useState<any>(defaultEmailChannel);
  const [inbox, setInbox] = useState<any[]>([]); const [consent, setConsent] = useState(false); const [inboxMessage, setInboxMessage] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [lastLoadedAt, setLastLoadedAt] = useState('');
  const types = ['ProjectCreated','ProjectUpdated','ProjectCompleted','BudgetThresholdExceeded','ResourceAssigned','PriorityRecalculated'];
  const emailTypes = ['ReminderDue','AutomationReport','RiskAlert','WeeklySummary'];
  const emailLabels:Record<string,string> = { ReminderDue:'Recordatorios', AutomationReport:'Resúmenes de automatización', RiskAlert:'Alertas de riesgo', WeeklySummary:'Resumen semanal' };
  const load = useCallback(async () => {
    const [p, i, e] = await Promise.all([request<any>('identity','notifications/preferences'),request<any>('identity','notifications/inbox'),request<any>('identity','notifications/email')]);
    setPrefs({
      ...defaultPrefs,
      ...(p || {}),
      enabled: Boolean(p?.enabled),
      anytime: Boolean(p?.anytime),
      timezone: p?.timezone || defaultPrefs.timezone,
      allowedHours: p?.allowedHours?.start && p?.allowedHours?.end ? p.allowedHours : defaultPrefs.allowedHours,
      frequency: p?.frequency || defaultPrefs.frequency,
      alertTypes: Array.isArray(p?.alertTypes) ? p.alertTypes : [],
    });
    setInbox(i?.items || []);
    setEmailChannel({
      ...defaultEmailChannel,
      ...(e || {}),
      anytime: e?.anytime !== false,
      allowedHours: e?.allowedHours?.start && e?.allowedHours?.end ? e.allowedHours : defaultEmailChannel.allowedHours,
      timezone: e?.timezone || p?.timezone || defaultEmailChannel.timezone,
      alertTypes: Array.isArray(e?.alertTypes) ? e.alertTypes : [],
      items: Array.isArray(e?.items) ? e.items : [],
    });
    setConsent(Boolean(e?.consent));
    setLastLoadedAt(new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    return { p, i, e };
  }, []);
  useEffect(() => {
    setBusy(true);
    void load()
      .catch(e => setInboxMessage(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [load, refreshToken]);
  async function save(e:React.FormEvent) {
    e.preventDefault(); setBusy(true); setInboxMessage('');
    try {
      const payload = {
        enabled: Boolean(prefs.enabled),
        anytime: Boolean(prefs.anytime),
        timezone: String(prefs.timezone || 'America/Lima').trim() || 'America/Lima',
        allowedHours: { start: prefs.allowedHours?.start || '08:00', end: prefs.allowedHours?.end || '18:00' },
        frequency: prefs.frequency || 'immediate',
        alertTypes: Array.isArray(prefs.alertTypes) ? prefs.alertTypes : [],
      };
      await request('identity','notifications/preferences','PUT',payload);
      await load();
      setInboxMessage('Preferencias guardadas para tu usuario autenticado.');
    } catch(e) { setInboxMessage(e instanceof Error?e.message:String(e)); } finally { setBusy(false); }
  }
  async function subscribeEmail(forceConsent = false) {
    setBusy(true); setMessage('');
    try {
      const result=await request<any>('identity','notifications/email/subscribe','POST',{consent: forceConsent || consent, consentVersion:'profiles-email-2026-01'});
      setMessage(result.message);
      await load();
    } catch(e) { setMessage(e instanceof Error?e.message:String(e)); } finally { setBusy(false); }
  }
  async function verifyEmailStatus() {
    setBusy(true); setMessage('');
    try {
      const { e } = await load();
      setMessage(e?.status === 'active'
        ? 'Suscripción confirmada y activa.'
        : 'Aún aparece pendiente en Amazon SNS. Revisa tu bandeja o spam y abre el enlace "Confirm subscription", o reenvía el correo.');
    } catch(e) { setMessage(e instanceof Error?e.message:String(e)); } finally { setBusy(false); }
  }
  async function revokeEmail() { setBusy(true); setMessage(''); try { await request('identity','notifications/email','DELETE'); await load(); setMessage('Consentimiento revocado y suscripción de correo cancelada.'); } catch(e) { setMessage(e instanceof Error?e.message:String(e)); } finally { setBusy(false); } }
  async function saveEmailPreferences(e:React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      await request('identity','notifications/email/preferences','PUT',{
        alertTypes: emailChannel.alertTypes || [],
        anytime: emailChannel.anytime !== false,
        allowedHours: { start: emailChannel.allowedHours?.start || '08:00', end: emailChannel.allowedHours?.end || '18:00' },
        timezone: String(emailChannel.timezone || 'America/Lima').trim() || 'America/Lima',
      });
      await load();
      setMessage('Preferencias de correo guardadas.');
    } catch(e) { setMessage(e instanceof Error?e.message:String(e)); } finally { setBusy(false); }
  }
  const statusLabels:Record<string,string> = { unavailable:'Canal de correo no disponible', 'not-configured':'Sin configurar','pending-confirmation':'Confirmación pendiente en tu bandeja',active:'Activo',revoked:'Desactivado' };
  const deliveryLabels:Record<string,string> = { REQUESTED:'Solicitado',SENT_TO_SNS:'Enviado',SIMULATED_LOCAL:'Registrado',FAILED:'No entregado',BLOCKED:'Pausado',UNAVAILABLE:'No disponible' };
  return <section className="panel notification-panel"><div className="panelHeading"><div><h2>Notificaciones</h2><span>El buzón interno sigue disponible de forma independiente al correo electrónico.</span></div><span className="mode-chip">{emailChannel.providerAvailable?(statusLabels[emailChannel.status]||emailChannel.status):'Correo no disponible'}</span></div><form className="notification-form" onSubmit={save}><label className="check-label"><input type="checkbox" checked={Boolean(prefs.enabled)} onChange={e=>setPrefs({...prefs,enabled:e.target.checked})}/> Activar alertas en el buzón interno</label><label className="check-label"><input type="checkbox" checked={Boolean(prefs.anytime)} onChange={e=>setPrefs({...prefs,anytime:e.target.checked})}/> Recibir alertas en cualquier horario (24/7)</label><div className="notification-options"><label>Zona horaria<input value={prefs.timezone||'America/Lima'} onChange={e=>setPrefs({...prefs,timezone:e.target.value})}/></label>{!prefs.anytime?<><label>Horario desde<input type="time" value={prefs.allowedHours?.start||'08:00'} onChange={e=>setPrefs({...prefs,allowedHours:{...prefs.allowedHours,start:e.target.value}})}/></label><label>Hasta<input type="time" value={prefs.allowedHours?.end||'18:00'} onChange={e=>setPrefs({...prefs,allowedHours:{...prefs.allowedHours,end:e.target.value}})}/></label></>:<small className="assistant-state">Activo las 24 horas en la zona horaria elegida.</small>}</div><fieldset><legend>Eventos para el buzón interno</legend><div className="notification-types">{types.map(type=><label className="check-label" key={type}><input type="checkbox" checked={(prefs.alertTypes||[]).includes(type)} onChange={e=>setPrefs({...prefs,alertTypes:e.target.checked?[...new Set([...(prefs.alertTypes||[]),type])]:(prefs.alertTypes||[]).filter((x:string)=>x!==type)})}/>{formatAlertEventLabel(type)}</label>)}</div></fieldset><button className="secondary" disabled={busy}>Guardar preferencias</button>{inboxMessage&&<p className="assistant-state" role="status">{inboxMessage}</p>}</form><div className="notification-email"><div className="email-intro"><span className="email-label">NOTIFICACIONES POR CORREO</span><h3>Recibe recordatorios y alertas por correo electrónico</h3><p>Elige qué avisos quieres recibir en el correo de tu perfil y mantén el control de tu suscripción.</p></div><div className="email-status-grid" aria-label="Estado del canal de correo"><div><span>Disponibilidad</span><strong>{emailChannel.providerAvailable ? 'Disponible' : 'No disponible'}</strong></div><div><span>Consentimiento</span><strong>{emailChannel.consent ? 'Aceptado' : 'No otorgado'}</strong></div><div><span>Suscripción</span><strong>{emailChannel.status === 'active' ? 'Confirmada' : emailChannel.status === 'pending-confirmation' ? 'Pendiente de confirmar' : 'Sin activar'}</strong></div><div><span>Correo destino</span><strong>{emailChannel.email || 'Correo de tu cuenta'}</strong></div></div><p>{emailChannel.providerAvailable?'Al activarlo, te enviaremos un correo de confirmación a tu dirección registrada.':'Este canal requiere activar las notificaciones por correo. El buzón interno funciona de forma independiente.'}</p>{!emailChannel.providerAvailable?<p role="status">El canal de correo todavía no está disponible. Puedes seguir usando las notificaciones internas.</p>:<><form className="notification-form" onSubmit={saveEmailPreferences}><div className="notification-options"><label className="check-label"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={['active','pending-confirmation'].includes(emailChannel.status)}/> Acepto recibir recordatorios y alertas por correo electrónico. Puedo cancelar la suscripción cuando quiera.</label></div>{!['active','pending-confirmation'].includes(emailChannel.status)&&<button className="secondary" type="button" disabled={busy||!consent} onClick={()=>void subscribeEmail()}>Activar notificaciones por correo</button>}{emailChannel.status==='pending-confirmation'&&<><p role="status">Revisa tu bandeja de entrada y confirma la suscripción desde el enlace del correo recibido.</p><div className="notification-actions"><button className="secondary" type="button" disabled={busy} onClick={()=>void subscribeEmail(true)}>Reenviar correo de confirmación</button><button className="secondary" type="button" disabled={busy} onClick={()=>void verifyEmailStatus()}>Ya confirmé, verificar estado</button></div></>}{['active','pending-confirmation'].includes(emailChannel.status)&&<><label className="check-label"><input type="checkbox" checked={emailChannel.anytime !== false} onChange={e=>setEmailChannel({...emailChannel,anytime:e.target.checked})}/> Recibir correos en cualquier horario (24/7)</label>{emailChannel.anytime === false && <div className="notification-options"><label>Zona horaria de correo<input value={emailChannel.timezone||'America/Lima'} onChange={e=>setEmailChannel({...emailChannel,timezone:e.target.value})}/></label><label>Recibir correos desde<input type="time" value={emailChannel.allowedHours?.start||'08:00'} onChange={e=>setEmailChannel({...emailChannel,allowedHours:{...emailChannel.allowedHours,start:e.target.value}})}/></label><label>Hasta<input type="time" value={emailChannel.allowedHours?.end||'18:00'} onChange={e=>setEmailChannel({...emailChannel,allowedHours:{...emailChannel.allowedHours,end:e.target.value}})}/></label></div>}<fieldset><legend>Qué correos quieres recibir</legend><div className="notification-types">{emailTypes.map(type=><label className="check-label" key={type}><input type="checkbox" checked={(emailChannel.alertTypes||[]).includes(type)} onChange={e=>setEmailChannel({...emailChannel,alertTypes:e.target.checked?[...new Set([...(emailChannel.alertTypes||[]),type])]:(emailChannel.alertTypes||[]).filter((x:string)=>x!==type)})}/>{emailLabels[type]}</label>)}</div></fieldset><button className="secondary" disabled={busy}>Guardar preferencias de correo</button></>}</form>{['active','pending-confirmation'].includes(emailChannel.status)&&<button className="textButton" disabled={busy} onClick={()=>void revokeEmail()}>Cancelar suscripción de correo</button>}</>}{message&&<p className="assistant-state" role="status">{message}</p>}<div className="notification-inbox"><h3>Últimos envíos por correo</h3>{emailChannel.items?.length?emailChannel.items.map((item:any)=><article key={item.eventId||item.id}><b>{item.title||formatAlertEventLabel(item.eventType)}</b><span>{deliveryLabels[item.deliveryStatus]||item.deliveryStatus}</span></article>):<p>Aún no hay mensajes enviados por este canal.</p>}</div></div><div className="notification-inbox"><h3>Buzón interno{lastLoadedAt && <small> · Actualizado {lastLoadedAt}</small>}</h3><button className="textButton" type="button" disabled={busy} onClick={() => { setBusy(true); void load().catch(e => setInboxMessage(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)); }}>{busy ? 'Actualizando buzón…' : 'Actualizar buzón'}</button>{inbox.length?inbox.slice(0,8).map((item:any)=><article key={item.eventId}><b>{item.title}</b><span>{formatDate(item.createdAt)}</span></article>):<p>No hay notificaciones para esta cuenta.</p>}</div></section>;
}

const FLOW_TYPE_OPTIONS = [
  { value: 'weekly-summary', label: 'Resumen semanal' },
  { value: 'reminder', label: 'Recordatorios' },
  { value: 'risk-alert', label: 'Alertas de riesgo' },
];
const FLOW_FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Semanal' },
  { value: 'daily', label: 'Diaria' },
];
const FLOW_DAY_OPTIONS = [
  { value: '0', label: 'Domingo' },
  { value: '1', label: 'Lunes' },
  { value: '2', label: 'Martes' },
  { value: '3', label: 'Miércoles' },
  { value: '4', label: 'Jueves' },
  { value: '5', label: 'Viernes' },
  { value: '6', label: 'Sábado' },
];

const FLOW_ALERT_META: Record<string, { label: string; tone: string; fallbackEntity: string }> = {
  PROJECT_OVERDUE: { label: 'Proyecto atrasado', tone: 'badge-rose', fallbackEntity: 'Proyecto' },
  TASK_OVERDUE: { label: 'Tarea vencida', tone: 'badge-amber', fallbackEntity: 'Tarea' },
  BUDGET_THRESHOLD: { label: 'Presupuesto en alerta', tone: 'badge-amber', fallbackEntity: 'Presupuesto' },
  RESOURCE_OVER_CAPACITY: { label: 'Recurso sobrecargado', tone: 'badge-rose', fallbackEntity: 'Recurso' },
};

function FlowPanel({ refreshToken = 0, entityNames = {} }: { refreshToken?: number; entityNames?: Record<string, string> }) {
  const [flows,setFlows]=useState<any[]>([]);const [runs,setRuns]=useState<any[]>([]);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [type,setType]=useState('weekly-summary');const [frequency,setFrequency]=useState('weekly');const [time,setTime]=useState('09:00');const [dayOfWeek,setDayOfWeek]=useState(1);
  const load=useCallback(async()=>{const data=await request<any>('identity','flows');setFlows(data.items||[]);},[]);useEffect(()=>{void load().catch(e=>setMessage(String(e)));},[load, refreshToken]);
  async function create(e:React.FormEvent){e.preventDefault();setBusy(true);try{await request('identity','flows','POST',{type,frequency,time,dayOfWeek,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Lima'});await load();setMessage('Automatización guardada.');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  async function run(flow:any){setBusy(true);try{await request<any>('identity',`flows/${flow.id}/run`,'POST',{});const history=await request<any>('identity',`flows/${flow.id}/runs`);setRuns(history.items||[]);setMessage('Ejecución completada.');await load();}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  async function toggle(flow:any){setBusy(true);try{await request('identity',`flows/${flow.id}`,'PATCH',{enabled:!flow.enabled});await load();}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  return <section className="panel flow-panel"><div className="panelHeading"><div><h2>Automatizaciones</h2><span>Programa resúmenes y recordatorios automáticos para tu organización.</span></div><span className="mode-chip">SEGUIMIENTO PROGRAMADO</span></div><form className="assistant-form" onSubmit={create}><CustomSelect id="flow-type" value={type} onChange={setType} options={FLOW_TYPE_OPTIONS} ariaLabel="Tipo de automatización" /><CustomSelect id="flow-frequency" value={frequency} onChange={setFrequency} options={FLOW_FREQUENCY_OPTIONS} ariaLabel="Cuando repetir" /><label className="sr-only" htmlFor="flow-time">Hora local</label><input id="flow-time" type="time" value={time} onChange={e=>setTime(e.target.value)} disabled={frequency==="manual"}/>{frequency==="weekly"&&<CustomSelect id="flow-day" value={String(dayOfWeek)} onChange={val=>setDayOfWeek(Number(val))} options={FLOW_DAY_OPTIONS} ariaLabel="Día semanal" />}<button className="primary" disabled={busy}>{busy?'Guardando…':'Crear automatización'}</button></form>{message&&<p role="status" className="assistant-state">{message}</p>}<div className="orbital-reminder-list">{flows.length?flows.map(flow=><article key={flow.id}><div><b>{formatFlowType(flow.name || flow.type)}</b><span>{formatFlowType(flow.type)} · {formatFlowFrequency(flow.frequency)} · {flow.enabled?'Activa':'Pausada'} · próxima {flow.nextRunAt?formatDate(flow.nextRunAt):'manual'} · última {flow.lastRunAt?formatDate(flow.lastRunAt):'—'}</span></div><button className="textButton" disabled={busy} onClick={()=>void run(flow)}>Ejecutar ahora</button><button className="textButton" disabled={busy} onClick={()=>void toggle(flow)}>{flow.enabled?'Pausar':'Activar'}</button><button className="textButton" disabled={busy} onClick={async()=>{const d=await request<any>('identity',`flows/${flow.id}/runs`);setRuns(d.items||[]);}}>Historial</button></article>):<p>No hay automatizaciones configuradas.</p>}</div>{runs.map((run, idx)=>{
    const report = run.report;
    const alerts = Array.isArray(report?.alerts) ? report.alerts : [];
    const pendingScenarios = Array.isArray(report?.pendingDecisionScenarios) ? report.pendingDecisionScenarios : [];
    const counts = report?.counts;
    const errors = Array.isArray(run.errors) ? run.errors : [];
    return <details key={run.executionId} className="flow-run-details" open={idx === 0}><summary><StatusBadge value={run.status} /> <span>{formatDate(run.createdAt)}{alerts.length ? ` · ${alerts.length} ${alerts.length === 1 ? 'alerta' : 'alertas'}` : report ? ' · Sin alertas' : ''}</span></summary><div className="flow-run-card">
      {counts && <div className="flow-counts-grid">
        <div><span>Proyectos</span><strong>{counts.projects ?? 0}</strong></div>
        <div><span>Portafolios</span><strong>{counts.portfolios ?? 0}</strong></div>
        <div><span>Tareas</span><strong>{counts.tasks ?? 0}</strong></div>
        <div><span>Presupuestos</span><strong>{counts.budgets ?? 0}</strong></div>
        <div><span>Recursos</span><strong>{counts.resources ?? 0}</strong></div>
        <div><span>Escenarios</span><strong>{counts.pendingDecisionScenarios ?? 0}</strong></div>
      </div>}
      <div className="flow-alerts-section">
        <h4>Alertas detectadas</h4>
        {alerts.length ? <div className="flow-alerts-list">{alerts.map((alert: any, aIdx: number) => {
          const meta = FLOW_ALERT_META[alert.kind] || { label: String(alert.kind || 'Alerta'), tone: 'badge-slate', fallbackEntity: 'Elemento' };
          const resolvedName = String(alert.entityName || entityNames[String(alert.entityId || '')] || '').trim();
          const title = resolvedName || meta.fallbackEntity;
          const ev = alert.evidence || {};
          return <article className="flow-alert-item" key={`${alert.kind}-${alert.entityId || aIdx}`}>
            <div className="flow-alert-head">
              <strong>{title}</strong>
              <span className={`status-badge ${meta.tone}`}><span className="status-dot" aria-hidden="true" />{meta.label}</span>
            </div>
            <p>{alert.cause || 'Elemento marcado para seguimiento.'}</p>
            <div className="flow-alert-meta">
              {ev.endDate && <span>Cierre: {formatDate(ev.endDate)}</span>}
              {ev.dueDate && <span>Vencimiento: {formatDate(ev.dueDate)}</span>}
              {ev.spent !== undefined && ev.allocated !== undefined && <span>Ejecutado: {formatCurrency(ev.spent)} de {formatCurrency(ev.allocated)}</span>}
              {ev.allocated !== undefined && ev.capacity !== undefined && <span>Capacidad: {Math.round(Number(ev.allocated) * 100)}% / {Math.round(Number(ev.capacity) * 100)}%</span>}
              {ev.status && <StatusBadge value={ev.status} />}
            </div>
          </article>;
        })}</div> : <p className="flow-empty-msg">Sin alertas detectadas en esta ejecución.</p>}
      </div>
      {pendingScenarios.length > 0 && <div className="flow-alerts-section">
        <h4>Escenarios pendientes de revisión</h4>
        <div className="flow-alerts-list">{pendingScenarios.map((sc: any) => <article className="flow-alert-item" key={sc.id || sc.name}>
          <div className="flow-alert-head"><strong>{sc.name || 'Escenario'}</strong><StatusBadge value="PENDING_REVIEW" /></div>
          {sc.createdAt && <div className="flow-alert-meta"><span>Creado: {formatDate(sc.createdAt)}</span></div>}
        </article>)}</div>
      </div>}
      {errors.length > 0 && <div className="flow-alerts-section">
        <h4>Incidencias registradas</h4>
        <div className="flow-alerts-list">{errors.map((err: any, eIdx: number) => <article className="flow-alert-item" key={eIdx}><p>{err.message || 'No se pudo completar esta ejecución.'}</p></article>)}</div>
      </div>}
      {report?.explanation && <small className="flow-run-note">{report.explanation}</small>}
    </div></details>;
  })}</section>;
}

function ReportsPanel({ refreshToken = 0 }: { refreshToken?: number }) {
  const [type, setType] = useState('project-progress'); const [reports, setReports] = useState<any[]>([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const types: Record<string,string> = {'portfolio-status':'Estado de portafolios','project-progress':'Avance de proyectos','overdue-tasks':'Tareas vencidas','resource-usage':'Uso de recursos','budgets':'Presupuestos','priorities':'Prioridades','risks':'Riesgos'};
  const reportOptions = Object.entries(types).map(([value, label]) => ({ value, label }));
  const load = useCallback(async()=>{const data=await request<any>('project','intelligence/reports');setReports(data.items||[]);},[]);
  useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:String(e)));},[load, refreshToken]);
  async function download(id:string) { const data=await request<any>('project',`intelligence/reports/${encodeURIComponent(id)}`); const report=data.report; const blob=new Blob([report.csv],{type:report.mediaType}); const url=URL.createObjectURL(blob); const link=document.createElement('a');link.href=url;link.download=report.fileName;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000); }
  async function generate(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{const data=await request<any>('project','intelligence/reports','POST',{type});setMessage(`${data.report.rows.length} filas generadas.${data.report.scope.truncated?.length ? ' Algunos resultados se limitaron al máximo permitido por área.' : ''}${data.report.unavailable?.length ? ' Algunos módulos no estuvieron disponibles temporalmente.' : ''}`);await load();await download(data.report.id);}catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  return <section className="panel report-panel"><div className="panelHeading"><div><h2><BarChart3 size={18}/> Reportes</h2><span>Genera y descarga reportes consolidados de tu organización.</span></div><span className="mode-chip">CSV</span></div><form className="assistant-form" onSubmit={generate}><CustomSelect id="report-type" value={type} onChange={setType} options={reportOptions} ariaLabel="Tipo de reporte" /><button className="primary" disabled={busy}>{busy?'Generando…':'Generar CSV'}</button></form>{message&&<p className="assistant-state" role="status">{message}</p>}<div className="orbital-reminder-list"><h3>Historial de reportes</h3>{reports.map(report=><article key={report.id}><div><b>{types[report.type]||report.type}</b><span>{formatDate(report.generatedAt)} · {report.scope?.partial?'alcance parcial':'reporte completo'}</span></div><button className="textButton" disabled={busy} onClick={()=>void download(report.id)}>Descargar CSV</button></article>)}{!reports.length&&<p>No se han generado reportes en esta organización.</p>}</div><small>Cada reporte incluye hasta 1 000 registros por área. Los importes se muestran en su moneda original.</small></section>;
}

const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function resolveDocumentContentType(file: File): string {
  if (file.type && Object.values(ALLOWED_DOCUMENT_TYPES).includes(file.type)) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return ALLOWED_DOCUMENT_TYPES[ext] || '';
}

function DocumentsPanel({ refreshToken = 0 }: { refreshToken?: number }) {
  const [projects, setProjects] = useState<Item[]>([]);
  const [documents, setDocuments] = useState<Item[]>([]);
  const [docPage, setDocPage] = useState(1);
  const [projectId, setProjectId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [projData, docData] = await Promise.all([
      request<{ items: Item[] }>('project', 'projects'),
      request<{ items: Item[] }>('project', 'documents'),
    ]);
    const projItems = projData.items || [];
    setProjects(projItems);
    setDocuments(docData.items || []);
    setProjectId(prev => prev || (projItems[0] ? itemId(projItems[0]) : ''));
  }, []);

  useEffect(() => {
    void load().catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [load, refreshToken]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) { setError('Selecciona un proyecto antes de subir un archivo.'); return; }
    if (!file) { setError('Selecciona un archivo (PDF, PNG, JPG, TXT o DOCX).'); return; }
    const contentType = resolveDocumentContentType(file);
    if (!contentType) { setError('Tipo de archivo no permitido. Usa PDF, PNG, JPG, TXT o DOCX.'); return; }
    if (file.size < 1 || file.size > 20 * 1024 * 1024) { setError('El archivo debe pesar entre 1 byte y 20 MB.'); return; }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const created = await request<{ document: Item; uploadUrl: string }>('project', 'documents', 'POST', {
        projectId,
        fileName: file.name,
        contentType,
        contentLength: file.size,
      });
      const putRes = await fetch(created.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
      });
      if (!putRes.ok) throw new Error('No se pudo subir el archivo. Inténtalo de nuevo.');
      setFile(null);
      const input = document.getElementById('s3-document-file') as HTMLInputElement | null;
      if (input) input.value = '';
      setMessage(`Archivo "${file.name}" guardado correctamente.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function download(docId: string) {
    setBusy(true);
    setError('');
    try {
      const data = await request<{ downloadUrl: string }>('project', `documents/${encodeURIComponent(docId)}`);
      window.open(data.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const projectNames = Object.fromEntries(projects.map(p => [itemId(p), readable(p.name)]));

  return (
    <section className="panel report-panel">
      <div className="panelHeading">
        <div>
          <h2>Documentos de proyectos</h2>
          <span>Adjunta y comparte archivos vinculados a cada proyecto.</span>
        </div>
        <span className="mode-chip">ADJUNTOS</span>
      </div>
      <form className="documents-form" onSubmit={upload}>
        <CustomSelect
          id="s3-document-project"
          value={projectId}
          onChange={setProjectId}
          disabled={!projects.length}
          placeholder="No hay proyectos disponibles"
          ariaLabel="Proyecto del documento"
          options={projects.map(p => ({ value: itemId(p), label: readable(p.name) }))}
        />
        <label className="sr-only" htmlFor="s3-document-file">Archivo</label>
        <input
          id="s3-document-file"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,application/pdf,image/png,image/jpeg,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={e => setFile(e.target.files?.[0] || null)}
        />
        <button className="primary" disabled={busy || !projects.length}>{busy ? 'Subiendo…' : 'Subir archivo'}</button>
      </form>
      {error && <p className="error assistant-state" role="alert">{error}</p>}
      {message && <p className="assistant-state" role="status">{message}</p>}
      <div className="orbital-reminder-list">
        <h3>Archivos guardados</h3>
        {documents.slice((docPage - 1) * PAGE_SIZE, docPage * PAGE_SIZE).map(doc => (
          <article key={String(doc.id)}>
            <div>
              <b>{String(doc.fileName)}</b>
              <span>
                {projectNames[String(doc.projectId)] || 'Proyecto'} · {formatFileTypeBadge(doc.contentType, doc.fileName)} · {formatFileSize(doc.contentLength)}
              </span>
            </div>
            <button className="textButton" disabled={busy} onClick={() => void download(String(doc.id))}>Descargar</button>
          </article>
        ))}
        {!documents.length && <p>Aún no hay documentos adjuntos en esta organización.</p>}
      </div>
      <PaginationBar page={docPage} totalItems={documents.length} onPageChange={setDocPage} />
      <small>Formatos permitidos: PDF, PNG, JPG, TXT y DOCX (máx. 20 MB). Los enlaces de descarga caducan tras unos minutos por seguridad.</small>
    </section>
  );
}

export function Workspace() {
  const [user, setUser] = useState(''); const [refreshToken, setRefreshToken] = useState(0);
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'done'>('idle');
  const refreshTimers = useRef<number[]>([]);
  useEffect(() => () => { refreshTimers.current.forEach(id => window.clearTimeout(id)); }, []);
  const handleRefresh = useCallback(() => {
    refreshTimers.current.forEach(id => window.clearTimeout(id));
    refreshTimers.current = [];
    setRefreshState('loading');
    setRefreshToken(n => n + 1);
    const t1 = window.setTimeout(() => {
      setRefreshState('done');
      const t2 = window.setTimeout(() => setRefreshState('idle'), 2000);
      refreshTimers.current.push(t2);
    }, 550);
    refreshTimers.current.push(t1);
  }, []);
  const [orgInfo, setOrgInfo] = useState<{ tenantId: string; role: string }>({ tenantId: '', role: '' });
  const [userProfile, setUserProfile] = useState<{ username?: string; name?: string; email?: string; role?: string; tenantId?: string; organizationName?: string }>({});
  const [entityNames, setEntityNames] = useState<Record<string, string>>({});
  const [syncAsResource, setSyncAsResource] = useState(true);
  const [assistantQuestion, setAssistantQuestion] = useState(''); const [assistantAnswer, setAssistantAnswer] = useState<any>(null); const [assistantBusy, setAssistantBusy] = useState(false);
  const [, setMobileNavOpen] = useState(false); const appPath = usePathname();
  const routeTabs: Record<string, string> = { portfolios: 'portfolio', projects: 'project', documents: 'documents', resources: 'resource', budgets: 'budget', priorities: 'priority', decisions: 'decisionlab', automations: 'automations', notifications: 'notifications', reports: 'reports', assistant: 'assistant', consulta: 'assistant', users: 'identity', tasks: 'tasks', assignments: 'assignments', expenses: 'expenses', rankings: 'rankings' };
  const tabRoutes: Record<string, string> = { dashboard: '/app', portfolio: '/app/portfolios', project: '/app/projects', documents: '/app/documents', resource: '/app/resources', budget: '/app/budgets', priority: '/app/priorities', identity: '/app/users', tasks: '/app/tasks', assignments: '/app/assignments', expenses: '/app/expenses', rankings: '/app/rankings', decisionlab: '/app/decisions', automations: '/app/automations', notifications: '/app/notifications', reports: '/app/reports', assistant: '/app/consulta' };
  const initialSegment = window.location.pathname.split('/')[2] || '';
  const [tab, setTab] = useState(routeTabs[initialSegment] || 'dashboard');
  function selectTab(next: string) { setTab(next); setMobileNavOpen(false); const route = tabRoutes[next] || '/app'; if (window.location.pathname !== route) navigate(route); }
  useEffect(() => { const segment = appPath.split('/')[2] || ''; setTab(routeTabs[segment] || 'dashboard'); }, [appPath]);
  const [items, setItems] = useState<Item[]>([]); const [form, setForm] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Item | null>(null); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [cursor, setCursor] = useState<string | null>(null); const [search, setSearch] = useState(''); const [page, setPage] = useState(1);
  const [overview, setOverview] = useState<Record<string, Item[]>>({});
  const [overviewErrors, setOverviewErrors] = useState<string[]>([]);
  const [referenceOptions, setReferenceOptions] = useState<Record<string, Item[]>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [taskProjects, setTaskProjects] = useState<Item[]>([]); const [taskProject, setTaskProject] = useState(''); const [tasks, setTasks] = useState<Item[]>([]); const [taskTitle, setTaskTitle] = useState(''); const [taskDueDate, setTaskDueDate] = useState(''); const [taskAssignee, setTaskAssignee] = useState(''); const [teamMembers, setTeamMembers] = useState<Item[]>([]);
  const [assignmentRows, setAssignmentRows] = useState<Item[]>([]); const [resourceRows, setResourceRows] = useState<Item[]>([]); const [projectRows, setProjectRows] = useState<Item[]>([]); const [assignmentForm, setAssignmentForm] = useState({ resourceId: '', projectId: '', allocation: '0.5' });
  const [budgetRows, setBudgetRows] = useState<Item[]>([]); const [expenseRows, setExpenseRows] = useState<Item[]>([]); const [expenseForm, setExpenseForm] = useState({ budgetId: '', description: '', amount: '', currency: 'USD' }); const [rankingRows, setRankingRows] = useState<Item[]>([]); const [priorityForm, setPriorityForm] = useState({ projectId: '', impact: '50', urgency: '50', risk: '50', alignment: '50' });
  const active = modules.find(m => m.key === tab); const dashboard = tab === 'dashboard';
  const pageTitles: Record<string, string> = { tasks: 'Tablero Kanban', documents: 'Documentos', assignments: 'Asignaciones', expenses: 'Gastos', rankings: 'Ranking', decisionlab: 'Decision Lab', automations: 'Automatizaciones', notifications: 'Notificaciones', reports: 'Reportes', assistant: 'Consulta de información' };
  const pageDescriptions: Record<string, string> = { dashboard: 'Proyectos, pendientes y decisiones en un mismo lugar.', documents: 'Adjunta y descarga archivos vinculados a tus proyectos.', automations: 'Programa y revisa el seguimiento de tu organización.', notifications: 'Administra cómo y cuándo quieres recibir avisos.', reports: 'Genera y descarga informes de tu organización.', assistant: 'Consulta rápidamente el estado de tus proyectos y presupuestos.' };
  const activeTitle = active?.title || pageTitles[tab] || tab;

  useEffect(() => {
    if (localAuth) {
      const stored = localStorage.getItem('cloudportfolio.user');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setUser(parsed.email || '');
          setOrgInfo({ tenantId: String(parsed.tenantId || ''), role: String(parsed.role || '') });
          setUserProfile({ username: parsed.id || parsed.email, name: parsed.name, email: parsed.email, role: parsed.role, tenantId: parsed.tenantId, organizationName: parsed.organizationName });
        } catch { localStorage.removeItem('cloudportfolio.user'); }
      }
    } else {
      getCurrentCognitoUser().then(u => {
        setUser(u.username);
        setUserProfile(prev => ({ ...prev, username: u.username }));
      }).catch(() => undefined);
      getCognitoOrganizationInfo().then(info => {
        setOrgInfo({ tenantId: info.tenantId, role: info.role });
        setUserProfile(prev => ({ ...prev, name: info.name, email: info.email, role: info.role, tenantId: info.tenantId }));
      }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const tenantId = userProfile.tenantId;
    if (!user || !tenantId || userProfile.organizationName) return;
    let activeOrgLookup = true;
    void request<{ name?: string }>('identity', `tenants/${encodeURIComponent(tenantId)}`)
      .then(data => {
        if (activeOrgLookup && data?.name) {
          setUserProfile(prev => ({ ...prev, organizationName: String(data.name).trim() }));
        }
      })
      .catch(() => undefined);
    return () => { activeOrgLookup = false; };
  }, [user, userProfile.tenantId, userProfile.organizationName]);

  const mergeEntityNames = useCallback((rowsList: Item[][], userRows?: Item[]) => {
    const patch: Record<string, string> = {};
    rowsList.forEach(list => {
      list.forEach(item => {
        const id = itemId(item);
        const label = String(item.name || item.email || '').trim();
        if (id && label) patch[id] = label;
      });
    });
    if (Object.keys(patch).length) {
      setEntityNames(prev => ({ ...prev, ...patch }));
    }
    if (userRows?.length) {
      setUserProfile(prev => {
        if (prev.name) return prev;
        const currentEmail = String(prev.email || (user.includes('@') ? user : '')).trim().toLowerCase();
        const matched = userRows.find(item => {
          const itemEmail = String(item.email || '').trim().toLowerCase();
          return (currentEmail && itemEmail === currentEmail) || (prev.username && itemId(item) === prev.username);
        });
        const matchedName = matched && typeof matched.name === 'string' ? matched.name.trim() : '';
        return matchedName ? { ...prev, name: matchedName } : prev;
      });
    }
  }, [user]);

  useEffect(() => {
    if (!user || dashboard) return;
    let activeLookup = true;
    const sources = [
      ['portfolio', 'portfolios'],
      ['project', 'projects'],
      ['identity', 'users'],
      ['resource', 'resources'],
    ] as const;
    void Promise.allSettled(sources.map(async ([mod, p]) => (await request<{ items: Item[] }>(mod, p)).items || [])).then(results => {
      if (!activeLookup) return;
      const fulfilled = results
        .filter((r): r is PromiseFulfilledResult<Item[]> => r.status === 'fulfilled')
        .map(r => r.value);
      const usersResult = results[2]?.status === 'fulfilled' ? results[2].value : undefined;
      mergeEntityNames(fulfilled, usersResult);
    });
    return () => { activeLookup = false; };
  }, [user, refreshToken, dashboard, mergeEntityNames]);

  const load = useCallback(async (next?: string) => {
    if (!active) return;
    setBusy(true); setError('');
    try {
      const data = await request<{ items: Item[]; nextCursor: string | null }>(active.key, `${active.path}${next ? `?cursor=${encodeURIComponent(next)}` : ''}`);
      setItems(next ? old => [...old, ...data.items] : data.items);
      setCursor(data.nextCursor);
      if (['portfolio', 'project', 'identity', 'resource'].includes(active.key)) {
        mergeEntityNames([data.items || []], active.key === 'identity' ? data.items : undefined);
      }
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [active, mergeEntityNames]);

  const loadOverview = useCallback(async () => {
    setBusy(true); setError('');
    const results = await Promise.allSettled(modules.map(async m => [m.key, (await request<{ items: Item[] }>(m.key, m.path)).items] as const));
    const available: Record<string, Item[]> = {}; const unavailable: string[] = [];
    results.forEach((result, index) => { if (result.status === 'fulfilled') available[result.value[0]] = result.value[1] || []; else unavailable.push(modules[index].title); });
    mergeEntityNames(
      [available.portfolio || [], available.project || [], available.identity || [], available.resource || []],
      available.identity,
    );
    setOverview(available); setOverviewErrors(unavailable); setBusy(false);
  }, [mergeEntityNames]);

  useEffect(() => { if (!user) return; setSearch(''); setFormOpen(false); if (dashboard) void loadOverview(); else void load(); }, [user, tab, dashboard, load, loadOverview, refreshToken]);

  useEffect(() => {
    if (!user) return;
    const rows = async (module: string, path: string) => (await request<{ items: Item[] }>(module, path)).items || [];
    if (tab === 'tasks') void Promise.all([rows('project', 'projects'), rows('identity', 'users')]).then(([data, members]) => { setTaskProjects(data); setTeamMembers(members); setTaskProject(current => current && data.some(p => itemId(p) === current) ? current : itemId(data[0] || {})); }).catch(e => setError(e instanceof Error ? e.message : 'No se pudieron cargar proyectos o integrantes.'));
    if (tab === 'assignments') void Promise.all([rows('resource', 'assignments'), rows('resource', 'resources'), rows('project', 'projects')]).then(([a, r, p]) => { setAssignmentRows(a); setResourceRows(r); setProjectRows(p); }).catch(e => setError(String(e)));
    if (tab === 'expenses') void Promise.all([rows('budget', 'budgets'), rows('budget', 'expenses'), rows('project', 'projects')]).then(([b, x, p]) => { setBudgetRows(b.filter(i => i.entityType !== 'Expense')); setExpenseRows(x); setProjectRows(p); }).catch(e => setError(String(e)));
    if (tab === 'rankings') { void request<{ items: Item[] }>('priority', 'rankings').then(data => setRankingRows(data.items || [])).catch(e => setError(String(e))); void rows('project', 'projects').then(setProjectRows).catch(e => setError(String(e))); }
  }, [user, tab, refreshToken]);

  useEffect(() => { if (!taskProject || tab !== 'tasks') return; void request<{ items: Item[] }>('project', `projects/${encodeURIComponent(taskProject)}/tasks`).then(data => setTasks(data.items || [])).catch(e => setError(String(e))); }, [taskProject, tab, refreshToken]);

  useEffect(() => {
    if (!user || !active) return;
    const refs = [{ field: 'portfolioId', module: 'portfolio', path: 'portfolios' }, { field: 'projectId', module: 'project', path: 'projects' }, { field: 'ownerId', module: 'identity', path: 'users' }].filter(ref => active.fields.includes(ref.field));
    let live = true; setReferenceOptions({});
    void Promise.allSettled(refs.map(async ref => [ref.field, (await request<{ items: Item[] }>(ref.module, ref.path)).items || []] as const)).then(results => { if (!live) return; setReferenceOptions(Object.fromEntries(results.filter((r): r is PromiseFulfilledResult<readonly [string, Item[]]> => r.status === 'fulfilled').map(r => r.value))); });
    return () => { live = false; };
  }, [user, active]);

  function startCreate() {
    setEditing(null);
    if (active?.key === 'identity') setForm({ role: 'MANAGER', status: 'ACTIVE', password: '' });
    else if (active?.key === 'resource') setForm({ type: 'person', capacity: '1', status: 'ACTIVE' });
    else if (active?.key === 'budget') setForm({ currency: 'USD', allocated: '0', spent: '0' });
    else if (active?.key === 'priority') setForm({ impact: '50', urgency: '50', risk: '50', alignment: '50' });
    else if (active?.key === 'portfolio' || active?.key === 'project') setForm({ status: 'ACTIVE' });
    else setForm({});
    setSyncAsResource(true);
    setNotice('');
    setFormOpen(true);
  }
  function startEdit(item: Item) {
    setFormOpen(true);
    const populate = (source: Item) => {
      const values: Record<string, string> = {};
      active?.fields.forEach(field => {
        values[field] = source[field] == null ? '' : String(source[field]);
      });
      setEditing(source);
      setForm(values);
    };
    populate(item);
    setNotice('');
    if (active && ['resource', 'budget', 'priority'].includes(active.key)) {
      const id = itemId(item);
      if (id) {
        void request<Item>(active.key, `${active.path}/${encodeURIComponent(id)}`)
          .then(fresh => {
            if (fresh && itemId(fresh) === id) populate(fresh);
          })
          .catch(() => {});
      }
    }
  }
  async function save(e: React.FormEvent) { e.preventDefault(); if (!active) return; setError(''); setNotice('');
    if (active.key === 'priority' && hasInvalidPriorityRange(form, false)) {
      setError('Los criterios de prioridad (Impacto, Urgencia, Riesgo y Alineación) deben estar entre 0 y 100.');
      return;
    }
    setBusy(true);
    try { const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()).map(([k, v]) => [k, ['allocated', 'spent', 'capacity', 'impact', 'urgency', 'risk', 'alignment'].includes(k) ? Number(v) : v]));
      if (editing) {
        delete payload.password;
        await request(active.key, `${active.path}/${encodeURIComponent(itemId(editing))}`, 'PATCH', payload);
      } else {
        await request(active.key, active.path, 'POST', payload);
        if (active.key === 'identity' && syncAsResource && payload.name) {
          await request('resource', 'resources', 'POST', { name: String(payload.name), type: 'person', capacity: 1, status: 'active' }).catch(() => {});
        }
      }
      setForm({}); setEditing(null); setFormOpen(false);
      setNotice(editing ? 'Cambios guardados.' : active.key === 'identity' ? (payload.password ? 'Integrante creado con acceso inmediato.' : 'Integrante registrado en la organización.') : 'Registro creado.');
      if (active.key === 'resource' || (active.key === 'identity' && !editing && syncAsResource)) {
        setAvailabilityTick(n => n + 1);
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const [confirmDelete, setConfirmDelete] = useState<Item | null>(null);
  const [objectivesPortfolio, setObjectivesPortfolio] = useState<Item | null>(null);
  const [milestonesProject, setMilestonesProject] = useState<Item | null>(null);
  const [summaryBudget, setSummaryBudget] = useState<Item | null>(null);
  const [detailTask, setDetailTask] = useState<Item | null>(null);
  const [confirmDeleteTask, setConfirmDeleteTask] = useState<Item | null>(null);
  const [availabilityTick, setAvailabilityTick] = useState(0);

  const userRole = String(orgInfo.role || userProfile.role || '').toUpperCase();
  const canWrite = userRole !== 'VIEWER';
  const isAdmin = userRole === 'ADMIN';

  const handleOrgUpdated = useCallback((orgName: string) => {
    setUserProfile(prev => (prev.organizationName === orgName ? prev : { ...prev, organizationName: orgName }));
  }, []);

  const reloadTasks = useCallback(async () => {
    if (!taskProject) return;
    const data = await request<{ items: Item[] }>('project', `projects/${encodeURIComponent(taskProject)}/tasks`);
    setTasks(data.items || []);
  }, [taskProject]);

  async function executeRemove(item: Item) {
    if (!active) return;
    setBusy(true);
    setError('');
    try {
      await request(active.key, `${active.path}/${encodeURIComponent(itemId(item))}`, 'DELETE');
      setNotice('Registro eliminado.');
      setConfirmDelete(null);
      if (active.key === 'resource') setAvailabilityTick(n => n + 1);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function executeDeleteTask(task: Item) {
    if (!taskProject || !task?.id) return;
    setBusy(true);
    setError('');
    try {
      await request('project', `projects/${encodeURIComponent(taskProject)}/tasks/${encodeURIComponent(String(task.id))}`, 'DELETE');
      setConfirmDeleteTask(null);
      await reloadTasks();
      setNotice('Tarea eliminada.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function createTask(e: React.FormEvent) { e.preventDefault(); if (!taskProject) return; setBusy(true); setError(''); try { await request('project', `projects/${encodeURIComponent(taskProject)}/tasks`, 'POST', { title: taskTitle, ...(taskDueDate ? { dueDate: taskDueDate } : {}), ...(taskAssignee ? { assigneeId: taskAssignee } : {}), idempotencyKey: crypto.randomUUID() }); setTaskTitle(''); setTaskDueDate(''); setTaskAssignee(''); const data = await request<{ items: Item[] }>('project', `projects/${encodeURIComponent(taskProject)}/tasks`); setTasks(data.items || []); setNotice('Tarea creada.'); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  async function moveTask(task: Item, status: string) { try { await request('project', `projects/${encodeURIComponent(taskProject)}/tasks/${encodeURIComponent(String(task.id))}`, 'PATCH', { status }); setTasks(old => old.map(x => x.id === task.id ? { ...x, status } : x)); } catch (e) { setError(String(e)); } }
  async function createAssignment(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await request('resource', 'assignments', 'POST', { ...assignmentForm, allocation: Number(assignmentForm.allocation) }); const data = await request<{ items: Item[] }>('resource', 'assignments'); setAssignmentRows(data.items || []); setAvailabilityTick(n => n + 1); setNotice('Asignación creada.'); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  async function createExpense(e: React.FormEvent) { e.preventDefault(); const budget = budgetRows.find(b => itemId(b) === expenseForm.budgetId); if (!budget) return; setBusy(true); setError(''); try { await request('budget', 'expenses', 'POST', { budgetId: expenseForm.budgetId, projectId: String(budget.projectId), description: expenseForm.description, amount: Number(expenseForm.amount), currency: String(budget.currency || expenseForm.currency || 'USD') }); const [expenses, budgets] = await Promise.all([request<any>('budget', 'expenses'), request<any>('budget', 'budgets')]); setExpenseRows(expenses.items || []); setBudgetRows((budgets.items || []).filter((x: Item) => x.entityType !== 'Expense')); setExpenseForm({ ...expenseForm, description: '', amount: '' }); setNotice('Gasto registrado.'); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  async function recalculatePriority(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (hasInvalidPriorityRange(priorityForm, true)) {
      setError('Los criterios de prioridad (Impacto, Urgencia, Riesgo y Alineación) deben estar entre 0 y 100.');
      return;
    }
    setBusy(true);
    try {
      await request('priority', 'priorities/recalculate', 'POST', {
        ...priorityForm,
        impact: Number(priorityForm.impact),
        urgency: Number(priorityForm.urgency),
        risk: Number(priorityForm.risk),
        alignment: Number(priorityForm.alignment),
      });
      const data = await request<{ items: Item[] }>('priority', 'rankings');
      setRankingRows(data.items || []);
      setNotice('Prioridad recalculada y ranking actualizado.');
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function askAssistant(question = assistantQuestion) { if (!question.trim()) return; setAssistantBusy(true); setAssistantAnswer(null); try { setAssistantAnswer(await request('project', 'intelligence/ask', 'POST', { question })); } catch (e) { setAssistantAnswer({ error: e instanceof Error ? e.message : String(e) }); } finally { setAssistantBusy(false); } }

  const specialView = tab === 'decisionlab' ? (
    <Suspense fallback={<div className="route-loading" role="status">Cargando Decision Lab…</div>}><DecisionLab request={request}/></Suspense>
  ) : tab === 'automations' ? (
    <FlowPanel refreshToken={refreshToken} entityNames={entityNames}/>
  ) : tab === 'notifications' ? (
    <NotificationCenter refreshToken={refreshToken}/>
  ) : tab === 'reports' ? (
    <ReportsPanel refreshToken={refreshToken}/>
  ) : tab === 'documents' ? (
    <DocumentsPanel refreshToken={refreshToken}/>
  ) : tab === 'assistant' ? (
    <>
      <section className="panel intelligence-panel" id="astra-intelligence"><div className="panelHeading"><div><h2><Sparkles size={18}/> ProFiles Insights</h2><span>Consultas rápidas de solo lectura sobre los proyectos y presupuestos de tu organización.</span></div><span className="mode-chip">CONSULTA RÁPIDA</span></div><form className="assistant-form" onSubmit={e=>{e.preventDefault();void askAssistant();}}><label className="sr-only" htmlFor="assistant-question">Pregunta para Inteligencia ProFiles</label><input id="assistant-question" maxLength={500} value={assistantQuestion} onChange={e=>setAssistantQuestion(e.target.value)} placeholder="¿Qué proyectos están atrasados?"/><button className="primary" disabled={assistantBusy||!assistantQuestion.trim()}>{assistantBusy?'Consultando…':<>Consultar <ArrowRight size={15}/></>}</button></form><div className="assistant-prompts">{['¿Qué proyectos están atrasados?','¿Qué presupuesto está cerca de agotarse?','Resume mis prioridades'].map(q=><button key={q} onClick={()=>{setAssistantQuestion(q);void askAssistant(q);}}>{q}</button>)}</div>{assistantBusy&&<p className="assistant-state" role="status">Consultando la información de tu organización…</p>}{assistantAnswer?.error&&<p className="error assistant-state" role="alert">{assistantAnswer.error}</p>}{assistantAnswer&&!assistantAnswer.error&&<div className="assistant-answer"><strong>Hechos consultados</strong><ul>{assistantAnswer.facts.map((fact:string,i:number)=><li key={i}>{fact}</li>)}</ul><strong>Sugerencias (no ejecutan cambios)</strong><ul>{assistantAnswer.suggestions.map((item:string,i:number)=><li key={i}>{item}</li>)}</ul>{assistantAnswer.relatedProjects?.length>0&&<><strong>Proyectos relacionados</strong><ul>{assistantAnswer.relatedProjects.map((item:any)=><li key={item.id}><a href="/app/projects">{item.name || 'Proyecto'}</a> · <StatusBadge value={item.status} /> · cierre {formatDate(item.endDate)}</li>)}</ul></>}{assistantAnswer.relatedTasks?.length>0&&<><strong>Tareas para revisar</strong><ul>{assistantAnswer.relatedTasks.map((item:any)=><li key={item.id}><a href="/app/tasks">{item.title || 'Tarea'}</a> · vence {formatDate(item.dueDate)}</li>)}</ul></>}<small>Basado en los registros actuales disponibles en tu organización.{assistantAnswer.unavailable.length?` Algunas áreas no estuvieron disponibles: ${assistantAnswer.unavailable.join(', ')}.`:''}</small></div>}</section>
      <OrbitalPanel request={request} canProposeTask={canWrite} />
    </>
  ) : tab === 'tasks' ? (
    <>
      <section className="panel">
        <div className="panelHeading">
          <div>
            <h2>Tablero Kanban</h2>
            <span>Organiza tareas operativas por proyecto y estado de ejecución</span>
          </div>
          <div className="kanban-project-picker">
            <CustomSelect
              value={taskProject}
              onChange={setTaskProject}
              ariaLabel="Proyecto activo"
              placeholder="Selecciona proyecto"
              options={[
                { value: '', label: 'Selecciona proyecto' },
                ...taskProjects.map(p => ({ value: itemId(p), label: readable(p.name) })),
              ]}
            />
          </div>
        </div>
        <form className="create" onSubmit={createTask}>
          <label>Nueva tarea<input required maxLength={180} value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Ej. Preparar cronograma"/></label>
          <label>Fecha de vencimiento<input type="date" value={taskDueDate} onChange={e => setTaskDueDate(e.target.value)}/></label>
          <label>
            Responsable
            <CustomSelect
              value={taskAssignee}
              onChange={setTaskAssignee}
              ariaLabel="Responsable de la nueva tarea"
              options={[
                { value: '', label: 'Sin asignar' },
                ...teamMembers.map(m => ({ value: itemId(m), label: readable(m.name || m.email) })),
              ]}
            />
          </label>
          <button disabled={busy || !taskProject}><Plus size={16}/>Crear</button>
        </form>
      </section>
      <div className="kanban">
        {([
          ['TODO', 'Por hacer'],
          ['IN_PROGRESS', 'En progreso'],
          ['BLOCKED', 'Bloqueadas'],
          ['DONE', 'Completadas'],
        ] as const).map(([s, t]) => {
          const colTasks = tasks.filter(x => x.status === s);
          return (
            <section className={`kanbanColumn kanban-col-${s.toLowerCase()}`} key={s}>
              <h2>
                <span className="kanban-col-title">
                  <span className={`status-dot dot-${s.toLowerCase()}`} aria-hidden="true" />
                  {t}
                </span>
                <span className="kanban-col-count">{colTasks.length}</span>
              </h2>
              {colTasks.map(x => {
                const overdue = isDateOverdue(x.dueDate, x.status);
                const assigneeMember = teamMembers.find(m => itemId(m) === x.assigneeId);
                return (
                  <article className={`taskCard ${overdue ? 'task-overdue' : ''}`} key={String(x.id)}>
                    <div className="taskCard-top">
                      <strong>{readable(x.title)}</strong>
                      <StatusBadge value={x.status} />
                    </div>
                    {(Boolean(x.dueDate) || Boolean(x.assigneeId)) && (
                      <div className="taskCard-meta">
                        {Boolean(x.dueDate) && (
                          <span className={`task-due ${overdue ? 'is-overdue' : ''}`}>
                            <CalendarDays size={13} />
                            {formatDate(x.dueDate)}
                            {overdue && <b>Vencida</b>}
                          </span>
                        )}
                        {Boolean(x.assigneeId) && (
                          <UserAvatar name={assigneeMember?.name || assigneeMember?.email || entityNames[String(x.assigneeId)] || x.assigneeId} size={22} />
                        )}
                      </div>
                    )}
                    <div className="taskCard-footer">
                      <div className="taskCard-status-control">
                        <CustomSelect
                          size="sm"
                          searchable={false}
                          ariaLabel={`Estado de ${readable(x.title)}`}
                          value={String(x.status)}
                          onChange={val => void moveTask(x, val)}
                          options={['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'].map(v => ({ value: v, label: formatTaskStatus(v) }))}
                        />
                      </div>
                      {s === 'TODO' && <button type="button" className="task-quick-btn" onClick={() => void moveTask(x, 'IN_PROGRESS')}>Iniciar</button>}
                      {s === 'IN_PROGRESS' && <button type="button" className="task-quick-btn complete" onClick={() => void moveTask(x, 'DONE')}>Completar</button>}
                      <div className="taskCard-actions">
                        <button
                          type="button"
                          className="taskCard-icon-btn"
                          title="Ver o editar tarea"
                          aria-label={`Editar ${readable(x.title)}`}
                          onClick={() => setDetailTask(x)}
                        >
                          <Pencil size={13} />
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            className="taskCard-icon-btn is-danger"
                            title="Eliminar tarea"
                            aria-label={`Eliminar ${readable(x.title)}`}
                            onClick={() => setConfirmDeleteTask(x)}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
              {!colTasks.length && <div className="kanban-empty">Sin tareas en esta columna</div>}
            </section>
          );
        })}
      </div>
      <TaskDetailModal
        projectId={taskProject}
        task={detailTask}
        teamMembers={teamMembers}
        onClose={() => setDetailTask(null)}
        onUpdated={reloadTasks}
        request={request}
        canWrite={canWrite}
        canDelete={isAdmin}
      />
      {confirmDeleteTask && (
        <Modal
          open={Boolean(confirmDeleteTask)}
          title="Eliminar tarea"
          subtitle="Esta acción no se puede deshacer."
          onClose={() => setConfirmDeleteTask(null)}
        >
          <div className="confirm-delete-box">
            <p className="confirm-delete-message">
              ¿Deseas eliminar permanentemente la tarea <strong>“{readable(confirmDeleteTask.title)}”</strong>?
            </p>
            <div className="modal-form-actions">
              <button type="button" className="secondary" onClick={() => setConfirmDeleteTask(null)}>Cancelar</button>
              <button type="button" className="danger" disabled={busy} onClick={() => void executeDeleteTask(confirmDeleteTask)}>
                {busy ? 'Eliminando…' : 'Eliminar tarea'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  ) : tab === 'assignments' ? (
    <>
      <section className="panel">
        <h2>Asignar recurso a proyecto</h2>
        <form className="create" onSubmit={createAssignment}>
          <label>
            Recurso
            <CustomSelect
              required
              value={assignmentForm.resourceId}
              onChange={val => setAssignmentForm({ ...assignmentForm, resourceId: val })}
              placeholder="Selecciona recurso"
              ariaLabel="Recurso a asignar"
              options={resourceRows.map(x => ({ value: itemId(x), label: readable(x.name) }))}
            />
          </label>
          <label>
            Proyecto
            <CustomSelect
              required
              value={assignmentForm.projectId}
              onChange={val => setAssignmentForm({ ...assignmentForm, projectId: val })}
              placeholder="Selecciona proyecto"
              ariaLabel="Proyecto asignado"
              options={projectRows.map(x => ({ value: itemId(x), label: readable(x.name) }))}
            />
          </label>
          <label>Asignación (1–100%)<input type="number" min="1" max="100" step="1" value={Math.round(Number(assignmentForm.allocation || 0) * 100)} onChange={e=>setAssignmentForm({...assignmentForm,allocation:String(Number(e.target.value)/100)})}/></label>
          <button disabled={busy}><UserPlus size={16}/>Asignar</button>
        </form>
      </section>
      <TeamAvailabilityPanel request={request} refreshToken={refreshToken + availabilityTick} />
      <DataTable title="Asignaciones" rows={assignmentRows} fields={['resourceId','projectId','allocation','startDate','endDate']} entityNames={entityNames}/>
    </>
  ) : tab === 'expenses' ? (
    <>
      <section className="panel">
        <h2>Registrar gasto</h2>
        <form className="create" onSubmit={createExpense}>
          <label>
            Presupuesto
            <CustomSelect
              required
              value={expenseForm.budgetId}
              onChange={val => setExpenseForm({ ...expenseForm, budgetId: val })}
              placeholder="Selecciona presupuesto"
              ariaLabel="Presupuesto asociado"
              options={budgetRows.map(x => ({
                value: itemId(x),
                label: `${entityNames[String(x.projectId)] || (isOpaqueId(x.projectId) ? 'Proyecto' : readable(x.projectId))} · ${readable(x.currency)}`,
              }))}
            />
          </label>
          <label>Descripción<input required value={expenseForm.description} onChange={e=>setExpenseForm({...expenseForm,description:e.target.value})}/></label>
          <label>Importe<input required type="number" min="0.01" step="0.01" value={expenseForm.amount} onChange={e=>setExpenseForm({...expenseForm,amount:e.target.value})}/></label>
          <button disabled={busy}><ReceiptText size={16}/>Registrar</button>
        </form>
      </section>
      <DataTable title="Gastos recientes" rows={expenseRows} fields={['description','projectId','amount','currency','createdAt']} entityNames={entityNames}/>
    </>
  ) : tab === 'rankings' ? (
    <>
      <section className="panel">
        <div className="panelHeading">
          <div>
            <h2>Recalcular prioridad</h2>
            <span>Escala de 0 a 100 por criterio · Mayor riesgo penaliza el puntaje final</span>
          </div>
          <span className={`priority-score-pill tone-${priorityScoreTone(computePriorityScore(priorityForm))}`}>
            Puntaje estimado: {computePriorityScore(priorityForm)} / 100
          </span>
        </div>
        <form className="create" onSubmit={recalculatePriority}>
          <label>
            Proyecto
            <CustomSelect
              required
              value={priorityForm.projectId}
              onChange={val => setPriorityForm({ ...priorityForm, projectId: val })}
              placeholder="Selecciona proyecto"
              ariaLabel="Proyecto a evaluar"
              options={projectRows.map(x => ({ value: itemId(x), label: readable(x.name) }))}
            />
          </label>
          {(['impact','urgency','risk','alignment'] as const).map(k => (
            <label key={k}>
              {k === 'impact' ? 'Impacto (0–100)' : k === 'urgency' ? 'Urgencia (0–100)' : k === 'risk' ? 'Riesgo (0–100 ↓)' : 'Alineación (0–100)'}
              <input type="number" min="0" max="100" step="1" value={priorityForm[k]} onChange={e=>setPriorityForm({...priorityForm,[k]:e.target.value})}/>
            </label>
          ))}
          <button disabled={busy}><ArrowUpDown size={16}/>Calcular</button>
        </form>
      </section>
      <DataTable title="Ranking de proyectos" rows={rankingRows} fields={['rank','projectId','score','impact','urgency','risk','alignment']} entityNames={entityNames}/>
    </>
  ) : null;

  const filtered = useMemo(() => items.filter(item => Object.values(item).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase()))), [items, search]);
  useEffect(() => { setPage(1); }, [tab, search]);
  const pagedFiltered = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);
  const projects = overview.project || []; const portfolios = overview.portfolio || []; const budgets = overview.budget || [];
  const activeProjectsCount = projects.filter(p => ['active', 'in_progress', 'in-progress'].includes(String(p.status || '').toLowerCase())).length;
  const completedProjectsCount = projects.filter(p => ['completed', 'complete', 'done'].includes(String(p.status || '').toLowerCase())).length;
  const overdueProjectsCount = projects.filter(p => p.endDate && String(p.endDate).slice(0, 10) < new Date().toLocaleDateString('sv-SE') && !['completed', 'complete', 'done'].includes(String(p.status).toLowerCase())).length;
  const overBudgetCount = budgets.filter(b => Number.isFinite(Number(b.allocated)) && Number.isFinite(Number(b.spent)) && Number(b.spent) > Number(b.allocated)).length;
  const attentionTotal = overdueProjectsCount + overBudgetCount;
  const projectHealthPct = projects.length ? Math.round(((activeProjectsCount + completedProjectsCount) / projects.length) * 100) : 0;

  return <div className="layout workspace-layout"><TopNav tab={tab} user={user} userProfile={userProfile} onNavigate={selectTab} onSignOut={async () => { if (localAuth) { localStorage.removeItem('cloudportfolio.accessToken'); localStorage.removeItem('cloudportfolio.user'); } else await signOutFromCognito(); setUser(''); navigate('/'); }}/>
    <main key={tab} className="workspace-view"><PageHeader eyebrow={`ProFiles / ${(dashboard ? 'VISIÓN GENERAL' : activeTitle).toUpperCase()}`} title={dashboard ? 'Resumen ejecutivo' : activeTitle} description={dashboard ? 'Proyectos, pendientes y decisiones en un mismo lugar.' : pageDescriptions[tab] || `Consulta y administra ${activeTitle.toLowerCase()} de tu organización.`} action={<button className="secondary" type="button" aria-live="polite" disabled={busy || refreshState === 'loading'} onClick={handleRefresh}><RefreshCw size={16} className={busy || refreshState === 'loading' ? 'spin' : ''} />{busy || refreshState === 'loading' ? 'Actualizando…' : refreshState === 'done' ? 'Actualizado' : 'Actualizar'}</button>}/>
      {error && <div className="error banner toast" role="alert">{error}<button aria-label="Cerrar error" onClick={() => setError('')}><X size={16} /></button></div>}{notice && <div className="notice banner toast" role="status">{notice}<button aria-label="Cerrar aviso" onClick={() => setNotice('')}><X size={16} /></button></div>}
      {dashboard ? <><section className="dashboard-overview" aria-label="Estado del espacio de trabajo"><div className="dashboard-welcome"><div><span className="welcome-eyebrow">{userProfile.organizationName || 'TU ESPACIO DE TRABAJO'}</span><h2>{userProfile.name ? `Hola, ${userProfile.name.split(/\s+/)[0]}` : 'Todo lo importante, en un lugar.'}</h2><p>{userProfile.name ? 'Todo lo importante de tu organización en un mismo lugar.' : 'Revisa tus proyectos y encuentra el siguiente paso para tu equipo.'}</p></div><div className="welcome-emblem" aria-hidden="true"><FolderKanban size={38}/><span><Sparkles size={17}/></span></div></div>
        {overviewErrors.length > 0 && <div className="overview-warning" role="status">No se pudieron consultar: {overviewErrors.join(', ')}. Los datos disponibles se muestran por separado.</div>}
        <div className="dashboard-kpis" aria-busy={busy}>
          <article>
            <div className="metric-icon sky"><FolderKanban size={23}/></div>
            <span>Proyectos registrados</span>
            <strong>{busy ? '...' : overview.project ? projects.length : '—'}</strong>
            <small>{overview.project ? `de ${projects.length} registrados · ${activeProjectsCount} activos` : 'Datos no disponibles'}</small>
            {overview.project && projects.length > 0 && (
              <div className="kpi-progress-bar" aria-hidden="true">
                <span className="kpi-progress-fill sky" style={{ width: `${Math.max(12, projectHealthPct)}%` }} />
              </div>
            )}
          </article>
          <article>
            <div className="metric-icon lavender"><Layers size={23}/></div>
            <span>Portafolios</span>
            <strong>{busy ? '...' : overview.portfolio ? portfolios.length : '—'}</strong>
            <small>Alcance visible para tu organización</small>
            {overview.portfolio && portfolios.length > 0 && (
              <div className="kpi-progress-bar" aria-hidden="true">
                <span className="kpi-progress-fill lavender" style={{ width: `${Math.min(100, portfolios.length * 20)}%` }} />
              </div>
            )}
          </article>
          <article>
            <div className="metric-icon coral"><CalendarDays size={23}/></div>
            <span>Necesita revisión</span>
            <strong>{busy ? '...' : overview.project && overview.budget ? attentionTotal : '—'}</strong>
            <small>Fechas vencidas o gasto sobre lo asignado</small>
            {overview.project && overview.budget && (
              <div className="kpi-progress-bar" aria-hidden="true">
                <span className={`kpi-progress-fill ${attentionTotal > 0 ? 'coral' : 'emerald'}`} style={{ width: attentionTotal > 0 ? `${Math.min(100, attentionTotal * 25)}%` : '100%' }} />
              </div>
            )}
          </article>
        </div>
        <section className="panel attention-panel"><div className="panelHeading"><div><h2>Qué necesita atención</h2><span>Elementos derivados de fechas y montos registrados</span></div><button className="textButton" onClick={() => selectTab('project')}>Revisar proyectos <ArrowRight size={14}/></button></div>
          <div className="attention-list">{projects.filter(p => p.endDate && String(p.endDate).slice(0, 10) < new Date().toLocaleDateString('sv-SE') && !['completed', 'complete', 'done'].includes(String(p.status).toLowerCase())).slice(0, 4).map((p, i) => <div className="attention-row" key={itemId(p) || i}><span className="attention-marker overdue"/><div><strong>{readable(p.name)}</strong><small>Fecha de cierre registrada: {formatDate(p.endDate)}</small></div><span className="attention-tag tag-overdue">Vencido</span></div>)}{budgets.filter(b => Number.isFinite(Number(b.allocated)) && Number.isFinite(Number(b.spent)) && Number(b.spent) > Number(b.allocated)).slice(0, 3).map((b, i) => <div className="attention-row" key={itemId(b) || i}><span className="attention-marker budget"/><div><strong>Presupuesto &middot; {entityNames[String(b.projectId)] || (isOpaqueId(b.projectId) ? 'Proyecto' : readable(b.projectId))}</strong><small>Gasto {formatCurrency(b.spent, b.currency)} supera monto asignado {formatCurrency(b.allocated, b.currency)} &middot; {readable(b.currency)}</small></div><span className="attention-tag tag-budget">Revisar</span></div>)}{overview.project && overview.budget && !projects.some(p => p.endDate && String(p.endDate).slice(0, 10) < new Date().toLocaleDateString('sv-SE') && !['completed', 'complete', 'done'].includes(String(p.status).toLowerCase())) && !budgets.some(b => Number.isFinite(Number(b.allocated)) && Number.isFinite(Number(b.spent)) && Number(b.spent) > Number(b.allocated)) && <div className="dashboard-empty"><strong>{busy ? 'Consultando registros...' : projects.length || budgets.length ? 'No se detectaron excepciones con los datos disponibles.' : 'A\u00fan no hay datos para revisar.'}</strong><span>{projects.length || budgets.length ? 'La lista refleja solo fechas y montos registrados.' : 'Crea un proyecto para comenzar a organizar el trabajo.'}</span></div>}</div>
          <div className="dashboard-actions"><button className="secondary" onClick={() => selectTab('project')}>Abrir proyectos</button><button className="secondary" onClick={() => selectTab('decisionlab')}>Comparar escenarios</button><button className="secondary" onClick={() => selectTab('automations')}>Ver automatizaciones</button></div>
        </section>
        <section className="dashboard-secondary-grid"><div className="panel"><div className="panelHeading"><div><h2><FolderKanban size={19}/> Proyectos destacados</h2><span>Proyectos recientes de tu organización</span></div><button className="textButton" onClick={() => selectTab('project')}>Ver todos <ArrowRight size={14}/></button></div>{!overview.project && !busy ? <div className="dashboard-empty">No se pudieron cargar los proyectos. Actualiza para reintentar.</div> : projects.length ? <div className="projectList">{projects.slice(0, 5).map((p, i) => <div className="projectRow" key={itemId(p) || i}><span className="projectIcon"><BriefcaseBusiness size={17}/></span><div className="projectName"><strong>{readable(p.name)}</strong><small>{entityNames[String(p.portfolioId)] || (isOpaqueId(p.portfolioId) ? 'Sin portafolio' : readable(p.portfolioId))} &middot; responsable {entityNames[String(p.ownerId)] || (isOpaqueId(p.ownerId) ? 'Sin asignar' : readable(p.ownerId))}</small></div><StatusBadge value={p.status || 'Planificación'} /></div>)}</div> : <div className="dashboard-empty"><strong>{busy ? 'Cargando proyectos…' : 'Todavía no hay proyectos.'}</strong><span>Cuando existan registros, aparecerán aquí.</span></div>}</div>
          <aside className="panel quick-actions"><h2><Sparkles size={19}/> Accesos directos</h2><button onClick={() => selectTab('project')}><FolderKanban size={16}/>Gestionar proyectos <ArrowRight size={14}/></button><button onClick={() => selectTab('decisionlab')}><Target size={16}/>Evaluar una decisión <ArrowRight size={14}/></button><button onClick={() => selectTab('automations')}><Workflow size={16}/>Programar seguimiento <ArrowRight size={14}/></button><button onClick={() => selectTab('reports')}><FileBarChart size={16}/>Consultar reportes <ArrowRight size={14}/></button></aside>
        </section><section className="panel timeline-panel"><div className="panelHeading"><div><h2>Próximos vencimientos</h2><span>Fechas de cierre registradas en proyectos visibles</span></div><CalendarDays size={18}/></div>{busy ? <div className="skeleton-line" role="status" aria-label="Cargando vencimientos"/> : !overview.project ? <p className="insight-empty">No se pudieron consultar los proyectos.</p> : projects.filter(p => typeof p.endDate === 'string' && p.endDate.slice(0,10) >= new Date().toLocaleDateString('sv-SE')).sort((a,b) => String(a.endDate).localeCompare(String(b.endDate))).slice(0,4).map((p,i) => <div className="insight-row" key={itemId(p)||i}><span>{readable(p.name)}</span><strong>{formatDate(p.endDate)}</strong></div>)}{!busy && overview.project && !projects.some(p => typeof p.endDate === 'string' && p.endDate.slice(0,10) >= new Date().toLocaleDateString('sv-SE')) && <p className="insight-empty">No hay fechas próximas registradas.</p>}</section><section className="panel timeline-panel"><div className="panelHeading"><div><h2>Actividad registrada</h2><span>Últimas actualizaciones disponibles de proyectos</span></div><Activity size={18}/></div>{busy ? <div className="skeleton-line" role="status" aria-label="Cargando actividad"/> : !overview.project ? <p className="insight-empty">No se pudo consultar la actividad.</p> : projects.filter(p => typeof p.updatedAt === 'string').sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,4).map((p,i) => <div className="insight-row" key={itemId(p)||i}><span>{readable(p.name)}</span><strong>{formatDate(p.updatedAt)}</strong></div>)}{!busy && overview.project && !projects.some(p => typeof p.updatedAt === 'string') && <p className="insight-empty">No hay actualizaciones registradas en los proyectos visibles.</p>}</section><div className="insight-grid">
          <section className="panel insight-card"><div className="panelHeading"><div><h2><Wallet size={19}/> Presupuestos</h2><span>Montos registrados por proyecto</span></div><button className="textButton" onClick={() => selectTab('budget')}>Abrir <ArrowRight size={14}/></button></div>{busy ? <div className="skeleton-line" role="status" aria-label="Cargando presupuestos"/> : !overview.budget ? <p className="insight-empty">No se pudo consultar esta información.</p> : budgets.length ? budgets.slice(0,3).map((b,i) => { const alloc = Number(b.allocated) || 0; const sp = Number(b.spent) || 0; const pct = alloc > 0 ? Math.min(100, Math.round((sp / alloc) * 100)) : 0; const over = alloc > 0 && sp > alloc; return <div className="insight-budget-item" key={itemId(b)||i}><div className="insight-row"><span>{entityNames[String(b.projectId)] || (isOpaqueId(b.projectId) ? 'Proyecto' : readable(b.projectId))}</span><strong>{formatCurrency(b.spent, b.currency)} / {formatCurrency(b.allocated, b.currency)}</strong></div><div className="inline-meter-track"><span className={`inline-meter-fill ${over ? 'fill-rose' : pct >= 80 ? 'fill-amber' : 'fill-emerald'}`} style={{ width: `${pct}%` }} /></div></div>; }) : <p className="insight-empty">Agrega un presupuesto para empezar el seguimiento.</p>}</section>
          <section className="panel insight-card"><div className="panelHeading"><div><h2><Users size={19}/> Equipo y recursos</h2><span>Integrantes y recursos activos</span></div><button className="textButton" onClick={() => selectTab('resource')}>Abrir <ArrowRight size={14}/></button></div>{busy ? <div className="skeleton-line" role="status" aria-label="Cargando recursos"/> : !overview.resource ? <p className="insight-empty">No se pudo consultar esta información.</p> : overview.resource.length ? overview.resource.slice(0,3).map((r,i) => <div className="insight-row" key={itemId(r)||i}><UserAvatar name={r.name} size={24} /><StatusBadge value={r.status} /></div>) : <p className="insight-empty">Aún no hay recursos registrados.</p>}</section>
          <section className="panel insight-card"><div className="panelHeading"><div><h2>ProFiles Insights</h2><span>Señales basadas en tus registros</span></div><Sparkles size={18}/></div><p className="insight-empty">Revisa fechas vencidas y presupuestos que superan lo asignado con base en los datos visibles.</p><button className="textButton" onClick={() => selectTab('assistant')}>Explorar información <ArrowRight size={14}/></button></section>
        </div><div className="dataNote"><Activity size={16}/> Resumen calculado con los registros actuales de tu organización. Los importes se muestran por registro en su moneda original.</div>
      </section></> : active ? <>
        <div className="module-intro"><div><span className="module-kicker">TU ESPACIO DE TRABAJO</span><h2>{active.title}</h2><p>{active.key === 'identity' ? 'Agrega integrantes a tu organización, define su nivel de acceso y habilítalos para colaborar en proyectos.' : 'Consulta y organiza los registros disponibles para tu equipo.'}</p></div><button className="primary" onClick={startCreate}><Plus size={16}/> {active.key === 'identity' ? 'Nuevo miembro' : 'Nuevo registro'}</button></div>
        {active.key === 'identity' && (
          <OrganizationProfileBanner
            tenantId={orgInfo.tenantId}
            organizationName={userProfile.organizationName}
            isAdmin={isAdmin}
            request={request}
            refreshToken={refreshToken}
            onOrganizationUpdated={handleOrgUpdated}
          />
        )}
        <Modal
          open={formOpen}
          title={editing ? (active.key === 'budget' ? 'Editar presupuesto de proyecto' : `Editar ${active.title.toLowerCase()}`) : active.key === 'identity' ? 'Agregar miembro a la organización' : active.key === 'budget' ? 'Asignar presupuesto a proyecto' : `Crear registro en ${active.title}`}
          subtitle={active.key === 'identity' ? 'La persona compartirá los portafolios y proyectos de tu organización según su nivel de acceso.' : active.key === 'budget' ? 'Define el techo financiero asignado y el gasto ejecutado acumulado para el proyecto seleccionado.' : active.key === 'priority' ? 'Evalúa el proyecto en una escala de 0 a 100 por criterio. Mayor riesgo penaliza el puntaje final.' : 'Completa la información para guardar este registro en tu organización.'}
          onClose={() => { setFormOpen(false); setEditing(null); }}
        >
          <form className="create modal-form" onSubmit={save}>
            <div className="modal-fields-grid">
              {active.fields.map(field => {
                const customLabel = active.key === 'budget' ? (
                  field === 'projectId' ? 'Proyecto presupuestado' :
                  field === 'allocated' ? 'Presupuesto techo asignado (Límite financiero)' :
                  field === 'spent' ? 'Gasto ejecutado acumulado a la fecha' :
                  field === 'currency' ? 'Moneda del presupuesto' : fieldLabel(field)
                ) : active.key === 'priority' ? (
                  field === 'projectId' ? 'Proyecto a priorizar' :
                  field === 'impact' ? 'Impacto (0–100 · peso 35%)' :
                  field === 'urgency' ? 'Urgencia (0–100 · peso 25%)' :
                  field === 'risk' ? 'Riesgo (0–100 · penaliza 15%)' :
                  field === 'alignment' ? 'Alineación (0–100 · peso 25%)' : fieldLabel(field)
                ) : active.key === 'resource' && field === 'capacity' ? 'Capacidad disponible (25%–100%)' : fieldLabel(field);

                return (
                <label key={field}>
                  {customLabel}{active.required.includes(field) ? ' *' : ''}
                  {referenceOptions[field]?.length ? (
                    <CustomSelect
                      required={active.required.includes(field)}
                      value={form[field] || ''}
                      onChange={val => setForm({ ...form, [field]: val })}
                      placeholder="Selecciona"
                      ariaLabel={customLabel}
                      options={[
                        { value: '', label: 'Selecciona' },
                        ...referenceOptions[field].map(item => ({
                          value: itemId(item),
                          label: readable(item.name || item.email || itemId(item)),
                        })),
                        ...(form[field] && !referenceOptions[field].some(item => itemId(item) === form[field])
                          ? [{ value: form[field], label: 'Valor actual' }]
                          : []),
                      ]}
                    />
                  ) : field === 'role' ? (
                    <CustomSelect
                      required={active.required.includes(field)}
                      value={form[field] || 'MANAGER'}
                      onChange={val => setForm({ ...form, [field]: val })}
                      ariaLabel="Rol"
                      options={[
                        { value: 'MANAGER', label: 'Gestor', description: 'Crea y edita proyectos y tareas' },
                        { value: 'VIEWER', label: 'Solo lectura', description: 'Consulta sin realizar cambios' },
                        { value: 'ADMIN', label: 'Administrador', description: 'Control completo de la organización' },
                      ]}
                    />
                  ) : field === 'type' && active.key === 'resource' ? (
                    <CustomSelect
                      required={active.required.includes(field)}
                      value={form[field] || 'person'}
                      onChange={val => setForm({ ...form, [field]: val })}
                      ariaLabel="Tipo de recurso"
                      options={[
                        { value: 'person', label: 'Persona / Especialista' },
                        { value: 'team', label: 'Equipo / Célula' },
                        { value: 'equipment', label: 'Equipamiento / Licencia' },
                      ]}
                    />
                  ) : field === 'capacity' && active.key === 'resource' ? (
                    <CustomSelect
                      required={active.required.includes(field)}
                      value={form[field] || '1'}
                      onChange={val => setForm({ ...form, [field]: val })}
                      ariaLabel="Capacidad"
                      options={[
                        { value: '1', label: '100%', description: 'Tiempo completo' },
                        { value: '0.75', label: '75%', description: 'Tres cuartos' },
                        { value: '0.5', label: '50%', description: 'Medio tiempo' },
                        { value: '0.25', label: '25%', description: 'Cuarto de tiempo' },
                      ]}
                    />
                  ) : field === 'currency' ? (
                    <CustomSelect
                      required={active.required.includes(field)}
                      value={form[field] || 'USD'}
                      onChange={val => setForm({ ...form, [field]: val })}
                      ariaLabel="Moneda"
                      options={[
                        { value: 'USD', label: 'USD (Dólares)' },
                        { value: 'PEN', label: 'PEN (Soles)' },
                        { value: 'EUR', label: 'EUR (Euros)' },
                      ]}
                    />
                  ) : field === 'status' ? (
                    <CustomSelect
                      required={active.required.includes(field)}
                      value={form[field] || 'ACTIVE'}
                      onChange={val => setForm({ ...form, [field]: val })}
                      placeholder="Selecciona estado"
                      ariaLabel="Estado"
                      options={[
                        { value: 'ACTIVE', label: 'Activo' },
                        { value: 'PLANNED', label: 'Planificado' },
                        { value: 'IN_PROGRESS', label: 'En progreso' },
                        { value: 'ON_HOLD', label: 'En pausa' },
                        { value: 'COMPLETED', label: 'Completado' },
                        { value: 'BLOCKED', label: 'Bloqueado' },
                      ]}
                    />
                  ) : active.key === 'priority' && ['impact', 'urgency', 'risk', 'alignment'].includes(field) ? (
                    <div className={`priority-metric-control${field === 'risk' ? ' is-risk' : ''}`}>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        aria-label={`${customLabel} control deslizante`}
                        value={clampPriorityValue(form[field])}
                        onChange={e => setForm({ ...form, [field]: e.target.value })}
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        inputMode="numeric"
                        value={form[field] ?? ''}
                        onChange={e => setForm({ ...form, [field]: e.target.value })}
                        placeholder="0–100"
                      />
                      <span className="priority-metric-unit">/100</span>
                    </div>
                  ) : (
                    <input
                      required={active.required.includes(field)}
                      type={['allocated', 'spent', 'capacity', 'impact', 'urgency', 'risk', 'alignment'].includes(field) ? 'number' : field === 'email' ? 'email' : field.endsWith('Date') ? 'date' : 'text'}
                      min={field === 'allocated' || field === 'spent' ? 0 : undefined}
                      step={['allocated', 'spent', 'capacity', 'impact', 'urgency', 'risk', 'alignment'].includes(field) ? 'any' : undefined}
                      value={form[field] || ''}
                      onChange={e => setForm({ ...form, [field]: e.target.value })}
                      placeholder={customLabel}
                    />
                  )}
                </label>
              ); })}
              {active.key === 'identity' && !editing && (
                <div className="modal-extra-section">
                  <label>
                    Contraseña inicial de acceso (opcional)
                    <input
                      type="password"
                      minLength={12}
                      maxLength={256}
                      value={form.password || ''}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      placeholder="Mínimo 12 caracteres"
                    />
                  </label>
                  <small>Si defines una contraseña (mín. 12 caracteres, mayúscula, minúscula, número y símbolo), la persona podrá iniciar sesión de inmediato con su correo.</small>
                  <label className="check-label">
                    <input type="checkbox" checked={syncAsResource} onChange={e => setSyncAsResource(e.target.checked)} />
                    Registrar también en Recursos para asignarlo a proyectos y capacidad
                  </label>
                </div>
              )}
            </div>

            {active.key === 'budget' && (
              <div className="budget-live-summary">
                <div className="budget-summary-header">
                  <span>Balance financiero proyectado</span>
                  <strong>{form.currency || 'USD'}</strong>
                </div>
                <div className="budget-summary-grid">
                  <div>
                    <span>Techo asignado</span>
                    <b>{formatCurrency(form.allocated || 0, form.currency || 'USD')}</b>
                  </div>
                  <div>
                    <span>Gasto ejecutado</span>
                    <b>{formatCurrency(form.spent || 0, form.currency || 'USD')}</b>
                  </div>
                  <div>
                    <span>Saldo restante</span>
                    <b className={(Number(form.allocated || 0) - Number(form.spent || 0)) < 0 ? 'text-danger' : 'text-success'}>
                      {formatCurrency(Number(form.allocated || 0) - Number(form.spent || 0), form.currency || 'USD')}
                    </b>
                  </div>
                </div>
                {Number(form.allocated) > 0 && (
                  <div className="budget-live-bar-wrap">
                    <div className="budget-live-bar-meta">
                      <span>Consumo del presupuesto: {Math.round((Number(form.spent || 0) / Number(form.allocated)) * 100)}%</span>
                      {Number(form.spent || 0) > Number(form.allocated) && <span className="budget-over-tag">SOBREPRESUPUESTO</span>}
                    </div>
                    <div className="inline-meter-track">
                      <span
                        className={`inline-meter-fill ${Number(form.spent || 0) > Number(form.allocated) ? 'fill-rose' : (Number(form.spent || 0) / Number(form.allocated)) > 0.8 ? 'fill-amber' : 'fill-emerald'}`}
                        style={{ width: `${Math.min(100, Math.round((Number(form.spent || 0) / Number(form.allocated)) * 100))}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {active.key === 'priority' && (() => {
              const previewScore = computePriorityScore(form);
              const scoreTone = priorityScoreTone(previewScore);
              return (
                <div className="priority-live-summary">
                  <div className="priority-summary-header">
                    <span>Puntaje proyectado</span>
                    <span className={`priority-score-pill tone-${scoreTone}`}>{previewScore} / 100</span>
                  </div>
                  <div className="inline-meter-track">
                    <span className={`inline-meter-fill fill-${scoreTone}`} style={{ width: `${previewScore}%` }} />
                  </div>
                  <p className="priority-formula-note">
                    Fórmula: 35% Impacto + 25% Urgencia + 25% Alineación + 15% (100 − Riesgo). Valores válidos de 0 a 100.
                  </p>
                </div>
              );
            })()}

            <div className="modal-form-actions">
              <button type="button" className="secondary" onClick={() => { setFormOpen(false); setEditing(null); }}>Cancelar</button>
              <button type="submit" className="primary" disabled={busy}><Plus size={17} />{busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear registro'}</button>
            </div>
          </form>
        </Modal>

        {confirmDelete && (
          <Modal
            open={Boolean(confirmDelete)}
            title="Confirmar eliminación"
            subtitle="Esta acción no se puede deshacer."
            onClose={() => setConfirmDelete(null)}
          >
            <div className="confirm-delete-box">
              <p className="confirm-delete-message">
                ¿Estás seguro de que deseas eliminar permanentemente <strong>"{readable(confirmDelete.name ?? entityNames[String(confirmDelete.projectId)] ?? (isOpaqueId(confirmDelete.projectId) ? 'este registro' : confirmDelete.projectId) ?? 'este registro')}"</strong> de tu organización?
              </p>
              <small className="confirm-delete-subtext">El registro dejará de estar disponible para todos los integrantes de tu organización.</small>
              <div className="modal-form-actions">
                <button type="button" className="secondary" onClick={() => setConfirmDelete(null)}>Cancelar</button>
                <button type="button" className="danger" disabled={busy} onClick={() => void executeRemove(confirmDelete)}>
                  {busy ? 'Eliminando…' : 'Eliminar permanentemente'}
                </button>
              </div>
            </div>
          </Modal>
        )}

        <section className="panel"><div className="panelHeading listHeading"><div><h2>Registros</h2><span>{filtered.length} {filtered.length === 1 ? 'registro' : 'registros'}</span></div><label className="searchBox"><Search size={16} /><input aria-label="Buscar registros" placeholder="Buscar…" value={search} onChange={e => setSearch(e.target.value)} /></label></div><div className="tableWrap"><table><thead><tr>{active.fields.slice(0, 4).map(f => <th key={f}>{fieldLabel(f)}</th>)}<th>Acciones</th></tr></thead><tbody>{pagedFiltered.map((item, i) => <tr key={itemId(item) || i}>{active.fields.slice(0, 4).map(f => <td key={f}>{renderFormattedCell(f, item, entityNames)}</td>)}<td><div className="rowActions">{active.key === 'portfolio' && <button type="button" onClick={() => setObjectivesPortfolio(item)}><Target size={13} />Objetivos</button>}{active.key === 'project' && <><button type="button" onClick={() => { setTaskProject(itemId(item)); selectTab('tasks'); }}>Tareas</button><button type="button" onClick={() => setMilestonesProject(item)}><Flag size={13} />Hitos</button><button type="button" onClick={() => { setAssignmentForm(old => ({ ...old, projectId: itemId(item) })); selectTab('assignments'); }}>Equipo</button></>}{active.key === 'budget' && <button type="button" onClick={() => setSummaryBudget(item)}><PieChart size={13} />Resumen</button>}<button onClick={() => startEdit(item)}>Editar</button><button className="deleteAction" onClick={() => setConfirmDelete(item)}>Eliminar</button></div></td></tr>)}</tbody></table>{!filtered.length && <div className="empty">{busy ? 'Cargando registros…' : search ? 'No hay resultados para esta búsqueda.' : 'No hay registros todavía. Crea uno para comenzar.'}</div>}</div><PaginationBar page={page} totalItems={filtered.length} onPageChange={setPage} hasMore={Boolean(cursor)} busy={busy} onLoadMore={() => { if (cursor) void load(cursor); }} /></section>

        {active.key === 'resource' && <TeamAvailabilityPanel request={request} refreshToken={refreshToken + availabilityTick} />}
        {active.key === 'identity' && (
          <MembershipsPanel
            isAdmin={isAdmin}
            users={items}
            entityNames={entityNames}
            request={request}
            refreshToken={refreshToken}
            onChanged={() => setRefreshToken(n => n + 1)}
          />
        )}

        <PortfolioObjectivesModal
          portfolio={objectivesPortfolio}
          onClose={() => setObjectivesPortfolio(null)}
          request={request}
          canWrite={canWrite}
          canDelete={isAdmin}
        />
        <ProjectMilestonesModal
          project={milestonesProject}
          onClose={() => setMilestonesProject(null)}
          request={request}
          canWrite={canWrite}
          canDelete={isAdmin}
        />
        <BudgetSummaryModal
          budget={summaryBudget}
          projectName={summaryBudget ? (entityNames[String(summaryBudget.projectId)] || '') : ''}
          onClose={() => setSummaryBudget(null)}
          onRegisterExpense={budgetId => {
            setExpenseForm(old => ({ ...old, budgetId }));
            selectTab('expenses');
          }}
          request={request}
        />
      </> : specialView}
    </main></div>;
}

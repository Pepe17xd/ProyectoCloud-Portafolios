import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, ArrowUpDown, BarChart3, BriefcaseBusiness, CalendarDays, Check, Copy, FileBarChart, FolderKanban, Layers, Plus, ReceiptText, RefreshCw, Search, Sparkles, Target, UserPlus, Users, Wallet, Workflow, X } from 'lucide-react';
import { localAuth, request } from '../../api/client';
import { getCurrentCognitoUser, getCognitoOrganizationInfo, signOutFromCognito } from '../../auth/cognito';
import TopNav from './TopNav';
import PageHeader from '../../components/PageHeader';
import Modal from '../../components/Modal';
import { formatCurrency, formatDate, isDateOverdue, StatusBadge, UserAvatar } from '../../components/StatusBadge';
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
function itemId(item: Item) { return typeof item.sk === 'string' ? item.sk.replace(/^ITEM#/, '') : String(item.id || ''); }
function readable(value: unknown) { return value === undefined || value === null || value === '' ? '—' : String(value); }

function renderFormattedCell(field: string, row: Item, entityNames: Record<string, string> = {}) {
  const val = row[field];
  if (val === undefined || val === null || val === '') return <span className="muted-cell">—</span>;
  if (field === 'status' || field === 'role') {
    return <StatusBadge value={val} />;
  }
  if (field === 'ownerId' || field === 'resourceId' || field === 'assigneeId') {
    const resolved = entityNames[String(val)] || val;
    return <UserAvatar name={resolved} />;
  }
  if (field === 'portfolioId' || field === 'projectId') {
    return <strong>{entityNames[String(val)] || readable(val)}</strong>;
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

function CopyIdBadge({ id, full = false }: { id: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <span className="muted-cell">—</span>;
  const short = full ? id : id.slice(0, 12);
  return (
    <button
      type="button"
      className="copy-id-btn"
      title={`Copiar ID: ${id}`}
      onClick={() => {
        void navigator.clipboard?.writeText(id);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      <span>{short}</span>
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function DataTable({ title, rows, fields, entityNames = {} }: { title: string; rows: Item[]; fields: string[]; entityNames?: Record<string, string> }) {
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
            {rows.map((row, i) => (
              <tr key={itemId(row) || i}>
                {fields.map(f => <td key={f}>{renderFormattedCell(f, row, entityNames)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">No hay registros todavía.</div>}
      </div>
    </section>
  );
}

function NotificationCenter() {
  const [prefs, setPrefs] = useState<any>({ enabled: false, timezone: 'America/Lima', allowedHours: { start: '08:00', end: '18:00' }, frequency: 'immediate', alertTypes: [], emailConsent: false });
  const [emailChannel, setEmailChannel] = useState<any>({ status: 'unavailable', providerAvailable: false, alertTypes: [], items: [] });
  const [inbox, setInbox] = useState<any[]>([]); const [consent, setConsent] = useState(false); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const types = ['ProjectCreated','ProjectUpdated','ProjectCompleted','BudgetThresholdExceeded','ResourceAssigned','PriorityRecalculated'];
  const emailTypes = ['ReminderDue','AutomationReport','RiskAlert','WeeklySummary'];
  const emailLabels:Record<string,string> = { ReminderDue:'Recordatorios', AutomationReport:'Resúmenes de automatización', RiskAlert:'Alertas de riesgo', WeeklySummary:'Resumen semanal' };
  const load = useCallback(async () => { const [p, i, e] = await Promise.all([request('identity','notifications/preferences'),request<any>('identity','notifications/inbox'),request<any>('identity','notifications/email')]); setPrefs(p); setInbox(i.items || []); setEmailChannel(e); setConsent(Boolean(e.consent)); }, []);
  useEffect(() => { void load().catch(e => setMessage(e instanceof Error ? e.message : String(e))); }, [load]);
  async function save(e:React.FormEvent) { e.preventDefault(); setBusy(true); setMessage(''); try { await request('identity','notifications/preferences','PUT',prefs); await load(); setMessage('Preferencias guardadas para tu usuario autenticado.'); } catch(e) { setMessage(e instanceof Error?e.message:String(e)); } finally { setBusy(false); } }
  async function subscribeEmail() { setBusy(true); setMessage(''); try { const result=await request<any>('identity','notifications/email/subscribe','POST',{consent,consentVersion:'profiles-email-2026-01'}); setMessage(result.message); await load(); } catch(e) { setMessage(e instanceof Error?e.message:String(e)); } finally { setBusy(false); } }
  async function revokeEmail() { setBusy(true); try { await request('identity','notifications/email','DELETE'); await load(); setMessage('Consentimiento revocado y suscripción de correo cancelada.'); } catch(e) { setMessage(e instanceof Error?e.message:String(e)); } finally { setBusy(false); } }
  async function saveEmailPreferences(e:React.FormEvent) { e.preventDefault(); setBusy(true); try { await request('identity','notifications/email/preferences','PUT',{alertTypes:emailChannel.alertTypes||[]}); await load(); setMessage('Preferencias de correo guardadas.'); } catch(e) { setMessage(e instanceof Error?e.message:String(e)); } finally { setBusy(false); } }
  const statusLabels:Record<string,string> = { unavailable:'Canal de correo no disponible', 'not-configured':'Sin configurar','pending-confirmation':'Confirmación pendiente en tu bandeja',active:'Activo',revoked:'Desactivado' };
  const deliveryLabels:Record<string,string> = { REQUESTED:'Solicitado',SENT_TO_SNS:'Enviado por Amazon SNS',SIMULATED_LOCAL:'Simulado localmente',FAILED:'Fallido',BLOCKED:'Bloqueado',UNAVAILABLE:'No disponible' };
  return <section className="panel notification-panel"><div className="panelHeading"><div><h2>Notificaciones</h2><span>El buzón interno sigue disponible de forma independiente al correo electrónico.</span></div><span className="mode-chip">{emailChannel.providerAvailable?(statusLabels[emailChannel.status]||emailChannel.status):'Correo no disponible'}</span></div><form className="notification-form" onSubmit={save}><label className="check-label"><input type="checkbox" checked={Boolean(prefs.enabled)} onChange={e=>setPrefs({...prefs,enabled:e.target.checked})}/> Activar alertas en el buzón interno</label><div className="notification-options"><label>Zona horaria<input value={prefs.timezone||'America/Lima'} onChange={e=>setPrefs({...prefs,timezone:e.target.value})}/></label><label>Horario desde<input type="time" value={prefs.allowedHours?.start||'08:00'} onChange={e=>setPrefs({...prefs,allowedHours:{...prefs.allowedHours,start:e.target.value}})}/></label><label>Hasta<input type="time" value={prefs.allowedHours?.end||'18:00'} onChange={e=>setPrefs({...prefs,allowedHours:{...prefs.allowedHours,end:e.target.value}})}/></label></div><fieldset><legend>Eventos para el buzón interno</legend><div className="notification-types">{types.map(type=><label className="check-label" key={type}><input type="checkbox" checked={(prefs.alertTypes||[]).includes(type)} onChange={e=>setPrefs({...prefs,alertTypes:e.target.checked?[...new Set([...(prefs.alertTypes||[]),type])]:prefs.alertTypes.filter((x:string)=>x!==type)})}/>{type}</label>)}</div></fieldset><button className="secondary" disabled={busy}>Guardar preferencias</button></form><div className="notification-email"><div className="email-intro"><span className="email-label">CANAL DE CORREO (AMAZON SNS)</span><h3>Recibe recordatorios y alertas por correo electrónico</h3><p>Elige qué avisos quieres recibir en el correo de tu perfil y mantén el control de tu suscripción.</p></div><div className="email-status-grid" aria-label="Estado del canal de correo"><div><span>Disponibilidad</span><strong>{emailChannel.providerAvailable ? 'Amazon SNS activo' : 'No disponible'}</strong></div><div><span>Consentimiento</span><strong>{emailChannel.consent ? 'Aceptado' : 'No otorgado'}</strong></div><div><span>Suscripción</span><strong>{emailChannel.status === 'active' ? 'Confirmada' : emailChannel.status === 'pending-confirmation' ? 'Pendiente de confirmar' : 'Sin activar'}</strong></div><div><span>Correo destino</span><strong>{emailChannel.email || 'Correo de tu cuenta'}</strong></div></div><p>{emailChannel.providerAvailable?'Al activarlo, Amazon SNS enviará un correo de confirmación al email de tu perfil.':'El canal requiere que el modo de notificaciones esté activo. El buzón interno no depende de esta configuración.'}</p>{!emailChannel.providerAvailable?<p role="status">El canal de correo todavía no está disponible. Puedes seguir usando las notificaciones internas.</p>:<><form className="notification-form" onSubmit={saveEmailPreferences}><div className="notification-options"><label className="check-label"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={['active','pending-confirmation'].includes(emailChannel.status)}/> Acepto recibir recordatorios y alertas por correo electrónico. Puedo cancelar la suscripción cuando quiera.</label></div>{!['active','pending-confirmation'].includes(emailChannel.status)&&<button className="secondary" type="button" disabled={busy||!consent} onClick={()=>void subscribeEmail()}>Activar notificaciones por correo</button>}{emailChannel.status==='pending-confirmation'&&<p role="status">Revisa tu bandeja de entrada y haz clic en Confirm subscription en el correo enviado por Amazon SNS.</p>}{['active','pending-confirmation'].includes(emailChannel.status)&&<><fieldset><legend>Qué correos quieres recibir</legend><div className="notification-types">{emailTypes.map(type=><label className="check-label" key={type}><input type="checkbox" checked={(emailChannel.alertTypes||[]).includes(type)} onChange={e=>setEmailChannel({...emailChannel,alertTypes:e.target.checked?[...new Set([...(emailChannel.alertTypes||[]),type])]:emailChannel.alertTypes.filter((x:string)=>x!==type)})}/>{emailLabels[type]}</label>)}</div></fieldset><button className="secondary" disabled={busy}>Guardar tipos de correo</button></>}</form>{['active','pending-confirmation'].includes(emailChannel.status)&&<button className="textButton" disabled={busy} onClick={()=>void revokeEmail()}>Cancelar suscripción de correo</button>}</>}{message&&<p className="assistant-state" role="status">{message}</p>}<div className="notification-inbox"><h3>Últimos envíos por correo</h3>{emailChannel.items?.length?emailChannel.items.map((item:any)=><article key={item.eventId||item.id}><b>{item.title||item.eventType}</b><span>{deliveryLabels[item.deliveryStatus]||item.deliveryStatus}</span></article>):<p>Aún no hay mensajes enviados por este canal.</p>}</div></div><div className="notification-inbox"><h3>Buzón interno</h3>{inbox.length?inbox.slice(0,8).map((item:any)=><article key={item.eventId}><b>{item.title}</b><span>{item.createdAt}</span></article>):<p>No hay notificaciones para esta cuenta.</p>}</div></section>;
}

function FlowPanel() {
  const [flows,setFlows]=useState<any[]>([]);const [runs,setRuns]=useState<any[]>([]);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [type,setType]=useState('weekly-summary');const [frequency,setFrequency]=useState('weekly');const [time,setTime]=useState('09:00');const [dayOfWeek,setDayOfWeek]=useState(1);
  const load=useCallback(async()=>{const data=await request<any>('identity','flows');setFlows(data.items||[]);},[]);useEffect(()=>{void load().catch(e=>setMessage(String(e)));},[load]);
  async function create(e:React.FormEvent){e.preventDefault();setBusy(true);try{await request('identity','flows','POST',{type,frequency,time,dayOfWeek,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Lima'});await load();setMessage('Automatización guardada para tu tenant.');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  async function run(flow:any){setBusy(true);try{const result=await request<any>('identity',`flows/${flow.id}/run`,'POST',{});const history=await request<any>('identity',`flows/${flow.id}/runs`);setRuns(history.items||[]);setMessage(`Ejecución ${result.executionId||'completada'} · entrega ${result.deliveryStatus||'SIMULATED'}`);await load();}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  async function toggle(flow:any){setBusy(true);try{await request('identity',`flows/${flow.id}`,'PATCH',{enabled:!flow.enabled});await load();}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  return <section className="panel flow-panel"><div className="panelHeading"><div><h2>Automatizaciones</h2><span>Reglas deterministas sobre APIs de tu organización; entregas locales simuladas.</span></div><span className="mode-chip">SIN LLM · SIN ENVÍO EXTERNO</span></div><form className="assistant-form" onSubmit={create}><label className="sr-only" htmlFor="flow-type">Tipo de automatización</label><select id="flow-type" value={type} onChange={e=>setType(e.target.value)}><option value="weekly-summary">Resumen semanal</option><option value="reminder">Recordatorios</option><option value="risk-alert">Alertas de riesgo</option></select><label className="sr-only" htmlFor="flow-frequency">Cuando repetir</label><select id="flow-frequency" value={frequency} onChange={e=>setFrequency(e.target.value)}><option value="weekly">Semanal</option><option value="daily">Diaria</option></select><label className="sr-only" htmlFor="flow-time">Hora local</label><input id="flow-time" type="time" value={time} onChange={e=>setTime(e.target.value)} disabled={frequency==="manual"}/>{frequency==="weekly"&&<><label className="sr-only" htmlFor="flow-day">Día semanal</label><select id="flow-day" value={dayOfWeek} onChange={e=>setDayOfWeek(Number(e.target.value))}><option value={0}>Domingo</option><option value={1}>Lunes</option><option value={2}>Martes</option><option value={3}>Miércoles</option><option value={4}>Jueves</option><option value={5}>Viernes</option><option value={6}>Sábado</option></select></>}<button className="primary" disabled={busy}>{busy?'Guardando…':'Crear automatización'}</button></form>{message&&<p role="status" className="assistant-state">{message}</p>}<div className="orbital-reminder-list">{flows.length?flows.map(flow=><article key={flow.id}><div><b>{flow.name}</b><span>{flow.type} · {flow.frequency} · {flow.enabled?'Activa':'Pausada'} · próxima {flow.nextRunAt?new Date(flow.nextRunAt).toLocaleString(): 'manual'} · última {flow.lastRunAt?new Date(flow.lastRunAt).toLocaleString():'—'}</span></div><button className="textButton" disabled={busy} onClick={()=>void run(flow)}>Ejecutar ahora</button><button className="textButton" disabled={busy} onClick={()=>void toggle(flow)}>{flow.enabled?'Pausar':'Activar'}</button><button className="textButton" disabled={busy} onClick={async()=>{const d=await request<any>('identity',`flows/${flow.id}/runs`);setRuns(d.items||[]);}}>Historial</button></article>):<p>No hay automatizaciones configuradas.</p>}</div>{runs.map(run=><details key={run.executionId}><summary>{run.status} · {run.createdAt}</summary><pre>{JSON.stringify(run.report||run.errors||{},null,2)}</pre></details>)}</section>;
}

function ReportsPanel() {
  const [type, setType] = useState('project-progress'); const [reports, setReports] = useState<any[]>([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const types: Record<string,string> = {'portfolio-status':'Estado de portafolios','project-progress':'Avance de proyectos','overdue-tasks':'Tareas vencidas','resource-usage':'Uso de recursos','budgets':'Presupuestos','priorities':'Prioridades','risks':'Riesgos'};
  const load = useCallback(async()=>{const data=await request<any>('project','intelligence/reports');setReports(data.items||[]);},[]);
  useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:String(e)));},[load]);
  async function download(id:string) { const data=await request<any>('project',`intelligence/reports/${encodeURIComponent(id)}`); const report=data.report; const blob=new Blob([report.csv],{type:report.mediaType}); const url=URL.createObjectURL(blob); const link=document.createElement('a');link.href=url;link.download=report.fileName;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000); }
  async function generate(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{const data=await request<any>('project','intelligence/reports','POST',{type});setMessage(`${data.report.rows.length} filas. Alcance: hasta 1 000 resultados por servicio${data.report.scope.truncated?.length ? ' (truncado)' : ''}${data.report.unavailable?.length ? '; algunos servicios no disponibles' : ''}.`);await load();await download(data.report.id);}catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  return <section className="panel report-panel"><div className="panelHeading"><div><h2><BarChart3 size={18}/> Reportes</h2><span>Consultas tenant-scoped a servicios de dominio; cada reporte persiste su alcance y filas.</span></div><span className="mode-chip">CSV</span></div><form className="assistant-form" onSubmit={generate}><label className="sr-only" htmlFor="report-type">Tipo de reporte</label><select id="report-type" value={type} onChange={e=>setType(e.target.value)}>{Object.entries(types).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><button className="primary" disabled={busy}>{busy?'Generando…':'Generar CSV'}</button></form>{message&&<p className="assistant-state" role="status">{message}</p>}<div className="orbital-reminder-list"><h3>Historial persistido</h3>{reports.map(report=><article key={report.id}><div><b>{types[report.type]||report.type}</b><span>{report.generatedAt} · {report.scope?.partial?'alcance parcial':'alcance visible'}</span></div><button className="textButton" disabled={busy} onClick={()=>void download(report.id)}>Descargar CSV</button></article>)}{!reports.length&&<p>No se han generado reportes en esta organización.</p>}</div><small>Se recorren hasta 10 páginas (máximo 1 000 resultados por servicio); el reporte indica si el alcance quedó truncado. Los importes no se convierten entre monedas; aún no hay filtros personalizados ni PDF.</small></section>;
}

export function Workspace() {
  const [user, setUser] = useState(''); const [refreshToken, setRefreshToken] = useState(0);
  const [orgInfo, setOrgInfo] = useState<{ tenantId: string; role: string }>({ tenantId: '', role: '' });
  const [userProfile, setUserProfile] = useState<{ username?: string; name?: string; email?: string; role?: string; tenantId?: string }>({});
  const [entityNames, setEntityNames] = useState<Record<string, string>>({});
  const [syncAsResource, setSyncAsResource] = useState(true);
  const [assistantQuestion, setAssistantQuestion] = useState(''); const [assistantAnswer, setAssistantAnswer] = useState<any>(null); const [assistantBusy, setAssistantBusy] = useState(false);
  const [, setMobileNavOpen] = useState(false); const appPath = usePathname();
  const routeTabs: Record<string, string> = { portfolios: 'portfolio', projects: 'project', resources: 'resource', budgets: 'budget', priorities: 'priority', decisions: 'decisionlab', automations: 'automations', notifications: 'notifications', reports: 'reports', assistant: 'assistant', consulta: 'assistant', users: 'identity', tasks: 'tasks', assignments: 'assignments', expenses: 'expenses', rankings: 'rankings' };
  const tabRoutes: Record<string, string> = { dashboard: '/app', portfolio: '/app/portfolios', project: '/app/projects', resource: '/app/resources', budget: '/app/budgets', priority: '/app/priorities', identity: '/app/users', tasks: '/app/tasks', assignments: '/app/assignments', expenses: '/app/expenses', rankings: '/app/rankings', decisionlab: '/app/decisions', automations: '/app/automations', notifications: '/app/notifications', reports: '/app/reports', assistant: '/app/consulta' };
  const initialSegment = window.location.pathname.split('/')[2] || '';
  const [tab, setTab] = useState(routeTabs[initialSegment] || 'dashboard');
  function selectTab(next: string) { setTab(next); setMobileNavOpen(false); const route = tabRoutes[next] || '/app'; if (window.location.pathname !== route) navigate(route); }
  useEffect(() => { const segment = appPath.split('/')[2] || ''; setTab(routeTabs[segment] || 'dashboard'); }, [appPath]);
  const [items, setItems] = useState<Item[]>([]); const [form, setForm] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Item | null>(null); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [cursor, setCursor] = useState<string | null>(null); const [search, setSearch] = useState('');
  const [overview, setOverview] = useState<Record<string, Item[]>>({});
  const [overviewErrors, setOverviewErrors] = useState<string[]>([]);
  const [referenceOptions, setReferenceOptions] = useState<Record<string, Item[]>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [taskProjects, setTaskProjects] = useState<Item[]>([]); const [taskProject, setTaskProject] = useState(''); const [tasks, setTasks] = useState<Item[]>([]); const [taskTitle, setTaskTitle] = useState(''); const [taskDueDate, setTaskDueDate] = useState(''); const [taskAssignee, setTaskAssignee] = useState(''); const [teamMembers, setTeamMembers] = useState<Item[]>([]);
  const [assignmentRows, setAssignmentRows] = useState<Item[]>([]); const [resourceRows, setResourceRows] = useState<Item[]>([]); const [projectRows, setProjectRows] = useState<Item[]>([]); const [assignmentForm, setAssignmentForm] = useState({ resourceId: '', projectId: '', allocation: '0.5' });
  const [budgetRows, setBudgetRows] = useState<Item[]>([]); const [expenseRows, setExpenseRows] = useState<Item[]>([]); const [expenseForm, setExpenseForm] = useState({ budgetId: '', description: '', amount: '', currency: 'USD' }); const [rankingRows, setRankingRows] = useState<Item[]>([]); const [priorityForm, setPriorityForm] = useState({ projectId: '', impact: '50', urgency: '50', risk: '50', alignment: '50' });
  const active = modules.find(m => m.key === tab); const dashboard = tab === 'dashboard';
  const pageTitles: Record<string, string> = { tasks: 'Tablero Kanban', assignments: 'Asignaciones', expenses: 'Gastos', rankings: 'Ranking', decisionlab: 'Decision Lab', automations: 'Automatizaciones', notifications: 'Notificaciones', reports: 'Reportes', assistant: 'Consulta de informaci\u00f3n' };
  const pageDescriptions: Record<string, string> = { dashboard: 'Proyectos, pendientes y decisiones en un mismo lugar.', automations: 'Programa y revisa el seguimiento de tu organización.', notifications: 'Consulta las notificaciones de tu usuario.', reports: 'Genera y descarga reportes del alcance autorizado.', assistant: 'Consulta hechos de las APIs de tu organización.' };
  const activeTitle = active?.title || pageTitles[tab] || tab;

  useEffect(() => {
    if (localAuth) {
      const stored = localStorage.getItem('cloudportfolio.user');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setUser(parsed.email || '');
          setOrgInfo({ tenantId: String(parsed.tenantId || ''), role: String(parsed.role || '') });
          setUserProfile({ username: parsed.id || parsed.email, name: parsed.name, email: parsed.email, role: parsed.role, tenantId: parsed.tenantId });
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
    if (!user) return;
    let activeLookup = true;
    const sources = [
      ['portfolio', 'portfolios'],
      ['project', 'projects'],
      ['identity', 'users'],
      ['resource', 'resources'],
    ] as const;
    void Promise.allSettled(sources.map(async ([mod, p]) => (await request<{ items: Item[] }>(mod, p)).items || [])).then(results => {
      if (!activeLookup) return;
      const map: Record<string, string> = {};
      results.forEach(res => {
        if (res.status === 'fulfilled') {
          res.value.forEach(item => {
            const id = itemId(item);
            const label = String(item.name || item.email || '').trim();
            if (id && label) map[id] = label;
          });
        }
      });
      setEntityNames(map);
    });
    return () => { activeLookup = false; };
  }, [user, tab, refreshToken, items.length]);

  const load = useCallback(async (next?: string) => {
    if (!active) return;
    setBusy(true); setError('');
    try { const data = await request<{ items: Item[]; nextCursor: string | null }>(active.key, `${active.path}${next ? `?cursor=${encodeURIComponent(next)}` : ''}`); setItems(next ? old => [...old, ...data.items] : data.items); setCursor(data.nextCursor); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [active]);

  const loadOverview = useCallback(async () => {
    setBusy(true); setError('');
    const results = await Promise.allSettled(modules.map(async m => [m.key, (await request<{ items: Item[] }>(m.key, m.path)).items] as const));
    const available: Record<string, Item[]> = {}; const unavailable: string[] = [];
    results.forEach((result, index) => { if (result.status === 'fulfilled') available[result.value[0]] = result.value[1] || []; else unavailable.push(modules[index].title); });
    setOverview(available); setOverviewErrors(unavailable); setBusy(false);
  }, []);

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
    else setForm({});
    setSyncAsResource(true);
    setNotice('');
    setFormOpen(true);
  }
  function startEdit(item: Item) { setFormOpen(true); const values: Record<string, string> = {}; active?.fields.forEach(field => { values[field] = item[field] == null ? '' : String(item[field]); }); setEditing(item); setForm(values); setNotice(''); }
  async function save(e: React.FormEvent) { e.preventDefault(); if (!active) return; setBusy(true); setError(''); setNotice('');
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
      setNotice(editing ? 'Cambios guardados.' : active.key === 'identity' ? (payload.password ? 'Miembro creado en la organización y habilitado en Cognito.' : 'Miembro registrado en la organización.') : 'Registro creado.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const [confirmDelete, setConfirmDelete] = useState<Item | null>(null);

  async function executeRemove(item: Item) {
    if (!active) return;
    setBusy(true);
    setError('');
    try {
      await request(active.key, `${active.path}/${encodeURIComponent(itemId(item))}`, 'DELETE');
      setNotice('Registro eliminado.');
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function createTask(e: React.FormEvent) { e.preventDefault(); if (!taskProject) return; setBusy(true); setError(''); try { await request('project', `projects/${encodeURIComponent(taskProject)}/tasks`, 'POST', { title: taskTitle, ...(taskDueDate ? { dueDate: taskDueDate } : {}), ...(taskAssignee ? { assigneeId: taskAssignee } : {}), idempotencyKey: crypto.randomUUID() }); setTaskTitle(''); setTaskDueDate(''); setTaskAssignee(''); const data = await request<{ items: Item[] }>('project', `projects/${encodeURIComponent(taskProject)}/tasks`); setTasks(data.items || []); setNotice('Tarea creada.'); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  async function moveTask(task: Item, status: string) { try { await request('project', `projects/${encodeURIComponent(taskProject)}/tasks/${encodeURIComponent(String(task.id))}`, 'PATCH', { status }); setTasks(old => old.map(x => x.id === task.id ? { ...x, status } : x)); } catch (e) { setError(String(e)); } }
  async function createAssignment(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await request('resource', 'assignments', 'POST', { ...assignmentForm, allocation: Number(assignmentForm.allocation) }); const data = await request<{ items: Item[] }>('resource', 'assignments'); setAssignmentRows(data.items || []); setNotice('Asignación creada.'); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  async function createExpense(e: React.FormEvent) { e.preventDefault(); const budget = budgetRows.find(b => itemId(b) === expenseForm.budgetId); if (!budget) return; setBusy(true); setError(''); try { await request('budget', 'expenses', 'POST', { budgetId: expenseForm.budgetId, projectId: String(budget.projectId), description: expenseForm.description, amount: Number(expenseForm.amount), currency: expenseForm.currency }); const [expenses, budgets] = await Promise.all([request<any>('budget', 'expenses'), request<any>('budget', 'budgets')]); setExpenseRows(expenses.items || []); setBudgetRows((budgets.items || []).filter((x: Item) => x.entityType !== 'Expense')); setExpenseForm({ ...expenseForm, description: '', amount: '' }); setNotice('Gasto registrado.'); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  async function recalculatePriority(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await request('priority', 'priorities/recalculate', 'POST', { ...priorityForm, impact: Number(priorityForm.impact), urgency: Number(priorityForm.urgency), risk: Number(priorityForm.risk), alignment: Number(priorityForm.alignment) }); const data = await request<{ items: Item[] }>('priority', 'rankings'); setRankingRows(data.items || []); setNotice('Prioridad recalculada y ranking actualizado.'); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  async function askAssistant(question = assistantQuestion) { if (!question.trim()) return; setAssistantBusy(true); setAssistantAnswer(null); try { setAssistantAnswer(await request('project', 'intelligence/ask', 'POST', { question })); } catch (e) { setAssistantAnswer({ error: e instanceof Error ? e.message : String(e) }); } finally { setAssistantBusy(false); } }

  const specialView = tab === 'decisionlab' ? (
    <Suspense fallback={<div className="route-loading" role="status">Cargando Decision Lab…</div>}><DecisionLab request={request}/></Suspense>
  ) : tab === 'automations' ? (
    <FlowPanel/>
  ) : tab === 'notifications' ? (
    <NotificationCenter/>
  ) : tab === 'reports' ? (
    <ReportsPanel/>
  ) : tab === 'assistant' ? (
    <section className="panel intelligence-panel" id="astra-intelligence"><div className="panelHeading"><div><h2><Sparkles size={18}/> ProFiles Insights</h2><span>Consultas de solo lectura sobre APIs autorizadas de tu organización.</span></div><span className="mode-chip">REGLAS DETERMINISTAS</span></div><form className="assistant-form" onSubmit={e=>{e.preventDefault();void askAssistant();}}><label className="sr-only" htmlFor="assistant-question">Pregunta para Inteligencia ProFiles</label><input id="assistant-question" maxLength={500} value={assistantQuestion} onChange={e=>setAssistantQuestion(e.target.value)} placeholder="¿Qué proyectos están atrasados?"/><button className="primary" disabled={assistantBusy||!assistantQuestion.trim()}>{assistantBusy?'Consultando…':<>Consultar <ArrowRight size={15}/></>}</button></form><div className="assistant-prompts">{['¿Qué proyectos están atrasados?','¿Qué presupuesto está cerca de agotarse?','Resume mis prioridades'].map(q=><button key={q} onClick={()=>{setAssistantQuestion(q);void askAssistant(q);}}>{q}</button>)}</div>{assistantBusy&&<p className="assistant-state" role="status">Consultando las APIs de dominio con tu sesión…</p>}{assistantAnswer?.error&&<p className="error assistant-state" role="alert">{assistantAnswer.error}</p>}{assistantAnswer&&!assistantAnswer.error&&<div className="assistant-answer"><strong>Hechos consultados</strong><ul>{assistantAnswer.facts.map((fact:string,i:number)=><li key={i}>{fact}</li>)}</ul><strong>Sugerencias (no ejecutan cambios)</strong><ul>{assistantAnswer.suggestions.map((item:string,i:number)=><li key={i}>{item}</li>)}</ul>{assistantAnswer.relatedProjects?.length>0&&<><strong>Proyectos relacionados</strong><ul>{assistantAnswer.relatedProjects.map((item:any)=><li key={item.id}><a href="/app/projects">{item.name || item.id}</a> · {item.status} · cierre {item.endDate}</li>)}</ul></>}{assistantAnswer.relatedTasks?.length>0&&<><strong>Tareas para revisar</strong><ul>{assistantAnswer.relatedTasks.map((item:any)=><li key={item.id}><a href="/app/projects">{item.title || item.id}</a> · vence {item.dueDate}</li>)}</ul></>}<small>Alcance: primera página de hasta 100 resultados por dominio. {assistantAnswer.unavailable.length?`Servicios no disponibles: ${assistantAnswer.unavailable.join(', ')}.`:''}</small></div>}</section>
  ) : tab === 'tasks' ? (
    <>
      <section className="panel">
        <div className="panelHeading">
          <div>
            <h2>Tablero Kanban</h2>
            <span>Organiza tareas operativas por proyecto y estado de ejecución</span>
          </div>
          <label className="kanban-project-picker">
            <span className="sr-only">Proyecto activo</span>
            <select value={taskProject} onChange={e => setTaskProject(e.target.value)}>
              <option value="">Selecciona proyecto</option>
              {taskProjects.map(p => <option key={itemId(p)} value={itemId(p)}>{readable(p.name)}</option>)}
            </select>
          </label>
        </div>
        <form className="create" onSubmit={createTask}>
          <label>Nueva tarea<input required maxLength={180} value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Ej. Preparar cronograma"/></label>
          <label>Fecha de vencimiento<input type="date" value={taskDueDate} onChange={e => setTaskDueDate(e.target.value)}/></label>
          <label>Responsable<select value={taskAssignee} onChange={e => setTaskAssignee(e.target.value)}><option value="">Sin asignar</option>{teamMembers.map(m => <option key={itemId(m)} value={itemId(m)}>{readable(m.name || m.email)}</option>)}</select></label>
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
                      <select aria-label={`Estado de ${readable(x.title)}`} value={String(x.status)} onChange={e => void moveTask(x, e.target.value)}>
                        {['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                      {s === 'TODO' && <button type="button" className="task-quick-btn" onClick={() => void moveTask(x, 'IN_PROGRESS')}>Iniciar</button>}
                      {s === 'IN_PROGRESS' && <button type="button" className="task-quick-btn complete" onClick={() => void moveTask(x, 'DONE')}>Completar</button>}
                    </div>
                  </article>
                );
              })}
              {!colTasks.length && <div className="kanban-empty">Sin tareas en esta columna</div>}
            </section>
          );
        })}
      </div>
    </>
  ) : tab === 'assignments' ? (
    <><section className="panel"><h2>Asignar recurso a proyecto</h2><form className="create" onSubmit={createAssignment}><label>Recurso<select required value={assignmentForm.resourceId} onChange={e=>setAssignmentForm({...assignmentForm,resourceId:e.target.value})}><option value="">Selecciona</option>{resourceRows.map(x=><option key={itemId(x)} value={itemId(x)}>{readable(x.name)}</option>)}</select></label><label>Proyecto<select required value={assignmentForm.projectId} onChange={e=>setAssignmentForm({...assignmentForm,projectId:e.target.value})}><option value="">Selecciona</option>{projectRows.map(x=><option key={itemId(x)} value={itemId(x)}>{readable(x.name)}</option>)}</select></label><label>Asignación (%)<input type="number" min="1" max="100" value={Number(assignmentForm.allocation)*100} onChange={e=>setAssignmentForm({...assignmentForm,allocation:String(Number(e.target.value)/100)})}/></label><button disabled={busy}><UserPlus size={16}/>Asignar</button></form></section><DataTable title="Asignaciones" rows={assignmentRows} fields={['resourceId','projectId','allocation','startDate','endDate']} entityNames={entityNames}/></>
  ) : tab === 'expenses' ? (
    <><section className="panel"><h2>Registrar gasto</h2><form className="create" onSubmit={createExpense}><label>Presupuesto<select required value={expenseForm.budgetId} onChange={e=>setExpenseForm({...expenseForm,budgetId:e.target.value})}><option value="">Selecciona</option>{budgetRows.map(x=><option key={itemId(x)} value={itemId(x)}>{entityNames[String(x.projectId)] || readable(x.projectId)} · {readable(x.currency)}</option>)}</select></label><label>Descripción<input required value={expenseForm.description} onChange={e=>setExpenseForm({...expenseForm,description:e.target.value})}/></label><label>Importe<input required type="number" min="0.01" step="0.01" value={expenseForm.amount} onChange={e=>setExpenseForm({...expenseForm,amount:e.target.value})}/></label><button disabled={busy}><ReceiptText size={16}/>Registrar</button></form></section><DataTable title="Gastos recientes" rows={expenseRows} fields={['description','projectId','amount','currency','createdAt']} entityNames={entityNames}/></>
  ) : tab === 'rankings' ? (
    <><section className="panel"><h2>Recalcular prioridad</h2><form className="create" onSubmit={recalculatePriority}><label>Proyecto<select required value={priorityForm.projectId} onChange={e=>setPriorityForm({...priorityForm,projectId:e.target.value})}><option value="">Selecciona</option>{projectRows.map(x=><option key={itemId(x)} value={itemId(x)}>{readable(x.name)}</option>)}</select></label>{(['impact','urgency','risk','alignment'] as const).map(k=><label key={k}>{fieldLabel(k)}<input type="number" min="0" max="100" value={priorityForm[k]} onChange={e=>setPriorityForm({...priorityForm,[k]:e.target.value})}/></label>)}<button disabled={busy}><ArrowUpDown size={16}/>Calcular</button></form></section><DataTable title="Ranking de proyectos" rows={rankingRows} fields={['rank','projectId','score','impact','urgency','risk','alignment']} entityNames={entityNames}/></>
  ) : null;

  const filtered = useMemo(() => items.filter(item => Object.values(item).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase()))), [items, search]);
  const projects = overview.project || []; const portfolios = overview.portfolio || []; const budgets = overview.budget || [];
  const activeProjectsCount = projects.filter(p => ['active', 'in_progress', 'in-progress'].includes(String(p.status || '').toLowerCase())).length;
  const completedProjectsCount = projects.filter(p => ['completed', 'complete', 'done'].includes(String(p.status || '').toLowerCase())).length;
  const overdueProjectsCount = projects.filter(p => p.endDate && String(p.endDate).slice(0, 10) < new Date().toLocaleDateString('sv-SE') && !['completed', 'complete', 'done'].includes(String(p.status).toLowerCase())).length;
  const overBudgetCount = budgets.filter(b => Number.isFinite(Number(b.allocated)) && Number.isFinite(Number(b.spent)) && Number(b.spent) > Number(b.allocated)).length;
  const attentionTotal = overdueProjectsCount + overBudgetCount;
  const projectHealthPct = projects.length ? Math.round(((activeProjectsCount + completedProjectsCount) / projects.length) * 100) : 0;

  return <div className="layout workspace-layout"><TopNav tab={tab} user={user} userProfile={userProfile} onNavigate={selectTab} onSignOut={async () => { if (localAuth) { localStorage.removeItem('cloudportfolio.accessToken'); localStorage.removeItem('cloudportfolio.user'); } else await signOutFromCognito(); setUser(''); navigate('/'); }}/>
    <main key={tab} className="workspace-view"><PageHeader eyebrow={`ProFiles / ${(dashboard ? 'VISIÓN GENERAL' : activeTitle).toUpperCase()}`} title={dashboard ? 'Resumen ejecutivo' : activeTitle} description={dashboard ? 'Proyectos, pendientes y decisiones en un mismo lugar.' : pageDescriptions[tab] || `Consulta y administra ${activeTitle.toLowerCase()} de tu organización.`} action={<button className="secondary" disabled={busy} onClick={() => setRefreshToken(n => n + 1)}><RefreshCw size={16} className={busy ? 'spin' : ''} />Actualizar</button>}/>
      {error && <div className="error banner toast" role="alert">{error}<button aria-label="Cerrar error" onClick={() => setError('')}><X size={16} /></button></div>}{notice && <div className="notice banner toast" role="status">{notice}<button aria-label="Cerrar aviso" onClick={() => setNotice('')}><X size={16} /></button></div>}
      {dashboard ? <><section className="dashboard-overview" aria-label="Estado del espacio de trabajo"><div className="dashboard-welcome"><div><span className="welcome-eyebrow">TU ESPACIO DE TRABAJO</span><h2>Todo lo importante, en un lugar.</h2><p>Revisa tus proyectos y encuentra el siguiente paso para tu equipo.</p></div><div className="welcome-emblem" aria-hidden="true"><FolderKanban size={38}/><span><Sparkles size={17}/></span></div></div>
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
          <div className="attention-list">{projects.filter(p => p.endDate && String(p.endDate).slice(0, 10) < new Date().toLocaleDateString('sv-SE') && !['completed', 'complete', 'done'].includes(String(p.status).toLowerCase())).slice(0, 4).map((p, i) => <div className="attention-row" key={itemId(p) || i}><span className="attention-marker overdue"/><div><strong>{readable(p.name)}</strong><small>Fecha de cierre registrada: {formatDate(p.endDate)}</small></div><span className="attention-tag tag-overdue">Vencido</span></div>)}{budgets.filter(b => Number.isFinite(Number(b.allocated)) && Number.isFinite(Number(b.spent)) && Number(b.spent) > Number(b.allocated)).slice(0, 3).map((b, i) => <div className="attention-row" key={itemId(b) || i}><span className="attention-marker budget"/><div><strong>Presupuesto &middot; {entityNames[String(b.projectId)] || readable(b.projectId)}</strong><small>Gasto {formatCurrency(b.spent, b.currency)} supera monto asignado {formatCurrency(b.allocated, b.currency)} &middot; {readable(b.currency)}</small></div><span className="attention-tag tag-budget">Revisar</span></div>)}{overview.project && overview.budget && !projects.some(p => p.endDate && String(p.endDate).slice(0, 10) < new Date().toLocaleDateString('sv-SE') && !['completed', 'complete', 'done'].includes(String(p.status).toLowerCase())) && !budgets.some(b => Number.isFinite(Number(b.allocated)) && Number.isFinite(Number(b.spent)) && Number(b.spent) > Number(b.allocated)) && <div className="dashboard-empty"><strong>{busy ? 'Consultando registros...' : projects.length || budgets.length ? 'No se detectaron excepciones con los datos disponibles.' : 'A\u00fan no hay datos para revisar.'}</strong><span>{projects.length || budgets.length ? 'La lista refleja solo fechas y montos registrados.' : 'Crea un proyecto para comenzar a organizar el trabajo.'}</span></div>}</div>
          <div className="dashboard-actions"><button className="secondary" onClick={() => selectTab('project')}>Abrir proyectos</button><button className="secondary" onClick={() => selectTab('decisionlab')}>Comparar escenarios</button><button className="secondary" onClick={() => selectTab('automations')}>Ver automatizaciones</button></div>
        </section>
        <section className="dashboard-secondary-grid"><div className="panel"><div className="panelHeading"><div><h2><FolderKanban size={19}/> Proyectos destacados</h2><span>Proyectos disponibles en la primera página</span></div><button className="textButton" onClick={() => selectTab('project')}>Ver todos <ArrowRight size={14}/></button></div>{!overview.project && !busy ? <div className="dashboard-empty">No se pudieron cargar los proyectos. Actualiza para reintentar.</div> : projects.length ? <div className="projectList">{projects.slice(0, 5).map((p, i) => <div className="projectRow" key={itemId(p) || i}><span className="projectIcon"><BriefcaseBusiness size={17}/></span><div className="projectName"><strong>{readable(p.name)}</strong><small>{entityNames[String(p.portfolioId)] || readable(p.portfolioId)} &middot; responsable {entityNames[String(p.ownerId)] || readable(p.ownerId)}</small></div><StatusBadge value={p.status || 'Planificación'} /></div>)}</div> : <div className="dashboard-empty"><strong>{busy ? 'Cargando proyectos…' : 'Todavía no hay proyectos.'}</strong><span>Cuando existan registros, aparecerán aquí.</span></div>}</div>
          <aside className="panel quick-actions"><h2><Sparkles size={19}/> Accesos directos</h2><button onClick={() => selectTab('project')}><FolderKanban size={16}/>Gestionar proyectos <ArrowRight size={14}/></button><button onClick={() => selectTab('decisionlab')}><Target size={16}/>Evaluar una decisión <ArrowRight size={14}/></button><button onClick={() => selectTab('automations')}><Workflow size={16}/>Programar seguimiento <ArrowRight size={14}/></button><button onClick={() => selectTab('reports')}><FileBarChart size={16}/>Consultar reportes <ArrowRight size={14}/></button></aside>
        </section><section className="panel timeline-panel"><div className="panelHeading"><div><h2>Proximos vencimientos</h2><span>Fechas de cierre registradas en proyectos visibles</span></div><CalendarDays size={18}/></div>{busy ? <div className="skeleton-line" role="status" aria-label="Cargando vencimientos"/> : !overview.project ? <p className="insight-empty">No se pudieron consultar los proyectos.</p> : projects.filter(p => typeof p.endDate === 'string' && p.endDate.slice(0,10) >= new Date().toLocaleDateString('sv-SE')).sort((a,b) => String(a.endDate).localeCompare(String(b.endDate))).slice(0,4).map((p,i) => <div className="insight-row" key={itemId(p)||i}><span>{readable(p.name)}</span><strong>{formatDate(p.endDate)}</strong></div>)}{!busy && overview.project && !projects.some(p => typeof p.endDate === 'string' && p.endDate.slice(0,10) >= new Date().toLocaleDateString('sv-SE')) && <p className="insight-empty">No hay fechas proximas registradas.</p>}</section><section className="panel timeline-panel"><div className="panelHeading"><div><h2>Actividad registrada</h2><span>Ultimas actualizaciones disponibles de proyectos</span></div><Activity size={18}/></div>{busy ? <div className="skeleton-line" role="status" aria-label="Cargando actividad"/> : !overview.project ? <p className="insight-empty">No se pudo consultar la actividad.</p> : projects.filter(p => typeof p.updatedAt === 'string').sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,4).map((p,i) => <div className="insight-row" key={itemId(p)||i}><span>{readable(p.name)}</span><strong>{formatDate(p.updatedAt)}</strong></div>)}{!busy && overview.project && !projects.some(p => typeof p.updatedAt === 'string') && <p className="insight-empty">No hay actualizaciones registradas en los proyectos visibles.</p>}</section><div className="insight-grid">
          <section className="panel insight-card"><div className="panelHeading"><div><h2><Wallet size={19}/> Presupuestos</h2><span>Montos registrados por proyecto</span></div><button className="textButton" onClick={() => selectTab('budget')}>Abrir <ArrowRight size={14}/></button></div>{busy ? <div className="skeleton-line" role="status" aria-label="Cargando presupuestos"/> : !overview.budget ? <p className="insight-empty">No se pudo consultar esta información.</p> : budgets.length ? budgets.slice(0,3).map((b,i) => { const alloc = Number(b.allocated) || 0; const sp = Number(b.spent) || 0; const pct = alloc > 0 ? Math.min(100, Math.round((sp / alloc) * 100)) : 0; const over = alloc > 0 && sp > alloc; return <div className="insight-budget-item" key={itemId(b)||i}><div className="insight-row"><span>{entityNames[String(b.projectId)] || readable(b.projectId)}</span><strong>{formatCurrency(b.spent, b.currency)} / {formatCurrency(b.allocated, b.currency)}</strong></div><div className="inline-meter-track"><span className={`inline-meter-fill ${over ? 'fill-rose' : pct >= 80 ? 'fill-amber' : 'fill-emerald'}`} style={{ width: `${pct}%` }} /></div></div>; }) : <p className="insight-empty">Agrega un presupuesto para empezar el seguimiento.</p>}</section>
          <section className="panel insight-card"><div className="panelHeading"><div><h2><Users size={19}/> Equipo y recursos</h2><span>Recursos disponibles en esta página</span></div><button className="textButton" onClick={() => selectTab('resource')}>Abrir <ArrowRight size={14}/></button></div>{busy ? <div className="skeleton-line" role="status" aria-label="Cargando recursos"/> : !overview.resource ? <p className="insight-empty">No se pudo consultar esta información.</p> : overview.resource.length ? overview.resource.slice(0,3).map((r,i) => <div className="insight-row" key={itemId(r)||i}><UserAvatar name={r.name} size={24} /><StatusBadge value={r.status} /></div>) : <p className="insight-empty">Aún no hay recursos registrados.</p>}</section>
          <section className="panel insight-card"><div className="panelHeading"><div><h2>ProFiles Insights</h2><span>Señales basadas en tus registros</span></div><Sparkles size={18}/></div><p className="insight-empty">Revisa fechas vencidas y presupuestos que superan lo asignado. Son reglas sobre datos visibles, no predicciones.</p><button className="textButton" onClick={() => selectTab('assistant')}>Explorar información <ArrowRight size={14}/></button></section>
        </div><div className="dataNote"><Activity size={16}/> El resumen utiliza las primeras páginas devueltas por las APIs. Los importes se muestran por registro y no se suman entre monedas.</div>
      </section></> : active ? <>
        <div className="module-intro"><div><span className="module-kicker">TU ESPACIO DE TRABAJO</span><h2>{active.title}</h2><p>{active.key === 'identity' ? 'Agrega miembros a tu organización, define su rol (RBAC) y habilítalos para colaborar en proyectos.' : 'Consulta y organiza los registros disponibles para tu equipo.'}</p></div><button className="primary" onClick={startCreate}><Plus size={16}/> {active.key === 'identity' ? 'Nuevo miembro' : 'Nuevo registro'}</button></div>
        {active.key === 'identity' && (
          <div className="org-identity-banner" aria-label="Código de invitación de la organización">
            <div>
              <strong>Organización compartida (Multi-Tenant)</strong>
              <p>Puedes crear cuentas directamente con contraseña usando <b>Nuevo miembro</b>, o compartir este código de organización para que tus compañeros se unan desde <b>/register &rarr; Unirme con código</b>.</p>
            </div>
            <div className="org-identity-meta">
              {orgInfo.role && <StatusBadge value={orgInfo.role} />}
              {orgInfo.tenantId && <CopyIdBadge id={orgInfo.tenantId} full />}
            </div>
          </div>
        )}
        <Modal
          open={formOpen}
          title={editing ? (active.key === 'budget' ? 'Editar presupuesto de proyecto' : `Editar ${active.title.toLowerCase()}`) : active.key === 'identity' ? 'Agregar miembro a la organización' : active.key === 'budget' ? 'Asignar presupuesto a proyecto' : `Crear registro en ${active.title}`}
          subtitle={active.key === 'identity' ? 'El miembro compartirá los portafolios y proyectos de tu organización según su rol.' : active.key === 'budget' ? 'Define el techo financiero asignado y el gasto ejecutado acumulado para el proyecto seleccionado.' : 'Los campos se validan según el contrato del servicio.'}
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
                ) : fieldLabel(field);

                return (
                <label key={field}>
                  {customLabel}{active.required.includes(field) ? ' *' : ''}
                  {referenceOptions[field]?.length ? (
                    <select required={active.required.includes(field)} value={form[field] || ''} onChange={e => setForm({ ...form, [field]: e.target.value })}>
                      <option value="">Selecciona</option>
                      {referenceOptions[field].map(item => <option key={itemId(item)} value={itemId(item)}>{readable(item.name || item.email || itemId(item))}</option>)}
                      {form[field] && !referenceOptions[field].some(item => itemId(item) === form[field]) && <option value={form[field]}>Valor actual</option>}
                    </select>
                  ) : field === 'role' ? (
                    <select required={active.required.includes(field)} value={form[field] || 'MANAGER'} onChange={e => setForm({ ...form, [field]: e.target.value })}>
                      <option value="MANAGER">MANAGER (Gestor · Crea y edita proyectos/tareas)</option>
                      <option value="VIEWER">VIEWER (Lector · Solo consulta)</option>
                      <option value="ADMIN">ADMIN (Administrador · Control total)</option>
                    </select>
                  ) : field === 'type' && active.key === 'resource' ? (
                    <select required={active.required.includes(field)} value={form[field] || 'person'} onChange={e => setForm({ ...form, [field]: e.target.value })}>
                      <option value="person">person (Persona / Especialista)</option>
                      <option value="team">team (Equipo / Célula)</option>
                      <option value="equipment">equipment (Licencia / Infraestructura)</option>
                    </select>
                  ) : field === 'capacity' && active.key === 'resource' ? (
                    <select required={active.required.includes(field)} value={form[field] || '1'} onChange={e => setForm({ ...form, [field]: e.target.value })}>
                      <option value="1">100% (Tiempo completo · 1.0 FTE)</option>
                      <option value="0.75">75% (Tres cuartos · 0.75 FTE)</option>
                      <option value="0.5">50% (Medio tiempo · 0.5 FTE)</option>
                      <option value="0.25">25% (Cuarto de tiempo · 0.25 FTE)</option>
                    </select>
                  ) : field === 'currency' ? (
                    <select required={active.required.includes(field)} value={form[field] || 'USD'} onChange={e => setForm({ ...form, [field]: e.target.value })}>
                      <option value="USD">USD (Dólares)</option>
                      <option value="PEN">PEN (Soles)</option>
                      <option value="EUR">EUR (Euros)</option>
                    </select>
                  ) : field === 'status' ? (
                    <select required={active.required.includes(field)} value={form[field] || 'ACTIVE'} onChange={e => setForm({ ...form, [field]: e.target.value })}>
                      <option value="">Selecciona estado</option>
                      <option value="ACTIVE">ACTIVE (Activo)</option>
                      <option value="PLANNED">PLANNED (Planificado)</option>
                      <option value="IN_PROGRESS">IN_PROGRESS (En progreso)</option>
                      <option value="ON_HOLD">ON_HOLD (En pausa)</option>
                      <option value="COMPLETED">COMPLETED (Completado)</option>
                      <option value="BLOCKED">BLOCKED (Bloqueado)</option>
                    </select>
                  ) : (
                    <input
                      required={active.required.includes(field)}
                      type={['allocated', 'spent', 'capacity', 'impact', 'urgency', 'risk', 'alignment'].includes(field) ? 'number' : field === 'email' ? 'email' : field.endsWith('Date') ? 'date' : 'text'}
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
                    Contraseña inicial de acceso (Cognito · opcional)
                    <input
                      type="password"
                      minLength={12}
                      maxLength={256}
                      value={form.password || ''}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      placeholder="Ej. Equipo2026!ProFiles"
                    />
                  </label>
                  <small>Si ingresas una contraseña (mín. 12 caracteres, mayúscula, minúscula, número y símbolo), se creará su cuenta en Amazon Cognito dentro de tu organización para que inicie sesión directamente en <b>/login</b>.</small>
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
            subtitle="Esta acción es irreversible y eliminará el dato en la nube."
            onClose={() => setConfirmDelete(null)}
          >
            <div className="confirm-delete-box">
              <p className="confirm-delete-message">
                ¿Estás seguro de que deseas eliminar permanentemente <strong>"{readable(confirmDelete.name ?? entityNames[String(confirmDelete.projectId)] ?? confirmDelete.projectId ?? itemId(confirmDelete))}"</strong> de tu organización?
              </p>
              <small className="confirm-delete-subtext">El registro se eliminará de las tablas DynamoDB del tenant y dejará de estar disponible para todos los miembros.</small>
              <div className="modal-form-actions">
                <button type="button" className="secondary" onClick={() => setConfirmDelete(null)}>Cancelar</button>
                <button type="button" className="danger" disabled={busy} onClick={() => void executeRemove(confirmDelete)}>
                  {busy ? 'Eliminando…' : 'Eliminar permanentemente'}
                </button>
              </div>
            </div>
          </Modal>
        )}

        <section className="panel"><div className="panelHeading listHeading"><div><h2>Registros</h2><span>{filtered.length} visibles · resultados páginados por tenant</span></div><label className="searchBox"><Search size={16} /><input aria-label="Buscar registros" placeholder="Buscar…" value={search} onChange={e => setSearch(e.target.value)} /></label></div><div className="tableWrap"><table><thead><tr><th>Registro</th>{active.fields.slice(0, 4).map(f => <th key={f}>{fieldLabel(f)}</th>)}<th>Acciones</th></tr></thead><tbody>{filtered.map((item, i) => <tr key={itemId(item) || i}><td className="idCell"><CopyIdBadge id={itemId(item)} /></td>{active.fields.slice(0, 4).map(f => <td key={f}>{renderFormattedCell(f, item, entityNames)}</td>)}<td><div className="rowActions">{active.key === 'project' && <><button type="button" onClick={() => { setTaskProject(itemId(item)); selectTab('tasks'); }}>Tareas</button><button type="button" onClick={() => { setAssignmentForm(old => ({ ...old, projectId: itemId(item) })); selectTab('assignments'); }}>Equipo</button></>}<button onClick={() => startEdit(item)}>Editar</button><button className="deleteAction" onClick={() => setConfirmDelete(item)}>Eliminar</button></div></td></tr>)}</tbody></table>{!filtered.length && <div className="empty">{busy ? 'Cargando registros…' : search ? 'No hay resultados para esta búsqueda.' : 'No hay registros todavía. Crea uno para comenzar.'}</div>}</div>{cursor && <button className="secondary moreButton" disabled={busy} onClick={() => void load(cursor)}>Cargar más</button>}</section>
      </> : specialView}
    </main></div>;
}

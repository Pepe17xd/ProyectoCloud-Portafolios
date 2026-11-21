import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Save, Trash2 } from 'lucide-react';
import Modal from './components/Modal';
import { formatDate, StatusBadge } from './components/StatusBadge';
import {
  formatConstraintLabel,
  formatDecisionCriteriaLabel,
  formatDecisionMetricLabel,
  formatDecisionVisibility,
  formatScenarioLabel,
  isOpaqueId,
} from './utils/display';
import './DecisionLab.css';

type Request = <T = any>(module: string, path: string, method?: string, body?: unknown) => Promise<T>;
type Props = { request: Request };
type Context = { projects: any[]; portfolios: any[]; resources: any[]; currencies: string[]; currentUserId: string; capabilities: { canSimulate: boolean; canSave: boolean; canDeleteOwn: boolean; canDeleteAll: boolean }; sourceCompleteness: string; truncatedSources: string[] };
type Variables = { budgetLimit: string; currency: string; resourceId: string; fromProjectId: string; projectId: string; allocation: string; dateProject: string; startDate: string; endDate: string; priorityWeights: Record<string, string> };
const freshVariables = (): Variables => ({ budgetLimit: '', currency: '', resourceId: '', fromProjectId: '', projectId: '', allocation: '', dateProject: '', startDate: '', endDate: '', priorityWeights: { impact: '0.35', urgency: '0.25', alignment: '0.25', risk: '0.15' } });
const criteria = ['impact', 'urgency', 'alignment', 'risk'];

function makeVariables(value: Variables) {
  const output: any = {};
  if (value.budgetLimit !== '') output.budgetLimit = Number(value.budgetLimit);
  if (value.currency) output.currency = value.currency;
  if (value.resourceId && value.projectId && value.allocation !== '') output.resourceReassignments = [
    ...(value.fromProjectId ? [{ resourceId: value.resourceId, projectId: value.fromProjectId, allocation: 0 }] : []),
    { resourceId: value.resourceId, projectId: value.projectId, allocation: Number(value.allocation) / 100 },
  ];
  if (value.dateProject && (value.startDate || value.endDate)) output.dateOverrides = { [value.dateProject]: { ...(value.startDate ? { startDate: value.startDate } : {}), ...(value.endDate ? { endDate: value.endDate } : {}) } };
  if (criteria.some(k => value.priorityWeights[k] !== freshVariables().priorityWeights[k])) output.priorityWeights = Object.fromEntries(criteria.map(k => [k, Number(value.priorityWeights[k])]));
  return output;
}

function Metric({ metric }: { metric: any }) {
  return metric?.status === 'CALCULATED' ? <span className="decision-metric-val">{Array.isArray(metric.value) ? metric.value.length ? metric.value.join(', ') : 'Ninguno' : metric.value} {metric.unit}</span> : <span className="decision-uncalculated">No calculable · {metric?.reason || 'Datos insuficientes'}</span>;
}

export default function DecisionLab({ request }: Props) {
  const [context, setContext] = useState<Context | null>(null);
  const [scope, setScope] = useState<{ projectId?: string; portfolioId?: string }>({});
  const [scenarios, setScenarios] = useState<Record<'A' | 'B', Variables>>({ A: freshVariables(), B: freshVariables() });
  const [result, setResult] = useState<any>(null); const [saved, setSaved] = useState<any[]>([]); const [selected, setSelected] = useState<any>(null);
  const [name, setName] = useState(''); const [visibility, setVisibility] = useState('private'); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const [ctx, list] = await Promise.all([request<Context>('priority', 'decisions/context'), request<any>('priority', 'decisions/scenarios')]);
    setContext(ctx); setSaved(list.items || []);
  }, [request]);
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : String(e))); }, [load]);
  function update(key: 'A' | 'B', patch: Partial<Variables>) { setScenarios(old => ({ ...old, [key]: { ...old[key], ...patch } })); }
  function updateWeight(key: 'A' | 'B', field: string, value: string) { setScenarios(old => ({ ...old, [key]: { ...old[key], priorityWeights: { ...old[key].priorityWeights, [field]: value } } })); }
  const payload = () => ({ scope, scenarios: (['A', 'B'] as const).map(key => ({ key, name: `Escenario ${key}`, variables: makeVariables(scenarios[key]) })) });
  async function simulate(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); setMessage(''); setSelected(null); try { setResult(await request('priority', 'decisions/simulate', 'POST', payload())); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  async function save() { if (!result || !name.trim()) return; setBusy(true); setError(''); try { const item = await request<any>('priority', 'decisions/scenarios', 'POST', { ...payload(), name: name.trim(), visibility }); setMessage('Escenario guardado como pendiente de revisión.'); setSelected(item); setName(''); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  async function open(item: any) { setBusy(true); setError(''); try { const data = await request<any>('priority', `decisions/scenarios/${encodeURIComponent(item.id)}`); setSelected(data); setResult(data.result); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  const [confirmDiscard, setConfirmDiscard] = useState<any | null>(null);

  async function executeDiscard(item: any) {
    setBusy(true); setError('');
    try {
      await request('priority', `decisions/scenarios/${encodeURIComponent(item.id)}`, 'DELETE');
      if (selected?.id === item.id) setSelected(null);
      setConfirmDiscard(null);
      await load();
      setMessage('Escenario descartado.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const scopedProjects = context?.projects.filter(p => !scope.portfolioId || p.portfolioId === scope.portfolioId) || [];
  const activeResult = result?.scenarios;
  const resolveScopeLabel = (itemScope?: { projectId?: string; portfolioId?: string }) => {
    if (itemScope?.projectId) {
      return (
        context?.projects.find(p => p.id === itemScope.projectId)?.name ||
        (isOpaqueId(itemScope.projectId) ? 'Proyecto' : itemScope.projectId)
      );
    }
    if (itemScope?.portfolioId) {
      return (
        context?.portfolios.find(p => p.id === itemScope.portfolioId)?.name ||
        (isOpaqueId(itemScope.portfolioId) ? 'Portafolio' : itemScope.portfolioId)
      );
    }
    return 'Toda la organización';
  };

  return <div className="decision-lab">
    <section className="panel"><div className="panelHeading"><div><h2>Decision Lab</h2><span>Compara cambios hipotéticos con los datos de tu organización. No modifica proyectos ni presupuestos.</span></div><span className="mode-chip">{context?.sourceCompleteness === 'PARTIAL' ? 'FUENTES PARCIALES' : 'CONSULTA DE SOLO LECTURA'}</span></div>
      <p className="decision-source">{context?.sourceCompleteness === 'PARTIAL' ? `Alcance parcial: ${context.truncatedSources.join(', ')}.` : 'Calculado con los portafolios, proyectos, recursos, presupuestos y prioridades de tu organización.'} Los resultados son cálculos del escenario, no predicciones.</p>
      {context?.capabilities.canSimulate ? <form onSubmit={simulate}>
        <div className="decision-scope"><label>Portafolio<select value={scope.portfolioId || ''} onChange={e => setScope(e.target.value ? { portfolioId: e.target.value } : {})}><option value="">Todos los portafolios</option>{context.portfolios.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}</select></label><label>Proyecto<select value={scope.projectId || ''} onChange={e => setScope(e.target.value ? { projectId: e.target.value } : {})}><option value="">Todos los proyectos del alcance</option>{scopedProjects.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}</select></label></div>
        <div className="decision-scenarios">{(['A', 'B'] as const).map(key => { const v = scenarios[key]; return <fieldset className={`decision-scenario scenario-${key.toLowerCase()}`} key={key}><legend>Escenario {key}</legend><label>Presupuesto disponible<input type="number" min="0" step="0.01" value={v.budgetLimit} onChange={e => update(key, { budgetLimit: e.target.value })} placeholder="Usar saldo calculado"/></label><label>Moneda<select value={v.currency} onChange={e => update(key, { currency: e.target.value })}><option value="">Automática si no hay ambigüedad</option>{context.currencies.map(c => <option key={c}>{c}</option>)}</select></label>
          <details><summary>Modificar asignación de recurso</summary><div className="decision-controls"><label>Recurso<select value={v.resourceId} onChange={e => update(key, { resourceId: e.target.value })}><option value="">Sin cambio</option>{context.resources.map(r => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}</select></label><label>Proyecto origen<select value={v.fromProjectId} onChange={e => update(key, { fromProjectId: e.target.value })}><option value="">Sin liberar otro proyecto</option>{scopedProjects.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}</select></label><label>Proyecto destino<select value={v.projectId} onChange={e => update(key, { projectId: e.target.value })}><option value="">Seleccionar</option>{scopedProjects.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}</select></label><label>Asignación destino (%)<input type="number" min="0" max="100" value={v.allocation} onChange={e => update(key, { allocation: e.target.value })}/></label></div><small>La simulación libera la asignación del origen seleccionado y establece el valor indicado en el destino.</small></details>
          <details><summary>Cambiar fechas planificadas</summary><div className="decision-controls"><label>Proyecto<select value={v.dateProject} onChange={e => update(key, { dateProject: e.target.value })}><option value="">Seleccionar</option>{scopedProjects.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}</select></label><label>Inicio<input type="date" value={v.startDate} onChange={e => update(key, { startDate: e.target.value })}/></label><label>Cierre<input type="date" value={v.endDate} onChange={e => update(key, { endDate: e.target.value })}/></label></div></details>
          <details><summary>Ponderaciones de prioridad</summary><div className="decision-controls">{criteria.map(field => <label key={field}>{formatDecisionCriteriaLabel(field)} (0–1)<input type="number" min="0" max="1" step="0.01" value={v.priorityWeights[field]} onChange={e => updateWeight(key, field, e.target.value)}/></label>)}</div><small>La suma debe ser 1. Puntaje = impacto×peso + urgencia×peso + alineación×peso + (100−riesgo)×peso.</small></details>
        </fieldset>; })}</div><button className="primary" disabled={busy}>{busy ? 'Calculando…' : <>Comparar escenarios <ArrowRight size={16}/></>}</button>
      </form> : <p>Tu rol puede consultar escenarios compartidos, pero no crear simulaciones.</p>}
    </section>
    {error && <p className="error banner" role="alert">{error}</p>}{message && <p className="notice banner" role="status">{message}</p>}
    {activeResult && <>
      <section className="panel"><div className="panelHeading"><div><h2>Comparación</h2><span>{selected ? <>{selected.name} · <StatusBadge value={selected.reviewStatus} /></> : 'Escenario base frente a A y B'}</span></div><span className="mode-chip">{result.sourceCompleteness === 'PARTIAL' ? 'Datos parciales' : 'Datos completos'}</span></div>
        <div className="decision-results">{[['BASE','Base'],['A',activeResult.A.name],['B',activeResult.B.name]].map(([key,label]) => <article className={`decision-card card-${String(key).toLowerCase()}`} key={key}><h3>{label}</h3><dl>{Object.entries(activeResult[key].metrics).map(([metric,value]: any) => <div key={metric}><dt>{formatDecisionMetricLabel(metric)}</dt><dd><Metric metric={value}/></dd></div>)}</dl></article>)}</div>
        <div className="tableWrap"><table><thead><tr><th>Proyecto</th><th>Base</th><th>Escenario A</th><th>Escenario B</th></tr></thead><tbody>{(activeResult.BASE.projects || []).map((p: any) => { const a = activeResult.A.projects.find((x: any) => x.projectId === p.projectId); const b = activeResult.B.projects.find((x: any) => x.projectId === p.projectId); return <tr key={p.projectId}><td><strong>{p.name || p.projectId}</strong></td>{[p,a,b].map((row: any, i) => <td key={i}><span className="decision-score-pill">{row?.priorityScore?.status === 'CALCULATED' ? `Puntaje ${row.priorityScore.value}` : 'Prioridad no calculable'}</span> · costo {row?.plannedCost?.status === 'CALCULATED' ? row.plannedCost.value : 'No calculable'}<br/><small>Cierre: {row?.dates?.scenario?.endDate ? formatDate(row.dates.scenario.endDate) : 'No registrado'}</small></td>)}</tr>; })}</tbody></table>{!activeResult.BASE.projects?.length && <div className="empty">No hay proyectos en este alcance.</div>}</div>
        <h3>Diferencias numéricas frente al escenario base</h3>
        <div className="decision-results">
          {Object.entries(result.comparison || {}).map(([key, value]: any) => (
            <article key={key}>
              <b>{formatDecisionMetricLabel(key)}</b>
              {value.deltaFromBase ? (
                <div className="delta-badges-row">
                  {Object.entries(value.deltaFromBase).map(([scenario, delta]) => {
                    const num = Number(delta);
                    const tone = num > 0 ? 'delta-positive' : num < 0 ? 'delta-negative' : 'delta-neutral';
                    return (
                      <span key={scenario} className={`delta-badge ${tone}`}>
                        <strong>{formatScenarioLabel(scenario)}:</strong> {num > 0 ? `+${delta}` : String(delta)}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p>No calculable como diferencia numérica.</p>
              )}
            </article>
          ))}
        </div>
        <h3>Capacidad y asignación de recursos</h3><div className="tableWrap"><table><thead><tr><th>Recurso</th><th>Capacidad registrada</th><th>Base</th><th>Escenario A</th><th>Escenario B</th></tr></thead><tbody>{(activeResult.BASE.resources || []).map((resource: any) => { const find = (scenario: string) => activeResult[scenario].resources.find((row: any) => row.resourceId === resource.resourceId); return <tr key={resource.resourceId}><td><strong>{resource.name || resource.resourceId}</strong></td><td>{resource.capacity ?? 'No calculable'}</td>{(['BASE','A','B'] as const).map(key => { const row = find(key); return <td key={key}>{row?.status === 'NOT_CALCULABLE' ? 'No calculable' : <span className={row?.overCapacity ? 'over-capacity-cell' : ''}>{row?.scenarioAllocation} asignado{row?.overCapacity ? ' · supera capacidad' : ''}</span>}</td>; })}</tr>; })}</tbody></table>{!activeResult.BASE.resources?.length && <div className="empty">No hay recursos en este alcance.</div>}</div>
        <h3>Restricciones y advertencias</h3><div className="decision-results">{(['BASE','A','B'] as const).map(k => <article key={k}><b>{formatScenarioLabel(k)}</b>{activeResult[k].constraints.length ? <ul>{activeResult[k].constraints.map((x: any,i:number)=><li key={i}>{formatConstraintLabel(x.code, x.message)}</li>)}</ul> : <p>Sin restricciones registradas.</p>}{activeResult[k].warnings.map((x:any,i:number)=><p key={i}>{x.message}</p>)}</article>)}</div>
        {context?.capabilities.canSave && <div className="decision-save"><label>Nombre del escenario<input value={name} onChange={e=>setName(e.target.value)} maxLength={100} placeholder="Revisión de presupuesto Q3"/></label><label>Visibilidad<select value={visibility} onChange={e=>setVisibility(e.target.value)}><option value="private">Solo yo</option><option value="tenant">Toda la organización</option></select></label><button className="secondary" disabled={busy || !name.trim()} onClick={() => void save()}><Save size={16}/>Guardar para revisión</button></div>}
      </section>
    </>}
    <section className="panel"><div className="panelHeading"><div><h2>Escenarios guardados</h2><span>Los escenarios guardados quedan pendientes de revisión y nunca se aplican automáticamente.</span></div></div><div className="tableWrap"><table><thead><tr><th>Nombre</th><th>Alcance</th><th>Estado</th><th>Visibilidad</th><th>Creado</th><th>Acciones</th></tr></thead><tbody>{saved.map(item=><tr key={item.id}><td><strong>{item.name}</strong></td><td>{resolveScopeLabel(item.scope)}</td><td><StatusBadge value={item.reviewStatus} /></td><td>{formatDecisionVisibility(item.visibility)}</td><td>{formatDate(item.createdAt)}</td><td><div className="rowActions"><button onClick={() => void open(item)}>Abrir reporte</button>{(context?.capabilities.canDeleteAll || (context?.capabilities.canDeleteOwn && item.createdBy === context.currentUserId)) && <button className="deleteAction" disabled={busy} onClick={() => setConfirmDiscard(item)}><Trash2 size={14}/>Descartar</button>}</div></td></tr>)}</tbody></table>{!saved.length && <div className="empty">No hay escenarios guardados.</div>}</div></section>
    {confirmDiscard && (
      <Modal
        open={Boolean(confirmDiscard)}
        title="Descartar escenario"
        subtitle="Esta acción no se puede deshacer."
        onClose={() => setConfirmDiscard(null)}
      >
        <div className="confirm-delete-box">
          <p className="confirm-delete-message">
            ¿Estás seguro de que deseas descartar el escenario <strong>"{confirmDiscard.name}"</strong>?
          </p>
          <div className="modal-form-actions">
            <button type="button" className="secondary" onClick={() => setConfirmDiscard(null)}>Cancelar</button>
            <button type="button" className="danger" disabled={busy} onClick={() => void executeDiscard(confirmDiscard)}>
              {busy ? 'Descartando…' : 'Descartar escenario'}
            </button>
          </div>
        </div>
      </Modal>
    )}
  </div>;
}

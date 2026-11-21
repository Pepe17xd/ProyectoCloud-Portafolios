import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, RotateCcw, Save, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react';
import CustomSelect from './components/CustomSelect';
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
type Context = {
  projects: any[];
  portfolios: any[];
  resources: any[];
  currencies: string[];
  currentUserId: string;
  capabilities: { canSimulate: boolean; canSave: boolean; canDeleteOwn: boolean; canDeleteAll: boolean };
  sourceCompleteness: string;
  truncatedSources: string[];
};
type Variables = {
  budgetLimit: string;
  currency: string;
  resourceId: string;
  fromProjectId: string;
  projectId: string;
  allocation: string;
  dateProject: string;
  startDate: string;
  endDate: string;
  priorityWeights: Record<string, string>;
};

const DEFAULT_WEIGHTS: Record<string, string> = {
  impact: '0.35',
  urgency: '0.25',
  alignment: '0.25',
  risk: '0.15',
};

const freshVariables = (): Variables => ({
  budgetLimit: '',
  currency: '',
  resourceId: '',
  fromProjectId: '',
  projectId: '',
  allocation: '',
  dateProject: '',
  startDate: '',
  endDate: '',
  priorityWeights: { ...DEFAULT_WEIGHTS },
});

const criteria = ['impact', 'urgency', 'alignment', 'risk'] as const;

function makeVariables(value: Variables) {
  const output: any = {};
  if (value.budgetLimit !== '') output.budgetLimit = Number(value.budgetLimit);
  if (value.currency) output.currency = value.currency;
  if (value.resourceId && value.projectId && value.allocation !== '') {
    output.resourceReassignments = [
      ...(value.fromProjectId ? [{ resourceId: value.resourceId, projectId: value.fromProjectId, allocation: 0 }] : []),
      { resourceId: value.resourceId, projectId: value.projectId, allocation: Number(value.allocation) / 100 },
    ];
  }
  if (value.dateProject && (value.startDate || value.endDate)) {
    output.dateOverrides = {
      [value.dateProject]: {
        ...(value.startDate ? { startDate: value.startDate } : {}),
        ...(value.endDate ? { endDate: value.endDate } : {}),
      },
    };
  }
  if (criteria.some(k => Math.abs((Number(value.priorityWeights[k]) || 0) - Number(DEFAULT_WEIGHTS[k])) > 0.001)) {
    output.priorityWeights = Object.fromEntries(criteria.map(k => [k, Number(value.priorityWeights[k])]));
  }
  return output;
}

function normalizeWeights(weights: Record<string, string>): Record<string, string> {
  const nums = criteria.map(k => Math.max(0, Number(weights[k]) || 0));
  const total = nums.reduce((acc, n) => acc + n, 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  const scaled = nums.map(n => Math.round((n / total) * 100) / 100);
  const diff = Math.round((1 - scaled.reduce((acc, n) => acc + n, 0)) * 100) / 100;
  if (diff !== 0) {
    const maxIdx = scaled.reduce((best, val, idx, arr) => (val > arr[best] ? idx : best), 0);
    scaled[maxIdx] = Math.max(0, Math.round((scaled[maxIdx] + diff) * 100) / 100);
  }
  return Object.fromEntries(criteria.map((k, idx) => [k, scaled[idx].toFixed(2)]));
}

function Metric({ metric, projectNames }: { metric: any; projectNames: Record<string, string> }) {
  if (metric?.status !== 'CALCULATED') {
    return <span className="decision-uncalculated">No calculable · {metric?.reason || 'Datos insuficientes'}</span>;
  }
  if (Array.isArray(metric.value)) {
    if (!metric.value.length) return <span className="decision-metric-val">Ninguno</span>;
    if (metric.unit === 'projectIds') {
      const names = metric.value.map((id: string) => projectNames[String(id)] || (isOpaqueId(id) ? 'Proyecto' : String(id)));
      return (
        <span className="decision-metric-val">
          {names.join(', ')} ({names.length})
        </span>
      );
    }
    return <span className="decision-metric-val">{metric.value.join(', ')} {metric.unit}</span>;
  }
  return <span className="decision-metric-val">{metric.value} {metric.unit}</span>;
}

export default function DecisionLab({ request }: Props) {
  const [context, setContext] = useState<Context | null>(null);
  const [budgets, setBudgets] = useState<any[]>([]);
  const [scope, setScope] = useState<{ projectId?: string; portfolioId?: string }>({});
  const [scenarios, setScenarios] = useState<Record<'A' | 'B', Variables>>({ A: freshVariables(), B: freshVariables() });
  const [activePreset, setActivePreset] = useState<string>('');
  const [result, setResult] = useState<any>(null);
  const [saved, setSaved] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState<any | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const ctx = await request<Context>('priority', 'decisions/context');
    const [list, budgetResp] = await Promise.all([
      request<any>('priority', 'decisions/scenarios'),
      request<any>('budget', 'budgets').catch(() => ({ items: [] })),
    ]);
    setContext(ctx);
    setSaved(list.items || []);
    setBudgets((budgetResp.items || []).filter((item: any) => item.entityType !== 'Expense'));
  }, [request]);

  useEffect(() => {
    void load().catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const scopedProjects = useMemo(
    () => context?.projects.filter(p => !scope.portfolioId || p.portfolioId === scope.portfolioId) || [],
    [context?.projects, scope.portfolioId],
  );

  const projectNames = useMemo(
    () =>
      Object.fromEntries(
        (context?.projects || [])
          .filter(p => p?.id && p?.name)
          .map(p => [String(p.id), String(p.name)]),
      ),
    [context?.projects],
  );

  const baseBudgetTotal = useMemo(() => {
    const activeIds = scope.projectId
      ? new Set([scope.projectId])
      : new Set(scopedProjects.map(p => String(p.id)));
    const scopedBudgets = budgets.filter(b => activeIds.has(String(b.projectId || '')));
    if (!scopedBudgets.length) return 0;
    const total = scopedBudgets.reduce((acc, b) => {
      const allocated = Number(b.allocated);
      const spent = Number(b.spent || 0);
      if (!Number.isFinite(allocated) || !Number.isFinite(spent)) return acc;
      return acc + Math.max(0, allocated - spent);
    }, 0);
    return Math.round(total);
  }, [budgets, scope.projectId, scopedProjects]);

  const sliderMax = useMemo(
    () => Math.max(50000, Math.ceil(((baseBudgetTotal || 50000) * 1.6) / 1000) * 1000),
    [baseBudgetTotal],
  );
  const sliderStep = sliderMax > 200000 ? 1000 : 500;

  function update(key: 'A' | 'B', patch: Partial<Variables>) {
    setActivePreset('');
    setScenarios(old => ({ ...old, [key]: { ...old[key], ...patch } }));
  }

  function updateWeight(key: 'A' | 'B', field: string, value: string) {
    setActivePreset('');
    setScenarios(old => ({
      ...old,
      [key]: { ...old[key], priorityWeights: { ...old[key].priorityWeights, [field]: value } },
    }));
  }

  const buildPayload = (state = scenarios) => ({
    scope,
    scenarios: (['A', 'B'] as const).map(key => ({
      key,
      name: `Escenario ${key}`,
      variables: makeVariables(state[key]),
    })),
  });

  async function runSimulation(targetScenarios = scenarios) {
    setBusy(true);
    setError('');
    setMessage('');
    setSelected(null);
    try {
      setResult(await request('priority', 'decisions/simulate', 'POST', buildPayload(targetScenarios)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function simulate(e: React.FormEvent) {
    e.preventDefault();
    await runSimulation();
  }

  async function applyPreset(presetId: 'balanced' | 'accelerate' | 'lean') {
    const base = baseBudgetTotal > 0 ? baseBudgetTotal : 48000;
    const firstResourceId = context?.resources[0]?.id ? String(context.resources[0].id) : '';
    const targetProjId = scopedProjects[0]?.id ? String(scopedProjects[0].id) : '';
    const originProjId = scopedProjects.length > 1 && scopedProjects[1]?.id ? String(scopedProjects[1].id) : '';

    let next: Record<'A' | 'B', Variables>;
    if (presetId === 'balanced') {
      next = {
        A: {
          ...freshVariables(),
          budgetLimit: String(Math.round(base * 1.1)),
          priorityWeights: { impact: '0.35', urgency: '0.25', alignment: '0.25', risk: '0.15' },
        },
        B: {
          ...freshVariables(),
          budgetLimit: String(Math.round(base * 0.8)),
          priorityWeights: { impact: '0.25', urgency: '0.20', alignment: '0.20', risk: '0.35' },
        },
      };
    } else if (presetId === 'accelerate') {
      next = {
        A: {
          ...freshVariables(),
          budgetLimit: String(Math.round(base * 1.2)),
          resourceId: firstResourceId,
          fromProjectId: originProjId,
          projectId: targetProjId,
          allocation: firstResourceId && targetProjId ? '75' : '',
          priorityWeights: { impact: '0.25', urgency: '0.45', alignment: '0.20', risk: '0.10' },
        },
        B: {
          ...freshVariables(),
          budgetLimit: String(Math.round(base)),
          priorityWeights: { impact: '0.50', urgency: '0.20', alignment: '0.20', risk: '0.10' },
        },
      };
    } else {
      next = {
        A: {
          ...freshVariables(),
          budgetLimit: String(Math.round(base * 0.85)),
          priorityWeights: { ...DEFAULT_WEIGHTS },
        },
        B: {
          ...freshVariables(),
          budgetLimit: String(Math.round(base * 0.7)),
          priorityWeights: { impact: '0.30', urgency: '0.15', alignment: '0.35', risk: '0.20' },
        },
      };
    }

    setScenarios(next);
    setActivePreset(presetId);
    setExpandedSections(old => ({
      ...old,
      ...(presetId === 'accelerate' && firstResourceId && targetProjId ? { 'A-res': true } : {}),
      'A-weights': true,
      'B-weights': true,
    }));
    await runSimulation(next);
  }

  function resetScenarios() {
    setActivePreset('');
    setScenarios({ A: freshVariables(), B: freshVariables() });
    setError('');
    setMessage('');
  }

  async function save() {
    if (!result || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const item = await request<any>('priority', 'decisions/scenarios', 'POST', {
        ...buildPayload(),
        name: name.trim(),
        visibility,
      });
      setMessage('Escenario guardado como pendiente de revisión.');
      setSelected(item);
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function open(item: any) {
    setBusy(true);
    setError('');
    try {
      const data = await request<any>('priority', `decisions/scenarios/${encodeURIComponent(item.id)}`);
      setSelected(data);
      setResult(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function executeDiscard(item: any) {
    setBusy(true);
    setError('');
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

  const portfolioOptions = [
    { value: '', label: 'Todos los portafolios' },
    ...(context?.portfolios || []).map(p => ({ value: String(p.id), label: String(p.name || 'Portafolio') })),
  ];

  const scopedProjectOptions = [
    { value: '', label: 'Todos los proyectos del alcance' },
    ...scopedProjects.map(p => ({ value: String(p.id), label: String(p.name || 'Proyecto') })),
  ];

  const targetProjectOptions = [
    { value: '', label: 'Seleccionar proyecto' },
    ...scopedProjects.map(p => ({ value: String(p.id), label: String(p.name || 'Proyecto') })),
  ];

  const originProjectOptions = [
    { value: '', label: 'Sin liberar otro proyecto' },
    ...scopedProjects.map(p => ({ value: String(p.id), label: String(p.name || 'Proyecto') })),
  ];

  const currencyOptions = [
    { value: '', label: 'Automática si no hay ambigüedad' },
    ...(context?.currencies || []).map(c => ({ value: String(c), label: String(c) })),
  ];

  const resourceOptions = [
    { value: '', label: 'Sin cambio' },
    ...(context?.resources || []).map(r => ({ value: String(r.id), label: String(r.name || 'Recurso') })),
  ];

  const visibilityOptions = [
    { value: 'private', label: 'Solo yo', description: 'Visible únicamente para tu usuario' },
    { value: 'tenant', label: 'Toda la organización', description: 'Compartido con los integrantes del espacio' },
  ];

  return (
    <div className="decision-lab">
      <section className="panel">
        <div className="panelHeading">
          <div>
            <h2>Decision Lab</h2>
            <span>Compara cambios hipotéticos con los datos de tu organización. No modifica proyectos ni presupuestos.</span>
          </div>
          <span className="mode-chip">
            {context?.sourceCompleteness === 'PARTIAL' ? 'FUENTES PARCIALES' : 'CONSULTA DE SOLO LECTURA'}
          </span>
        </div>

        <p className="decision-source">
          {context?.sourceCompleteness === 'PARTIAL'
            ? `Alcance parcial: ${context.truncatedSources.join(', ')}.`
            : 'Calculado con los portafolios, proyectos, recursos, presupuestos y prioridades de tu organización.'}{' '}
          Los resultados son cálculos del escenario, no predicciones.
        </p>

        {context?.capabilities.canSimulate ? (
          <form onSubmit={simulate}>
            <div className="decision-presets" aria-label="Plantillas rápidas de simulación">
              <span className="decision-presets-label">
                <Sparkles size={14} aria-hidden="true" />
                Escenarios rápidos:
              </span>
              <button
                type="button"
                disabled={busy}
                className={`decision-preset-btn ${activePreset === 'balanced' ? 'is-active' : ''}`}
                onClick={() => void applyPreset('balanced')}
              >
                Equilibrado vs. Conservador
              </button>
              <button
                type="button"
                disabled={busy}
                className={`decision-preset-btn ${activePreset === 'accelerate' ? 'is-active' : ''}`}
                onClick={() => void applyPreset('accelerate')}
              >
                Acelerar entrega
              </button>
              <button
                type="button"
                disabled={busy}
                className={`decision-preset-btn ${activePreset === 'lean' ? 'is-active' : ''}`}
                onClick={() => void applyPreset('lean')}
              >
                Ajustar presupuesto
              </button>
              <button
                type="button"
                disabled={busy}
                className="decision-preset-reset"
                onClick={resetScenarios}
              >
                <RotateCcw size={13} aria-hidden="true" />
                Restablecer
              </button>
            </div>

            <div className="decision-scope">
              <label>
                Portafolio
                <CustomSelect
                  value={scope.portfolioId || ''}
                  onChange={val => setScope(val ? { portfolioId: val } : {})}
                  options={portfolioOptions}
                  ariaLabel="Portafolio"
                />
              </label>
              <label>
                Proyecto
                <CustomSelect
                  value={scope.projectId || ''}
                  onChange={val => setScope(val ? { projectId: val } : {})}
                  options={scopedProjectOptions}
                  ariaLabel="Proyecto"
                />
              </label>
            </div>

            <div className="decision-scenarios">
              {(['A', 'B'] as const).map(key => {
                const v = scenarios[key];
                const budgetSliderVal = Math.min(
                  sliderMax,
                  Math.max(0, v.budgetLimit !== '' ? Number(v.budgetLimit) : baseBudgetTotal || 0),
                );
                const allocSliderVal = Math.min(100, Math.max(0, v.allocation !== '' ? Number(v.allocation) : 0));
                const weightSum = criteria.reduce((acc, k) => acc + (Number(v.priorityWeights[k]) || 0), 0);
                const weightValid = Math.abs(weightSum - 1) <= 0.001;
                const hasCustomWeights = criteria.some(
                  k => Math.abs((Number(v.priorityWeights[k]) || 0) - Number(DEFAULT_WEIGHTS[k])) > 0.001,
                );

                return (
                  <fieldset className={`decision-scenario scenario-${key.toLowerCase()}`} key={key}>
                    <legend>Escenario {key}</legend>

                    <div className="decision-slider-field">
                      <div className="decision-slider-head">
                        <label htmlFor={`budget-limit-${key}`}>Presupuesto disponible</label>
                        {baseBudgetTotal > 0 && (
                          <div className="decision-budget-chips">
                            <button
                              type="button"
                              onClick={() => update(key, { budgetLimit: String(Math.round(baseBudgetTotal * 0.8)) })}
                            >
                              -20%
                            </button>
                            <button
                              type="button"
                              onClick={() => update(key, { budgetLimit: String(baseBudgetTotal) })}
                            >
                              Saldo base
                            </button>
                            <button
                              type="button"
                              onClick={() => update(key, { budgetLimit: String(Math.round(baseBudgetTotal * 1.2)) })}
                            >
                              +20%
                            </button>
                          </div>
                        )}
                      </div>
                      <input
                        type="range"
                        className={`decision-slider slider-${key.toLowerCase()}`}
                        min={0}
                        max={sliderMax}
                        step={sliderStep}
                        aria-label={`Control deslizante de presupuesto para Escenario ${key}`}
                        value={budgetSliderVal}
                        onChange={e => update(key, { budgetLimit: e.target.value })}
                      />
                      <input
                        id={`budget-limit-${key}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={v.budgetLimit}
                        onChange={e => update(key, { budgetLimit: e.target.value })}
                        placeholder={baseBudgetTotal > 0 ? `Saldo calculado (${baseBudgetTotal.toLocaleString('es-PE')})` : 'Usar saldo calculado'}
                      />
                    </div>

                    <label className="decision-currency-label">
                      Moneda
                      <CustomSelect
                        value={v.currency}
                        onChange={val => update(key, { currency: val })}
                        options={currencyOptions}
                        ariaLabel={`Moneda para Escenario ${key}`}
                      />
                    </label>

                    <details
                      open={Boolean(expandedSections[`${key}-res`])}
                      onToggle={e => {
                        const isOpen = e.currentTarget.open;
                        setExpandedSections(old => ({ ...old, [`${key}-res`]: isOpen }));
                      }}
                    >
                      <summary>
                        <span>Modificar asignación de recurso</span>
                        {v.resourceId && v.projectId && <span className="summary-configured-pill">Configurado</span>}
                      </summary>
                      <div className="decision-controls">
                        <label>
                          Recurso
                          <CustomSelect
                            value={v.resourceId}
                            onChange={val => update(key, { resourceId: val })}
                            options={resourceOptions}
                            ariaLabel={`Recurso Escenario ${key}`}
                          />
                        </label>
                        <label>
                          Proyecto origen
                          <CustomSelect
                            value={v.fromProjectId}
                            onChange={val => update(key, { fromProjectId: val })}
                            options={originProjectOptions}
                            ariaLabel={`Proyecto origen Escenario ${key}`}
                          />
                        </label>
                        <label>
                          Proyecto destino
                          <CustomSelect
                            value={v.projectId}
                            onChange={val => update(key, { projectId: val })}
                            options={targetProjectOptions}
                            ariaLabel={`Proyecto destino Escenario ${key}`}
                          />
                        </label>
                        <div className="decision-slider-field">
                          <div className="decision-slider-head">
                            <label htmlFor={`alloc-${key}`}>Asignación destino (%)</label>
                            <span className="decision-live-pct">{allocSliderVal}%</span>
                          </div>
                          <input
                            type="range"
                            className={`decision-slider slider-${key.toLowerCase()}`}
                            min={0}
                            max={100}
                            step={5}
                            aria-label={`Control deslizante de asignación para Escenario ${key}`}
                            value={allocSliderVal}
                            onChange={e => update(key, { allocation: e.target.value })}
                          />
                          <input
                            id={`alloc-${key}`}
                            type="number"
                            min="0"
                            max="100"
                            value={v.allocation}
                            onChange={e => update(key, { allocation: e.target.value })}
                            placeholder="Ej. 75"
                          />
                        </div>
                      </div>
                      <small>La simulación libera la asignación del origen seleccionado y establece el valor indicado en el destino.</small>
                    </details>

                    <details
                      open={Boolean(expandedSections[`${key}-dates`])}
                      onToggle={e => {
                        const isOpen = e.currentTarget.open;
                        setExpandedSections(old => ({ ...old, [`${key}-dates`]: isOpen }));
                      }}
                    >
                      <summary>
                        <span>Cambiar fechas planificadas</span>
                        {v.dateProject && (v.startDate || v.endDate) && <span className="summary-configured-pill">Configurado</span>}
                      </summary>
                      <div className="decision-controls">
                        <label>
                          Proyecto
                          <CustomSelect
                            value={v.dateProject}
                            onChange={val => update(key, { dateProject: val })}
                            options={targetProjectOptions}
                            ariaLabel={`Proyecto para fechas Escenario ${key}`}
                          />
                        </label>
                        <label>
                          Inicio
                          <input type="date" value={v.startDate} onChange={e => update(key, { startDate: e.target.value })} />
                        </label>
                        <label>
                          Cierre
                          <input type="date" value={v.endDate} onChange={e => update(key, { endDate: e.target.value })} />
                        </label>
                      </div>
                    </details>

                    <details
                      open={Boolean(expandedSections[`${key}-weights`])}
                      onToggle={e => {
                        const isOpen = e.currentTarget.open;
                        setExpandedSections(old => ({ ...old, [`${key}-weights`]: isOpen }));
                      }}
                    >
                      <summary>
                        <span>
                          <SlidersHorizontal size={13} aria-hidden="true" /> Ponderaciones de prioridad
                          {hasCustomWeights && <span className="summary-configured-pill">Personalizado</span>}
                        </span>
                        <span className={`weight-sum-pill ${weightValid ? 'is-valid' : 'is-invalid'}`}>
                          {Math.round(weightSum * 100)}%
                        </span>
                      </summary>
                      <div className="decision-weights-bar">
                        <span className={`weight-sum-pill ${weightValid ? 'is-valid' : 'is-invalid'}`}>
                          Suma actual: {Math.round(weightSum * 100)}% {weightValid ? '· Válida' : '· Debe sumar 100%'}
                        </span>
                        {!weightValid && (
                          <button
                            type="button"
                            className="decision-normalize-btn"
                            onClick={() => update(key, { priorityWeights: normalizeWeights(v.priorityWeights) })}
                          >
                            Normalizar a 100%
                          </button>
                        )}
                      </div>
                      <div className="decision-controls">
                        {criteria.map(field => {
                          const rawNum = Number(v.priorityWeights[field]) || 0;
                          return (
                            <div className="decision-slider-field" key={field}>
                              <div className="decision-slider-head">
                                <label htmlFor={`weight-${key}-${field}`}>
                                  {formatDecisionCriteriaLabel(field)}
                                </label>
                                <span className="decision-live-pct">{Math.round(rawNum * 100)}%</span>
                              </div>
                              <input
                                type="range"
                                className={`decision-slider slider-${key.toLowerCase()}`}
                                min={0}
                                max={1}
                                step={0.05}
                                aria-label={`Ponderación ${formatDecisionCriteriaLabel(field)} Escenario ${key}`}
                                value={Math.min(1, Math.max(0, rawNum))}
                                onChange={e => updateWeight(key, field, e.target.value)}
                              />
                              <input
                                id={`weight-${key}-${field}`}
                                type="number"
                                min="0"
                                max="1"
                                step="0.01"
                                value={v.priorityWeights[field]}
                                onChange={e => updateWeight(key, field, e.target.value)}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <small>La suma debe ser 1 (100%). Puntaje = impacto×peso + urgencia×peso + alineación×peso + (100−riesgo)×peso.</small>
                    </details>
                  </fieldset>
                );
              })}
            </div>

            <button className="primary" disabled={busy}>
              {busy ? 'Calculando…' : <>Comparar escenarios <ArrowRight size={16} /></>}
            </button>
          </form>
        ) : (
          <p>Tu rol puede consultar escenarios compartidos, pero no crear simulaciones.</p>
        )}
      </section>

      {error && <p className="error banner" role="alert">{error}</p>}
      {message && <p className="notice banner" role="status">{message}</p>}

      {activeResult && (
        <section className="panel">
          <div className="panelHeading">
            <div>
              <h2>Comparación</h2>
              <span>
                {selected ? <>{selected.name} · <StatusBadge value={selected.reviewStatus} /></> : 'Escenario base frente a A y B'}
              </span>
            </div>
            <span className="mode-chip">{result.sourceCompleteness === 'PARTIAL' ? 'Datos parciales' : 'Datos completos'}</span>
          </div>

          <div className="decision-results">
            {([['BASE', 'Base'], ['A', activeResult.A.name], ['B', activeResult.B.name]] as const).map(([key, label]) => (
              <article className={`decision-card card-${String(key).toLowerCase()}`} key={key}>
                <h3>{label}</h3>
                <dl>
                  {Object.entries(activeResult[key].metrics).map(([metric, value]: any) => (
                    <div key={metric}>
                      <dt>{formatDecisionMetricLabel(metric)}</dt>
                      <dd><Metric metric={value} projectNames={projectNames} /></dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Proyecto</th>
                  <th>Base</th>
                  <th>Escenario A</th>
                  <th>Escenario B</th>
                </tr>
              </thead>
              <tbody>
                {(activeResult.BASE.projects || []).map((p: any) => {
                  const a = activeResult.A.projects.find((x: any) => x.projectId === p.projectId);
                  const b = activeResult.B.projects.find((x: any) => x.projectId === p.projectId);
                  return (
                    <tr key={p.projectId}>
                      <td><strong>{p.name || projectNames[p.projectId] || 'Proyecto'}</strong></td>
                      {[p, a, b].map((row: any, i) => (
                        <td key={i}>
                          <span className="decision-score-pill">
                            {row?.priorityScore?.status === 'CALCULATED' ? `Puntaje ${row.priorityScore.value}` : 'Prioridad no calculable'}
                          </span>{' '}
                          · costo {row?.plannedCost?.status === 'CALCULATED' ? row.plannedCost.value : 'No calculable'}
                          <br />
                          <small>Cierre: {row?.dates?.scenario?.endDate ? formatDate(row.dates.scenario.endDate) : 'No registrado'}</small>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!activeResult.BASE.projects?.length && <div className="empty">No hay proyectos en este alcance.</div>}
          </div>

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

          <h3>Capacidad y asignación de recursos</h3>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Recurso</th>
                  <th>Capacidad registrada</th>
                  <th>Base</th>
                  <th>Escenario A</th>
                  <th>Escenario B</th>
                </tr>
              </thead>
              <tbody>
                {(activeResult.BASE.resources || []).map((resource: any) => {
                  const find = (scenario: string) =>
                    activeResult[scenario].resources.find((row: any) => row.resourceId === resource.resourceId);
                  return (
                    <tr key={resource.resourceId}>
                      <td><strong>{resource.name || 'Recurso'}</strong></td>
                      <td>{resource.capacity ?? 'No calculable'}</td>
                      {(['BASE', 'A', 'B'] as const).map(key => {
                        const row = find(key);
                        return (
                          <td key={key}>
                            {row?.status === 'NOT_CALCULABLE' ? (
                              'No calculable'
                            ) : (
                              <span className={row?.overCapacity ? 'over-capacity-cell' : ''}>
                                {row?.scenarioAllocation} asignado{row?.overCapacity ? ' · supera capacidad' : ''}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!activeResult.BASE.resources?.length && <div className="empty">No hay recursos en este alcance.</div>}
          </div>

          <h3>Restricciones y advertencias</h3>
          <div className="decision-results">
            {(['BASE', 'A', 'B'] as const).map(k => (
              <article key={k}>
                <b>{formatScenarioLabel(k)}</b>
                {activeResult[k].constraints.length ? (
                  <ul>
                    {activeResult[k].constraints.map((x: any, i: number) => (
                      <li key={i}>{formatConstraintLabel(x.code, x.message)}</li>
                    ))}
                  </ul>
                ) : (
                  <p>Sin restricciones registradas.</p>
                )}
                {activeResult[k].warnings.map((x: any, i: number) => (
                  <p key={i}>{x.message}</p>
                ))}
              </article>
            ))}
          </div>

          {context?.capabilities.canSave && (
            <div className="decision-save">
              <label>
                Nombre del escenario
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  maxLength={100}
                  placeholder="Revisión de presupuesto Q3"
                />
              </label>
              <label>
                Visibilidad
                <CustomSelect
                  value={visibility}
                  onChange={val => setVisibility(val)}
                  options={visibilityOptions}
                  ariaLabel="Visibilidad del escenario"
                />
              </label>
              <button className="secondary" disabled={busy || !name.trim()} onClick={() => void save()}>
                <Save size={16} />Guardar para revisión
              </button>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panelHeading">
          <div>
            <h2>Escenarios guardados</h2>
            <span>Los escenarios guardados quedan pendientes de revisión y nunca se aplican automáticamente.</span>
          </div>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Alcance</th>
                <th>Estado</th>
                <th>Visibilidad</th>
                <th>Creado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {saved.map(item => (
                <tr key={item.id}>
                  <td><strong>{item.name}</strong></td>
                  <td>{resolveScopeLabel(item.scope)}</td>
                  <td><StatusBadge value={item.reviewStatus} /></td>
                  <td>{formatDecisionVisibility(item.visibility)}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <div className="rowActions">
                      <button type="button" onClick={() => void open(item)}>Abrir reporte</button>
                      {(context?.capabilities.canDeleteAll ||
                        (context?.capabilities.canDeleteOwn && item.createdBy === context.currentUserId)) && (
                        <button
                          type="button"
                          className="deleteAction"
                          disabled={busy}
                          onClick={() => setConfirmDiscard(item)}
                        >
                          <Trash2 size={14} />Descartar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!saved.length && <div className="empty">No hay escenarios guardados.</div>}
        </div>
      </section>

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
    </div>
  );
}

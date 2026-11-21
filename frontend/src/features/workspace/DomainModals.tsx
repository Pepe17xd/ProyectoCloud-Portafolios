import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Check, Flag, Pencil, Plus, ReceiptText, Target, Trash2 } from 'lucide-react';
import CustomSelect from '../../components/CustomSelect';
import Modal from '../../components/Modal';
import { formatCurrency, formatDate, isDateOverdue, StatusBadge } from '../../components/StatusBadge';
import { isOpaqueId } from '../../utils/display';

export type Item = Record<string, unknown> & { pk?: string; sk?: string; id?: string };
export type RequestFn = <T = any>(module: string, path: string, method?: string, body?: unknown) => Promise<T>;

function entityId(item: Item): string {
  if (typeof item.id === 'string' && item.id) return item.id;
  if (typeof item.sk === 'string') return item.sk.replace(/^ITEM#/, '');
  return '';
}

const OBJECTIVE_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'PLANNED', label: 'Planificado' },
  { value: 'IN_PROGRESS', label: 'En progreso' },
  { value: 'ACHIEVED', label: 'Cumplido' },
  { value: 'AT_RISK', label: 'En riesgo' },
  { value: 'ON_HOLD', label: 'En pausa' },
];

const MILESTONE_STATUS_OPTIONS = [
  { value: 'PLANNED', label: 'Planificado' },
  { value: 'IN_PROGRESS', label: 'En progreso' },
  { value: 'COMPLETED', label: 'Completado' },
  { value: 'AT_RISK', label: 'En riesgo' },
  { value: 'ON_HOLD', label: 'En pausa' },
];

const TASK_STATUS_OPTIONS = [
  { value: 'TODO', label: 'Por hacer' },
  { value: 'IN_PROGRESS', label: 'En progreso' },
  { value: 'BLOCKED', label: 'Bloqueada' },
  { value: 'DONE', label: 'Completada' },
];

export function PortfolioObjectivesModal({
  portfolio,
  onClose,
  request,
  canWrite,
  canDelete,
}: {
  portfolio: Item | null;
  onClose: () => void;
  request: RequestFn;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const portfolioId = portfolio ? entityId(portfolio) : '';
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', status: 'ACTIVE' });

  const load = useCallback(async () => {
    if (!portfolioId) return;
    setLoading(true);
    setError('');
    try {
      const data = await request<{ items: Item[] }>('portfolio', `portfolios/${encodeURIComponent(portfolioId)}/objectives`);
      setItems(data.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [portfolioId, request]);

  useEffect(() => {
    setEditingId(null);
    setConfirmDeleteId(null);
    setForm({ name: '', description: '', status: 'ACTIVE' });
    if (portfolioId) void load();
  }, [portfolioId, load]);

  async function startEdit(obj: Item) {
    const oid = entityId(obj);
    setBusy(true);
    setError('');
    try {
      const fresh = await request<Item>('portfolio', `portfolios/${encodeURIComponent(portfolioId)}/objectives/${encodeURIComponent(oid)}`).catch(() => obj);
      setEditingId(oid);
      setForm({
        name: String(fresh.name || ''),
        description: String(fresh.description || ''),
        status: String(fresh.status || 'ACTIVE'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const body = { name: form.name.trim(), description: form.description.trim(), status: form.status };
      if (editingId) {
        await request('portfolio', `portfolios/${encodeURIComponent(portfolioId)}/objectives/${encodeURIComponent(editingId)}`, 'PATCH', body);
      } else {
        await request('portfolio', `portfolios/${encodeURIComponent(portfolioId)}/objectives`, 'POST', body);
      }
      setEditingId(null);
      setForm({ name: '', description: '', status: 'ACTIVE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(oid: string) {
    setBusy(true);
    setError('');
    try {
      await request('portfolio', `portfolios/${encodeURIComponent(portfolioId)}/objectives/${encodeURIComponent(oid)}`, 'DELETE');
      setConfirmDeleteId(null);
      if (editingId === oid) {
        setEditingId(null);
        setForm({ name: '', description: '', status: 'ACTIVE' });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(portfolio)}
      wide
      title={`Objetivos · ${String(portfolio?.name || 'Portafolio')}`}
      subtitle="Metas estratégicas asociadas a este portafolio."
      onClose={onClose}
    >
      <div className="domain-modal-section">
        {error && <p className="error banner" role="alert">{error}</p>}

        {canWrite && (
          <form className="domain-subform" onSubmit={submit}>
            <div className="domain-subform-grid">
              <label>
                Nombre del objetivo *
                <input
                  required
                  maxLength={140}
                  value={form.name}
                  onChange={e => setForm(old => ({ ...old, name: e.target.value }))}
                  placeholder="Ej. Reducir tiempos de entrega en 20%"
                />
              </label>
              <label>
                Estado
                <CustomSelect
                  value={form.status}
                  onChange={val => setForm(old => ({ ...old, status: val }))}
                  options={OBJECTIVE_STATUS_OPTIONS}
                  ariaLabel="Estado del objetivo"
                />
              </label>
            </div>
            <label>
              Descripción
              <input
                maxLength={280}
                value={form.description}
                onChange={e => setForm(old => ({ ...old, description: e.target.value }))}
                placeholder="Detalle opcional o criterio de éxito"
              />
            </label>
            <div className="domain-subform-actions">
              {editingId && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setEditingId(null);
                    setForm({ name: '', description: '', status: 'ACTIVE' });
                  }}
                >
                  Cancelar edición
                </button>
              )}
              <button type="submit" className="primary" disabled={busy || !form.name.trim()}>
                {editingId ? <><Check size={15} />Guardar cambios</> : <><Plus size={15} />Agregar objetivo</>}
              </button>
            </div>
          </form>
        )}

        <div className="domain-sublist">
          {loading ? (
            <div className="empty">Cargando objetivos…</div>
          ) : items.length ? (
            items.map(obj => {
              const oid = entityId(obj);
              return (
                <article className="domain-subitem" key={oid}>
                  <div className="domain-subitem-main">
                    <div className="domain-subitem-header">
                      <Target size={15} aria-hidden="true" />
                      <strong>{String(obj.name || 'Objetivo')}</strong>
                      <StatusBadge value={obj.status || 'ACTIVE'} />
                    </div>
                    {Boolean(obj.description) && <p className="domain-subitem-desc">{String(obj.description)}</p>}
                    {Boolean(obj.createdAt) && (
                      <div className="domain-subitem-meta">
                        <span>Registrado: {formatDate(obj.createdAt)}</span>
                      </div>
                    )}
                  </div>
                  <div className="domain-subitem-actions">
                    {canWrite && (
                      <button type="button" className="secondary" disabled={busy} onClick={() => void startEdit(obj)}>
                        <Pencil size={13} />Editar
                      </button>
                    )}
                    {canDelete &&
                      (confirmDeleteId === oid ? (
                        <>
                          <button type="button" className="danger" disabled={busy} onClick={() => void remove(oid)}>
                            Confirmar
                          </button>
                          <button type="button" className="secondary" onClick={() => setConfirmDeleteId(null)}>
                            No
                          </button>
                        </>
                      ) : (
                        <button type="button" className="deleteAction" disabled={busy} onClick={() => setConfirmDeleteId(oid)}>
                          <Trash2 size={13} />Eliminar
                        </button>
                      ))}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="empty">Aún no hay objetivos definidos para este portafolio.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function ProjectMilestonesModal({
  project,
  onClose,
  request,
  canWrite,
  canDelete,
}: {
  project: Item | null;
  onClose: () => void;
  request: RequestFn;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const projectId = project ? entityId(project) : '';
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', dueDate: '', status: 'PLANNED' });

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const data = await request<{ items: Item[] }>('project', `projects/${encodeURIComponent(projectId)}/milestones`);
      setItems(data.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, request]);

  useEffect(() => {
    setEditingId(null);
    setConfirmDeleteId(null);
    setForm({ name: '', description: '', dueDate: '', status: 'PLANNED' });
    if (projectId) void load();
  }, [projectId, load]);

  async function startEdit(milestone: Item) {
    const mid = entityId(milestone);
    setBusy(true);
    setError('');
    try {
      const fresh = await request<Item>('project', `projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(mid)}`).catch(() => milestone);
      setEditingId(mid);
      setForm({
        name: String(fresh.name || ''),
        description: String(fresh.description || ''),
        dueDate: fresh.dueDate ? String(fresh.dueDate).slice(0, 10) : '',
        status: String(fresh.status || 'PLANNED'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim(),
        status: form.status,
        ...(form.dueDate ? { dueDate: form.dueDate } : {}),
      };
      if (editingId) {
        await request('project', `projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(editingId)}`, 'PATCH', body);
      } else {
        await request('project', `projects/${encodeURIComponent(projectId)}/milestones`, 'POST', body);
      }
      setEditingId(null);
      setForm({ name: '', description: '', dueDate: '', status: 'PLANNED' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(mid: string) {
    setBusy(true);
    setError('');
    try {
      await request('project', `projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(mid)}`, 'DELETE');
      setConfirmDeleteId(null);
      if (editingId === mid) {
        setEditingId(null);
        setForm({ name: '', description: '', dueDate: '', status: 'PLANNED' });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(project)}
      wide
      title={`Hitos · ${String(project?.name || 'Proyecto')}`}
      subtitle="Entregables y fechas clave de seguimiento del proyecto."
      onClose={onClose}
    >
      <div className="domain-modal-section">
        {error && <p className="error banner" role="alert">{error}</p>}

        {canWrite && (
          <form className="domain-subform" onSubmit={submit}>
            <div className="domain-subform-grid">
              <label>
                Nombre del hito *
                <input
                  required
                  maxLength={140}
                  value={form.name}
                  onChange={e => setForm(old => ({ ...old, name: e.target.value }))}
                  placeholder="Ej. Aprobación de arquitectura"
                />
              </label>
              <label>
                Fecha objetivo
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={e => setForm(old => ({ ...old, dueDate: e.target.value }))}
                />
              </label>
              <label>
                Estado
                <CustomSelect
                  value={form.status}
                  onChange={val => setForm(old => ({ ...old, status: val }))}
                  options={MILESTONE_STATUS_OPTIONS}
                  ariaLabel="Estado del hito"
                />
              </label>
            </div>
            <label>
              Descripción
              <input
                maxLength={280}
                value={form.description}
                onChange={e => setForm(old => ({ ...old, description: e.target.value }))}
                placeholder="Criterios de aceptación o notas clave"
              />
            </label>
            <div className="domain-subform-actions">
              {editingId && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setEditingId(null);
                    setForm({ name: '', description: '', dueDate: '', status: 'PLANNED' });
                  }}
                >
                  Cancelar edición
                </button>
              )}
              <button type="submit" className="primary" disabled={busy || !form.name.trim()}>
                {editingId ? <><Check size={15} />Guardar cambios</> : <><Plus size={15} />Agregar hito</>}
              </button>
            </div>
          </form>
        )}

        <div className="domain-sublist">
          {loading ? (
            <div className="empty">Cargando hitos…</div>
          ) : items.length ? (
            items.map(milestone => {
              const mid = entityId(milestone);
              const overdue = isDateOverdue(milestone.dueDate, milestone.status);
              return (
                <article className="domain-subitem" key={mid}>
                  <div className="domain-subitem-main">
                    <div className="domain-subitem-header">
                      <Flag size={15} aria-hidden="true" />
                      <strong>{String(milestone.name || 'Hito')}</strong>
                      <StatusBadge value={milestone.status || 'PLANNED'} />
                      {overdue && <span className="overdue-pill">Vencido</span>}
                    </div>
                    {Boolean(milestone.description) && (
                      <p className="domain-subitem-desc">{String(milestone.description)}</p>
                    )}
                    <div className="domain-subitem-meta">
                      <span>
                        <CalendarDays size={12} aria-hidden="true" />{' '}
                        {milestone.dueDate ? formatDate(milestone.dueDate) : 'Sin fecha objetivo'}
                      </span>
                    </div>
                  </div>
                  <div className="domain-subitem-actions">
                    {canWrite && (
                      <button type="button" className="secondary" disabled={busy} onClick={() => void startEdit(milestone)}>
                        <Pencil size={13} />Editar
                      </button>
                    )}
                    {canDelete &&
                      (confirmDeleteId === mid ? (
                        <>
                          <button type="button" className="danger" disabled={busy} onClick={() => void remove(mid)}>
                            Confirmar
                          </button>
                          <button type="button" className="secondary" onClick={() => setConfirmDeleteId(null)}>
                            No
                          </button>
                        </>
                      ) : (
                        <button type="button" className="deleteAction" disabled={busy} onClick={() => setConfirmDeleteId(mid)}>
                          <Trash2 size={13} />Eliminar
                        </button>
                      ))}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="empty">No hay hitos registrados para este proyecto.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function TaskDetailModal({
  projectId,
  task,
  teamMembers,
  onClose,
  onUpdated,
  request,
  canWrite,
  canDelete,
}: {
  projectId: string;
  task: Item | null;
  teamMembers: Item[];
  onClose: () => void;
  onUpdated: () => Promise<void>;
  request: RequestFn;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const taskId = task ? String(task.id || '') : '';
  const [form, setForm] = useState({ title: '', description: '', status: 'TODO', dueDate: '', assigneeId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!task || !projectId || !taskId) return;
    setConfirmingDelete(false);
    setError('');
    setForm({
      title: String(task.title || ''),
      description: String(task.description || ''),
      status: String(task.status || 'TODO'),
      dueDate: task.dueDate ? String(task.dueDate).slice(0, 10) : '',
      assigneeId: String(task.assigneeId || ''),
    });
    let active = true;
    void request<Item>('project', `projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`)
      .then(fresh => {
        if (!active || !fresh) return;
        setForm({
          title: String(fresh.title || task.title || ''),
          description: String(fresh.description || ''),
          status: String(fresh.status || 'TODO'),
          dueDate: fresh.dueDate ? String(fresh.dueDate).slice(0, 10) : '',
          assigneeId: String(fresh.assigneeId || ''),
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [task, projectId, taskId, request]);

  const assigneeOptions = [
    { value: '', label: 'Sin asignar' },
    ...teamMembers.map(member => ({
      value: entityId(member),
      label: String(member.name || member.email || 'Integrante'),
    })),
  ];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    setError('');
    try {
      await request('project', `projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, 'PATCH', {
        title: form.title.trim(),
        description: form.description.trim(),
        status: form.status,
        dueDate: form.dueDate,
        assigneeId: form.assigneeId,
      });
      await onUpdated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await request('project', `projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, 'DELETE');
      await onUpdated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(task)}
      title="Detalle de tarea"
      subtitle="Actualiza el estado, responsable o fecha límite de esta tarea."
      onClose={onClose}
    >
      <div className="domain-modal-section">
        {error && <p className="error banner" role="alert">{error}</p>}
        <form className="modal-form" onSubmit={save}>
          <div className="modal-fields-grid">
            <label>
              Título *
              <input
                required
                disabled={!canWrite}
                maxLength={180}
                value={form.title}
                onChange={e => setForm(old => ({ ...old, title: e.target.value }))}
              />
            </label>
            <label>
              Estado
              <CustomSelect
                disabled={!canWrite}
                value={form.status}
                onChange={val => setForm(old => ({ ...old, status: val }))}
                options={TASK_STATUS_OPTIONS}
                ariaLabel="Estado de la tarea"
              />
            </label>
            <label>
              Fecha de vencimiento
              <input
                type="date"
                disabled={!canWrite}
                value={form.dueDate}
                onChange={e => setForm(old => ({ ...old, dueDate: e.target.value }))}
              />
            </label>
            <label>
              Responsable
              <CustomSelect
                disabled={!canWrite}
                value={form.assigneeId}
                onChange={val => setForm(old => ({ ...old, assigneeId: val }))}
                options={assigneeOptions}
                ariaLabel="Responsable de la tarea"
              />
            </label>
          </div>
          <label className="domain-inline-label">
            Descripción
            <textarea
              rows={3}
              disabled={!canWrite}
              maxLength={500}
              className="domain-inline-input"
              value={form.description}
              onChange={e => setForm(old => ({ ...old, description: e.target.value }))}
              placeholder="Notas o contexto adicional para completar la tarea"
            />
          </label>
          <div className="modal-form-actions">
            {canDelete &&
              (confirmingDelete ? (
                <>
                  <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>
                    {busy ? 'Eliminando…' : 'Confirmar eliminación'}
                  </button>
                  <button type="button" className="secondary" onClick={() => setConfirmingDelete(false)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <button type="button" className="deleteAction" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                  <Trash2 size={14} />Eliminar tarea
                </button>
              ))}
            <button type="button" className="secondary" onClick={onClose}>Cerrar</button>
            {canWrite && (
              <button type="submit" className="primary" disabled={busy || !form.title.trim()}>
                {busy ? 'Guardando…' : 'Guardar cambios'}
              </button>
            )}
          </div>
        </form>
      </div>
    </Modal>
  );
}

export function BudgetSummaryModal({
  budget,
  projectName,
  onClose,
  onRegisterExpense,
  request,
}: {
  budget: Item | null;
  projectName: string;
  onClose: () => void;
  onRegisterExpense: (budgetId: string) => void;
  request: RequestFn;
}) {
  const budgetId = budget ? entityId(budget) : '';
  const currency = String(budget?.currency || 'USD');
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!budgetId) return;
    setLoading(true);
    setError('');
    setSummary(null);
    void request<any>('budget', `budgets/${encodeURIComponent(budgetId)}/summary`)
      .then(data => setSummary(data))
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [budgetId, request]);

  const allocated = Number(summary?.allocated ?? budget?.allocated ?? 0);
  const spent = Number(summary?.spent ?? budget?.spent ?? 0);
  const balance = Number(summary?.balance ?? (allocated - spent));
  const variancePct = Number(summary?.variancePercent ?? (allocated > 0 ? (spent / allocated) * 100 : 0));
  const displayProjectName =
    projectName || (isOpaqueId(budget?.projectId) ? 'Proyecto' : String(budget?.projectId || 'Proyecto'));

  return (
    <Modal
      open={Boolean(budget)}
      wide
      title={`Resumen financiero · ${displayProjectName}`}
      subtitle={`Detalle consolidado de presupuesto y gastos (${currency}).`}
      onClose={onClose}
    >
      <div className="domain-modal-section">
        {error && <p className="error banner" role="alert">{error}</p>}
        {loading ? (
          <div className="empty">Consultando movimientos del presupuesto…</div>
        ) : (
          <>
            <div className="budget-kpi-grid">
              <div className="budget-kpi-card">
                <span>Techo asignado</span>
                <strong>{formatCurrency(allocated, currency)}</strong>
              </div>
              <div className="budget-kpi-card">
                <span>Ejecutado</span>
                <strong>{formatCurrency(spent, currency)}</strong>
              </div>
              <div className="budget-kpi-card">
                <span>Saldo disponible</span>
                <strong className={balance < 0 ? 'is-danger' : 'is-success'}>
                  {formatCurrency(balance, currency)}
                </strong>
              </div>
              <div className="budget-kpi-card">
                <span>Consumo</span>
                <strong>{Math.round(variancePct)}%</strong>
              </div>
            </div>

            <div className="inline-meter-track">
              <span
                className={`inline-meter-fill ${spent > allocated ? 'fill-rose' : variancePct >= 80 ? 'fill-amber' : 'fill-emerald'}`}
                style={{ width: `${Math.min(100, Math.max(0, Math.round(variancePct)))}%` }}
              />
            </div>

            <div className="domain-sublist">
              <h3>Gastos registrados ({summary?.expenses?.length || 0})</h3>
              {summary?.expenses?.length ? (
                summary.expenses.map((exp: any) => (
                  <article className="domain-subitem" key={String(exp.id || exp.sk)}>
                    <div className="domain-subitem-main">
                      <strong>{String(exp.description || 'Gasto operativo')}</strong>
                      <div className="domain-subitem-meta">
                        <span>{formatDate(exp.createdAt)}</span>
                      </div>
                    </div>
                    <strong>{formatCurrency(exp.amount, exp.currency || currency)}</strong>
                  </article>
                ))
              ) : (
                <div className="empty">No hay gastos registrados para este presupuesto todavía.</div>
              )}
            </div>

            <div className="modal-form-actions">
              <button type="button" className="secondary" onClick={onClose}>Cerrar</button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  onClose();
                  onRegisterExpense(budgetId);
                }}
              >
                <ReceiptText size={16} />Registrar gasto
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

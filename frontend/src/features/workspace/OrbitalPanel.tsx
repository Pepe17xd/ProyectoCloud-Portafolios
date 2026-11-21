import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CheckCircle2, ClipboardCheck, Pause, Play, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import CustomSelect from '../../components/CustomSelect';
import Modal from '../../components/Modal';
import { formatDate, StatusBadge } from '../../components/StatusBadge';
import { formatRecurrenceLabel } from '../../utils/display';

type Item = Record<string, unknown> & { id?: string; sk?: string };
type RequestFn = <T = any>(module: string, path: string, method?: string, body?: unknown) => Promise<T>;
type Mode = 'reminder' | 'task' | 'free';

const RECURRENCE_OPTIONS = [
  { value: 'ONCE', label: 'Una vez' },
  { value: 'DAILY', label: 'Todos los días' },
  { value: 'WEEKLY', label: 'Cada semana' },
];

function defaultTomorrowDate(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function OrbitalPanel({
  request,
  canProposeTask,
}: {
  request: RequestFn;
  canProposeTask: boolean;
}) {
  const [mode, setMode] = useState<Mode>('reminder');
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderDate, setReminderDate] = useState(() => defaultTomorrowDate());
  const [reminderTime, setReminderTime] = useState('09:00');
  const [recurrence, setRecurrence] = useState('ONCE');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskProjectId, setTaskProjectId] = useState('');
  const [freeText, setFreeText] = useState('');

  const [projects, setProjects] = useState<Item[]>([]);
  const [reminders, setReminders] = useState<Item[]>([]);
  const [actions, setActions] = useState<Item[]>([]);
  const [pendingProposal, setPendingProposal] = useState<any>(null);
  const [confirmCancel, setConfirmCancel] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Lima',
    [],
  );

  const loadAll = useCallback(async () => {
    const [remData, actData, projData] = await Promise.all([
      request<{ items: Item[] }>('identity', 'reminders').catch(() => ({ items: [] })),
      request<{ items: Item[] }>('identity', 'intelligence/actions').catch(() => ({ items: [] })),
      request<{ items: Item[] }>('project', 'projects').catch(() => ({ items: [] })),
    ]);
    setReminders(remData.items || []);
    setActions(actData.items || []);
    const projList = projData.items || [];
    setProjects(projList);
    setTaskProjectId(prev => prev || (projList[0] ? String(projList[0].id || String(projList[0].sk || '').replace(/^ITEM#/, '')) : ''));
  }, [request]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const projectOptions = useMemo(
    () =>
      projects.map(p => ({
        value: String(p.id || String(p.sk || '').replace(/^ITEM#/, '')),
        label: String(p.name || 'Proyecto'),
      })),
    [projects],
  );

  async function submitProposal(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    let text = '';
    if (mode === 'reminder') {
      const clean = reminderTitle.trim();
      if (clean.length < 3) {
        setError('Escribe al menos 3 caracteres para el título del recordatorio.');
        return;
      }
      text = `Recuérdame ${clean} el ${reminderDate} a las ${reminderTime}`;
    } else if (mode === 'task') {
      const clean = taskTitle.trim().replace(/["“”]/g, '');
      if (clean.length < 3 || !taskProjectId) {
        setError('Indica un título válido y selecciona un proyecto.');
        return;
      }
      text = `Crear tarea "${clean}" en proyecto ${taskProjectId}`;
    } else {
      text = freeText.trim();
      if (text.length < 5) {
        setError('Escribe una instrucción completa para prepararla.');
        return;
      }
    }

    setBusy(true);
    try {
      const payload = mode === 'task' ? { text, timezone } : { text, timezone, recurrence };
      const res = await request<{ proposal: any }>('identity', 'intelligence/proposals', 'POST', payload);
      setPendingProposal(res.proposal || null);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmProposal(proposalId: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await request<any>('identity', `intelligence/actions/${encodeURIComponent(proposalId)}/confirm`, 'POST', {
        operationId: crypto.randomUUID(),
      });
      setPendingProposal(null);
      if (mode === 'reminder') setReminderTitle('');
      if (mode === 'task') setTaskTitle('');
      if (mode === 'free') setFreeText('');
      setNotice(
        res.task
          ? `Tarea "${res.task.title}" creada en el proyecto.`
          : 'Recordatorio programado en tu cuenta.',
      );
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function updateReminderStatus(reminder: Item, nextStatus: 'PAUSED' | 'SCHEDULED' | 'COMPLETED') {
    const rid = String(reminder.id || '');
    if (!rid) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('identity', `reminders/${encodeURIComponent(rid)}`, 'PATCH', { status: nextStatus });
      setNotice(
        nextStatus === 'PAUSED'
          ? 'Recordatorio pausado.'
          : nextStatus === 'COMPLETED'
          ? 'Recordatorio marcado como completado.'
          : 'Recordatorio reanudado.',
      );
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function executeCancelReminder(reminder: Item) {
    const rid = String(reminder.id || '');
    if (!rid) return;
    setBusy(true);
    setError('');
    try {
      await request('identity', `reminders/${encodeURIComponent(rid)}`, 'DELETE');
      setConfirmCancel(null);
      setNotice('Recordatorio cancelado.');
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel orbital-actions">
      <div className="panelHeading">
        <div>
          <h2><Bell size={18} /> Recordatorios y acciones guiadas</h2>
          <span>Prepara recordatorios personales o propuestas de tareas con confirmación previa antes de ejecutarlas.</span>
        </div>
        <span className="mode-chip">CON CONFIRMACIÓN</span>
      </div>

      <div className="orbital-mode-tabs" role="tablist" aria-label="Tipo de acción guiada">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'reminder'}
          className={`orbital-tab-btn ${mode === 'reminder' ? 'is-active' : ''}`}
          onClick={() => setMode('reminder')}
        >
          <Bell size={14} />Recordatorio
        </button>
        {canProposeTask && (
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'task'}
            className={`orbital-tab-btn ${mode === 'task' ? 'is-active' : ''}`}
            onClick={() => setMode('task')}
          >
            <Plus size={14} />Proponer tarea
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'free'}
          className={`orbital-tab-btn ${mode === 'free' ? 'is-active' : ''}`}
          onClick={() => setMode('free')}
        >
          <Sparkles size={14} />Texto libre
        </button>
      </div>

      <form onSubmit={submitProposal}>
        {mode === 'reminder' && (
          <div className="orbital-guided-grid">
            <label>
              Qué quieres recordar *
              <input
                required
                minLength={3}
                maxLength={180}
                value={reminderTitle}
                onChange={e => setReminderTitle(e.target.value)}
                placeholder="Ej. Revisar presupuesto trimestral"
              />
            </label>
            <label>
              Fecha
              <input
                required
                type="date"
                value={reminderDate}
                onChange={e => setReminderDate(e.target.value)}
              />
            </label>
            <label>
              Hora ({timezone})
              <input
                required
                type="time"
                value={reminderTime}
                onChange={e => setReminderTime(e.target.value)}
              />
            </label>
            <label>
              Repetición
              <CustomSelect
                value={recurrence}
                onChange={val => setRecurrence(val)}
                options={RECURRENCE_OPTIONS}
                ariaLabel="Frecuencia del recordatorio"
              />
            </label>
          </div>
        )}

        {mode === 'task' && (
          <div className="orbital-guided-grid">
            <label>
              Título de la tarea *
              <input
                required
                minLength={3}
                maxLength={150}
                value={taskTitle}
                onChange={e => setTaskTitle(e.target.value)}
                placeholder="Ej. Validar cronograma con finanzas"
              />
            </label>
            <label>
              Proyecto destino *
              <CustomSelect
                required
                value={taskProjectId}
                onChange={val => setTaskProjectId(val)}
                options={projectOptions}
                placeholder="Selecciona proyecto"
                ariaLabel="Proyecto destino de la tarea"
              />
            </label>
          </div>
        )}

        {mode === 'free' && (
          <>
            <div className="assistant-form">
              <label className="sr-only" htmlFor="orbital-free-input">Instrucción guiada</label>
              <input
                id="orbital-free-input"
                maxLength={300}
                value={freeText}
                onChange={e => setFreeText(e.target.value)}
                placeholder="Ej. Recuérdame revisar el proyecto mañana a las 09:00"
              />
            </div>
            <div className="assistant-prompts">
              {[
                'Recuérdame revisar avances mañana a las 09:00',
                'Recuérdame enviar reporte el lunes a las 10:00',
              ].map(sample => (
                <button type="button" key={sample} onClick={() => setFreeText(sample)}>
                  {sample}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="domain-subform-actions">
          <button type="submit" className="primary" disabled={busy}>
            <Send size={15} />{busy ? 'Preparando…' : 'Preparar propuesta'}
          </button>
        </div>
      </form>

      {error && <p className="error banner" role="alert">{error}</p>}
      {notice && <p className="notice banner" role="status">{notice}</p>}

      {pendingProposal && (
        <div className="action-proposal" role="region" aria-label="Propuesta pendiente de confirmación">
          <ClipboardCheck size={20} aria-hidden="true" />
          <span>
            <strong>{pendingProposal.kind === 'TASK_CREATE' ? 'Crear tarea' : 'Programar recordatorio'}:</strong>{' '}
            “{pendingProposal.title}”
            {pendingProposal.projectName ? ` en ${pendingProposal.projectName}` : ''}
            {pendingProposal.dueAt ? ` · ${formatDate(pendingProposal.dueAt)}` : ''}
          </span>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void confirmProposal(pendingProposal.id)}
          >
            Confirmar y crear
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setPendingProposal(null)}>
            Descartar
          </button>
        </div>
      )}

      <div className="orbital-reminder-list">
        <h3 className="orbital-section-title">Mis recordatorios ({reminders.length})</h3>
        {reminders.length ? (
          reminders.map(reminder => {
            const status = String(reminder.status || 'SCHEDULED').toUpperCase();
            return (
              <article key={String(reminder.id)}>
                <div>
                  <b>{String(reminder.title || 'Recordatorio')}</b>
                  <span>
                    {formatDate(reminder.dueAt)} · {formatRecurrenceLabel(reminder.recurrence)} · <StatusBadge value={status} />
                  </span>
                </div>
                {status === 'SCHEDULED' && (
                  <>
                    <button
                      type="button"
                      className="textButton"
                      disabled={busy}
                      onClick={() => void updateReminderStatus(reminder, 'PAUSED')}
                    >
                      <Pause size={14} />Pausar
                    </button>
                    <button
                      type="button"
                      className="textButton"
                      disabled={busy}
                      onClick={() => void updateReminderStatus(reminder, 'COMPLETED')}
                    >
                      <CheckCircle2 size={14} />Completar
                    </button>
                  </>
                )}
                {status === 'PAUSED' && (
                  <button
                    type="button"
                    className="textButton"
                    disabled={busy}
                    onClick={() => void updateReminderStatus(reminder, 'SCHEDULED')}
                  >
                    <Play size={14} />Reanudar
                  </button>
                )}
                {status !== 'CANCELLED' && status !== 'COMPLETED' && (
                  <button
                    type="button"
                    className="deleteAction"
                    disabled={busy}
                    onClick={() => setConfirmCancel(reminder)}
                  >
                    <Trash2 size={13} />Cancelar
                  </button>
                )}
              </article>
            );
          })
        ) : (
          <p>No tienes recordatorios registrados todavía.</p>
        )}
      </div>

      {actions.length > 0 && (
        <details className="orbital-action-history">
          <summary>Historial de acciones propuestas ({actions.length})</summary>
          {actions.slice(0, 10).map(action => (
            <article key={String(action.id)}>
              <div>
                <strong>{String(action.title || 'Acción')}</strong>{' '}
                <small>
                  · {action.kind === 'TASK_CREATE' ? 'Tarea' : 'Recordatorio'} · {formatDate(action.createdAt)}
                </small>
              </div>
              <div className="domain-subitem-actions">
                <StatusBadge value={action.status} />
                {action.status === 'PENDING_CONFIRMATION' && (
                  <button
                    type="button"
                    className="textButton"
                    disabled={busy}
                    onClick={() => void confirmProposal(String(action.id))}
                  >
                    Confirmar
                  </button>
                )}
              </div>
            </article>
          ))}
        </details>
      )}

      {confirmCancel && (
        <Modal
          open={Boolean(confirmCancel)}
          title="Cancelar recordatorio"
          subtitle="Dejarás de recibir avisos de este recordatorio."
          onClose={() => setConfirmCancel(null)}
        >
          <div className="confirm-delete-box">
            <p className="confirm-delete-message">
              ¿Deseas cancelar el recordatorio <strong>“{String(confirmCancel.title || '')}”</strong>?
            </p>
            <div className="modal-form-actions">
              <button type="button" className="secondary" onClick={() => setConfirmCancel(null)}>Volver</button>
              <button type="button" className="danger" disabled={busy} onClick={() => void executeCancelReminder(confirmCancel)}>
                {busy ? 'Cancelando…' : 'Cancelar recordatorio'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

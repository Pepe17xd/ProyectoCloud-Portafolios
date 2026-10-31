import { randomUUID } from 'node:crypto';
import { Annotation, END, StateGraph } from '@langchain/langgraph';

const FlowState = Annotation.Root({
  tenantId: Annotation(), actor: Annotation(), workflowId: Annotation(), executionId: Annotation(), config: Annotation(), event: Annotation(), source: Annotation(), alerts: Annotation(), plan: Annotation(), report: Annotation(), errors: Annotation(),
});

function buildGraph({ monitor, persist, deliver }) {
  return new StateGraph(FlowState)
    .addNode('monitor', async (s) => ({ source: await monitor(s) }))
    .addNode('planner', async (s) => {
      const now = new Date(); const alerts = [];
      for (const project of s.source.projects || []) {
        if (project.status === 'ACTIVE' && project.endDate && new Date(project.endDate) < now) alerts.push({ kind: 'PROJECT_OVERDUE', entityId: project.id, cause: 'La fecha de cierre registrada ya pasó.', evidence: { endDate: project.endDate, status: project.status } });
      }
      for (const task of s.source.tasks || []) if (task.dueDate && new Date(task.dueDate) < now && !['DONE','COMPLETED'].includes(String(task.status).toUpperCase())) alerts.push({ kind: 'TASK_OVERDUE', entityId: task.id, cause: 'La tarea sigue pendiente después de su vencimiento.', evidence: { dueDate: task.dueDate, status: task.status } });
      for (const budget of s.source.budgets || []) { const threshold = Number(s.config.budgetThreshold ?? 1); if (Number(budget.allocated) > 0 && Number(budget.spent) / Number(budget.allocated) >= threshold) alerts.push({ kind: 'BUDGET_THRESHOLD', entityId: budget.id, cause: `Gasto registrado alcanzó el umbral ${threshold}.`, evidence: { allocated: budget.allocated, spent: budget.spent, threshold } }); }
      for (const resource of s.source.resources || []) if (Number(resource.allocated) > Number(resource.capacity)) alerts.push({ kind: 'RESOURCE_OVER_CAPACITY', entityId: resource.id, cause: 'Asignación registrada supera la capacidad registrada.', evidence: { allocated: resource.allocated, capacity: resource.capacity } });
      const plan = { dueTasks: (s.source.tasks || []).filter(x => x.dueDate && (new Date(x.dueDate)-now) < 7*86400000 && (new Date(x.dueDate)-now) >= 0).map(x => x.id), recipientUserId: s.config.recipientUserId || s.actor.userId, timezone: s.config.timezone || 'America/Lima' };
      return { alerts: alerts.map(a => ({ ...a, evaluatedAt: now.toISOString() })), plan };
    })
    .addNode('reporter', async (s) => {
      const pendingDecisionScenarios = (s.source.pendingDecisionScenarios || []).map(({ id, name, scope, createdAt }) => ({ id, name, scope, createdAt, status: 'PENDING_REVIEW' }));
      const report = { title: 'Resumen ProFiles Flow', generatedAt: new Date().toISOString(), workflowId: s.workflowId, executionId: s.executionId, counts: { projects: s.source.projects?.length || 0, portfolios: s.source.portfolios?.length || 0, tasks: s.source.tasks?.length || 0, budgets: s.source.budgets?.length || 0, resources: s.source.resources?.length || 0, priorities: s.source.priorities?.length || 0, pendingDecisionScenarios: pendingDecisionScenarios.length }, alerts: s.alerts, dueTasks: s.plan.dueTasks, pendingDecisionScenarios, explanation: 'Indicadores deterministas basados únicamente en registros consultados; no son predicciones. Los escenarios se muestran para revisión humana y nunca se aprueban ni aplican automáticamente.' };
      const delivery = await deliver({ tenantId: s.tenantId, idempotencyKey: s.executionId, report, recipient: s.plan.recipientUserId });
      await persist({ tenantId: s.tenantId, actor: s.actor, workflowId: s.workflowId, executionId: s.executionId, type: s.config.type, status: 'COMPLETED', sourceAt: s.source.fetchedAt, alerts: s.alerts, plan: s.plan, report, delivery, deliveryStatus: delivery.status, errors: s.errors, createdAt: new Date().toISOString() });
      return { report };
    })
    .addEdge('__start__', 'monitor').addEdge('monitor', 'planner').addEdge('planner', 'reporter').addEdge('reporter', END).compile();
}

export function createFlowEngine({ monitor, persist, deliver = async () => ({ status: 'NOT_CONFIGURED' }) }) {
  const graph = buildGraph({ monitor, persist, deliver });
  return async function execute({ tenantId, actor, workflowId, config, event, executionId:requestedExecutionId }) {
    if (!tenantId || !actor?.userId || !workflowId) throw Object.assign(new Error('Invalid flow context'), { status: 400 });
    if (!['ADMIN','MANAGER'].includes(actor.role)) throw Object.assign(new Error('Flow execution requires ADMIN or MANAGER'), { status: 403 });
    if (!['weekly-summary','reminder','risk-alert'].includes(config?.type)) throw Object.assign(new Error('Unsupported flow type'), { status: 400 });
    const executionId = requestedExecutionId || randomUUID();
    return graph.invoke({ tenantId, actor, workflowId, executionId, config, event, errors: [] });
  };
}

export function createLocalNotificationProvider() { return { async deliver({ idempotencyKey, report, recipient }) { return { id: idempotencyKey, recipient, status: 'SIMULATED', preview: `ProFiles tiene ${report.alerts.length} alertas para revisar. Inicia sesión para consultar el informe completo.` }; } }; }
export function createWhatsAppBusinessProvider() { return { async deliver() { throw Object.assign(new Error('WhatsApp Business provider is disabled'), { code: 'PROVIDER_DISABLED' }); } }; }

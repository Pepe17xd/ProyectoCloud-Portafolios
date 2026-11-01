import { randomUUID } from 'node:crypto';
import { Annotation, END, StateGraph } from '@langchain/langgraph';

const FlowState = Annotation.Root({
  tenantId: Annotation(), actor: Annotation(), workflowId: Annotation(), executionId: Annotation(), config: Annotation(), event: Annotation(), source: Annotation(), alerts: Annotation(), plan: Annotation(), report: Annotation(), errors: Annotation(),
});

export function buildRecipientFlowReport({ role, userId, source = {}, alerts = [], workflowId, executionId, now = new Date() }) {
  const organizationWide = ['ADMIN', 'MANAGER'].includes(role);
  const allProjects = source.projects || [];
  const allTasks = source.tasks || [];
  const tasks = organizationWide ? allTasks : allTasks.filter(task => task.assigneeId === userId);
  const relatedProjectIds = new Set(tasks.map(task => task.projectId).filter(Boolean));
  const projects = organizationWide ? allProjects : allProjects.filter(project => project.ownerId === userId || relatedProjectIds.has(project.id || project.projectId));
  const projectIds = new Set(projects.map(project => project.id || project.projectId));
  const visibleTasks = organizationWide ? tasks : tasks.filter(task => projectIds.has(task.projectId));
  const portfolios = organizationWide ? (source.portfolios || []) : (source.portfolios || []).filter(portfolio => projects.some(project => project.portfolioId === (portfolio.id || portfolio.portfolioId)));
  const visibleIds = new Set([...projectIds, ...visibleTasks.map(task => task.id || task.taskId)]);
  const visibleAlerts = organizationWide ? alerts : alerts.filter(alert => visibleIds.has(alert.entityId));
  const pendingDecisionScenarios = organizationWide
    ? (source.pendingDecisionScenarios || []).map(({ id, name, scope, createdAt }) => ({ id, name, scope, createdAt, status: 'PENDING_REVIEW' }))
    : [];
  const reportSource = {
    projects,
    portfolios,
    tasks: visibleTasks,
    budgets: organizationWide ? (source.budgets || []) : [],
    resources: organizationWide ? (source.resources || []) : [],
    priorities: organizationWide ? (source.priorities || []) : [],
  };
  const dueTasks = visibleTasks.filter(task => task.dueDate && (Date.parse(task.dueDate) - now.getTime()) < 7 * 86400000 && (Date.parse(task.dueDate) - now.getTime()) >= 0).map(task => task.id || task.taskId).filter(Boolean);
  const report = {
    title: 'Resumen ProFiles Flow', generatedAt: now.toISOString(), workflowId, executionId,
    recipientRole: role === 'VIEWER' ? 'USER' : role, recipientUserId: userId,
    scope: organizationWide ? 'organization' : 'assigned-work',
    counts: {
      projects: reportSource.projects.length, portfolios: reportSource.portfolios.length,
      tasks: reportSource.tasks.length, budgets: reportSource.budgets.length,
      resources: reportSource.resources.length, priorities: reportSource.priorities.length,
      pendingDecisionScenarios: pendingDecisionScenarios.length,
    },
    alerts: visibleAlerts, dueTasks, pendingDecisionScenarios,
    explanation: 'Resumen determinista basado únicamente en registros disponibles y autorizados; no es una predicción. Los escenarios se muestran para revisión humana y nunca se aprueban ni aplican automáticamente.',
  };
  const parameters = visibleAlerts.length ? [String(visibleAlerts.length)] : [String(organizationWide ? report.counts.projects : dueTasks.length)];
  return { report, parameters, eventType: visibleAlerts.length ? 'risk-alert' : 'weekly-summary' };
}

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
      const recipient = s.config.recipientUserId || s.actor.userId;
      const scoped = buildRecipientFlowReport({ role: s.config.recipientRole || s.actor.role, userId: recipient, source: s.source, alerts: s.alerts, workflowId: s.workflowId, executionId: s.executionId });
      const report = scoped.report;
      const delivery = await deliver({ tenantId: s.tenantId, idempotencyKey: s.executionId, report, recipient, source: s.source, alerts: s.alerts, workflowId: s.workflowId, recipientParameters: scoped.parameters, recipientEventType: scoped.eventType });
      await persist({ tenantId: s.tenantId, actor: s.actor, recipientUserId: recipient, workflowId: s.workflowId, executionId: s.executionId, type: s.config.type, status: 'COMPLETED', sourceAt: s.source.fetchedAt, alerts: report.alerts, plan: s.plan, report, delivery, deliveryStatus: delivery.status, errors: s.errors, createdAt: new Date().toISOString() });
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

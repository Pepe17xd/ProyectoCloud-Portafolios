const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}/i;
const TENANT_ID_RE = /^tenant-[a-z0-9-]+$/i;
const PREFIXED_ID_RE = /^(usr|user|proj|port|res|bud|doc|flow|task|assign|exp)-[a-z0-9-]{6,}$/i;
const LONG_HEX_RE = /^[0-9a-f]{16,}$/i;

/** Returns true when a value looks like an internal system/database identifier rather than human text. */
export function isOpaqueId(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('ITEM#')) return true;
  if (UUID_PREFIX_RE.test(trimmed)) return true;
  if (TENANT_ID_RE.test(trimmed)) return true;
  if (PREFIXED_ID_RE.test(trimmed)) return true;
  if (LONG_HEX_RE.test(trimmed)) return true;
  return false;
}

function titleCaseWords(raw: string): string {
  return raw
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/** Resolves a clean human-readable display name from profile fields without leaking internal IDs. */
export function formatUserDisplayName(
  profile?: { name?: string; email?: string; username?: string },
  fallback?: string,
): string {
  const name = typeof profile?.name === 'string' ? profile.name.trim() : '';
  if (name && !isOpaqueId(name)) {
    return name;
  }

  const email = typeof profile?.email === 'string' ? profile.email.trim() : '';
  if (email && email.includes('@')) {
    const localPart = email.split('@')[0];
    const formatted = titleCaseWords(localPart);
    if (formatted) return formatted;
  }

  const username = typeof profile?.username === 'string' ? profile.username.trim() : '';
  if (username && !isOpaqueId(username)) {
    if (username.includes('@')) {
      const formatted = titleCaseWords(username.split('@')[0]);
      if (formatted) return formatted;
    }
    return username;
  }

  const fb = typeof fallback === 'string' ? fallback.trim() : '';
  if (fb && !isOpaqueId(fb)) {
    if (fb.includes('@')) {
      const formatted = titleCaseWords(fb.split('@')[0]);
      if (formatted) return formatted;
    }
    return fb;
  }

  return 'Mi cuenta';
}

/** Extracts a concise first name for compact navigation triggers. */
export function formatFirstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return 'Mi cuenta';
  const first = trimmed.split(/\s+/)[0] || trimmed;
  return first.length > 18 ? `${first.slice(0, 17)}…` : first;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  MANAGER: 'Gestor',
  PM: 'Gestor de proyecto',
  MEMBER: 'Miembro',
  VIEWER: 'Solo lectura',
};

/** Maps internal access role codes to natural Spanish labels. */
export function formatRoleLabel(role?: unknown): string {
  if (typeof role !== 'string' || !role.trim()) return 'Miembro';
  const key = role.trim().toUpperCase();
  return ROLE_LABELS[key] || role.trim();
}

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  person: 'Persona',
  team: 'Equipo',
  equipment: 'Equipamiento',
};

/** Maps resource type codes to Spanish labels. */
export function formatResourceType(type?: unknown): string {
  if (typeof type !== 'string' || !type.trim()) return '—';
  const key = type.trim().toLowerCase();
  return RESOURCE_TYPE_LABELS[key] || type.trim();
}

const TASK_STATUS_LABELS: Record<string, string> = {
  TODO: 'Por hacer',
  IN_PROGRESS: 'En progreso',
  BLOCKED: 'Bloqueada',
  DONE: 'Completada',
};

/** Maps Kanban task status enums to Spanish labels. */
export function formatTaskStatus(status?: unknown): string {
  if (typeof status !== 'string' || !status.trim()) return 'Por hacer';
  const key = status.trim().toUpperCase();
  return TASK_STATUS_LABELS[key] || status.trim();
}

const ALERT_EVENT_LABELS: Record<string, string> = {
  ProjectCreated: 'Proyecto creado',
  ProjectUpdated: 'Proyecto actualizado',
  ProjectCompleted: 'Proyecto completado',
  BudgetThresholdExceeded: 'Presupuesto por encima del límite',
  ResourceAssigned: 'Recurso asignado',
  PriorityRecalculated: 'Prioridad recalculada',
};

/** Maps internal notification event types to friendly Spanish descriptions. */
export function formatAlertEventLabel(eventType: string): string {
  return ALERT_EVENT_LABELS[eventType] || eventType;
}

const FLOW_TYPE_LABELS: Record<string, string> = {
  'weekly-summary': 'Resumen semanal',
  reminder: 'Recordatorios',
  'risk-alert': 'Alertas de riesgo',
};

/** Maps automation flow type codes to Spanish labels. */
export function formatFlowType(type?: unknown): string {
  if (typeof type !== 'string' || !type.trim()) return 'Automatización';
  const key = type.trim().toLowerCase();
  return FLOW_TYPE_LABELS[key] || type.trim();
}

const FLOW_FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Semanal',
  daily: 'Diaria',
  manual: 'Manual',
};

/** Maps automation schedule frequency codes to Spanish labels. */
export function formatFlowFrequency(freq?: unknown): string {
  if (typeof freq !== 'string' || !freq.trim()) return 'Manual';
  const key = freq.trim().toLowerCase();
  return FLOW_FREQUENCY_LABELS[key] || freq.trim();
}

/** Formats byte lengths into readable B, KB or MB strings in Spanish locale. */
export function formatFileSize(bytes?: unknown): string {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num < 0) return '—';
  if (num < 1024) return `${Math.round(num)} B`;
  const kb = num / 1024;
  if (kb < 1024) {
    return `${kb.toLocaleString('es-PE', { maximumFractionDigits: 1 })} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toLocaleString('es-PE', { maximumFractionDigits: 2 })} MB`;
}

const MIME_BADGE_MAP: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'text/plain': 'TXT',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
};

/** Returns a short file-type badge such as PDF, PNG or DOCX instead of a raw MIME string. */
export function formatFileTypeBadge(contentType?: unknown, fileName?: unknown): string {
  if (typeof contentType === 'string') {
    const cleanMime = contentType.trim().toLowerCase();
    if (MIME_BADGE_MAP[cleanMime]) return MIME_BADGE_MAP[cleanMime];
  }
  if (typeof fileName === 'string' && fileName.includes('.')) {
    const ext = fileName.split('.').pop()?.trim().toUpperCase();
    if (ext && ext.length <= 6) return ext;
  }
  return 'Archivo';
}

const DECISION_CRITERIA_LABELS: Record<string, string> = {
  impact: 'Impacto',
  urgency: 'Urgencia',
  alignment: 'Alineación',
  risk: 'Riesgo',
};

/** Maps priority criteria keys to Spanish labels. */
export function formatDecisionCriteriaLabel(key: string): string {
  return DECISION_CRITERIA_LABELS[key] || key;
}

/** Maps Decision Lab visibility keys to Spanish labels. */
export function formatDecisionVisibility(value?: unknown): string {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (key === 'private') return 'Solo yo';
  if (key === 'tenant' || key === 'organization') return 'Toda la organización';
  return typeof value === 'string' && value.trim() ? value.trim() : 'Solo yo';
}

/** Maps scenario codes (BASE, A, B) to Spanish labels. */
export function formatScenarioLabel(key: string): string {
  const normalized = key.trim().toUpperCase();
  if (normalized === 'BASE') return 'Base';
  if (normalized === 'A') return 'Escenario A';
  if (normalized === 'B') return 'Escenario B';
  return key;
}

const DECISION_METRIC_LABELS: Record<string, string> = {
  budgetAvailable: 'Saldo presupuestal disponible',
  plannedCost: 'Costo planificado',
  projectsFundable: 'Proyectos financiables',
  prioritizedProjects: 'Proyectos priorizados',
  resourcesOverCapacity: 'Recursos sobrecargados',
  totalPlannedCost: 'Costo planificado total',
  totalBudgetAllocated: 'Presupuesto asignado total',
  totalBudgetSpent: 'Gasto ejecutado total',
  budgetLimit: 'Límite presupuestal',
  budgetRemaining: 'Saldo disponible',
  budgetDelta: 'Variación presupuestal',
  budgetVariance: 'Variación presupuestal',
  averagePriorityScore: 'Puntaje promedio de prioridad',
  avgPriorityScore: 'Puntaje promedio de prioridad',
  topProject: 'Proyecto prioritario',
  overAllocatedResources: 'Recursos sobrecargados',
  overallocatedResources: 'Recursos sobrecargados',
  overBudgetProjects: 'Proyectos sobre presupuesto',
  delayedProjects: 'Proyectos con retraso',
  projectCount: 'Cantidad de proyectos',
  resourceUtilization: 'Uso de capacidad',
  averageAllocation: 'Asignación promedio',
  affectedProjects: 'Proyectos impactados',
};

/** Maps Decision Lab metric and comparison keys into natural Spanish with a clean fallback. */
export function formatDecisionMetricLabel(key: string): string {
  if (DECISION_METRIC_LABELS[key]) return DECISION_METRIC_LABELS[key];
  const spaced = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

const RECURRENCE_LABELS: Record<string, string> = {
  ONCE: 'Una vez',
  DAILY: 'Diario',
  WEEKLY: 'Semanal',
};

/** Maps reminder recurrence enums to Spanish labels. */
export function formatRecurrenceLabel(value?: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Una vez';
  const key = value.trim().toUpperCase();
  return RECURRENCE_LABELS[key] || value.trim();
}

const CONSTRAINT_CODE_LABELS: Record<string, string> = {
  BUDGET_LIMIT_EXCEEDED: 'El costo planificado supera el límite presupuestal definido.',
  BUDGET_EXCEEDED: 'El costo planificado supera el límite presupuestal disponible.',
  RESOURCE_OVER_CAPACITY: 'Uno o más recursos superan su capacidad máxima registrada.',
  RESOURCE_OVERALLOCATED: 'Al menos un recurso excede su capacidad máxima asignada.',
  OVER_CAPACITY: 'La asignación propuesta supera la capacidad disponible del equipo.',
  DATE_RANGE_INVALID: 'La fecha de cierre simulada es anterior a la fecha de inicio.',
  DEADLINE_CONFLICT: 'Las fechas planificadas presentan un conflicto de cierre.',
  MISSING_DATA: 'Faltan registros completos para calcular todas las variables de este escenario.',
};

/** Maps Decision Lab constraint codes to readable Spanish guidance. */
export function formatConstraintLabel(code?: unknown, message?: unknown): string {
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (typeof code === 'string' && code.trim()) {
    const key = code.trim().toUpperCase();
    if (CONSTRAINT_CODE_LABELS[key]) return CONSTRAINT_CODE_LABELS[key];
    return titleCaseWords(key);
  }
  return 'Restricción detectada en el escenario.';
}

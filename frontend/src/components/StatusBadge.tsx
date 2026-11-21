import React from 'react';
import { formatUserDisplayName, isOpaqueId } from '../utils/display';

type BadgeVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'indigo' | 'slate';

const STATUS_MAP: Record<string, { label: string; variant: BadgeVariant }> = {
  ACTIVE: { label: 'Activo', variant: 'emerald' },
  ACTIVO: { label: 'Activo', variant: 'emerald' },
  IN_PROGRESS: { label: 'En progreso', variant: 'sky' },
  'IN-PROGRESS': { label: 'En progreso', variant: 'sky' },
  PLANNED: { label: 'Planificado', variant: 'indigo' },
  PLANNING: { label: 'Planificación', variant: 'indigo' },
  PLANIFICACION: { label: 'Planificación', variant: 'indigo' },
  'PLANIFICACIÓN': { label: 'Planificación', variant: 'indigo' },
  TODO: { label: 'Por hacer', variant: 'slate' },
  COMPLETED: { label: 'Completado', variant: 'emerald' },
  COMPLETE: { label: 'Completado', variant: 'emerald' },
  DONE: { label: 'Completado', variant: 'emerald' },
  SUCCEEDED: { label: 'Completado', variant: 'emerald' },
  SUCCESS: { label: 'Completado', variant: 'emerald' },
  BLOCKED: { label: 'Bloqueado', variant: 'rose' },
  FAILED: { label: 'Con error', variant: 'rose' },
  ON_HOLD: { label: 'En pausa', variant: 'amber' },
  PAUSED: { label: 'Pausado', variant: 'amber' },
  PENDING: { label: 'Pendiente', variant: 'amber' },
  PENDING_REVIEW: { label: 'En revisión', variant: 'amber' },
  DRAFT: { label: 'Borrador', variant: 'slate' },
  INACTIVE: { label: 'Inactivo', variant: 'slate' },
  SCHEDULED: { label: 'Programado', variant: 'sky' },
  CANCELLED: { label: 'Cancelado', variant: 'rose' },
  REVOKED: { label: 'Revocado', variant: 'rose' },
  AVAILABLE: { label: 'Disponible', variant: 'emerald' },
  ASSIGNED: { label: 'Asignado', variant: 'sky' },
  OVERALLOCATED: { label: 'Sobreasignado', variant: 'rose' },
  ADMIN: { label: 'Administrador', variant: 'indigo' },
  MANAGER: { label: 'Gestor', variant: 'sky' },
  PM: { label: 'Gestor de proyecto', variant: 'sky' },
  MEMBER: { label: 'Miembro', variant: 'emerald' },
  VIEWER: { label: 'Solo lectura', variant: 'slate' },
};

export function StatusBadge({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === '') {
    return <span className="status status-badge badge-slate">—</span>;
  }
  const raw = String(value).trim();
  const key = raw.toUpperCase();
  const mapped = STATUS_MAP[key] || {
    label: raw,
    variant: key.includes('BLOCK') || key.includes('FAIL') || key.includes('ERR')
      ? 'rose'
      : key.includes('ACT') || key.includes('COMP') || key.includes('DONE')
      ? 'emerald'
      : key.includes('PROG') || key.includes('SCHED')
      ? 'sky'
      : key.includes('PEND') || key.includes('HOLD') || key.includes('WARN')
      ? 'amber'
      : 'indigo',
  };

  return (
    <span className={`status status-${raw.toLowerCase().replace(/[^a-z0-9]+/g, '-')} status-badge badge-${mapped.variant}`}>
      <span className="status-dot" aria-hidden="true" />
      {mapped.label}
    </span>
  );
}

const AVATAR_COLORS = [
  'avatar-indigo',
  'avatar-sky',
  'avatar-emerald',
  'avatar-amber',
  'avatar-rose',
  'avatar-violet',
];

export function UserAvatar({ name, size = 26 }: { name: unknown; size?: number }) {
  const raw = typeof name === 'string' && name.trim() ? name.trim() : '';
  if (!raw) return <span className="muted-cell">—</span>;
  if (isOpaqueId(raw)) return <span className="muted-cell">Sin asignar</span>;
  const text = raw.includes('@') ? formatUserDisplayName({ email: raw }) : raw;
  const clean = text.replace(/^(user-|usr-|res-|own-)/i, '');
  const initials = clean
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || 'U';
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  const colorClass = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];

  return (
    <span className="user-chip" title={text}>
      <span
        className={`user-chip-avatar ${colorClass}`}
        style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) }}
        aria-hidden="true"
      >
        {initials}
      </span>
      <span className="user-chip-name">{text}</span>
    </span>
  );
}

export function formatCurrency(value: unknown, currency: unknown = 'USD'): string {
  const num = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isFinite(num)) {
    return value === undefined || value === null || value === '' ? '—' : String(value);
  }
  const curr = typeof currency === 'string' && /^[A-Z]{3}$/i.test(currency.trim()) ? currency.trim().toUpperCase() : 'USD';
  try {
    return new Intl.NumberFormat('es-PE', {
      style: 'currency',
      currency: curr,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${num.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${curr}`;
  }
}

export function formatDate(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
    }
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime()) && str.length >= 10) {
    return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
  }
  return str;
}

export function isDateOverdue(value: unknown, status?: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const st = String(status || '').toLowerCase();
  if (['completed', 'complete', 'done', 'cancelled'].includes(st)) return false;
  const iso = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return iso < new Date().toLocaleDateString('sv-SE');
}

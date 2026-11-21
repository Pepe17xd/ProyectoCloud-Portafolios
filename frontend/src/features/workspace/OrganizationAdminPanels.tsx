import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Check, Copy, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import CustomSelect from '../../components/CustomSelect';
import Modal from '../../components/Modal';
import { formatDate, StatusBadge, UserAvatar } from '../../components/StatusBadge';
import { isOpaqueId } from '../../utils/display';

type Item = Record<string, unknown> & { id?: string; sk?: string };
type RequestFn = <T = any>(module: string, path: string, method?: string, body?: unknown) => Promise<T>;

const PLAN_LABELS: Record<string, string> = {
  starter: 'Plan inicial',
  standard: 'Plan estándar',
  enterprise: 'Plan empresarial',
};

const PLAN_OPTIONS = [
  { value: 'starter', label: 'Plan inicial' },
  { value: 'standard', label: 'Plan estándar' },
  { value: 'enterprise', label: 'Plan empresarial' },
];

const TENANT_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Activa' },
  { value: 'INACTIVE', label: 'Inactiva' },
];

const ROLE_OPTIONS = [
  { value: 'MANAGER', label: 'Gestor', description: 'Crea y edita proyectos, tareas y presupuestos' },
  { value: 'VIEWER', label: 'Solo lectura', description: 'Consulta el espacio sin realizar cambios' },
  { value: 'ADMIN', label: 'Administrador', description: 'Control completo de integrantes y organización' },
];

const MEMBERSHIP_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'INACTIVE', label: 'Inactivo' },
];

function entityId(item: Item): string {
  if (typeof item.id === 'string' && item.id) return item.id;
  if (typeof item.sk === 'string') return item.sk.replace(/^(ITEM#|MEMBERSHIP#|TENANTMETA#)/, '');
  return '';
}

function CopyIdBadge({ id, full = false }: { id: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <span className="muted-cell">—</span>;
  const short = full ? id : id.slice(0, 12);
  return (
    <button
      type="button"
      className="copy-id-btn"
      title={`Copiar código: ${id}`}
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

export function OrganizationProfileBanner({
  tenantId,
  organizationName,
  isAdmin,
  request,
  refreshToken,
  onOrganizationUpdated,
}: {
  tenantId: string;
  organizationName?: string;
  isAdmin: boolean;
  request: RequestFn;
  refreshToken: number;
  onOrganizationUpdated: (name: string) => void;
}) {
  const [tenantRecord, setTenantRecord] = useState<Item | null>(null);
  const [editingOpen, setEditingOpen] = useState(false);
  const [form, setForm] = useState({ name: '', plan: 'standard', status: 'ACTIVE' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const onOrgUpdatedRef = useRef(onOrganizationUpdated);
  onOrgUpdatedRef.current = onOrganizationUpdated;

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const data = await request<{ items: Item[] }>('identity', 'tenants');
      const found =
        (data.items || []).find(item => entityId(item) === tenantId) || (data.items || [])[0] || null;
      setTenantRecord(found);
      if (found?.name && String(found.name).trim()) {
        onOrgUpdatedRef.current(String(found.name).trim());
      }
    } catch {
      // Fall back cleanly to profile-provided organization name
    }
  }, [tenantId, request]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  function openEditor() {
    setError('');
    setForm({
      name: String(tenantRecord?.name || organizationName || '').trim(),
      plan: String(tenantRecord?.plan || 'standard').toLowerCase(),
      status: String(tenantRecord?.status || 'ACTIVE'),
    });
    setEditingOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        plan: form.plan,
        status: form.status,
      };
      let saved: Item;
      if (tenantRecord) {
        const targetId = entityId(tenantRecord) || tenantId;
        saved = await request<Item>('identity', `tenants/${encodeURIComponent(targetId)}`, 'PATCH', payload);
      } else {
        saved = await request<Item>('identity', 'tenants', 'POST', payload);
      }
      setTenantRecord(saved);
      onOrganizationUpdated(String(saved.name || payload.name));
      setEditingOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const resolvedName = String(tenantRecord?.name || organizationName || 'Tu organización');
  const resolvedPlan = String(tenantRecord?.plan || 'standard').toLowerCase();
  const resolvedStatus = String(tenantRecord?.status || 'ACTIVE');

  return (
    <>
      <div className="org-identity-banner" aria-label="Información e invitación de la organización">
        <div>
          <strong>
            <Building2 size={15} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />
            {resolvedName} · Invita a tu equipo
          </strong>
          <p>
            Puedes crear cuentas directamente con <b>Nuevo miembro</b>, o compartir este código de invitación para que tus compañeros se unan al registrarse.
          </p>
          <div className="org-admin-badges">
            <StatusBadge value={resolvedStatus} />
            <span className="org-plan-chip">{PLAN_LABELS[resolvedPlan] || resolvedPlan}</span>
          </div>
        </div>
        <div className="org-identity-meta">
          <span className="invite-code-label">Código de invitación</span>
          {tenantId && <CopyIdBadge id={tenantId} full />}
          {isAdmin && (
            <button type="button" className="secondary" onClick={openEditor}>
              <Pencil size={14} />Editar organización
            </button>
          )}
        </div>
      </div>

      <Modal
        open={editingOpen}
        title="Editar datos de la organización"
        subtitle="Actualiza el nombre visible y estado del espacio para todo tu equipo."
        onClose={() => setEditingOpen(false)}
      >
        <form className="modal-form" onSubmit={save}>
          {error && <p className="error banner" role="alert">{error}</p>}
          <div className="modal-fields-grid">
            <label>
              Nombre de la organización *
              <input
                required
                maxLength={120}
                value={form.name}
                onChange={e => setForm(old => ({ ...old, name: e.target.value }))}
                placeholder="Ej. Estudio Norte"
              />
            </label>
            <label>
              Plan
              <CustomSelect
                value={form.plan}
                onChange={val => setForm(old => ({ ...old, plan: val }))}
                options={PLAN_OPTIONS}
                ariaLabel="Plan de la organización"
              />
            </label>
            <label>
              Estado
              <CustomSelect
                value={form.status}
                onChange={val => setForm(old => ({ ...old, status: val }))}
                options={TENANT_STATUS_OPTIONS}
                ariaLabel="Estado de la organización"
              />
            </label>
          </div>
          <div className="modal-form-actions">
            <button type="button" className="secondary" onClick={() => setEditingOpen(false)}>Cancelar</button>
            <button type="submit" className="primary" disabled={busy || !form.name.trim()}>
              {busy ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function MembershipsPanel({
  isAdmin,
  users,
  entityNames,
  request,
  refreshToken,
  onChanged,
}: {
  isAdmin: boolean;
  users: Item[];
  entityNames: Record<string, string>;
  request: RequestFn;
  refreshToken: number;
  onChanged?: () => void;
}) {
  const [memberships, setMemberships] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ userId: '', role: 'MANAGER', status: 'ACTIVE' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await request<{ items: Item[] }>('identity', 'memberships');
      setMemberships(data.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const userOptions = users.map(u => {
    const uid = entityId(u);
    const label = String(u.name || u.email || 'Integrante');
    const email = typeof u.email === 'string' && u.email ? u.email : undefined;
    return {
      value: uid,
      label,
      description: email && email !== label ? email : undefined,
    };
  });

  function resolveMemberLabel(row: Item): string {
    const uid = String(row.userId || '');
    const fromMap = entityNames[uid];
    if (fromMap) return fromMap;
    const matched = users.find(u => entityId(u) === uid);
    if (matched) return String(matched.name || matched.email || 'Integrante');
    return isOpaqueId(uid) ? 'Integrante de la organización' : uid || 'Integrante';
  }

  function startCreate() {
    setError('');
    setNotice('');
    setEditing(null);
    setForm({
      userId: users[0] ? entityId(users[0]) : '',
      role: 'MANAGER',
      status: 'ACTIVE',
    });
    setModalOpen(true);
  }

  async function startEdit(row: Item) {
    const mid = entityId(row);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const fresh = await request<Item>('identity', `memberships/${encodeURIComponent(mid)}`).catch(() => row);
      setEditing(fresh);
      setForm({
        userId: String(fresh.userId || ''),
        role: String(fresh.role || 'MANAGER'),
        status: String(fresh.status || 'ACTIVE'),
      });
      setModalOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing && !form.userId) return;
    setBusy(true);
    setError('');
    try {
      if (editing) {
        const mid = entityId(editing);
        await request('identity', `memberships/${encodeURIComponent(mid)}`, 'PATCH', {
          role: form.role,
          status: form.status,
        });
        setNotice('Membresía actualizada.');
      } else {
        await request('identity', 'memberships', 'POST', {
          userId: form.userId,
          role: form.role,
          status: form.status,
        });
        setNotice('Membresía registrada.');
      }
      setModalOpen(false);
      setEditing(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function executeRevoke(row: Item) {
    const mid = entityId(row);
    setBusy(true);
    setError('');
    try {
      await request('identity', `memberships/${encodeURIComponent(mid)}`, 'DELETE');
      setConfirmRevoke(null);
      setNotice('Membresía revocada.');
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel memberships-panel" aria-label="Membresías y accesos de la organización">
      <div className="panelHeading">
        <div>
          <h2><ShieldCheck size={18} /> Membresías y niveles de acceso</h2>
          <span>Administra los permisos asignados a cada integrante dentro de esta organización.</span>
        </div>
        {isAdmin && (
          <button type="button" className="secondary" disabled={!users.length} onClick={startCreate}>
            <Plus size={15} />Nueva membresía
          </button>
        )}
      </div>

      {error && <p className="error banner" role="alert">{error}</p>}
      {notice && <p className="notice banner" role="status">{notice}</p>}

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Integrante</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Registro</th>
              {isAdmin && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {memberships.map((row, idx) => (
              <tr key={entityId(row) || idx}>
                <td><UserAvatar name={resolveMemberLabel(row)} /></td>
                <td><StatusBadge value={row.role || 'MEMBER'} /></td>
                <td><StatusBadge value={row.status || 'ACTIVE'} /></td>
                <td>{row.createdAt ? formatDate(row.createdAt) : '—'}</td>
                {isAdmin && (
                  <td>
                    <div className="rowActions">
                      <button type="button" disabled={busy} onClick={() => void startEdit(row)}>Editar</button>
                      <button type="button" className="deleteAction" disabled={busy} onClick={() => setConfirmRevoke(row)}>
                        <Trash2 size={13} />Revocar
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!memberships.length && (
          <div className="empty">{loading ? 'Cargando membresías…' : 'No hay membresías registradas.'}</div>
        )}
      </div>

      <Modal
        open={modalOpen}
        title={editing ? 'Editar membresía' : 'Asignar membresía'}
        subtitle="Define el nivel de acceso del integrante dentro de la organización."
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
      >
        <form className="modal-form" onSubmit={save}>
          <div className="modal-fields-grid">
            {!editing && (
              <label>
                Integrante *
                <CustomSelect
                  required
                  value={form.userId}
                  onChange={val => setForm(old => ({ ...old, userId: val }))}
                  options={userOptions}
                  placeholder="Selecciona un integrante"
                  ariaLabel="Integrante de la membresía"
                />
              </label>
            )}
            <label>
              Rol *
              <CustomSelect
                required
                value={form.role}
                onChange={val => setForm(old => ({ ...old, role: val }))}
                options={ROLE_OPTIONS}
                ariaLabel="Rol de acceso"
              />
            </label>
            <label>
              Estado *
              <CustomSelect
                required
                value={form.status}
                onChange={val => setForm(old => ({ ...old, status: val }))}
                options={MEMBERSHIP_STATUS_OPTIONS}
                ariaLabel="Estado de la membresía"
              />
            </label>
          </div>
          <div className="modal-form-actions">
            <button type="button" className="secondary" onClick={() => { setModalOpen(false); setEditing(null); }}>
              Cancelar
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear membresía'}
            </button>
          </div>
        </form>
      </Modal>

      {confirmRevoke && (
        <Modal
          open={Boolean(confirmRevoke)}
          title="Revocar membresía"
          subtitle="El integrante perderá este rol asignado en la organización."
          onClose={() => setConfirmRevoke(null)}
        >
          <div className="confirm-delete-box">
            <p className="confirm-delete-message">
              ¿Deseas revocar la membresía de <strong>{resolveMemberLabel(confirmRevoke)}</strong>?
            </p>
            <div className="modal-form-actions">
              <button type="button" className="secondary" onClick={() => setConfirmRevoke(null)}>Cancelar</button>
              <button type="button" className="danger" disabled={busy} onClick={() => void executeRevoke(confirmRevoke)}>
                {busy ? 'Revocando…' : 'Revocar membresía'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

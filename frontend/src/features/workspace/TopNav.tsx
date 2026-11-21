import { useEffect, useRef, useState } from 'react';
import { Bell, Building2, Check, ChevronDown, Copy, FolderKanban, House, LogOut, Menu, Moon, Sun, Users, Wallet, Wrench, X } from 'lucide-react';
import './top-nav.css';
import { BrandIcon } from '../../components/Brand';
import { formatFirstName, formatUserDisplayName } from '../../utils/display';

export interface UserProfileInfo {
  username?: string;
  name?: string;
  email?: string;
  role?: string;
  tenantId?: string;
  organizationName?: string;
}

export function WorkspaceMark() {
  return <BrandIcon/>;
}

const groups = [
  { label: 'Proyectos', icon: FolderKanban, items: [['portfolio','Portafolios'],['project','Proyectos'],['tasks','Kanban'],['priority','Prioridades'],['documents','Documentos']] },
  { label: 'Equipo', icon: Users, items: [['identity','Usuarios'],['resource','Recursos'],['assignments','Asignaciones']] },
  { label: 'Finanzas', icon: Wallet, items: [['budget','Presupuestos'],['expenses','Gastos'],['rankings','Ranking']] },
  { label: 'Herramientas', icon: Wrench, items: [['decisionlab','Decisiones'],['automations','Automatizaciones'],['reports','Reportes'],['assistant','Consulta']] },
];

function getInitials(name?: string, email?: string, user?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email && email.trim()) {
    const local = email.split('@')[0];
    const clean = local.replace(/[^a-zA-Z]/g, '');
    return (clean.slice(0, 2) || email.slice(0, 2)).toUpperCase();
  }
  if (user && user.trim() && !/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(user)) {
    return user.slice(0, 2).toUpperCase();
  }
  return 'U';
}

export default function TopNav({
  tab,
  user,
  userProfile,
  onNavigate,
  onSignOut,
}: {
  tab: string;
  user: string;
  userProfile?: UserProfileInfo;
  onNavigate: (tab: string) => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [tenantCopied, setTenantCopied] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('cloudportfolio.theme');
      return saved === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('cloudportfolio.theme', theme);
    } catch {
      // Ignore storage errors in restricted environments
    }
  }, [theme]);

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(null); setMobile(false); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);

  const go = (key: string) => { setOpen(null); setMobile(false); onNavigate(key); };
  const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));

  const displayName = formatUserDisplayName({
    name: userProfile?.name,
    email: userProfile?.email,
    username: userProfile?.username || user,
  });
  const firstName = formatFirstName(displayName);
  const displayEmail = userProfile?.email || (user.includes('@') ? user : '');
  const organizationName = userProfile?.organizationName?.trim() || 'Tu organización';
  const displayTenantId = userProfile?.tenantId || '';
  const initials = getInitials(displayName, userProfile?.email, user);

  return <header className="topbar" ref={root}>
    <button className="topbar-brand" onClick={() => go('dashboard')} aria-label="ProFiles, ir al inicio"><WorkspaceMark/><span translate="no">ProFiles</span></button>
    <button className="topbar-mobile-toggle" onClick={() => setMobile(!mobile)} aria-expanded={mobile} aria-controls="topbar-navigation" aria-label={mobile ? 'Cerrar menú' : 'Abrir menú'}>{mobile ? <X size={20}/> : <Menu size={20}/>}</button>
    <nav id="topbar-navigation" className={`topbar-navigation ${mobile ? 'is-open' : ''}`} aria-label="Navegación principal">
      <button className={`topbar-link ${tab === 'dashboard' ? 'active' : ''}`} aria-current={tab === 'dashboard' ? 'page' : undefined} onClick={() => go('dashboard')}><House size={16}/>Inicio</button>
      {groups.map(group => <div className="topbar-group" key={group.label}>
        <button className={`topbar-link ${group.items.some(([key]) => key === tab) ? 'active' : ''}`} aria-expanded={open === group.label} aria-controls={`menu-${group.label}`} onClick={() => setOpen(open === group.label ? null : group.label)}><group.icon size={16}/>{group.label}<ChevronDown size={14}/></button>
        <div className="topbar-dropdown" id={`menu-${group.label}`} hidden={open !== group.label}>{group.items.map(([key,label]) => <button key={key} className={tab === key ? 'current' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => go(key)}>{label}</button>)}</div>
      </div>)}
      <button className={`topbar-link ${tab === 'notifications' ? 'active' : ''}`} aria-current={tab === 'notifications' ? 'page' : undefined} onClick={() => go('notifications')}><Bell size={17}/><span>Notificaciones</span></button>
      <div className="topbar-right-actions">
        <button
          type="button"
          className="topbar-link topbar-theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          {theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}
          <span className="theme-toggle-label">{theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
        </button>
        <div className="topbar-group topbar-profile">
          <button className="topbar-link topbar-profile-trigger" aria-expanded={open === 'perfil'} aria-controls="menu-perfil" onClick={() => setOpen(open === 'perfil' ? null : 'perfil')}>
            <span className="topbar-avatar" aria-hidden="true">{initials}</span>
            <span className="topbar-profile-trigger-label">{firstName}</span>
            <ChevronDown size={14} aria-hidden="true"/>
          </button>
          <div id="menu-perfil" className="topbar-dropdown topbar-profile-dropdown" hidden={open !== 'perfil'}>
            <div className="topbar-profile-header">
              <div className="topbar-profile-avatar-large" aria-hidden="true">{initials}</div>
              <div className="topbar-profile-info">
                <strong className="topbar-profile-fullname">{displayName}</strong>
                {displayEmail && <span className="topbar-profile-email">{displayEmail}</span>}
                <div className="topbar-profile-org">
                  <Building2 size={12} aria-hidden="true" />
                  <span>{organizationName}</span>
                </div>
              </div>
            </div>

            {displayTenantId && (
              <div className="topbar-profile-tenant-card">
                <div className="topbar-profile-tenant-header">
                  <Building2 size={13} aria-hidden="true" />
                  <span>Código de invitación</span>
                </div>
                <div className="topbar-profile-tenant-body">
                  <code>{displayTenantId.length > 22 ? `${displayTenantId.slice(0, 20)}…` : displayTenantId}</code>
                  <button
                    type="button"
                    className="topbar-copy-btn"
                    title="Copiar código de invitación"
                    onClick={() => {
                      if (navigator?.clipboard?.writeText) {
                        navigator.clipboard.writeText(displayTenantId);
                      }
                      setTenantCopied(true);
                      setTimeout(() => setTenantCopied(false), 2000);
                    }}
                  >
                    {tenantCopied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                    <span>{tenantCopied ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
              </div>
            )}

            <div className="topbar-profile-menu-actions">
              <button type="button" onClick={() => go('identity')}>
                <Users size={15} aria-hidden="true" /> Equipo y permisos
              </button>
              <button type="button" className="topbar-logout-action" onClick={onSignOut}>
                <LogOut size={15} aria-hidden="true" /> Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  </header>;
}

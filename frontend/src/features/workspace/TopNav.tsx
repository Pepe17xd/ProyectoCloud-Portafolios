import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, FolderKanban, House, LogOut, Menu, Users, Wallet, Wrench, X } from 'lucide-react';
import './top-nav.css';
import { BrandIcon } from '../../components/Brand';

export function WorkspaceMark() {
  return <BrandIcon/>;
}

const groups = [
  { label: 'Proyectos', icon: FolderKanban, items: [['portfolio','Portafolios'],['project','Proyectos'],['tasks','Kanban'],['priority','Prioridades']] },
  { label: 'Equipo', icon: Users, items: [['identity','Usuarios'],['resource','Recursos'],['assignments','Asignaciones']] },
  { label: 'Finanzas', icon: Wallet, items: [['budget','Presupuestos'],['expenses','Gastos'],['rankings','Ranking']] },
  { label: 'Herramientas', icon: Wrench, items: [['decisionlab','Decisiones'],['automations','Automatizaciones'],['reports','Reportes'],['assistant','Consulta']] },
];

export default function TopNav({ tab, user, onNavigate, onSignOut }: { tab: string; user: string; onNavigate: (tab: string) => void; onSignOut: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(null); setMobile(false); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  const go = (key: string) => { setOpen(null); setMobile(false); onNavigate(key); };
  return <header className="topbar" ref={root}>
    <button className="topbar-brand" onClick={() => go('dashboard')} aria-label="ProFiles, ir al inicio"><WorkspaceMark/><span>ProFiles</span></button>
    <button className="topbar-mobile-toggle" onClick={() => setMobile(!mobile)} aria-expanded={mobile} aria-controls="topbar-navigation" aria-label={mobile ? 'Cerrar menú' : 'Abrir menú'}>{mobile ? <X size={20}/> : <Menu size={20}/>}</button>
    <nav id="topbar-navigation" className={`topbar-navigation ${mobile ? 'is-open' : ''}`} aria-label="Navegación principal">
      <button className={`topbar-link ${tab === 'dashboard' ? 'active' : ''}`} aria-current={tab === 'dashboard' ? 'page' : undefined} onClick={() => go('dashboard')}><House size={16}/>Inicio</button>
      {groups.map(group => <div className="topbar-group" key={group.label}>
        <button className={`topbar-link ${group.items.some(([key]) => key === tab) ? 'active' : ''}`} aria-expanded={open === group.label} aria-controls={`menu-${group.label}`} onClick={() => setOpen(open === group.label ? null : group.label)}><group.icon size={16}/>{group.label}<ChevronDown size={14}/></button>
        <div className="topbar-dropdown" id={`menu-${group.label}`} hidden={open !== group.label}>{group.items.map(([key,label]) => <button key={key} className={tab === key ? 'current' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => go(key)}>{label}</button>)}</div>
      </div>)}
      <button className={`topbar-link ${tab === 'notifications' ? 'active' : ''}`} aria-current={tab === 'notifications' ? 'page' : undefined} onClick={() => go('notifications')}><Bell size={17}/><span>Notificaciones</span></button>
      <div className="topbar-group topbar-profile"><button className="topbar-link" aria-expanded={open === 'perfil'} aria-controls="menu-perfil" onClick={() => setOpen(open === 'perfil' ? null : 'perfil')}><span className="topbar-avatar">{(user || 'U').slice(0,1).toUpperCase()}</span><span>Perfil</span><ChevronDown size={14}/></button><div id="menu-perfil" className="topbar-dropdown" hidden={open !== 'perfil'}><span className="topbar-user">{user || 'Sesión autenticada'}</span><button onClick={onSignOut}><LogOut size={15}/> Cerrar sesión</button></div></div>
    </nav>
  </header>;
}

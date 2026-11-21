import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Activity, ArrowRight, BarChart3, Bell, Building2, Check, CircleDot, ClipboardList, FolderKanban, Gauge, HeartHandshake, Layers, LockKeyhole, ShieldCheck, SlidersHorizontal, Sparkles, Target, Users, Wallet, Kanban } from 'lucide-react';
import { Brand, BrandIcon } from '../../components/Brand';
import { useLandingMotion } from './useLandingMotion';
import './Landing.css';
import './landing-identity.css';

const presets = [
  { id: 'balanced', label: 'Equilibrado', reallocation: 20, budget: 48000 },
  { id: 'accelerate', label: 'Acelerar Q4', reallocation: 35, budget: 54000 },
  { id: 'lean', label: 'Ajustar presupuesto', reallocation: 10, budget: 42000 },
] as const;

const steps = [
  ['01', 'Centraliza tu portafolio', 'Reúne portafolios, proyectos, responsables, tareas y presupuestos en un único espacio.'],
  ['02', 'Detecta qué requiere atención', 'Identifica fechas próximas, sobrecargas de equipo y presupuestos por encima del límite.'],
  ['03', 'Coordina seguimiento y equipo', 'Organiza el avance diario en Kanban, programa recordatorios y descarga reportes claros.'],
  ['04', 'Evalúa escenarios antes de decidir', 'Compara alternativas de presupuesto, plazos y capacidad sin modificar los datos en curso.'],
];

const capabilities = [
  { icon: Sparkles, title: 'Decision Lab', text: 'Explora cambios de capacidad, presupuesto y prioridades antes de aprobarlos.', kind: 'decision', featured: true },
  { icon: FolderKanban, title: 'Portafolios y proyectos', text: 'Organiza iniciativas, metas, fechas y responsables con contexto compartido.', kind: 'portfolio', featured: true },
  { icon: Kanban, title: 'Tablero Kanban', text: 'Da seguimiento a tareas, responsables y plazos en cada etapa.', kind: 'kanban' },
  { icon: Wallet, title: 'Presupuestos y gastos', text: 'Controla techos financieros, gastos ejecutados y saldos por proyecto.', kind: 'budget' },
  { icon: Users, title: 'Personas y capacidad', text: 'Visualiza asignaciones para anticipar cuellos de botella del equipo.', kind: 'capacity' },
  { icon: BarChart3, title: 'Automatizaciones y reportes', text: 'Programa resúmenes, recibe alertas y exporta informes consolidados.', kind: 'automation' },
];

function FloatingDashboard() {
  return <div className="hero-visual-wrap" role="img" aria-label="Vista ilustrativa del espacio de trabajo ProFiles">
    <div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/>
    <div className="dashboard-scroll-depth"><div className="floating-dashboard">
      <div className="dashboard-top"><div className="window-dots"><i/><i/><i/></div><span>ProFiles <b>/</b> Resumen ejecutivo</span><span className="dashboard-live"><i/> DEMO</span></div>
      <div className="dashboard-layout"><aside className="dashboard-rail"><BrandIcon/><span className="rail-active"><Layers/></span><span><FolderKanban/></span><span><Users/></span><span><BarChart3/></span></aside>
        <div className="dashboard-content"><div className="dashboard-title"><div><small>ESPACIO DE TRABAJO · DEMOSTRACIÓN</small><h3>Resumen ejecutivo</h3></div><span className="dashboard-period">Últimos 30 días</span></div>
          <div className="dashboard-kpis"><div><small>Proyectos activos</small><strong className="depth-kpi">24</strong><em>↑ 12% <span>vs. mes anterior</span></em></div><div><small>Presupuesto usado</small><strong className="depth-kpi">$284k</strong><div className="mini-track"><i/></div></div><div><small>En buen estado</small><strong className="depth-kpi">18 <span>/ 24</span></strong><em className="blue-em">75% del portafolio</em></div></div>
          <div className="dashboard-lower"><div className="activity-card"><div className="widget-head"><span>Actividad del portafolio</span><small>PROYECTOS</small></div><div className="chart-legend"><i/> En curso <i className="legend-cyan"/> Completados</div><svg viewBox="0 0 540 125" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#38bdf8" stopOpacity=".28"/><stop offset="1" stopColor="#38bdf8" stopOpacity="0"/></linearGradient></defs><path d="M0 102 C40 92 53 96 89 72 S145 85 180 57 S238 75 270 46 S327 68 363 38 S420 53 452 26 S501 39 540 12 L540 125 L0 125Z" fill="url(#chartFill)"/><path d="M0 102 C40 92 53 96 89 72 S145 85 180 57 S238 75 270 46 S327 68 363 38 S420 53 452 26 S501 39 540 12" fill="none" stroke="#38bdf8" strokeWidth="2.5"/><path d="M0 113 C42 111 53 93 89 101 S145 87 180 91 S238 71 270 80 S327 59 363 69 S420 50 452 56 S501 34 540 43" fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4 4"/></svg><div className="chart-axis"><span>01 NOV</span><span>08 NOV</span><span>15 NOV</span><span>22 NOV</span><span>HOY</span></div></div>
            <div className="priority-card"><div className="widget-head"><span>Proyectos prioritarios</span><CircleDot/></div><div className="priority-item"><i className="priority-high"/><span>Portal de clientes<small>Entrega · 12 dic</small></span><b>82%</b></div><div className="priority-item"><i className="priority-mid"/><span>Plan operativo Q4<small>En progreso</small></span><b>64%</b></div><div className="priority-item"><i className="priority-low"/><span>Analítica comercial<small>En revisión</small></span><b>41%</b></div></div>
          </div>
        </div>
      </div>
    </div></div><div className="hero-float-chip chip-budget"><Wallet/> Presupuesto <b>68%</b></div><div className="hero-float-chip chip-health"><Activity/> Portafolio saludable <b>+12%</b></div>
  </div>;
}

function InteractiveDecisionDeck() {
  const [reallocation, setReallocation] = useState(20);
  const [budget, setBudget] = useState(48000);
  const cost = Math.round(41800 + reallocation * 185);
  const margin = budget - cost;
  const overload = reallocation >= 35 ? 2 : reallocation >= 30 ? 1 : 0;
  const score = Math.min(99, Math.max(55, 74 + Math.round(reallocation * .65) - (margin < 0 ? 9 : 0) - overload * 4));
  const status = margin < 0 ? ['Sobre presupuesto', 'rose'] : overload ? ['Revisar capacidad', 'amber'] : ['Escenario viable', 'emerald'];
  const projects = [
    { name: 'Portal de clientes', owner: 'Camila Ríos', detail: `Puntaje ${76 + Math.round(reallocation * .45)} pts`, progress: Math.min(98, 68 + Math.round(reallocation * .5)), status: reallocation >= 20 ? 'Prioritario' : 'En curso', tone: reallocation >= 20 ? 'sky' : 'slate' },
    { name: 'Cierre presupuestal Q4', owner: 'Mateo Paredes', detail: `Costo est. $${Math.round(cost * .34).toLocaleString('en-US')}`, progress: margin < 0 ? 88 : 64, status: margin < 0 ? 'Excede límite' : 'En margen', tone: margin < 0 ? 'rose' : 'emerald' },
    { name: 'Plataforma operativa', owner: 'Lucía Herrera', detail: `Carga ${Math.min(115, 72 + Math.round(reallocation * 1.1))}%`, progress: Math.min(96, 82 + Math.round(reallocation * .2)), status: overload ? 'Sobrecarga' : 'Equilibrado', tone: overload ? 'amber' : 'emerald' },
  ];
  return <section className="command-deck" aria-label="Decision Lab demostrativo con datos ilustrativos">
    <div className="command-deck-bar"><div className="command-deck-brand"><BrandIcon/><span>Decision Lab</span></div><span className="command-deck-pill"><i/> DEMO · DATOS DE EJEMPLO</span></div>
    <div className="command-deck-body sim-grid"><div className="sim-controls"><div className="sim-controls-head"><SlidersHorizontal/><div><h3>Ajusta un escenario</h3><p>Mueve los parámetros para observar el impacto ilustrativo.</p></div></div>
      <div className="sim-presets" role="group" aria-label="Escenarios predefinidos">{presets.map(p => <button key={p.id} type="button" aria-pressed={reallocation === p.reallocation && budget === p.budget} className={`sim-preset-btn${reallocation === p.reallocation && budget === p.budget ? ' is-active' : ''}`} onClick={() => { setReallocation(p.reallocation); setBudget(p.budget); }}>{p.label}</button>)}</div>
      <div className="sim-field"><div className="sim-field-head"><label htmlFor="sim-reallocation">Capacidad reasignada a Q4</label><strong>{reallocation}%</strong></div><input id="sim-reallocation" aria-label="Capacidad reasignada a Q4" type="range" min="0" max="40" step="5" value={reallocation} onChange={e => setReallocation(Number(e.target.value))}/><div className="sim-scale"><span>0% base</span><span>20% óptimo</span><span>40% intensivo</span></div></div>
      <div className="sim-field"><div className="sim-field-head"><label htmlFor="sim-budget">Techo presupuestal</label><strong>${budget.toLocaleString('en-US')}</strong></div><input id="sim-budget" aria-label="Techo presupuestal" type="range" min="38000" max="60000" step="1000" value={budget} onChange={e => setBudget(Number(e.target.value))}/><div className="sim-scale"><span>$38,000</span><span>$48,000</span><span>$60,000</span></div></div>
      <p className="sim-footnote">Simulación ilustrativa de solo lectura. No es una predicción de inteligencia artificial ni modifica registros reales.</p>
    </div><div className="sim-results"><div className="sim-results-head"><div><h3>Impacto del escenario</h3><p>Comparado con la línea base ilustrativa (74 pts)</p></div><span className={`deck-status tone-${status[1]}`}>{status[0]}</span></div>
      <div className="sim-kpis"><div className="sim-kpi"><span>Prioridad promedio</span><strong><AnimatedNumber value={score} format={n => `${n} pts`}/></strong><small className="delta-up">{score >= 74 ? '+' : ''}{score - 74} pts vs base</small></div><div className="sim-kpi"><span>Costo proyectado</span><strong>$<AnimatedNumber value={cost} format={n => n.toLocaleString('en-US')}/></strong><small className={margin < 0 ? 'delta-down' : 'delta-up'}>{margin < 0 ? `Excede por $${Math.abs(margin).toLocaleString('en-US')}` : `Margen $${margin.toLocaleString('en-US')}`}</small></div><div className="sim-kpi"><span>Carga del equipo</span><strong>{overload ? `${overload} sobrecarga${overload > 1 ? 's' : ''}` : 'Equilibrada'}</strong><small className={overload ? 'delta-warn' : 'delta-up'}>{overload ? 'Requiere redistribuir horas' : 'Capacidad dentro de límite'}</small></div></div>
      <div className="sim-chart" aria-label={`Indicador visual del escenario: prioridad ${score} puntos`}><div className="sim-chart-head"><span>Lectura comparativa del portafolio</span><small>BASE / ESCENARIO</small></div><div className="sim-bars"><span className="sim-bar-base"/><span className="sim-bar-current" style={{ height: `${Math.max(28, score)}%` }}/><span className="sim-bar-budget" style={{ height: `${Math.max(28, Math.min(96, budget / 650))}%` }}/></div><div className="sim-chart-legend"><span>Prioridad {score}</span><span>Presupuesto {Math.round(budget / 1000)}k</span></div></div>
      <div className="sim-impact-list">{projects.map(p => <div className="sim-impact-row" key={p.name}><div className="sim-impact-main"><strong>{p.name}</strong><small>{p.owner} · Portafolio</small></div><span className="sim-impact-metric">{p.detail}</span><span className={`deck-status tone-${p.tone}`}>{p.status}</span></div>)}</div>
    </div></div>
  </section>;
}

function FeatureVisual({ kind }: { kind: string }) {
  if (kind === 'decision') return <div className="feature-visual" aria-hidden="true"><span className="visual-bar"/><span className="visual-bar alt"/><small>ESCENARIO A <b>+18%</b></small></div>;
  if (kind === 'portfolio') return <div className="feature-visual portfolio-visual" aria-hidden="true">{['78','56','92'].map(n => <div className="portfolio-mini" key={n}><i/><span/><b>{n}%</b></div>)}</div>;
  if (kind === 'kanban') return <div className="feature-visual kanban-visual" aria-hidden="true">{[3,2,3].map((n, i) => <span className="kanban-mini" key={i}>{Array.from({ length: n }, (_, j) => <i key={j}/>)}</span>)}<span className="kanban-task">Revisión</span></div>;
  if (kind === 'budget') return <div className="feature-visual budget-visual" aria-hidden="true"><span className="budget-ring"/><span className="budget-legend"><i/> Asignado <i/> Disponible</span></div>;
  if (kind === 'capacity') return <div className="feature-visual capacity-visual" aria-hidden="true">{['68','84','52'].map(n => <span className="capacity-line" key={n}><i/><b>{n}%</b></span>)}</div>;
  return <div className="feature-visual flow-visual" aria-hidden="true"><span className="flow-node"><Bell/></span><span className="flow-connector"/><span className="flow-node"><ArrowRight/></span><span className="flow-connector"/><span className="flow-node"><Check/></span></div>;
}

function AnimatedNumber({ value, format }: { value: number; format: (value: number) => string }) {
  const [displayed, setDisplayed] = useState(value);
  const current = useRef(value);
  useLayoutEffect(() => {
    const counter = { value: current.current };
    const tween = gsap.to(counter, { value, duration: 0.42, ease: 'power2.out', overwrite: true, onUpdate: () => {
      current.current = counter.value;
      setDisplayed(Math.round(counter.value));
    }, onComplete: () => { current.current = value; setDisplayed(value); } });
    return () => { tween.kill(); };
  }, [value]);
  return <span aria-label={format(value)}>{format(displayed)}</span>;
}

function OrganizationsVisual() {
  return <div className="org-visual" aria-label="Tres organizaciones en espacios separados conectados a ProFiles" role="img"><div className="org-cards">{[['A','8 proyectos · 12 personas'],['B','5 proyectos · 8 personas'],['C','11 proyectos · 24 personas']].map(([name, info]) => <div className="org-card" key={name}><span><Building2/> Organización {name}</span><i/><i/><small>{info}</small></div>)}</div><svg className="org-connections" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M2 16 C45 16 48 50 94 50"/><path d="M2 50 C46 50 50 50 94 50"/><path d="M2 84 C45 84 48 50 94 50"/><circle className="org-signal" cx="94" cy="50" r="2.4"/></svg><div className="org-connector"/><div className="org-hub"><BrandIcon/><b>ProFiles</b><small>Cloud workspace</small></div></div>;
}

function AboutVisual() {
  return <div className="about-network" role="img" aria-label="Red de colaboración entre proyectos, personas, datos y decisiones"><div className="orbit-ring orbit-ring-a"/><div className="orbit-ring orbit-ring-b"/><div className="orbit-ring orbit-ring-c"/><div className="network-core"><BrandIcon large/><b>ProFiles</b><small>Cloud workspace</small></div>{[[FolderKanban,'Proyectos','node-project'],[Users,'Personas','node-people'],[Activity,'Datos','node-data'],[Target,'Decisiones','node-decisions']].map(([Icon, label, klass]) => { const Glyph = Icon as typeof FolderKanban; return <div className={`network-node ${klass}`} key={String(label)}><Glyph/><span>{String(label)}</span></div>; })}</div>;
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeMenu = () => setMenuOpen(false);
  const github = import.meta.env.VITE_GITHUB_URL as string | undefined;
  useLandingMotion(rootRef);
  const handleFeaturePointer = (event: React.PointerEvent<HTMLUListElement>) => {
    if (event.pointerType !== 'mouse') return;
    const card = (event.target as HTMLElement).closest<HTMLElement>('.landing-bento-grid li');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--pointer-x', `${((event.clientX - rect.left) / rect.width) * 100}%`);
    card.style.setProperty('--pointer-y', `${((event.clientY - rect.top) / rect.height) * 100}%`);
  };
  const resetFeaturePointer = (event: React.PointerEvent<HTMLUListElement>) => {
    if (event.pointerType === 'mouse') event.currentTarget.querySelectorAll<HTMLElement>('li').forEach(card => { card.style.removeProperty('--pointer-x'); card.style.removeProperty('--pointer-y'); });
  };
  return <div className="profile-landing" ref={rootRef}>
    <a className="skip-link" href="#contenido-principal">Saltar al contenido principal</a>
    <header className="landing-header"><div className="landing-header-inner"><Brand light/><button className="landing-menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="landing-navigation" aria-label={menuOpen ? 'Cerrar navegación' : 'Abrir navegación'} onClick={() => setMenuOpen(!menuOpen)}><span/><span/></button><nav id="landing-navigation" className={menuOpen ? 'landing-nav is-open' : 'landing-nav'} aria-label="Navegación principal"><a href="#plataforma" onClick={closeMenu}>Plataforma</a><a href="#flujo" onClick={closeMenu}>Cómo funciona</a><a href="#organizaciones" onClick={closeMenu}>Organizaciones</a><a href="#equipo" onClick={closeMenu}>Quiénes somos</a><div className="landing-nav-actions"><a className="landing-login" href="/login">Iniciar sesión</a><a className="landing-button primary" href="/register">Crear espacio <ArrowRight size={16}/></a></div></nav></div></header>
    <main id="contenido-principal">
      <section className="landing-hero" aria-labelledby="landing-title"><div className="landing-hero-copy"><div className="hero-eyebrow"><span className="eyebrow-spark"><Sparkles size={13}/></span> PROFILES <i/> CLOUD PROJECT INTELLIGENCE</div><h1 id="landing-title"><span className="hero-title-line"><span>Tus proyectos.</span></span><span className="hero-title-line"><span className="hero-highlight">Una visión.</span></span><span className="hero-title-line"><span>Mejores decisiones.</span></span></h1><p>Centraliza proyectos, equipos y presupuestos. Explora escenarios y toma decisiones con claridad desde un solo espacio de trabajo.</p><div className="landing-hero-actions"><a className="landing-button primary" href="/register">Crear una organización <ArrowRight size={17}/></a><a className="landing-button secondary" href="#plataforma">Explorar plataforma</a></div><div className="landing-trust"><span><Check/> Espacios por organización</span><span><Check/> Escenarios interactivos</span><span><Check/> Software abierto · MIT</span></div></div><FloatingDashboard/></section>
      <section className="landing-decision" id="decision-lab" aria-labelledby="decision-title"><div className="landing-section-heading" data-reveal><span className="section-kicker"><Gauge size={14}/> DECISION LAB · DEMO</span><h2 id="decision-title">Decide con contexto, antes de mover recursos.</h2><p>Explora cómo cambian tus indicadores al ajustar capacidad y presupuesto.</p></div><div data-reveal><InteractiveDecisionDeck/></div></section>
      <section className="landing-capabilities" id="plataforma" aria-labelledby="capabilities-title"><div className="landing-capabilities-intro" data-reveal><span className="section-kicker">UNA VISTA CONECTADA</span><h2 id="capabilities-title">Todo el contexto de tu organización, en un mismo lugar.</h2><p>Diseñado para que gestión, finanzas y ejecución trabajen sobre la misma fuente de verdad.</p></div><ul className="landing-bento-grid" onPointerMove={handleFeaturePointer} onPointerLeave={resetFeaturePointer}>{capabilities.map((item, index) => { const Icon = item.icon; return <li data-feature={item.kind} data-reveal style={{'--reveal-delay': `${index * 65}ms`} as React.CSSProperties} className={item.featured ? 'is-featured' : ''} key={item.title}><span className="cap-icon"><Icon size={18}/></span><div><h3>{item.title}</h3><p>{item.text}</p><FeatureVisual kind={item.kind}/></div></li>; })}</ul></section>
      <section className="landing-purpose" id="flujo" aria-labelledby="flujo-title"><div className="landing-section-heading" data-reveal><span className="section-kicker">DEL PLAN A LA ACCIÓN</span><h2 id="flujo-title">El trabajo conectado se entiende mejor.</h2><p>ProFiles ordena cada etapa para que el equipo actúe sobre información verificable.</p></div><ol className="landing-steps">{steps.map(([number, title, text], index) => <li data-reveal style={{'--reveal-delay': `${index * 100}ms`} as React.CSSProperties} key={number}><span className="landing-step-number">{number}</span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol></section>
      <section className="landing-organizations" id="organizaciones" aria-labelledby="org-title"><div className="landing-org-heading"><span className="section-kicker"><Building2 size={14}/> ESPACIOS DE TRABAJO</span><h2 id="org-title">Cada organización, su propio espacio.</h2><p>Gestiona proyectos, equipos y decisiones con información organizada y acceso según los permisos de cada usuario.</p></div><OrganizationsVisual/><div className="landing-org-points"><article><span className="org-icon"><Building2/></span><div><h3>Un espacio de trabajo propio</h3><p>La información de cada organización se administra dentro de su espacio.</p></div></article><article><span className="org-icon"><LockKeyhole/></span><div><h3>Acceso según la función</h3><p>Los permisos de cada persona determinan las acciones disponibles.</p></div></article><article><span className="org-icon"><ClipboardList/></span><div><h3>Proyectos y recursos vinculados</h3><p>El trabajo y las asignaciones se relacionan con la organización correspondiente.</p></div></article></div><p className="landing-org-note"><ShieldCheck size={15}/> ProFiles está diseñado para separar espacios por organización. La seguridad efectiva también depende de la configuración y validación de cada despliegue.</p></section>
      <section className="landing-about" id="equipo" aria-labelledby="about-title"><div className="landing-about-copy"><p className="landing-team-name" translate="no">CloudComputin-utec2026-02</p><h2 id="about-title">Software abierto para organizar el trabajo que importa.</h2><p>Somos el equipo que desarrolla ProFiles como una herramienta de software libre para facilitar la gestión de portafolios y proyectos en organizaciones distintas.</p><p>Reunimos planes, personas y seguimiento en una experiencia comprensible, accesible, reutilizable y adaptable a las necesidades de cada equipo.</p><a className="landing-about-link" href="#proposito">Conoce qué buscamos <ArrowRight size={16}/></a></div><AboutVisual/></section>
      <section className="landing-closing" id="proposito" aria-labelledby="proposito-title"><div className="landing-closing-card"><div className="landing-closing-copy"><span className="section-kicker">UN ESPACIO PARA AVANZAR</span><h2 id="proposito-title">Convierte la complejidad en claridad.</h2><p>Organiza el trabajo de tu equipo y toma mejores decisiones desde una sola plataforma.</p><div className="landing-purpose-values"><span><HeartHandshake/> Accesible para equipos distintos</span><span><Layers/> Reutilizable y abierto</span><span><ShieldCheck/> Contexto con permisos</span></div></div><div className="landing-closing-actions"><a className="landing-button primary" href="/register">Crear una organización <ArrowRight size={16}/></a><a className="landing-button secondary" href="/login">Iniciar sesión</a></div></div></section>
    </main>
    <footer className="landing-footer"><Brand light/><span>Software libre · Licencia MIT</span><a className="landing-repository" href={github && /^https:\/\/github\.com\//i.test(github) ? github : 'https://github.com/Pepe17xd/ProyectoCloud-Portafolios'} target="_blank" rel="noreferrer">Explorar en GitHub <ArrowRight size={14}/></a><a href="/login">Acceder a ProFiles <ArrowRight size={14}/></a></footer>
  </div>;
}

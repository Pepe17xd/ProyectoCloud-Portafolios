import { useState } from 'react';
import { ArrowRight, Building2, Check, ClipboardList, FolderKanban, HeartHandshake, Layers, LockKeyhole, ShieldCheck, Users } from 'lucide-react';
import { Brand, BrandIcon, FoliMascot } from '../../components/Brand';
import './Landing.css';
import './landing-identity.css';

const steps = [
  { number: '01', title: 'Centraliza proyectos', text: 'Relaciona portafolios, proyectos, tareas, personas y presupuestos en un espacio de trabajo.' },
  { number: '02', title: 'Detecta qué atender', text: 'Consulta vencimientos, asignaciones y presupuesto desde los registros disponibles.' },
  { number: '03', title: 'Coordina el seguimiento', text: 'Configura automatizaciones, revisa reportes y consulta notificaciones internas.' },
  { number: '04', title: 'Evalúa antes de decidir', text: 'Compara escenarios hipotéticos sin cambiar los datos operativos.' },
];

function PortfolioIllustration() {
  return <svg className="landing-illustration" viewBox="0 0 480 330" role="img" aria-labelledby="illustration-title illustration-description">
    <title id="illustration-title">Proyectos conectados por un equipo</title>
    <desc id="illustration-description">Una carpeta de portafolio agrupa proyectos, responsables y tareas de seguimiento.</desc>
    <path d="M65 58h112l30 28h204a15 15 0 0 1 15 15v157a15 15 0 0 1-15 15H68a15 15 0 0 1-15-15V73a15 15 0 0 1 12-15Z" fill="#1b2430" stroke="#304052" strokeWidth="2"/>
    <path d="M54 101h358v157a15 15 0 0 1-15 15H68a15 15 0 0 1-15-15V101Z" fill="#202c3a" stroke="#304052" strokeWidth="2"/>
    <rect x="82" y="129" width="197" height="96" rx="9" fill="#151d28" stroke="#304052"/>
    <path d="M100 151h112M100 169h157M100 187h126" stroke="#73869c" strokeWidth="5" strokeLinecap="round"/>
    <path d="M100 209h69" stroke="#5485c1" strokeWidth="5" strokeLinecap="round"/>
    <circle cx="333" cy="151" r="18" fill="#253349" stroke="#8fb4e2" strokeWidth="2"/>
    <circle cx="333" cy="146" r="5" fill="#8fb4e2"/><path d="M322 161c2-8 20-8 22 0" fill="none" stroke="#8fb4e2" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="377" cy="151" r="18" fill="#253349" stroke="#79b69a" strokeWidth="2"/>
    <circle cx="377" cy="146" r="5" fill="#79b69a"/><path d="M366 161c2-8 20-8 22 0" fill="none" stroke="#79b69a" strokeWidth="2" strokeLinecap="round"/>
    <rect x="302" y="189" width="94" height="36" rx="7" fill="#151d28" stroke="#304052"/>
    <path d="m315 207 5 5 9-11m8 6h43" fill="none" stroke="#79b69a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M279 177h22m-11-11v22" stroke="#5485c1" strokeWidth="2" strokeLinecap="round"/>
  </svg>;
}

function WorkspacePreview() {
  return <div className="landing-preview" aria-label="Vista ilustrativa de la interfaz ProFiles; no muestra datos reales">
    <div className="landing-preview-nav"><Brand compact/><span>Inicio</span><span>Proyectos</span><span>Equipo</span><span>Finanzas</span><span>Herramientas</span></div>
    <div className="landing-preview-main"><span className="landing-preview-note">VISTA DE INTERFAZ · SIN DATOS REALES</span><h2>Resumen ejecutivo</h2><p>Estado y pendientes de tu organización</p>
      <div className="landing-preview-kpis"><div><small>Proyectos activos</small><b>—</b></div><div><small>Por revisar</small><b>—</b></div><div><small>Escenarios</small><b>—</b></div></div>
      <div className="landing-preview-row"><span className="landing-preview-dot"/><div><b>Actividad del proyecto</b><small>Estado · fecha · responsable</small></div><Check size={16}/></div>
      <div className="landing-preview-row"><span className="landing-preview-dot is-muted"/><div><b>Seguimiento pendiente</b><small>Revisa el contexto antes de actuar</small></div><ArrowRight size={16}/></div>
    </div>
  </div>;
}

function TeamIllustration() {
  return <div className="landing-team-art" aria-label="Ilustración de una carpeta que reúne proyectos y personas" role="img">
    <div className="landing-art-halo"/>
    <div className="landing-art-folder"><BrandIcon large/><span>Un espacio para avanzar</span></div>
    <div className="landing-art-note note-lavender"><FolderKanban size={17}/><span>Proyectos</span></div>
    <div className="landing-art-note note-coral"><Users size={17}/><span>Personas</span></div>
    <div className="landing-art-note note-cream"><ShieldCheck size={17}/><span>Permisos</span></div>
    <FoliMascot variant="illustration" className="landing-foli" alt="Foli, la mascota de ProFiles"/>
  </div>;
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  const github = import.meta.env.VITE_GITHUB_URL as string | undefined;

  return <div className="profile-landing">
    <header className="landing-header">
      <div className="landing-header-inner"><Brand />
        <button className="landing-menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="landing-navigation" aria-label={menuOpen ? 'Cerrar navegación' : 'Abrir navegación'} onClick={() => setMenuOpen(!menuOpen)}>
          <span/><span/>
        </button>
        <nav id="landing-navigation" className={menuOpen ? 'landing-nav is-open' : 'landing-nav'} aria-label="Navegación principal">
          <a href="#plataforma" onClick={closeMenu}>Plataforma</a><a href="#flujo" onClick={closeMenu}>Cómo funciona</a><a href="#equipo" onClick={closeMenu}>Quiénes somos</a><a href="#organizaciones" onClick={closeMenu}>Organizaciones</a>
          <div className="landing-nav-actions"><a className="landing-login" href="/login">Iniciar sesión</a><a className="landing-button primary" href="/register">Crear espacio <ArrowRight size={16}/></a></div>
        </nav>
      </div>
    </header>

    <main>
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy"><div className="landing-hero-brand"><BrandIcon large/><span><b>ProFiles</b><small>Proyectos y portafolios, en un mismo lugar</small></span></div><span className="landing-kicker">GESTIÓN CLARA PARA EL TRABAJO EN EQUIPO</span>
          <h1 id="landing-title">Organiza.<br/><span>Decide. Avanza.</span></h1>
          <p>Conecta proyectos, equipos y presupuestos. Identifica qué necesita atención y evalúa alternativas con información de tu organización.</p>
          <div className="landing-hero-actions"><a className="landing-button primary" href="/register">Crear una organización <ArrowRight size={17}/></a><a className="landing-text-link" href="#flujo">Conocer la plataforma</a></div>
          <div className="landing-trust"><span><Check size={15}/> Cada equipo con su propio espacio</span><span><Check size={15}/> Escenarios para revisar antes de decidir</span></div>
        </div>
        <div className="landing-hero-visual"><PortfolioIllustration/><WorkspacePreview/></div>
      </section>

      <section className="landing-purpose" id="flujo" aria-labelledby="purpose-title">
        <div className="landing-section-heading"><span className="landing-kicker">DEL PLAN AL SEGUIMIENTO</span><h2 id="purpose-title">El trabajo conectado<br/><span>se entiende mejor.</span></h2><p>ProFiles reúne el contexto para que los equipos revisen prioridades y pendientes desde una misma organización.</p></div>
        <ol className="landing-steps">{steps.map(step => <li key={step.number}><span className="landing-step-number">{step.number}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}</ol>
      </section>

      <section className="landing-capabilities" id="plataforma" aria-labelledby="capabilities-title">
        <div><span className="landing-kicker">UN ESPACIO DE TRABAJO</span><h2 id="capabilities-title">Contexto para cada equipo.</h2></div>
        <ul><li><FolderKanban size={18}/><span><b>Proyectos y portafolios</b><small>Organiza iniciativas, tareas, fechas y estados.</small></span></li><li><Users size={18}/><span><b>Personas y recursos</b><small>Consulta responsables, asignaciones y capacidad disponible.</small></span></li><li><ClipboardList size={18}/><span><b>Seguimiento y reportes</b><small>Revisa pendientes, avisos y resultados registrados.</small></span></li><li><Layers size={18}/><span><b>Decision Lab</b><small>Explora escenarios explicables antes de una revisión humana.</small></span></li></ul>
      </section>

      <section className="landing-about" id="equipo" aria-labelledby="about-title">
        <div className="landing-about-copy"><span className="landing-kicker">QUIÉNES SOMOS</span><p className="landing-team-name">CloudComputin-utec2026-02</p><h2 id="about-title">Software abierto para organizar el trabajo que importa.</h2><p>Somos el equipo que desarrolla ProFiles como una herramienta de software libre para facilitar la gestión de portafolios y proyectos en organizaciones distintas.</p><p>Lo creamos para reunir planes, personas y seguimiento en una experiencia comprensible. Buscamos que el software abierto sea accesible, reutilizable y adaptable a las necesidades de cada equipo.</p><a className="landing-about-link" href="#proposito">Conoce qué buscamos <ArrowRight size={16}/></a></div>
        <TeamIllustration/>
      </section>

      <section className="landing-organizations" id="organizaciones" aria-labelledby="org-title">
        <div className="landing-org-heading"><span className="landing-kicker">UN ESPACIO PARA CADA ORGANIZACIÓN</span><h2 id="org-title">Cada equipo trabaja desde su propio espacio.</h2><p>ProFiles organiza los proyectos y recursos por organización para que cada equipo tenga contexto y acceso según la función de sus integrantes.</p></div>
        <div className="landing-org-points">
          <article><span className="org-icon icon-blue"><Building2 size={20}/></span><div><h3>Un espacio de trabajo propio</h3><p>La información de una organización se administra dentro de su espacio.</p></div></article>
          <article><span className="org-icon icon-lavender"><LockKeyhole size={20}/></span><div><h3>Acceso según la función</h3><p>Los permisos de cada persona determinan las acciones disponibles.</p></div></article>
          <article><span className="org-icon icon-coral"><FolderKanban size={20}/></span><div><h3>Proyectos y recursos vinculados</h3><p>El trabajo y las asignaciones se relacionan con la organización correspondiente.</p></div></article>
        </div>
        <p className="landing-org-note"><ShieldCheck size={15}/> ProFiles está diseñado para separar espacios por organización. La seguridad efectiva también depende de la configuración y validación de cada despliegue.</p>
      </section>

      <section className="landing-purpose" id="proposito" aria-labelledby="purpose-title">
        <div className="landing-section-heading"><span className="landing-kicker">QUÉ BUSCAMOS</span><h2 id="purpose-title">Más claridad para decidir<br/><span>y avanzar en equipo.</span></h2><p>Queremos que los equipos puedan ver qué se está haciendo, quién participa y qué necesita atención, usando una plataforma abierta que puedan adaptar.</p></div>
        <div className="landing-purpose-values"><span><HeartHandshake size={18}/> Accesible para equipos distintos</span><span><Layers size={18}/> Reutilizable y abierto</span><span><ShieldCheck size={18}/> Contexto con permisos</span></div>
      </section>
    </main>

    <footer className="landing-footer"><Brand/><span>Software libre · Licencia MIT</span><a className="landing-repository" href={github && /^https:\/\/github\.com\//i.test(github) ? github : 'https://github.com/Pepe17xd/ProyectoCloud-Portafolios'} target="_blank" rel="noreferrer">Explorar en GitHub <ArrowRight size={14}/></a><a href="/login">Acceder a ProFiles <ArrowRight size={14}/></a></footer>
  </div>;
}

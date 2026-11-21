import { useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  ClipboardList,
  FolderKanban,
  HeartHandshake,
  Kanban,
  Layers,
  LockKeyhole,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import { Brand, BrandIcon, FoliMascot } from '../../components/Brand';
import './Landing.css';
import './landing-identity.css';

type DeckTab = 'simulador' | 'portafolio';

const DECK_TABS: ReadonlyArray<{ id: DeckTab; label: string }> = [
  { id: 'simulador', label: 'Simulador Decision Lab' },
  { id: 'portafolio', label: 'Portafolio en curso' },
];

const SIM_PRESETS = [
  { id: 'balanced', label: 'Equilibrado', reallocation: 20, budgetLimit: 48000 },
  { id: 'accelerate', label: 'Acelerar Q4', reallocation: 35, budgetLimit: 54000 },
  { id: 'lean', label: 'Ajustar presupuesto', reallocation: 10, budgetLimit: 42000 },
] as const;

const steps = [
  {
    number: '01',
    title: 'Centraliza tu portafolio',
    text: 'Reúne portafolios, proyectos, responsables, tareas y presupuestos en un único espacio de trabajo.',
  },
  {
    number: '02',
    title: 'Detecta qué requiere atención',
    text: 'Identifica fechas próximas a vencer, sobrecargas de equipo y presupuestos por encima del límite.',
  },
  {
    number: '03',
    title: 'Coordina seguimiento y equipo',
    text: 'Organiza el avance diario en Kanban, programa recordatorios automáticos y descarga reportes claros.',
  },
  {
    number: '04',
    title: 'Evalúa escenarios antes de decidir',
    text: 'Compara alternativas de presupuesto, plazos y capacidad sin modificar los datos en curso.',
  },
];

const capabilities = [
  {
    icon: Sparkles,
    tone: 'sky',
    featured: true,
    title: 'Decision Lab',
    text: 'Simula reasignaciones de capacidad, topes presupuestales y ponderaciones de prioridad con impacto explicable antes de aprobar cambios.',
  },
  {
    icon: FolderKanban,
    tone: 'indigo',
    featured: true,
    title: 'Portafolios y proyectos',
    text: 'Estructura iniciativas, metas, fechas clave y responsables con visibilidad compartida y contexto por organización.',
  },
  {
    icon: Kanban,
    tone: 'emerald',
    featured: false,
    title: 'Tablero Kanban',
    text: 'Mueve tareas entre Por hacer, En progreso, Bloqueada y Completada sin perder responsables ni plazos.',
  },
  {
    icon: Wallet,
    tone: 'amber',
    featured: false,
    title: 'Presupuestos y gastos',
    text: 'Controla techos financieros, gastos ejecutados y saldo disponible por proyecto en su moneda.',
  },
  {
    icon: Users,
    tone: 'sky',
    featured: false,
    title: 'Personas y capacidad',
    text: 'Visualiza asignaciones reales del equipo para anticipar cuellos de botella y evitar sobrecarga.',
  },
  {
    icon: BarChart3,
    tone: 'indigo',
    featured: false,
    title: 'Automatizaciones y reportes',
    text: 'Programa resúmenes periódicos, recibe alertas oportunas y exporta informes consolidados al instante.',
  },
] as const;

function InteractiveDecisionDeck() {
  const [activeTab, setActiveTab] = useState<DeckTab>('simulador');
  const [reallocation, setReallocation] = useState(20);
  const [budgetLimit, setBudgetLimit] = useState(48000);

  const estimatedCost = Math.round(41800 + reallocation * 185);
  const budgetMargin = budgetLimit - estimatedCost;
  const overBudget = budgetMargin < 0;
  const overloadedPeople = reallocation >= 35 ? 2 : reallocation >= 30 ? 1 : 0;
  const scenarioScore = Math.min(
    99,
    Math.max(55, 74 + Math.round(reallocation * 0.65) - (overBudget ? 9 : 0) - overloadedPeople * 4),
  );
  const scoreDelta = scenarioScore - 74;

  const overallStatus = overBudget
    ? { label: 'Sobre presupuesto', tone: 'rose' }
    : overloadedPeople > 0
    ? { label: 'Revisar capacidad', tone: 'amber' }
    : { label: 'Escenario viable', tone: 'emerald' };

  const liveProjects = [
    {
      name: 'Portal de clientes',
      owner: 'Camila Ríos',
      portfolio: 'Portafolio Digital',
      progress: Math.min(98, 68 + Math.round(reallocation * 0.5)),
      detail: `Puntaje ${76 + Math.round(reallocation * 0.45)} pts`,
      status: reallocation >= 20 ? 'Prioritario' : 'En curso',
      tone: reallocation >= 20 ? 'sky' : 'slate',
    },
    {
      name: 'Cierre presupuestal Q4',
      owner: 'Mateo Paredes',
      portfolio: 'Finanzas',
      progress: overBudget ? 88 : 64,
      detail: `Costo est. $${Math.round(estimatedCost * 0.34).toLocaleString('en-US')}`,
      status: overBudget ? 'Excede límite' : 'En margen',
      tone: overBudget ? 'rose' : 'emerald',
    },
    {
      name: 'Plataforma operativa',
      owner: 'Lucía Herrera',
      portfolio: 'Operaciones',
      progress: Math.min(96, 82 + Math.round(reallocation * 0.2)),
      detail: `Carga ${Math.min(115, 72 + Math.round(reallocation * 1.1))}%`,
      status: overloadedPeople > 0 ? 'Sobrecarga' : 'Equilibrado',
      tone: overloadedPeople > 0 ? 'amber' : 'emerald',
    },
  ] as const;

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const nextIndex =
      event.key === 'ArrowRight'
        ? (index + 1) % DECK_TABS.length
        : (index - 1 + DECK_TABS.length) % DECK_TABS.length;
    setActiveTab(DECK_TABS[nextIndex].id);
  }

  return (
    <section
      className="command-deck"
      aria-label="Simulador interactivo de ProFiles con datos ilustrativos de ejemplo"
    >
      <div className="command-deck-bar">
        <div className="command-deck-brand">
          <BrandIcon />
          <span translate="no">ProFiles</span>
        </div>

        <div className="command-deck-tabs" role="tablist" aria-label="Vistas interactivas">
          {DECK_TABS.map((item, idx) => (
            <button
              key={item.id}
              id={`deck-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === item.id}
              aria-controls={`deck-panel-${item.id}`}
              tabIndex={activeTab === item.id ? 0 : -1}
              className={`command-deck-tab ${activeTab === item.id ? 'is-active' : ''}`}
              onClick={() => setActiveTab(item.id)}
              onKeyDown={event => handleTabKeyDown(event, idx)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <span className="command-deck-pill">Vista interactiva · Datos de ejemplo</span>
      </div>

      <div
        className="command-deck-body"
        role="tabpanel"
        id={`deck-panel-${activeTab}`}
        aria-labelledby={`deck-tab-${activeTab}`}
      >
        {activeTab === 'simulador' ? (
          <div className="sim-grid">
            <div className="sim-controls">
              <div className="sim-controls-head">
                <SlidersHorizontal size={16} aria-hidden="true" />
                <div>
                  <h2>Ajusta un escenario</h2>
                  <p>Mueve los parámetros para observar el impacto en vivo.</p>
                </div>
              </div>

              <div className="sim-presets" role="group" aria-label="Escenarios predefinidos">
                {SIM_PRESETS.map(preset => {
                  const active =
                    reallocation === preset.reallocation && budgetLimit === preset.budgetLimit;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={active}
                      className={`sim-preset-btn ${active ? 'is-active' : ''}`}
                      onClick={() => {
                        setReallocation(preset.reallocation);
                        setBudgetLimit(preset.budgetLimit);
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <div className="sim-field">
                <div className="sim-field-head">
                  <label htmlFor="sim-reallocation">Capacidad reasignada a Q4</label>
                  <strong>{reallocation}%</strong>
                </div>
                <input
                  id="sim-reallocation"
                  type="range"
                  min={0}
                  max={40}
                  step={5}
                  value={reallocation}
                  onChange={e => setReallocation(Number(e.target.value))}
                />
                <div className="sim-scale" aria-hidden="true">
                  <span>0% base</span>
                  <span>20% óptimo</span>
                  <span>40% intensivo</span>
                </div>
              </div>

              <div className="sim-field">
                <div className="sim-field-head">
                  <label htmlFor="sim-budget">Techo presupuestal</label>
                  <strong>${budgetLimit.toLocaleString('en-US')}</strong>
                </div>
                <input
                  id="sim-budget"
                  type="range"
                  min={38000}
                  max={60000}
                  step={1000}
                  value={budgetLimit}
                  onChange={e => setBudgetLimit(Number(e.target.value))}
                />
                <div className="sim-scale" aria-hidden="true">
                  <span>$38,000</span>
                  <span>$48,000</span>
                  <span>$60,000</span>
                </div>
              </div>

              <p className="sim-footnote">
                Simulación ilustrativa de solo lectura: dentro de ProFiles nunca altera registros
                reales sin revisión humana.
              </p>
            </div>

            <div className="sim-results">
              <div className="sim-results-head">
                <div>
                  <h2>Impacto proyectado</h2>
                  <p>Comparado frente a la línea base actual (74 pts)</p>
                </div>
                <span className={`deck-status tone-${overallStatus.tone}`}>
                  {overallStatus.label}
                </span>
              </div>

              <div className="sim-kpis">
                <div className="sim-kpi">
                  <span>Prioridad promedio</span>
                  <strong>{scenarioScore} pts</strong>
                  <small className={scoreDelta >= 0 ? 'delta-up' : 'delta-down'}>
                    {scoreDelta >= 0 ? `+${scoreDelta}` : scoreDelta} pts vs base
                  </small>
                </div>

                <div className="sim-kpi">
                  <span>Costo proyectado</span>
                  <strong>${estimatedCost.toLocaleString('en-US')}</strong>
                  <small className={overBudget ? 'delta-down' : 'delta-up'}>
                    {overBudget
                      ? `Excede por $${Math.abs(budgetMargin).toLocaleString('en-US')}`
                      : `Margen $${budgetMargin.toLocaleString('en-US')}`}
                  </small>
                </div>

                <div className="sim-kpi">
                  <span>Carga del equipo</span>
                  <strong>
                    {overloadedPeople === 0
                      ? 'Equilibrada'
                      : overloadedPeople === 1
                      ? '1 sobrecarga'
                      : `${overloadedPeople} sobrecargas`}
                  </strong>
                  <small className={overloadedPeople > 0 ? 'delta-warn' : 'delta-up'}>
                    {overloadedPeople > 0 ? 'Requiere redistribuir horas' : 'Capacidad dentro de límite'}
                  </small>
                </div>
              </div>

              <div className="sim-impact-list">
                {liveProjects.map(project => (
                  <div className="sim-impact-row" key={project.name}>
                    <div className="sim-impact-main">
                      <strong>{project.name}</strong>
                      <small>
                        {project.owner} · {project.portfolio}
                      </small>
                    </div>
                    <span className="sim-impact-metric">{project.detail}</span>
                    <span className={`deck-status tone-${project.tone}`}>{project.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="deck-portfolio-view">
            <div className="sim-results-head">
              <div>
                <h2>Portafolio en curso · Q4</h2>
                <p>Vista conectada con las variables del simulador activo ({reallocation}% reasignado)</p>
              </div>
              <span className={`deck-status tone-${overallStatus.tone}`}>{overallStatus.label}</span>
            </div>

            <div className="deck-portfolio-table">
              <div className="deck-portfolio-cols" aria-hidden="true">
                <span>Proyecto</span>
                <span>Responsable</span>
                <span>Avance</span>
                <span>Estado</span>
              </div>
              {liveProjects.map(project => (
                <div className="deck-portfolio-row" key={project.name}>
                  <div className="deck-portfolio-title">
                    <strong>{project.name}</strong>
                    <small>{project.portfolio}</small>
                  </div>
                  <span className="deck-portfolio-owner">{project.owner}</span>
                  <div className="deck-portfolio-meter">
                    <div className="deck-meter-track" aria-hidden="true">
                      <span
                        className={`deck-meter-fill tone-${project.tone}`}
                        style={{ width: `${project.progress}%` }}
                      />
                    </div>
                    <span>{project.progress}%</span>
                  </div>
                  <span className={`deck-status tone-${project.tone}`}>{project.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function TeamIllustration() {
  return (
    <div
      className="landing-team-art"
      aria-label="Ilustración de ProFiles y su mascota Foli reuniendo proyectos, personas y permisos"
      role="img"
    >
      <div className="landing-art-halo" aria-hidden="true" />
      <div className="landing-art-folder">
        <BrandIcon large />
        <span>Un espacio para avanzar</span>
      </div>
      <div className="landing-art-note note-lavender" aria-hidden="true">
        <FolderKanban size={16} aria-hidden="true" />
        <span>Proyectos</span>
      </div>
      <div className="landing-art-note note-coral" aria-hidden="true">
        <Users size={16} aria-hidden="true" />
        <span>Personas</span>
      </div>
      <div className="landing-art-note note-cream" aria-hidden="true">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>Permisos</span>
      </div>
      <FoliMascot
        variant="illustration"
        className="landing-foli"
        alt="Foli, la mascota de ProFiles"
      />
    </div>
  );
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  const github = import.meta.env.VITE_GITHUB_URL as string | undefined;

  return (
    <div className="profile-landing">
      <a className="skip-link" href="#contenido-principal">
        Saltar al contenido principal
      </a>

      <header className="landing-header">
        <div className="landing-header-inner">
          <Brand light />
          <button
            className="landing-menu-toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="landing-navigation"
            aria-label={menuOpen ? 'Cerrar navegación' : 'Abrir navegación'}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
          <nav
            id="landing-navigation"
            className={menuOpen ? 'landing-nav is-open' : 'landing-nav'}
            aria-label="Navegación principal"
          >
            <a href="#plataforma" onClick={closeMenu}>
              Plataforma
            </a>
            <a href="#flujo" onClick={closeMenu}>
              Cómo funciona
            </a>
            <a href="#organizaciones" onClick={closeMenu}>
              Organizaciones
            </a>
            <a href="#equipo" onClick={closeMenu}>
              Quiénes somos
            </a>
            <div className="landing-nav-actions">
              <a className="landing-login" href="/login">
                Iniciar sesión
              </a>
              <a className="landing-button primary" href="/register">
                Crear espacio <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
          </nav>
        </div>
      </header>

      <main id="contenido-principal">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <h1 id="landing-title">
              Organiza portafolios.
              <br />
              Simula antes de decidir.
            </h1>
            <p>
              Reúne proyectos, equipos y presupuestos en un único espacio de trabajo. Prueba abajo
              cómo cambian prioridades, costos y carga del equipo antes de comprometer recursos.
            </p>
            <div className="landing-hero-actions">
              <a className="landing-button primary" href="/register">
                Crear una organización <ArrowRight size={17} aria-hidden="true" />
              </a>
              <a className="landing-button secondary" href="#plataforma">
                Explorar plataforma
              </a>
            </div>
            <div className="landing-trust">
              <span>
                <Check size={15} aria-hidden="true" /> Espacio privado por organización
              </span>
              <span>
                <Check size={15} aria-hidden="true" /> Escenarios explicables en vivo
              </span>
              <span>
                <Check size={15} aria-hidden="true" /> Software libre · MIT
              </span>
            </div>
          </div>

          <InteractiveDecisionDeck />
        </section>

        <section
          className="landing-capabilities"
          id="plataforma"
          aria-labelledby="capabilities-title"
        >
          <div className="landing-capabilities-intro">
            <h2 id="capabilities-title">Todo el contexto de tu organización, en un mismo lugar.</h2>
            <p>
              Diseñado para que gestión, finanzas y ejecución trabajen sobre la misma fuente de
              verdad, sin planillas dispersas ni cambios a ciegas.
            </p>
          </div>
          <ul className="landing-bento-grid">
            {capabilities.map(item => {
              const Icon = item.icon;
              return (
                <li className={item.featured ? 'is-featured' : ''} key={item.title}>
                  <span className={`cap-icon tone-${item.tone}`} aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="landing-purpose" id="flujo" aria-labelledby="flujo-title">
          <div className="landing-section-heading">
            <h2 id="flujo-title">El trabajo conectado se entiende mejor.</h2>
            <p>
              De la planificación inicial a la comparación de alternativas, ProFiles ordena cada paso
              para que el equipo actúe sobre información verificable.
            </p>
          </div>
          <ol className="landing-steps">
            {steps.map(step => (
              <li key={step.number}>
                <span className="landing-step-number">{step.number}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="landing-organizations"
          id="organizaciones"
          aria-labelledby="org-title"
        >
          <div className="landing-org-heading">
            <h2 id="org-title">Cada equipo trabaja desde su propio espacio.</h2>
            <p>
              ProFiles organiza los proyectos y recursos por organización para que cada equipo tenga
              contexto y acceso según la función de sus integrantes.
            </p>
          </div>
          <div className="landing-org-points">
            <article>
              <span className="org-icon icon-blue" aria-hidden="true">
                <Building2 size={20} />
              </span>
              <div>
                <h3>Un espacio de trabajo propio</h3>
                <p>La información de una organización se administra dentro de su espacio.</p>
              </div>
            </article>
            <article>
              <span className="org-icon icon-lavender" aria-hidden="true">
                <LockKeyhole size={20} />
              </span>
              <div>
                <h3>Acceso según la función</h3>
                <p>Los permisos de cada persona determinan las acciones disponibles.</p>
              </div>
            </article>
            <article>
              <span className="org-icon icon-coral" aria-hidden="true">
                <ClipboardList size={20} />
              </span>
              <div>
                <h3>Proyectos y recursos vinculados</h3>
                <p>El trabajo y las asignaciones se relacionan con la organización correspondiente.</p>
              </div>
            </article>
          </div>
          <p className="landing-org-note">
            <ShieldCheck size={15} aria-hidden="true" /> ProFiles está diseñado para separar
            espacios por organización. La seguridad efectiva también depende de la configuración y
            validación de cada despliegue.
          </p>
        </section>

        <section className="landing-about" id="equipo" aria-labelledby="about-title">
          <div className="landing-about-copy">
            <p className="landing-team-name" translate="no">
              CloudComputin-utec2026-02
            </p>
            <h2 id="about-title">Software abierto para organizar el trabajo que importa.</h2>
            <p>
              Somos el equipo que desarrolla ProFiles como una herramienta de software libre para
              facilitar la gestión de portafolios y proyectos en organizaciones distintas.
            </p>
            <p>
              Lo creamos para reunir planes, personas y seguimiento en una experiencia comprensible.
              Buscamos que el software abierto sea accesible, reutilizable y adaptable a las
              necesidades de cada equipo.
            </p>
            <a className="landing-about-link" href="#proposito">
              Conoce qué buscamos <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
          <TeamIllustration />
        </section>

        <section className="landing-closing" id="proposito" aria-labelledby="proposito-title">
          <div className="landing-closing-card">
            <div className="landing-closing-copy">
              <h2 id="proposito-title">Más claridad para decidir y avanzar en equipo.</h2>
              <p>
                Queremos que los equipos puedan ver qué se está haciendo, quién participa y qué
                necesita atención, usando una plataforma abierta que puedan adaptar.
              </p>
              <div className="landing-purpose-values">
                <span>
                  <HeartHandshake size={17} aria-hidden="true" /> Accesible para equipos distintos
                </span>
                <span>
                  <Layers size={17} aria-hidden="true" /> Reutilizable y abierto
                </span>
                <span>
                  <ShieldCheck size={17} aria-hidden="true" /> Contexto con permisos
                </span>
              </div>
            </div>
            <div className="landing-closing-actions">
              <a className="landing-button primary" href="/register">
                Crear una organización <ArrowRight size={16} aria-hidden="true" />
              </a>
              <a className="landing-button secondary" href="/login">
                Iniciar sesión
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <Brand light />
        <span>Software libre · Licencia MIT</span>
        <a
          className="landing-repository"
          href={
            github && /^https:\/\/github\.com\//i.test(github)
              ? github
              : 'https://github.com/Pepe17xd/ProyectoCloud-Portafolios'
          }
          target="_blank"
          rel="noreferrer"
        >
          Explorar en GitHub <ArrowRight size={14} aria-hidden="true" />
        </a>
        <a href="/login">
          Acceder a ProFiles <ArrowRight size={14} aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}

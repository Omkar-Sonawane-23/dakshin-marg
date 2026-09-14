import { useEffect, useRef, useState, type MouseEvent } from 'react';
import Architecture from './Architecture';
import Icon from './Icon';
import { demoVideo, showcaseShots, type ShowcaseShot } from './assets';
import Workflow from './Workflow';
import { ArrowLink, DataTag, NumberedLabel, Reveal, SectionHeading, StatusPill } from './ShowcasePrimitives';

const navItems = [
  { id: 'home', label: 'Home' },
  { id: 'problem', label: 'Problem' },
  { id: 'solution', label: 'Solution' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'demo', label: 'Demo' },
  { id: 'stack', label: 'Technology' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'impact', label: 'Impact' },
];

const problemCards = [
  {
    number: '01',
    title: 'Moving ice',
    body: 'Sea-ice concentration changes across the route corridor while its edge is difficult to read from a single observation.',
    icon: 'waves' as const,
    tone: 'violet',
  },
  {
    number: '02',
    title: 'Uncertain bergs',
    body: 'A charted position is a snapshot. Drift, data age and prediction error change the space a vessel must keep clear.',
    icon: 'target' as const,
    tone: 'cyan',
  },
  {
    number: '03',
    title: 'Weather exposure',
    body: 'Wind and sub-zero conditions add icing risk, while isolated feeds leave the operator to assemble the picture by hand.',
    icon: 'waves' as const,
    tone: 'amber',
  },
];

const stackGroups = [
  {
    label: 'INTERFACE',
    title: 'Mission command layer',
    items: ['React 19', 'TypeScript', 'Vite', 'Tailwind CSS 4'],
    note: 'Map-dominant UI with custom polar projection and operator-first states.',
    icon: 'grid' as const,
    tone: 'cyan',
  },
  {
    label: 'SCIENCE',
    title: 'Environmental intelligence',
    items: ['Python', 'FastAPI', 'Damped-trend forecast', 'A* route search'],
    note: 'Stateless scientific services own ingestion, models, risk and optimization.',
    icon: 'spark' as const,
    tone: 'violet',
  },
  {
    label: 'APPLICATION',
    title: 'Service boundary',
    items: ['Node.js', 'Express', 'Validated API contracts', 'Cached snapshots'],
    note: 'The application layer orchestrates requests without putting science in Node.',
    icon: 'terminal' as const,
    tone: 'green',
  },
  {
    label: 'DATA',
    title: 'Traceable inputs',
    items: ['NSIDC Sea Ice Index v4', 'USNIC iceberg positions', 'BYU/NIC tracks', 'Open-Meteo weather'],
    note: 'Observed, historical, forecast and simulated data stay explicitly labelled.',
    icon: 'layers' as const,
    tone: 'amber',
  },
];

const approachCards = [
  {
    eyebrow: '01 / MULTI-LAYER',
    title: 'One operational picture',
    body: 'Sea ice, berg movement, weather exposure, vessel constraints and route alternatives meet in the same workflow.',
    icon: 'layers' as const,
  },
  {
    eyebrow: '02 / PREDICTIVE',
    title: 'Forward-looking, not overconfident',
    body: 'Short-horizon products carry uncertainty and are refused beyond the evidence the prototype can support.',
    icon: 'spark' as const,
  },
  {
    eyebrow: '03 / EXPLAINABLE',
    title: 'Why is this route different?',
    body: 'Severity ceilings replace an opaque weighted score. Each recommendation exposes the hazards and trade-offs behind it.',
    icon: 'terminal' as const,
  },
  {
    eyebrow: '04 / OPERATIONAL',
    title: 'Designed for a decision',
    body: 'Alerts, re-planning, provenance, stale-data states and human override are part of the product — not afterthoughts.',
    icon: 'compass' as const,
  },
];

const edgeCases = [
  ['Stale or missing data', 'Degraded banner, source age and a conservative branch; no silent continuation.'],
  ['Uncertain berg trajectory', 'P50/P90 corridor widens and corridor intrusion can trigger review.'],
  ['No feasible route', 'A no-safe-route state explains the blocked constraints instead of drawing a fake answer.'],
  ['Route invalidated underway', 'A changed condition creates an alert, a before/after comparison and an explicit operator gate.'],
];

const impactItems = [
  { label: 'SAFETY', title: 'Make hazards visible before they become route decisions.', icon: 'target' as const },
  { label: 'AWARENESS', title: 'Give every layer a place in the same geographic context.', icon: 'layers' as const },
  { label: 'DECISION SPEED', title: 'Reduce the manual work between observation and review.', icon: 'route' as const },
  { label: 'ACCOUNTABILITY', title: 'Keep provenance, uncertainty and human action in the record.', icon: 'compass' as const },
];

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function DemoVideo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(() => typeof IntersectionObserver === 'undefined');
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setLoaded(true);
        observer.disconnect();
      }
    }, { rootMargin: '240px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const startVideo = () => {
    setLoaded(true);
    window.setTimeout(() => {
      void videoRef.current?.play().then(() => setPlaying(true)).catch(() => undefined);
    }, 60);
  };

  return (
    <div className="demo-video-wrap" ref={containerRef}>
      {loaded ? (
        <video
          ref={videoRef}
          className="demo-video"
          controls
          playsInline
          preload="metadata"
          poster={showcaseShots[0].src}
          src={demoVideo}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          aria-label="Dakshin Marg system demonstration recording"
        />
      ) : (
        <div className="demo-video-poster" style={{ backgroundImage: `url(${showcaseShots[0].src})` }}>
          <span className="demo-video-grid" />
        </div>
      )}
      {!playing && (
        <button className="demo-play" type="button" onClick={startVideo} aria-label="Play the Dakshin Marg demo recording">
          <span><Icon name="play" size={23} /></span>
          <b>PLAY SYSTEM DEMO</b>
          <small>LOCAL RECORDING · 720P</small>
        </button>
      )}
      <div className="demo-corner demo-corner-tl" />
      <div className="demo-corner demo-corner-br" />
    </div>
  );
}

function GalleryModal({ shot, onClose }: { shot: ShowcaseShot; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="gallery-modal" role="dialog" aria-modal="true" aria-label={`${shot.title} screenshot`} onClick={(event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="gallery-modal-card">
        <div className="gallery-modal-head"><div><span>{shot.eyebrow}</span><h3>{shot.title}</h3></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close screenshot"><Icon name="close" size={19} /></button></div>
        <img src={shot.src} alt={shot.title} />
        <p>{shot.description}</p>
      </div>
    </div>
  );
}

function ShowcaseNav({ activeSection }: { activeSection: string }) {
  const [open, setOpen] = useState(false);
  const externalDemoUrl = import.meta.env.VITE_YOUTUBE_URL;

  return (
    <header className={`showcase-nav-wrap ${open ? 'is-open' : ''}`}>
      <nav className="showcase-nav" aria-label="Showcase navigation">
        <a className="showcase-brand" href="#home" onClick={() => setOpen(false)} aria-label="Dakshin Marg home">
          <span className="brand-mark"><Icon name="compass" size={22} /></span>
          <span><b>DAKSHIN MARG</b><small>ANTARCTIC NAVIGATION DSS</small></span>
        </a>
        <div className="showcase-nav-links">
          {navItems.map((item) => <a className={activeSection === item.id ? 'is-active' : ''} href={`#${item.id}`} key={item.id} onClick={() => setOpen(false)}>{item.label}</a>)}
        </div>
        <div className="showcase-nav-actions">
          {externalDemoUrl ? <a className="nav-demo-link" href={externalDemoUrl} target="_blank" rel="noreferrer">Watch demo <Icon name="arrow" size={14} /></a> : <button className="nav-demo-link" type="button" onClick={() => { scrollToSection('demo'); setOpen(false); }}>Watch demo <Icon name="arrow" size={14} /></button>}
          <a className="nav-console-link" href="/console">Open console <Icon name="arrow" size={14} /></a>
          <button className="showcase-menu-button" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? 'Close navigation' : 'Open navigation'}><Icon name={open ? 'close' : 'menu'} size={19} /></button>
        </div>
      </nav>
    </header>
  );
}

function HeroDemoVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const startVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  return (
    <div className="hero-demo-shell" id="hero-demo-video" aria-label="Dakshin Marg system demonstration">
      <div className="hero-demo-topline">
        <span><i className="live-dot" /> SYSTEM DEMO / RUNNING APPLICATION</span>
        <span className="mono">08:04 · AUTOPLAY PREVIEW / 720P</span>
      </div>
      <div className="hero-demo-canvas">
        <video
          ref={videoRef}
          className="hero-demo-video"
          autoPlay
          muted
          controls
          playsInline
          preload="metadata"
          poster={showcaseShots[0].src}
          src={demoVideo}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          aria-label="Dakshin Marg system demonstration recording"
        />
        {!playing && (
          <button className="hero-demo-play" type="button" onClick={startVideo} aria-label="Play the Dakshin Marg demo recording">
            <span><Icon name="play" size={23} /></span>
            <b>PLAY SYSTEM DEMO</b>
            <small>MISSION CONTROL · FULL WALKTHROUGH</small>
          </button>
        )}
        <div className="hero-demo-corner hero-demo-corner-tl" />
        <div className="hero-demo-corner hero-demo-corner-br" />
      </div>
      <div className="hero-demo-readouts" aria-label="Demo details">
        <div><span>RECORDING</span><strong>08:04 WALKTHROUGH</strong></div>
        <div><span>PRODUCT</span><strong>WORKING CONSOLE</strong></div>
        <div><span>AUDIO</span><strong>USE PLAYER CONTROLS</strong></div>
      </div>
      <div className="hero-demo-footer">
        <StatusPill tone="green" icon="play">RUNNING APPLICATION</StatusPill>
        <DataTag tone="sim">DEMO DATA LABELLED</DataTag>
        <span className="hero-demo-footer-copy"><Icon name="layers" size={13} /> OBSERVE → PREDICT → DECIDE</span>
      </div>
    </div>
  );
}

function Hero() {
  const externalDemoUrl = import.meta.env.VITE_YOUTUBE_URL;
  const focusHeroDemo = () => document.getElementById('hero-demo-video')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return (
    <section className="showcase-hero showcase-container" id="home">
      <HeroDemoVideo />
      <div className="hero-copy">
        <div className="hero-eyebrow"><span className="eyebrow-line" />SMART INDIA HACKATHON 2026 <span className="eyebrow-divider">/</span> TRANSPORTATION &amp; LOGISTICS</div>
        <h1>Navigate the<br /><em>unpredictable.</em></h1>
        <p className="hero-subtitle">An intelligent decision-support platform for safer navigation through Antarctica's dynamic maritime environment.</p>
        <div className="hero-actions">
          <a className="button button-primary" href="/console"><span>Explore the system</span><Icon name="arrow" size={17} /></a>
          {externalDemoUrl ? <a className="button button-secondary" href={externalDemoUrl} target="_blank" rel="noreferrer"><Icon name="play" size={13} /><span>Watch demo</span></a> : <button className="button button-secondary" type="button" onClick={focusHeroDemo}><Icon name="play" size={13} /><span>Watch demo</span></button>}
        </div>
        <div className="hero-principle"><span className="principle-rule" /><span><b>OBSERVE</b> → <b>PREDICT</b> → <b>ASSESS</b> → <b>OPTIMIZE</b> → <b>DECIDE</b></span></div>
      </div>
      <div className="hero-footnote"><span>01 / WORKING APPLICATION DEMO</span><span>SCROLL TO EXPLORE <span className="scroll-arrow">↓</span></span></div>
    </section>
  );
}

function ProblemSection() {
  return (
    <section className="showcase-section" id="problem">
      <div className="showcase-container">
        <Reveal><SectionHeading number="01" eyebrow="THE PROBLEM" title={<>The route is never<br /><em>just a line on a map.</em></>}>
          In Antarctic waters, the conditions that shape a navigation decision are moving, incomplete and distributed across different products. The hard part is not finding another feed. It is turning the whole picture into a decision an operator can inspect.
        </SectionHeading></Reveal>
        <div className="problem-grid">
          <Reveal className="problem-statement" delay={80}>
            <div className="statement-mark">“</div>
            <p>Sea ice, iceberg drift and vessel exposure are often treated as separate problems. A navigator needs them in one geographic context — with data age, uncertainty and constraints still attached.</p>
            <div className="statement-caption"><span className="status-dot" /> A real-world navigation problem / East Antarctica</div>
          </Reveal>
          <div className="problem-cards">
            {problemCards.map((card, index) => (
              <Reveal key={card.number} delay={120 + index * 70}>
                <article className={`problem-card problem-card-${card.tone}`}>
                  <div className="problem-card-top"><span>{card.number}</span><Icon name={card.icon} size={19} /></div>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                  <div className="card-rule" />
                  <span className="card-state">UNRESOLVED IN ISOLATION</span>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
        <Reveal className="gap-banner" delay={120}>
          <div className="gap-banner-label"><span className="section-eyebrow">THE GAP</span><Icon name="plus" size={16} /></div>
          <div className="gap-banner-copy"><strong>Separate intelligence layers create a fragmented decision.</strong><span>What if the system made their relationships visible instead?</span></div>
          <Icon name="arrow" size={22} />
        </Reveal>
      </div>
    </section>
  );
}

function SolutionSection() {
  return (
    <section className="showcase-section showcase-section-dark" id="solution">
      <div className="showcase-container">
        <Reveal><SectionHeading number="02" eyebrow="THE SOLUTION" title={<>From many signals<br /><em>to one operating picture.</em></>}>
          Dakshin Marg connects the environmental data pipeline to a map-centric decision workflow: observe the corridor, anticipate change, assess navigability, compare alternatives and keep the final call with a qualified human.
        </SectionHeading></Reveal>
        <Reveal className="fusion-wrap" delay={100}>
          <div className="fusion-sources">
            <div className="fusion-source"><span className="fusion-icon"><Icon name="waves" size={20} /></span><b>SEA ICE</b><small>CONCENTRATION + EDGE</small></div>
            <div className="fusion-source"><span className="fusion-icon"><Icon name="target" size={20} /></span><b>ICEBERG MOVEMENT</b><small>TRACKS + CORRIDORS</small></div>
            <div className="fusion-source"><span className="fusion-icon"><Icon name="route" size={20} /></span><b>VESSEL ROUTING</b><small>CLASS + CONSTRAINTS</small></div>
            <div className="fusion-source"><span className="fusion-icon"><Icon name="spark" size={20} /></span><b>RISK INTELLIGENCE</b><small>ICE + ICING + BERGS</small></div>
          </div>
          <div className="fusion-convergence"><span /><span /><span /><span /></div>
          <div className="fusion-core"><div className="fusion-core-orbit" /><Icon name="compass" size={34} /><span>UNIFIED</span><strong>DECISION<br />SUPPORT</strong><small>TRACEABLE · UNCERTAINTY-AWARE · HUMAN-LED</small></div>
        </Reveal>
        <div className="solution-proof-grid">
          <Reveal delay={80}><div className="proof-card"><DataTag tone="real">OBSERVED</DataTag><strong>Source-aware</strong><p>NSIDC, USNIC, BYU/NIC and Open-Meteo inputs retain provenance through the pipeline.</p></div></Reveal>
          <Reveal delay={140}><div className="proof-card"><DataTag tone="forecast">MODEL FORECAST</DataTag><strong>Uncertainty stays on screen</strong><p>Forecasts carry an age, horizon and empirical error context instead of a false confidence score.</p></div></Reveal>
          <Reveal delay={200}><div className="proof-card"><DataTag tone="sim">HUMAN GATE</DataTag><strong>No autonomous control</strong><p>Routes are recommendations. Accept, override and review actions belong to the operator.</p></div></Reveal>
        </div>
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section className="showcase-section" id="workflow">
      <div className="showcase-container">
        <Reveal><SectionHeading number="03" eyebrow="HOW IT WORKS" title={<>A chain of evidence<br /><em>behind every recommendation.</em></>}>
          The product story is also the system architecture. Click through the stages to see what enters the system, what it produces and where the operator remains in control.
        </SectionHeading></Reveal>
        <Reveal delay={100}><Workflow /></Reveal>
      </div>
    </section>
  );
}

function DemoSection() {
  return (
    <section className="showcase-section showcase-section-dark" id="demo">
      <div className="showcase-container">
        <Reveal><SectionHeading number="04" eyebrow="SYSTEM DEMO" title={<>See the system<br /><em>make a decision.</em></>}>
          A narrated recording generated from the running application. It walks from mission setup through environmental layers, route comparison and a dynamic re-planning review.
        </SectionHeading></Reveal>
        <Reveal className="demo-layout" delay={100}>
          <DemoVideo />
          <div className="demo-aside">
            <div className="demo-aside-top"><StatusPill tone="green" icon="play">RUNNING APPLICATION</StatusPill><span className="mono">08:04 / FULL WALKTHROUGH</span></div>
            <h3>Watch the evidence<br /><em>move through the loop.</em></h3>
            <div className="demo-chapters">
              {[
                ['01', 'Mission context', 'Vessel, corridor and map layers'],
                ['02', 'Environmental intelligence', 'Sea ice, bergs and weather'],
                ['03', 'Route decision', 'Alternatives, risk and rationale'],
                ['04', 'Re-planning drill', 'Changed conditions → review required'],
              ].map(([number, title, body]) => <div className="demo-chapter" key={number}><span>{number}</span><div><strong>{title}</strong><small>{body}</small></div></div>)}
            </div>
            <div className="demo-honesty"><Icon name="terminal" size={15} /><span>DEMO DATA IS LABELLED. FUEL IS NOT COMPUTED BY THE LIVE OPTIMIZER. THE NAVIGATION DECISION STAYS HUMAN.</span></div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function PreviewSection({ onSelect }: { onSelect: (shot: ShowcaseShot) => void }) {
  return (
    <section className="showcase-section" id="platform">
      <div className="showcase-container">
        <Reveal><SectionHeading number="05" eyebrow="PLATFORM PREVIEW" title={<>The interface is<br /><em>the proof.</em></>}>
          Not a concept board. These are captures from the working Dakshin Marg mission command center — the same product shown in the demo above.
        </SectionHeading></Reveal>
        <div className="preview-grid">
          {showcaseShots.map((shot, index) => (
            <Reveal key={shot.title} className={`preview-card-wrap preview-card-wrap-${index}`} delay={index * 50}>
              <button className="preview-card" type="button" onClick={() => onSelect(shot)} aria-label={`Open ${shot.title} screenshot`}>
                <span className="preview-image"><img src={shot.src} alt={shot.title} loading={index === 0 ? 'eager' : 'lazy'} /><span className="preview-image-overlay"><Icon name="plus" size={20} /></span></span>
                <span className="preview-card-meta"><span><b>{shot.eyebrow}</b><strong>{shot.title}</strong></span><Icon name="arrow" size={16} /></span>
                <span className="preview-card-description">{shot.description}</span>
              </button>
            </Reveal>
          ))}
        </div>
        <div className="preview-foot"><span className="status-dot" /> CLICK ANY FRAME TO INSPECT THE WORKFLOW <ArrowLink href="/console">Open the live console</ArrowLink></div>
      </div>
    </section>
  );
}

function StackSection() {
  return (
    <section className="showcase-section showcase-section-dark" id="stack">
      <div className="showcase-container">
        <Reveal><SectionHeading number="06" eyebrow="TECHNOLOGY" title={<>A pragmatic stack<br /><em>for a difficult domain.</em></>}>
          The implementation uses the simplest defensible tool at each boundary. Scientific work stays close to the data; the interface stays fast, inspectable and honest about prototype status.
        </SectionHeading></Reveal>
        <div className="stack-grid">
          {stackGroups.map((group, index) => (
            <Reveal key={group.label} delay={index * 60}>
              <article className={`stack-card stack-card-${group.tone}`}>
                <div className="stack-card-head"><span className="stack-icon"><Icon name={group.icon} size={20} /></span><span className="section-eyebrow">{group.label}</span><span className="stack-card-index">0{index + 1}</span></div>
                <h3>{group.title}</h3>
                <div className="stack-items">{group.items.map((item) => <span key={item}>{item}</span>)}</div>
                <p>{group.note}</p>
              </article>
            </Reveal>
          ))}
        </div>
        <Reveal className="truth-strip" delay={140}>
          <NumberedLabel number="STATUS">BUILT WITH EVIDENCE, NOT BUZZWORDS</NumberedLabel>
          <div className="truth-strip-copy"><strong>Damped-trend forecasting is a baseline — not a claim of deep learning.</strong><span>ConvLSTM / U-Net is planned for a longer archive, not smuggled into the MVP story.</span></div>
          <DataTag tone="sim">PROTOTYPE / TRANSPARENT</DataTag>
        </Reveal>
      </div>
    </section>
  );
}

function ArchitectureSection() {
  return (
    <section className="showcase-section" id="architecture">
      <div className="showcase-container">
        <Reveal><SectionHeading number="07" eyebrow="SYSTEM ARCHITECTURE" title={<>Every layer knows<br /><em>what it is responsible for.</em></>}>
          The system is split so data quality and scientific reasoning cannot disappear inside the UI. Each service boundary carries the evidence needed to explain the next decision.
        </SectionHeading></Reveal>
        <Reveal delay={100}><Architecture /></Reveal>
      </div>
    </section>
  );
}

function ApproachSection() {
  return (
    <section className="showcase-section" id="approach">
      <div className="showcase-container">
        <Reveal><SectionHeading number="08" eyebrow="WHY THIS APPROACH" title={<>Useful because it<br /><em>stays explainable.</em></>}>
          The differentiator is not a claim of perfect prediction. It is the discipline to connect each recommendation to the data, method, constraint and human action that produced it.
        </SectionHeading></Reveal>
        <div className="approach-grid">
          {approachCards.map((card, index) => <Reveal key={card.eyebrow} delay={index * 55}><article className="approach-card"><div className="approach-card-top"><span>{card.eyebrow}</span><Icon name={card.icon} size={19} /></div><h3>{card.title}</h3><p>{card.body}</p><div className="approach-card-line" /></article></Reveal>)}
        </div>
      </div>
    </section>
  );
}

function MaturitySection() {
  return (
    <section className="showcase-section showcase-section-dark" id="maturity">
      <div className="showcase-container">
        <Reveal><SectionHeading number="09" eyebrow="FEASIBILITY + SAFETY" title={<>Designed to say<br /><em>“not enough evidence.”</em></>}>
          A credible navigation tool needs graceful failure, not just a beautiful happy path. These states are part of the product and the demonstration.
        </SectionHeading></Reveal>
        <div className="maturity-grid">
          <Reveal className="feasibility-card" delay={80}>
            <div className="feasibility-head"><span className="stack-icon"><Icon name="compass" size={20} /></span><span className="section-eyebrow">FEASIBILITY</span></div>
            <h3>Prototype-ready today.<br /><em>Extendable tomorrow.</em></h3>
            <div className="feasibility-list">
              <div><b>TECHNICAL</b><span>Open data, documented APIs, deterministic demo and a service split that can grow.</span></div>
              <div><b>OPERATIONAL</b><span>One interface for layers, routes, alerts, provenance and review states.</span></div>
              <div><b>SCALABLE</b><span>New data sources, models and operational regions can enter through explicit contracts.</span></div>
            </div>
          </Reveal>
          <Reveal className="edge-card" delay={150}>
            <div className="edge-card-top"><span className="section-eyebrow">EDGE CONDITIONS / 04</span><StatusPill tone="amber">REVIEW PATHS</StatusPill></div>
            <div className="edge-list">{edgeCases.map(([title, body], index) => <div className="edge-row" key={title}><span>0{index + 1}</span><div><strong>{title}</strong><p>{body}</p></div><Icon name="chevron" size={15} /></div>)}</div>
          </Reveal>
        </div>
        <Reveal className="safety-line" delay={180}><Icon name="target" size={16} /><strong>DECISION SUPPORT ONLY</strong><span>Confidence is not safety. A recommendation is not an order. Human authority is a system invariant.</span></Reveal>
      </div>
    </section>
  );
}

function ImpactSection() {
  return (
    <section className="showcase-section" id="impact">
      <div className="showcase-container">
        <Reveal><SectionHeading number="10" eyebrow="WHY IT MATTERS" title={<>Better context<br /><em>for better decisions.</em></>}>
          Dakshin Marg is built for the people who carry the decision across a polar mission: navigators, voyage planners, researchers and coordinators who need the evidence in front of them before the route changes.
        </SectionHeading></Reveal>
        <div className="impact-grid">
          {impactItems.map((item, index) => <Reveal key={item.label} delay={index * 55}><article className="impact-card"><div className="impact-icon"><Icon name={item.icon} size={21} /></div><span>{item.label}</span><h3>{item.title}</h3><i /></article></Reveal>)}
        </div>
        <Reveal className="impact-quote" delay={150}><div className="impact-quote-mark">→</div><p>From complex Antarctic data<br /><em>to a decision someone can defend.</em></p><span>DAKSHIN MARG / HUMAN-IN-THE-LOOP NAVIGATION</span></Reveal>
      </div>
    </section>
  );
}

function FinalCta() {
  const externalDemoUrl = import.meta.env.VITE_YOUTUBE_URL;
  return (
    <section className="final-cta" id="final-cta">
      <div className="final-cta-glow" />
      <div className="showcase-container final-cta-inner">
        <div className="section-eyebrow">THE NEXT DECISION IS YOURS</div>
        <h2>See what the<br /><em>system sees.</em></h2>
        <p>Explore the working console, inspect the route logic and watch the full mission workflow.</p>
        <div className="hero-actions">
          <a className="button button-primary" href="/console"><span>Explore the system</span><Icon name="arrow" size={17} /></a>
          {externalDemoUrl ? <a className="button button-secondary" href={externalDemoUrl} target="_blank" rel="noreferrer"><Icon name="play" size={13} /><span>Watch demo</span></a> : <button className="button button-secondary" type="button" onClick={() => scrollToSection('demo')}><Icon name="play" size={13} /><span>Watch demo</span></button>}
          <a className="button button-quiet" href="https://github.com/Omkar-Sonawane-23/dakshin-marg" target="_blank" rel="noreferrer"><Icon name="terminal" size={14} /><span>GitHub</span></a>
        </div>
        <div className="final-cta-meta"><span>SMART INDIA HACKATHON 2026</span><span>ANTARCTICA / EAST ANTARCTICA</span><span>PROTOTYPE / DECISION SUPPORT</span></div>
      </div>
    </section>
  );
}

function Footer() {
  return <footer className="showcase-footer"><div className="showcase-container"><div className="footer-brand"><span className="brand-mark"><Icon name="compass" size={20} /></span><div><b>DAKSHIN MARG</b><small>AI-ENABLED ANTARCTIC NAVIGATION DECISION SUPPORT</small></div></div><div className="footer-links"><a href="#home">Back to top <Icon name="arrow" size={14} /></a><a href="https://github.com/Omkar-Sonawane-23/dakshin-marg" target="_blank" rel="noreferrer">Source <Icon name="arrow" size={14} /></a></div><div className="footer-bottom"><span>Built for a difficult route, with the evidence left visible.</span><span>© 2026 / SIH PROJECT SHOWCASE</span></div></div></footer>;
}

export default function Showcase() {
  const [activeSection, setActiveSection] = useState('home');
  const [selectedShot, setSelectedShot] = useState<ShowcaseShot | null>(null);

  useEffect(() => {
    const observedIds = [...navItems.map((item) => item.id), 'architecture', 'maturity', 'platform'];
    const sections = observedIds.map((id) => document.getElementById(id)).filter((element): element is HTMLElement => Boolean(element));
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target.id && navItems.some((item) => item.id === visible.target.id)) setActiveSection(visible.target.id);
    }, { rootMargin: '-34% 0px -52% 0px', threshold: [0, 0.15, 0.4, 0.75] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.body.classList.add('showcase-active');
    return () => document.body.classList.remove('showcase-active');
  }, []);

  return (
    <div className="showcase-page">
      <ShowcaseNav activeSection={activeSection} />
      <main>
        <Hero />
        <ProblemSection />
        <SolutionSection />
        <WorkflowSection />
        <DemoSection />
        <PreviewSection onSelect={setSelectedShot} />
        <StackSection />
        <ArchitectureSection />
        <ApproachSection />
        <MaturitySection />
        <ImpactSection />
        <FinalCta />
      </main>
      <Footer />
      {selectedShot && <GalleryModal shot={selectedShot} onClose={() => setSelectedShot(null)} />}
    </div>
  );
}

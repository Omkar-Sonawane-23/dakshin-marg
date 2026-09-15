import { useState } from 'react';
import Icon from './Icon';
import { DataTag, NumberedLabel, StatusPill } from './ShowcasePrimitives';

type WorkflowStep = {
  id: string;
  phase: string;
  title: string;
  summary: string;
  input: string;
  output: string;
  detail: string;
  accent: 'cyan' | 'violet' | 'green' | 'amber';
};

const steps: WorkflowStep[] = [
  {
    id: '01',
    phase: 'OBSERVE',
    title: 'Ingest the operating picture',
    summary: 'Bring separate environmental signals into one time- and space-aware view.',
    input: 'NSIDC · USNIC · Open-Meteo',
    output: 'Validated observation envelopes',
    detail: 'Every product carries source, timestamp, CRS, resolution, quality and freshness so the operator can see what the system knows — and when it knew it.',
    accent: 'cyan',
  },
  {
    id: '02',
    phase: 'PREDICT',
    title: 'Extend the picture with uncertainty',
    summary: 'Forecast the short horizon without hiding the limits of the data window.',
    input: '8-day real observation window',
    output: '24 / 48 / 72 h model products',
    detail: 'A damped-trend sea-ice baseline and an ensemble berg-drift model produce forecasts with empirical uncertainty. Horizons beyond 72 hours are refused.',
    accent: 'violet',
  },
  {
    id: '03',
    phase: 'ASSESS',
    title: 'Turn conditions into navigability',
    summary: 'Make the contributors to risk inspectable instead of collapsing them into a mystery score.',
    input: 'Ice · berg · icing contributors',
    output: 'LOW / MEDIUM / HIGH / CRITICAL',
    detail: 'The risk engine combines POLARIS, Overland icing and empirical iceberg zones as worst-of severity. The map keeps the reason attached to the cell and the route.',
    accent: 'amber',
  },
  {
    id: '04',
    phase: 'OPTIMIZE',
    title: 'Compare routes under hard limits',
    summary: 'Generate alternatives that explain exactly what they refuse to enter.',
    input: 'Vessel class + severity ceiling',
    output: 'Direct · Balanced · Conservative',
    detail: 'A* searches the risk grid under declared severity ceilings. There is no hidden risk-weight slider and no silent relaxation when a profile is infeasible.',
    accent: 'green',
  },
  {
    id: '05',
    phase: 'DECIDE',
    title: 'Keep authority with the operator',
    summary: 'Present evidence, trade-offs and a re-planning trail for a human decision.',
    input: 'Recommendation + rationale',
    output: 'Review · accept · override',
    detail: 'A route recommendation is never an autonomous command. Review-required alerts, human overrides and decision history remain visible in the workflow.',
    accent: 'cyan',
  },
];

export default function Workflow() {
  const [active, setActive] = useState(0);
  const step = steps[active];

  return (
    <div className="workflow-layout">
      <div className="workflow-list" role="tablist" aria-label="Dakshin Marg workflow stages">
        {steps.map((item, index) => (
          <button
            className={`workflow-step ${index === active ? 'is-active' : ''}`}
            key={item.id}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-controls={`workflow-panel-${item.id}`}
            onClick={() => setActive(index)}
          >
            <span className={`workflow-step-number workflow-${item.accent}`}>{item.id}</span>
            <span className="workflow-step-copy">
              <span className="workflow-step-phase">{item.phase}</span>
              <strong>{item.title}</strong>
              <small>{item.summary}</small>
            </span>
            <Icon name="chevron" size={17} />
          </button>
        ))}
      </div>

      <div className={`workflow-panel workflow-panel-${step.accent}`} id={`workflow-panel-${step.id}`} role="tabpanel">
        <div className="workflow-panel-top">
          <div>
            <div className="section-eyebrow">STAGE {step.id} / {step.phase}</div>
            <h3>{step.title}</h3>
          </div>
          <StatusPill tone={step.accent === 'violet' ? 'cyan' : step.accent}>{step.phase === 'DECIDE' ? 'OPERATOR GATE' : 'SYSTEM STAGE'}</StatusPill>
        </div>
        <div className="workflow-signal">
          <div className="signal-node">
            <span>INPUT</span>
            <strong>{step.input}</strong>
          </div>
          <div className="signal-line"><i /><i /><i /></div>
          <div className="signal-node signal-node-output">
            <span>OUTPUT</span>
            <strong>{step.output}</strong>
          </div>
        </div>
        <p className="workflow-detail">{step.detail}</p>
        <div className="workflow-console">
          <NumberedLabel number={step.id}>TRACEABLE DECISION PATH</NumberedLabel>
          <div className="console-row"><span className="console-key">provenance</span><DataTag tone={step.phase === 'PREDICT' ? 'forecast' : step.phase === 'DECIDE' ? 'sim' : 'real'}>{step.phase === 'PREDICT' ? 'MODEL_FORECAST' : step.phase === 'DECIDE' ? 'HUMAN_ACTION' : 'DERIVED_FROM_OBSERVATION'}</DataTag></div>
          <div className="console-row"><span className="console-key">confidence</span><span className="console-value">uncertainty remains visible</span></div>
          <div className="console-row"><span className="console-key">failure mode</span><span className="console-value">degrade · warn · require review</span></div>
        </div>
      </div>
    </div>
  );
}

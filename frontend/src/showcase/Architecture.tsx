import Icon, { type IconName } from './Icon';
import { DataTag, StatusPill } from './ShowcasePrimitives';

type ArchitectureNode = {
  id: string;
  label: string;
  title: string;
  body: string;
  icon: IconName;
  tone: 'source' | 'science' | 'app' | 'interface' | 'human';
};

const nodes: ArchitectureNode[] = [
  {
    id: '01',
    label: 'OBSERVE',
    title: 'Open data sources',
    body: 'NSIDC sea ice · USNIC bergs · BYU/NIC tracks · Open-Meteo weather',
    icon: 'waves',
    tone: 'source',
  },
  {
    id: '02',
    label: 'INGEST + VALIDATE',
    title: 'Python scientific service',
    body: 'Normalize, quality-check and preserve provenance in every response.',
    icon: 'terminal',
    tone: 'science',
  },
  {
    id: '03',
    label: 'MODEL + ASSESS',
    title: 'Prediction & risk engines',
    body: 'Forecast, uncertainty, POLARIS, icing, iceberg zones and route search.',
    icon: 'spark',
    tone: 'science',
  },
  {
    id: '04',
    label: 'ORCHESTRATE',
    title: 'Node application API',
    body: 'Validate requests, cache products and normalize service failures.',
    icon: 'layers',
    tone: 'app',
  },
  {
    id: '05',
    label: 'DECIDE',
    title: 'React mission interface',
    body: 'Map layers, alternatives, alerts, explanations and decision history.',
    icon: 'grid',
    tone: 'interface',
  },
  {
    id: '06',
    label: 'AUTHORITY',
    title: 'Qualified operator',
    body: 'Reviews the recommendation. Nothing in the system controls a vessel.',
    icon: 'compass',
    tone: 'human',
  },
];

export default function Architecture() {
  return (
    <div className="architecture-frame">
      <div className="architecture-header">
        <div>
          <div className="section-eyebrow">TRACE / DATA TO DECISION</div>
          <h3>One contract across every layer.</h3>
        </div>
        <StatusPill tone="green" icon="target">PROVENANCE PRESERVED</StatusPill>
      </div>
      <div className="architecture-flow">
        {nodes.map((node, index) => (
          <div className="architecture-flow-item" key={node.id}>
            <article className={`architecture-node architecture-node-${node.tone}`}>
              <div className="architecture-node-top"><span>{node.id}</span><Icon name={node.icon} size={17} /></div>
              <div className="architecture-node-label">{node.label}</div>
              <h4>{node.title}</h4>
              <p>{node.body}</p>
              <DataTag tone={node.tone === 'source' ? 'real' : node.tone === 'human' ? 'sim' : 'default'}>{node.tone === 'human' ? 'HUMAN GATE' : node.tone === 'source' ? 'OBSERVED / HISTORICAL' : 'SERVICE BOUNDARY'}</DataTag>
            </article>
            {index < nodes.length - 1 && <div className="architecture-connector" aria-hidden="true"><span /><i /></div>}
          </div>
        ))}
      </div>
      <div className="architecture-note"><Icon name="terminal" size={15} /><span>Every arrow is an explicit API boundary. Science stays in Python; the frontend renders the evidence it receives.</span></div>
    </div>
  );
}
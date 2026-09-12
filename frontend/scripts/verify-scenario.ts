/** Dev sanity check: prints route risk evolution to verify the demo arc. */
import { buildScenario } from '../src/mock/scenario';

const s = buildScenario();
console.log('mission:', s.mission.code, '| vessel:', s.vessel.name);
console.log('t | active | status           | overall | B | A | C | B2 | rec | BRG-0042 threat');
for (const snap of s.snapshots) {
  const g = (id: string) => snap.routes.find((r) => r.id === id);
  const b42 = snap.icebergs.find((b) => b.id === 'BRG-0042')!;
  console.log(
    String(snap.timeOffsetH).padStart(2),
    '|', snap.activeRouteId.padEnd(5),
    '|', snap.missionStatus.padEnd(16),
    '|', String(snap.risk.overallScore).padStart(3), snap.risk.overall.padEnd(8),
    '|', g('RT-B')?.riskScore, '|', g('RT-A')?.riskScore, '|', g('RT-C')?.riskScore,
    '|', g('RT-B2')?.riskScore ?? '—',
    '|', snap.recommendedRouteId.padEnd(5),
    '|', b42.routeThreatLevel,
  );
}
const t24 = s.snapshots.find((x) => x.timeOffsetH === 24)!;
console.log('\nT+24 alerts:', t24.alerts.map((a) => `${a.id}(${a.severity})`).join(', '));
console.log('T+24 factors:', t24.risk.factors.map((f) => `${f.key}=${f.score}(${f.level})`).join(' '));

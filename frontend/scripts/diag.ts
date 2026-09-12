import { buildScenario } from '../src/mock/scenario';
import { distToPolylineNm } from '../src/lib/geo';

const s = buildScenario();
for (const t of [0, 24]) {
  const snap = s.snapshots.find((x) => x.timeOffsetH === t)!;
  console.log(`\n== T+${t} ==`);
  for (const r of snap.routes) {
    const parts: string[] = [];
    for (const b of snap.icebergs) {
      let worst = Infinity;
      for (const tp of b.trajectory.points) {
        worst = Math.min(worst, distToPolylineNm(tp.position, r.waypoints) - tp.uncertaintyNm);
      }
      if (worst < 90) parts.push(`${b.id}:${worst.toFixed(0)}`);
    }
    console.log(r.id.padEnd(6), 'risk', String(r.riskScore).padStart(3), '| bergs<90nm:', parts.join(' '), '| factors:', snap.risk.routeId === r.id ? snap.risk.factors.map((f) => `${f.key}=${f.score}`).join(' ') : '');
  }
}

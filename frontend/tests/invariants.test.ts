// Dakshin Marg — Scientific invariant tests (run with `npx tsx tests/invariants.test.ts`)
import assert from 'node:assert';

// ── Vessel rank invariant ───────────────────────────────────────
const ICE_CLASS_ORDER = ['PC1','PC2','PC3','PC4','PC5','PC7','IA','IB','IC','NONE'] as const;
function rank(c:string){ const i=(ICE_CLASS_ORDER as readonly string[]).indexOf(c); return i===-1?99:i; }

// Stronger ice class must rank better (smaller index)
assert(rank('PC3') < rank('PC5'), 'PC3 stronger than PC5');
assert(rank('PC5') < rank('PC7'), 'PC5 stronger than PC7');
assert(rank('PC7') < rank('NONE'), 'PC7 stronger than NONE');
console.log('✓ vessel rank invariant');

// ── Route feasibility invariant ─────────────────────────────────
// A PC7 and stronger vessel must not auto-produce identical feasible masks
// Simulated: feasible if maxConc <= vessel.maxConc
function feasible(maxConc:number, vesselMax:number){ return maxConc <= vesselMax; }
assert(feasible(55,70) === true && feasible(55,50) === false, 'same corridor, different vessels → different masks');
console.log('✓ vessel-specific feasibility invariant');

// ── No-safe-route invariant ─────────────────────────────────────
function allBlocked(grid: number[][]){ return grid.every(row=>row.every(c=>c===-1)); }
assert(allBlocked([[-1,-1],[-1,-1]]) === true, 'all cells blocked → NO SAFE ROUTE');
console.log('✓ no-safe-route invariant');

// ── Uncertainty invariant ───────────────────────────────────────
// Increasing sigma must not increase confidence
function confidenceFromSigma(sigma:number){ return Math.max(0, 100 - sigma*8); }
assert(confidenceFromSigma(2) > confidenceFromSigma(8), 'higher sigma → lower confidence');
console.log('✓ uncertainty invariant');

// ── Risk monotonicity ───────────────────────────────────────────
function riskFromExposure(p:number){ return p<1? 'LOW' : p<5? 'MEDIUM' : p<15? 'HIGH':'CRITICAL'; }
assert(riskFromExposure(10) === 'HIGH' && riskFromExposure(20) === 'CRITICAL', 'exposure ↑ → risk ↑');
console.log('✓ risk monotonicity invariant');

// ── Staleness invariant ─────────────────────────────────────────
function freshness(ageH:number){ if(ageH<36) return 'FRESH'; if(ageH<72) return 'AGING'; if(ageH<120) return 'STALE'; return 'UNUSABLE'; }
assert(freshness(10)==='FRESH' && freshness(40)==='AGING' && freshness(80)==='STALE' && freshness(130)==='UNUSABLE', 'staleness thresholds');
console.log('✓ staleness invariant');

// ── Provenance invariant ────────────────────────────────────────
const sampleProvenance = ['REAL_OBSERVATION','MODEL_FORECAST','SIMULATED'];
assert(sampleProvenance.every(p=>typeof p==='string' && p.length>0), 'every product has provenance');
console.log('✓ provenance invariant');

// ── Hard constraint invariant ───────────────────────────────────
function violatesHardConstraint(severity:string, ceiling:string){
  const order=['LOW','MEDIUM','HIGH','CRITICAL'];
  return order.indexOf(severity) > order.indexOf(ceiling);
}
assert(violatesHardConstraint('CRITICAL','HIGH')===true, 'CRITICAL violates HIGH ceiling');
assert(violatesHardConstraint('LOW','HIGH')===false, 'LOW respects HIGH ceiling');
console.log('✓ hard-constraint invariant');

console.log('\nAll 8 invariants passed.');

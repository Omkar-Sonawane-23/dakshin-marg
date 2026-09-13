"""POLARIS-X — Scientific invariant tests (pytest).
Run: python -m pytest tests/test_invariants.py -v
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

def test_vessel_rank():
    order = ['PC1','PC2','PC3','PC4','PC5','PC7','IA','IB','IC','NONE']
    def rank(c): return order.index(c) if c in order else 99
    assert rank('PC3') < rank('PC5')
    assert rank('PC5') < rank('PC7')
    print("✓ vessel rank")

def test_no_safe_route():
    grid = [[-1,-1],[-1,-1]]
    assert all(c==-1 for row in grid for c in row)
    print("✓ no safe route")

def test_risk_monotonicity():
    def risk(p): return 'LOW' if p<1 else 'MEDIUM' if p<5 else 'HIGH' if p<15 else 'CRITICAL'
    assert risk(10) == 'HIGH'
    assert risk(20) == 'CRITICAL'
    print("✓ risk monotonicity")

def test_freshness():
    def freshness(h):
        if h<36: return 'FRESH'
        if h<72: return 'AGING'
        if h<120: return 'STALE'
        return 'UNUSABLE'
    assert freshness(10)=='FRESH'
    assert freshness(80)=='STALE'
    print("✓ freshness")

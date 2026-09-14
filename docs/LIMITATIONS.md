# Limitations — Dakshin Marg

1. **Grid resolution 0.5°×0.25° (~14×28 km):** corridor-level guidance, not a nautical chart. Sub-cell hazards caught by dense route assessment and noted.
2. **No validated fuel model:** optimizer returns fuel NOT COMPUTED. Demo fuel figures are unvalidated estimates.
3. **Ice type assumption:** POLARIS needs ice type; NSIDC provides concentration only. Engine declares assumption and ±1-type sensitivity band.
4. **Water-temp approximation:** Overland PPR uses Tw=Tf where SST unavailable (conservative, declared).
5. **SAR detection:** validated on labelled simulated scene only; real Sentinel-1 needs auth.
6. **BYU archive lag ~6 days:** current fixes from USNIC; archive positions extrapolate.
7. **Open-Meteo wind:** global model, not Antarctic reanalysis — labelled accordingly.
8. **Summer training window:** 8 days Feb–Mar 2026; skill may degrade under regime shift.
9. **Single-operator prototype:** no multi-user auth yet (roles planned).
10. **Terrain relief synthetic:** exaggerated ×26 for legibility; elevations illustrative.
11. **Estimated ETA/fuel:** labelled UNVALIDATED, shown with appropriate precision (not 2,381.472).
12. **Not safety-certified:** decision support only; human operator is final authority; no autonomous control exists.

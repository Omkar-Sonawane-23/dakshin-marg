# Edge Cases — POLARIS-X

| Category | Case | Handling |
|---|---|---|
| Data | Missing SIC / stale / conflicting | DEGRADED banner, conservative branch, route confidence reduced, provenance shows both sources |
| Data | Invalid coords / CRS mismatch / units mismatch / corrupted | Validation layer rejects, returns {code,message}, UI shows ERROR with retry; never silently discards |
| Sea ice | Rapid SIC change / thin-ice MIZ / threshold instability | Uncertainty halo expands, MIZ flagged, robustness check recommended |
| Icebergs | Stale position / trajectory uncertainty / identity confusion / corridor entry | Uncertainty cone widens, stale badge, alert on corridor intrusion |
| ML | Inference timeout / unavailable / distribution shift / overconfidence | Fallback to persistence/last valid, label MODEL UNAVAILABLE, route disabled if fallback unsafe |
| Routing | No safe route / impossible segment / shallow draft / restricted | NO SAFE ROUTE screen with blocked constraints, suggestions (wait/vessel/time) — no fake route drawn |
| Ops | Offline / degraded / stale cache / sync conflict / whiteout | Offline banner, data age, conservative margins, human review required |
| Human | Override / ignored warning / outdated route | Logged with user/timestamp/reason, HUMAN OVERRIDE RECORDED banner, audit trail |
| Security | Invalid auth / expired / tampered data | 401/403 with safe message, input validation, rate limiting, audit log |

All cases have a scripted demo scenario (Scenario panel → 20 scenarios, one click each).

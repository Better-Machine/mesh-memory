## Summary

<!-- What does this PR do? One paragraph. -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Protocol/API change (RFC required)
- [ ] Architecture change (ADR required)
- [ ] Incident fix (post-mortem required)
- [ ] Documentation / tooling

---

## QA Gate Checklist

All boxes must be checked before merge is allowed.

### Tests
- [ ] `npm test` passes locally — all tests green
- [ ] No tests were deleted or disabled to make the suite pass

### QA Report (MVP work only — skip for POC/docs)
- [ ] `QA_REPORT.md` (or `QA_REPORT_*.md`) exists in this branch and is committed
- [ ] QA report covers the changed functionality

### Privacy Scan
- [ ] No `192.168.x.x` private IPs in changed files
- [ ] No tokens or secrets (`sk-`, 40+ char hex strings, `Bearer` credentials)
- [ ] No `/home/erik-ross/` local paths in source files
- [ ] No `.local` domain names or internal hostnames
- [ ] Config secrets use `*.config.local.json` (gitignored), not hardcoded values

---

## Protocol / Architecture Compliance

### If this PR changes a protocol endpoint, message format, or API contract:
- [ ] RFC filed and accepted (RFC-NNNN: _______)
- [ ] N/A — no protocol or API changes

### If this PR makes an architectural decision (new abstraction, new dependency, data model change):
- [ ] ADR filed and linked in this PR (ADR-NNNN: _______)
- [ ] N/A — no architectural decisions

### If this PR fixes an incident or production failure:
- [ ] Post-mortem filed at `projects/incubate/postmortems/YYYY-MM-DD-incident-name.md`
- [ ] Post-mortem entry added to `COMPLIANCE_LOG.md`
- [ ] N/A — not an incident fix

---

## Compliance Log

If any RFC, ADR, or post-mortem was filed for this PR:
- [ ] Entry added to `projects/incubate/COMPLIANCE_LOG.md` in Kosfootel/better-machine

---

## Test Evidence

<!-- Paste test output or QA report summary here -->

```
npm test output:
```

---

## Reviewer Notes

<!-- Anything the reviewer should know, watch out for, or specifically validate -->

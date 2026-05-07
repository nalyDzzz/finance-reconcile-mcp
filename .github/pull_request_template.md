## Summary

<!-- What changed and why? -->

## Safety Checklist

- [ ] This keeps SimpleFIN and Firefly III financial data read-only.
- [ ] This does not add create/update/delete/categorize/import behavior.
- [ ] Secrets and sensitive identifiers are not logged.
- [ ] Tool output is compact and agent-friendly.
- [ ] Documentation was updated if setup or behavior changed.

## Verification

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm pack --dry-run` if package contents changed

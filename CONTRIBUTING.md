# Contributing

Thanks for helping improve `finance-reconcile-mcp`.

This project handles sensitive financial metadata, so the contribution bar is mostly about preserving trust: keep the server read-only, avoid logging secrets, and keep outputs useful without exposing unnecessary identifiers.

## Ground Rules

- Do not add Firefly III write endpoints.
- Do not add tools that create, edit, delete, categorize, merge, import, or mutate financial data.
- Do not log `SIMPLEFIN_ACCESS_URL`, `FIREFLY_PAT`, account maps, raw account numbers, or full transaction identifiers.
- Mask sensitive identifiers in tool output when practical.
- Keep API responses compact and agent-friendly. Avoid returning giant raw provider payloads.
- Prefer reusable service functions over logic embedded directly in MCP tool handlers.

## Development Setup

```sh
npm install
npm run typecheck
npm test
npm run build
```

For local manual testing, create a private `.env` file from `.env.example`. Never commit `.env` or `account-map.json`.

```sh
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

## Useful Commands

```sh
npm run dev
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

`npm pack --dry-run` is useful before release because it shows exactly what will be published.

## Pull Request Checklist

- The change keeps Firefly III and SimpleFIN financial data read-only.
- New tool inputs are validated with `zod`.
- New provider data is normalized before matching or summarizing.
- Tool output is compact JSON and avoids unnecessary secrets or raw IDs.
- `npm run typecheck` passes.
- `npm test` passes.
- `npm run build` passes.
- Documentation is updated when behavior or setup changes.

## Testing With Real Accounts

When testing with real SimpleFIN or Firefly III data:

- Do not paste real tokens, account maps, raw API responses, or full transaction IDs into issues or PRs.
- Redact merchant names if they reveal private information.
- Prefer synthetic examples when describing bugs.

## Reporting Security Issues

Please do not open a public issue for secrets exposure, authentication bugs, or anything that could leak financial data. See `SECURITY.md`.

# Security Policy

## Supported Versions

This project is pre-1.0. Security fixes are expected to land on the default branch first.

## Reporting A Vulnerability

Please do not open a public GitHub issue for security-sensitive reports.

For now, use GitHub private vulnerability reporting if it is enabled on the repository. If it is not enabled, open a minimal public issue that says you have a private security report to share, without including tokens, account details, URLs with credentials, account maps, logs, or transaction data.

## Sensitive Data

Do not share:

- `SIMPLEFIN_ACCESS_URL`
- `FIREFLY_PAT`
- `.env`
- `account-map.json`
- raw SimpleFIN or Firefly III API responses
- full account numbers or transaction identifiers

## Project Security Goals

- Firefly III access remains read-only.
- No financial data mutation tools are implemented.
- Secrets are not intentionally logged.
- Returned identifiers are masked where practical.
- `setup_save_account_map` writes only local configuration after explicit confirmation.

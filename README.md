# finance-reconcile-mcp

Read-only [Model Context Protocol](https://modelcontextprotocol.io/) server for reconciling [SimpleFIN Bridge](https://www.simplefin.org/protocol.html) bank data against a [Firefly III](https://docs.firefly-iii.org/references/firefly-iii/api/) ledger.

This project is for audit and reconciliation workflows. It does not create, edit, delete, categorize, merge, import, or otherwise mutate financial data in Firefly III.

## Status

Early MVP. The server is useful for local reconciliation experiments, but matching heuristics and account mapping should be reviewed before trusting the output.

## Features

- Read-only SimpleFIN and Firefly III connectors
- Setup tools for discovering accounts, validating mappings, and saving local config
- Missing transaction detection across mapped accounts
- Stale account and balance mismatch checks
- Duplicate transaction detection in Firefly III
- Uncategorized transaction summaries with suggested category labels
- Compact JSON responses designed for AI agents and MCP clients

## Requirements

- Node.js 20 or newer
- A SimpleFIN Access URL
- A Firefly III Personal Access Token

## Recommended Setup: OpenClaw + npx

After this package is published to npm, users should not need to clone the repo. Register it as an OpenClaw MCP server with `npx`.

```sh
openclaw mcp set finance-reconcile '{
  "command": "npx",
  "args": ["-y", "finance-reconcile-mcp@latest"],
  "env": {
    "SIMPLEFIN_ACCESS_URL": "https://user:password@bridge.simplefin.org/simplefin",
    "FIREFLY_BASE_URL": "https://firefly.example.com",
    "FIREFLY_PAT": "your-firefly-token",
    "DEFAULT_LOOKBACK_DAYS": "30",
    "READONLY": "true"
  }
}'
```

OpenClaw stores outbound MCP server definitions with `openclaw mcp set`. See the [OpenClaw MCP docs](https://docs.openclaw.ai/cli/mcp) for the full command surface.

By default, the account map is stored at:

- Linux/macOS: `~/.config/finance-reconcile-mcp/account-map.json`
- Windows: `%APPDATA%\finance-reconcile-mcp\account-map.json`

Set `ACCOUNT_MAPPING_FILE` only if you want a custom path.

## OpenClaw User Flow

Once the server is registered, ask OpenClaw:

```text
Check the setup status for my finance reconciliation MCP server.
```

OpenClaw should call `setup_get_status`.

Then ask:

```text
Suggest an account map for my SimpleFIN and Firefly accounts.
```

OpenClaw should call `setup_suggest_account_map`, then show you:

- confidence-scored account matches
- unmatched SimpleFIN accounts
- unmatched Firefly III accounts
- an `account_map_json_draft`

Review the draft. If it looks right, ask:

```text
Save this account map for finance reconciliation.
```

OpenClaw can call `setup_save_account_map` with:

```json
{
  "account_map": {
    "accounts": [
      {
        "simplefin_id": "simplefin-account-id",
        "simplefin_name": "CHASE TOTAL CHECKING (...1234)",
        "firefly_account_id": "7",
        "firefly_name": "Chase Checking"
      }
    ]
  },
  "overwrite": true,
  "confirm_write": true
}
```

`setup_save_account_map` only writes the local `account-map.json` config file. It never writes to Firefly III or SimpleFIN.

Then validate:

```text
Validate my saved finance reconciliation account map.
```

OpenClaw should call `setup_validate_account_map`.

Finally, reconcile:

```text
Find SimpleFIN transactions from the last 30 days that appear missing from Firefly.
```

OpenClaw should call `reconcile_find_missing_transactions` with:

```json
{
  "days": 30
}
```

## Configuration

Environment variables:

```env
SIMPLEFIN_ACCESS_URL=https://user:password@bridge.simplefin.org/simplefin
FIREFLY_BASE_URL=https://your-firefly.example.com
FIREFLY_PAT=your-personal-access-token
DEFAULT_LOOKBACK_DAYS=30
READONLY=true
# Optional. Defaults to the user config directory.
# ACCOUNT_MAPPING_FILE=/absolute/path/to/account-map.json
```

Notes:

- `READONLY=false` is rejected at startup.
- `SIMPLEFIN_ACCESS_URL` may be the SimpleFIN root Access URL or the `/accounts` URL.
- SimpleFIN Access URLs usually contain credentials. Keep the full URL; the server sends those credentials as an HTTP Basic Auth header internally.
- Do not commit `.env` or `account-map.json`.

## Get A SimpleFIN Access URL

Create a SimpleFIN token from [SimpleFIN Bridge](https://bridge.simplefin.org/simplefin/create). The token is not the Access URL; it is a base64-encoded claim URL. Decode it, then make a `POST` request to the decoded URL. The response body is the Access URL to use for `SIMPLEFIN_ACCESS_URL`.

Cross-platform Node.js command:

```sh
node -e "const token = process.argv[1]; const url = Buffer.from(token, 'base64').toString('utf8'); fetch(url, { method: 'POST' }).then(async (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); console.log(await r.text()); }).catch((e) => { console.error(e.message); process.exit(1); });" "PASTE_SIMPLEFIN_TOKEN_HERE"
```

PowerShell alternative:

```powershell
$token = "PASTE_SIMPLEFIN_TOKEN_HERE"
$claimUrl = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($token))
$accessUrl = Invoke-RestMethod -Method Post -Uri $claimUrl
$accessUrl
```

The result should look roughly like:

```text
https://user:password@bridge.simplefin.org/simplefin
```

Treat this URL like a secret. It contains read credentials for the SimpleFIN account feed.

## Firefly III Token

Create a Personal Access Token in Firefly III and set it as `FIREFLY_PAT`. The server only uses read endpoints, but you should still treat the token as a secret.

## Account Mapping

`account-map.json` connects SimpleFIN accounts to Firefly III accounts:

```json
{
  "accounts": [
    {
      "simplefin_id": "optional-simplefin-id",
      "simplefin_name": "CHASE TOTAL CHECKING (...1234)",
      "firefly_account_id": "7",
      "firefly_name": "Chase Checking"
    }
  ]
}
```

Use `simplefin_id` when you know it. If you omit it, the server falls back to an exact SimpleFIN account name match.

## Generic MCP Client Configuration

If your MCP client uses JSON config directly:

```json
{
  "mcpServers": {
    "finance-reconcile": {
      "command": "npx",
      "args": ["-y", "finance-reconcile-mcp@latest"],
      "env": {
        "SIMPLEFIN_ACCESS_URL": "https://user:password@bridge.simplefin.org/simplefin",
        "FIREFLY_BASE_URL": "https://your-firefly.example.com",
        "FIREFLY_PAT": "your-personal-access-token",
        "DEFAULT_LOOKBACK_DAYS": "30",
        "READONLY": "true"
      }
    }
  }
}
```

For a custom account-map path, add:

```json
{
  "ACCOUNT_MAPPING_FILE": "/absolute/path/to/account-map.json"
}
```

## Tools

Setup:

- `setup_get_status` shows configuration and account-map status.
- `setup_list_simplefin_accounts` lists SimpleFIN accounts for account mapping. It fetches balances only, not transactions.
- `setup_list_firefly_accounts` lists Firefly III asset/liability accounts for account mapping.
- `setup_suggest_account_map` suggests an `account-map.json` draft by comparing SimpleFIN and Firefly III account names, currencies, and balances.
- `setup_validate_account_map` validates an account-map object or the configured file, optionally checking live accounts.
- `setup_save_account_map` writes the local `account-map.json` config file after `confirm_write: true`. It does not mutate financial data.

Reconciliation:

- `reconcile_find_missing_transactions` compares mapped SimpleFIN and Firefly III transactions and returns SimpleFIN transactions that appear missing from Firefly III.
- `reconcile_check_stale_accounts` compares the latest transaction dates per mapped account.
- `reconcile_check_balance_mismatches` compares SimpleFIN balances with Firefly III account balances.

Firefly III audit helpers:

- `firefly_find_possible_duplicates` finds possible duplicate Firefly III transactions.
- `firefly_summarize_uncategorized` groups uncategorized Firefly III transactions and suggests category labels without applying them.

## Tool Examples

Find missing transactions over the default lookback window:

```json
{}
```

Find missing transactions over 30 days:

```json
{
  "days": 30
}
```

Find missing transactions for one mapped account:

```json
{
  "days": 30,
  "account": "Chase Checking"
}
```

Use a fixed date range:

```json
{
  "start_date": "2026-04-01",
  "end_date": "2026-04-30"
}
```

## From Source

Use this path for development or until the package is published to npm.

```sh
git clone <repo-url>
cd finance-reconcile-mcp
npm install
cp .env.example .env
npm run build
npm start
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

For a source checkout, you can point OpenClaw at the built file:

```sh
openclaw mcp set finance-reconcile '{
  "command": "node",
  "args": ["/absolute/path/to/finance-reconcile-mcp/dist/index.js"],
  "cwd": "/absolute/path/to/finance-reconcile-mcp",
  "env": {
    "SIMPLEFIN_ACCESS_URL": "https://user:password@bridge.simplefin.org/simplefin",
    "FIREFLY_BASE_URL": "https://firefly.example.com",
    "FIREFLY_PAT": "your-firefly-token",
    "READONLY": "true"
  }
}'
```

## Development

```sh
npm run dev
npm run typecheck
npm run build
```

`npm pack` and `npm publish` run `npm run build` automatically through the `prepack` script.

## Matching Design

Transactions are normalized into a shared internal type before matching. Account mapping is required. Matching uses a score from 0 to 1:

- signed amount exact match: high weight
- posted date proximity within plus or minus 2 days: high weight
- description similarity: medium weight
- shared external transaction ID: immediate high confidence

The server masks source account and transaction identifiers in returned JSON where possible and never logs secrets.

## Troubleshooting

### SimpleFIN URL Includes Credentials

SimpleFIN Access URLs usually look like `https://user:password@.../simplefin`. Keep that full URL in `SIMPLEFIN_ACCESS_URL`; the server strips the credentials from the request URL and sends them as an HTTP Basic Auth header. Do not manually remove the credentials unless your SimpleFIN provider has given you another authentication method.

### No Account Map Matches

Run `setup_suggest_account_map` again and compare the draft with `account-map.json`. If Firefly III account names changed, update `firefly_account_id` and `firefly_name`.

### Empty Missing Transaction Results

An empty result can mean Firefly III is up to date, the date range is too narrow, or the account map points at the wrong Firefly account. Try a wider range and verify the mapping with the setup tools.

## Security Model

- This server is designed to be read-only for financial systems.
- No Firefly III write endpoints are implemented.
- No SimpleFIN mutation endpoints exist in this project.
- `setup_save_account_map` only writes local config after explicit confirmation.
- Secrets are read from environment variables and are not logged intentionally.
- Returned account and transaction identifiers are masked where possible.

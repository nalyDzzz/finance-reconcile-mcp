# finance-reconcile-mcp

Read-only [Model Context Protocol](https://modelcontextprotocol.io/) server for reconciling [SimpleFIN Bridge](https://www.simplefin.org/protocol.html) bank data against a [Firefly III](https://docs.firefly-iii.org/references/firefly-iii/api/) ledger.

This project is for audit and reconciliation workflows. It does not create, edit, delete, categorize, merge, import, or otherwise mutate financial data in Firefly III.

## Status

Early MVP. The server is useful for local reconciliation experiments, but matching heuristics and account mapping should be reviewed before trusting the output.

## Features

- Read-only SimpleFIN and Firefly III connectors
- Setup tools for discovering accounts and drafting `account-map.json`
- Missing transaction detection across mapped accounts
- Stale account and balance mismatch checks
- Duplicate transaction detection in Firefly III
- Uncategorized transaction summaries with suggested category labels
- Compact JSON responses designed for AI agents and MCP clients

## Requirements

- Node.js 20 or newer
- A SimpleFIN Access URL
- A Firefly III Personal Access Token

## Quick Start

```sh
git clone <repo-url>
cd finance-reconcile-mcp
npm install
cp .env.example .env
cp account-map.example.json account-map.json
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item account-map.example.json account-map.json
```

Edit `.env`, then build:

```sh
npm run build
```

Add the server to your MCP client, start it, then run `setup_suggest_account_map` to generate a draft account map.

## Configuration

Set these environment variables:

```env
SIMPLEFIN_ACCESS_URL=https://user:password@bridge.simplefin.org/simplefin
FIREFLY_BASE_URL=https://your-firefly.example.com
FIREFLY_PAT=your-personal-access-token
DEFAULT_LOOKBACK_DAYS=30
READONLY=true
ACCOUNT_MAPPING_FILE=./account-map.json
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

### Easier Setup With MCP Inspector

After configuring `SIMPLEFIN_ACCESS_URL`, `FIREFLY_BASE_URL`, and `FIREFLY_PAT`, use these tools in MCP Inspector:

1. Run `setup_suggest_account_map`.
2. Review `suggestions`, especially low-confidence matches and unmatched accounts.
3. Put the returned `account_map_json_draft` into `account-map.json`.
4. Restart the MCP server if your client does not reload environment/files automatically.
5. Run `reconcile_find_missing_transactions` with `{ "days": 30 }`.

If the suggestions look wrong, use `setup_list_simplefin_accounts` and `setup_list_firefly_accounts` to inspect both sides directly and edit `account-map.json`.

The setup tools are read-only. They do not write `account-map.json` and do not modify Firefly III.

## MCP Client Configuration

Example config after running `npm run build`:

```json
{
  "mcpServers": {
    "finance-reconcile": {
      "command": "node",
      "args": ["/absolute/path/to/finance-reconcile-mcp/dist/index.js"],
      "env": {
        "SIMPLEFIN_ACCESS_URL": "https://user:password@bridge.simplefin.org/simplefin",
        "FIREFLY_BASE_URL": "https://your-firefly.example.com",
        "FIREFLY_PAT": "your-personal-access-token",
        "DEFAULT_LOOKBACK_DAYS": "30",
        "READONLY": "true",
        "ACCOUNT_MAPPING_FILE": "/absolute/path/to/finance-reconcile-mcp/account-map.json"
      }
    }
  }
}
```

On Windows, use an absolute path such as `C:/Users/you/code/finance-reconcile-mcp/dist/index.js`.

## Tools

Setup:

- `setup_list_simplefin_accounts` lists SimpleFIN accounts for account mapping. It fetches balances only, not transactions.
- `setup_list_firefly_accounts` lists Firefly III asset/liability accounts for account mapping.
- `setup_suggest_account_map` suggests an `account-map.json` draft by comparing SimpleFIN and Firefly III account names, currencies, and balances.

Reconciliation:

- `reconcile_find_missing_transactions` compares mapped SimpleFIN and Firefly III transactions and returns SimpleFIN transactions that appear missing from Firefly III.
- `reconcile_check_stale_accounts` compares the latest transaction dates per mapped account.
- `reconcile_check_balance_mismatches` compares SimpleFIN balances with Firefly III account balances.

Firefly III audit helpers:

- `firefly_find_possible_duplicates` finds possible duplicate Firefly III transactions.
- `firefly_summarize_uncategorized` groups uncategorized Firefly III transactions and suggests category labels without applying them.

All tools return compact JSON and are annotated with MCP read-only hints.

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

## Matching Design

Transactions are normalized into a shared internal type before matching. Account mapping is required. Matching uses a score from 0 to 1:

- signed amount exact match: high weight
- posted date proximity within plus or minus 2 days: high weight
- description similarity: medium weight
- shared external transaction ID: immediate high confidence

The server masks source account and transaction identifiers in returned JSON where possible and never logs secrets.

## Development

```sh
npm run dev
```

The server speaks MCP over stdio, so it should be launched by an MCP client rather than opened in a browser.

## Build

```sh
npm run build
npm start
```

## Troubleshooting

### SimpleFIN URL Includes Credentials

SimpleFIN Access URLs usually look like `https://user:password@.../simplefin`. Keep that full URL in `SIMPLEFIN_ACCESS_URL`; the server strips the credentials from the request URL and sends them as an HTTP Basic Auth header. Do not manually remove the credentials unless your SimpleFIN provider has given you another authentication method.

### No Account Map Matches

Run `setup_suggest_account_map` again and compare the draft with `account-map.json`. If Firefly III account names changed, update `firefly_account_id` and `firefly_name`.

### Empty Missing Transaction Results

An empty result can mean Firefly III is up to date, the date range is too narrow, or the account map points at the wrong Firefly account. Try a wider range and verify the mapping with the setup tools.

## Security Model

- This server is designed to be read-only.
- No Firefly III write endpoints are implemented.
- No SimpleFIN mutation endpoints exist in this project.
- Secrets are read from environment variables and are not logged intentionally.
- Returned account and transaction identifiers are masked where possible.

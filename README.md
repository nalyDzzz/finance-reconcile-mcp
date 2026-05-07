# finance-reconcile-mcp

Read-only Model Context Protocol server for reconciling [SimpleFIN Bridge](https://www.simplefin.org/protocol.html) bank data against a [Firefly III](https://docs.firefly-iii.org/references/firefly-iii/api/) ledger.

This server is intentionally audit-only. It does not create, edit, delete, categorize, merge, import, or mutate Firefly III data.

## Tools

- `reconcile_find_missing_transactions` compares mapped SimpleFIN and Firefly III transactions and returns SimpleFIN transactions that appear missing from Firefly III.
- `reconcile_check_stale_accounts` compares the latest transaction dates per mapped account.
- `reconcile_check_balance_mismatches` compares SimpleFIN balances with Firefly III account balances.
- `firefly_find_possible_duplicates` finds possible duplicate Firefly III transactions.
- `firefly_summarize_uncategorized` groups uncategorized Firefly III transactions and suggests category labels without applying them.

All tools return compact, agent-friendly JSON and are annotated with MCP read-only hints.

## Requirements

- Node.js 20 or newer
- A SimpleFIN Access URL
- A Firefly III Personal Access Token

## Get A SimpleFIN Access URL

Create a SimpleFIN token from [SimpleFIN Bridge](https://bridge.simplefin.org/simplefin/create). The token is not the Access URL; it is a base64-encoded claim URL. Decode it, then make a `POST` request to the decoded URL. The response body is the Access URL to use for `SIMPLEFIN_ACCESS_URL`.

PowerShell:

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

## Install

```bash
npm install
```

## Configure

Copy the example environment file:

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Set:

```bash
SIMPLEFIN_ACCESS_URL=https://user:password@bridge.simplefin.org/simplefin
FIREFLY_BASE_URL=https://your-firefly.example.com
FIREFLY_PAT=your-personal-access-token
DEFAULT_LOOKBACK_DAYS=30
READONLY=true
ACCOUNT_MAPPING_FILE=./account-map.json
```

`READONLY=false` is rejected at startup.
`SIMPLEFIN_ACCESS_URL` may be the SimpleFIN root access URL or the `/accounts` URL.

## Account Mapping

Create `account-map.json` from `account-map.example.json`:

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

## Development

```bash
npm run dev
```

The server speaks MCP over stdio, so it should be launched by an MCP client rather than opened in a browser.

## Build

```bash
npm run build
npm start
```

## MCP Client Config

Example client entry:

```json
{
  "mcpServers": {
    "finance-reconcile": {
      "command": "node",
      "args": ["F:/Code/finance-mcp/finance-reconcile-mcp/dist/index.js"],
      "env": {
        "SIMPLEFIN_ACCESS_URL": "https://user:password@bridge.simplefin.org/simplefin",
        "FIREFLY_BASE_URL": "https://your-firefly.example.com",
        "FIREFLY_PAT": "your-personal-access-token",
        "DEFAULT_LOOKBACK_DAYS": "30",
        "READONLY": "true",
        "ACCOUNT_MAPPING_FILE": "F:/Code/finance-mcp/finance-reconcile-mcp/account-map.json"
      }
    }
  }
}
```

## Matching Design

Transactions are normalized into a shared internal type before matching. Account mapping is required. Matching uses a score from 0 to 1:

- signed amount exact match: high weight
- posted date proximity within plus or minus 2 days: high weight
- description similarity: medium weight
- shared external transaction ID: immediate high confidence

The server masks source account and transaction identifiers in returned JSON where possible and never logs secrets.

# finance-reconcile-mcp

Read-only Model Context Protocol server for reconciling [SimpleFIN Bridge](https://www.simplefin.org/protocol.html) bank data against a [Firefly III](https://docs.firefly-iii.org/references/firefly-iii/api/) ledger.

This server is intentionally audit-only. It does not create, edit, delete, categorize, merge, import, or mutate Firefly III data.

## Tools

- `setup_list_simplefin_accounts` lists SimpleFIN accounts for account mapping. It fetches balances only, not transactions.
- `setup_list_firefly_accounts` lists Firefly III asset/liability accounts for account mapping.
- `setup_suggest_account_map` suggests an `account-map.json` draft by comparing SimpleFIN and Firefly III account names, currencies, and balances.
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
The server accepts the credentialed Access URL from SimpleFIN and sends those credentials as an HTTP Basic Auth header internally.

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

### Easier Setup With MCP Inspector

After configuring `SIMPLEFIN_ACCESS_URL`, `FIREFLY_BASE_URL`, and `FIREFLY_PAT`, use these tools in MCP Inspector:

1. Run `setup_suggest_account_map`.
2. Review `suggestions`, especially low confidence matches and unmatched accounts.
3. Put the returned `account_map_json_draft` into `account-map.json`.
4. Run `reconcile_find_missing_transactions` with `{ "days": 30 }`.

If the suggestions look wrong, use `setup_list_simplefin_accounts` and `setup_list_firefly_accounts` to inspect both sides directly and edit `account-map.json` by hand.

The setup tools are also read-only. They do not write `account-map.json` and do not modify Firefly III.

## Troubleshooting

### SimpleFIN URL Includes Credentials

SimpleFIN Access URLs usually look like `https://user:password@.../simplefin`. Keep that full URL in `SIMPLEFIN_ACCESS_URL`; the server strips the credentials from the request URL and sends them as an HTTP Basic Auth header. Do not manually remove the credentials unless your SimpleFIN provider has given you another authentication method.

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

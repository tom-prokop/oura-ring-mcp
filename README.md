# Oura MCP Server

[![npm version](https://img.shields.io/npm/v/oura-ring-mcp.svg)](https://www.npmjs.com/package/oura-ring-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![CI](https://github.com/mitchhankins01/oura-ring-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mitchhankins01/oura-ring-mcp/actions/workflows/ci.yml)

An MCP server that connects your Oura Ring to Claude and other AI assistants. Get human-readable insights about your sleep, readiness, and activity—not just raw JSON.

## Features

<img src="docs/outputs/demo.gif" width="500" alt="Demo">

- **Smart formatting** - Durations in hours/minutes, scores with context ("85 - Optimal")
- **Sleep analysis** - Sleep stages, efficiency, HRV, and biometrics
- **Readiness tracking** - Recovery scores and contributor breakdown
- **Activity data** - Steps, calories, and intensity breakdown
- **Health metrics** - Heart rate, SpO2, stress, cardiovascular age
- **Smart analysis** - Anomaly detection, correlations, trend analysis
- **Tags support** - Compare metrics with/without conditions

[See example outputs](docs/outputs/EXAMPLES.md) — what Claude returns for sleep, readiness, weekly summaries, and smart analysis

## Quick Start

### 1. Install

```bash
npm install -g oura-ring-mcp
```

Or use directly with npx (no install needed):
```bash
npx oura-ring-mcp
```

### 2. Authenticate with Oura (OAuth)

Oura stopped issuing personal access tokens in December 2025, so new users need OAuth.

1. Create an OAuth app at [developer.ouraring.com/applications](https://developer.ouraring.com/applications)
   - Set the Redirect URI to `http://localhost:3000/callback`
2. Run the auth flow:
   ```bash
   export OURA_CLIENT_ID=your_client_id
   export OURA_CLIENT_SECRET=your_client_secret
   npx oura-ring-mcp auth
   ```
3. Credentials are saved to `~/.oura-mcp/credentials.json` (mode 600).

### 3. Configure Claude Desktop

Add to `claude_desktop_config.json`. Include your OAuth app credentials so the server can refresh tokens on its own (Oura access tokens are short-lived and each refresh rotates the refresh token; the server saves the new one every time):

```json
{
  "mcpServers": {
    "oura": {
      "command": "npx",
      "args": ["oura-ring-mcp"],
      "env": {
        "OURA_CLIENT_ID": "your_client_id",
        "OURA_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

Restart Claude Desktop. Requires Node >=18.

<details>
<summary>Legacy: personal access token (deprecated)</summary>

If you still have a personal access token created before December 2025 it may keep working. Set it as `OURA_ACCESS_TOKEN` instead of the OAuth variables:

```json
{
  "mcpServers": {
    "oura": {
      "command": "npx",
      "args": ["oura-ring-mcp"],
      "env": { "OURA_ACCESS_TOKEN": "your_token_here" }
    }
  }
}
```

New tokens can no longer be created, and `OURA_ACCESS_TOKEN` takes precedence over stored OAuth credentials if both are set.
</details>

## What Can I Ask?

**Daily check-ins:**
- "How did I sleep last night?"
- "Am I recovered enough to work out today?"
- "What's my body telling me right now?"

**Patterns & trends:**
- "Do I sleep better on weekends?"
- "What time should I go to bed for optimal sleep?"
- "Is my HRV improving or declining?"

**Correlations & insights:**
- "Does alcohol affect my sleep quality?"
- "What predicts my best sleep nights?"
- "How does exercise timing affect my recovery?"

**Comparisons:**
- "Compare my sleep this week vs last week"
- "How do I sleep after meditation vs without?"
- "What changed when I started taking magnesium?"

**Anomalies:**
- "Are there any unusual readings in my data?"
- "Why was my readiness so low yesterday?"
- "Find days where my metrics were off"

## Available Tools

### Data Retrieval

| Tool | Description |
|------|-------------|
| `get_data_coverage` | Preflight check for which Oura data domains are available, sparse, missing, or errored |
| `get_sleep` | Sleep data with stages, efficiency, HR, HRV |
| `get_daily_sleep` | Daily sleep scores with contributors |
| `get_readiness` | Readiness scores and recovery metrics |
| `get_resilience` | Stress recovery capacity and resilience contributors |
| `get_sleep_time` | Personalized bedtime recommendations |
| `get_rest_mode` | Rest mode periods for illness or recovery |
| `get_activity` | Steps, calories, intensity breakdown |
| `get_workouts` | Workout sessions with type and intensity |
| `get_vo2_max` | Cardiorespiratory fitness measurements |
| `get_sessions` | Meditation and relaxation sessions |
| `get_heart_rate` | HR readings throughout the day |
| `get_stress` | Stress levels and recovery time |
| `get_spo2` | Blood oxygen and breathing disturbance |
| `get_cardiovascular_age` | Estimated vascular age from heart health |
| `get_tags` | User-created tags and notes |
| `get_enhanced_tags` | Rich tags with names, types, and time ranges |
| `get_personal_info` | Profile details used for Oura insights |
| `get_ring_info` | Ring hardware and firmware details |
| `get_ring_battery` | Latest ring battery level, or per-day battery for a range |

### Smart Analysis

| Tool | Description |
|------|-------------|
| `detect_anomalies` | Find unusual readings using outlier detection |
| `analyze_sleep_quality` | Sleep analysis with trends, patterns, debt |
| `correlate_metrics` | Find correlations between health metrics |
| `compare_periods` | Compare this week vs last week |
| `compare_conditions` | Compare metrics with/without a tag |
| `best_sleep_conditions` | What predicts your good vs poor sleep |
| `analyze_hrv_trend` | HRV trend with rolling averages |
| `analyze_adherence` | Ring wear consistency and data gaps |
| `analyze_temperature` | Body temperature patterns and unusual readings |

## Resources

| Resource | Description |
|----------|-------------|
| `oura://today` | Today's health summary |
| `oura://weekly-summary` | Last 7 days with averages |
| `oura://baseline` | Your 30-day averages and normal ranges |
| `oura://monthly-insights` | 30-day analysis with trends and anomalies |
| `oura://tag-summary` | Your tags and usage frequency |
| `oura://streaks` | Current and best streaks for sleep, readiness and steps |
| `oura://weekly-report` | Weekly report with comparisons and recommendations |

## Prompts

| Prompt | Description |
|--------|-------------|
| `weekly-review` | Comprehensive weekly health review |
| `sleep-optimization` | Identify what leads to your best sleep |
| `recovery-check` | Should you train hard or rest today? |
| `compare-weeks` | This week vs last week comparison |
| `tag-analysis` | How a specific tag affects your health |

## Remote Server on Cloudflare (ChatGPT, Claude.ai)

`src/worker/` is a Cloudflare Worker that serves the same tools, resources and prompts over Streamable HTTP at `/mcp`, so you can use your Oura data from ChatGPT and Claude.ai (web and mobile). It is meant for **one person's** data:

- **Sign-in:** the Worker is an OAuth 2.1 server for MCP clients ([`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider): dynamic client registration for Claude.ai, Client ID Metadata Documents for ChatGPT, PKCE) and uses Oura as the identity provider. You see a consent page, then sign in with Oura.
- **Allowlist (on by default):** only the Oura account set in `ALLOWED_OURA_USER_ID` and/or `ALLOWED_OURA_EMAIL` can finish sign-in. With neither set, every account is refused (the refusal page shows your own Oura id so you can set it). Set the var `ALLOW_ANY_OURA_USER=true` only if you really want a multi-user server.
- **Tokens:** Oura tokens are stored in the grant's encrypted props in KV. MCP access tokens last at most 1 hour and never outlive the Oura token; when a client refreshes, the Worker refreshes Oura if needed and saves Oura's rotated refresh token. If Oura rejects the refresh token (you revoked access), the MCP grant is revoked and the client asks you to reconnect.
- **Stateless:** each `/mcp` request builds a fresh server and Oura client for that grant (no Durable Objects).

### Paths the Worker serves

| Path | Purpose |
|------|---------|
| `/mcp` | MCP endpoint (Streamable HTTP, Bearer token required) |
| `/oauth/authorize` | Consent page (GET) and approval (POST) |
| `/oauth/token` | Token, refresh and revocation endpoint |
| `/oauth/register` | Dynamic client registration |
| `/oura/callback` | Oura OAuth redirect |
| `/.well-known/oauth-authorization-server` | Authorization server metadata (RFC 8414) |
| `/.well-known/oauth-protected-resource/mcp` | Protected resource metadata (RFC 9728) |

Everything else returns 404, so the Worker can sit behind another site's domain (see below).

### 1. Create an Oura OAuth app

1. Go to [developer.ouraring.com/applications](https://developer.ouraring.com/applications) and create an application (or reuse one you own).
2. Set the **Redirect URI** to `https://<your-host>/oura/callback` (for example `https://oura-mcp.example.com/oura/callback`).
3. Allow these scopes: `email personal daily heartrate workout tag session spo2 ring_configuration stress heart_health`. Override the requested list with the `OURA_SCOPES` var if your app has fewer.
4. Note the client ID and secret. Unapproved Oura apps are limited to 10 users, which is plenty here.

### 2. Configure and deploy

```bash
pnpm install
npx wrangler login

# In wrangler.jsonc: set account_id and PUBLIC_BASE_URL (https://<your-host>, no trailing slash)

# Secrets (wrangler prompts for each value; never put them in files or command lines)
npx wrangler secret put OURA_CLIENT_ID
npx wrangler secret put OURA_CLIENT_SECRET
npx wrangler secret put ALLOWED_OURA_USER_ID     # and/or ALLOWED_OURA_EMAIL

npx wrangler deploy        # creates the OAUTH_KV namespace on first deploy
```

Routing: `wrangler.jsonc` ships with `workers_dev: false` and no routes because this fork is served through a service binding from another Worker on `dixi.lulolabs.co`. For a standalone deployment add a custom domain instead, e.g. `"routes": [{ "pattern": "oura-mcp.example.com", "custom_domain": true }]`, and set `PUBLIC_BASE_URL` to match. If you front it with another Worker, forward exactly the paths above, unchanged, to this Worker's service binding.

Don't know your Oura user id yet? Deploy without `ALLOWED_OURA_*`, connect once: the refusal page shows your id, then set the secret and connect again.

### 3. Connect from ChatGPT

1. ChatGPT → **Settings → Apps & Connectors → Advanced settings**, enable **Developer mode**.
2. **Create** a connector: name it "Oura", set the MCP server URL to `https://<your-host>/mcp`, authentication **OAuth**, and leave client ID/secret empty.
3. Accept the consent page, sign in with Oura, and the tools appear in chats where the connector is enabled.

### 4. Connect from Claude.ai

1. Claude.ai → **Settings → Connectors → Add custom connector**.
2. URL: `https://<your-host>/mcp`. Leave the OAuth client ID/secret empty (dynamic registration handles it).
3. Click **Connect**, approve, and sign in with Oura.

### Local development

```bash
cp .dev.vars.example .dev.vars   # gitignored; PUBLIC_BASE_URL=http://localhost:8787
pnpm dev:worker                  # wrangler dev on http://localhost:8787
curl http://localhost:8787/.well-known/oauth-authorization-server
curl -i -X POST http://localhost:8787/mcp   # 401 with a WWW-Authenticate discovery challenge
pnpm test:worker                 # Worker tests inside workerd
```

A full local sign-in needs an Oura app whose redirect URI is `http://localhost:8787/oura/callback`.

## Contributing

See [CLAUDE.md](CLAUDE.md) for architecture details and development guidelines.

## Credits

Created by [Mitch Hankins](https://github.com/mitchhankins01/oura-ring-mcp). This fork adds the Cloudflare Worker remote server, OAuth token rotation fixes and MCP SDK v2, and includes upstream community PRs #5, #7, #8, #9 and #10.

## License

MIT

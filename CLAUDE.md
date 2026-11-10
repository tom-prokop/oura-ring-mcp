# Oura MCP Server

An MCP (Model Context Protocol) server that exposes Oura Ring health data to LLMs like Claude. Built for learning MCP development while creating something genuinely useful.

## Project Goals

1. **Learn MCP** - Understand how tools, resources, and prompts work
2. **Improve on existing implementations** - Most Oura MCPs just dump raw JSON; ours provides human-readable summaries
3. **Ship something worth starring** - Clean code, great README, published to npm

## Architecture

```
src/
├── index.ts           # Local entry point (stdio transport, CLI subcommands)
├── server.ts          # Shared createOuraMcpServer() used by stdio AND the Worker
├── client.ts          # Oura API client (thin wrapper, runtime-neutral)
├── tools/
│   ├── index.ts       # Tool definitions and handlers
│   └── structured.ts  # outputSchema + structuredContent for sleep/readiness/activity/HR
├── resources/
│   └── index.ts       # MCP resources (oura://today, oura://weekly-summary)
├── prompts/
│   └── index.ts       # MCP prompt templates for common analysis tasks
├── auth/              # Local (Node) authentication
│   ├── cli.ts         # `npx oura-ring-mcp auth` command
│   ├── oura-oauth.ts  # Runtime-neutral Oura OAuth (authorize URL, code, refresh, revoke) — shared with Worker
│   ├── oauth.ts       # Node wrapper: env config + persists rotated credentials
│   ├── token-manager.ts # Single-flight on-demand refresh for the stdio process
│   └── store.ts       # Token storage (~/.oura-mcp/credentials.json)
├── worker/            # Cloudflare Worker remote server (see "Remote Deployment")
│   ├── index.ts       # Entry: OAuthProvider + strips CORS from /mcp
│   ├── provider.ts    # OAuthProvider config + stateless createMcpHandler
│   ├── auth-handler.ts# /oauth/authorize (consent) and /oura/callback (allowlist, completeAuthorization)
│   ├── grant.ts       # Grant props + tokenExchangeCallback (Oura refresh/rotation)
│   ├── allowlist.ts   # ALLOWED_OURA_USER_ID / ALLOWED_OURA_EMAIL check
│   ├── html.ts        # Escaped consent/error pages
│   └── config.ts      # Env type, paths, PUBLIC_BASE_URL handling
└── utils/
    ├── formatters.ts  # Human-readable formatting (seconds→hours, etc.)
    ├── errors.ts      # Custom error types and user-friendly messages
    └── analysis.ts    # Statistical analysis (trends, outliers, correlation)

scripts/
└── validate-fixtures.ts  # Compare test fixtures against real Oura API
```

## Current Tools (29 available)

- `get_data_coverage` - Compact cross-endpoint availability check to decide which deeper tools are worth calling

**Sleep & Recovery:**
- `get_sleep` - Complete sleep data: score + detailed sessions (stages, efficiency, HR, HRV)
- `get_daily_sleep` - Daily sleep scores with contributors only (use `get_sleep` for full data)
- `get_readiness` - Daily readiness scores and recovery metrics
- `get_resilience` - Body's capacity to recover from stress
- `get_sleep_time` - Oura's personalized bedtime recommendations
- `get_rest_mode` - Rest mode periods (illness/recovery tracking)

**Activity & Fitness:**
- `get_activity` - Daily activity, steps, calories, intensity breakdown
- `get_workouts` - Workout sessions with type, duration, intensity
- `get_vo2_max` - Cardiorespiratory fitness measurements
- `get_sessions` - Meditation, breathing, and relaxation sessions

**Health Metrics:**
- `get_stress` - Stress levels and recovery time
- `get_heart_rate` - Individual HR readings throughout the day
- `get_spo2` - Blood oxygen saturation and breathing disturbance
- `get_cardiovascular_age` - Estimated vascular age based on heart health

**User Data:**
- `get_tags` - User-created tags and notes (simple format)
- `get_enhanced_tags` - Rich tags with custom names, types, and time ranges
- `get_personal_info` - User profile (age, weight, height, biological sex)
- `get_ring_info` - Ring hardware info (color, firmware, size)
- `get_ring_battery` - Latest ring battery level or per-day battery for a range (`/ring_battery_level`, spec 1.43)

All tools carry `title` + annotations (`readOnlyHint`, `idempotentHint`, `openWorldHint` true; `destructiveHint` false). `get_sleep`, `get_readiness`, `get_activity`, `get_heart_rate` also declare `outputSchema` and return `structuredContent` (see `src/tools/structured.ts`); the rest return text only.

**Smart Analysis (Phase 3):**
- `detect_anomalies` - Find unusual readings using IQR + Z-score outlier detection
- `analyze_sleep_quality` - Comprehensive sleep analysis: trends, patterns, debt, regularity
- `correlate_metrics` - Find correlations between any two metrics with p-value
- `compare_periods` - Compare metrics between two time periods (e.g., this week vs last week)
- `compare_conditions` - Compare metrics with/without conditions. Supports manual tags AND auto-tracked: 'workout', 'high_activity', 'low_activity', 'meditation'
- `best_sleep_conditions` - Identify what conditions predict good vs poor sleep (activity, workouts, meditation sessions, tags)
- `analyze_hrv_trend` - HRV trend analysis with rolling averages and recovery patterns
- `analyze_adherence` - Track ring wear consistency and identify data gaps
- `analyze_temperature` - Body temperature patterns (illness detection, cycles)

## MCP Resources

- **`oura://today`** - Today's health summary
  - Fetches: `/daily_sleep`, `/sleep`, `/daily_readiness`, `/daily_activity`, `/daily_stress`
  - Combines sleep score (from daily_sleep) with detailed session data (from sleep)
  - Picks the main (longest) sleep session when multiple exist

- **`oura://weekly-summary`** - Last 7 days summary with averages
  - Fetches: `/daily_sleep`, `/sleep`, `/daily_readiness`, `/daily_activity`
  - Shows score averages, best/worst days, sleep duration averages, HRV averages
  - Groups sleep sessions by day, picks main session for duration calculations

- **`oura://baseline`** - Personal 30-day averages and normal ranges
  - Fetches: `/sleep`, `/daily_readiness`, `/daily_activity`
  - Uses `dispersion()` for statistics and `detectOutliers()` for normal ranges
  - Helps Claude understand what's "normal" for this user

- **`oura://monthly-insights`** - Comprehensive 30-day analysis
  - Fetches: `/sleep`, `/daily_readiness`, `/daily_activity`
  - Uses analysis utilities: `sleepDebt()`, `sleepRegularity()`, `dayOfWeekAnalysis()`, `trend()`, `detectOutliers()`
  - Generates actionable insights about patterns, anomalies, and trends

- **`oura://tag-summary`** - User's tags and usage frequency (90 days)
  - Fetches: `/enhanced_tag`, `/tag`
  - Shows all tags with usage count and last used date
  - Helps Claude know what tags are available before using `compare_conditions` tool

- **`oura://streaks`** - Current and best streaks for health goals (90 days)
  - Fetches: `/daily_sleep`, `/daily_readiness`, `/daily_activity`
  - Tracks consecutive days of optimal sleep (85+), readiness (85+), 10k steps, activity score (85+)
  - Shows current streak and all-time best for each metric

- **`oura://weekly-report`** - Comprehensive weekly health report with recommendations
  - Fetches: `/daily_sleep`, `/sleep`, `/daily_readiness`, `/daily_activity` (this week + last week)
  - Compares metrics to previous week, identifies highlights and concerns
  - Generates personalized recommendations based on your data

## MCP Prompts (7 available)

Pre-defined templates that guide Claude through common health analysis tasks:

- **`weekly-review`** - Comprehensive review of sleep, readiness, and activity from the past week
- **`sleep-optimization`** - Analyze 30 days of sleep to identify what leads to best sleep
- **`recovery-check`** - Check if you're recovered enough to train hard or should rest
- **`compare-weeks`** - Compare this week vs last week across all metrics
- **`tag-analysis`** - Analyze how a specific tag/condition affects your health (takes `tag` argument)
- **`monthly-trends`** - 30-day trend analysis with correlations and anomaly detection
- **`quick-status`** - Brief daily status check for quick decisions

## Notes

- When using cURL, load the token in .env
- Oura stopped issuing personal access tokens in Dec 2025; OAuth is the primary path. `OURA_ACCESS_TOKEN` still works for old PATs.
- Oura refresh tokens are single-use: always persist the new one (stdio: `refreshAccessToken` saves; Worker: `tokenExchangeCallback` returns `newProps`).
- MCP SDK is v2 (`@modelcontextprotocol/server` 2.4.0, the exact version `agents` requires). Tests use `@modelcontextprotocol/client`.
- Data syncs when user opens Oura app - "no data" often means ring hasn't synced
- Sleep data is attributed to the day you woke up, not when you fell asleep
- Use Zod for API response validation—define schema once, get types with `z.infer<typeof schema>`
- Once work has been completed, update CLAUDE.MD accordingly. Conversely, if more work needs to be done at it as well.

## Development Phases & Roadmap

### Phase 1: Core Foundation ✅
- [x] MCP server setup with stdio transport
- [x] Oura API client with TypeScript types
- [x] Core tools: sleep, readiness, activity
- [x] Human-readable formatters
- [x] Basic error handling

### Phase 2: Expand Coverage ✅
- [x] All Oura endpoints: workouts, sessions, stress, SpO2, HR, etc.
- [x] Enhanced tags support
- [x] MCP resources: today, weekly-summary, baseline, monthly-insights
- [x] User/ring info endpoints

### Phase 3: Make It Smart ✅
- [x] Statistical analysis utilities (mean, std, correlation, trend)
- [x] Outlier detection (IQR + Z-score)
- [x] Smart tools: anomaly detection, sleep quality analysis, correlations
- [x] Period and condition comparison tools
- [x] HRV trend analysis
- [x] MCP prompts for common analysis tasks
- [x] Tag summary resource
- [x] Streaks and weekly report resources

### Phase 4a: Ship It - Local ✅
- [x] OAuth CLI flow (`npx oura-ring-mcp auth`)
- [x] Token storage (~/.oura-mcp/credentials.json)
- [x] Auto-refresh for expired tokens
- [x] `status` and `logout` commands
- [x] npm publish (oura-ring-mcp)
- [x] MCP Registry submission
- [x] Demo GIF and examples

### Phase 4b: Remote Access ✅
- [x] HTTP transport with Streamable HTTP (blocker for remote use)
- [x] Railway deployment config (Dockerfile, railway.json, .dockerignore, README docs)
- [x] Deploy to Railway (PAT env var for auth)
- [x] MCP OAuth 2.1 server provider (enables Claude.ai connector auth)
  - Proxies OAuth through Oura (user authenticates with their Oura account)
  - Dynamic client registration (RFC 7591) + PKCE (S256)
  - `/authorize` → Oura OAuth → `/oauth/callback` → client redirect
  - In-memory MCP token store (access + refresh tokens)
  - Backward-compatible with MCP_SECRET bearer auth
- [x] Deploy OAuth update to Railway and test with Claude.ai connector
  - MCP endpoint at root `/` (Claude.ai expects `/.well-known/oauth-protected-resource` without path suffix)
  - Also supports `/mcp` for backward compatibility
- [x] Replaced Express/Railway with a Cloudflare Worker (Phase 4c)

### Phase 4c: Cloudflare Worker ✅ (fork)
- [x] Stateless `/mcp` via `agents` `createMcpHandler` + MCP SDK v2
- [x] `@cloudflare/workers-oauth-provider` (DCR + CIMD + PKCE), Oura as upstream IdP
- [x] Oura tokens in encrypted grant props; refresh + rotation in `tokenExchangeCallback`
- [x] Single-user allowlist, consent page, CORS stripped from `/mcp`
- [x] Worker tests in workerd (`@cloudflare/vitest-plugin`)
- [ ] First real deploy + ChatGPT/Claude.ai connection (needs Oura app credentials)

### Phase 5: Advanced Analytics & Integrations (Future)
- [ ] Advanced HRV analysis (frequency domain: VLF, LF, HF, LF/HF ratio)
- [ ] Poincaré plot metrics (SD1, SD2) for HRV non-linear analysis
- [ ] Chart-ready data structures for visualization suggestions
- [ ] Proactive health alerts based on anomaly detection
- [ ] Integration with other health data sources (Apple Health, Fitbit, Garmin)
- [ ] Predictive insights (e.g., illness prediction from temperature trends)

**Current status:** Phase 4c built (Cloudflare Worker, not yet deployed). 29 tools, 7 resources, 7 prompts, 397 tests (368 node + 29 worker).

## Key Files

- `src/index.ts` - MCP server entry point with CLI subcommand handling
- `src/client.ts` - Oura API client with TypeScript types
- `src/tools/index.ts` - Tool definitions (schemas) and handlers
- `src/auth/cli.ts` - OAuth CLI flow (auth, logout, status commands)
- `src/auth/oauth.ts` - OAuth2 helpers (authorization URL, token exchange, refresh)
- `src/auth/store.ts` - Credential storage (~/.oura-mcp/credentials.json)
- `src/utils/formatters.ts` - Convert seconds to hours, format scores, etc.
- `src/utils/analysis.ts` - Statistical analysis utilities (Phase 3 foundation)
- `src/utils/dataCoverage.ts` - Helper logic for cross-endpoint data coverage summaries
- `src/server.ts` - Shared server factory (stdio + Worker)
- `src/worker/*` - Cloudflare Worker remote server
- `wrangler.jsonc` - Worker config (`PUBLIC_BASE_URL`, `OAUTH_KV`, flags `nodejs_compat` + `global_fetch_strictly_public`)
- `scripts/validate-fixtures.ts` - Validate test fixtures against real Oura API
- `docs/RESEARCH.md` - **Competitive analysis, derived metrics formulas, Phase 3 inspiration**

## Analysis Utilities (`src/utils/analysis.ts`)

Phase 3 foundation for smart tools. All functions are pure, well-tested (66 tests), and inspired by the Wearipedia notebook.

**Basic Statistics:**
- `mean`, `standardDeviation`, `sampleStandardDeviation`, `quantile`, `min`, `max`

**Rolling Averages:**
- `rollingAverages(values)` → 7/14/30-day averages with counts
- `rollingAverage(values, window)` → custom window

**Trend Detection:**
- `trend(values)` → slope, r-value, p-value, direction ("improving"/"declining"/"stable")

**Outlier Detection:**
- `detectOutliersIQR(values, multiplier?)` → IQR method (default 1.5x)
- `detectOutliersZScore(values, threshold?)` → Z-score method (default ±2)
- `detectOutliers(values)` → combined (flags only if both methods agree)

**Correlation:**
- `correlate(x, y)` → Pearson r, p-value, strength ("none"/"weak"/"moderate"/"strong")

**Dispersion:**
- `dispersion(values)` → mean, std, CV%, min, max, range, quartiles, IQR

**Smoothing:**
- `gaussianSmooth(values, sigma)` → Gaussian kernel smoothing
- `movingAverage(values, window)` → simple moving average

**Day-of-Week:**
- `dayOfWeekAnalysis(data)` → averages by day, best/worst day, weekday vs weekend

**Sleep-Specific:**
- `sleepDebt(durations, targetHours?)` → debt hours and status
- `sleepRegularity(bedtimes, waketimes)` → regularity score (0-100)

**Derived Metrics (NEW):**
- `sleepStageRatios(deep, rem, light)` → ratios and percentages with status ("low"/"normal"/"good"/"excellent")
- `computeSleepScore(efficiency, deepPct, remPct)` → weighted sleep score (0-100) with interpretation
- `hrvRecoveryPattern(samples)` → first/second half comparison, pattern ("good_recovery"/"flat"/"declining")

## Reference Materials

- **Wearipedia notebook** ([docs/reference/oura_ring_gen_3.ipynb](docs/reference/oura_ring_gen_3.ipynb)) - Comprehensive Oura analysis from Stanford
  - Sleep stage visualization (stackplots)
  - Outlier detection (IQR, Z-score)
  - Correlation analysis with p-values
  - Gaussian smoothing for time series
  - Data joining patterns (match on day)
  
- **HRV Analysis library** (Aura-healthcare/hrv-analysis) - Production-grade HRV
  - Time domain: RMSSD, SDNN, pNN50, CVSD, mean/max/min HR
  - Frequency domain: VLF, LF, HF, LF/HF ratio (Welch + Lomb methods)
  - Non-linear: Poincaré plot (SD1, SD2), Sample Entropy
  - Preprocessing: outlier removal, ectopic beat detection (malik/kamath/karlsson/acar)
  
- **Sleep Stage Classification** (CNN+LSTM) - Deep learning on PSG data
  - Feature extraction: skew, kurtosis, RMS, zero crossings
  - Band powers: delta, theta, alpha, beta, gamma
  - Sleep score formula: 0.5*efficiency + 0.4*deep% + 0.2*REM%
  
- **Oura OpenAPI spec** - Full API documentation (367KB JSON)

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript
pnpm dev              # Watch mode
pnpm start            # Run the server (stdio transport)
pnpm dev:worker       # wrangler dev (Cloudflare Worker) on :8787, needs .dev.vars
pnpm test:worker      # Worker tests only (workerd)
pnpm typecheck:worker # tsc -p tsconfig.worker.json (also part of pnpm build)

# Authentication (Phase 4a)
npx oura-ring-mcp auth     # OAuth flow: opens browser, saves credentials
npx oura-ring-mcp status   # Check authentication status
npx oura-ring-mcp logout   # Clear stored credentials

# Testing
pnpm test             # Run all tests (vitest projects: node + worker)
pnpm test:watch       # Watch mode for development
pnpm test:coverage    # Coverage for the node project (CI gate)
pnpm test:ui          # Open Vitest UI in browser

# OpenAPI & Type Generation
pnpm update-openapi   # Download latest OpenAPI spec from Oura
pnpm generate-types   # Generate TypeScript types from spec
pnpm update-types     # Update spec AND generate types (convenience)

# Fixture Validation
OURA_ACCESS_TOKEN=your_token npx ts-node scripts/validate-fixtures.ts  # Compare fixtures to real API
```

## Publishing Releases

**IMPORTANT:** After significant changes, publish to both npm AND MCP registry.

```bash
# 1. Build, test, and verify coverage
pnpm build && pnpm test:coverage

# 2. Bump version
npm version patch  # or minor/major

# 3. Publish to npm
npm publish

# 4. Update server.json version to match package.json
# Edit server.json: update both "version" fields to match

# 5. Publish to MCP registry
npx @anthropic-ai/mcp-publisher publish

# 6. Push to GitHub
git push && git push --tags
```

**When to publish:**
- New features or tools
- Bug fixes
- Documentation improvements that affect usage
- NOT needed for: internal refactors, test-only changes, CLAUDE.md updates

## Testing Strategy

We use **Vitest** for testing with the following structure:

**Test Organization:**
- Tests are co-located with source files (`*.test.ts`)
- Shared fixtures in `tests/fixtures/` (sample API responses)
- Test utilities in `tests/helpers/` (mocks, helpers)

**Coverage Thresholds:**
```json
{
  "branches": 75,
  "functions": 80,
  "lines": 80,
  "statements": 80
}
```

**What We Test:**
1. **Formatters** (`utils/formatters.ts`) - Unit tests, 90%+ coverage target
2. **Error utilities** (`utils/errors.ts`) - Unit tests for error formatting
3. **Tool Handlers** (`tools/index.ts`) - Unit tests with mocked client
4. **Oura Client** (`client.ts`) - Integration tests with mocked fetch
5. **MCP Server** (`index.ts`) - Integration tests with mocked SDK

**Mock Strategy:**
- Oura API calls → `nock` or `msw` for deterministic testing
- Environment vars → Override `process.env` in tests
- Date/time → `vitest.useFakeTimers()` for consistent "today" tests

**Exclusions:**
- Generated types (`src/types/oura-api.ts`) excluded from coverage
- Scripts and config files excluded

See `tests/README.md` for detailed testing guidelines.

## Keeping Types Up-to-Date

When Oura updates their API, run:

```bash
pnpm update-types
pnpm build
```

This will:
1. Scrape the latest OpenAPI spec download link from https://cloud.ouraring.com/v2/docs
2. Download the spec automatically (currently 1.43)
3. Generate fresh TypeScript types
4. Rebuild the project

**How it works**: The script fetches the docs page, extracts the "Download OpenAPI specification" link, and downloads whatever version Oura is currently serving. No manual version updates needed!

**Tip**: Check for API updates:
- Every few months
- When Oura announces new features
- When you see deprecation warnings
- Before major releases

## Testing with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "oura": {
      "command": "node",
      "args": ["/absolute/path/to/oura-mcp/dist/index.js"],
      "env": {
        "OURA_ACCESS_TOKEN": "your_token_here"
      }
    }
  }
}
```

**Important Notes**:
- Replace `/absolute/path/to/oura-mcp` with your actual installation path
- This project requires **Node >=18**. If Claude Desktop is using an older Node version (check logs), specify the full path to a modern Node:
  ```json
  "command": "/Users/yourusername/.nvm/versions/node/v18.20.0/bin/node"
  ```

Then restart Claude Desktop.

## Remote Deployment (Cloudflare Worker)

See README "Remote Server on Cloudflare" for user-facing steps. Developer notes:

- Entry `src/worker/index.ts` must export only the default handler (workerd treats named exports as entrypoints); helpers live in other modules.
- All public URLs (issuer, endpoints, resource) derive from `PUBLIC_BASE_URL`; the provider is built lazily per base URL. `apiRoute` is the full `${base}/mcp`, so requests for other hosts never reach the MCP handler.
- OAuth endpoints are under `/oauth/*` (not `/mcp/*`: `apiRoute` protects path-boundary descendants of `/mcp`).
- Tom's deployment: no routes / workers_dev off; the `dixi-site` Worker (dixi.lulolabs.co) forwards the Worker's paths over a service binding.
- Secrets: `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `ALLOWED_OURA_USER_ID` and/or `ALLOWED_OURA_EMAIL`. `.dev.vars` is gitignored.
- Never log tokens, codes, props or Oura data. `onError` logs code + internal reason only.

## Oura API Reference

- Docs: https://cloud.ouraring.com/v2/docs
- OAuth apps: https://developer.ouraring.com/applications (PATs no longer issued since Dec 2025)
- `/heartrate` and `/ring_battery_level` take `start_datetime`/`end_datetime` (not dates) and paginate via `next_token`
- Rate limit: 5000 requests per 5 minutes
- All durations are in **seconds** (we convert to hours/minutes for display)

## Design Decisions

1. **Human-readable + raw data**: Tools return formatted summaries, not just JSON blobs
2. **Sensible defaults**: `get_sleep()` with no args returns today's data
3. **Score interpretation**: We add context like "85 (Optimal)" not just "85"
4. **Sleep percentages**: Calculated from `total_sleep_duration`, not `time_in_bed` (matches Oura app)
5. **Oura has TWO sleep endpoints** - IMPORTANT for resources/tools:
   - `/daily_sleep` → scores and contributors only (no duration, stages, HR, HRV)
   - `/sleep` → detailed session data (duration, stages, bedtime, HR, HRV, breathing)
   - Both `get_sleep` tool AND `oura://today` resource call BOTH endpoints to show complete data
   - The Oura app shows data from both endpoints combined
6. **Oura API single-date query quirk** - See [README.md](README.md#oura-api-quirks) for details. TL;DR: some endpoints return empty for `start == end`, so we expand by ±1 day and filter.

## Auth Strategy

**Option 1: OAuth CLI Flow (recommended for local use)**

Create an OAuth app at https://developer.ouraring.com/applications (redirect `http://localhost:3000/callback`), then:
```bash
export OURA_CLIENT_ID=your_client_id
export OURA_CLIENT_SECRET=your_client_secret
npx oura-ring-mcp auth     # Opens browser → Oura OAuth → localhost callback
npx oura-ring-mcp status
npx oura-ring-mcp logout
```
Credentials saved to `~/.oura-mcp/credentials.json`. With OURA_CLIENT_ID/SECRET in the server env, the stdio server refreshes on demand during the session (TokenManager, single-flight) and saves each rotated refresh token.

**Option 2: Legacy personal access token** — `OURA_ACCESS_TOKEN` (deprecated by Oura in Dec 2025; existing tokens may still work).

**Option 3: Remote via Cloudflare Worker** — see "Remote Deployment (Cloudflare Worker)".

## Oura API Quirks

Important quirks to know when developing:

- **Single-date query bug**: `/sleep`, `/daily_activity`, `/workout`, `/session`, `/tag`, `/enhanced_tag` return empty when `start == end`. Workaround: query ±1 day (±3 for enhanced_tag).
- **Missing `sleep_regularity`**: Not in OpenAPI spec but returned by API. Cast to access.
- **Two sleep endpoints**: `/daily_sleep` (scores only) vs `/sleep` (detailed sessions). Use both for complete data.
- **Sleep attribution**: Sleep data is attributed to the day you woke up, not when you fell asleep.
- **Data sync**: Data only syncs when user opens Oura app - "no data" often means ring hasn't synced yet.
- **Rate limits**: 5000 requests per 5 minutes.

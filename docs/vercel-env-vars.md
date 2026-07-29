<!-- =============================================================================== file_id: SOM-DOC-1971-v1.0.0 name: vercel-env-vars.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

<!-- =============================================================================== file_id: SOM-DOC-1971-v1.0.0 name: vercel-env-vars.md description:  project_id: OLIGARCHOLOGY category: doc tags: [] created: 2026-06-08 modified: 2026-06-08 version: 1.0.0 agent_id: AGENT-PRIME-002 =============================================================================== -->

---
file_id: SOM-DOC-0030-v0.0.1
name: vercel-env-vars
description: Reference for Vercel env vars the SoMaCo agent system reads and sets. Distinguishes canonical Vercel names (for project builds/runtime) from our per-project fan-out naming (for external agents). Plus three ways to generate bypass tokens and when to use each.
category: DOC
tags: [vercel, env, bypass, security, reference]
created: 2026-04-22
version: 0.0.1
---

# Vercel Env Vars — What the Agents Read and Set

## Two naming regimes, on purpose

| Context | Env var | Who sets it | Scope |
|---|---|---|---|
| **Inside a Vercel deployment** (austinsays's own build/runtime) | `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel injects it | That one project |
| **Outside, agent calling N projects** | `VERCEL_BYPASS_<PROJECT_SLUG>` | We write it to `~/.openclaw.env` | One per project |

Vercel's own CLI (`vercel curl`, `vercel httpstat`) uses the canonical name. A Voxel agent standing on OMEN-01 that needs to hit both austinsays and sonomasays needs two distinct values, so we fan out. The `vercel-client.mjs` reads from the fan-out names by default and falls back to the canonical name if the fan-out isn't set (useful when running *inside* a Vercel deployment).

## System env vars Vercel injects (read-only, at build+runtime)

These are set by Vercel, not by us. Useful for agents inspecting deployment state:

| Var | Meaning |
|---|---|
| `VERCEL` | `1` — indicates running on Vercel |
| `CI` | `1` — CI context |
| `VERCEL_ENV` | `production` / `preview` / `development` |
| `VERCEL_TARGET_ENV` | Same, plus custom env names |
| `VERCEL_URL` | Generated deployment URL (`my-site.vercel.app`) |
| `VERCEL_BRANCH_URL` | Per-branch preview URL |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Bypass token, if Deployment Protection is on and a bypass exists |
| `VERCEL_GIT_PROVIDER` | `github` / `gitlab` / `bitbucket` |
| `VERCEL_GIT_REPO_SLUG` | Repo name |
| `VERCEL_GIT_REPO_OWNER` | Org/user |
| `VERCEL_GIT_COMMIT_REF` | Branch |
| `VERCEL_GIT_COMMIT_SHA` | Commit SHA |
| `VERCEL_GIT_COMMIT_AUTHOR_LOGIN` | Who pushed |

Reference: https://vercel.com/docs/environment-variables/system-environment-variables

## Env vars we set on OMEN-01 (in `~/.openclaw.env`)

| Var | Purpose | Scope |
|---|---|---|
| `VERCEL_TOKEN` | Team bearer for `api.vercel.com` (`vercel env ls`, `vercel deploy`, etc.) | Entire SoMaCo team — treat like root |
| `VERCEL_TEAM_ID` | `team_MJNSdIKAxPJySa21R8pNNlXZ` | Constant |
| `VERCEL_BYPASS_SOMACOSF_PLATFORM` | Bypass for somacosf-platform | Per-project |
| `VERCEL_BYPASS_AUSTINSAYS_PLATFORM` | Bypass for austinsays-platform | Per-project |
| `VERCEL_BYPASS_SONOMASAYS_PLATFORM` | … | Per-project |
| `VERCEL_BYPASS_AERO` | Bypass for aero project | Per-project |
| (one per project in the team, minted on demand) | | |

**Mint order:**
1. `VERCEL_TOKEN` — done once, stored mode-0600 in `~/.openclaw.env`
2. `VERCEL_BYPASS_*` per project — done via `scripts/utils/mint-bypass-tokens.sh`
3. GYST UUIDs — done via `register-bypass-uuids.mjs` (references envKey, never the token value)

## Env vars we set inside each Vercel project (via `vercel env add`)

Only set these in a project's env if the **project's own runtime code** needs them. External agents don't care about these.

| Var | When to set | Environment |
|---|---|---|
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Only if the project's own cron jobs / functions call back into its own protected APIs | Preview + Production |
| `TURSO_DATABASE_URL` | If the project persists to libsql (most of ours do) | Production only |
| `TURSO_AUTH_TOKEN` | Same | Production only |
| `ANTHROPIC_API_KEY` | If the project uses Claude in serverless functions | As needed |
| `OPENAI_API_KEY` | Same for OpenAI | As needed |

**Do NOT** set `VERCEL_BYPASS_<PROJECT>=...` inside the project itself — that's the external-agent naming, it only belongs in `~/.openclaw.env`.

## Three ways to generate a bypass token

### Option A — Dashboard (what you already saw)

`Project → Settings → Deployment Protection → Protection Bypass for Automation → Add Bypass`

- Leave blank to auto-generate a 32-char secret, or paste your own
- Add a note (we recommend: `somaco-agent · minted YYYY-MM-DD · rotate monthly`)
- Copy the token from the dashboard immediately — it shows once
- Paste it into `~/.openclaw.env` as `VERCEL_BYPASS_<PROJECT_SLUG>=...`

**Good for:** One-off, when you're already in the dashboard.

### Option B — `mint-bypass-tokens.sh` (bulk, scripted)

From a terminal you control (not Claude Code, so tokens don't land in transcripts):

```bash
# Prereq: export VERCEL_TOKEN=<your-personal-token>  (or logged in via `vercel login`)

# Dry run first — enumerates the 19 projects, doesn't mint anything
DRY_RUN=1 bash scripts/utils/mint-bypass-tokens.sh

# Mint for all projects
bash scripts/utils/mint-bypass-tokens.sh

# Or target specific projects
bash scripts/utils/mint-bypass-tokens.sh somacosf-platform aero austinsays-platform

# Monthly rotation
ROTATE=1 bash scripts/utils/mint-bypass-tokens.sh somacosf-platform
```

The script:
1. Calls `PATCH /v1/projects/{project}/protection-bypass` with `{generate: {note}}`
2. Appends `VERCEL_BYPASS_<PROJECT>=<32ch>` to `~/.openclaw.env` (mode 0600)
3. Appends a bookkeeping row (no token value) to `~/.openclaw.bypass-manifest`
4. Revokes the prior token first if `ROTATE=1`

**Good for:** Bulk mint, scripted rotation, CI.

### Option C — Vercel CLI one-liner (per project)

```bash
# Generate and set as project env var in one shot
vercel env add VERCEL_AUTOMATION_BYPASS_SECRET production
# (CLI prompts for value — paste 32-char or press enter; it stays in-project only)
```

Then pull it locally:

```bash
vercel env pull .env.vercel --environment=production
# VERCEL_AUTOMATION_BYPASS_SECRET=... now in .env.vercel (gitignore it)
```

**Good for:** Setting a bypass the *project's own* serverless functions use to call back into themselves. NOT the right path for cross-project external agents.

## How to generate the account-level `VERCEL_TOKEN`

1. https://vercel.com/account/tokens
2. Click "Create"
3. Scope: pick the SoMaCo team, not "all teams"
4. Expiry: 90 days is reasonable — set a calendar reminder to rotate
5. Copy the token once, paste into `~/.openclaw.env` as:
   ```
   VERCEL_TOKEN=vercel_pat_...
   VERCEL_TEAM_ID=team_MJNSdIKAxPJySa21R8pNNlXZ
   ```

Rotation: same URL, delete old, create new, update env, scp to Mini.

## Auditing

```bash
# List all bypass UUIDs registered in uuid_registry (domain=0xA, type=0x40A)
node .claude/skills/colloquy/scripts/register-bypass-uuids.mjs --list

# Check Vercel's own view — matches ours?
curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v1/projects/somacosf-platform/protection-bypass?teamId=$VERCEL_TEAM_ID" \
  | jq '.'
```

## Leak response

If a token is exposed (committed to git, screenshot, copy-pasted into chat):

1. Immediately rotate: `ROTATE=1 bash scripts/utils/mint-bypass-tokens.sh <project>`
2. Mark the old UUID revoked: `node register-bypass-uuids.mjs --revoke <uuid>`
3. Emit a heartbeat: `event_kind: 'bypass_rotated'`, `domain: 0xA`, `payload: { reason: 'leak', old_uuid, new_uuid }`
4. If the leak was into git, follow up with `git filter-repo` to scrub history, then force-push (only after confirming no one is working on that branch)

## Related files

- `scripts/utils/vercel-client.mjs` — HTTP client that injects the header
- `scripts/utils/mint-bypass-tokens.sh` — bulk minter
- `.claude/skills/colloquy/scripts/register-bypass-uuids.mjs` — GYST UUID registrar
- `scripts/hooks/pre-commit-secrets.sh` — secret scanner git hook
- `.claude/skills/colloquy/personas/persona-voxel-v1.md` — Security Posture template

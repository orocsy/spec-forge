# Templates

Static files copied (with variable substitution) into a freshly bootstrapped project. Stable across runs — no logic. Pure boilerplate that doesn't fit inside an integration's `patch/` folder because it's universal.

## Templates planned

| Template | Path-in-project | Substitutions |
|----------|----------------|---------------|
| `claude/CLAUDE.md.tmpl` | `.claude/CLAUDE.md` | `${PROJECT_NAME}`, `${STACK_DESCRIPTION}` |
| `claude/docs/PROJECT_STATUS.md.tmpl` | `.claude/docs/PROJECT_STATUS.md` | `${PROJECT_NAME}` |
| `claude/docs/ARCHITECTURE.md.tmpl` | `.claude/docs/ARCHITECTURE.md` | `${STACK_TABLE}` |
| `claude/docs/RECENT_CHANGES.md.tmpl` | `.claude/docs/RECENT_CHANGES.md` | `${INITIAL_INTEGRATIONS}` |
| `claude/docs/SECRETS.md.tmpl` | `.claude/docs/SECRETS.md` | `${SECRET_TABLE}` |
| `claude/docs/SECRETS_TODO.md.tmpl` | `.claude/docs/SECRETS_TODO.md` | `${PROD_ONLY_SECRETS}` |
| `claude/docs/SCALE_THRESHOLDS.md.tmpl` | `.claude/docs/SCALE_THRESHOLDS.md` | `${INTEGRATION_LIMITS}` |
| `claude/docs/MIGRATION.md.tmpl` | `MIGRATION.md` | `${DEPLOY_TARGET}`, `${ALT_TARGETS}` |
| `claude/settings.json.tmpl` | `.claude/settings.json` | `${PRE_APPROVED_BASH_PATTERNS}` |
| `claude/scripts/install-git-hooks.sh.tmpl` | `.claude/scripts/install-git-hooks.sh` | (none — same as starter) |
| `claude/scripts/session-start.sh.tmpl` | `.claude/scripts/session-start.sh` | (none — same as starter) |
| `github/workflows/ci.yml.tmpl` | `.github/workflows/ci.yml` | `${TEST_COMMAND}`, `${E2E_REQUIRED}` |
| `github/workflows/deploy-preview.yml.tmpl` | `.github/workflows/deploy-preview.yml` | `${DEPLOY_TARGET}` |
| `github/workflows/deploy-prod.yml.tmpl` | `.github/workflows/deploy-prod.yml` | `${DEPLOY_TARGET}` |
| `devcontainer/devcontainer.json.tmpl` | `.devcontainer/devcontainer.json` | `${REQUIRED_PORTS}`, `${SECRETS_LIST}` |
| `gitignore.tmpl` | `.gitignore` | `${EXTRA_IGNORE_PATTERNS}` |
| `editorconfig.tmpl` | `.editorconfig` | (none) |
| `nvmrc.tmpl` | `.nvmrc` | `${NODE_VERSION}` |
| `prettierrc.tmpl` | `.prettierrc` | (none — opinionated default) |
| `mcp.json.tmpl` | `.mcp.json` | `${MCP_SERVERS_LIST}` |

## Why separate templates from integrations

Integration `patch/` folders own files specific to that integration. Templates own files **every** project gets:
- `.claude/` workflow scaffold
- GitHub Actions skeleton
- DevContainer config
- `.gitignore` / `.editorconfig` / `.nvmrc` / `.prettierrc`
- `.mcp.json` (auto-populated from chosen integrations)
- `MIGRATION.md` (free-tier escape paths)

Splitting them prevents every integration from re-declaring "I need a `.gitignore`."

## Substitution syntax

Simple string replacement:
```
# Before substitution
const project = "${PROJECT_NAME}";
```

```
# After substitution
const project = "my-app";
```

No templating engine (no Handlebars, no Liquid). Just `replace_all` over `${VAR_NAME}` patterns. Keeps templates trivially auditable.

## Template testing

Each template has a paired golden file produced from a known-good substitution set:

```
templates/
├── claude/CLAUDE.md.tmpl
└── claude/CLAUDE.md.golden  # expected output for the dental-clinic example PRD
```

CI runs each template through the substitution engine and diffs against the golden. Any drift = test failure.

---

*Status: directory + skeleton README. The starter (`~/Desktop/projects/nodejs-fullstack-starter`) already contains drafts of most of these — Tier 1 Day 1 task is to extract them into this folder as `.tmpl` files with the substitution markers added.*

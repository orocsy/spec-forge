#!/usr/bin/env bash
# Wire .githooks/ as the repo's hook directory using git's native
# core.hooksPath (Git 2.9+). Run automatically by `prepare` lifecycle
# script after `pnpm install`. No husky dependency.

set -e

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  # Not in a git repo — silently exit (e.g., during scaffold before git init).
  exit 0
fi

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true
echo "✓ git hooks active (.githooks/)"

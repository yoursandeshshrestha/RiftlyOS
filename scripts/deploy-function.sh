#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

list_functions() {
  for dir in supabase/functions/*/; do
    name="$(basename "$dir")"
    [[ "$name" == _* ]] && continue
    echo "  - $name"
  done
}

if [[ $# -eq 0 ]]; then
  echo "Usage: bun run deploy-function <name> [name2 ...]"
  echo "       bun run deploy-function --all"
  echo ""
  echo "Available functions:"
  list_functions
  exit 1
fi

deploy_one() {
  local name="$1"
  local path="supabase/functions/$name"

  if [[ ! -d "$path" ]]; then
    echo "Error: function '$name' not found at $path"
    echo ""
    echo "Available functions:"
    list_functions
    exit 1
  fi

  echo "Deploying $name..."
  supabase functions deploy "$name"
}

if [[ "$1" == "--all" ]]; then
  for dir in supabase/functions/*/; do
    name="$(basename "$dir")"
    [[ "$name" == _* ]] && continue
    deploy_one "$name"
  done
else
  for name in "$@"; do
    deploy_one "$name"
  done
fi

echo "Done."

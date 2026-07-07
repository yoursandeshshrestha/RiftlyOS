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
  if [[ "$name" == "stripe-webhook" ]]; then
    supabase functions deploy "$name" --no-verify-jwt
  else
    supabase functions deploy "$name"
  fi
}

deploy_all() {
  echo "Deploying all functions:"
  list_functions
  echo ""

  for dir in supabase/functions/*/; do
    name="$(basename "$dir")"
    [[ "$name" == _* ]] && continue
    deploy_one "$name"
  done
}

if [[ $# -eq 0 || "$1" == "--all" ]]; then
  deploy_all
else
  for name in "$@"; do
    deploy_one "$name"
  done
fi

echo "Done."

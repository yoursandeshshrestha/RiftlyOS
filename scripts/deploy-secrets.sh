#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env}"
SECRET_KEYS=(
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  RESEND_API_KEY
  RESEND_FROM_EMAIL
)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

read_env_value() {
  local key="$1"
  local line value

  line="$(grep -E "^${key}=" "$ENV_FILE" | head -1 || true)"
  [[ -z "$line" ]] && return 1

  value="${line#*=}"
  value="${value%$'\r'}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"

  [[ -z "$value" ]] && return 1
  [[ "$value" == *"..."* ]] && return 1
  [[ "$value" == your-* ]] && return 1

  printf '%s' "$value"
}

SECRETS=()

for key in "${SECRET_KEYS[@]}"; do
  if value="$(read_env_value "$key")"; then
    SECRETS+=("${key}=${value}")
  fi
done

if [[ ${#SECRETS[@]} -eq 0 ]]; then
  echo "No secrets to deploy from $ENV_FILE."
  echo "Expected one or more of: ${SECRET_KEYS[*]}"
  exit 1
fi

echo "Deploying secrets to Supabase from $ENV_FILE:"
for secret in "${SECRETS[@]}"; do
  echo "  - ${secret%%=*}"
done

supabase secrets set "${SECRETS[@]}"
echo "Done."

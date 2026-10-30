#!/bin/sh
set -eu

secret_dir=/run/auratalk-secrets
export SYNAPSE_ADMIN_PASSWORD="$(cat "$secret_dir/synapse_admin_password")"
export REVOCATION_API_KEY="$(cat "$secret_dir/revocation_api_key")"
export TOTP_ENCRYPTION_KEY="$(cat "$secret_dir/totp_encryption_key")"

exec node /app/revoke.js


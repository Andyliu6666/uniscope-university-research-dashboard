#!/usr/bin/env bash

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
KEEP="${KEEP:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/db-${STAMP}.dump"
TEMP_DUMP="$(mktemp "${BACKUP_DIR}/.db-${STAMP}.XXXXXX.tmp")"
trap 'rm -f -- "${TEMP_DUMP}"' EXIT

echo "[backup] dumping the configured PostgreSQL database -> ${DUMP_FILE}"
docker compose -f "${COMPOSE_FILE}" exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "${TEMP_DUMP}"
mv -- "${TEMP_DUMP}" "${DUMP_FILE}"
trap - EXIT

OLD_BACKUPS="$(ls -1t "${BACKUP_DIR}"/db-*.dump 2>/dev/null | sed -n "$((KEEP + 1)),\$p" || true)"
while IFS= read -r backup; do
  if [[ -n "${backup}" ]]; then
    rm -f -- "${backup}"
  fi
done <<< "${OLD_BACKUPS}"

echo "[backup] complete"

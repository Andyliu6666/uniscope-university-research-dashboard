#!/usr/bin/env bash

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
KEEP="${KEEP:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
POSTGRES_USER="${POSTGRES_USER:-urd}"
POSTGRES_DB="${POSTGRES_DB:-university_dashboard}"

mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/db-${STAMP}.dump"

echo "[backup] dumping ${POSTGRES_DB} -> ${DUMP_FILE}"
docker compose -f "${COMPOSE_FILE}" exec -T db \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc > "${DUMP_FILE}"

OLD_BACKUPS="$(ls -1t "${BACKUP_DIR}"/db-*.dump 2>/dev/null | sed -n "$((KEEP + 1)),\$p" || true)"
while IFS= read -r backup; do
  if [[ -n "${backup}" ]]; then
    rm -f -- "${backup}"
  fi
done <<< "${OLD_BACKUPS}"

echo "[backup] complete"

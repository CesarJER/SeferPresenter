#!/bin/sh
set -eu

backup_dir="${SEFER_BACKUP_DIR:-/app/backups}"
mkdir -p "$backup_dir"
chown node:node "$backup_dir"

exec su-exec node "$@"

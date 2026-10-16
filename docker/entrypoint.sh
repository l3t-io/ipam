#!/bin/sh
# Prepares the data folder and starts the app without root privileges.
# PUID/PGID select the user that should own /data (default 1000:1000;
# usually 1026:100 on a Synology).
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA="${IPAM_DATA:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  if chown -R "$PUID:$PGID" "$DATA" 2>/dev/null; then
    exec su-exec "$PUID:$PGID" "$@"
  fi
  # Some NAS shares don't allow chown (ACLs). Better to run like this than not at all.
  echo "WARNING: could not chown $DATA to $PUID:$PGID - running as root. Set PUID/PGID to the owner of the data folder." >&2
fi

exec "$@"

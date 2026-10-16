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
    # On Synology shares the DSM permissions (ACLs) decide, not the owner: chown succeeds,
    # writing may still be refused. So check with a real file before dropping root.
    PROBE="$DATA/.l3t-write-test"
    if su-exec "$PUID:$PGID" sh -c 'touch "$1" && rm -f "$1"' sh "$PROBE" 2>/dev/null; then
      exec su-exec "$PUID:$PGID" "$@"
    fi
    rm -f "$PROBE" 2>/dev/null || true
    echo "WARNING: $PUID:$PGID may not write to $DATA (folder permissions) - running as root. Give the folder read/write permission, see SYNOLOGY.md." >&2
  else
    # Some NAS shares don't allow chown (ACLs). Better to run like this than not at all.
    echo "WARNING: could not chown $DATA to $PUID:$PGID - running as root. Set PUID/PGID to the owner of the data folder." >&2
  fi
fi

exec "$@"

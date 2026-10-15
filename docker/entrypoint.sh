#!/bin/sh
# Bereitet den Datenordner vor und startet die App ohne Root-Rechte.
# PUID/PGID wählen den Benutzer, dem /data gehören soll (Vorgabe 1000:1000;
# auf einer Synology meist 1026:100).
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA="${IPAM_DATA:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  if chown -R "$PUID:$PGID" "$DATA" 2>/dev/null; then
    exec su-exec "$PUID:$PGID" "$@"
  fi
  # Manche NAS-Freigaben erlauben kein chown (ACLs). Dann lieber laufen als gar nicht.
  echo "WARNING: could not chown $DATA to $PUID:$PGID - running as root. Set PUID/PGID to the owner of the data folder." >&2
fi

exec "$@"

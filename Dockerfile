# L3T IPAM — Container-Image
# Gebaut für linux/amd64 und linux/arm64 (Raspberry Pi), siehe .github/workflows/docker.yml.
FROM node:22-alpine

# su-exec: Rechte nach dem Vorbereiten des Datenordners abgeben (wie gosu, aber winzig)
RUN apk add --no-cache su-exec

WORKDIR /app
COPY app/ /app/
COPY docker/entrypoint.sh /usr/local/bin/l3t-entrypoint
RUN chmod 0755 /usr/local/bin/l3t-entrypoint

ENV IPAM_DATA=/data \
    IPAM_PORT=8080 \
    NODE_ENV=production
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

LABEL org.opencontainers.image.title="L3T IPAM" \
      org.opencontainers.image.description="Lightweight IP address management for home labs, with UniFi sync" \
      org.opencontainers.image.source="https://github.com/l3t-io/ipam" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["l3t-entrypoint"]
CMD ["node", "server.js"]

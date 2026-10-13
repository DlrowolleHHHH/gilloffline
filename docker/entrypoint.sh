#!/bin/sh
# Starts nginx (TLS termination, from the certificates mounted in /app/ssl) and the
# Node application behind it. Rendering the nginx config happens here so the
# certificate filenames can come from the environment.
set -e

DATA_DIR="${DATA_DIR:-/data}"
SSL_DIR="${SSL_DIR:-/app/ssl}"
SERVER_NAME="${SERVER_NAME:-_}"
SSL_CERT_FILE="${SSL_CERT_FILE:-gilloffline.online.pem}"
SSL_KEY_FILE="${SSL_KEY_FILE:-gilloffline.online.key}"
TEMPLATE_DIR=/etc/gilloffline

mkdir -p "$DATA_DIR" /run/nginx /var/log/nginx /var/www/acme

# The data directory is a mounted volume; make sure the app user can write to it.
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
fi

# First run on an empty volume: drop in the bundled example content.
if [ ! -f "$DATA_DIR/site.json" ]; then
  cp /app/seed/site.json "$DATA_DIR/site.json" 2>/dev/null || true
  echo "[entrypoint] initialised $DATA_DIR/site.json from the bundled example"
fi

CERT="$SSL_DIR/$SSL_CERT_FILE"
KEY="$SSL_DIR/$SSL_KEY_FILE"

if [ -f "$CERT" ] && [ -f "$KEY" ]; then
  TEMPLATE="$TEMPLATE_DIR/nginx.https.conf.template"
  echo "[entrypoint] HTTPS enabled — certificate: $CERT"
else
  TEMPLATE="$TEMPLATE_DIR/nginx.http.conf.template"
  echo "[entrypoint] --------------------------------------------------------------"
  echo "[entrypoint] No certificate found at:"
  echo "[entrypoint]   $CERT"
  echo "[entrypoint]   $KEY"
  echo "[entrypoint] Starting in HTTP-only mode. Drop your certificate files into"
  echo "[entrypoint] the mounted /app/ssl directory (or point SSL_CERT_FILE / SSL_KEY_FILE"
  echo "[entrypoint] at the right names) and restart the container to serve HTTPS."
  echo "[entrypoint] --------------------------------------------------------------"
fi

sed -e "s|\${SERVER_NAME}|$SERVER_NAME|g" \
  -e "s|\${SSL_CERT_FILE}|$SSL_CERT_FILE|g" \
  -e "s|\${SSL_KEY_FILE}|$SSL_KEY_FILE|g" \
  "$TEMPLATE" >/etc/nginx/nginx.conf

nginx -t

# The application only ever listens on loopback; nginx is the public face.
su-exec node node /app/server/index.js &
NODE_PID=$!

nginx -g 'daemon off;' &
NGINX_PID=$!

shutdown() {
  kill -TERM "$NODE_PID" "$NGINX_PID" 2>/dev/null || true
}
trap shutdown INT TERM

# If either process dies, take the container down with it so docker restarts it.
while kill -0 "$NODE_PID" 2>/dev/null && kill -0 "$NGINX_PID" 2>/dev/null; do
  sleep 1
done

echo "[entrypoint] a process exited, shutting down"
shutdown
wait 2>/dev/null || true

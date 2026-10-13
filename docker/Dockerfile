# gilloffline — nginx (TLS + reverse proxy) in front of a dependency-free Node app.
FROM node:22-alpine

# 官方源 dl-cdn.alpinelinux.org 在国内基本连不通（apk add 会一直卡到超时），
# 换成国内镜像。只替换域名、保留 /alpine/v3.xx/... 路径，这样基础镜像换 Alpine
# 版本也不会失效。出国构建想换回官方源：
#   docker build --build-arg APK_MIRROR=dl-cdn.alpinelinux.org ...
ARG APK_MIRROR=mirrors.aliyun.com
RUN sed -i "s|dl-cdn.alpinelinux.org|${APK_MIRROR}|g" /etc/apk/repositories \
  && apk add --no-cache nginx su-exec

WORKDIR /app

# Application
COPY package.json ./
COPY server ./server

# Static front-end
COPY web ./web
COPY logo.svg title.png ./web/assets/

# Example content used the first time an empty /data volume is mounted
COPY data/site.json /app/seed/site.json

# nginx configuration templates + entrypoint
COPY docker/nginx.http.conf.template docker/nginx.https.conf.template /etc/gilloffline/
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
  && mkdir -p /data /run/nginx /var/www/acme /app/ssl \
  && chown -R node:node /data

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=127.0.0.1 \
    DATA_DIR=/data \
    SEED_DIR=/app/seed

# The grid content lives here — mount a volume to keep it across upgrades.
VOLUME ["/data"]

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

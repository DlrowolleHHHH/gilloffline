#!/usr/bin/env bash
#
# gilloffline — build the image and (re)start the container.
#
#   ./build_run.sh                 # build + run
#   ./build_run.sh --no-build      # restart the existing image
#   ./build_run.sh --rebuild       # build without using the layer cache
#   ./build_run.sh --stop          # stop and remove the container
#   ./build_run.sh --logs          # follow the container logs
#
# Everything can be overridden with environment variables, e.g.
#   ADMIN_PASSWORD=secret HOST_SSL_DIR=/etc/ssl/live SERVER_NAME=example.com ./build_run.sh
#
set -euo pipefail

# ------------------------------------------------------------------ settings

IMAGE_NAME="${IMAGE_NAME:-gilloffline}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
CONTAINER_NAME="${CONTAINER_NAME:-gilloffline}"

HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="${HTTPS_PORT:-443}"

# Directory on the host that holds the certificates. The container always sees
# it as /ssl — drop fullchain.pem + privkey.pem (or your own names, see below) here.
HOST_SSL_DIR="${HOST_SSL_DIR:-/ssl}"
SSL_CERT_FILE="${SSL_CERT_FILE:-fullchain.pem}"
SSL_KEY_FILE="${SSL_KEY_FILE:-privkey.pem}"

# Grid content + uploaded images live here, outside the image.
HOST_DATA_DIR="${HOST_DATA_DIR:-$(cd "$(dirname "$0")" && pwd)/data}"

# nginx server_name — set this to your domain, e.g. SERVER_NAME=example.com
SERVER_NAME="${SERVER_NAME:-_}"
TZ="${TZ:-Asia/Shanghai}"

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

# --------------------------------------------------------------------- output

c() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info() { c '0;36' "▸ $*"; }
ok() { c '0;32' "✔ $*"; }
warn() { c '0;33' "! $*"; }
die() { c '0;31' "✘ $*" >&2; exit 1; }

# ----------------------------------------------------------------------- args

DO_BUILD=1
BUILD_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --rebuild) BUILD_ARGS+=(--no-cache) ;;
    --stop)
      info "停止并删除容器 ${CONTAINER_NAME}"
      docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 && ok "容器已删除" || warn "没有找到运行中的容器"
      exit 0
      ;;
    --logs)
      exec docker logs -f "$CONTAINER_NAME"
      ;;
    -h | --help)
      sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "未知参数：$arg（试试 --help）" ;;
  esac
done

command -v docker >/dev/null 2>&1 || die "没有找到 docker 命令"
docker info >/dev/null 2>&1 || die "docker 守护进程没有运行"

# ------------------------------------------------------------------- password

if [ -z "${ADMIN_PASSWORD:-}" ]; then
  if [ -t 0 ]; then
    printf '请输入管理页密码（输入时不回显）: '
    read -rs ADMIN_PASSWORD
    printf '\n再输入一次确认: '
    read -rs ADMIN_PASSWORD_CONFIRM
    printf '\n'
    [ -n "$ADMIN_PASSWORD" ] || die "密码不能为空"
    [ "$ADMIN_PASSWORD" = "$ADMIN_PASSWORD_CONFIRM" ] || die "两次输入的密码不一致"
  else
    die "请通过环境变量提供密码，例如：ADMIN_PASSWORD=your-password ./build_run.sh"
  fi
fi

# ------------------------------------------------------------------ host dirs

if [ ! -d "$HOST_SSL_DIR" ]; then
  mkdir -p "$HOST_SSL_DIR" 2>/dev/null || die "无法创建证书目录 $HOST_SSL_DIR
  请手动创建（可能需要 sudo），或指定其它目录：HOST_SSL_DIR=/path/to/certs ./build_run.sh
  注意：macOS 的根分区是只读的，无法创建 /ssl，请改用其它路径。"
  warn "已创建证书目录 $HOST_SSL_DIR"
fi

if [ ! -f "$HOST_SSL_DIR/$SSL_CERT_FILE" ] || [ ! -f "$HOST_SSL_DIR/$SSL_KEY_FILE" ]; then
  warn "在 $HOST_SSL_DIR 里没有找到 $SSL_CERT_FILE / $SSL_KEY_FILE"
  warn "容器仍会启动，但只会监听 HTTP（80）。放好证书后重新运行本脚本即可启用 HTTPS。"
fi

mkdir -p "$HOST_DATA_DIR"
if [ ! -f "$HOST_DATA_DIR/site.json" ]; then
  cp "$REPO_DIR/data/site.json" "$HOST_DATA_DIR/site.json"
  info "已用示例内容初始化 $HOST_DATA_DIR/site.json"
fi

# ---------------------------------------------------------------------- build

if [ "$DO_BUILD" = "1" ]; then
  info "构建镜像 ${IMAGE_NAME}:${IMAGE_TAG}"
  # `${arr[@]+...}` keeps bash 3.2 (macOS) happy when the array is empty under `set -u`
  docker build ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} -f docker/Dockerfile -t "${IMAGE_NAME}:${IMAGE_TAG}" .
  ok "镜像构建完成"
else
  info "跳过构建，使用已有镜像 ${IMAGE_NAME}:${IMAGE_TAG}"
fi

# ---------------------------------------------------------------------- run

info "启动容器 ${CONTAINER_NAME}"
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${HTTP_PORT}:80" \
  -p "${HTTPS_PORT}:443" \
  -e "ADMIN_PASSWORD=${ADMIN_PASSWORD}" \
  -e "SERVER_NAME=${SERVER_NAME}" \
  -e "SSL_CERT_FILE=${SSL_CERT_FILE}" \
  -e "SSL_KEY_FILE=${SSL_KEY_FILE}" \
  -e "TZ=${TZ}" \
  -v "${HOST_SSL_DIR}:/ssl:ro" \
  -v "${HOST_DATA_DIR}:/data" \
  "${IMAGE_NAME}:${IMAGE_TAG}" >/dev/null

ok "容器已启动"

sleep 2
echo
docker ps --filter "name=^${CONTAINER_NAME}$" --format '  状态: {{.Status}}   端口: {{.Ports}}'
echo
info "最近日志："
docker logs --tail 30 "$CONTAINER_NAME" 2>&1 | sed 's/^/    /'
echo

if [ -f "$HOST_SSL_DIR/$SSL_CERT_FILE" ]; then
  ok "主页: https://<你的域名>:${HTTPS_PORT}/    管理页: https://<你的域名>:${HTTPS_PORT}/admin"
else
  ok "主页: http://<服务器地址>:${HTTP_PORT}/    管理页: http://<服务器地址>:${HTTP_PORT}/admin"
fi
echo "  数据目录: ${HOST_DATA_DIR}"
echo "  证书目录: ${HOST_SSL_DIR} -> /ssl"
echo "  查看日志: ./build_run.sh --logs"

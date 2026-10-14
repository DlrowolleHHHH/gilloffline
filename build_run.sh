#!/usr/bin/env bash
#
# gilloffline — build the image and (re)start the container.
#
#   ./build_run.sh                 # build + run — the data directory is only mounted, never written
#   ./build_run.sh --update        # git pull, then build + run — the code update path
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

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

IMAGE_NAME="${IMAGE_NAME:-gilloffline}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
CONTAINER_NAME="${CONTAINER_NAME:-gilloffline}"

HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="${HTTPS_PORT:-443}"

# Directory on the host that holds the certificates. The container mounts it at
# the very same path, /app/ssl — drop the certificate + key there (names below).
HOST_SSL_DIR="${HOST_SSL_DIR:-/app/ssl}"
SSL_CERT_FILE="${SSL_CERT_FILE:-gilloffline.online.pem}"
SSL_KEY_FILE="${SSL_KEY_FILE:-gilloffline.online.key}"

# certbot 的 webroot：容器里的 nginx 把 /.well-known/acme-challenge/ 指向
# /var/www/acme，所以证书续期时在宿主机上跑
#   certbot certonly --webroot -w "$HOST_ACME_DIR" -d 你的域名
# 就能通过验证（HTTP-01），全程不用停容器。
HOST_ACME_DIR="${HOST_ACME_DIR:-/var/www/acme}"

# Everything the site serves or edits at runtime — site.json, the site's own
# images (assets/), uploaded images (uploads/) and embedded HTML pages
# (pages/) — lives in this one directory. It is mounted into the container at the
# very same path (/app/data, right next to /app/ssl) and it is outside the repo,
# so rebuilding the image, re-cloning or deleting the checkout cannot touch it.
HOST_DATA_DIR="${HOST_DATA_DIR:-/app/data}"
# 去掉结尾的斜杠：后面要拿它跟旧的仓库内目录比对，多一个斜杠就不相等了
HOST_DATA_DIR="${HOST_DATA_DIR%/}"

# nginx server_name — set this to your domain, e.g. SERVER_NAME=example.com
SERVER_NAME="${SERVER_NAME:-_}"
TZ="${TZ:-Asia/Shanghai}"

# ICP 备案号（可选）：显示在主页页脚中间，管理页里填过的话以管理页为准
ICP_NUMBER="${ICP_NUMBER:-}"

cd "$REPO_DIR"

# --------------------------------------------------------------------- output

c() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info() { c '0;36' "▸ $*"; }
ok() { c '0;32' "✔ $*"; }
warn() { c '0;33' "! $*"; }
die() { c '0;31' "✘ $*" >&2; exit 1; }

# Portable-enough file fingerprint, used to prove the data survived a deploy.
digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    cksum "$1" | cut -d' ' -f1
  fi
}

# ----------------------------------------------------------------------- args

DO_BUILD=1
DO_UPDATE=0
BUILD_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --rebuild) BUILD_ARGS+=(--no-cache) ;;
    --update) DO_UPDATE=1 ;;
    --stop)
      info "停止并删除容器 ${CONTAINER_NAME}"
      docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 && ok "容器已删除" || warn "没有找到运行中的容器"
      exit 0
      ;;
    --logs)
      exec docker logs -f "$CONTAINER_NAME"
      ;;
    -h | --help)
      sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "未知参数：$arg（试试 --help）" ;;
  esac
done

command -v docker >/dev/null 2>&1 || die "没有找到 docker 命令"
docker info >/dev/null 2>&1 || die "docker 守护进程没有运行"

# --------------------------------------------------------------------- update

# The code lives in git, the content lives in HOST_DATA_DIR: updating one never
# touches the other, which is the whole point of --update.
if [ "$DO_UPDATE" = "1" ]; then
  command -v git >/dev/null 2>&1 || die "没有找到 git 命令，去掉 --update 只重建镜像即可"
  [ -d "$REPO_DIR/.git" ] || die "$REPO_DIR 不是 git 仓库，去掉 --update 只重建镜像即可"
  # 绝对路径：下面可能用 exec 重新执行自己，$0 是裸文件名时 exec 会去 PATH 里找
  SCRIPT_PATH="$REPO_DIR/$(basename "$0")"
  SCRIPT_DIGEST="$(digest "$SCRIPT_PATH")"
  info "拉取最新代码（git pull --ff-only）"
  git -C "$REPO_DIR" pull --ff-only || die "git pull 失败（本地有改动或分叉？），修好后重试，或去掉 --update"
  if [ "${GILLOFFLINE_REEXEC:-0}" != "1" ] && [ "$(digest "$SCRIPT_PATH")" != "$SCRIPT_DIGEST" ]; then
    info "build_run.sh 自己也有更新，换新版本重新执行"
    GILLOFFLINE_REEXEC=1 exec "$SCRIPT_PATH" ${@+"$@"}
  fi
fi

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
  注意：macOS 的根分区是只读的，无法创建 /app，请改用其它路径。"
  warn "已创建证书目录 $HOST_SSL_DIR"
fi

if [ ! -f "$HOST_SSL_DIR/$SSL_CERT_FILE" ] || [ ! -f "$HOST_SSL_DIR/$SSL_KEY_FILE" ]; then
  warn "在 $HOST_SSL_DIR 里没有找到 $SSL_CERT_FILE / $SSL_KEY_FILE"
  warn "容器仍会启动，但只会监听 HTTP（80）。放好证书后重新运行本脚本即可启用 HTTPS。"
fi

mkdir -p "$HOST_ACME_DIR"

# ---------------------------------------------------------------- data dir

if ! mkdir -p "$HOST_DATA_DIR" 2>/dev/null; then
  die "无法创建数据目录 $HOST_DATA_DIR
  请手动创建（可能需要 sudo）：sudo mkdir -p $HOST_DATA_DIR && sudo chown $(id -u):$(id -g) $HOST_DATA_DIR
  或指定其它目录：HOST_DATA_DIR=\$HOME/gilloffline-data ./build_run.sh
  注意：macOS 的根分区是只读的，无法创建 /app，请改用其它路径。"
fi

# 更早的版本把运行时数据放在仓库里（先是 data/，后来是 data.local/）。数据目录还是
# 空的时候把它们搬过来：升级绝不该看起来像“内容没了”。旧目录一律原样保留，不删。

if [ "$HOST_DATA_DIR" != "$REPO_DIR/data.local" ] \
  && [ -f "$REPO_DIR/data.local/site.json" ] \
  && [ ! -f "$HOST_DATA_DIR/site.json" ]; then
  info "把 $REPO_DIR/data.local 里的旧数据搬到 $HOST_DATA_DIR"
  cp -R "$REPO_DIR/data.local/." "$HOST_DATA_DIR/"
  ok "搬完了（旧目录 data.local/ 原样留着，确认没问题后可以自己删掉）"
fi

# 再早的版本连上传的图片都写在仓库的 data/ 里；仓库的 site.json 只是示例，不算数据。
if [ "$HOST_DATA_DIR" != "$REPO_DIR/data" ]; then
  for sub in uploads pages; do
    if [ -n "$(ls -A "$REPO_DIR/data/$sub" 2>/dev/null || true)" ] \
      && [ -z "$(ls -A "$HOST_DATA_DIR/$sub" 2>/dev/null || true)" ]; then
      mkdir -p "$HOST_DATA_DIR/$sub"
      cp -R "$REPO_DIR/data/$sub/." "$HOST_DATA_DIR/$sub/"
      info "已把 data/$sub/ 里的内容复制到 $HOST_DATA_DIR/$sub/"
    fi
  done
fi

# 数据目录空着的时候，用仓库里提交的示例播种一份。
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

# 部署前记下数据的指纹，重启后拿来核对“旧数据还在不在”
DIGEST_BEFORE=""
if [ -f "$HOST_DATA_DIR/site.json" ]; then
  DIGEST_BEFORE="$(digest "$HOST_DATA_DIR/site.json")"
fi

info "启动容器 ${CONTAINER_NAME}"
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${HTTP_PORT}:80" \
  -p "${HTTPS_PORT}:443" \
  -e "ADMIN_PASSWORD=${ADMIN_PASSWORD}" \
  -e "ICP_NUMBER=${ICP_NUMBER}" \
  -e "SERVER_NAME=${SERVER_NAME}" \
  -e "SSL_CERT_FILE=${SSL_CERT_FILE}" \
  -e "SSL_KEY_FILE=${SSL_KEY_FILE}" \
  -e "TZ=${TZ}" \
  -v "${HOST_SSL_DIR}:/app/ssl:ro" \
  -v "${HOST_ACME_DIR}:/var/www/acme" \
  -v "${HOST_DATA_DIR}:/app/data" \
  "${IMAGE_NAME}:${IMAGE_TAG}" >/dev/null

ok "容器已启动"

# 等应用真的起来（容器里自带 wget，和 Dockerfile 的健康检查用同一个地址）
READY=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if docker exec "$CONTAINER_NAME" wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

echo
docker ps --filter "name=^${CONTAINER_NAME}$" --format '  状态: {{.Status}}   端口: {{.Ports}}'
echo
info "最近日志："
docker logs --tail 30 "$CONTAINER_NAME" 2>&1 | sed 's/^/    /'
echo

if [ "$READY" = "1" ]; then
  ok "应用已就绪"
else
  warn "20 秒内没等到应用就绪，可能是启动出错：./build_run.sh --logs"
fi

if [ -n "$DIGEST_BEFORE" ]; then
  if [ "$(digest "$HOST_DATA_DIR/site.json")" = "$DIGEST_BEFORE" ]; then
    ok "数据校验：site.json 与部署前完全一致"
  else
    warn "数据校验：site.json 和部署前不一样了！去 ${HOST_DATA_DIR} 看看"
  fi
fi

if [ -f "$HOST_SSL_DIR/$SSL_CERT_FILE" ]; then
  ok "主页: https://<你的域名>:${HTTPS_PORT}/    管理页: https://<你的域名>:${HTTPS_PORT}/admin"
else
  ok "主页: http://<服务器地址>:${HTTP_PORT}/    管理页: http://<服务器地址>:${HTTP_PORT}/admin"
fi
echo "  数据目录: ${HOST_DATA_DIR} -> /app/data"
echo "  证书目录: ${HOST_SSL_DIR} -> /app/ssl"
echo "  ACME 目录: ${HOST_ACME_DIR} -> /var/www/acme"
echo "  查看日志: ./build_run.sh --logs"

# Gill Offline

个人项目橱窗站。主页用「格子」拼成一扇橱窗来陈列项目，管理页带密码，可以增删改格子和拖拽排序。

- 主页 `/`：左上角是 `title.png`，下面是格子组成的橱窗；`logo.svg` 用作站点图标和页脚标记。
  主页是纯展示的，页面上**没有任何管理入口**，只能靠直接输网址进管理页。
- 管理页 `/admin`：密码来自部署时的环境变量 `ADMIN_PASSWORD`，登录后可编辑一切。
- 部署：一个容器里跑 nginx（TLS + 反向代理）+ Node 应用，证书从宿主机 `/app/ssl` 挂载进容器同一个路径。

```
.
├── logo.svg / title.png     # 站点资源（会打进镜像的 web/assets/）
├── build_run.sh             # 构建镜像 + 启动容器，一条命令搞定
├── web/                     # 前端静态页面（无构建步骤）
│   ├── index.html           # 主页橱窗
│   ├── admin.html           # 管理页
│   ├── css/  js/
├── server/                  # 零依赖 Node 后端（无 npm 依赖包）
│   ├── index.js             # 静态文件 + 路由
│   ├── api.js               # JSON 接口
│   ├── auth.js              # 密码校验、会话 cookie、登录限流
│   └── store.js             # site.json 读写与字段校验
├── data/site.json           # 示例内容（首次启动时写入数据卷）
└── docker/                  # Dockerfile、nginx 配置模板、entrypoint
```

## 格子

每个格子有 **尺寸**、**类型**、**边框**、**悬浮详情** 四组配置。

| 尺寸 | 图形 | 占用 |
| --- | --- | --- |
| 方形 `1x1` | ▪ | 宽 1 × 高 1 |
| 矩形 `1x2` | ▪▪ | 宽 2 × 高 1 |
| 长矩形 `1x4` | ▪▪▪▪ | 宽 4 × 高 1 |
| 大方形 `2x2` | 2×2 方块 | 宽 2 × 高 2 |
| 大矩形 `2x4` | 4×2 方块 | 宽 4 × 高 2 |

> 尺寸按「列 × 行」理解：`1x2` 是 2 列宽、1 行高的横向矩形。管理页里每个选项都带缩略图形，一眼能对上。

**类型**分两种：

- **有内容格子**：平时展示图片（支持上传，或直接填图片 URL），可选一个常显的角标文字。
- **纯色格子**：只填一个底色，用来留白、分隔、补位。

两种格子都可以配**悬浮详情**。鼠标移上去时详情面板从指定方向滑入：

- `滑入方向`：从左 / 从右 / 从上 / 从下。
- `覆盖比例`：`1/1` 覆盖整个格子，`1/2` 只覆盖一半（从哪边滑入就贴在哪一边）。
- `背景色` / `文字颜色` 自由配，背景色支持 8 位十六进制（末两位是透明度，例如 `#0b0a12f2`）。

格子上还能配一个点击跳转链接。管理页支持导出 / 导入整份 JSON 配置，方便备份和迁移。

## 站点信息

管理页顶部的「站点信息」面板里可以改站点标题、主题强调色、标题栏文字，以及页脚的三块文字。

标题栏是主页 Logo 下方的那句话，**默认不显示**；勾选「在主页显示标题栏」并保存后才会出现在主页上。

### 页脚

页脚分左 / 中 / 右三块，都在管理页里改：

- **左侧**：Logo 后面的站点署名。
- **中间**：ICP 备案号，永远居中、优先显示；两侧文字太长时会各自横向滑动，不会把中间挤走。
- **右侧**：补充文字（版权之类），留空就不显示。

主页上的备案号是可点的超链接，默认指向工信部备案系统 `https://beian.miit.gov.cn/#/Integrated/index`（新标签页打开）。
管理页里的「备案号链接」填了就按填的走，只接受 `http(s)://` 开头的绝对地址，填别的会被清空、退回默认。

备案号也可以在部署时用环境变量塞进去，不用登录管理页：

```bash
ICP_NUMBER='京ICP备00000000号' ./build_run.sh
```

环境变量只在管理页里没填过备案号时生效；管理页里填过就以管理页的为准，把管理页里那个框清空又会退回环境变量。

## 本地开发

不需要安装任何依赖：

```bash
ADMIN_PASSWORD=dev node server/index.js
# http://127.0.0.1:3000/       主页
# http://127.0.0.1:3000/admin  管理页
```

## 部署

只需要 Node 后端的话，一条命令构建并启动：

```bash
./build_run.sh
```

脚本会：构建镜像 → 停掉旧容器 → 启动新容器 → 打印状态和日志。

```bash
./build_run.sh --no-build   # 不重新构建，只重启
./build_run.sh --rebuild    # 不用缓存重新构建
./build_run.sh --stop       # 停止并删除容器
./build_run.sh --logs       # 跟踪日志
```

### 证书

把你的证书放进宿主机的 `/app/ssl` 目录，容器挂载到同一个路径（只读）：

```
/app/ssl/gilloffline.online.pem     # 证书链（含中间证书）
/app/ssl/gilloffline.online.key     # 私钥
```

文件名不一样就改环境变量：

```bash
SSL_CERT_FILE=example.com.crt SSL_KEY_FILE=example.com.key ./build_run.sh
```

证书就绪时 nginx 监听 443 并启用 HSTS，80 端口自动 301 跳转到 HTTPS。
**如果没找到证书，容器照样会启动**，只是只监听 80 端口并打印提示——不会因为证书没放好就起不来。
放好证书后重新跑一次 `./build_run.sh` 即可。

> macOS 的根分区是只读的，无法创建 `/app`。在 Mac 上测试请指定别的目录：
> `HOST_SSL_DIR=$HOME/certs ./build_run.sh`（容器里还是挂在 `/app/ssl`）。

### 可用环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 无（必填） | 管理页密码。不设置时管理功能整体禁用，不会退化成默认密码 |
| `ICP_NUMBER` | 无 | 页脚中间的 ICP 备案号；管理页里没填过时生效 |
| `HTTP_PORT` / `HTTPS_PORT` | `80` / `443` | 宿主机映射端口 |
| `HOST_SSL_DIR` | `/app/ssl` | 宿主机证书目录，容器内挂在同一个路径 |
| `HOST_DATA_DIR` | `./data` | 宿主机数据目录，挂载为容器内 `/data` |
| `SERVER_NAME` | `_` | nginx `server_name`，填你的域名 |
| `SSL_CERT_FILE` / `SSL_KEY_FILE` | `gilloffline.online.pem` / `gilloffline.online.key` | 证书文件名 |
| `CONTAINER_NAME` / `IMAGE_NAME` / `IMAGE_TAG` | `gilloffline` | 容器与镜像名 |
| `TZ` | `Asia/Shanghai` | 容器时区 |

完整示例：

```bash
ADMIN_PASSWORD='你的密码' SERVER_NAME=example.com HOST_SSL_DIR=/etc/letsencrypt/live/example.com ./build_run.sh
```

### 数据

橱窗内容、站点设置和上传的图片都在 `HOST_DATA_DIR`（默认 `./data`，容器内 `/data`）：

```
data/site.json        # 全部格子配置
data/uploads/         # 上传的图片
data/.session-secret  # 会话签名密钥（自动生成）
```

升级或重建镜像不会动这个目录，备份它等于备份了整个站。

## 接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/site` | 公开 | 读取整站内容 |
| `GET` | `/api/session` | 公开 | 当前是否已登录、是否配置了密码 |
| `GET` | `/api/health` | 公开 | 健康检查 |
| `POST` | `/api/login` | 公开 | 校验密码，下发会话 cookie |
| `POST` | `/api/logout` | 公开 | 清除 cookie |
| `PUT` | `/api/site` | 需登录 | 覆盖保存整份配置 |
| `GET` `POST` `DELETE` | `/api/uploads` | 需登录 | 列出 / 上传 / 删除图片 |

## 安全

- 密码只在环境变量里，不落盘；比对用定长哈希 + `timingSafeEqual`。
- 会话是 HMAC 签名的 HttpOnly cookie（`SameSite=Strict`，HTTPS 下自动加 `Secure`），密钥存在数据卷里，重启不掉线。
- 登录失败按 IP 限流：5 分钟内 8 次失败即拒绝。
- 保存的每个字段都在服务端重新校验：颜色只接受十六进制字面量，链接只接受 `http(s)` 和站内路径，避免存进 CSS 或 HTML 里造成注入。
- 前端全部用 `textContent` 渲染，不走 `innerHTML`。
- 上传限 8 MB，只接受图片类型，文件名做白名单清洗；静态文件读取做了路径逃逸检查。
- nginx 侧限制请求体 12 MB，并附带 HSTS / `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy`。
- 后台进程以非 root 的 `node` 用户运行（只有 nginx master 需要 root 来监听 443）。

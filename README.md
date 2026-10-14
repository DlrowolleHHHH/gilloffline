# Gill Offline

个人项目橱窗站。主页用「格子」拼成一扇橱窗来陈列项目，管理页带密码，可以增删改格子和拖拽排序。

- 主页 `/`：左上角是 `title.png`，下面是格子组成的橱窗；`logo.svg` 用作站点图标和页脚标记。
  两张图都在 `assets/` 里，页面上按 `/assets/` 访问。
  主页是纯展示的，页面上**没有任何管理入口**，只能靠直接输网址进管理页。
- 管理页 `/admin`：密码来自部署时的环境变量 `ADMIN_PASSWORD`，登录后可编辑一切。
- 部署：一个容器里跑 nginx（TLS + 反向代理）+ Node 应用，证书从宿主机 `/app/ssl` 挂载进容器同一个路径。

```
.
├── assets/                  # 站点自带的图片（logo.svg / title.png），首启时播种到数据目录
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
├── data/site.json           # 示例内容（只读，用来播种运行时数据目录）
├── data.local/              # node 直跑时的运行时数据（自动生成，不进 git）
└── docker/                  # Dockerfile、nginx 配置模板、entrypoint
```

运行时数据和代码是分开的：容器部署的数据全部放在宿主机的 `/app/data`（挂进容器还是这个路径），
仓库里的 `assets/` 只是首次启动时的播种，之后站点服务的是 `/app/data/assets/` 里的那份。
拉代码、重建镜像、甚至删掉整个仓库都不会动到内容。见下面「数据」一节。

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

**类型**分三种：

- **有内容格子**：平时展示图片（支持上传，或直接填图片 URL），可选一个常显的角标文字。
- **HTML 页面格子**：把一个 HTML 页面嵌进格子里，详见下面「HTML 页面格子」。
- **纯色格子**：只填一个底色，用来留白、分隔、补位。

三种格子都可以配**悬浮详情**（常显的角标文字则是有内容格子和 HTML 页面格子才有）。鼠标移上去时详情面板从指定方向滑入：

- `滑入方向`：从左 / 从右 / 从上 / 从下。
- `覆盖比例`：`1/1` 覆盖整个格子，`1/2` 只覆盖一半（从哪边滑入就贴在哪一边）。
- `背景色` / `文字颜色` 自由配，背景色支持 8 位十六进制（末两位是透明度，例如 `#0b0a12f2`）。

格子上还能配一个点击跳转链接。管理页支持导出 / 导入整份 JSON 配置，方便备份和迁移。

## HTML 页面格子

格子里可以直接渲染一个 HTML 页面——橱窗里嵌一小块会动的网页：

- **上传文件**：管理页里选一个 `.html` 上传，文件存进数据目录的 `pages/`，跟着数据一起走，重新部署不会丢。
  同名文件直接覆盖，所以更新页面就是重新上传一次。
- **填地址**：也可以填外链（`https://…`），或者自己把文件放进数据目录的 `pages/` 再填 `/pages/xxx.html`。
- 页面可以带自己的 CSS / JS / 图片：放在同一层目录里、用相对路径引用即可（`pages/` 里的文件都能直接访问），
  也能引用 `/uploads/` 下的图片。

嵌入的页面跑在 `iframe` 的 sandbox 里，**允许 JavaScript，但不给同源权限**：
页面里的脚本读不到本站的 cookie、调不了本站接口，也碰不到外面的主页。
代价是页面自己不能用 `fetch` 取本站的数据（`<script>`、`<img>`、`<link>` 这类标签照常用）。

> 「悬浮详情」的面板会盖住整个格子。做交互型页面时建议把这个格子的悬浮详情关掉，
> 否则鼠标一移上去，详情面板就滑出来把页面挡住了。

## 文件

管理页里有个「文件」面板，可以浏览和管理数据目录里的三块内容，改完立即生效：

| 分类 | 目录 | 页面上的地址 | 放什么 |
| --- | --- | --- | --- |
| 站点资源 | `assets/` | `/assets/…` | 站点自己的图片：`logo.svg`、`title.png` |
| 上传的图片 | `uploads/` | `/uploads/…` | 格子里展示的图片 |
| 嵌入页面 | `pages/` | `/pages/…` | HTML 页面及它自带的 css / js / 图片 |

每个文件都能复制链接、在新标签页打开、删除；上传同名文件就是覆盖。
正在被格子引用的文件会标出「N 个格子在用」，删除前也会提醒。

`assets/` 里那两个文件是首次启动时从仓库的 `assets/` 播种过去的，之后以数据目录里的那份为准：
想换站点图标或标题图，直接在这里传一个同名的上去就行，不用改代码、也不用重新部署
（要用别的文件名也可以，把主页引用它的地方一起改掉即可）。

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

运行时数据写在 `data.local/`（不在 git 里）：首次启动时从 `data/site.json` 拷一份示例内容，
并把仓库 `assets/` 里的图片播种到 `data.local/assets/`（同样是被服务的那一份）。
仓库里的 `data/site.json` 只是示例内容、**只读取种子**，在管理页里怎么改都不会动到它。
想换个地方放运行数据就设 `DATA_DIR`；想让本地预览回到初始状态，删掉 `data.local/` 重启即可。

> 这里说的是 `node` 直跑。用 `build_run.sh` 跑容器时数据放在宿主机的 `/app/data`，
> 见下面「数据」一节——两者互不影响。

## 部署

只需要 Node 后端的话，一条命令构建并启动：

```bash
./build_run.sh
```

脚本会：构建镜像 → 停掉旧容器 → 启动新容器 → 等应用就绪 → 核对数据没被动过 → 打印状态和日志。

```bash
./build_run.sh --update     # 更新代码用这条：git pull → 构建 → 重启，数据原样保留
./build_run.sh --no-build   # 不重新构建，只重启
./build_run.sh --rebuild    # 不用缓存重新构建
./build_run.sh --stop       # 停止并删除容器
./build_run.sh --logs       # 跟踪日志
```

改了代码之后重新部署就跑 `./build_run.sh --update`：它只会把 git 里的新代码拉下来重建镜像。
数据目录（`HOST_DATA_DIR`，默认 `/app/data`）从头到尾只是一个挂载点，不会被写、不会被删，
部署完还会核对一遍 `site.json` 的指纹——内容和部署前不一致会明确警告。

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

#### 用 Let's Encrypt 自动续期

容器里的 nginx 把 `/.well-known/acme-challenge/` 指向 `/var/www/acme`，宿主机目录对应 `HOST_ACME_DIR`（默认 `/var/www/acme`），
所以在宿主机上装个 certbot 就能走 webroot 验证——申请和续期都不用停容器：

```bash
apt install -y certbot
certbot certonly --webroot -w /var/www/acme -d example.com -d www.example.com

# 把签好的证书复制到 /app/ssl，文件名和 SSL_CERT_FILE / SSL_KEY_FILE 对上
cp -L /etc/letsencrypt/live/example.com/fullchain.pem /app/ssl/example.com.pem
cp -L /etc/letsencrypt/live/example.com/privkey.pem   /app/ssl/example.com.key
docker restart gilloffline
```

把最后三条命令存成一个脚本放进 `/etc/letsencrypt/renewal-hooks/deploy/`，
certbot 自带的 `certbot.timer` 每次续期成功后都会自动调用它，容器随即换上新的证书，之后就不用管了。

### 可用环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 无（必填） | 管理页密码。不设置时管理功能整体禁用，不会退化成默认密码 |
| `ICP_NUMBER` | 无 | 页脚中间的 ICP 备案号；管理页里没填过时生效 |
| `HTTP_PORT` / `HTTPS_PORT` | `80` / `443` | 宿主机映射端口 |
| `HOST_SSL_DIR` | `/app/ssl` | 宿主机证书目录，容器内挂在同一个路径 |
| `HOST_ACME_DIR` | `/var/www/acme` | certbot 的 webroot 目录，挂载为容器内 `/var/www/acme` |
| `HOST_DATA_DIR` | `/app/data` | 宿主机数据目录，容器内挂在同一个路径 |
| `SERVER_NAME` | `_` | nginx `server_name`，填你的域名 |
| `SSL_CERT_FILE` / `SSL_KEY_FILE` | `gilloffline.online.pem` / `gilloffline.online.key` | 证书文件名 |
| `CONTAINER_NAME` / `IMAGE_NAME` / `IMAGE_TAG` | `gilloffline` | 容器与镜像名 |
| `TZ` | `Asia/Shanghai` | 容器时区 |

完整示例：

```bash
ADMIN_PASSWORD='你的密码' SERVER_NAME=example.com HOST_SSL_DIR=/etc/letsencrypt/live/example.com ./build_run.sh
```

### 数据

代码在 git 里，内容全在数据目录里，两边彻底分开。数据目录默认是宿主机的 `/app/data`
（和证书目录 `/app/ssl` 一个位置、一个风格），容器里挂在同一个路径：

```
/app/data/site.json        # 全部格子配置
/app/data/.session-secret  # 会话签名密钥（自动生成）
/app/data/assets/          # 站点自己的图片（logo.svg / title.png），首启从仓库播种
/app/data/uploads/         # 上传的图片
/app/data/pages/           # 上传的 HTML 页面（及其 css / js / 图片）
```

这五样东西就是整个站，备份 `cp -a /app/data /somewhere` 就够了。
升级、重建镜像、`--update` 拉代码都不会动这个目录——它只是挂载进容器，没有任何东西往里写。

`--update` 跑完会打印一行「数据校验：site.json 与部署前完全一致」——那就是部署没有动过内容的意思；
如果这行变成警告，说明数据在部署期间被改过，去 `/app/data` 看看。

仓库里的 `data/site.json` 和 `assets/` 都不属于运行时数据：它们只是提交进 git 的初始内容，
只在数据目录里还没有的时候被播种一次（`assets/` 只在那个目录不存在时才抄，之后删掉某个文件不会被重新塞回来）。

从旧版本升级上来时，`build_run.sh` 会把旧数据搬到 `/app/data`（旧目录原样留着不删，确认没问题后可以自己清理）：

- 上一版的数据在 `data.local/` → 整个目录搬过来（含 `.session-secret`，登录状态也不会掉）；
- 更早的版本把上传的图片放在仓库的 `data/uploads/` → 图片复制过来，`site.json` 还是走示例播种。

## 接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/site` | 公开 | 读取整站内容 |
| `GET` | `/api/session` | 公开 | 当前是否已登录、是否配置了密码 |
| `GET` | `/api/health` | 公开 | 健康检查 |
| `POST` | `/api/login` | 公开 | 校验密码，下发会话 cookie |
| `POST` | `/api/logout` | 公开 | 清除 cookie |
| `PUT` | `/api/site` | 需登录 | 覆盖保存整份配置 |
| `GET` `POST` `DELETE` | `/api/files?kind=…` | 需登录 | 列出 / 上传 / 删除文件，`kind` 是 `assets` / `uploads` / `pages` |

## 安全

- 密码只在环境变量里，不落盘；比对用定长哈希 + `timingSafeEqual`。
- 会话是 HMAC 签名的 HttpOnly cookie（`SameSite=Strict`，HTTPS 下自动加 `Secure`），密钥存在数据卷里，重启不掉线。
- 登录失败按 IP 限流：5 分钟内 8 次失败即拒绝。
- 保存的每个字段都在服务端重新校验：颜色只接受十六进制字面量，链接只接受 `http(s)` 和站内路径，避免存进 CSS 或 HTML 里造成注入。
- 前端全部用 `textContent` 渲染，不走 `innerHTML`。
- 上传限 8 MB，每类文件只接受对应的类型（图片；页面那类还接受 HTML / CSS / JS / JSON），
  扩展名跟着声明的 Content-Type 走，文件名做白名单清洗；`/assets/`、`/uploads/`、`/pages/`
  的静态文件读取都做了路径逃逸检查。
- 主页嵌入的 HTML 页面跑在 `iframe sandbox` 里，不给 `allow-same-origin`：页面脚本拿不到本站 cookie、
  调不了本站接口，也读不到外层页面的 DOM（实测 `document.cookie` / `parent.document` / `localStorage` 全部抛 SecurityError）。
  嵌别人的页面进来也不会威胁到管理页。
- nginx 侧限制请求体 12 MB，并附带 HSTS / `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy`。
- 后台进程以非 root 的 `node` 用户运行（只有 nginx master 需要 root 来监听 443）。

# NexoFolio Fetcher

一个运行在 Chrome 原生侧边栏（panel）中的 NexoFolio 捕获扩展。

仓库：[SheldonParsons/NexoFolioFetcher](https://github.com/SheldonParsons/NexoFolioFetcher)。产品品牌已更新；目前仍连接原 AsyncTest 后端，接口、服务地址、认证协议及已有本地配置保持兼容。本地目录暂保留 `AsyncTestFetcher`，避免改变已加载扩展的路径。

当前版本 `0.1.0` 提供欢迎页、NexoFolio 登录（沿用 AsyncTest 接口）、用户头像、持久化登录态、记住账号密码、本地退出和服务配置。配置支持 HTTP/HTTPS、域名/IP、自定义端口及部署路径。

当前提供页面内 XHR/fetch 响应采集能力试用。AsyncTest 是唯一 API 后端，业务请求统一在 `src/api/asynctest/` 管理并由扩展后台发起。

## XHR / fetch 响应采集（能力试用）

- 登录状态已验证、当前平台已授权且明确绑定项目后，打开 panel 自动监听当前活动页面。
- 使用 `chrome.scripting` 在页面 MAIN 环境包装 `fetch` / `XMLHttpRequest`，通过 ISOLATED 桥接传回后台。**不使用 debugger，不触发扩展调试提示条。**
- 最近 **20 条**按请求出现顺序倒序展示 URL、method、类型、时间、HTTP 状态及正文采集状态。点开一条查看正文；正文按需传给 panel，常规列表推送只包含摘要，突发更新每 50ms 合并。
- 点击「查看详情」后，URL / Params 页签展示请求地址与 URL 查询参数（保留顺序、重复名称、空值）；请求页签展示请求 Headers / Body；响应页签展示状态码、响应 Headers / Body。URL 展示独立于列表省略号，超出 1 Mi 字符上限才截断并提示。
- fetch 请求头来自页面的 init.headers 或 Request.headers；XHR 请求头来自成功调用的 setRequestHeader，保留重复设置。响应头来自 Response.headers / getAllResponseHeaders。两侧均标明「页面可见」：浏览器自动附加/修改的 Cookie、Host、Content-Length 等不保证可得，Set-Cookie 和未向页面暴露的跨域响应头不可得，不能声称完整网络报文。单侧最多 256 项、64 Ki 字符，超过时明确标记截断。
- 请求正文支持字符串/JSON 文本、URLSearchParams、ArrayBuffer/视图、Blob 和可复制的 Request 正文。直接传入的 ReadableStream 不会被消费；动态 getter、自定义迭代器等不二次调用，无法读取时标注。FormData 展示有序字段结构，文件只展示名称、类型、大小，不宣称取得文件内容或原始 multipart 字节。请求/响应正文各自最多 1 MiB，读取截止时间 15 秒，超限、超时和不可读分开显示。
- fetch 读取 `Response.clone()` 副本，不消费原始 Response；XHR 读取浏览器已得到的 response。支持文本、JSON、ArrayBuffer、Blob，二进制以 Base64 展示；XHR JSON 是已解析对象的重新序列化，不是逐字节原始文本。XHR document 类型暂不支持。
- 每条最多读取 **1 MiB** 正文；每个 frame 最多同时读取 6 个正文副本。等待响应最多 30 秒，收到 fetch 响应后读取正文最多 15 秒。达到上限、超时、不可读和读取失败均单独标记；流式响应只保留限额/时限内读取的前段，不宣称完整。
- 切换标签页、浏览器窗口、页面导航/刷新或 SPA URL 变化时，只停止旧页面采集，**不清空已有记录**。新页面通过授权、绑定和成员资格检查后继续向同一个列表追加；未授权、未绑定或不支持的页面不新增采集，但仍可查看旧记录。最近 20 条是跨页面滚动缓冲，新记录在上，第 21 条进入时仅淘汰最旧一条。
- 监听生命周期与记录缓冲独立：停止、重连、切页、项目绑定变化不会主动整批清空。尚未读完的旧页面响应会标记采集已停止，不再继续读取；已收到的正文保留。panel 的记录订阅不依赖当前页面是否已绑定。
- 拦截撤销时仅恢复仍属于本插件的包装函数，取消响应副本读取和本插件事件监听，不中止原请求。桥接断开会清理拦截，另有 15 秒租约兜底，防止扩展刷新后旧脚本长期运行。
- 数据只保留在后台内存，不持久化、不导出、不上传到 AsyncTest；采集页面可见的请求/响应信息，不重发接口。

更新后，在扩展管理页刷新扩展，再刷新业务页面并重新打开 panel。旧版调试连接随扩展重载释放。Chrome 可能要求确认新增的 `scripting` 权限。

这是页面内能力试用，**不等同于完整网络录制**：

- 注入前已发出的请求、页面提前缓存的原始 fetch/XHR 方法、独立 Worker / Service Worker 中发起的请求无法保证覆盖。页面 fetch 经 Service Worker 返回的可读响应仍可通过页面的 Response 副本采集。
- 主页面及已获浏览器主机许可的 HTTP(S) iframe 尝试注入；未许可的跨域 iframe、about:blank/srcdoc/sandbox 等特殊框架不承诺覆盖，不自动申请额外主机权限。
- opaque / opaqueredirect 响应遵守页面读取限制，无法取得正文。页面可能替换、干扰包装函数或桥接消息，所以采集数据属于不可信页面数据，不作为鉴权或后台指令。桥接不包含 AsyncTest Token 或记住的密码。
- 页面包装不是完全透明的网络旁路：改变函数引用，响应副本有额外读取/内存开销；浏览器流的 tee 行为无法提供严格的进程内存上限。代码限制主动保存的正文大小和并发，但不承诺对所有站点零影响。
- 观察到请求不代表服务器实际收到它；HTTP 错误码仍会尝试读取正文。正文为空与正文不可读分别显示。

## 平台授权与项目绑定

登录前仍走原有欢迎/登录流程。登录并验证后，panel 会读取所在浏览器窗口的当前活动标签页，在切换标签页、页面导航和重新显示 panel 时更新平台状态。

1. 未授权的平台：确认地址和路径范围，点击「授权并选择项目」。浏览器访问许可与插件内的平台授权分别记录。
2. 已授权但未绑定：从 AsyncTest「已加入项目」可滚动列表中选择，支持搜索及加载更多；保存前重新核对项目仍可访问。不会自动创建项目。
3. 已绑定：以紧凑的“当前平台 → 绑定项目”展示对应关系，不常驻显示完整页面地址。点击头像菜单可调整/添加项目、为当前路径单独绑定或解除当前项目绑定；范围和项目编辑页都有无需保存的返回入口。

绑定以 **完整 origin（协议、域名/IP、端口）+ 路径前缀** 区分，采用按路径段的最长前缀优先。例如：

| 范围 | 项目 | 生效范围 |
| --- | --- | --- |
| `https://presalescloud.gree.com/` | 客户端 | 没有更具体规则时使用 |
| `https://presalescloud.gree.com/admin` | 管理端 | `/admin` 及其子路径，覆盖根规则；不匹配 `/administrator` |

不会推测业务客户端边界。若先把整站绑定到客户端，访问 `/admin` 时可使用「为当前路径单独绑定」增加管理端规则。平台名称默认填入已有名称或页面标题，授权时可以编辑，之后也能从头像菜单「修改平台名称」调整；名称随地址范围保存，不影响路径匹配或项目绑定。路径选项只来自当前 URL；不解析页面内容来推测业务名称。

同一范围允许绑定多个项目，有歧义时由用户选择当前标签页使用的项目；选择保留在当前浏览器会话中。不同域名、IP、端口或路径范围均可绑定同一个项目，例如同一项目的开发/测试/生产环境入口，不存在项目只能被一个地址使用的限制。解除子路径的项目绑定后保留该范围，避免静默退回根路径项目。

授权范围和项目关系仅保存到插件本地，按 AsyncTest 服务基础地址与用户 ID 隔离。平台匹配使用 URL pathname，不把 query 或 hash 自动当作平台边界；捕获生命周期仍在 URL变化时切换，防止旧页面继续监听。当前不包含持久化录制、页面元素采集或自动上传。

Chrome 主机访问许可不按路径隔离，插件额外执行上述路径规则；不同端口仍是不同的插件平台范围。切换到尚未授权的新页面时，新增的 `tabs` 权限用于读取地址/标题，平台授权前不读取页面正文。地址读取不代表获得捕获授权；访问 AsyncTest 后端的既有许可也不会自动授权捕获其页面。

## 开发环境

- 固定开发目录：`/Users/sheldon/Documents/GithubProject/AsyncTestFetcher`，直接在 `main` 分支开发。除非用户明确要求，不创建独立 worktree。
- Node.js 22 或更高版本（使用 nvm 时运行 `nvm use`）。
- Chrome 125 或更高版本，Manifest V3。

```sh
cd /Users/sheldon/Documents/GithubProject/AsyncTestFetcher
nvm use
npm ci
npm run build
```

依赖版本已通过 `package-lock.json` 锁定。构建会从原始 SVG 生成 Chrome 所需的 PNG 图标，并将可加载产物放在 `.output/chrome-mv3`。

## 在 Chrome 加载

1. 打开 `chrome://extensions`，开启右上角「开发者模式」。
2. 点击「加载未打包的扩展程序」。
3. 选择本项目中的 **`.output/chrome-mv3`** 文件夹（不是源码根目录）。
4. 将 NexoFolio Fetcher 固定到工具栏，点击图标打开 panel。
5. 通过「配置 NexoFolio 服务」填写后端基础地址，点击登录时允许 Chrome 访问该服务，再使用现有账号登录。

当前开发目录下可直接加载的完整路径：

```text
/Users/sheldon/Documents/GithubProject/AsyncTestFetcher/.output/chrome-mv3
```

此目录由 `npm run build` 生成，不需要开发服务器持续运行。macOS 文件选择器中可以按 `⌘⇧G` 粘贴完整路径。源码修改后重新构建，再在扩展管理页刷新扩展。

若此前加载的是 Codex worktree 下的扩展，请改为加载上面的新目录。Chrome 可能将不同路径识别为不同的未打包扩展；新加载后如果配置/登录信息未保留，重新配置并登录即可。

Chrome 的用户设置决定侧边栏位于左侧还是右侧，界面按右侧窄栏设计。关闭并重新打开 panel 后，已保存的服务配置仍保留。配置校验只检查地址格式，**不代表服务器连通性已验证**。

服务地址填写 **API 基础地址**，包含反向代理的部署前缀。例如直连本地后端可填 `http://localhost:6001`；沿现有公网 Web 代理通常填写 `https://asynctest.com/server`。程序保留地址中的端口和路径，不会猜测、试发或自动添加 `/api`、`/server`。部署差异以你的服务为准。

## 登录与会话

- 登录：`POST {base}/anonymous/login/`，JSON `username/password`。鉴权格式为 `Authorization: token=<不透明凭证>`，不是 Bearer/JWT。
- 恢复或手动验证：`GET {base}/user/me/`，获取真实用户信息和完整 `avatar_url`。轻量定期验证使用 `GET {base}/token/check`。仅在 panel 可见时定期检查；浏览器关闭期间不发请求。
- 登录态保存在 `chrome.storage.local`，按完整基础地址隔离，关闭 panel 或浏览器后仍保留。服务器明确失效（401、403/1001 或 check 返回 0）时清除；断网、5xx、非鉴权 403、权限撤回保留登录资料，标记为待验证，不当作已验证权限。
- 切换服务不会把旧服务的 Token 发给新服务；回到已登录的服务时可恢复该服务的会话。不会按本地固定天数擅自过期，也不会自动重发密码登录。
- **退出仅清除当前服务在插件中的本地登录态。** 按用户要求不调用后端的账号级退出接口，不影响其他客户端，也不宣称撤销服务端 Token。
- 重复登录是否复用未过期 Token 取决于服务端部署版本。历史提交 `90aa3be`（2026-01-03）加入了复用逻辑；`d4c41bd`（2026-09-08）删除了这段逻辑，已核对的本地后端 `95e8e0f` 会重新生成并替换旧 Token。插件不将这一版本的行为作为所有服务的通用提示，也不修改服务端策略；配置服务的实际部署版本尚未逐一核实。

会话只保存 Token 和最小用户资料，不保存 `private_key` 或整个登录响应。Token 不通过后台消息返回给页面，不给头像 URL 附加 Authorization。头像显示后端提供的 URL（保留版本参数），加载失败显示昵称首字。

“记住账号和密码”默认开启。只有本次真实登录成功后才更新所选服务的账号密码，失败不会覆盖上次成功记录。下次进入登录页会回填，密码默认隐藏；退出登录和 Token 失效不会删除记住的密码。取消勾选会立即清除当前服务保存的账号密码，并保持关闭偏好。凭据按完整基础地址隔离，读取接口只向可信 panel 提供当前服务的记录。

## Logo 动画与登录后布局

- 静态图形以用户提供的 `public/nexofolio-icon.svg` 和 `public/nexofolio-logo-wordmark.svg` 为准，透明背景，路径不变；Chrome 16/32/48/128 图标由纯图标生成。欢迎页完整展示图标和轮廓字标，登录页使用纯图标配“登录 NexoFolio”，避免重复大字标。
- 原生 SVG/Vue 动效移植自 2026-09-14 的 MOTION STUDY / 04。欢迎页大 Logo hover 和键盘聚焦触发：两片 3600ms 展开、错位起伏、反向回应、靠拢；右片浅彩 5600ms 流转，左片和文字纯黑。移入/移出 480ms 平滑衔接，移出回纯黑，保留 opacity 0.24 / blur 25px 的柔和光晕。不会跳页或触发登录。
- 登录成功转场总长固定 **3000ms**：两片汇合、字标出现，右片 1120–2020ms 回黑，2020–2320ms 全黑停留，2320–3000ms 整层淡出。没有演示欢迎页；真实账号/平台页在遮罩下并行加载，超时或失败露出真实状态，动画不等待请求延长。
- 仅显式登录成功触发。会话恢复不播放；重复触发以 runId 替换旧实例，取消、注销、卸载清理计时器和 RAF。每实例独立 gradient ID，支持减少动态效果（关闭位移/旋转/缩放和持续流彩）、后台标签暂停 hover、转场回来按实际经过时间结束。转场获得焦点，底层 inert，结束交还目标页标题。
- 头像、昵称、账号及退出按钮放在底部；头像菜单提供服务配置。服务值、API 路径、token/session、`asynctest.*` 存储 key 和内部消息协议保留原有契约，不因显示品牌更名而迁移。

## 可选的热更新模式

在开发目录运行 `npm run dev`，保持命令运行，按 WXT 输出的目录加载开发产物（默认 `.output/chrome-mv3-dev`）。此模式依赖本地开发服务器；它与上面的独立构建目录不同，不要混用。命令不会自动打开浏览器或安装扩展。

## 结构

```text
src/
  api/asynctest/               唯一后端 API：请求、错误、登录/鉴权/用户资料
  auth/                       后台会话所有者、持久化、页面消息协议
  capture/                    页面 fetch/XHR 拦截、隔离桥接、20条正文缓冲及消息推送
  entrypoints/background.ts    工具栏、可信 panel 消息入口
  entrypoints/sidepanel/       panel 入口和页面切换
  ui/views/                   欢迎、登录、账号、服务配置页面
  ui/components/              Morphicons 图标和服务摘要
  ui/motion/                  共享 Fetcher Logo 动画与减少动态效果处理
  ui/styles/                  黑白灰主题和 Transitions.dev 动效
  settings/                   服务地址校验与本地保存
public/                       原始 Logo 与生成的 PNG 图标
scripts/build-icons.mjs        可重复执行的图标构建
wxt.config.ts                 扩展清单和构建设置
```

UI 使用 Vue 3、Reka UI、Morphicons + Lucide，页面切换采用 Transitions.dev 的 Panel reveal CSS。依赖/素材来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。没有引入 Prettier、Naive UI 或额外状态管理框架。

## 权限和数据

固定权限为 `sidePanel`、`storage`、`tabs`、`scripting` 和 `webNavigation`；HTTP/HTTPS 主机权限为可选，在用户点击登录/重新验证或平台授权时申请相应主机。项目列表通过唯一的 AsyncTest 后端读取，捕获模块不向业务站点重发接口请求。只在授权/绑定检查通过后按文档注入采集脚本，没有常驻全站内容脚本或任意 URL 代理。Logo、字体（系统字体）、组件代码均在本地；头像来自后端给出的资源地址。

服务配置、Token、最小用户资料以及用户选择记住的账号密码存储在 `chrome.storage.local`，没有额外的密码加密层。访问级别限定为扩展可信上下文，可以访问该浏览器配置或扩展调试工具的人仍可能查看本地数据。扩展卸载会移除扩展本地存储。

## 验证约定

默认仅完成代码修改和必要构建，由用户自行审核。除非用户明确要求，不运行测试、浏览器 QA 或额外验收套件。

用户授权测试时，测试代码放在 `/Users/sheldon/Documents/AsyncTest/ast-testing-core`，截图、报告等放在 `/Users/sheldon/Documents/AsyncTest/ast-testing-core-data`。类型检查、构建、普通网页中的 UI 验证和真实 Chrome 扩展验收分别报告，不互相替代。

`.gitignore` 排除依赖、构建产物、WXT 缓存、本地环境文件、编辑器临时文件及验证数据。提交源码、锁文件、Logo素材和必要文档；构建目录由本地命令生成，不推送到 Git。

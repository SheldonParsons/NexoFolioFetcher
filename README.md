# NexoFolio Fetcher

一个运行在 Chrome 原生侧边栏（panel）中的 NexoFolio 捕获扩展。

仓库：[SheldonParsons/NexoFolioFetcher](https://github.com/SheldonParsons/NexoFolioFetcher)。登录和项目绑定已迁移至 NexoFolio /v1 API。首次加载新版会清理本插件旧数据并记录一次性迁移标记；需重新配置 NexoFolio 基地址和登录。

当前开发版本（见 `package.json`） 提供欢迎页、NexoFolio 登录、NexoFolio 个人头像（失败回退昵称首字）、持久化登录态、本地退出和服务配置。配置支持 HTTP/HTTPS、域名/IP、自定义端口及部署路径。

当前提供页面内 XHR/fetch 响应采集能力试用。NexoFolio 平台 API 统一在 `src/api/nexofolio/` 管理并由扩展后台发起；用户主动发送的业务调试请求由独立的 `src/replay/` 模块处理。

## XHR / fetch 响应采集（能力试用）

- 登录状态已验证、浏览器已允许访问当前站点且服务端有该站点的绑定时，后台自动监听当前活动标签页；不依赖 panel 打开或可见，没有开始/结束/增强模式开关。
- 使用 `chrome.scripting` 在页面 MAIN 环境包装 `fetch` / `XMLHttpRequest`，通过 ISOLATED 桥接传回后台。**不使用 debugger，不触发扩展调试提示条。**
- 最近 **20 条**按请求出现顺序倒序展示。列表使用单行组件：请求方法、path（不含域名/query/hash）、响应码；长路径省略，悬停可查看 path。等待响应时显示轻微脉动点，拿到 HTTP 状态后按先退后进顺序切换为状态码，新请求以短淡入/位移动画出现。支持减少动态效果。
- 点击接口行进入专用详情视图，按需读取一条原始记录，独立编辑 URL、参数、Headers 和 Body，再由用户手动发送。原始采集与发送结果分别显示，编辑不改写证据或上传队列。列表不展示请求出现时间，也不把它误标成响应耗时。单条读取上限和完整性标记继续保留在数据中。
- fetch 请求头来自页面的 init.headers 或 Request.headers；XHR 请求头来自成功调用的 setRequestHeader，保留重复设置。响应头来自 Response.headers / getAllResponseHeaders，不能声称完整网络报文。单侧最多 256 项、64 Ki 字符，超过时标记截断。请求 URL 最多 1 Mi 字符，超出有 urlTruncated；Params 可由 URL 派生，保留重复参数。
- 请求正文支持字符串/JSON 文本、URLSearchParams、ArrayBuffer/视图、Blob 和可复制的 Request 正文。FormData 保留字段结构，文件仅元数据；不消费原始上传流。请求/响应正文各自最多 1 MiB，读取截止时间 15 秒。
- fetch 读取 `Response.clone()` 副本，不消费原始 Response；XHR 读取浏览器已得到的 response。支持文本、JSON、ArrayBuffer、Blob，二进制以 Base64 展示；XHR JSON 是已解析对象的重新序列化，不是逐字节原始文本。XHR document 类型暂不支持。
- 每条最多读取 **1 MiB** 正文；每个 frame 最多同时读取 6 个正文副本。等待响应最多 30 秒，收到 fetch 响应后读取正文最多 15 秒。达到上限、超时、不可读和读取失败均单独标记；流式响应只保留限额/时限内读取的前段，不宣称完整。
- 切换标签页、浏览器窗口、主文档导航/刷新时，只停止旧页面采集，**不清空已有记录**。新页面通过授权、绑定和成员资格检查后继续向同一个列表追加；未授权、未绑定或不支持的页面不新增采集，并隐藏监听区域，仅显示授权/绑定引导；历史缓冲仍保留。最近 20 条是跨页面滚动缓冲，新记录在上，第 21 条进入时仅淘汰最旧一条。
- 每条记录显示上传状态：采集中 / 待上传 / 已确认 / 被拒绝（附原因，如「绑定的项目不存在或无权访问」）。被拒绝的原始记录保留在本地，列表上方汇总各原因的条数。
- 监听生命周期与记录缓冲独立：停止、重连、切页、项目绑定变化不会主动整批清空。切走时停止新采集，已发出的HTTP最多有界收尾47秒，保持原项目环境和请求发出时的上下文；文档销毁或期限到达则明确标记中断，已收到的正文保留。panel 的记录订阅不依赖当前页面是否已绑定，显示则仅限已授权绑定且未进入配置编辑的页面。
- 拦截撤销时仅恢复仍属于本插件的包装函数，取消响应副本读取和本插件事件监听，不中止原请求。桥接断开会清理拦截，另有 15 秒租约兜底，防止扩展刷新后旧脚本长期运行。
- 最近20条只是界面内存缓冲；待上传观测、批次和生产者ID独立存储在本扩展 IndexedDB。授权范围内的观测不脱敏，按明确项目/环境/服务发送到 NexoFolio；不会自动重放业务接口，手动调试结果也不会自动加入队列。容量耗尽暂停新增采集，不淘汰未确认数据。

更新后，在扩展管理页刷新扩展，再刷新业务页面并重新打开 panel。旧版调试连接随扩展重载释放。Chrome 可能要求确认新增的 `scripting` 权限。

这是页面内能力试用，**不等同于完整网络录制**：

- 注入前已发出的请求、页面提前缓存的原始 fetch/XHR 方法、独立 Worker / Service Worker 中发起的请求无法保证覆盖。页面 fetch 经 Service Worker 返回的可读响应仍可通过页面的 Response 副本采集。
- 主页面及已获浏览器主机许可的 HTTP(S) iframe 尝试注入；未许可的跨域 iframe、about:blank/srcdoc/sandbox 等特殊框架不承诺覆盖，不自动申请额外主机权限。
- opaque / opaqueredirect 响应遵守页面读取限制，无法取得正文。页面可能替换、干扰包装函数或桥接消息，所以采集数据属于不可信页面数据，不作为鉴权或后台指令。桥接不包含 插件内部 Token 或登录密码。
- 页面包装不是完全透明的网络旁路：改变函数引用，响应副本有额外读取/内存开销；浏览器流的 tee 行为无法提供严格的进程内存上限。代码限制主动保存的正文大小和并发，但不承诺对所有站点零影响。
- 观察到请求不代表服务器实际收到它；HTTP 错误码仍会尝试读取正文。正文为空与正文不可读分别显示。

环境配置完成后，同一文档的 SPA 路由切换不会再卸载/重装主页面拦截：MAIN 与 ISOLATED 都同步按 origin、pathname 前缀和更具体规则边界判断，后台在现有监听继续工作的同时重新核对登录与绑定。同 URL 的重复调用分别保留，不按 URL 去重。真正刷新/加载新文档仍需要重新注入，注入前的首屏请求尚不保证覆盖。

## 站点绑定

登录前仍走原有欢迎/登录流程。登录并验证后，panel 会读取所在浏览器窗口的当前活动标签页，在切换标签页、页面导航和重新显示 panel 时更新站点状态。

站点归属由 NexoFolio 服务端的站点登记决定。打开页面时插件调用 `GET /v1/sites/lookup?url=`（不带 Token），服务端按最长前缀返回站点范围、项目和环境：

1. 服务端找到绑定：卡片展示页面标题、项目和环境。若浏览器尚未允许访问该主机，只显示「允许访问此站点」，点击后即可采集；Chrome 主机许可就是唯一的采集授权。
2. 服务端没有绑定：点击「绑定此站点」，依次选择 **站点范围 → 项目 → 环境**，保存时 `PUT /v1/sites` 写回服务端。之后登录同一服务的任何插件打开该地址都直接使用这条绑定。
3. 已绑定：头像菜单可「更换绑定项目」「更换环境」或「为当前路径单独绑定」。服务端没有删除接口，换绑就是对同一范围重新 PUT；平台名称不再单独保存，卡片直接用页面标题。

绑定以 **完整 origin（协议、域名/IP、端口）+ 路径前缀** 区分，采用按路径段的最长前缀优先。例如：

| 范围 | 项目 | 生效范围 |
| --- | --- | --- |
| `https://presalescloud.gree.com/` | 客户端 | 没有更具体规则时使用 |
| `https://presalescloud.gree.com/admin` | 管理端 | `/admin` 及其子路径，覆盖根规则；不匹配 `/administrator` |

每个范围只对应一个项目和一个环境；不同域名、IP、端口或路径范围可以绑定同一个项目。路径选项只来自当前 URL，不解析页面内容来推测业务名称。

查到的绑定缓存在本地 `nexofolio.sites.v1:<服务地址>`，只是服务端数据的副本：内容变化时才写入；服务端暂时连不上时按缓存继续显示和采集，并提示「无法连接 NexoFolio，暂按本地缓存的绑定显示」。已知的更具体范围作为当前采集的边界，进入这些路径时重新核对绑定。平台匹配使用 URL pathname，不把 query 或 hash 当作边界。

旧版本插件的本地绑定（`nexofolio.platforms.v1:<服务>:<用户>`）在登录后迁移：一个范围只有一个项目的，直接写到服务端（服务端已有同一范围时以服务端为准）；一个范围有多个项目的，在打开该范围页面时提示用户选一个。迁移完成的范围从本地删除；网络失败留待下次重试，项目或环境已不存在的范围直接丢弃。

Chrome 主机访问许可不按路径隔离，插件额外执行上述路径规则。切换到尚未允许的新页面时，`tabs` 权限只用于读取地址/标题，不读取页面正文。访问 NexoFolio 后端的既有许可也不会自动授权捕获其页面。页面元素采集、正式接口文档生成和裁决仍不包含。

## 开发环境

- 固定开发目录：`/Users/sheldon/Documents/GithubProject/NexoFolioFetcher`，直接在 `main` 分支开发。除非用户明确要求，不创建独立 worktree。
- Node.js 22 或更高版本（使用 nvm 时运行 `nvm use`）。
- Chrome 125 或更高版本，Manifest V3。

```sh
cd /Users/sheldon/Documents/GithubProject/NexoFolioFetcher
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
5. 新安装默认使用「公网灰度 / https://nexofolio.net/api」，无需先配置或保存服务，直接点击登录、允许 Chrome 访问该服务，再使用现有账号登录。需要连接其他服务时再进入服务设置。

当前开发目录下可直接加载的完整路径：

```text
/Users/sheldon/Documents/GithubProject/NexoFolioFetcher/.output/chrome-mv3
```

此目录由 `npm run build` 生成，不需要开发服务器持续运行。macOS 文件选择器中可以按 `⌘⇧G` 粘贴完整路径。源码修改后重新构建，再在扩展管理页刷新扩展。

若此前加载的是 Codex worktree 下的扩展，请改为加载上面的新目录。Chrome 可能将不同路径识别为不同的未打包扩展；新加载后如果配置/登录信息未保留，重新配置并登录即可。

Chrome 的用户设置决定侧边栏位于左侧还是右侧，界面按右侧窄栏设计。关闭并重新打开 panel 后，已保存的服务配置仍保留。配置校验只检查地址格式，**不代表服务器连通性已验证**。

默认服务由用户明确指定为「公网灰度 / https://nexofolio.net/api」。读取配置时，仅对未保存服务配置的安装提供默认值；已有自定义名称和地址始终优先，不覆盖旧配置、会话或上传队列。服务设置仍可修改实际部署的 **NexoFolio API 基地址**（可以含代理前缀）。插件只在用户明确登录时请求 Chrome 对该服务的访问权限，不因提供默认值而自动登录或自动授权，也不直连禅道。

## 一次性迁移

新版后台在任何会话/项目/采集管理器启动前执行 `src/migrations/nexofolio.ts`。先停止旧页面拦截和移除注册内容脚本，再清理本扩展 `storage.local/session/sync`、本扩展 origin 的 CacheStorage/IndexedDB，以及本扩展可选域名权限；最后写入 `nexofolio.migration.backend-v1` 标记。失败不标记成功，后续可重试。旧版后台随扩展重载终止，新 RPC 和采集协议隔离旧 panel，阻止旧异步消息写回。

迁移只针对本扩展，不删除业务网站 Cookie、历史或其他扩展数据。旧源码没有使用 localStorage 或额外持久捕获数据库。正常切换 domain 和后续启动不会重复清理；无需重复手动重置标记。构建产物本身不代表已安装实例已重载、清空。

## 登录与会话

- 登录：`POST {base}/v1/auth/login`，JSON 只发送 `account/password`，使用禅道账号，但密码仅交给 NexoFolio；插件恢复“记住账号和密码”，默认勾选；仅真实登录成功后按完整服务地址保存，取消勾选立即删除当前服务的保存记录，退出或 Token 过期不删除记住的密码。登录失败不覆盖上次成功记录。登录请求等待最多 65 秒，以覆盖后端认证与同步。
- 返回 `user`、内部 `nfi_` Token、Bearer 类型、`expires_at`、`token_reused`、`project_sync`。用户 ID 和项目 ID 均为本地 UUID，不能使用旧 AsyncTest 或禅道数字 ID。当前接口无头像字段，显示昵称首字。
- 恢复与周期验证：`GET {base}/v1/auth/me`，`Authorization: Bearer <内部Token>`。不重调登录、不自动续期。保存后端返回的到期时间，不本地延长三个月。只有显式成功登录播放 3 秒动效。
- Token/最小用户资料/后端到期时间/项目同步状态保存于 `nexofolio.auth.v1:*`，按完整服务地址隔离。`project_sync=failed` 登录仍成功，显示同步失败提示；skipped 显示未同步，使用已有权限。不调用独立同步接口。
- 受保护接口 401 清除对应会话；403 项目无权限、503 权限待确认、404 项目不存在、网络错误不清有效 Token。离线恢复显示待验证，不伪造空列表。登录端点 401 表示本次凭据未通过，不擅自撤销其他已有会话。
- 退出仅删除插件当前服务的本地会话，回欢迎页，没有调用服务端注销接口。未勾选时不持久化密码；已勾选时仅本扩展本地保存，不日志输出。表单卸载清空内存字段。Token 始终独立持久化，不受记住密码开关影响。

## NexoFolio 项目协议

- `GET /v1/projects?page=...&limit=50` 读取 `{items,page,limit,total}`，按实际分页和 total 加载。后端不支持 search 参数，因此输入框只筛选已加载项目，加载更多可继续补充结果。
- 卡片保留 status、can_access、access_state、reason_code。closed/wait 不自动判无权限，按 can_access 控制选择。
- `GET /v1/projects/{UUID}` 是绑定和恢复准入校验，不再按名字搜索项目。403/PROJECT_ACCESS_DENIED、503/PROJECT_ACCESS_UNAVAILABLE 分别展示准确提示；无权限不能写绑定。
- 上传调用 `POST /v1/collect/batches`，不带登录 Token：批次自带项目/环境/站点，服务端只校验。登录只用于选项目和环境；退出或换账号不影响已入队记录的上传。内部登录 Token 不用作 MCP Token。

## 环境与持久上传队列

范围（domain + path，通常为 /）先选项目，再立即加载该项目环境。每个上传批次携带当时的项目、环境和站点范围。无项目或无权限项目不查询环境；切项目清空不适用的旧选择，迟到的旧响应不会回灌。环境与项目绑定一起保存：支持手填中文名称（1–64 Unicode 字符，不含控制字符）或通过 `/v1/projects/{UUID}/environments` 分页选择已有环境。名称不能由 domain 推断。选择环境保存稳定 ID；手填名称在保存绑定时创建或复用环境，再保存 ID。按名称的旧队列上传后，也可从可信回执缓存解析后的 ID 供未来观测使用。改名后使用稳定 ID，不改写任何已入队观测。没有额外接口服务标识；多个 domain 可共用同一项目和环境。

契约固定在 `src/contracts/collect/`，是后端 `contracts/collect/v1` 的副本（`npm run contract:sync` 从相邻的 NexoFolio 仓库同步）。构建校验 manifest SHA-256，用 AJV 核对全部 fixtures 与 Schema 判定一致，再生成静态校验器；批次上限也从 manifest 读取，运行时不使用动态 eval。

- 每条 HTTP 记录是 `http_exchange` version 1：请求/响应原样上传，不脱敏、不改写 URL、不为凑上限截断。采集状态映射为 full/truncated/unreadable/none；超时或读不到的正文标为 unreadable 并在 note 写原因，页面看不到的请求头（Cookie 等）标 partial。页面 URL、标题、producer UUID、page/frame/view、操作 ID、序号和起止时间放在 context。
- 批次 target 为项目、环境（`{id}` 或 `{name}`，按名称时服务端自动创建）和采集站点（origin + prefix）；同一 target 的记录才同批。
- IndexedDB `nexofolio-upload-v1` 保存 draft、终态记录、批次和 producer UUID。旧 assets 存储保留但不再读写。原始数据不脱敏，正文、业务凭据和内部 Token 不打印到日志或公开 fixtures。队列状态由接口行的黑白方格流动背景表示：采集/待上传轻动、实际发送增强、接收确认后填满淡出；失败保留细纹理，列表标题的提示图标可查看错误/保留数量。
- 更新门禁不重写历史批次：已有 collect 批次按原 ID/正文重试，旧 ingestion 格式原样保留，不因版本更新重新转换或作废。运行版本在独立请求头传递；新采集项冻结出处版本，未记录出处版本的历史项不补造成当前版本。
- 先落盘再发，批次 UUID 在组批时持久化；重试原样重发、复用批次 ID，服务端只计一次。50条、约4MiB 或首条就绪后约1秒触发组批；后端上限50条/8MiB批次/4MiB单条，按 UTF-8 JSON 字节计量。超限或不符合契约的记录保留 failed，不偷偷删除。
- 回执必须通过 Schema，并核对 batch ID、逐条 index/记录 ID 和总数；未列入 rejected 的记录即被接收并从队列删除，rejected 保留为失败项及原因。413 拆批（单条则失败为 RECORD_TOO_LARGE），404 UNKNOWN_PROJECT/UNKNOWN_ENVIRONMENT 与 400 标失败，409 换新批次 ID 重发；429/503/网络错误保留原批，遵守 Retry-After，最长间隔60秒。接收只表示可靠收讫，不表示已生成接口文档。
- 队列本地上限256MiB/5000条（失败项也占容量），每个已开始观测预留最坏编码空间48MiB。页面通过容量 credit 开始采集；容量/存储不可用则暂停新增，业务请求照常执行。持久 draft 在冷启动时以明确 unreadable 状态结算，不能假装 complete。
- 每30秒 alarms 唤醒检查待上传队列，且有前台定时 flush。

## 持续录制与最小采样

当前只上传 HTTP 记录；页面、操作和表单样例（page_context/interaction/ui_snapshot）暂停上传，采样只用于给 HTTP 记录附页面标题和操作 ID。下面的采样规则保留，供以后恢复。

- 后台启动、当前tab切换、导航和alarms协调录制，侧栏只订阅显示；关闭侧栏或编辑未提交配置不停止。实际撤权/解绑/退出/切服务/离开授权范围停止新采集，不丢已排队数据。
- 页面上下文包含chrome.storage.session保存的browser_instance_id（SW重启复用，浏览器会话结束后换新）、Chrome顶层document对应page UUID和独立frame UUID、每次视图变化的view_id、按frame/view分配的event_seq、可选interaction_id。HTTP请求开始时冻结page_url与request_started_at_ms；仅实际完成/失败的响应附response_completed_at_ms，超时/截断/不可读不虚构网络完成时间。
- 初始页面和路由变化只记录 URL、标题和能力缺口；保留有意义的 click/change/submit。移除整页 DOM 扫描，以及 input、mutation、scroll、resize 的独立采样。
- 按钮点击或 submit 的事件捕获阶段，同步读取相关表单一次，生成 ui_snapshot；同次派发期间开始的 HTTP 共用操作 ID，不在每个 XHR/fetch 中读取 DOM。关联范围包括真实 form（含显式 form= 控件）、role=form/search，以及 Element/Ant 等具有明确组件标识的 div 表单。弹窗外置按钮只关联同弹窗内唯一可见表单；存在多个可见独立表单/面板时回退目标。通用布局只检查最多6层祖先中的最小带标签/字段组容器，排除 body/html/main/app 和无标识的页面根、结果表格或多个独立操作分支，不能退回全页采样。
- 每份采样共用2000个局部节点、80个可见控件、100个实际可见/已选选项、24576字符预算，快照还有128KiB输出上限。值、标签存在长度上限；complete=false 并标记部分选项/值截断限制，present:null、unknown:null、omitted:null保持区别。不推断完整枚举，不把未观察到的值当成请求字段省略。
- 自定义下拉按明确 aria-controls/aria-owns 读取所属选项，只保留实际可见或已选择内容；控件实际 data-value、具名隐藏输入值、已选择选项的真实值可作为观测。仅显示标签而无真实值时为 unknown，不把标签猜成ID，也不把 placeholder 当已选择枚举。隐藏非活跃面板/关闭弹窗不参与归属选择。
- 插件无感持续观察，不假设用户在录制业务任务。role=tab 等切换只保留可观察点击线索；同URL的A/B交错、弹窗切换均重新读取局部控件，不缓存或继承A表单值/选项。A请求晚到仍保留A起点，不将邻近操作拼成业务会话。
- 操作 ID 仅在所观察事件仍处于派发阶段时可用；不沿用到事件结束后的轮询/定时器请求，不改写 Promise 或定时器建立伪因果。延迟/防抖/异步请求可能无法关联，记录 ASYNC_REQUEST_CORRELATION_UNAVAILABLE。快照是 PRE_HANDLER_STATE_ONLY，不能代表后续业务代码修改后的值；click 和 submit 是两个独立派发时分别记录，不靠相近时间合并。
- 采样的原始 observed_at_ms 直接写入 captured_at，HTTP 使用已冻结的 request_started_at_ms，不用后台收消息或入队的时间替代；没有合法时间的样本不补造时间。晚到响应保留请求开始时的页面、操作和归属。
- 不截图，也不申请截图专用 `<all_urls>`。授权时只申请当前平台主机。历史图像资产不再上传。插件不调用模型。
- 整页加载仍有初始注入窗口，记录DOCUMENT_START_NOT_COVERED，不能宣称完整网络录制；Worker、未许可/特殊frame等盲区不伪装成已覆盖。真实Chrome录制由用户验收，禁止Ego Lite与自动浏览器操作。

## Logo 动画与登录后布局

- 静态图形以用户提供的 `public/nexofolio-icon.svg` 和 `public/nexofolio-logo-wordmark.svg` 为准，透明背景，路径不变；Chrome 16/32/48/128 图标由纯图标生成。欢迎页完整展示图标和轮廓字标，登录页使用纯图标配“登录 NexoFolio”，避免重复大字标。
- 原生 SVG/Vue 动效移植自 2026-09-14 的 MOTION STUDY / 04。欢迎页大 Logo hover 和键盘聚焦触发：两片 3600ms 展开、错位起伏、反向回应、靠拢；右片浅彩 5600ms 流转，左片和文字纯黑。移入/移出 480ms 平滑衔接，移出回纯黑，保留 opacity 0.24 / blur 25px 的柔和光晕。不会跳页或触发登录。
- 登录成功转场总长固定 **3000ms**：两片汇合、字标出现，右片 1120–2020ms 回黑，2020–2320ms 全黑停留，2320–3000ms 整层淡出。没有演示欢迎页；真实账号/平台页在遮罩下并行加载，超时或失败露出真实状态，动画不等待请求延长。
- 仅显式登录成功触发。会话恢复不播放；重复触发以 runId 替换旧实例，取消、注销、卸载清理计时器和 RAF。每实例独立 gradient ID，支持减少动态效果（关闭位移/旋转/缩放和持续流彩）、后台标签暂停 hover、转场回来按实际经过时间结束。转场获得焦点，底层 inert，结束交还目标页标题。
- 头像、昵称、账号及退出按钮放在底部；头像菜单提供服务配置。登录和项目使用 NexoFolio /v1 协议，迁移隔离旧存储和旧消息。

## 可选的热更新模式

在开发目录运行 `npm run dev`，保持命令运行，按 WXT 输出的目录加载开发产物（默认 `.output/chrome-mv3-dev`）。此模式依赖本地开发服务器；它与上面的独立构建目录不同，不要混用。命令不会自动打开浏览器或安装扩展。

## 结构

```text
src/
  api/nexofolio/               唯一后端 API：请求、错误、登录/鉴权/用户资料
  auth/                       后台会话所有者、持久化、页面消息协议
  capture/                    后台持续录制、HTTP上下文、独立inflight及UI20缓冲
  evidence/                   页面标题/操作 ID 采样与采集上下文
  upload/                     持久队列、转换、回执校验、批次重试
  contracts/collect/           固定的后端采集契约及静态校验器
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

固定权限为 `sidePanel`、`storage`、`tabs`、`scripting`、`webNavigation` 和 `alarms`；`http://*/*`、`https://*/*` 声明可选主机权限（实际按单个主机申请，不申请全站截图权限），在用户点击登录/重新验证或平台授权时申请相应主机。项目列表通过唯一的 NexoFolio 后端读取，捕获模块不向业务站点重发接口请求。只在授权/绑定检查通过后按文档注入采集脚本，没有常驻全站内容脚本或任意 URL 代理。Logo、字体（系统字体）、组件代码均在本地；头像使用个人资料中的可选 avatar_url，缺失或加载失败时回退昵称首字。

服务配置、内部 Token、最小用户资料、到期时间和项目同步状态存储在本扩展 `chrome.storage.local`，记住的账号密码按用户勾选存储，没有额外加密层。访问级别限定为扩展可信上下文，扩展卸载会移除扩展本地存储。

## 接口详情与手动发送

详情按不可复用的 recordKey 读取，worker 重启、记录淘汰或账户/服务变化不会替换成另一条同名接口。上方保留返回、原始方法只读标签、完整 URL、发送/取消；请求方法不允许修改，后台发送前也核对原方法；下方请求和响应分区各自滚动，也可单独放大。参数、Headers 和正文以 Reka 标签切换；CodeMirror 提供行号、折叠、查找、折行、复制与 JSON 格式化。格式化保留数字字面值，不通过反序列化重写长整数 ID。

- URL 与参数共享一个草稿，保留重复键、空值和未编辑参数的原始编码。请求 Headers 使用与 Body 相同的文本编辑器，每行「名称: 值」，行首加「# 」停用，保留重复项、空值及值中的冒号；原始和响应 Headers 使用只读编辑器。浏览器管理的 Cookie、Host、Origin、Referer 等不手工转发，重复请求头在 Fetch 中可能合并。
- 支持完整 JSON、文本、URL 编码表单和完整 Base64 二进制。文本以 UTF-8 发送。GET/HEAD 须明确使用无正文；缺失/读取中/截断正文和 multipart 字段/文件元数据须手动重建，不能静默作为空正文发送。请求正文最多 1 MiB；超过 256 项的表单保留完整编码原文，用文本方式编辑。
- 后台直接 Fetch，默认不带浏览器 Cookie，可显式开启同一原目标域/环境的浏览器凭据（仍受浏览器策略限制）。不附加 NexoFolio 登录 Token，不在页面 MAIN/ISOLATED 执行，不经过采集上传链路。
- 只接受合法 panel 的结构化端口命令。发送前重新校验账号、服务、原始站点/项目/环境、活动页面/窗口、项目访问权限、目标主机许可与共享版本门禁。目标域或已登记环境变化时须单独核对，且不沿用浏览器凭据。权限通过单独按钮申请，授权后不会自动发送。
- 一次点击只发送一次，不自动重试或跟随重定向。等待上限 25 秒，响应正文读取上限 15 秒/1 MiB。HTTP 非 2xx 仍显示真实响应；网络失败、取消和超时单独表达，停止等待不表示服务端未执行或已回滚。响应只展示 Fetch 可读取的 Header，不伪造 Set-Cookie。
- 草稿和发送结果仅存本次详情内存，返回、切记录或关闭 panel 时停止等待。原始记录的后续采集更新不会覆盖已经编辑的草稿。

本轮仅实现与构建；不运行自动测试、浏览器 QA 或真实业务发送。用户重新加载 `.output/chrome-mv3` 后亲自验收。

## OSS 更新门禁与开发版发布

版本校验无需登录，扩展后台只访问固定 OSS `https://asynctest.oss-cn-shenzhen.aliyuncs.com/nexofolio_fetcher/latest.json`。启动先校验，随后约每5分钟校验，多个panel共享状态；未通过/失败/过期暂停新增采集、上传、绑定、创建环境及手动重发。已有登录、绑定与队列保留，已发出请求的回执可以正常落盘。下载 ZIP 后仍需解压覆盖原安装目录并在 Chrome 重新加载；“我已更新”按钮只重新校验实际 manifest 版本，不修改版本或解除门禁。

普通更新只提示，最低版本不变；强制更新提升最低版本。例如强制0.1.4后再普通发布0.1.5，最低版本仍是0.1.4。策略以单调递增 revision 和最低版本保存到 chrome.storage.local，重启、断网、老格式清单或回退清单不能解除已知门槛。现有无策略字段的完整清单仅作为首次兼容，最低0.0.0；一旦看到新策略不再接受旧格式。

今后 Fetcher 发布统一由本任务按用户明确给出的**版本号、更新说明、普通/强制模式**执行。当前实现不代表已经发布；所有命令示例必须在获准发布后才执行：

```sh
# notes.txt 每行一条更新说明。必须选择一种模式，否则拒绝运行。
npm run release:dev -- --version 0.1.4 --normal --notes-file notes.txt
npm run release:dev -- --version 0.1.4 --force --notes-file notes.txt

# 仅生成冻结发布物，不上传（仍从 OSS 读取当前门槛）
npm run package:dev -- --version 0.1.4 --normal --notes-file notes.txt

# 同版本、同模式重试已冻结的包，不重建、不修改说明或批次
npm run release:dev -- --version 0.1.4 --normal --upload-only
```

使用 Node22+/Python3。OSS凭据仅在被Git忽略的 `.env.oss.local`；模板 `.env.oss.example`。构建子进程主动移除OSS/阿里云环境变量。发布脚本不提交、打标签、push或运行测试，也不允许 `--replace-published` 覆盖同版本不同字节。

`.output/releases/<版本>-dev/` 包含 ZIP、latest.json、冻结计划和哈希封印。公开上传仅两个文件，另有一个私有临时 `.release-lock.json` 互斥对象。顺序为：冻结旧策略摘要/模式/新门槛→构建打包→验证ZIP manifest/入口/CRC/大小/hash→上传不可覆盖的版本ZIP→公开下载校验大小/SHA-256→持锁再次确认旧策略未变→最后发布latest.json→公开回读核对→释放锁。失败不得先提升门槛。

详情、并发/失败恢复及后台重发集成方法见 [更新发布说明](docs/fetcher-updates.md)。

## 验证约定

默认仅完成代码修改和必要构建，由用户自行审核。除非用户明确要求，不运行测试、浏览器 QA 或额外验收套件。

用户授权测试时，测试代码放在 `/Users/sheldon/Documents/AsyncTest/ast-testing-core`，截图、报告等放在 `/Users/sheldon/Documents/AsyncTest/ast-testing-core-data`。类型检查、构建、普通网页中的 UI 验证和真实 Chrome 扩展验收分别报告，不互相替代。

`.gitignore` 排除依赖、构建产物、WXT 缓存、本地环境文件、编辑器临时文件及验证数据。提交源码、锁文件、Logo素材和必要文档；构建目录由本地命令生成，不推送到 Git。

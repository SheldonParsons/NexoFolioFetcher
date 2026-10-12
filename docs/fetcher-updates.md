# Fetcher：OSS 更新与发布

## 本轮交付范围

后台直接从固定 OSS 读取策略，不经过 NexoFolio 下载 API，不依赖登录。固定主机访问权仅用于公开版本清单和 ZIP；OSS 凭据只在本地发布工具中使用。插件不会请求或执行远程 JavaScript，也不会自动安装 ZIP。

启动/worker重启默认关闭业务门禁，首次OSS校验成功后才允许采集/上传。chrome.alarms 每5分钟检查，手动检查立即触发并合并并发请求；连续操作最多10秒一次，清单读取8秒超时、64KiB上限、拒绝重定向，要求OSS Date与本地时钟相差不超过120秒、Age不超过60秒。`builtAt`是构建时刻，不设“发布超过几天自动过期”；新鲜度取本次OSS响应及最长5分钟许可，不能用旧缓存永久放行。本机时钟错误会暂停业务，需先修正时钟。

校验失败、过期、待校验或低于最低版本时，后台停新注入、停止MAIN/ISOLATED监听、拒绝新观察、禁用上传重试/绑定/新环境及手动重发。已经接收的记录可以完成持久化；已经发出去的网络请求无法撤回，仍检查并保存其明确回执。网页自己的网络请求不会被阻断。面板仅剩更新检查、固定地址下载及本地退出登录等恢复操作。

门槛和最高策略revision保存在可信扩展本地存储；工作进程重启/断网不会解除已知强制状态。缓存格式损坏默认暂停，不删除任何数据来“修好”。真实运行版本来自 `chrome.runtime.getManifest().version`；新安装并重新加载后校验通过才恢复。“我已更新”不会写版本或设一个跳过标记。

## 清单兼容

保持原 `schemaVersion:1`、product/channel/installation/version/builtAt/minimumChromeVersion/artifact各字段，兼容网页下载读取。新增：

```json
{
  "policyVersion": 1,
  "policyRevision": 2,
  "minimumVersion": "0.1.4",
  "releaseMode": "normal",
  "releaseNotes": ["修复采集稳定性"]
}
```

- 普通发布0.1.5继承最低0.1.4；强制发布0.1.6才提高至0.1.6。不能用普通发布降低最低版本。
- revision每次发布增加；同revision不同内容、版本/门槛回退均暂停，不能解除强制更新。
- 首次遇到原无策略字段的完整清单视为最低0.0.0、revision0；若任意策略字段出现但不完整，拒绝清单。一旦存过新策略，旧格式不能回退覆盖。
- 真正的manifest版本按Chrome数字段比较，不按字典序或名称比较。新版需要更高Chrome时在下载区提示；普通发布不会仅因新包的Chrome要求而停用仍合规的旧插件。
- 清单下载只能指向同一固定目录下 `NexoFolio-Fetcher-<version>-dev.zip`；拒绝外域、跳转、凭据、路径逃逸或任意代理。

## 发布（用户逐次授权）

今后由本任务执行发布。用户需提供版本号、更新说明和普通/强制模式，并明确允许实际上传。仅要求实现/构建不代表允许发布；实际发布结果以 OSS 回读校验为准。

```sh
cd /Users/sheldon/Documents/GithubProject/NexoFolioFetcher
# notes.txt 每行一条更新说明
npm run release:dev -- --version 0.1.4 --normal --notes-file notes.txt
# 或（这次明确要求强制时）
npm run release:dev -- --version 0.1.4 --force --notes-file notes.txt
# 只打包，不上传
npm run release:dev -- --version 0.1.4 --normal --notes-file notes.txt --package-only
# 同计划重试，不重建、不变更模式/说明
npm run release:dev -- --version 0.1.4 --normal --upload-only
```

命令缺少/同时提供普通强制模式会失败；新版本必须高于已发布版本，不低于本地版本。脚本同步package.json和package-lock.json，不执行git commit/tag/push。Node22+、Python3；既有私有 `.env.oss.local` 提供配置，权限应保持0600。不得设置VITE_*或将密钥放进public。子构建主动排除OSS/阿里云环境变量。

发布工具另在私有忽略文件 `.release-policy.local` 保留所见最高策略，拒绝回退或旧格式降低已知门槛。发布计划冻结旧清单SHA、版本、模式、门槛和说明；包完成后封存计划/清单/ZIP哈希。完整顺序：构建打包→校验ZIP内manifest、入口、CRC、大小和SHA→上传版本ZIP→从公开OSS URL回读核对大小/SHA→最后更新latest.json→公开回读比对。只公开ZIP和latest.json，发布锁为私有对象。失败不能先提高门槛。

并发安全使用本地 `.release-dev.lock.local` 和OSS `.release-lock.json` 的禁止覆盖写入。所有发布者必须使用本脚本，不以未经确认的PutObject If-Match模拟CAS。持锁后仍检查旧清单摘要。锁没有自动过期/抢占；未确认结果保留锁，防止先失败的进程后来又写回旧门槛。上传失败重试同一冻结计划；同版本不同ZIP永远拒绝，已取消 `--replace-published`。

恢复规则：

- 网络中断但ZIP/清单已冻结：按相同版本及模式 `--upload-only`；如果已经发布成功，会回读包后确认幂等完成。
- 构建在产生完整ZIP前失败：未上传策略。检查构建错误；确认没有发布者运行后可移走该版本未完成的本地发布目录，重新构建同一未发布版本。已有完整ZIP不要覆盖。
- 进程崩溃留下本地锁：先确认没有仍在运行的发布进程，再删除本地锁。不要仅因锁存在自动删除。
- OSS锁属于另一计划或最新策略已变化：停下，不抢锁、不降低门槛。确认原发布者已停止、公开latest和包的实际状态后，由发布负责人手动释放私有锁并用新版本重新生成计划。禁止在旧进程可能恢复时释放锁。
- 不支持由其他脚本/控制台并发覆盖latest.json；有写权限的外部工具能绕过发布锁，这是运维边界。

## 后台业务集成（含手动重发）

`src/updates/access.ts`：

```ts
import { requireVersionAccess, versionAllowed } from '../updates/access'
// 业务动作入口及最后一次 await 之后、真正 fetch / executeScript 之前都检查。
requireVersionAccess()
// 纯状态判定用 versionAllowed()，不是 UI 传来的 boolean。
```

未许可抛 `UpdateGateError`（kind=`update`），不能当作401清登录。该模块仅在后台使用，默认关闭，由唯一UpdateManager注入许可。`NexoFolioClient.request`在每次后端网络请求前也检查，可覆盖绑定创建环境等异步链路。重发模块若直接fetch或executeScript必须自行调用门禁，不能绕过此要求；已发请求不自动重发，原记录不改。

仅可信本扩展panel可调用 `chrome.runtime.sendMessage({type:'update.state'})`、`update.check`、`update.download`；返回 `{ok:true,data:UpdateState}`。`nexofolio.update.state.v1`变化供UI订阅，不是后台授权依据。状态里的current/latest/minimumVersion/message均无密钥。

## 后端配套与部署边界

当前实际上传只有 `POST /v1/collect/batches`；当前工程没有运行中的独立图像资产上传链路。旧assets存储保留且不擅自上传到猜测入口。只针对body.platform=`nexofolio-fetcher`或携带运行版本头的请求检查，其他API生产者/MCP/账号项目权限保持既有行为。

新插件上传独立头 `X-NexoFolio-Fetcher-Version` 标识实际运行版本；历史body.platform_version仅表示采集出处，不能拿它作运行版本门禁或为过门禁而改写。已形成collect批次保持原body/ID，新未成批记录按冻结出处版本分组；此前没记录出处的旧项留空，不伪装新版。旧ingestion批次原样保留，不在这次升级重置格式。

后端从同一固定OSS清单核对，失败返回503 `FETCHER_UPDATE_POLICY_UNAVAILABLE`，不合规返回426 `FETCHER_UPDATE_REQUIRED`，均在intake写入前拒绝。门槛revision/minimum/latest/hash存入intake专用表以跨重启/实例防回退，API不自动迁移；上线前需执行新增迁移。未部署配套之前，不能声称服务器已经拒收旧插件。

第一次带门禁版本应按实际发布意图设置模式；当最低门槛尚为0.0.0，不能仅因缺少新运行版本头强制停掉旧插件。提升最低版本后，缺运行版本头的旧客户端无法证明合规，应更新至含门禁版本。producer和版本头是正常客户端的声明，不是防恶意伪造的硬件证明；开放非Fetcher API不能同时声称防恶意客户端改名绕过。

未安装过门禁代码的旧插件只能在服务端拒收其上传，无法远程叫停它本机采集。5分钟轮询、休眠/离线意味着不能保证所有机器同秒停用；新插件过期许可自动关闭，已发网络请求不能撤回。

## 用户自行检查

1. 重新加载 `.output/chrome-mv3`，未登录也应先看到版本校验；OSS可达且合规后恢复原登录/绑定界面。
2. 点底部版本入口：核对实际当前版本、最新版本、说明及固定OSS下载地址。下载不自动安装。
3. 网络不可用时，手动检查应显示暂停，新增捕获/上传/绑定/重发不启动，原记录仍在；恢复网络重新检查后恢复。
4. 待明确授权一次测试发布后再检查普通/强制门槛。不要为验收直接覆盖线上策略。强制版本未安装时反复点击“我已更新”不得解除停用；安装合规版本并重载后才恢复。

本轮未运行测试、浏览器QA、真实业务请求或生产部署。构建成功不等于这些路径已做真实扩展验收。

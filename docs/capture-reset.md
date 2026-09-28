# 开发阶段：仅清理插件录制数据

适用于后端准备清空历史录制、开始固定样本录制前。没有产品内清空入口；本脚本也不会自动操作 Chrome 或清理用户数据。它只临时替换已经加载的开发构建后台，实际清理必须由操作者在该扩展的维护后台控制台明确执行。

## 为什么不能直接删除 IndexedDB

正常后台的 UploadManager 在内存中持有 items、batches、assets、dirty/dirtyAssets，并监听 alarms/storage/定时器重试。即便只禁用 transport，flush 仍先写入 dirty 数据。清数据库后，旧内存可能重新回写或上传。CaptureManager 同样持有正在采集的请求和最近20条展示记录。

维护后台没有这些 manager、定时器或采集入口。必须先重载现有扩展，使旧后台及 panel 上下文终止，再执行清理。页面里残留的 MAIN 钩子没有可用接收端，最长15秒租约后退出；维护脚本要求等20秒才接受清理。

## 执行顺序

1. 后端先停止 API 和 worker，完成数据库/原文卷备份；确认尚未恢复服务。关闭插件 panel，把活动标签切换到新标签页或未授权页面。不要卸载插件，不要删除 Chrome profile，不要退出登录或取消已有授权。
2. 在 `/Users/sheldon/Documents/GithubProject/NexoFolioFetcher` 执行：

   ```sh
   node scripts/prepare-capture-reset.mjs prepare
   ```

   它将正常 `background.js` 备份到 `.output/capture-reset-maintenance/`，并在**原加载目录** `.output/chrome-mv3` 放入临时维护后台。其余构建、manifest 和扩展ID不变。此时尚未清数据。维护期间不要 build/package/release，以免覆盖维护后台。

3. 手动进入 `chrome://extensions`，对原来的 NexoFolio Fetcher 点击“重新加载”。不要另行“加载未打包扩展”，尤其不要选择另一个路径。点该扩展的 Service Worker 检查入口，确认控制台存在：

   ```js
   fetcherCaptureMaintenance.mode // 应为 'capture-reset-only'
   fetcherCaptureMaintenance.extensionId // 确认是原扩展ID
   await fetcherCaptureMaintenance.preview()
   ```

   仅显示 items/batches/assets 数量，不输出接口正文或登录信息。若维护对象不存在，说明尚未切换到维护后台，**不能**继续清理，也不能恢复后端。

4. 维护后台启动至少20秒后，操作者确认丢弃旧队列，手动执行：

   ```js
   await fetcherCaptureMaintenance.clear('CLEAR_CAPTURE_QUEUE_KEEP_SETTINGS')
   await fetcherCaptureMaintenance.preview()
   ```

   必须看到 remaining/preview 三项均为0。只原子清空 `nexofolio-upload-v1` 的 `items`、`batches`、`assets` 三个 store（含草稿、失败、待上传及旧格式批次）；保留 `meta` 的 producer ID。没有删除整个数据库，没有写入/清空任何 chrome.storage 或撤销权限。登录 token、记住的密码、服务地址、授权范围、项目/环境绑定均保留。最近20条接口和进行中的采集随第3步重载被清除。

5. 把清理回执交给后端任务。完成后端历史数据清理后，恢复正常构建：

   ```sh
   node scripts/prepare-capture-reset.mjs restore
   ```

   保持活动标签在新标签页/未授权页面，手动重新加载同一个扩展。与后端协调恢复 API/worker；只有准备开始固定样本录制时，再切回授权绑定的目标页面并打开 panel。权限和绑定仍在，切回目标页会按现有规则自动录制。

`status` 仅检查磁盘构建是否处于维护版本，不能证明浏览器已经重载或队列已经清空。若清理事务或回读失败，保持后端暂停，不把失败当成功。关闭/重开浏览器并不能替代这套顺序；重启会自动恢复正常队列。

## 范围

这是当前 Chrome profile 中这个扩展实例的全部录制队列清理（跨已配置服务/账号），不是按项目删除；不清理账号/绑定，也不影响站点或其他扩展。后端清空与插件清空须协调完成，禁止旧客户端恢复上传后才做后端 reset。

本方法尚未在真实用户 Chrome 数据上执行。现有标准 `npm run build` 可以重新生成正常开发包，但维护过程中不要用它代替检查和清理回执。

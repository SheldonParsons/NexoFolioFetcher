# 局部业务采样修复

## 原因与范围

基线179条已接收记录的格式/存储一致性通过，但5份业务页快照仅按钮并带 TARGET_ONLY：原实现只认原生 form 和 role=form/search，不能覆盖常见 div 组件表单/弹窗footer。自定义控件也缺少组件标签、实际选项读取。没有据此把64条无操作ID的HTTP认作漏采；这些请求可以是加载、轮询或异步。

本地 AsyncTest-front-dev 未找到这份基线对应的 consult-technology/consult/technical 页面代码，未读取真实 GREE DOM。实现用有明确边界的组件结构和贴近框架的合成DOM验证，不宣称该站点的每个实际控件已验收。

- 新增明确 div 表单、同弹窗唯一可见表单及最小有标签/字段组局部容器。最多6层祖先；多独立可见owner、结果表格和页面根不混入。隐藏表单/关闭弹窗不决定归属。
- 自定义下拉值来自实际DOM属性/具名隐藏input/真实已选option；只显示标签而无值时保持unknown，placeholder不作为已选项。不遍历Vue/React私有实例，不猜ID。
- 共享每份采样2000局部节点、80控件、100选项、24576字符、128KiB快照上限，预算耗尽明确标记；不新增轮询、mutation或全页采样。
- 单事件操作ID语义不变，role=tab增加原始点击线索。A→B中断、多并发、同URL弹窗/tab切换不构造业务任务；晚到A仍属于A请求起点，B重新读值，无旧选项缓存。
- 同步跨SPA请求保留实际开始视图/URL，不将旧快照改成新页，也不强行满足同view关联。异步无可靠依据就独立保留。
- FormData原实现已有文件name/size/type及文本字段投影；不是完整multipart原始字节/文件内容。本轮不改变文件协议或重写旧队列；显式投影标记留作合同独立待办。

Element Plus公开实现提供了控件/选项DOM参考（不代表真实站点版本）：[select.vue](https://github.com/element-plus/element-plus/blob/dev/packages/components/select/src/select.vue)、[option.vue](https://github.com/element-plus/element-plus/blob/dev/packages/components/select/src/option.vue)。仅依据可观察DOM做有限适配。

## 验证与边界

外部合成测试：`/Users/sheldon/Documents/AsyncTest/ast-testing-core/nexofolio-fetcher/business-sampling.ts`；报告在 `/Users/sheldon/Documents/AsyncTest/ast-testing-core-data/nexofolio-fetcher-20260916/business-sampling-result.json`。

实际插件函数输出（合成DOM/模拟HTTP）经 manager/converter 得到13条联调样本：同目录 `business-operation-batch.json`，SHA-256 `81fc3887f7b8744c36cb6d6b024c27c8d5c78c3fdf5dea99b105dbd8b4ea8083`。后端任务确认已用真实Rust HTTP和独立PG接收全部记录，得到 status=1/待审核 的 inferred/string_to_number候选，重复提交全部replayed。后续模拟回归写另外的文件，不覆盖这个固定样本。

capture公共包1.4.0，wire3/payload1/Schema/类型均未变。保留原队列、历史资产、record/batch ID、授权和绑定；未修改后端、站点前端、真实基线或执行重录。没有Chrome/Ego Lite自动操作，没有提交、推送或OSS发布。真实业务Chrome采样效果仍需用户检查。

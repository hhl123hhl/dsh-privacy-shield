// lib/derive-patch.js — 模型可见面脱敏：Session.deriveEventMessage 防御性补丁（零依赖）。
//
// 为什么不是 registerMessageProjection：
//   DSH 0.2.0-rc.2 的会话折叠里，一个事件类型一旦注册了投影，就走 kind:"project"
//   分支——该分支只写 projectedMessages，不把事件加入 surface 节点（applySurfacePlan），
//   于是 deriveMessages() 拿到空数组，发给模型的请求 messages 为空（400 INVALID_REQUEST）。
//   官方唯一的投影插件 dsh-compaction-image-offload 也证实了契约边界：投影是给
//   image/offload 这类"插件自有日志事件"改写既有消息用的，不能挂到 5 类 surface 上。
//
// 为什么是 derive 补丁：
//   - 会话循环用 session.deriveMessages() 构造模型请求；deriveMessages 逐节点调
//     this.deriveEventMessage(event)（虚拟分发），包一层原型方法即可覆盖全部派生路径
//     （含标题生成等按 seq 派生的调用）。
//   - 本地日志与聊天 UI 走 append-origin 原始事件，不经 deriveEventMessage，
//     所以"本地全真值、云端全占位符"的语义保持完整。
//   - llm/stream 瀑布里 agent-loop 请求是深冻结对象，监听器无法替换请求，
//     derive 是 rc.2 上唯一可行的改写点。
//
// 安全约定：
//   - 只打一次（类级标记）；插件热重载时只换运行时引用、重建缓存。
//   - 宿主结构对不上（方法缺失）时安静降级为"不脱敏"，绝不让会话起不来。
//   - 任何异常都退化为返回原始消息，并记进 stats.errors。

/** 类级补丁标记：{ runtime, cache }。 */
const PATCH_FLAG = '__dshShieldDerivePatch'

/**
 * 给 Session 类安装 derive 脱敏补丁（幂等，可按类重复调用）。
 * @param {Function} sessionClass Session 构造函数（取自会话实例的 constructor）。
 * @param {import('./runtime.js').ShieldRuntime} runtime 运行时。
 * @param {{warn?: (msg: string) => void}} [log] 日志。
 * @returns {boolean} 是否处于"已安装"状态（含本次新装与引用更新）。
 */
export function installDerivePatch(sessionClass, runtime, log) {
  if (typeof sessionClass !== 'function' || sessionClass.prototype === undefined) return false
  const existing = sessionClass[PATCH_FLAG]
  if (existing !== undefined) {
    // 已打过补丁：热重载场景换运行时引用并清掉旧缓存。
    existing.runtime = runtime
    existing.cache = new WeakMap()
    return true
  }
  const original = sessionClass.prototype.deriveEventMessage
  if (typeof original !== 'function') {
    log?.warn?.('Session.prototype.deriveEventMessage 不存在：模型可见面脱敏未安装（宿主结构可能已变更）')
    return false
  }
  const state = { runtime, cache: new WeakMap() }
  sessionClass.prototype.deriveEventMessage = function shieldDeriveEventMessage(event) {
    const message = original.call(this, event)
    const current = state.runtime
    try {
      if (message === null || typeof message !== 'object') return message
      if (!current.surfaceWanted(event?.type)) return message
      // 消息不可变且"未改内容保留耐用身份"：同一节点的派生结果按身份缓存，
      // 避免反复派生（每次请求都会全量 derive）把统计与还原表刷爆。
      const epoch = current.maskEpoch ?? 0
      const cached = state.cache.get(message)
      if (cached !== undefined && cached.epoch === epoch) {
        return current.protecting ? cached.masked : message
      }
      const masked = current.maskMessage(message) ?? message
      state.cache.set(message, { epoch, masked })
      // observe 下只统计不改写：掩码照常跑，让 /shield status 有真实信号。
      return current.protecting ? masked : message
    } catch (error) {
      current.stats.noteError('derive-patch', error)
      return message
    }
  }
  sessionClass[PATCH_FLAG] = state
  return true
}

/**
 * 判断某 Session 类是否已装补丁（测试与状态展示用）。
 * @param {Function} sessionClass Session 构造函数。
 * @returns {boolean} 是否已安装。
 */
export function hasDerivePatch(sessionClass) {
  return typeof sessionClass === 'function' && sessionClass[PATCH_FLAG] !== undefined
}

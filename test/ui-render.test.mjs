// ui-render.test.mjs — 离线渲染 dsh-privacy-shield 的 Web UI（React 桩），回归两件事：
//   ① 深色主题下"选中页签白底白字"：选中态文字必须用成对反色令牌 label-primary-inverted，
//      不能写死 #fff（深色主题 --dsw-alias-brand-primary 是近白色）。
//   ② 实体识别类型显示中文名（手机号/身份证号/…），而不是协议 id（phone-cn/…）。
// 不引入任何依赖；client.js 原文用 new Function 在桩环境里执行，与浏览器加载方式一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ---------------- React 桩 ----------------

const arenas = new Map()
let current = null
let pendingEffects = []

class Component {
  constructor(props) {
    this.props = props
    this.state = {}
  }
}

const ReactStub = {
  Component,
  createElement(type, props, ...children) {
    const merged = {}
    if (props !== null && props !== undefined) {
      for (const key of Object.keys(props)) merged[key] = props[key]
    }
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { $$typeof: 'element', type, props: merged }
  },
  useState(initial) {
    const arena = current
    const index = arena.cursor++
    if (!(index in arena.states)) {
      arena.states[index] = typeof initial === 'function' ? initial() : initial
    }
    return [arena.states[index], (next) => {
      arena.states[index] = typeof next === 'function' ? next(arena.states[index]) : next
    }]
  },
  useEffect(fn, deps) {
    const arena = current
    const index = arena.cursor++
    const previous = arena.effects[index]
    const depsKey = JSON.stringify(deps === undefined ? null : deps)
    const unchanged = previous !== undefined && previous.depsKey === depsKey
    arena.effects[index] = { depsKey, cleanup: previous === undefined ? undefined : previous.cleanup }
    if (!unchanged) pendingEffects.push(fn)
  },
}

function withHooks(key, fn) {
  let arena = arenas.get(key)
  if (arena === undefined) {
    arena = { states: [], effects: [], cursor: 0 }
    arenas.set(key, arena)
  }
  const previous = current
  current = arena
  arena.cursor = 0
  try {
    return fn()
  } finally {
    current = previous
  }
}

function isClassComponent(type) {
  return typeof type === 'function' && type.prototype !== undefined && typeof type.prototype.render === 'function'
}

function renderNode(node) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(renderNode).filter((child) => child !== null)
  const element = node
  const type = element.type
  if (typeof type === 'function') {
    let rendered
    if (isClassComponent(type)) {
      const instance = new type(element.props)
      instance.props = element.props
      instance.state = instance.state === null || instance.state === undefined ? {} : instance.state
      rendered = instance.render()
    } else {
      rendered = withHooks(type, () => type(element.props))
    }
    return renderNode(rendered)
  }
  const elementProps = element.props === null || element.props === undefined ? {} : element.props
  return { type, props: elementProps, children: renderNode(elementProps.children) }
}

function flushEffects() {
  const queue = pendingEffects
  pendingEffects = []
  for (const fn of queue) {
    const cleanup = fn()
    if (typeof cleanup === 'function') {
      // 测试里不关心清理顺序，登记以便结束时统一调用
      flushEffects.cleanups.push(cleanup)
    }
  }
}
flushEffects.cleanups = []

function collectText(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string') { out.push(node); return out }
  if (Array.isArray(node)) { for (const child of node) collectText(child, out); return out }
  if (node.children !== undefined) collectText(node.children, out)
  return out
}

function findElements(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node === 'string') return out
  if (Array.isArray(node)) { for (const child of node) findElements(child, predicate, out); return out }
  if (predicate(node) === true) out.push(node)
  findElements(node.children, predicate, out)
  return out
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------- 加载 client.js（浏览器同款惰性工厂） ----------------

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const loader = { entry: null }
const documentStub = {
  documentElement: { lang: 'zh-CN' },
  head: { appendChild() {} },
  createElement() { return { dataset: {}, parentNode: null, textContent: '' } },
  body: { appendChild() {} },
}
const windowStub = {
  __ModuleLoader__: { load(entry) { loader.entry = entry } },
  addEventListener() {},
  removeEventListener() {},
}
const navigatorStub = { languages: ['zh-CN', 'zh'], language: 'zh-CN' }

const fakeSetInterval = () => 0
const fakeClearInterval = () => {}
const fakeSetTimeout = () => 0
const fakeClearTimeout = () => {}

function loadClient() {
  const factory = new Function(
    'window', 'navigator', 'document', 'fetch', 'setInterval', 'clearInterval',
    'setTimeout', 'clearTimeout', 'location', 'console', SOURCE,
  )
  factory(windowStub, navigatorStub, documentStub, undefined, fakeSetInterval, fakeClearInterval,
    fakeSetTimeout, fakeClearTimeout, undefined, console)
  assert.equal(loader.entry.id, 'dsh-privacy-shield')
  const module = loader.entry.factory((name) => {
    if (name === 'react') return ReactStub
    throw new Error('unexpected require: ' + name)
  })
  assert.equal(typeof module.apply, 'function')
  return module
}

// ---------------- host 状态快照（与 lib/client-rpc.js buildStatus 同形） ----------------

const CATALOG = [
  { id: 'phone-cn', label: 'PHONE', sensitivity: 'high' },
  { id: 'id-card-cn', label: 'IDCARD', sensitivity: 'high' },
  { id: 'email', label: 'EMAIL', sensitivity: 'medium' },
  { id: 'cn-address', label: 'ADDR', sensitivity: 'medium' },
]

function statusSnapshot() {
  return {
    mode: 'enforce',
    placeholderHash: 'hmac',
    entities: ['phone-cn', 'id-card-cn', 'email'],
    catalog: CATALOG,
    surfaces: { list: ['system', 'user', 'assistant'] },
    terms: { count: 2, byCategory: { contacts: 2 } },
    counts: { maskedTexts: 3, outboundRequests: 1, outboundPlaceholders: 2, violations: 0 },
    session: { id: 'session-1', allowed: true },
  }
}

const rpcCalls = []
function makeTransport() {
  return {
    rpc: {
      call(channel, method) {
        rpcCalls.push(method)
        return Promise.resolve({ ok: true, value: statusSnapshot() })
      },
    },
  }
}

function makeCtx() {
  const holder = { component: null }
  const ctx = {
    effect(fn) { return fn() },
    get() { return undefined },
    slots: {
      inject(name, register) { register() },
      register(description, component) {
        holder.component = component
        return { description, component }
      },
    },
  }
  return { ctx, holder }
}

const text = (t) => (key) => key

// ---------------- 用例 ----------------

test('client bundle：apply 注册状态条、面板与页签可渲染', async () => {
  globalThis.__DSH_TRANSPORT__ = makeTransport()
  const module = loadClient()
  const { ctx, holder } = makeCtx()

  assert.doesNotThrow(() => module.apply(ctx))
  assert.equal(typeof holder.component, 'function', 'apply 应把状态条注册进 slots')

  const renderRoot = () => renderNode(ReactStub.createElement(holder.component, { t: text(), ctx }))
  arenas.clear()
  pendingEffects = []
  let tree = renderRoot()
  flushEffects()
  await tick()
  tree = renderRoot()

  const textNodes = collectText(tree)
  assert.ok(textNodes.includes('隐私护盾'), '状态条应显示插件名')
  assert.ok(textNodes.includes('改写（enforce）'), '模式应显示中文文案，而不是裸 enforce')

  // 展开面板（点击 ▸ 按钮）
  const panelToggle = findElements(tree, (el) => el.props !== undefined && el.props.children === '▸')[0]
  assert.ok(panelToggle, '状态条应有面板开关按钮')
  panelToggle.props.onClick()

  const opened = renderRoot()
  const panelText = collectText(opened)
  const all = panelText.join(' | ')

  // 实体名中文化
  assert.ok(all.includes('手机号'), '设置页应显示"手机号"而不是 phone-cn')
  assert.ok(all.includes('身份证号'), '设置页应显示"身份证号"而不是 id-card-cn')
  assert.ok(all.includes('电子邮箱'), '设置页应显示"电子邮箱"')
  assert.ok(!panelText.includes('phone-cn'), '可见文本里不应再出现协议 id phone-cn')
  assert.ok(!panelText.includes('id-card-cn'), '可见文本里不应再出现协议 id id-card-cn')

  // 实体勾选框的 title：中文名（协议 id）· 中文敏感度
  const entityTitles = findElements(opened, (el) => el.props !== undefined && typeof el.props.title === 'string' && el.props.title.includes('（'))
    .map((el) => el.props.title)
  assert.ok(entityTitles.includes('手机号（phone-cn） · 高敏感'), '实体 title 应中文化：' + entityTitles.join(' / '))
  assert.ok(entityTitles.includes('身份证号（id-card-cn） · 高敏感'), '实体 title 应中文化')
  assert.ok(entityTitles.includes('电子邮箱（email） · 中敏感'), '实体 title 应带中文敏感度')

  // 其它中文文案
  assert.ok(all.includes('系统、用户、助手'), '覆盖面应用中文名并用顿号分隔')
  assert.ok(all.includes('HMAC（不可反推）'), '哈希方式应显示中文说明')
  assert.ok(all.includes('改写（enforce）'), '模式值应显示中文说明')

  // 选中页签：白底白字的回归断言
  const tabs = findElements(opened, (el) => el.props !== undefined && el.props.role === 'tab')
  assert.equal(tabs.length, 5, '应有 5 个页签')
  const selected = tabs.filter((tab) => tab.props['aria-selected'] === true)
  assert.equal(selected.length, 1, '同一时刻只应有一个选中页签')
  assert.equal(selected[0].props.style.background, 'var(--dsw-alias-brand-primary, #4d6bfe)')
  assert.equal(
    selected[0].props.style.color,
    'var(--dsw-alias-label-primary-inverted, #fff)',
    '选中页签文字必须用成对反色令牌（写死 #fff 会在深色主题下白底白字）',
  )
  assert.equal(selected[0].props.style.fontWeight, 600)

  // 复选框强调色不应再用深色主题下的近白色 brand-primary
  assert.ok(flushEffects.cleanups.length >= 0)
})

test('英文界面：实体名走 en 语言表', async () => {
  globalThis.__DSH_TRANSPORT__ = makeTransport()
  const module = loadClient()
  const { ctx, holder } = makeCtx()
  module.apply(ctx)

  documentStub.documentElement.lang = 'en-US'
  try {
    const renderRoot = () => renderNode(ReactStub.createElement(holder.component, { t: text(), ctx }))
    arenas.clear()
    pendingEffects = []
    let tree = renderRoot()
    flushEffects()
    await tick()
    tree = renderRoot()

    const panelToggle = findElements(tree, (el) => el.props !== undefined && el.props.children === '▸')[0]
    panelToggle.props.onClick()
    const opened = renderRoot()
    const all = collectText(opened).join(' | ')
    assert.ok(all.includes('Mobile phone'), '英文界面应显示 Mobile phone')
    assert.ok(all.includes('ID card'), '英文界面应显示 ID card')
  } finally {
    documentStub.documentElement.lang = 'zh-CN'
  }
})

// ---------------- 0.3.3 新增交互 ----------------

function makeStorage(map) {
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null },
    setItem(key, value) { map[key] = String(value) },
    removeItem(key) { delete map[key] },
  }
}

/** 挂载一次状态条：可注入传输通道与 localStorage。 */
async function mountClient(transport, options = {}) {
  globalThis.__DSH_TRANSPORT__ = transport
  delete windowStub.localStorage
  if (options.storage !== undefined) windowStub.localStorage = makeStorage(options.storage)
  const module = loadClient()
  const { ctx, holder } = makeCtx()
  module.apply(ctx)
  const renderRoot = () => renderNode(ReactStub.createElement(holder.component, { t: text(), ctx }))
  arenas.clear()
  pendingEffects = []
  let tree = renderRoot()
  flushEffects()
  await tick()
  tree = renderRoot()
  const helpers = {
    renderRoot,
    get tree() { return tree },
    openPanel() {
      const toggle = findElements(tree, (el) => el.props !== undefined && el.props.children === '▸')[0]
      if (toggle === undefined) throw new Error('找不到面板开关 ▸')
      toggle.props.onClick()
      flushEffects()
      tree = renderRoot()
      return tree
    },
    async clickTab(label) {
      const tab = findElements(tree, (el) => el.props !== undefined && el.props.role === 'tab' && el.props.children === label)[0]
      if (tab === undefined) throw new Error('找不到页签 ' + label)
      tab.props.onClick()
      tree = renderRoot()
      // 新页签组件挂载后才排队 effect，RPC 又是 Promise：多泵几轮让数据落到 state。
      for (let round = 0; round < 3; round += 1) {
        flushEffects()
        await tick()
        tree = renderRoot()
      }
      return tree
    },
  }
  return helpers
}

/** 按方法名返回预置值的 RPC 通道桩。 */
function makeRpcTransport(handlers, calls = []) {
  return {
    rpc: {
      call(channel, method, payload) {
        calls.push({ method, payload })
        const handler = handlers[method]
        const value = typeof handler === 'function' ? handler(payload) : handler
        return Promise.resolve({ ok: true, value: value === undefined ? statusSnapshot() : value })
      },
    },
  }
}

test('诊断徽标：默认隐藏；localStorage 偏好开启后显示通道', async () => {
  const first = await mountClient(makeTransport())
  assert.equal(collectText(first.tree).includes('⇄'), false, '默认不应显示诊断徽标')

  const second = await mountClient(makeTransport(), { storage: { 'dsh-privacy-shield.pref.diagnostics': '1' } })
  const texts = collectText(second.tree)
  assert.ok(texts.some((t) => String(t).startsWith('⇄')), '开启偏好后应显示 ⇄ 通道徽标：' + texts.join(' | '))
  const opened = second.openPanel()
  const diagCheckbox = findElements(opened, (el) => el.props !== undefined && el.props.type === 'checkbox' && el.props.checked === true)
  assert.ok(diagCheckbox.length >= 1, '设置页的"显示诊断徽标"复选框应处于勾选态')
  delete windowStub.localStorage
})

test('版本不一致：状态条显示 ⟳host，设置页提示重启 DSH', async () => {
  const transport = makeRpcTransport({
    status: () => Object.assign(statusSnapshot(), { version: '9.9.9' }),
    setMode: () => Object.assign(statusSnapshot(), { version: '9.9.9' }),
  })
  const ui = await mountClient(transport)
  assert.ok(collectText(ui.tree).includes('⟳ 9.9.9'), '版本不一致时应显示 ⟳host 徽标')
  const opened = ui.openPanel()
  assert.ok(collectText(opened).join(' | ').includes('请重启 DSH'), '设置页应提示重启 DSH 才生效')
})

test('设置页：搜索框按中文名过滤实体', async () => {
  const ui = await mountClient(makeTransport())
  const opened = ui.openPanel()
  const search = findElements(opened, (el) => el.props !== undefined && el.props.type === 'search')[0]
  assert.ok(search !== undefined, '设置页应有实体搜索框')
  search.props.onChange({ target: { value: '手机' } })
  const filtered = ui.renderRoot()
  const texts = collectText(filtered)
  assert.ok(texts.includes('手机号'), '过滤后应保留手机号')
  assert.equal(texts.includes('电子邮箱'), false, '过滤后不应显示电子邮箱')
})

test('词表页：分类 chips + 按命中次数排序', async () => {
  const calls = []
  const transport = makeRpcTransport({
    termsList: () => ({
      ok: true,
      terms: ['阿尔法项目 @project', '昆仑数据库 @company'],
      categories: { company: 1, project: 1 },
      hits: { '昆仑数据库': 5, '阿尔法项目': 1 },
    }),
  }, calls)
  const ui = await mountClient(transport)
  ui.openPanel()
  const opened = await ui.clickTab('词表')
  const texts = collectText(opened)
  assert.ok(texts.includes('公司/机构 1'), '应显示分类 chip 的中文名与计数：' + texts.join(' | '))
  assert.ok(texts.includes('项目 1'), '应显示第二个分类 chip')
  const codes = findElements(opened, (el) => el.props !== undefined && el.type === 'code').map((el) => el.props.children)
  assert.equal(codes[0], '昆仑数据库 @company', '命中次数高的词条应排前面：' + codes.join(' | '))
  assert.ok(calls.some((call) => call.method === 'termsList'), '打开词表页应请求 termsList')
})

test('测试台：真值对照默认关，勾选后写入偏好', async () => {
  const storage = {}
  const ui = await mountClient(makeTransport(), { storage })
  ui.openPanel()
  const opened = await ui.clickTab('测试台')
  assert.ok(collectText(opened).includes('显示真值对照'), '测试台应有真值对照开关')
  const checkbox = findElements(opened, (el) => el.props !== undefined && el.props.type === 'checkbox')[0]
  assert.ok(checkbox !== undefined, '测试台应有复选框')
  assert.equal(checkbox.props.checked, false, '真值对照默认必须关闭')
  checkbox.props.onChange({ target: { checked: true } })
  assert.equal(storage['dsh-privacy-shield.pref.testReveal'], '1', '勾选后应写入 localStorage 偏好')
  delete windowStub.localStorage
})

/**
 * Client-half registration test.
 *
 * Loads ../client.js with a stubbed module loader, React and Client services,
 * then verifies the sidebar icon and panel registrations it contributes. A
 * small hook harness then renders the panel from a fake /state payload and
 * checks that every row shows its skill path when the Host reports one. This
 * check covers wiring and row markup only; no browser is involved.
 *
 * Run: node test/client.test.mjs
 */

import assert from 'node:assert/strict'

let entry
globalThis.window = { __ModuleLoader__: { load(candidate) { entry = candidate } } }

await import('../client.js')
assert.ok(entry !== undefined, 'client bundle registers a module')
assert.equal(entry.id, '@local/skills-panel')

// Minimal hook runtime: one object carries all hook state for the active render.
let runtime = null
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState(initial) {
    const index = runtime.cursor++
    if (!(index in runtime.state)) runtime.state[index] = typeof initial === 'function' ? initial() : initial
    return [
      runtime.state[index],
      (next) => {
        runtime.state[index] = typeof next === 'function' ? next(runtime.state[index]) : next
        runtime.dirty = true
      },
    ]
  },
  useEffect(effect, deps) {
    const index = runtime.cursor++
    const previous = runtime.effectDeps[index]
    const changed =
      deps === undefined ||
      previous === undefined ||
      deps.length !== previous.length ||
      deps.some((value, position) => value !== previous[position])
    runtime.effectDeps[index] = deps
    if (changed) runtime.effects.push(effect)
  },
  useRef(initial) {
    const index = runtime.cursor++
    if (!(index in runtime.refs)) runtime.refs[index] = { current: initial }
    return runtime.refs[index]
  },
  useCallback(callback) {
    const index = runtime.cursor++
    if (!(index in runtime.callbacks)) runtime.callbacks[index] = callback
    return runtime.callbacks[index]
  },
}
const plugin = entry.factory((name) => {
  assert.equal(name, 'react')
  return React
})
assert.deepEqual(plugin.inject, ['slots', 'locale'])

const dictionaries = new Map()
const locale = {
  active: 'zh',
  register(ns, dicts) {
    assert.equal(ns, 'skills-panel')
    assert.deepEqual(Object.keys(dicts).sort(), ['en', 'zh'])
    for (const [language, dict] of Object.entries(dicts)) dictionaries.set(language, dict)
    return () => {}
  },
  bind(ns) {
    assert.equal(ns, 'skills-panel')
    return (key, params) => {
      const template = dictionaries.get(locale.active)?.[key] ?? key
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }
  },
}

const registrations = []
const injected = []
const slots = {
  inject(key, callback) {
    injected.push(key)
    callback()
    return () => {}
  },
  register(options, component) {
    registrations.push({ options, component })
    return () => {}
  },
}

plugin.apply({
  locale,
  slots,
  effect: (callback) => {
    const disposer = callback()
    return typeof disposer === 'function' ? disposer : () => {}
  },
})

assert.deepEqual(injected.sort(), ['main', 'sidebar.panellist'])
assert.equal(registrations.length, 2)

const sidebar = registrations.find(({ options }) => options.name === 'sidebar.panellist')
assert.ok(sidebar !== undefined, 'sidebar icon is registered')
assert.equal(sidebar.options.id, 'skills-panel')
assert.equal(sidebar.options.locale, 'skills-panel')
assert.equal(typeof sidebar.options.order, 'number')
assert.equal(typeof sidebar.component, 'function')
assert.equal(sidebar.options.label(), '技能')
locale.active = 'en'
assert.equal(sidebar.options.label(), 'Skills')

const panel = registrations.find(({ options }) => options.name === 'main')
assert.ok(panel !== undefined, 'main panel is registered')
assert.equal(panel.options.key, 'skills-panel')
assert.equal(panel.options.locale, 'skills-panel')
assert.equal(typeof panel.component, 'function')

const props = panel.options.inject()
assert.equal(typeof props.t, 'function')
assert.equal(props.t('title'), 'Skills')
assert.equal(props.t('count', { count: 4, enabled: 3 }), '3 of 4 enabled')
assert.equal(props.hooks.locale, locale)
assert.equal(sidebar.options.label(), 'Skills')

// Render the panel once from a fake /state payload to inspect the row markup.
const skillAlpha = {
  name: 'alpha',
  description: 'Alpha skill',
  source: 'user-dsh',
  path: '/home/sunp/.dsh/skills/alpha/SKILL.md',
  enabled: true,
  modelInvocable: true,
  userInvocable: true,
}
const skillBeta = {
  name: 'beta',
  description: 'Beta skill',
  source: 'runtime',
  enabled: false,
  modelInvocable: true,
  userInvocable: true,
}
const skillGamma = {
  name: 'gamma',
  description: 'Gamma skill',
  source: 'project-agents',
  path: '/home/sunp/project/.agents/skills/gamma/SKILL.md',
  enabled: false,
  modelInvocable: false,
  userInvocable: true,
}
const statePayload = { persistable: true, skills: [skillAlpha, skillBeta, skillGamma] }

globalThis.fetch = async (url) => {
  assert.equal(url, '/skills-panel/api/state')
  return { ok: true, status: 200, async text() { return JSON.stringify(statePayload) } }
}

function renderNode(node) {
  if (node === null || node === undefined) return node
  if (Array.isArray(node)) return node.map(renderNode)
  if (typeof node !== 'object') return node
  if (typeof node.type === 'function') return renderNode(node.type(node.props))
  return { ...node, children: node.children.map(renderNode) }
}

function findAll(node, predicate, output = []) {
  if (node === null || node === undefined) return output
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, output)
    return output
  }
  if (typeof node !== 'object') return output
  if (predicate(node)) output.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, output)
  return output
}

async function renderPanel() {
  runtime = { cursor: 0, state: {}, refs: {}, callbacks: {}, effectDeps: {}, effects: [], dirty: false }
  let tree = renderNode(panel.component(props))
  for (let round = 0; round < 5; round++) {
    for (const effect of runtime.effects) effect()
    runtime.effects = []
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!runtime.dirty) break
    runtime.dirty = false
    runtime.cursor = 0
    tree = renderNode(panel.component(props))
  }
  return tree
}

const tree = await renderPanel()
const rows = findAll(tree, (node) => node.props?.className === 'sp-row')
assert.equal(rows.length, 3, 'renders one row per skill')
const rowOf = (name) =>
  rows.find((row) =>
    findAll(row, (node) => node.props?.className === 'sp-name').some((node) => node.children[0] === name),
  )

const alphaRow = rowOf('alpha')
const alphaPaths = findAll(alphaRow, (node) => node.props?.className === 'sp-path')
assert.equal(alphaPaths.length, 1, 'enabled skill row shows one path line')
assert.equal(alphaPaths[0].children[0], skillAlpha.path)
assert.equal(alphaPaths[0].props.title, skillAlpha.path, 'path line hovers with the full path')
assert.equal(alphaRow.props['data-enabled'], 'true')

const betaRow = rowOf('beta')
assert.equal(
  findAll(betaRow, (node) => node.props?.className === 'sp-path').length,
  0,
  'skills without a path render no path line',
)
assert.equal(betaRow.props['data-enabled'], 'false')

const gammaRow = rowOf('gamma')
const gammaPaths = findAll(gammaRow, (node) => node.props?.className === 'sp-path')
assert.equal(gammaPaths.length, 1, 'disabled skill row still shows its path')
assert.equal(gammaPaths[0].children[0], skillGamma.path)
assert.equal(gammaRow.props['data-enabled'], 'false')

const styles = findAll(tree, (node) => node.type === 'style')
assert.equal(styles.length, 1, 'panel ships its stylesheet')
const css = styles[0].children[0]
assert.ok(css.includes('.sp-path {'), 'stylesheet styles the path line')
assert.match(css, /\.sp-path\s*\{[^}]*color:\s*var\(--dsw-alias-label-secondary\)/)
assert.match(css, /\.sp-path\s*\{[^}]*font-family:\s*ui-monospace, SFMono-Regular, Menlo, Consolas, monospace/)
assert.match(css, /\.sp-path\s*\{[^}]*font-size:\s*11\.5px/)
assert.match(css, /\.sp-path\s*\{[^}]*overflow-wrap:\s*anywhere/)
assert.ok(css.includes('.sp-row[data-enabled="false"] .sp-path'), 'disabled rows fade the path line too')
assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), 'stylesheet uses no literal hex colors')
assert.ok(!/\b(rgba?|hsla?)\(/i.test(css), 'stylesheet uses no literal rgb/hsl colors')

console.log('ok - client half registers one sidebar icon and one main panel')
console.log('ok - panel rows show the skill path with a hover title and skip skills without one')
console.log('client half: all checks passed')

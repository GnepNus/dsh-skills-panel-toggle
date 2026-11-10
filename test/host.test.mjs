/**
 * Host-half integration test against the real skill registry and real scopes.
 *
 * The deployment mounts skill providers inside agent-preset scopes, so this
 * test builds the same shape: a global Cordis context with the real registry, a
 * preset scope holding a real provider, and an agent scope parented to it. It
 * then drives the plugin's HTTP handlers and asserts that the shadow provider
 * wins only inside the agent's own view.
 *
 * Run: node test/host.test.mjs
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { apply } from '../index.js'

/** Resolve the deployment's packages through the profile's shared node_modules. */
const profileDir = process.env.DSH_PROFILE_DIR
assert.ok(profileDir !== undefined, 'run this test inside a profile-launched shell (DSH_PROFILE_DIR)')
const modules = join(dirname(profileDir), 'node_modules', '@deepseek-ai')
const { Context } = await import(pathToFileURL(join(modules, 'cordis', 'lib', 'index.js')).href)
const { default: SkillRegistry } = await import(pathToFileURL(join(modules, 'dsh-skill', 'lib', 'index.js')).href)
const { createScope } = await import(pathToFileURL(join(modules, 'dsh-scope', 'lib', 'index.js')).href)

const CLEANUPS = []
process.on('exit', () => {
  for (const cleanup of CLEANUPS) void cleanup().catch(() => {})
})

/** Trigger one HTTP handler the way the Web server does. */
function invoke(route, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = method
    req.headers = headers
    req.destroy = () => {}
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      writeHead(status, headers) {
        this.statusCode = status
        this.headers = headers === undefined ? {} : { ...headers }
        return this
      },
      end(chunk) {
        if (chunk !== undefined) this.body += String(chunk)
        resolve({ status: this.statusCode, headers: this.headers, body: this.body })
      },
    }
    route.handler(req, res).catch((error) => resolve({ status: 500, body: String(error) }))
    if (body !== undefined) req.emit('data', Buffer.from(body))
    req.emit('end')
  })
}

/** A real skill provider standing in for a preset-mounted filesystem provider. */
function realProvider(name, rank) {
  return {
    name,
    async list() {
      return [
        {
          name: 'alpha-skill',
          description: 'First real skill',
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'user-agents',
          provider: name,
          rank,
          locator: 'alpha-skill',
        },
        {
          name: 'beta-skill',
          description: 'Second real skill',
          invocation: { modelInvocable: false, userInvocable: true },
          source: 'bundled',
          provider: name,
          rank,
          locator: 'beta-skill',
        },
      ]
    },
    async get(candidate) {
      return { ...candidate, content: `body of ${candidate.name}` }
    },
  }
}

/**
 * Build the deployment shape: global registry, a preset scope with the real
 * provider, and one live agent scope parented to that preset.
 */
function createWorld(options = {}) {
  const root = new Context()
  const registry = new SkillRegistry(root)

  const presetKey = {}
  const preset = createScope(root, presetKey)
  preset.ctx.get('skills').registerProvider(() => realProvider('fake-filesystem', 600))

  // The real Agent object is its own scope key; mirror that here.
  const agent = { id: 'agent-1' }
  const agentScope = createScope(root, agent, { parent: presetKey })
  agent.ctx = agentScope.ctx

  return { root, registry, presetKey, agent, emit: new Map() }
}

async function createHarness(options = {}) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'skills-panel-test-'))
  CLEANUPS.push(() => rm(stateRoot, { recursive: true, force: true }))

  const world = createWorld(options)
  const agentPresets = options.agentPresets ?? (options.noLiveAgent === true ? {
    defaultId: 'standard',
    acquireScope: async () => ({
      key: world.presetKey,
      [Symbol.asyncDispose]: async () => {},
    }),
  } : undefined)
  const routes = new Map()
  const listeners = new Map()
  const cleanups = []
  const warnings = []

  const agents = options.noLiveAgent === true ? { list: () => [], roots: () => [] } : {
    list: () => [world.agent],
    roots: () => [world.agent],
  }
  const services = {
    profileContext: options.noProfile === true ? undefined : {
      dir: stateRoot,
      home: stateRoot,
      patchPath: join(stateRoot, 'cordis.patch.yml'),
    },
    workingDirectory: {
      defaultDirectory: '/test/workspace',
      ensure: async () => '/test/workspace',
    },
    agents,
    agentPresets,
    connection: options.connection,
  }
  const fakeCtx = {
    skills: world.root.get('skills'),
    logger: {
      warn: (...args) => warnings.push(args.map(String).join(' ')),
      info: () => {},
      debug: () => {},
    },
    get: (name) => services[name],
    on(name, listener) {
      const entry = listeners.get(name) ?? []
      entry.push(listener)
      listeners.set(name, entry)
      return () => {
        const list = listeners.get(name) ?? []
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    },
    effect: (callback) => {
      const disposer = callback()
      if (typeof disposer === 'function') cleanups.push(disposer)
      return () => {}
    },
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
  }

  apply(fakeCtx)

  const state = routes.get('/skills-panel/api/state')
  const toggle = routes.get('/skills-panel/api/toggle')
  assert.ok(state !== undefined, 'state route is registered')
  assert.ok(toggle !== undefined, 'toggle route is registered')
  return {
    ...world,
    stateRoot,
    routes,
    state,
    toggle,
    warnings,
    emit(name, payload) {
      for (const listener of listeners.get(name) ?? []) listener(payload)
    },
    unload() {
      while (cleanups.length > 0) cleanups.pop()()
    },
  }
}

async function testList() {
  const harness = await createHarness()
  const response = await invoke(harness.state)
  assert.equal(response.status, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.persistable, true)
  assert.deepEqual(
    body.skills.map((skill) => [skill.name, skill.enabled, skill.modelInvocable]),
    [
      ['alpha-skill', true, true],
      ['beta-skill', true, false],
    ],
  )
  assert.equal(body.skills[0].description, 'First real skill')
  // The preset-layer provider is invisible without a scope: the panel must read
  // the live agent's view rather than the global layer.
  assert.deepEqual(await harness.root.skills.list({}), [])
  assert.equal((await harness.root.skills.list({ scope: harness.presetKey })).length, 2)
  console.log('ok - GET /state lists the live agent catalog')
}

async function testToggle() {
  const harness = await createHarness()

  const disabled = await invoke(harness.toggle, {
    method: 'POST',
    body: JSON.stringify({ name: 'alpha-skill', enabled: false }),
  })
  assert.equal(disabled.status, 200)
  const disabledBody = JSON.parse(disabled.body)
  assert.equal(disabledBody.ok, true)
  assert.deepEqual(
    disabledBody.state.skills.map((skill) => [skill.name, skill.enabled]),
    [
      ['alpha-skill', false],
      ['beta-skill', true],
    ],
  )

  const persisted = JSON.parse(await readFile(join(harness.stateRoot, 'skills-panel', 'state.json'), 'utf8'))
  assert.equal(persisted.disabled.length, 1)
  assert.equal(persisted.disabled[0].name, 'alpha-skill')
  assert.equal(persisted.disabled[0].description, 'First real skill')
  assert.equal(persisted.disabled[0].modelInvocable, true)

  // Inside the agent's scope the shadow wins and the body is unavailable.
  const agentView = await harness.root.skills.list({ scope: harness.agent })
  const alpha = agentView.find((skill) => skill.name === 'alpha-skill')
  assert.deepEqual(alpha.invocation, { modelInvocable: false, userInvocable: false })
  assert.equal(await harness.root.skills.get('alpha-skill', { scope: harness.agent }), undefined)
  assert.equal(agentView.find((skill) => skill.name === 'beta-skill').provider, 'fake-filesystem')

  // The preset layer itself is untouched, so other preset readers still resolve it.
  const presetView = await harness.root.skills.list({ scope: harness.presetKey })
  assert.equal(presetView.find((skill) => skill.name === 'alpha-skill').provider, 'fake-filesystem')

  const enabled = await invoke(harness.toggle, {
    method: 'POST',
    body: JSON.stringify({ name: 'alpha-skill', enabled: true }),
  })
  assert.equal(enabled.status, 200)
  assert.equal(JSON.parse(enabled.body).state.skills[0].enabled, true)
  const restored = await harness.root.skills.list({ scope: harness.agent })
  assert.equal(restored.find((skill) => skill.name === 'alpha-skill').provider, 'fake-filesystem')
  const empty = JSON.parse(await readFile(join(harness.stateRoot, 'skills-panel', 'state.json'), 'utf8'))
  assert.deepEqual(empty.disabled, [])
  console.log('ok - POST /toggle shadows inside the agent scope, persists, and restores')
}

async function testNewAgent() {
  const harness = await createHarness()
  await invoke(harness.toggle, { method: 'POST', body: JSON.stringify({ name: 'beta-skill', enabled: false }) })

  const second = { id: 'agent-2' }
  const secondScope = createScope(harness.root, second, { parent: harness.presetKey })
  second.ctx = secondScope.ctx
  harness.emit('agent/created', { agent: second })

  const view = await harness.root.skills.list({ scope: second })
  assert.equal(view.find((skill) => skill.name === 'beta-skill').provider, 'skills-panel')
  harness.emit('agent/disposed', { agent: second })
  const disposed = await harness.root.skills.list({ scope: second })
  assert.equal(disposed.find((skill) => skill.name === 'beta-skill').provider, 'fake-filesystem')
  harness.unload()
  const unloaded = await harness.root.skills.list({ scope: harness.agent })
  assert.equal(unloaded.find((skill) => skill.name === 'beta-skill').provider, 'fake-filesystem')
  console.log('ok - a later agent receives the shadow and disposal restores it')
}

async function testNoLiveAgent() {
  const harness = await createHarness({ noLiveAgent: true })
  await mkdir(join(harness.stateRoot, 'skills-panel'), { recursive: true })
  await writeFile(
    join(harness.stateRoot, 'skills-panel', 'state.json'),
    JSON.stringify({
      version: 1,
      disabled: [
        { name: 'beta-skill', description: 'Second real skill', modelInvocable: false, userInvocable: true },
      ],
    }),
  )

  const response = await invoke(harness.state)
  assert.equal(response.status, 200)
  const body = JSON.parse(response.body)
  assert.deepEqual(
    body.skills.map((skill) => [skill.name, skill.enabled, skill.userInvocable]),
    [
      ['alpha-skill', true, true],
      ['beta-skill', false, true],
    ],
  )
  assert.equal(body.skills[1].modelInvocable, false, 'persisted invocation flags survive')
  console.log('ok - without a live agent the panel reads the default preset scope')
}

async function testRejections() {
  const harness = await createHarness()

  const unknown = await invoke(harness.toggle, { method: 'POST', body: JSON.stringify({ name: 'ghost-skill', enabled: false }) })
  assert.equal(unknown.status, 400)
  assert.match(JSON.parse(unknown.body).error, /not available/)

  const invalidName = await invoke(harness.toggle, { method: 'POST', body: JSON.stringify({ name: 'Bad Name', enabled: false }) })
  assert.equal(invalidName.status, 400)

  const malformed = await invoke(harness.toggle, { method: 'POST', body: '{oops' })
  assert.equal(malformed.status, 400)

  const missingField = await invoke(harness.toggle, { method: 'POST', body: JSON.stringify({ name: 'alpha-skill' }) })
  assert.equal(missingField.status, 400)

  assert.equal((await invoke(harness.toggle, { method: 'GET' })).status, 405)
  assert.equal((await invoke(harness.state, { method: 'POST', body: '{}' })).status, 405)
  console.log('ok - invalid payloads and wrong methods are rejected')
}

async function testAuth() {
  const harness = await createHarness({ connection: { admit: () => ({ rejection: 401 }) } })
  assert.equal((await invoke(harness.state)).status, 401)
  assert.equal((await invoke(harness.toggle, { method: 'POST', body: '{}' })).status, 401)
  console.log('ok - unauthenticated peers are refused')
}

async function testNoProfile() {
  const harness = await createHarness({ noProfile: true })
  const response = await invoke(harness.state)
  assert.equal(response.status, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.persistable, false)
  assert.equal(body.skills.length, 2)
  const toggle = await invoke(harness.toggle, {
    method: 'POST',
    body: JSON.stringify({ name: 'alpha-skill', enabled: false }),
  })
  assert.equal(toggle.status, 400)
  assert.match(JSON.parse(toggle.body).error, /cannot persist/)
  console.log('ok - a profile without a state directory stays list-only')
}

async function testCorruptStateFile() {
  const harness = await createHarness()
  await mkdir(join(harness.stateRoot, 'skills-panel'), { recursive: true })
  await writeFile(join(harness.stateRoot, 'skills-panel', 'state.json'), '{not json')
  const response = await invoke(harness.state)
  assert.equal(response.status, 200)
  assert.equal(JSON.parse(response.body).skills.length, 2)
  assert.ok(harness.warnings.length > 0, 'a corrupt state file is reported')
  console.log('ok - a corrupt state file degrades to the enabled list')
}

await testList()
await testToggle()
await testNewAgent()
await testNoLiveAgent()
await testRejections()
await testAuth()
await testNoProfile()
await testCorruptStateFile()
console.log('\nhost half: all checks passed')

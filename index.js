/**
 * Skills panel — Host half.
 *
 * Serves the panel's list and toggle API, persists the disabled skill names in
 * the profile directory, and shadows every disabled name inside each live
 * agent's scope so neither the model skill catalog nor the `/` menu offers it.
 *
 * Skill providers are mounted inside agent-preset scopes, so a host-global
 * shadow provider would never win a name: the shadow is registered through each
 * agent's own context instead, which lands in the agent's nearest layer.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const ROUTE = '/skills-panel/api'
const PROVIDER = 'skills-panel'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FALLBACK_DESCRIPTION = 'Disabled in the skills panel.'
const STATE_DIRECTORY = 'skills-panel'
const STATE_FILE = 'state.json'
const MAX_BODY_BYTES = 64 * 1024

/** The `skills` registry and the Web server are hard requirements of this plugin. */
export const inject = ['webServer', 'skills']

function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Write one JSON response; every API reply is JSON, including failures. */
function reply(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Read and parse a small JSON request body. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('request body is not valid JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** Drop records that a stale or hand-edited state file could make unloadable. */
function sanitizeDisabled(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const entries = []
  for (const candidate of value) {
    if (candidate === null || typeof candidate !== 'object') continue
    const { name, description, source, path, modelInvocable, userInvocable } = candidate
    if (typeof name !== 'string' || !SKILL_NAME.test(name) || seen.has(name)) continue
    seen.add(name)
    entries.push({
      name,
      description: typeof description === 'string' && description.length > 0 ? description : FALLBACK_DESCRIPTION,
      source: typeof source === 'string' ? source : 'runtime',
      modelInvocable: typeof modelInvocable === 'boolean' ? modelInvocable : true,
      userInvocable: typeof userInvocable === 'boolean' ? userInvocable : true,
      ...(typeof path === 'string' && path.length > 0 ? { path } : {}),
    })
  }
  return entries
}

export function apply(ctx) {
  /** Resolve optional services per call: a plugin may activate before they mount. */
  const statePath = () => {
    const profile = ctx.get('profileContext')
    return profile === undefined ? undefined : join(profile.dir, STATE_DIRECTORY, STATE_FILE)
  }

  /** Disabled skills in their persisted shape; replaced wholesale on every toggle. */
  let disabled = []
  let loaded
  let writes = Promise.resolve()
  const controls = new Set()

  /** The panel is read-mostly, so the state file is loaded once per activation. */
  function ensureLoaded() {
    loaded ??= (async () => {
      const file = statePath()
      if (file === undefined) return
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8'))
        disabled = sanitizeDisabled(parsed?.disabled)
      } catch (error) {
        if (error?.code !== 'ENOENT') ctx.logger.warn(`skills-panel: cannot read ${file}: %s`, messageOf(error))
      }
    })()
    return loaded
  }

  function persist() {
    const file = statePath()
    if (file === undefined) return Promise.reject(new Error('the skills panel cannot persist state in this profile'))
    const payload = `${JSON.stringify({ version: 1, disabled }, null, 2)}\n`
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.${process.pid}.tmp`
      await writeFile(temporary, payload, 'utf8')
      await rename(temporary, file)
    })
    return writes
  }

  /** Provider candidates are read on every catalog discovery; keep them cheap. */
  function shadowCandidates() {
    return disabled.map((entry) => ({
      name: entry.name,
      description: entry.description,
      invocation: { modelInvocable: false, userInvocable: false },
      source: entry.source,
      provider: PROVIDER,
      rank: 0,
      locator: entry.name,
      ...(entry.path === undefined ? {} : { path: entry.path }),
    }))
  }

  function providerFor(registration) {
    controls.add(registration)
    return {
      name: PROVIDER,
      async list() {
        await ensureLoaded()
        return shadowCandidates()
      },
      async get() {
        return undefined
      },
    }
  }

  /**
   * Register the shadow in one agent's scope. The registry reads the layer of
   * the accessing context, and an agent context is the only scoped context this
   * plugin can borrow, so one registration per live agent covers that agent's
   * model catalog and `/` menu.
   */
  const attached = new Map()
  function attach(agent) {
    if (attached.has(agent)) return
    let registry
    try {
      registry = agent?.ctx?.get?.('skills')
    } catch {
      registry = undefined
    }
    if (registry === undefined) return
    try {
      attached.set(agent, registry.registerProvider(providerFor))
    } catch (error) {
      // A shared scope raises a duplicate-provider error; the first registration
      // already shadows every agent reading that layer.
      ctx.logger.debug?.(`skills-panel: no shadow for agent ${String(agent?.id ?? '?')}: ${messageOf(error)}`)
    }
  }

  function detach(agent) {
    const dispose = attached.get(agent)
    if (dispose === undefined) return
    attached.delete(agent)
    try {
      const result = dispose()
      if (typeof result?.catch === 'function') result.catch(() => {})
    } catch (error) {
      ctx.logger.debug?.(`skills-panel: shadow disposal failed: ${messageOf(error)}`)
    }
  }

  ctx.effect(() => {
    const agents = ctx.get('agents')
    for (const agent of agents?.list?.() ?? []) attach(agent)
    const offCreated = ctx.on('agent/created', ({ agent }) => attach(agent))
    const offDisposed = ctx.on('agent/disposed', ({ agent }) => detach(agent))
    return () => {
      offCreated()
      offDisposed()
      for (const agent of [...attached.keys()]) detach(agent)
    }
  }, 'skills-panel: per-agent shadows')

  const workingCwd = () => ctx.get('workingDirectory')?.defaultDirectory ?? process.cwd()

  /** Read the catalog a session sees: a live root agent's view, else the default preset's. */
  async function listSkills() {
    const agents = ctx.get('agents')
    const live = agents?.roots?.()[0]
    const directory = ctx.get('workingDirectory')
    if (live !== undefined) {
      let cwd = workingCwd()
      try {
        cwd = (await directory?.ensure?.(live)) ?? cwd
      } catch (error) {
        ctx.logger.debug?.(`skills-panel: agent directory unavailable: ${messageOf(error)}`)
      }
      return { cwd, skills: await ctx.skills.list({ cwd, scope: live }) }
    }
    const cwd = workingCwd()
    const presets = ctx.get('agentPresets')
    if (presets === undefined) return { cwd, skills: await ctx.skills.list({ cwd }) }
    let lease
    try {
      lease = await presets.acquireScope(presets.defaultId)
      return { cwd, skills: await ctx.skills.list({ cwd, scope: lease.key }) }
    } catch (error) {
      ctx.logger.warn(`skills-panel: cannot read the default preset catalog: %s`, messageOf(error))
      return { cwd, skills: await ctx.skills.list({ cwd }) }
    } finally {
      if (lease !== undefined) {
        try {
          await lease[Symbol.asyncDispose]()
        } catch (error) {
          ctx.logger.debug?.(`skills-panel: preset lease release failed: ${messageOf(error)}`)
        }
      }
    }
  }

  async function snapshot() {
    await ensureLoaded()
    const byName = new Map(disabled.map((entry) => [entry.name, entry]))
    const { cwd, skills } = await listSkills()
    return {
      cwd,
      persistable: statePath() !== undefined,
      skills: skills.map((skill) => {
        const record = byName.get(skill.name)
        return {
          name: skill.name,
          description: skill.description,
          source: skill.source,
          provider: skill.provider,
          modelInvocable: record?.modelInvocable ?? skill.invocation.modelInvocable,
          userInvocable: record?.userInvocable ?? skill.invocation.userInvocable,
          enabled: record === undefined,
          ...(skill.path === undefined ? {} : { path: skill.path }),
          ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
        }
      }),
    }
  }

  async function setEnabled(name, enabled) {
    if (typeof name !== 'string' || !SKILL_NAME.test(name)) throw new Error('invalid skill name')
    await ensureLoaded()
    if (statePath() === undefined) throw new Error('the skills panel cannot persist state in this profile')
    const current = disabled.find((entry) => entry.name === name)
    if (enabled) {
      if (current === undefined) return
      disabled = disabled.filter((entry) => entry.name !== name)
    } else {
      if (current !== undefined) return
      const { skills } = await listSkills()
      const skill = skills.find((candidate) => candidate.name === name)
      if (skill === undefined) throw new Error(`skill "${name}" is not available`)
      disabled = [
        ...disabled,
        {
          name,
          description: skill.description.length > 0 ? skill.description : FALLBACK_DESCRIPTION,
          source: skill.source,
          modelInvocable: skill.invocation.modelInvocable,
          userInvocable: skill.invocation.userInvocable,
          ...(skill.path === undefined ? {} : { path: skill.path }),
        },
      ]
    }
    await persist()
    for (const control of controls) control.invalidate?.()
  }

  function admitted(req) {
    const connection = ctx.get('connection')
    if (connection === undefined) return true
    return !('rejection' in connection.admit({ headers: req.headers }))
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${ROUTE}/state`,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405).end()
            return
          }
          if (!admitted(req)) {
            res.writeHead(401).end('unauthorized')
            return
          }
          try {
            reply(res, 200, await snapshot())
          } catch (error) {
            reply(res, 500, { error: messageOf(error) })
          }
        },
      }),
    'skills-panel: state route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${ROUTE}/toggle`,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405).end()
            return
          }
          if (!admitted(req)) {
            res.writeHead(401).end('unauthorized')
            return
          }
          try {
            const body = await readJsonBody(req)
            if (typeof body?.name !== 'string' || typeof body?.enabled !== 'boolean') {
              throw new Error('expected { name, enabled }')
            }
            await setEnabled(body.name, body.enabled)
            reply(res, 200, { ok: true, state: await snapshot() })
          } catch (error) {
            reply(res, 400, { ok: false, error: messageOf(error) })
          }
        },
      }),
    'skills-panel: toggle route',
  )
}

/**
 * Skills panel — Client half.
 *
 * Registers one global panel (main slot) and its sidebar icon. The page lists
 * every skill reported by the Host half, shows each skill's instruction-file
 * path under its description, and toggles one through its HTTP API.
 */

window.__ModuleLoader__.load({
  id: 'dsh-skills-panel-toggle',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'skills-panel'
    const PANEL_ID = 'skills-panel'
    const API = '/skills-panel/api'

    const zh = {
      panel: '技能',
      title: '技能',
      intro: '查看全部可用技能，并控制代理是否能使用它们。',
      search: '搜索技能',
      count: '{enabled}/{count} 项已启用',
      refresh: '刷新',
      loading: '正在加载技能…',
      loadFailed: '无法加载技能',
      retry: '重试',
      empty: '没有匹配的技能',
      enable: '启用',
      disable: '禁用',
      disabled: '已禁用',
      userOnly: '仅用户',
      modelOnly: '仅模型',
      unpersisted: '当前配置无法写入磁盘，切换只在本次运行中有效。',
      saveFailed: '保存失败：{message}',
      footnote: '禁用后，该技能会从代理的技能目录和 / 菜单中隐藏，但仍可在此重新启用。',
    }

    const en = {
      panel: 'Skills',
      title: 'Skills',
      intro: 'Browse every available skill and control whether agents can use it.',
      search: 'Search skills',
      count: '{enabled} of {count} enabled',
      refresh: 'Refresh',
      loading: 'Loading skills…',
      loadFailed: 'Could not load skills',
      retry: 'Retry',
      empty: 'No matching skills',
      enable: 'Enable',
      disable: 'Disable',
      disabled: 'Disabled',
      userOnly: 'User only',
      modelOnly: 'Model only',
      unpersisted: 'This configuration cannot be saved to disk; toggles last until restart.',
      saveFailed: 'Could not save: {message}',
      footnote: 'A disabled skill leaves the agent catalog and the / menu, and can be enabled again here.',
    }

    const SOURCE_LABELS = {
      'project-dsh': 'project · .dsh',
      'project-agents': 'project · .agents',
      'user-dsh': 'user · .dsh',
      'user-agents': 'user · .agents',
      custom: 'custom',
      runtime: 'runtime',
      bundled: 'bundled',
    }

    const CSS = `
.sp-root { display: flex; flex-direction: column; flex: 1; min-height: 0; color: var(--dsw-alias-label-primary); }
.sp-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 32px 24px 48px; }
.sp-inner { display: flex; flex-direction: column; gap: 20px; width: 100%; max-width: 880px; margin: 0 auto; }
.sp-head { display: flex; flex-direction: column; gap: 4px; }
.sp-title { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
.sp-intro { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.sp-toolbar { display: flex; align-items: center; gap: 8px; }
.sp-search { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; font-size: 13px; outline: none; }
.sp-search::placeholder { color: var(--dsw-alias-label-secondary); }
.sp-search:focus { border-color: var(--dsw-alias-brand-primary); }
.sp-button { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; }
.sp-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.sp-button:disabled { opacity: 0.5; cursor: default; }
.sp-count { flex: none; color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: nowrap; }
.sp-list { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.sp-row { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; }
.sp-row + .sp-row { border-top: 1px solid var(--dsw-alias-border-l1); }
.sp-row:hover { background: var(--dsw-alias-bg-layer-2); }
.sp-glyph { display: flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.sp-body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.sp-nameRow { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.sp-name { font-size: 13px; font-weight: 600; line-height: 20px; overflow-wrap: anywhere; }
.sp-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 18px; overflow-wrap: anywhere; }
.sp-path { margin: 0; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 16px; overflow-wrap: anywhere; }
.sp-chip { padding: 0 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; white-space: nowrap; }
.sp-chip[data-tone="disabled"] { border-color: currentColor; color: var(--dsw-alias-state-warn-primary); }
.sp-row[data-enabled="false"] .sp-glyph,
.sp-row[data-enabled="false"] .sp-name,
.sp-row[data-enabled="false"] .sp-desc,
.sp-row[data-enabled="false"] .sp-path { opacity: 0.55; }
.sp-switch { position: relative; flex: none; width: 34px; height: 20px; margin-top: 3px; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-2); cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease; }
.sp-switch[aria-checked="true"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); }
.sp-switch:disabled { opacity: 0.5; cursor: default; }
.sp-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.sp-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--dsw-alias-bg-base); transition: transform 0.15s ease; }
.sp-switch[aria-checked="true"] .sp-knob { transform: translateX(14px); }
.sp-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 32px 16px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; text-align: center; }
.sp-note { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.sp-error { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
`

    function messageOf(error) {
      if (error instanceof Error) return error.message
      return String(error)
    }

    async function request(path, options = {}) {
      const response = await fetch(`${API}${path}`, {
        method: options.method ?? 'GET',
        credentials: 'same-origin',
        headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
      const text = await response.text()
      let payload
      if (text.length > 0) {
        try {
          payload = JSON.parse(text)
        } catch {
          payload = undefined
        }
      }
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
      if (payload === undefined) throw new Error('empty response')
      return payload
    }

    function SkillGlyph(props) {
      const size = props.size ?? 15
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M3 2.8h6.2c1.1 0 2 .9 2 2v8.4H5c-1.1 0-2-.9-2-2z' }),
        h('path', { d: 'M11.2 5.6H13v7.6H5.4' }),
        h('path', { d: 'M5.4 6.2h3.4M5.4 8.8h3.4' }),
      )
    }

    function RefreshGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 13,
          height: 13,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M13.2 6.4A5.4 5.4 0 0 0 3.4 5' }),
        h('path', { d: 'M2.8 2.6v3h3' }),
        h('path', { d: 'M2.8 9.6A5.4 5.4 0 0 0 12.6 11' }),
        h('path', { d: 'M13.2 13.4v-3h-3' }),
      )
    }

    function PanelIcon(props) {
      const size = props.size ?? 18
      return h(
        'svg',
        {
          viewBox: '0 0 20 20',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: props.active === true ? 1.8 : 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M3 5.4h8.4M3 10h8.4M3 14.6h5.2' }),
        h('path', { d: 'M12.4 12.6h4.4M14.6 10.4v4.4' }),
      )
    }

    function SkillRow(props) {
      const { t, skill, busy, onToggle } = props
      const pending = busy
      return h(
        'div',
        { className: 'sp-row', 'data-enabled': skill.enabled ? 'true' : 'false' },
        h('span', { className: 'sp-glyph', 'aria-hidden': 'true' }, h(SkillGlyph, { size: 15 })),
        h(
          'div',
          { className: 'sp-body' },
          h(
            'div',
            { className: 'sp-nameRow' },
            h('span', { className: 'sp-name' }, skill.name),
            skill.source === undefined ? null : h('span', { className: 'sp-chip' }, SOURCE_LABELS[skill.source] ?? skill.source),
            skill.enabled ? null : h('span', { className: 'sp-chip', 'data-tone': 'disabled' }, t('disabled')),
            skill.modelInvocable === false ? h('span', { className: 'sp-chip' }, t('userOnly')) : null,
            skill.userInvocable === false ? h('span', { className: 'sp-chip' }, t('modelOnly')) : null,
          ),
          skill.description === undefined ? null : h('p', { className: 'sp-desc' }, skill.description),
          typeof skill.path === 'string' && skill.path.length > 0
            ? h('p', { className: 'sp-path', title: skill.path }, skill.path)
            : null,
        ),
        h(
          'button',
          {
            className: 'sp-switch',
            type: 'button',
            role: 'switch',
            'aria-checked': skill.enabled ? 'true' : 'false',
            'aria-label': skill.enabled ? t('disable') : t('enable'),
            title: skill.enabled ? t('disable') : t('enable'),
            disabled: pending,
            onClick: () => onToggle(skill),
          },
          h('span', { className: 'sp-knob', 'aria-hidden': 'true' }),
        ),
      )
    }

    function SkillsPanel(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      if (typeof props.useLocale === 'function') props.useLocale((snapshot) => snapshot.active)
      const [status, setStatus] = React.useState('loading')
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const alive = React.useRef(true)

      React.useEffect(
        () => () => {
          alive.current = false
        },
        [],
      )

      const load = React.useCallback(async () => {
        setStatus('loading')
        setError(null)
        try {
          const next = await request('/state')
          if (!alive.current) return
          setData(next)
          setStatus('ready')
        } catch (cause) {
          if (!alive.current) return
          setError(messageOf(cause))
          setStatus('error')
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const toggle = async (skill) => {
        if (busy) return
        setBusy(true)
        setNotice(null)
        try {
          const result = await request('/toggle', {
            method: 'POST',
            body: { name: skill.name, enabled: !skill.enabled },
          })
          if (!alive.current) return
          if (result?.state !== undefined) setData(result.state)
          setStatus('ready')
        } catch (cause) {
          if (alive.current) setNotice(t('saveFailed', { message: messageOf(cause) }))
        } finally {
          if (alive.current) setBusy(false)
        }
      }

      const skills = Array.isArray(data?.skills) ? data.skills : []
      const needle = query.trim().toLowerCase()
      const visible =
        needle.length === 0
          ? skills
          : skills.filter(
              (skill) =>
                skill.name.toLowerCase().includes(needle) ||
                (typeof skill.description === 'string' && skill.description.toLowerCase().includes(needle)),
            )
      const enabledCount = skills.filter((skill) => skill.enabled).length

      let content
      if (status === 'error') {
        content = h(
          'div',
          { className: 'sp-list' },
          h(
            'div',
            { className: 'sp-state' },
            h('p', { className: 'sp-error', role: 'alert' }, `${t('loadFailed')}: ${error}`),
            h('button', { className: 'sp-button', type: 'button', onClick: load }, t('retry')),
          ),
        )
      } else if (status === 'loading' && data === null) {
        content = h('div', { className: 'sp-list' }, h('div', { className: 'sp-state' }, t('loading')))
      } else if (visible.length === 0) {
        content = h('div', { className: 'sp-list' }, h('div', { className: 'sp-state' }, t('empty')))
      } else {
        content = h(
          'div',
          { className: 'sp-list' },
          visible.map((skill) =>
            h(SkillRow, { key: skill.name, t, skill, busy, onToggle: toggle }),
          ),
        )
      }

      return h(
        'div',
        { className: 'sp-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'sp-scroll' },
          h(
            'div',
            { className: 'sp-inner' },
            h(
              'header',
              { className: 'sp-head' },
              h('h1', { className: 'sp-title' }, t('title')),
              h('p', { className: 'sp-intro' }, t('intro')),
            ),
            h(
              'div',
              { className: 'sp-toolbar' },
              h('input', {
                className: 'sp-search',
                type: 'search',
                value: query,
                placeholder: t('search'),
                'aria-label': t('search'),
                onChange: (event) => setQuery(event.target.value),
              }),
              h('span', { className: 'sp-count' }, t('count', { count: skills.length, enabled: enabledCount })),
              h(
                'button',
                { className: 'sp-button', type: 'button', onClick: load, disabled: status === 'loading' },
                h(RefreshGlyph),
                t('refresh'),
              ),
            ),
            data?.persistable === false ? h('p', { className: 'sp-note' }, t('unpersisted')) : null,
            notice === null ? null : h('p', { className: 'sp-error', role: 'alert' }, notice),
            content,
            h('p', { className: 'sp-note' }, t('footnote')),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'skills-panel: dictionaries')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              locale: NS,
              label: () => t('panel'),
            },
            PanelIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({ t, hooks: { locale: ctx.locale } }),
            },
            SkillsPanel,
          ),
        )
      },
    }
  },
})

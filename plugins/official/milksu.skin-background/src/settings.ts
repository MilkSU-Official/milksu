type PluginContext = {
  id: string
  nonce: string
  request(method: string, action: string, input?: unknown): Promise<unknown>
}

type SurfaceSlot =
  | 'content-wallpaper'
  | 'workspace-list'
  | 'control-button'
  | 'workspace-topbar'
  | 'overlay-menu'
  | 'chat-composer'

type SurfaceStyle = {
  mode: 'inherit' | 'solid' | 'image'
  solid?: 'original' | 'paper' | 'graphite' | 'black' | 'cyan' | 'gold' | 'gray' | 'custom'
  custom_color?: string
  foreground?: string
  asset_id?: string
  asset_url?: string
  image_opacity?: number
  blur?: number
  light_mask?: { color?: string; opacity?: number }
  dark_mask?: { color?: string; opacity?: number }
}

type ActiveTheme = { surfaces?: Partial<Record<SurfaceSlot, SurfaceStyle>> }

export {}

declare global {
  interface Window {
    __MILKSU_PLUGIN_CONTEXT__: PluginContext
  }
}

const host = window.__MILKSU_PLUGIN_CONTEXT__
const root = document.querySelector<HTMLElement>('#plugin-root')!
const surfaces: Array<{ slot: SurfaceSlot; title: string; detail: string }> = [
  { slot: 'content-wallpaper', title: '内容壁纸', detail: 'AI 聊天画布和 CTF 题面' },
  { slot: 'workspace-list', title: '列表', detail: '题目、会话和设置列表' },
  { slot: 'control-button', title: '按钮', detail: '宿主标准按钮（危险与禁用状态除外）' },
  { slot: 'workspace-topbar', title: '工作区顶部栏', detail: 'Coding / CTF / CVE 标题、筛选和操作区' },
  { slot: 'overlay-menu', title: '下拉菜单', detail: 'Select、Dropdown、ContextMenu 和 Popover' },
  { slot: 'chat-composer', title: 'Composer', detail: '输入外壳、输入区和工具栏' },
]
const solidOptions = [
  ['original', '系统原始'], ['paper', '纸白'], ['graphite', '石墨'], ['black', '纯黑'],
  ['cyan', '青蓝'], ['gold', '信号金'], ['gray', '冷灰'], ['custom', '自定义'],
] as const
const solidColors: Record<string, string> = {
  original: 'var(--preview)', paper: '#f4f1e8', graphite: '#252525', black: '#000000',
  cyan: '#008ccf', gold: '#f5c842', gray: '#6b7280',
}
const state: Partial<Record<SurfaceSlot, SurfaceStyle>> = {}

root.innerHTML = `
  <style>
    :root {
      color-scheme: dark; font-family: "Noto Sans SC", Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
      --canvas:#111315; --surface:#17191b; --foreground:#f8f8f5; --muted:rgba(248,248,245,.68);
      --border:#3a3d40; --accent:#22bbff; --preview:#0d0f11;
    }
    :root[data-theme="light"] {
      color-scheme:light; --canvas:#ebe9e2; --surface:#f4f2eb; --foreground:#101c2b;
      --muted:#627087; --border:#b7b6af; --accent:#0075a8; --preview:#dedcd5;
    }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--foreground); background:var(--canvas); }
    .panel { display:grid; gap:14px; padding:16px; }
    .intro { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
    h2,h3,p { margin:0; }
    h2 { font-size:16px; } h3 { font-size:14px; }
    p,.hint { color:var(--muted); font-size:12px; line-height:1.5; }
    .surface { display:grid; gap:12px; padding:14px; border:1px solid var(--border); background:var(--surface); border-radius:8px; }
    .surface-head { display:flex; justify-content:space-between; gap:12px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px 12px; }
    label { display:grid; gap:5px; color:var(--muted); font-size:12px; }
    select,input[type="color"] { min-height:34px; width:100%; border:1px solid var(--border); border-radius:5px; background:var(--canvas); color:var(--foreground); }
    input[type="range"] { width:100%; accent-color:var(--accent); }
    input[type="color"] { padding:3px; }
    .actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
    button { min-height:34px; border:1px solid var(--border); border-radius:5px; background:var(--canvas); color:var(--foreground); padding:7px 11px; cursor:pointer; }
    button.primary { border-color:var(--accent); color:var(--accent); }
    button:focus-visible,select:focus-visible,input:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
    .preview { position:relative; min-height:48px; overflow:hidden; border:1px dashed var(--border); border-radius:5px; background:var(--preview); color:var(--preview-foreground,var(--foreground)); }
    .preview::before { position:absolute; inset:-24px; content:""; pointer-events:none; background-image:var(--preview-image,none); background-position:center; background-size:cover; background-repeat:no-repeat; opacity:var(--preview-image-opacity,0); filter:blur(var(--preview-blur,0)); }
    .preview::after { position:absolute; inset:0; content:""; pointer-events:none; background:var(--preview-mask,transparent); }
    .preview span { position:relative; z-index:1; display:grid; min-height:48px; place-items:center; font-size:12px; font-weight:600; text-shadow:0 1px 2px rgb(0 0 0 / .18); }
    .is-hidden { display:none !important; }
    output { min-height:20px; color:var(--muted); font-size:12px; }
    @media (max-width:620px) { .grid { grid-template-columns:1fr; } }
  </style>
  <section class="panel">
    <div class="intro"><div><h2>皮肤表面</h2><p>六个区域可分别保持系统默认、选择纯色或选择独立图片。图片只以宿主管理句柄提供给插件。</p></div><button type="button" id="reset-all">恢复全部系统默认</button></div>
    <div id="surfaces"></div>
    <output id="status" aria-live="polite"></output>
  </section>`

const list = root.querySelector<HTMLElement>('#surfaces')!
const status = root.querySelector<HTMLOutputElement>('#status')!
list.innerHTML = surfaces.map(({ slot, title, detail }) => `
  <article class="surface" data-slot="${slot}">
    <div class="surface-head"><div><h3>${title}</h3><p>${detail}</p></div><button type="button" data-action="reset">单项重置</button></div>
    <div class="grid">
      <label>模式<select data-field="mode"><option value="inherit">跟随系统默认</option><option value="solid">纯色</option><option value="image">图片</option></select></label>
      <label data-group="solid">纯色预设<select data-field="solid">${solidOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      <label data-group="custom">自定义颜色<input data-field="custom" type="color" value="#252525"></label>
      <label data-group="image">图片可见度 <span data-value="opacity">22%</span><input data-field="opacity" type="range" min="0" max="60" value="22"></label>
      <label data-group="image">背景模糊 <span data-value="blur">0px</span><input data-field="blur" type="range" min="0" max="24" value="0"></label>
      <label data-group="image">日间遮罩颜色<input data-field="light-color" type="color" value="#ffffff"></label>
      <label data-group="image">日间遮罩 <span data-value="light-opacity">12%</span><input data-field="light-opacity" type="range" min="0" max="100" value="12"></label>
      <label data-group="image">夜间遮罩颜色<input data-field="dark-color" type="color" value="#000000"></label>
      <label data-group="image">夜间遮罩 <span data-value="dark-opacity">22%</span><input data-field="dark-opacity" type="range" min="0" max="100" value="22"></label>
    </div>
    <div class="preview" aria-hidden="true"><span>图片与文字对比预览 Aa</span></div>
    <div class="actions"><button type="button" class="primary" data-action="choose">选择图片</button><button type="button" data-action="apply">应用此项</button><span class="hint" data-asset>尚未选择图片</span></div>
  </article>`).join('')

function field<T extends HTMLElement>(card: HTMLElement, name: string): T {
  return card.querySelector<T>(`[data-field="${name}"]`)!
}

function styleFor(slot: SurfaceSlot): SurfaceStyle {
  return state[slot] ?? { mode: 'inherit' }
}

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function colorWithOpacity(color: string, opacity: number) {
  const safeColor = /^#[0-9a-f]{6}$/iu.test(color) ? color : currentTheme() === 'dark' ? '#000000' : '#ffffff'
  const safeOpacity = Math.min(1, Math.max(0, opacity))
  return `${safeColor}${Math.round(safeOpacity * 255).toString(16).padStart(2, '0')}`
}

function updateCard(card: HTMLElement) {
  const slot = card.dataset.slot as SurfaceSlot
  const mode = field<HTMLSelectElement>(card, 'mode').value
  const solid = field<HTMLSelectElement>(card, 'solid').value
  card.querySelectorAll<HTMLElement>('[data-group="solid"]').forEach(node => node.classList.toggle('is-hidden', mode !== 'solid'))
  card.querySelectorAll<HTMLElement>('[data-group="custom"]').forEach(node => node.classList.toggle('is-hidden', mode !== 'solid' || solid !== 'custom'))
  card.querySelectorAll<HTMLElement>('[data-group="image"]').forEach(node => node.classList.toggle('is-hidden', mode !== 'image'))
  const opacity = Number(field<HTMLInputElement>(card, 'opacity').value)
  const blur = Number(field<HTMLInputElement>(card, 'blur').value)
  const lightOpacity = Number(field<HTMLInputElement>(card, 'light-opacity').value)
  const darkOpacity = Number(field<HTMLInputElement>(card, 'dark-opacity').value)
  card.querySelector<HTMLElement>('[data-value="opacity"]')!.textContent = `${opacity}%`
  card.querySelector<HTMLElement>('[data-value="blur"]')!.textContent = `${blur}px`
  card.querySelector<HTMLElement>('[data-value="light-opacity"]')!.textContent = `${lightOpacity}%`
  card.querySelector<HTMLElement>('[data-value="dark-opacity"]')!.textContent = `${darkOpacity}%`
  const preview = card.querySelector<HTMLElement>('.preview')!
  const current = styleFor(slot)
	const selectedSolid = field<HTMLSelectElement>(card, 'solid').value
	preview.style.backgroundColor = mode === 'solid'
		? selectedSolid === 'custom' ? field<HTMLInputElement>(card, 'custom').value : solidColors[selectedSolid]
		: 'var(--preview)'
  const theme = currentTheme()
  const maskColor = field<HTMLInputElement>(card, theme === 'dark' ? 'dark-color' : 'light-color').value
  const maskOpacity = Number(field<HTMLInputElement>(card, theme === 'dark' ? 'dark-opacity' : 'light-opacity').value) / 100
  preview.style.setProperty('--preview-image', mode === 'image' && current.asset_url ? `url("${current.asset_url}")` : 'none')
  preview.style.setProperty('--preview-image-opacity', mode === 'image' ? String(opacity / 100) : '0')
  preview.style.setProperty('--preview-blur', mode === 'image' ? `${blur}px` : '0px')
  preview.style.setProperty('--preview-mask', mode === 'image' ? colorWithOpacity(maskColor, maskOpacity) : 'transparent')
  preview.style.setProperty('--preview-foreground', theme === 'dark' ? '#f8f8f5' : '#101c2b')
  card.querySelector<HTMLElement>('[data-asset]')!.textContent = current.asset_id ? '已选择宿主管理图片' : '尚未选择图片'
}

function hydrateCard(card: HTMLElement, style: SurfaceStyle) {
  const slot = card.dataset.slot as SurfaceSlot
  state[slot] = { ...style }
  field<HTMLSelectElement>(card, 'mode').value = style.mode ?? 'inherit'
  field<HTMLSelectElement>(card, 'solid').value = style.solid ?? 'original'
  field<HTMLInputElement>(card, 'custom').value = style.custom_color ?? '#252525'
  field<HTMLInputElement>(card, 'opacity').value = String(Math.round((style.image_opacity ?? 0.22) * 100))
  field<HTMLInputElement>(card, 'blur').value = String(Math.round(style.blur ?? 0))
  field<HTMLInputElement>(card, 'light-color').value = style.light_mask?.color ?? '#ffffff'
  field<HTMLInputElement>(card, 'light-opacity').value = String(Math.round((style.light_mask?.opacity ?? 0.12) * 100))
  field<HTMLInputElement>(card, 'dark-color').value = style.dark_mask?.color ?? '#000000'
  field<HTMLInputElement>(card, 'dark-opacity').value = String(Math.round((style.dark_mask?.opacity ?? 0.22) * 100))
  updateCard(card)
}

function readCard(card: HTMLElement): SurfaceStyle {
  const slot = card.dataset.slot as SurfaceSlot
  const current = styleFor(slot)
  return {
    mode: field<HTMLSelectElement>(card, 'mode').value as SurfaceStyle['mode'],
    solid: field<HTMLSelectElement>(card, 'solid').value as SurfaceStyle['solid'],
    custom_color: field<HTMLInputElement>(card, 'custom').value,
    asset_id: current.asset_id,
    image_opacity: Number(field<HTMLInputElement>(card, 'opacity').value) / 100,
    blur: Number(field<HTMLInputElement>(card, 'blur').value),
    light_mask: {
      color: field<HTMLInputElement>(card, 'light-color').value,
      opacity: Number(field<HTMLInputElement>(card, 'light-opacity').value) / 100,
    },
    dark_mask: {
      color: field<HTMLInputElement>(card, 'dark-color').value,
      opacity: Number(field<HTMLInputElement>(card, 'dark-opacity').value) / 100,
    },
  }
}

function applyTheme(theme: ActiveTheme) {
  for (const { slot } of surfaces) {
    const card = list.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!
    hydrateCard(card, theme.surfaces?.[slot] ?? { mode: 'inherit' })
  }
}

list.addEventListener('input', event => {
  const card = (event.target as HTMLElement).closest<HTMLElement>('.surface')
  if (card) updateCard(card)
})
list.addEventListener('change', event => {
  const card = (event.target as HTMLElement).closest<HTMLElement>('.surface')
  if (card) updateCard(card)
})
list.addEventListener('click', async event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')
  const card = button?.closest<HTMLElement>('.surface')
  if (!button || !card) return
  const slot = card.dataset.slot as SurfaceSlot
  try {
    if (button.dataset.action === 'choose') {
      status.value = `正在为“${surfaces.find(item => item.slot === slot)?.title}”选择图片…`
      const result = await host.request('choose_surface', 'choose', { slot }) as { canceled?: boolean; theme?: ActiveTheme }
      if (!result.canceled && result.theme) applyTheme(result.theme)
      status.value = result.canceled ? '已取消' : '图片已复制到插件专属存储'
      return
    }
    if (button.dataset.action === 'reset') {
      const theme = await host.request('call_ui', 'reset', { slot }) as ActiveTheme
      applyTheme(theme)
      status.value = '已恢复该项系统默认'
      return
    }
    const style = readCard(card)
    if (style.mode === 'image' && !style.asset_id) throw new Error('请先点击“选择图片”')
    const theme = await host.request('call_ui', 'update', { slot, style }) as ActiveTheme
    applyTheme(theme)
    status.value = '已应用该项'
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error)
  }
})

root.querySelector('#reset-all')!.addEventListener('click', async () => {
  try {
    const theme = await host.request('call_ui', 'reset_all') as ActiveTheme
    applyTheme(theme)
    status.value = '所有表面已恢复系统默认'
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error)
  }
})

addEventListener('milksu:theme-changed', () => {
  list.querySelectorAll<HTMLElement>('.surface').forEach(updateCard)
})

void host.request('call_ui', 'get').then((theme: unknown) => applyTheme(theme as ActiveTheme)).catch(error => {
  status.value = error instanceof Error ? error.message : String(error)
})

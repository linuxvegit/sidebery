import { Stored, CustomStyles, Reactivator } from 'src/types'
import { NOID } from 'src/defaults'
import * as Settings from 'src/services/settings'
import * as Store from 'src/services/storage.fg'
import * as Info from 'src/services/info'
import * as Sidebar from 'src/services/sidebar.fg'
import * as Windows from 'src/services/windows.fg'
import * as Utils from 'src/utils'
import * as Logs from 'src/services/logs'
import * as Sync from 'src/services/sync.fg'
import * as Notifications from 'src/services/notifications.fg'
import { translate } from 'src/dict'

import * as Styles from 'src/services/styles'
export * from 'src/services/styles'

declare const __CHROMIUM__: boolean

const defaultColorScheme = Styles.getSystemColorScheme()

export let reactive: Styles.StylesState = {
  frameColorScheme: defaultColorScheme,
  toolbarColorScheme: defaultColorScheme,
  actElColorScheme: defaultColorScheme,
  popupColorScheme: defaultColorScheme,
}
export let sidebarCSS = ''
export const setSidebarCSS = (s: string) => (sidebarCSS = s)
export let groupCSS = ''
export const setGroupCSS = (s: string) => (groupCSS = s)
export let theme: browser.theme.Theme | undefined = undefined
export let parsedTheme: Styles.ParsedTheme | undefined = undefined

export function reactivate(r: Reactivator<Styles.StylesState>) {
  reactive = r(reactive)
}

export async function load(): Promise<void> {
  await updateColorScheme()
}

export function setupListeners(): void {
  Styles._setupAutoColorSchemeListener(() => updateColorScheme())

  browser.theme.onUpdated.addListener(upd => {
    // Ignore update for different window
    if (upd && upd.windowId !== undefined && Windows.id !== NOID && upd.windowId !== Windows.id) {
      return
    }

    updateColorScheme(upd?.theme)
  })

  if (Info.isSidebar) {
    Store.onKeyChange('sidebarCSS', css => {
      applyCustomCSS(css)
      Sidebar.recalcElementSizesDebounced()
    })
  }
}

export async function updateColorScheme(newTheme?: browser.theme.Theme): Promise<void> {
  // On Chrome, treat 'ff' (follow Firefox theme) as 'sys' since there's no Firefox theme API
  const effectiveScheme = (__CHROMIUM__ && Settings.state.colorScheme === 'ff') ? 'sys' : Settings.state.colorScheme

  if (effectiveScheme === 'ff') {
    if (!newTheme) {
      newTheme = await browser.theme.getCurrent(Windows.id !== NOID ? Windows.id : undefined)
    }

    const result = Styles.parseFirefoxTheme(newTheme)

    if (!result.error) applyThemeSrcVars(result)
    else resetThemeSrcVars()

    if (!result.error) {
      reactive.frameColorScheme = Styles.getColorSchemeName(result.frameVariant)
      reactive.toolbarColorScheme = Styles.getColorSchemeName(result.toolbarVariant)
      reactive.actElColorScheme = Styles.getColorSchemeName(result.actElVariant)
      reactive.popupColorScheme = Styles.getColorSchemeName(result.popupVariant)
      theme = newTheme
      parsedTheme = result
    } else {
      Styles.updColorScheme(reactive)
    }
  } else {
    resetThemeSrcVars()

    theme = {}
    parsedTheme = undefined
  }

  if (effectiveScheme === 'sys') Styles.updColorScheme(reactive)
  else if (effectiveScheme === 'dark') Styles.updColorScheme(reactive, 'dark')
  else if (effectiveScheme === 'light') Styles.updColorScheme(reactive, 'light')

  // On Chrome, apply Nord theme colors and force dark color scheme
  if (__CHROMIUM__) {
    applyChromeSystemColors()
    Styles.updColorScheme(reactive, 'dark')
  }
}

export async function loadCustomSidebarCSS(): Promise<void> {
  let stored = await browser.storage.managed.get<Stored>('sidebarCSS').catch(() => {})
  if (!stored?.sidebarCSS) {
    stored = await browser.storage.local.get<Stored>('sidebarCSS')
  }

  applyCustomCSS(stored.sidebarCSS)
  // Recalculate sizes when custom CSS is changed
  Sidebar.recalcElementSizesDebounced()
}

/**
 * Update custom css
 */
function applyCustomCSS(css?: string | null): void {
  if (css === null || css === undefined) return

  // Find or create new style element
  let customStyleEl = document.getElementById('custom_css') as HTMLStyleElement
  if (!customStyleEl) {
    customStyleEl = document.createElement('style')
    customStyleEl.id = 'custom_css'
    document.head.appendChild(customStyleEl)
  } else {
    // Remove old styles
    while (customStyleEl.lastChild) {
      customStyleEl.removeChild(customStyleEl.lastChild)
    }
  }

  // Apply css
  if (css) customStyleEl.appendChild(document.createTextNode(css))
}

export function removeCustomCSS(): void {
  const customStyleEl = document.getElementById('custom_css') as HTMLStyleElement
  if (customStyleEl) customStyleEl.remove()
}

/**
 * Save custom css
 */
export async function saveCustomCSS() {
  await Store.set({ sidebarCSS, groupCSS })

  if (Settings.state.syncSaveStyles) await saveStylesToSync()
}

export async function loadCustomCSS(): Promise<void> {
  const stored = await browser.storage.local.get<Stored>(['sidebarCSS', 'groupCSS'])
  if (stored.sidebarCSS) sidebarCSS = stored.sidebarCSS
  if (stored.groupCSS) groupCSS = stored.groupCSS
}

export async function saveStylesToSync(): Promise<void> {
  const value: CustomStyles = {}

  if (sidebarCSS) value.sidebarCSS = sidebarCSS
  if (groupCSS) value.groupCSS = groupCSS

  await Sync.save(Sync.SyncedEntryType.Styles, value)
}

export async function importSyncedStyles(entry: Sync.SyncedEntry) {
  Logs.info('Styles.importSyncedStyles(): entry:', entry)

  const prevStyles: CustomStyles = {}
  const stored = await browser.storage.local.get<Stored>(['sidebarCSS', 'groupCSS'])
  if (stored.sidebarCSS) prevStyles.sidebarCSS = stored.sidebarCSS
  if (stored.groupCSS) prevStyles.groupCSS = stored.groupCSS

  const styles = await Sync.getData<CustomStyles>(entry)
  if (!styles) {
    Logs.err('Styles.importSyncedStyles(): No data')
    return
  }

  await importStyles(styles)

  Notifications.notify({
    icon: '#icon_sync',
    title: translate('sync.success.import_styles'),
    ctrl: translate('notif.undo_ctrl'),
    callback: () => importStyles(prevStyles),
  })
}

export async function importStyles(styles: CustomStyles) {
  Logs.info('Styles.importStyles(): styles:', styles)

  await Store.set({
    sidebarCSS: styles.sidebarCSS ?? '',
    groupCSS: styles.groupCSS ?? '',
  })

  if (Info.isSidebar) {
    if (styles.sidebarCSS) applyCustomCSS(styles.sidebarCSS)
    else removeCustomCSS()
    Sidebar.recalcElementSizesDebounced()
  }
}

export function applyThemeSrcVars(parsed: Styles.ParsedTheme, rootEl?: HTMLElement): void {
  if (!rootEl) rootEl = document.body
  if (!rootEl) return

  for (const colorName of Styles.SRC_VARS) {
    if (parsed.vars[colorName]) continue

    rootEl.style.removeProperty(Utils.toCSSVarName('s_' + colorName))
  }

  for (const prop of Object.keys(parsed.vars) as (keyof Styles.SrcVars)[]) {
    const value = parsed.vars[prop]

    if (value) {
      rootEl.style.setProperty(Utils.toCSSVarName('s_' + prop), value)
    } else {
      rootEl.style.removeProperty(Utils.toCSSVarName('s_' + prop))
    }
  }
}

export function resetThemeSrcVars(): void {
  const rootEl = document.body
  if (!rootEl) return

  for (const colorName of Styles.SRC_VARS) {
    rootEl.style.removeProperty(Utils.toCSSVarName('s_' + colorName))
  }
}

/**
 * On Chrome, apply Nord theme colors as source variables.
 * Nord palette: https://www.nordtheme.com/
 *   Polar Night: #2E3440, #3B4252, #434C5E, #4C566A
 *   Snow Storm:  #D8DEE9, #E5E9F0, #ECEFF4
 *   Frost:       #8FBCBB, #88C0D0, #81A1C1, #5E81AC
 */
function applyChromeSystemColors(): void {
  if (typeof document === 'undefined') return
  const rootEl = document.body
  if (!rootEl) return

  // Nord Polar Night
  const nord0 = 'rgb(46, 52, 64)'    // #2E3440 – frame bg
  const nord1 = 'rgb(59, 66, 82)'    // #3B4252 – toolbar / popup bg
  const nord2 = 'rgb(67, 76, 94)'    // #434C5E – active element bg
  const nord3 = 'rgb(76, 86, 106)'   // #4C566A – borders / subtle

  // Nord Snow Storm
  const nord4 = 'rgb(216, 222, 233)' // #D8DEE9 – primary fg
  const nord5 = 'rgb(229, 233, 240)' // #E5E9F0
  const nord6 = 'rgb(236, 239, 244)' // #ECEFF4

  // Nord Frost
  const nord8 = 'rgb(136, 192, 208)' // #88C0D0 – accent

  rootEl.style.setProperty('--s-frame-bg', nord0)
  rootEl.style.setProperty('--s-frame-fg', nord4)
  rootEl.style.setProperty('--s-toolbar-bg', nord1)
  rootEl.style.setProperty('--s-toolbar-fg', nord4)
  rootEl.style.setProperty('--s-act-el-bg', nord2)
  rootEl.style.setProperty('--s-act-el-fg', nord6)
  rootEl.style.setProperty('--s-popup-bg', nord1)
  rootEl.style.setProperty('--s-popup-fg', nord4)
  rootEl.style.setProperty('--s-popup-border', nord3)
  rootEl.style.setProperty('--s-toolbar-border', nord3)
  rootEl.style.setProperty('--s-accent', nord8)
}

export function updateGlobalFontSize(): void {
  const htmlEl = document.documentElement
  if (Settings.state.fontSize === 'xxs') htmlEl.style.fontSize = '14.5px'
  else if (Settings.state.fontSize === 'xs') htmlEl.style.fontSize = '15px'
  else if (Settings.state.fontSize === 's') htmlEl.style.fontSize = '15.5px'
  else if (Settings.state.fontSize === 'm') htmlEl.style.fontSize = '16px'
  else if (Settings.state.fontSize === 'l') htmlEl.style.fontSize = '16.5px'
  else if (Settings.state.fontSize === 'xl') htmlEl.style.fontSize = '17px'
  else if (Settings.state.fontSize === 'xxl') htmlEl.style.fontSize = '17.5px'
  else htmlEl.style.fontSize = '16px'
}

export function udpateGlobalFontFamily() {
  const bodyEl = document.body
  if (!bodyEl) return

  if (Settings.state.fontFamily) {
    bodyEl.style.setProperty('--general-font-family', `${Settings.state.fontFamily}, system-ui`)
  } else {
    bodyEl.style.setProperty('--general-font-family', 'system-ui')
  }
}

/**
 * Browser compatibility layer for Chrome/Firefox cross-browser support.
 *
 * This module detects the current browser and provides polyfills or stubs
 * for Firefox-specific APIs when running in Chrome, and vice versa.
 *
 * Usage:
 *   import * as BrowserCompat from 'src/browser-compat'
 *   BrowserCompat.init()
 *
 * After init(), the global `browser` (or `chrome`) object will be patched
 * with the necessary compatibility shims.
 */

// Use compile-time __CHROMIUM__ constant for browser detection.
// Runtime detection via `typeof globalThis.browser` is unreliable because
// modern Chrome (109+) now provides the `browser` namespace natively.
declare const __CHROMIUM__: boolean
export const IS_CHROME: boolean = typeof __CHROMIUM__ !== 'undefined' && __CHROMIUM__

export const IS_FIREFOX = !IS_CHROME

// In Chrome builds, esbuild replaces `browser` with `chrome`.
// We keep a typed reference for use in polyfill code.
const api: typeof browser = IS_CHROME ? (globalThis as any).chrome : (globalThis as any).browser

// -----------------------------------------------------------------------
//  Session storage polyfill for Chrome
//  Firefox has sessions.set/getTabValue & sessions.set/getWindowValue
//  Chrome does not — we emulate them via chrome.storage.session (MV3)
//  or chrome.storage.local as fallback.
// -----------------------------------------------------------------------
const SESSION_TAB_PREFIX = '__tab_session_'
const SESSION_WIN_PREFIX = '__win_session_'

function getSessionStorage(): any {
  return (api.storage as any).session ?? api.storage.local
}

/**
 * Resolve WINDOW_ID_CURRENT (-2) to actual window ID.
 */
async function resolveWindowId(windowId: ID): Promise<ID> {
  if (IS_CHROME && windowId === api.windows.WINDOW_ID_CURRENT) {
    const win = await api.windows.getCurrent()
    return win.id ?? windowId
  }
  return windowId
}

async function setTabValue<T>(tabId: ID, key: string, value: T): Promise<void> {
  const storageKey = `${SESSION_TAB_PREFIX}${tabId}_${key}`
  await getSessionStorage().set({ [storageKey]: value })
}

async function getTabValue<T>(tabId: ID, key: string): Promise<T | undefined> {
  const storageKey = `${SESSION_TAB_PREFIX}${tabId}_${key}`
  const result = await getSessionStorage().get(storageKey)
  return result[storageKey] as T | undefined
}

async function setWindowValue<T>(windowId: ID, key: string, value: T): Promise<void> {
  const resolvedId = await resolveWindowId(windowId)
  const storageKey = `${SESSION_WIN_PREFIX}${resolvedId}_${key}`
  await getSessionStorage().set({ [storageKey]: value })
}

async function getWindowValue<T>(windowId: ID, key: string): Promise<T | undefined> {
  const resolvedId = await resolveWindowId(windowId)
  const storageKey = `${SESSION_WIN_PREFIX}${resolvedId}_${key}`
  const result = await getSessionStorage().get(storageKey)
  return result[storageKey] as T | undefined
}

// -----------------------------------------------------------------------
//  Context menus compatibility
//  Firefox: browser.menus  /  Chrome: chrome.contextMenus
// -----------------------------------------------------------------------
function patchMenusApi(): void {
  if (IS_CHROME && !(api as any).menus && (api as any).contextMenus) {
    const onclickHandlers: Map<string, () => void> = new Map()

    ;(api as any).menus = {
      create: (props: any) => {
        // Chrome doesn't support viewTypes, overrideContext, etc.
        const chromeProps = { ...props }
        delete chromeProps.viewTypes
        delete chromeProps.icons

        // Chrome MV3 doesn't support onclick in create — must use onClicked event
        if (chromeProps.onclick && chromeProps.id) {
          onclickHandlers.set(chromeProps.id, chromeProps.onclick)
          delete chromeProps.onclick
        }

        // Chrome uses 'contexts' but some Firefox-specific context types
        // like 'tab', 'bookmark', 'tools_menu' aren't supported
        if (chromeProps.contexts) {
          const contextMap: Record<string, string> = {
            browser_action: 'action',
            page_action: 'action',
          }
          const unsupported = ['tab', 'bookmark', 'tools_menu']
          chromeProps.contexts = chromeProps.contexts
            .map((c: string) => contextMap[c] || c)
            .filter((c: string) => !unsupported.includes(c))
          if (chromeProps.contexts.length === 0) chromeProps.contexts = ['all']
        }

        return (api as any).contextMenus.create(chromeProps, () => {
          // Ignore "duplicate id" errors from Chrome on service worker restart
          if (chrome.runtime.lastError) { /* suppress */ }
        })
      },
      removeAll: () => {
        onclickHandlers.clear()
        return (api as any).contextMenus.removeAll()
      },
      // overrideContext is a no-op on Chrome
      overrideContext: () => {},
      // onHidden doesn't exist in Chrome; provide a stub event
      onHidden: {
        addListener: () => {},
        removeListener: () => {},
        hasListener: () => false,
      },
    }

    // Set up onClicked handler to dispatch to onclick handlers
    if ((api as any).contextMenus.onClicked) {
      ;(api as any).contextMenus.onClicked.addListener((info: any) => {
        const handler = onclickHandlers.get(info.menuItemId)
        if (handler) handler()
      })
    }
  }
}

// -----------------------------------------------------------------------
//  sidebarAction stub for Chrome (use sidePanel API instead)
// -----------------------------------------------------------------------
function patchSidebarAction(): void {
  if (IS_CHROME && !(api as any).sidebarAction) {
    ;(api as any).sidebarAction = {
      open: async () => {
        // Chrome uses sidePanel API — open for current window
        if ((api as any).sidePanel) {
          const win = await api.windows.getCurrent()
          if (win.id) await (api as any).sidePanel.open({ windowId: win.id })
        }
      },
      close: async () => {
        // No direct close API in Chrome sidePanel
      },
      toggle: async () => {
        // Chrome sidePanel does not support toggle — just open
        if ((api as any).sidePanel) {
          const win = await api.windows.getCurrent()
          if (win.id) await (api as any).sidePanel.open({ windowId: win.id })
        }
      },
      setTitle: (_details: any) => {
        // No equivalent in Chrome
      },
      isOpen: async (_details?: any): Promise<boolean> => {
        // On Chrome, assume the sidePanel is open if this code is running
        // in the sidebar context. For background service worker, we can't
        // reliably know, so return true to allow IPC attempts.
        return true
      },
    }
  }
}

// -----------------------------------------------------------------------
//  browserAction → action mapping for Chrome MV3
// -----------------------------------------------------------------------
function patchBrowserAction(): void {
  if (IS_CHROME && !(api as any).browserAction && (api as any).action) {
    ;(api as any).browserAction = (api as any).action
  }
}

// -----------------------------------------------------------------------
//  pageAction stub for Chrome MV3 (merged into action)
// -----------------------------------------------------------------------
function patchPageAction(): void {
  if (IS_CHROME && !(api as any).pageAction) {
    ;(api as any).pageAction = {
      setTitle: () => {},
      show: async () => {},
      hide: async () => {},
    }
  }
}

// -----------------------------------------------------------------------
//  sessions API polyfill for Chrome
// -----------------------------------------------------------------------
function patchSessions(): void {
  if (IS_CHROME) {
    const sessions = api.sessions as any
    if (!sessions.setTabValue) sessions.setTabValue = setTabValue
    if (!sessions.getTabValue) sessions.getTabValue = getTabValue
    if (!sessions.setWindowValue) sessions.setWindowValue = setWindowValue
    if (!sessions.getWindowValue) sessions.getWindowValue = getWindowValue
    if (!sessions.forgetClosedWindow) {
      sessions.forgetClosedWindow = async () => {}
    }
    if (!sessions.forgetClosedTab) {
      sessions.forgetClosedTab = async () => {}
    }
  }
}

// -----------------------------------------------------------------------
//  contextualIdentities stub for Chrome
//  Firefox Multi-Account Containers don't exist in Chrome.
//  Provide no-op stubs so container-related code doesn't crash.
// -----------------------------------------------------------------------
function patchContextualIdentities(): void {
  if (IS_CHROME && !(api as any).contextualIdentities) {
    const noop = async () => ({})
    const emptyEvent = {
      addListener: () => {},
      removeListener: () => {},
      hasListener: () => false,
    }
    let containerCounter = 0
    ;(api as any).contextualIdentities = {
      query: async () => [],
      get: async (id: string) => ({
        cookieStoreId: id,
        name: '',
        icon: 'fingerprint',
        color: 'toolbar',
        colorCode: '#686868',
      }),
      create: async (details: any) => {
        const cookieStoreId = `chrome-container-${Date.now()}-${++containerCounter}`
        return {
          cookieStoreId,
          name: details?.name ?? '',
          icon: details?.icon ?? 'fingerprint',
          color: details?.color ?? 'toolbar',
          colorCode: details?.colorCode ?? '#686868',
        }
      },
      update: noop,
      remove: noop,
      onCreated: emptyEvent,
      onRemoved: emptyEvent,
      onUpdated: emptyEvent,
    }
  }
}

// -----------------------------------------------------------------------
//  tabs.hide / tabs.show stubs for Chrome (not supported)
// -----------------------------------------------------------------------
function patchTabsHideShow(): void {
  if (IS_CHROME) {
    const tabs = api.tabs as any
    if (!tabs.hide) tabs.hide = async () => []
    if (!tabs.show) tabs.show = async () => {}
    if (!tabs.moveInSuccession) tabs.moveInSuccession = async () => {}
    if (!tabs.warmup) tabs.warmup = async () => {}

    // Chrome MV3: tabs.executeScript is removed, polyfill via scripting API
    if (!tabs.executeScript && (api as any).scripting) {
      tabs.executeScript = async (tabId: number, opts: any) => {
        if (opts.code) {
          // Chrome MV3 CSP blocks new Function() and eval(), so we pass
          // the code as an arg and use a static func to set init data.
          // The code pattern is always: window.sideberyInitData=<JSON>;window.onSideberyInitDataReady?.()
          const initDataMatch = opts.code.match(
            /^window\.sideberyInitData=(.*);window\.onSideberyInitDataReady\?\.\(\)$/
          )
          if (initDataMatch) {
            const initData = JSON.parse(initDataMatch[1])
            return (api as any).scripting.executeScript({
              target: { tabId, allFrames: opts.allFrames || false },
              func: (data: any) => {
                ;(window as any).sideberyInitData = data
                ;(window as any).onSideberyInitDataReady?.()
              },
              args: [initData],
              injectImmediately: opts.runAt === 'document_start',
            })
          }
          // Handle force-discard beforeunload clearing
          if (opts.code.includes('onbeforeunload=null')) {
            return (api as any).scripting.executeScript({
              target: { tabId, allFrames: opts.allFrames || false },
              func: () => {
                ;(window as any).onbeforeunload = null
                window.addEventListener('beforeunload', e => {
                  e.returnValue = ''
                })
              },
              injectImmediately: opts.runAt === 'document_start',
            })
          }
          // Generic fallback: use scripting.executeScript with func wrapper
          // This avoids CSP violations from injecting <script> elements
          return (api as any).scripting.executeScript({
            target: { tabId, allFrames: opts.allFrames || false },
            func: (codeStr: string) => {
              try {
                const fn = new Function(codeStr)
                fn()
              } catch {
                // CSP may block this — silently fail
              }
            },
            args: [opts.code],
            injectImmediately: opts.runAt === 'document_start',
          })
        } else if (opts.file) {
          return (api as any).scripting.executeScript({
            target: { tabId, allFrames: opts.allFrames || false },
            files: [opts.file],
            injectImmediately: opts.runAt === 'document_start',
          })
        }
      }
    }

    // Chrome MV3: tabs.saveAsPDF doesn't exist
    if (!tabs.saveAsPDF) tabs.saveAsPDF = async () => 'not_saved'

    // Chrome: tabs.discard(tabId) only accepts a single tab ID, not an array.
    // Polyfill to iterate over array and discard each tab individually.
    const origDiscard = tabs.discard?.bind(tabs)
    if (origDiscard) {
      tabs.discard = async (tabIds: number | number[]) => {
        if (Array.isArray(tabIds)) {
          await Promise.allSettled(tabIds.map(id => origDiscard(id)))
        } else {
          return origDiscard(tabIds)
        }
      }
    }

    // Chrome: tabs.captureTab doesn't exist. Provide a limited polyfill
    // using captureVisibleTab for the active tab in the current window.
    if (!tabs.captureTab && (api.tabs as any).captureVisibleTab) {
      tabs.captureTab = async (tabId?: number, options?: any) => {
        // captureVisibleTab only works for the active tab — we can't capture
        // an arbitrary tab by ID. Return empty string for non-active tabs.
        try {
          return await (api.tabs as any).captureVisibleTab(undefined, options)
        } catch {
          return ''
        }
      }
    }

    // Chrome: tabs.duplicate(tabId) does not accept a second options argument
    // like Firefox's tabs.duplicate(tabId, { active, index }). Polyfill by
    // duplicating first, then moving/updating the tab as needed.
    const origDuplicate = tabs.duplicate.bind(tabs)
    tabs.duplicate = async (tabId: number, opts?: { active?: boolean; index?: number }) => {
      const dupTab = await origDuplicate(tabId)
      if (!dupTab) return dupTab
      const updates: Record<string, any> = {}
      if (opts?.index !== undefined && dupTab.index !== opts.index) {
        await api.tabs.move(dupTab.id!, { index: opts.index })
      }
      if (opts?.active !== undefined && dupTab.active !== opts.active) {
        updates.active = opts.active
      }
      if (Object.keys(updates).length > 0) {
        return api.tabs.update(dupTab.id!, updates)
      }
      return dupTab
    }
  }
}

// -----------------------------------------------------------------------
//  theme API stub for Chrome
// -----------------------------------------------------------------------
function patchTheme(): void {
  if (IS_CHROME && !(api as any).theme) {
    ;(api as any).theme = {
      getCurrent: async () => ({ colors: null, images: null, properties: null }),
      update: () => {},
      reset: () => {},
      onUpdated: {
        addListener: () => {},
        removeListener: () => {},
        hasListener: () => false,
      },
    }
  }
}

// -----------------------------------------------------------------------
//  runtime.getBrowserInfo stub for Chrome
// -----------------------------------------------------------------------
function patchRuntimeGetBrowserInfo(): void {
  if (IS_CHROME && !api.runtime.getBrowserInfo) {
    ;(api.runtime as any).getBrowserInfo = async () => ({
      name: 'Chrome',
      vendor: 'Google',
      version: navigator.userAgent.match(/Chrome\/(\d+[\d.]*)/)?.[1] ?? 'unknown',
      buildID: '',
    })
  }
}

// -----------------------------------------------------------------------
//  windows.update – strip titlePreface for Chrome
// -----------------------------------------------------------------------
function patchWindowsUpdate(): void {
  if (IS_CHROME) {
    const origUpdate = api.windows.update.bind(api.windows)
    ;(api.windows as any).update = (windowId: ID, updateInfo: any) => {
      // Remove titlePreface — not supported in Chrome
      const cleaned = { ...updateInfo }
      delete cleaned.titlePreface
      // Don't call update if there's nothing left to update
      if (Object.keys(cleaned).length === 0) return Promise.resolve({} as any)
      return origUpdate(windowId, cleaned)
    }
  }
}

// -----------------------------------------------------------------------
//  search API minor adaptation for Chrome
// -----------------------------------------------------------------------
function patchSearch(): void {
  if (IS_CHROME && (api as any).search) {
    // Chrome uses chrome.search.query() instead of browser.search.search().
    // Map Firefox's search.search() API to Chrome's search.query() API.
    const chromeQuery = (api as any).search.query?.bind((api as any).search)
    if (chromeQuery) {
      ;(api as any).search.search = (props: any) => {
        const queryProps: any = {}
        if (props.query) queryProps.text = props.query
        if (props.tabId !== undefined) queryProps.tabId = props.tabId
        // Map disposition: CURRENT_TAB, NEW_TAB, NEW_WINDOW
        if (props.disposition) queryProps.disposition = props.disposition
        return chromeQuery(queryProps)
      }
    } else {
      // Fallback: if search.query doesn't exist, provide a no-op
      ;(api as any).search.search = async () => {}
    }
  }
}

// -----------------------------------------------------------------------
//  proxy API stub for Chrome (very different architecture)
// -----------------------------------------------------------------------
function patchProxy(): void {
  if (IS_CHROME) {
    const proxy = (api as any).proxy
    if (proxy && !proxy.onRequest) {
      proxy.onRequest = {
        addListener: () => {},
        removeListener: () => {},
        hasListener: () => false,
      }
    }
  }
}

// -----------------------------------------------------------------------
//  bookmarks.TreeNodeType — Chrome uses 'bookmark'|'folder' but no 'separator'.
//  Patch bookmarks.create to ignore type='separator' in Chrome.
// -----------------------------------------------------------------------
function patchBookmarks(): void {
  if (IS_CHROME && api.bookmarks) {
    const origCreate = api.bookmarks.create.bind(api.bookmarks)
    ;(api.bookmarks as any).create = (details: any) => {
      const cleaned = { ...details }
      // Chrome doesn't support bookmark type or separators
      delete cleaned.type
      return origCreate(cleaned)
    }
  }
}

// -----------------------------------------------------------------------
//  tabs.highlight — strip 'populate' property for Chrome
//  Firefox supports populate in tabs.highlight; Chrome rejects it.
// -----------------------------------------------------------------------
function patchTabsHighlight(): void {
  if (IS_CHROME && api.tabs.highlight) {
    const origHighlight = api.tabs.highlight.bind(api.tabs)
    ;(api.tabs as any).highlight = (info: any) => {
      const cleaned = { ...info }
      delete cleaned.populate
      return origHighlight(cleaned)
    }
  }
}

// -----------------------------------------------------------------------
//  tabs.update — prevent setting openerTabId to the tab itself
//  Firefox allows openerTabId: tabId (self) to "clear" the opener.
//  Chrome throws: "Cannot set a tab's opener to itself."
// -----------------------------------------------------------------------
function patchTabsUpdate(): void {
  if (IS_CHROME) {
    const origUpdate = api.tabs.update.bind(api.tabs)
    ;(api.tabs as any).update = (tabId: any, props: any) => {
      if (props && props.openerTabId === tabId) {
        const cleaned = { ...props }
        delete cleaned.openerTabId
        if (Object.keys(cleaned).length === 0) return Promise.resolve({} as any)
        return origUpdate(tabId, cleaned)
      }
      return origUpdate(tabId, props)
    }
  }
}

// -----------------------------------------------------------------------
//  tabs.create — strip Firefox-only properties for Chrome
//  Chrome strictly validates properties and rejects unknown ones like
//  cookieStoreId, discarded, title (on create), etc.
// -----------------------------------------------------------------------
function patchTabsCreate(): void {
  if (IS_CHROME) {
    const origCreate = api.tabs.create.bind(api.tabs)
    ;(api.tabs as any).create = async (props: any) => {
      const wantDiscarded = !!props.discarded
      const cleaned = { ...props }
      delete cleaned.cookieStoreId
      delete cleaned.discarded
      delete cleaned.title
      // If the caller wanted a discarded tab, ensure it's inactive so we
      // can discard it right after creation.
      if (wantDiscarded && cleaned.active !== false) cleaned.active = false
      const tab = await origCreate(cleaned)
      // Immediately discard the tab to avoid loading it.
      // This emulates Firefox's discarded tab creation behavior.
      if (wantDiscarded && tab?.id) {
        api.tabs.discard(tab.id).catch(() => {})
      }
      return tab
    }
  }
}

// -----------------------------------------------------------------------
//  windows.create — strip Firefox-only properties for Chrome
//  Chrome rejects allowScriptsToClose, titlePreface, etc.
// -----------------------------------------------------------------------
function patchWindowsCreate(): void {
  if (IS_CHROME) {
    const origCreate = api.windows.create.bind(api.windows)
    ;(api.windows as any).create = (props: any) => {
      const cleaned = { ...props }
      delete cleaned.allowScriptsToClose
      delete cleaned.titlePreface
      return origCreate(cleaned)
    }
  }
}

// -----------------------------------------------------------------------
//  history API patch for Chrome
//  Chrome does not have browser.history.onTitleChanged.
//  Provide a no-op stub so code referencing it doesn't crash.
// -----------------------------------------------------------------------
function patchHistory(): void {
  if (IS_CHROME && api.history) {
    const history = api.history as any
    if (!history.onTitleChanged) {
      history.onTitleChanged = {
        addListener: () => {},
        removeListener: () => {},
        hasListener: () => false,
      }
    }
  }
}

// -----------------------------------------------------------------------
//  Enable storage.session access from all extension contexts (Chrome)
//  By default Chrome restricts storage.session to background only.
// -----------------------------------------------------------------------
function enableSessionStorageAccess(): void {
  if (IS_CHROME) {
    const session = (api.storage as any).session
    if (session?.setAccessLevel) {
      session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {})
    }
  }
}

/**
 * Remove session storage entries for a closed tab (Chrome only).
 * Call this from onTabRemoved to prevent session storage quota exhaustion.
 */
export async function cleanupTabSessionData(tabId: ID): Promise<void> {
  if (!IS_CHROME) return
  const storage = getSessionStorage()
  const prefix = `${SESSION_TAB_PREFIX}${tabId}_`
  try {
    const all = await storage.get(null)
    const keysToRemove = Object.keys(all).filter(k => k.startsWith(prefix))
    if (keysToRemove.length) await storage.remove(keysToRemove)
  } catch { /* ignore */ }
}

// =======================================================================
//  Main init function — call this once at startup in every entry point
// =======================================================================
export function init(): void {
  if (!IS_CHROME) return // No patching needed for Firefox

  enableSessionStorageAccess()
  patchMenusApi()
  patchSidebarAction()
  patchBrowserAction()
  patchPageAction()
  patchSessions()
  patchContextualIdentities()
  patchTabsHideShow()
  patchTabsHighlight()
  patchTabsUpdate()
  patchTabsCreate()
  patchTheme()
  patchRuntimeGetBrowserInfo()
  patchWindowsUpdate()
  patchWindowsCreate()
  patchSearch()
  patchProxy()
  patchBookmarks()
  patchHistory()
}

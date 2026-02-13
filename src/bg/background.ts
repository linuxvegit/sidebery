import * as BrowserCompat from 'src/browser-compat'
import * as E from 'src/enums'
import { NOID } from 'src/defaults'

// On Chrome MV3, the service worker has no HTML page to load dict scripts.
// Import translations explicitly so translate() works in the background.
import { commonTranslations } from 'src/_locales/dict.common'
const _global = typeof globalThis !== 'undefined' ? globalThis : ({} as any)
if (!_global.translations) _global.translations = commonTranslations
else Object.assign(_global.translations, commonTranslations)

import * as IPC from 'src/services/ipc'
import * as Logs from 'src/services/logs'
import * as Settings from 'src/services/settings.bg'
import * as Windows from 'src/services/windows.bg'
import * as Favicons from 'src/services/favicons.bg'
import * as Containers from 'src/services/containers.bg'
import * as Tabs from 'src/services/tabs.bg'
import * as Store from 'src/services/storage.bg'
import * as Permissions from 'src/services/permissions.bg'
import * as Snapshots from 'src/services/snapshots.bg'
import * as Sidebar from 'src/services/sidebar.bg'
import * as Info from 'src/services/info.bg'
import * as Menu from 'src/services/menu.bg'
import * as WebReq from 'src/services/web-req.bg'
import * as Sync from 'src/services/sync.bg'
import * as Omnibox from 'src/services/omnibox.bg'
import * as Styles from 'src/services/styles.bg'

// Initialize browser compatibility layer (polyfills for Chrome)
BrowserCompat.init()

void (async function main() {
  Info.setInstanceType(E.InstanceType.bg)
  IPC.setInstanceType(E.InstanceType.bg)
  Logs.setInstanceType(E.InstanceType.bg)

  const ts = performance.now()
  Logs.info('Init start')

  // Register globaly available actions
  IPC.registerActions({
    cacheTabsData: Tabs.cacheTabsData,
    getGroupPageInitData: Tabs.getGroupPageInitData,
    getUrlPageInitData: Tabs.getUrlPageInitData,
    tabsApiProxy: Tabs.tabsApiProxy,
    getSidebarTabs: Tabs.getSidebarTabs,
    detachSidebarTabs: Tabs.detachSidebarTabs,
    openTabs: Tabs.openTabs,
    setActivePanelId: Sidebar.setActivePanelId,
    createSnapshot: Snapshots.createSnapshot,
    addSnapshot: Snapshots.addSnapshot,
    removeSnapshot: Snapshots.removeSnapshot,
    openSnapshotWindows: Snapshots.openWindows,
    createWindowWithTabs: Windows.createWithTabs,
    isWindowTabsLocked: Windows.isWindowTabsLocked,
    saveFavicon: Favicons.saveFavicon,
    reloadFavicons: Favicons.load,
    saveInLocalStorage: Store.setFromRemoteFg,
    checkIpInfo: WebReq.checkIpInfo,
    disableAutoReopening: WebReq.disableAutoReopening,
    enableAutoReopening: WebReq.enableAutoReopening,

    saveToSync: Sync.save,
    saveTabsToSync: Sync.saveTabs,
    saveProfileInfoToGoogleSync: Sync.Google.saveProfileInfo,
    removeFromSync: Sync.remove,
    removeFromFirefoxSync: Sync.Firefox.remove,
    removeByTypeFromSync: Sync.removeByType,
    removeCachedIdFromGoogleSync: Sync.Google.removeCachedId,
    getDataFromSync: Sync.getData,
    loadSync: Sync.load,
  })

  // Init first-need stuff
  IPC.setupGlobalMessageListener()
  IPC.setupConnectionListener()
  await Promise.all([Windows.load(), Containers.load(), Settings.load(), Info.loadVersionInfo()])

  Info.saveVersion()
  Windows.setupWindowsListeners()
  Containers.setupListeners()
  Settings.setupSettingsChangeListener()

  await Sidebar.load()
  Sidebar.setupListeners()

  WebReq.updateReqHandlers()

  Tabs.setupListeners()
  await Tabs.load()

  Permissions.load()
  Permissions.setupListeners()
  Favicons.load()
  Menu.setupListeners()
  Snapshots.scheduleSnapshots()

  // Update title preface on sidebar connection/disconnection
  IPC.onConnected(E.InstanceType.sidebar, winId => {
    Logs.info('IPC.onConnected sidebar', winId)

    const tabs = Windows.byId.get(winId)?.tabs
    if (tabs) Tabs.initInternalPageScripts(tabs)

    if (Settings.state.markWindow && winId !== NOID) {
      IPC.sendToSidebar(winId, 'updWindowPreface')
    }
  })
  IPC.onDisconnected(E.InstanceType.sidebar, winId => {
    Logs.info('IPC.onDisconnected sidebar', winId)

    if (Settings.state.markWindow && Windows.byId.has(winId)) {
      browser.windows.update(winId, { titlePreface: '' })
    }
  })

  initToolbarButton()
  Styles.load()
  Styles.setupListeners()

  browser.runtime.onUpdateAvailable.addListener(details => {
    const currentVersion = Info.versionToInt(browser.runtime.getManifest().version)
    const newVersion = Info.versionToInt(details.version)
    if (newVersion <= currentVersion) browser.runtime.reload()
  })

  Omnibox.setupListeners()
  Omnibox.load()

  Logs.info(`Init end: ${performance.now() - ts}ms`)

  // `window` is not available in Chrome MV3 service workers; use globalThis
  const _global = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self)
  ;(_global as any).getSideberyState = () => {
    return {
      profileId: Info.getProfileId(),
      Windows: {
        byId: Windows.byId,
      },
      Tabs: {
        byId: Tabs.byId,
        cacheByWin: Tabs.cacheByWin,
      },
    }
  }
})()

function initToolbarButton(): void {
  Menu.createBrowserActionMenu()

  if (BrowserCompat.IS_CHROME) {
    // Chrome MV3: use action API and open side panel
    const actionApi = (browser as any).action ?? browser.browserAction
    actionApi.onClicked.addListener((tab: browser.tabs.Tab): void => {
      // Open side panel for the tab's window
      if ((browser as any).sidePanel && tab.windowId) {
        ;(browser as any).sidePanel.open({ windowId: tab.windowId })
      }
    })
  } else {
    browser.browserAction.onClicked.addListener((_, info): void => {
      if (info && info.button === 1) browser.runtime.openOptionsPage()
      else browser.sidebarAction.toggle()
    })
  }
}

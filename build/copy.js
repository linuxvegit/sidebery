/* eslint no-console: off */
import fs from 'fs'
import path from 'path'
import * as Utils from './utils.js'

const COPY = {
  './src/manifest.json': {
    path: `${Utils.ADDON_PATH}/`,
    handler: handleManifest,
  },
  './src/_locales/dict.browser.json': {
    path: `${Utils.ADDON_PATH}/_locales/`,
    handler: handleLocales,
  },
  './src/assets/logo-native-dark.svg': `${Utils.ADDON_PATH}/assets/`,
  './src/assets/logo-native-light.svg': `${Utils.ADDON_PATH}/assets/`,
  './src/assets/logo-native.svg': `${Utils.ADDON_PATH}/assets/`,
  './src/assets/logo.svg': `${Utils.ADDON_PATH}/assets/`,
  './src/assets/logo-16.png': `${Utils.ADDON_PATH}/assets/`,
  './src/assets/logo-32.png': `${Utils.ADDON_PATH}/assets/`,
  './src/assets/logo-48.png': `${Utils.ADDON_PATH}/assets/`,
  './src/assets/logo-96.png': `${Utils.ADDON_PATH}/assets/`,
  './src/assets/logo-128.png': `${Utils.ADDON_PATH}/assets/`,
  './src/assets/group-page-favicon.svg': `${Utils.ADDON_PATH}/assets/`,
  './src/assets/snapshot-native.svg': `${Utils.ADDON_PATH}/assets/`,
  './src/assets/proxy-native.svg': `${Utils.ADDON_PATH}/assets/`,
  './src/assets/window-native.svg': `${Utils.ADDON_PATH}/assets/`,
}
if (!Utils.BUNDLE_VUE) {
  COPY[`./node_modules/vue/dist/${Utils.VUE_DIST}`] = `${Utils.ADDON_PATH}/vendor/`
}

/**
 * ...
 */
async function build() {
  const entries = await parseEntries()
  await copyAllEntries(entries)
}

/**
 * ...
 */
async function copyAndWatch() {
  const entries = await parseEntries()
  await copyAllEntries(entries)

  const tasks = entries
    .filter(e => !e.srcIsDir)
    .map(e => {
      e.files = [e.src]
      return e
    })

  Utils.watch(
    tasks,
    affectedTasks => changeHandler(affectedTasks),
    (task, file) => {
      Utils.log(`Copy: File ${file} was renamed, restart this script`)
      tasks.forEach(t => t.watchers.forEach(w => w.close()))
    }
  )
}

/**
 * ...
 */
async function changeHandler(changedFiles) {
  for (const info of changedFiles) {
    Utils.log(`Copy: Changed source: ${info.src}`)
    await fs.promises.copyFile(info.src, info.dst)
  }
}

/**
 * ...
 */
async function parseEntries() {
  const entriesInfo = []
  for (const src of Object.keys(COPY)) {
    const srcStats = await fs.promises.stat(src)
    const info = { src, srcIsDir: srcStats.isDirectory() }

    const dst = COPY[src]
    let dstPath
    if (typeof dst === 'string') dstPath = dst
    else {
      dstPath = dst.path
      if (dst.handler) info.srcHandler = dst.handler
    }

    if (dstPath) {
      info.dst = path.resolve(dstPath)
      if (dstPath.endsWith('/')) {
        info.destDir = info.dst
        if (!info.srcIsDir) info.dst = path.join(info.dst, path.basename(src))
      } else {
        info.destDir = path.dirname(info.dst)
      }
    }

    entriesInfo.push(info)
  }
  return entriesInfo
}

/**
 * ...
 */
async function copyAllEntries(entries) {
  for (const info of entries) {
    await copyEntry(info)
  }
}

/**
 * ...
 */
async function copyEntry(info) {
  await fs.promises.mkdir(info.destDir, { recursive: true })

  const normSrc = path.normalize(info.src)

  if (info.srcIsDir) {
    for (const f of await Utils.treeToList(normSrc)) {
      const destDir = path.normalize(f.dir.replace(normSrc, info.dst + path.sep))

      if (f.file) {
        const srcPath = path.join(f.dir, f.file)
        const dstPath = path.join(destDir, f.file)
        if (info.srcHandler) await info.srcHandler(srcPath, dstPath)
        else await fs.promises.copyFile(srcPath, dstPath)
      } else await fs.promises.mkdir(destDir, { recursive: true })
    }
  } else {
    if (info.srcHandler) await info.srcHandler(info.src, info.dst)
    else await fs.promises.copyFile(info.src, info.dst)
  }
}

/**
 * Main
 */
function main() {
  Utils.log('Copy: Copying')

  if (Utils.IS_DEV) {
    copyAndWatch()
    Utils.logOk('Copy: Watching')
  } else {
    build()
    Utils.logOk('Copy: Done')
  }
}
main()

async function handleManifest(srcPath, dstPath) {
  const forChromium = process.argv.includes('--chromium')

  // For Chromium builds, use the dedicated Chrome MV3 manifest
  if (forChromium) {
    const chromeSrcPath = srcPath.replace('manifest.json', 'manifest.chrome.json')
    let srcData
    try {
      srcData = await fs.promises.readFile(chromeSrcPath, 'utf-8')
    } catch {
      // Fallback: patch the Firefox manifest if Chrome manifest doesn't exist
      srcData = await fs.promises.readFile(srcPath, 'utf-8')
      const data = JSON.parse(srcData)

      // Convert to MV3
      data.manifest_version = 3

      // Remove unsupported keys
      delete data.page_action
      delete data.browser_specific_settings
      delete data.sidebar_action

      // Convert browser_action → action
      if (data.browser_action) {
        data.action = {
          default_icon: data.browser_action.default_icon,
          default_title: data.browser_action.default_title,
        }
        delete data.browser_action
      }

      // Convert background page → service worker
      if (data.background && data.background.page) {
        data.background = {
          service_worker: data.background.page.replace('.html', '.js').replace('bg/', 'bg/'),
          type: 'module',
        }
      }

      // Add side_panel
      data.side_panel = {
        default_path: 'sidebar/sidebar.html',
      }

      // Reset commands
      for (const key of Object.keys(data.commands)) {
        const cmd = data.commands[key]
        if (key === '_execute_sidebar_action') {
          // Rename to _execute_action for MV3
          data.commands['_execute_action'] = cmd
          delete data.commands[key]
          cmd.suggested_key = { default: cmd.suggested_key?.default || cmd.suggested_key?.windows }
        } else {
          delete cmd.suggested_key
        }
      }

      // Clean up permissions for Chrome
      const removePerms = [
        'contextualIdentities',
        'menus',
        'menus.overrideContext',
        'search',
        'theme',
        'identity',
      ]
      data.permissions = (data.permissions || []).filter(p => !removePerms.includes(p))

      // Add Chrome-specific permissions
      if (!data.permissions.includes('contextMenus')) data.permissions.push('contextMenus')
      if (!data.permissions.includes('sidePanel')) data.permissions.push('sidePanel')
      if (!data.permissions.includes('scripting')) data.permissions.push('scripting')

      // Move <all_urls> to host_permissions (MV3)
      const optionalPerms = data.optional_permissions || []
      const allUrlsIndex = optionalPerms.indexOf('<all_urls>')
      if (allUrlsIndex !== -1) optionalPerms.splice(allUrlsIndex, 1)
      data.host_permissions = ['<all_urls>']

      // Remove Firefox-only optional permissions
      const removeFfOptPerms = ['proxy', 'webRequest', 'webRequestBlocking', 'tabHide']
      data.optional_permissions = optionalPerms.filter(p => !removeFfOptPerms.includes(p))

      // Add tabGroups as optional permission
      if (!data.optional_permissions.includes('tabGroups'))
        data.optional_permissions.push('tabGroups')

      srcData = JSON.stringify(data, null, 2)
    }

    // Ensure we read it correctly (either from Chrome file or generated)
    const data = JSON.parse(srcData)
    const dstData = JSON.stringify(data)
    await fs.promises.writeFile(dstPath, dstData)
  }

  // Firefox: just copy manifest as-is
  else {
    return fs.promises.copyFile(srcPath, dstPath)
  }
}

async function handleLocales(srcPath, dstPath) {
  const dirPath = path.dirname(dstPath)
  const srcData = await fs.promises.readFile(srcPath, 'utf-8')
  const jsonData = JSON.parse(srcData)

  const langs = {}

  for (const key of Object.keys(jsonData)) {
    const dict = jsonData[key]
    if (!dict || typeof dict !== 'object') {
      Utils.logErr(`Copy: Locales: No dictionary for: ${key}`)
      break
    }

    for (const lang of Object.keys(dict)) {
      if (!langs[lang]) langs[lang] = {}
      langs[lang][key] = { message: dict[lang] }
    }
  }

  for (const lang of Object.keys(langs)) {
    const dict = langs[lang]
    const jsonStr = JSON.stringify(dict)
    await fs.promises.mkdir(path.join(dirPath, lang), { recursive: true })
    await fs.promises.writeFile(path.join(dirPath, lang, 'messages.json'), jsonStr)
  }
}

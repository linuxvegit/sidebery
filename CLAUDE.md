# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Sidebery

Sidebery is a Firefox/Chrome browser extension for managing tabs and bookmarks in a sidebar. It features vertical tab panels with tree layout, bookmarks panels, history panel, customizable context menus, custom styles, snapshots, and more.

## Commands

```bash
npm install              # Install dependencies
npm run build            # Production build (all parts)
npm run dev              # Development build with file watching
npm run dev.run -- <firefox-exe>  # Run browser with extension loaded
npm run build.chrome     # Chrome-specific production build
npm run dev.chrome       # Chrome-specific dev build

npm run lint             # Run ESLint + type checking (vue-tsc)
npm run lint.eslint      # ESLint only
npm run lint.types       # Type checking only (vue-tsc --noemit)

npm run test             # Run tests (vitest run)
npm run test.watch       # Watch mode tests
# Run single test file:  npx vitest run src/services/tabs.fg.test.ts

npm run build.ext        # Create .zip extension archive in dist/
```

## Tech Stack

- **Vue 3** (3.5.x) with **Pug** templates (`lang="pug"` in SFCs)
- **TypeScript** (strict mode, ESNext target, `src/*` path alias)
- **Stylus** for CSS preprocessing (`.styl` files in `src/styles/`)
- **ESBuild** + **Vite** for bundling
- **Vitest** with JSDOM environment for tests
- **Prettier**: no semicolons, single quotes, 2-space indent, trailing commas (ES5)

## Architecture

### Extension Instance Types

The extension runs as multiple isolated processes that communicate via IPC:

| Instance | Entry Point | Description |
|----------|-------------|-------------|
| `bg` | `src/bg/background.ts` | Background service worker (all core logic) |
| `sidebar` | `src/sidebar/sidebar.ts` | Main sidebar UI (Vue app) |
| `setup` | `src/page.setup/setup.ts` | Settings/options page |
| `group` | `src/page.group/group.ts` | Tab group page |
| `search` | `src/popup.search/` | Search popup |
| `proxy` | `src/popup.proxy/` | Proxy settings popup |
| `preview` | `src/popup.tab-preview/` | Tab preview popup |
| `editing` | `src/popup.editing/` | Tab title editing popup |
| `sync` | `src/popup.sync/` | Sync status popup |
| `panelConfig` | `src/popup.panel-config/` | Panel config popup |

### Service Layer (`src/services/`)

Services are split by where they run:
- **`*.bg.ts`** - Background-only services (e.g., `tabs.bg.ts`, `windows.bg.ts`, `storage.bg.ts`)
- **`*.fg.ts`** - Foreground/UI services (e.g., `tabs.fg.ts`, `sidebar.fg.ts`, `menu.fg.ts`)
- Services without suffix are shared utilities

Key services:
- **`ipc.ts`** (~35KB) - Port-based IPC between all instances. Uses `browser.runtime.connect()` with typed action routing, auto-reconnection, and 60s request timeout.
- **`tabs.bg.ts` / `tabs.fg.ts`** - Tab management (largest service). Background owns tab state; foreground maintains reactive copies.
- **`sidebar.fg.ts`** (~88KB) - Sidebar panel management, layout, navigation
- **`drag-and-drop.fg.ts`** (~47KB) - Complex DnD for tabs, bookmarks, panels
- **`keybindings.fg.ts`** (~50KB) - Keyboard shortcut handling
- **`storage.bg.ts`** - Persistent state via `browser.storage.local` with buffered writes

### IPC Pattern

Background exports `BgActions` (callable from any instance). Each foreground instance registers its own action handlers. Communication flows:
- `IPC.sendToBg(action, ...args)` - Foreground to background
- `IPC.sendToSidebar(winId, action, ...args)` - Background to specific sidebar
- `IPC.broadcast(action, ...args)` - To all connected instances

### State Management

Uses Vue's reactivity (`reactive()`, `shallowReactive()`) directly - no Vuex/Pinia. Each service module exports reactive state objects. State syncs across instances via IPC + `browser.storage.onChanged`.

### Browser Compatibility

- Firefox: MV2 (`src/manifest.json`), min version 140, uses `sidebar_action`, `contextualIdentities`
- Chrome: MV3 (`src/manifest.chrome.json`), min version 116, uses `sidePanel`, `service_worker`
- `src/browser-compat.ts` provides the compatibility shim

### Translations

Dictionary files in `src/_locales/`. Fallback chain: specific locale (e.g., `pt_BR`) > base locale (`pt`) > English (`en`) > label ID. Translation values can be strings or functions for pluralization.

### Build System

Custom Node.js scripts in `build/`:
- `all.js` - Orchestrates full build (styles, HTML, copy assets, scripts)
- `scripts.js` - ESBuild-based TS/Vue compilation
- `styles.js` - Stylus preprocessing
- `html.js` - HTML page generation
- `copy.js` - Asset copying
- Output goes to `addon/` directory

### Test Setup

Tests mock browser WebExtension APIs (`tests/env-setup.ts`) and IPC (`tests/ipc-setup.ts`). Test files live alongside source in `src/services/*.test.ts`.

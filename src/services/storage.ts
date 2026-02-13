import { Stored, Entries } from 'src/types'
import * as Logs from 'src/services/logs'

type ChangeHandler = <K extends keyof Stored>(newVal: Stored[K]) => void
type ChangeHandlerG<K extends StorageKey> = (newVal: StorageValue<K>) => void
type StorageKey = keyof Stored
type StorageValue<K extends keyof Stored> = Stored[K]

export function storageChangeListener(newValues: Stored): void {
  for (const [key, newValue] of Object.entries(newValues) as Entries<Stored>) {
    const handler = changeHandlers[key]
    if (handler) handler(newValue)
  }
}

export const changeHandlers: { [key in keyof Stored]?: ChangeHandler } = {}

export function onKeyChange<K extends keyof Stored, H extends ChangeHandlerG<K>>(key: K, cb: H) {
  if (changeHandlers[key]) {
    throw Logs.err(`Storage: onKeyChange: "${key}" handler already exists`)
  }

  changeHandlers[key] = cb as ChangeHandler
}

/**
 * Fallback listener using browser.storage.onChanged.
 * On Chrome MV3, the service worker can be evicted, breaking port-based IPC.
 * This ensures FG instances still receive storage changes even when IPC is down.
 * Double-processing is harmless: change handlers compare old vs new values.
 */
export function setupStorageChangeFallback(): void {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return
    for (const [key, change] of Object.entries(changes)) {
      if (change.newValue !== undefined) {
        const handler = changeHandlers[key as keyof Stored]
        if (handler) handler(change.newValue)
      }
    }
  })
}

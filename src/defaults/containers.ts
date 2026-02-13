import { Container } from '../types/containers'
import { IS_CHROME } from 'src/browser-compat'

export const DEFAULT_CONTAINER: Container = {
  id: '',
  cookieStoreId: '',
  name: '',
  icon: 'fingerprint',
  color: 'blue',
  colorCode: '#37adff',
  proxified: false,
  proxy: null,
  reopenRulesActive: false,
  reopenRules: [],
  userAgentActive: false,
  userAgent: '',
}

export const DEFAULT_CONTAINER_ID = IS_CHROME ? '0' : 'firefox-default'
export const PRIVATE_CONTAINER_ID = IS_CHROME ? '1' : 'firefox-private'

// In Chrome MV3 service worker, chrome.extension may not have inIncognitoContext
const _inIncognito =
  typeof browser !== 'undefined' && browser.extension
    ? browser.extension.inIncognitoContext
    : false
export const CONTAINER_ID = _inIncognito ? PRIVATE_CONTAINER_ID : DEFAULT_CONTAINER_ID

// Shared configuration for the extension
// Update these values to match your infrastructure

const CONFIG = {
  // Authentication cookie name
  // Extension only works when this cookie is present
  AUTH_COOKIE_NAME: '_auth_token',

  // Your website domains (used for content script matching)
  SITE_DOMAINS: [
    'svet24.si',
    'necenzurirano.si',
    'reporter.si'
  ],

  // CMS/Admin URL for editing articles
  CMS_URL: 'https://backend.svet24.si',

  // API endpoints
  API_BASE_URL: 'https://api.kme.si/backend/v1',
  USER_INFO_API: 'https://api.kme.si/backend/v1/me',
  CACHE_PURGE_API: 'https://api.yourdomain.com/cache/purge',

  // Authentication (if needed)
  // You may want to store this in chrome.storage.local instead
  // and let users configure it through an options page
  API_KEY: '', // Leave empty or add your API key

  // Article detection patterns
  // Matches URLs like: /revija/jana/estrada/janez-skof-druzina-1864773
  ARTICLE_URL_PATTERNS: [
    /-(\d+)$/  // ID at end of URL after last hyphen
  ],

  // Feature flags
  FEATURES: {
    enableOverlay: true,
    enableCachePurge: true,
    enableQuickEdit: true,
    enableContextMenu: false // Right-click menu items
  },

  // Debug mode
  DEBUG: true
};

// Make config available globally
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}

// For use in service worker
if (typeof globalThis !== 'undefined') {
  globalThis.CONFIG = CONFIG;
}

// Content script - runs on matching web pages
console.log('Editor Help Tools content script loaded');

// State
let overlayEnabled = false;
let overlayElement = null;

// Check if user is authenticated by looking for _auth_token cookie
function isAuthenticated() {
  const authCookieName = CONFIG.AUTH_COOKIE_NAME || '_auth_token';
  const cookies = document.cookie.split(';');
  for (let cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === authCookieName && value) {
      return true;
    }
  }
  return false;
}

// Get auth token value from cookie
function getAuthToken() {
  const authCookieName = CONFIG.AUTH_COOKIE_NAME || '_auth_token';
  const cookies = document.cookie.split(';');
  for (let cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === authCookieName && value) {
      return value;
    }
  }
  return null;
}

// Initialize
async function init() {
  // Only enable features if user is authenticated
  if (!isAuthenticated()) {
    console.log('User not authenticated - extension features disabled');
    return;
  }

  // Load saved overlay state
  const result = await chrome.storage.local.get('overlayEnabled');
  if (result.overlayEnabled) {
    showOverlay();
  }

  // Detect article info
  detectArticleInfo();
}

// Detect if current page is an article and extract info
function detectArticleInfo() {
  // This is a placeholder - customize based on your site structure
  // Examples of what you might look for:
  // - Article ID in URL or data attributes
  // - Meta tags with article information
  // - Specific DOM elements that indicate an article page

  const articleId = extractArticleId();
  const isArticlePage = !!articleId;

  return {
    isArticlePage,
    articleId,
    url: window.location.href
  };
}

// Extract article ID from page
// Extracts ID from URLs like: https://svet24.si/revija/jana/estrada/janez-skof-druzina-1864773
function extractArticleId() {
  // Method 1: Extract from URL - ID is the last segment after the last hyphen
  const pathname = window.location.pathname;
  const segments = pathname.split('/');
  const lastSegment = segments[segments.length - 1];

  // Match pattern: text-text-1234567 (ID is after last hyphen)
  const urlMatch = lastSegment.match(/-(\d+)$/);
  if (urlMatch) {
    return urlMatch[1];
  }

  // Method 2: Check URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const idFromParam = urlParams.get('id') || urlParams.get('article_id');
  if (idFromParam) {
    return idFromParam;
  }

  // Method 3: Check meta tags
  const metaArticleId = document.querySelector('meta[name="article-id"]');
  if (metaArticleId) {
    return metaArticleId.content;
  }

  // Method 4: Check data attributes
  const articleElement = document.querySelector('[data-article-id]');
  if (articleElement) {
    return articleElement.dataset.articleId;
  }

  return null;
}

// Generate edit URL for article
// Format: https://backend.svet24.si/#/article/edit/1864773
function getEditUrl(articleId) {
  if (!articleId) return null;

  return `${CONFIG.CMS_URL}/#/article/edit/${articleId}`;
}

// Show overlay on page
function showOverlay() {
  if (overlayElement) {
    overlayElement.style.display = 'block';
    overlayEnabled = true;
    return;
  }

  const articleInfo = detectArticleInfo();

  overlayElement = document.createElement('div');
  overlayElement.className = 'editor-tools-overlay';
  overlayElement.innerHTML = `
    <div class="overlay-header">
      <span class="overlay-title">Editor Tools Active</span>
      <button class="overlay-close" id="overlayClose">×</button>
    </div>
    <div class="overlay-content">
      ${articleInfo.isArticlePage ? `
        <div class="overlay-item">
          <strong>Article ID:</strong> ${articleInfo.articleId}
        </div>
        <div class="overlay-item">
          <strong>Page:</strong> Article
        </div>
      ` : `
        <div class="overlay-item">
          <strong>Page:</strong> Not an article
        </div>
      `}
      <div class="overlay-item">
        <strong>URL:</strong> ${window.location.pathname}
      </div>
    </div>
  `;

  document.body.appendChild(overlayElement);
  overlayEnabled = true;

  // Add close button handler
  document.getElementById('overlayClose').addEventListener('click', () => {
    hideOverlay();
    chrome.storage.local.set({ overlayEnabled: false });
  });
}

// Hide overlay
function hideOverlay() {
  if (overlayElement) {
    overlayElement.style.display = 'none';
    overlayEnabled = false;
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageInfo') {
    const authenticated = isAuthenticated();
    const authToken = getAuthToken();

    if (!authenticated) {
      sendResponse({
        isAuthenticated: false,
        isArticlePage: false,
        articleId: null,
        url: window.location.href,
        editUrl: null,
        authToken: null
      });
      return true;
    }

    const articleInfo = detectArticleInfo();
    const editUrl = getEditUrl(articleInfo.articleId);

    sendResponse({
      isAuthenticated: true,
      ...articleInfo,
      editUrl,
      authToken
    });
  }

  if (request.action === 'toggleOverlay') {
    if (!isAuthenticated()) {
      sendResponse({ enabled: false, error: 'Not authenticated' });
      return true;
    }

    if (overlayEnabled) {
      hideOverlay();
    } else {
      showOverlay();
    }

    sendResponse({ enabled: overlayEnabled });
  }

  return true; // Keep message channel open for async response
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

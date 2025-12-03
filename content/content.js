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

// Extract GAM key-values from script tag
function extractGamKeyValues() {
  try {
    console.log('Looking for GAM data in script tags...');

    // Find all script tags
    const scripts = document.querySelectorAll('script');

    for (const script of scripts) {
      const scriptContent = script.textContent || script.innerText;

      // Look for window.gam_kv assignment
      if (scriptContent.includes('window.gam_kv')) {

        // Extract the object using regex
        // Match: window.gam_kv = { ... } (semicolon optional)
        const match = scriptContent.match(/window\.gam_kv\s*=\s*(\{[\s\S]*?\})/);

        if (match && match[1]) {
          try {
            // Convert JavaScript object to JSON
            let jsonString = match[1]
              .replace(/'/g, '"')           // Replace single quotes with double quotes
              .replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas

            const gamData = JSON.parse(jsonString);
            return gamData;
          } catch (parseError) {
            console.error('Error parsing GAM data:', parseError);
            console.log('Raw match:', match[1]);

            // Show the converted string for debugging
            let debugString = match[1]
              .replace(/'/g, '"')
              .replace(/,(\s*[}\]])/g, '$1');
            console.log('Converted string:', debugString);
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Error extracting GAM key-values:', error);
    return null;
  }
}

// Extract Dotmetrics ID from script tag
function extractDotmetricsId() {
  try {
    const scripts = document.querySelectorAll('script[src]');

    for (const script of scripts) {
      const src = script.getAttribute('src');
      // Match pattern: https://script.dotmetrics.net/door.js?id=15965
      const match = src.match(/dotmetrics\.net\/door\.js\?id=(\d+)/);
      if (match && match[1]) {
        return match[1]; // Return just the ID number
      }
    }

    return null;
  } catch (error) {
    console.error('Error extracting Dotmetrics ID:', error);
    return null;
  }
}

// Simple HTML escape utility
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return unsafe;
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Format GAM key-values as HTML table
function formatGamTable(gamData) {
  if (!gamData || Object.keys(gamData).length === 0) {
    return '<div class="overlay-empty">No GAM data found</div>';
  }

  let tableRows = '';
  for (const [key, value] of Object.entries(gamData)) {
    // Handle array values (flatten for display)
    let displayValue = Array.isArray(value) ? value.join(', ') : value;

    // Truncate long values
    if (displayValue.length > 80) {
      displayValue = displayValue.substring(0, 77) + '...';
    }

    tableRows += `
      <tr>
        <td class="gam-key">${escapeHtml(key)}</td>
        <td class="gam-value">${escapeHtml(displayValue)}</td>
      </tr>
    `;
  }

  return `
    <table class="gam-table">
      <thead>
        <tr>
          <th>Key</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
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

  // Extract all data
  const articleInfo = detectArticleInfo();
  const gamData = extractGamKeyValues();
  const dotmetricsId = extractDotmetricsId();

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
      ${dotmetricsId ? `
        <div class="overlay-item">
          <strong>Dotmetrics ID:</strong> ${dotmetricsId}
        </div>
      ` : ''}
      <div class="overlay-item">
        <strong>URL:</strong> ${window.location.pathname}
      </div>
      ${gamData ? `
        <div class="overlay-section">
          <button class="overlay-toggle" id="gamToggle">
            <span class="toggle-icon">▼</span>
            <strong>GAM Key/Values</strong>
          </button>
          <div class="overlay-collapsible" id="gamContent">
            ${formatGamTable(gamData)}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  document.body.appendChild(overlayElement);
  overlayEnabled = true;

  // Add close button handler
  document.getElementById('overlayClose').addEventListener('click', () => {
    hideOverlay();
    chrome.storage.local.set({ overlayEnabled: false });
  });

  // Add GAM table toggle handler (if exists)
  const gamToggle = document.getElementById('gamToggle');
  if (gamToggle) {
    gamToggle.addEventListener('click', () => {
      const content = document.getElementById('gamContent');
      const icon = gamToggle.querySelector('.toggle-icon');
      content.classList.toggle('collapsed');
      icon.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
    });
  }
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

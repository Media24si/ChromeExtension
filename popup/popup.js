// DOM elements
const editArticleBtn = document.getElementById('editArticleBtn');
const purgeCacheBtn = document.getElementById('purgeCacheBtn');
const toggleOverlayBtn = document.getElementById('toggleOverlayBtn');
const showApi3ArticleBtn = document.getElementById('showApi3ArticleBtn');
const statusMessage = document.getElementById('statusMessage');
const pageInfo = document.getElementById('pageInfo');
const toolSection = document.querySelector('.tool-section');
const adminToolsSection = document.getElementById('admin-section');

// State
let currentTab = null;
let articleData = null;
let userData = null;
let authToken = null;

// === AUTHENTICATION CACHE MANAGER ===
const AuthCache = {
  CACHE_KEY: 'authCache',
  TTL_MS: 3600000, // 1 hour in milliseconds

  /**
   * Get cached auth data if exists
   * @returns {Promise<{userData: Object, authToken: string, timestamp: number}|null>}
   */
  async get() {
    try {
      const result = await chrome.storage.local.get(this.CACHE_KEY);
      return result[this.CACHE_KEY] || null;
    } catch (error) {
      console.error('Error reading auth cache:', error);
      return null;
    }
  },

  /**
   * Save auth data to cache with timestamp
   * @param {Object} userData - User data from API
   * @param {string} authToken - Current auth token
   */
  async set(userData, authToken) {
    try {
      const cacheData = {
        userData,
        authToken,
        timestamp: Date.now()
      };
      await chrome.storage.local.set({ [this.CACHE_KEY]: cacheData });
      console.log('Auth cache saved', { timestamp: cacheData.timestamp });
    } catch (error) {
      console.error('Error saving auth cache:', error);
    }
  },

  /**
   * Clear auth cache
   */
  async clear() {
    try {
      await chrome.storage.local.remove([this.CACHE_KEY, 'userData']); // Also clear old userData key
      console.log('Auth cache cleared');
    } catch (error) {
      console.error('Error clearing auth cache:', error);
    }
  },

  /**
   * Check if cache is valid (not expired and token matches)
   * @param {string} currentToken - Current auth token from cookie
   * @returns {Promise<boolean>}
   */
  async isValid(currentToken) {
    if (!currentToken) {
      return false;
    }

    const cache = await this.get();
    if (!cache) {
      return false;
    }

    // Check token match
    if (cache.authToken !== currentToken) {
      console.log('Cache invalid: token mismatch');
      return false;
    }

    // Check TTL
    const age = Date.now() - cache.timestamp;
    if (age > this.TTL_MS) {
      console.log('Cache invalid: expired', { ageMinutes: Math.round(age / 60000) });
      return false;
    }

    console.log('Cache valid', { ageMinutes: Math.round(age / 60000) });
    return true;
  }
};

/**
 * Fetch user data from API with strict validation
 * @param {string} token - Authentication token
 * @returns {Promise<Object|null>} User data or null if authentication fails
 * @throws {Error} On network errors (for strict handling)
 */
async function fetchUserData(token) {
  if (!token) {
    console.error('No auth token provided');
    return null;
  }

  try {
    console.log('Fetching user data from API...');

    const response = await fetch('https://api.kme.si/backend/v1/me', {
      headers: { 'Authorization': `X-AUTH-TOKEN ${token}` }
    });

    // STRICT MODE: Any non-200 status = authentication failure
    if (!response.ok) {
      console.error(`API authentication failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const result = await response.json();

    // Validate response structure
    if (result.status !== 'success' || !result.data) {
      console.error('Invalid API response structure:', result);
      return null;
    }

    console.log('User data fetched successfully');
    return result.data;

  } catch (error) {
    // Network errors, timeout, JSON parse errors - propagate for strict handling
    console.error('Error fetching user data:', error);
    throw error; // Propagate to caller
  }
}

/**
 * Helper to get page info from content script with injection fallback
 * @param {number} tabId - Tab ID
 * @returns {Promise<Object>} Page info response
 */
async function getPageInfo(tabId) {
  try {
    // Try to get page info from content script
    const response = await chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' });
    return response;

  } catch (error) {
    console.log('Content script not loaded, attempting injection...');

    try {
      // Inject content script
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['config.js', 'content/content.js']
      });

      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content/content.css']
      });

      // Wait for script to initialize
      await new Promise(resolve => setTimeout(resolve, 100));

      // Try again
      const response = await chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' });
      return response;

    } catch (injectionError) {
      console.error('Failed to inject content script:', injectionError);
      throw new Error('Cannot access page (restricted or injection failed)');
    }
  }
}

/**
 * Initialize popup with strict authentication validation
 */
async function initialize() {
  // Step 1: Show loading state immediately
  showLoadingState();

  try {
    // Step 2: Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    // Step 3: Get page info from content script
    const response = await getPageInfo(tab.id);

    // Step 4: Check if user has auth cookie
    if (!response || !response.isAuthenticated || !response.authToken) {
      showNotAuthenticated('No authentication cookie found');
      return;
    }

    authToken = response.authToken;
    articleData = response; // Store for later use

    // Step 5: Check cache validity (TTL + token match)
    const cacheValid = await AuthCache.isValid(authToken);

    if (cacheValid) {
      // Step 6a: Use cached data (fast path)
      const cache = await AuthCache.get();
      userData = cache.userData;
      console.log('Using cached user data');
      showAuthenticatedUI();
      return;
    }

    // Step 6b: Validate with API (blocking - wait for result)
    console.log('Cache invalid/expired, validating with API...');

    try {
      const freshUserData = await fetchUserData(authToken);

      if (!freshUserData) {
        // API returned null = authentication failed (401, invalid response, etc.)
        await AuthCache.clear();
        showNotAuthenticated('Authentication validation failed');
        return;
      }

      // Success! Cache and show UI
      userData = freshUserData;
      await AuthCache.set(userData, authToken);
      showAuthenticatedUI();

    } catch (error) {
      // Network error, timeout, or other API error
      // STRICT MODE: Treat as not authenticated
      console.error('Authentication validation error:', error);
      await AuthCache.clear();
      showNotAuthenticated('Unable to validate authentication');
    }

  } catch (error) {
    // Errors getting tab or page info
    console.error('Initialization error:', error);
    showNotAuthenticated('Extension initialization failed');
  }

  // Load saved overlay state
  const { overlayEnabled } = await chrome.storage.local.get('overlayEnabled');
  updateOverlayButton(overlayEnabled || false);
}

/**
 * Update page info display (article detection only)
 * Assumes authentication already validated
 * @param {Object} data - Page data from content script
 */
function updatePageInfo(data) {
  if (!data) {
    pageInfo.innerHTML = '<small>No page data available</small>';
    return;
  }

  articleData = data;

  // Display article information
  if (data.isArticlePage && data.articleId) {
    editArticleBtn.style.display = 'inline-block';

    if (showApi3ArticleBtn) {
      showApi3ArticleBtn.style.display = 'inline-block';
    }

    pageInfo.innerHTML = `
      <strong>Article ID:</strong> ${data.articleId}<br>
      <strong>URL:</strong> ${data.url}
    `;
  } else {
    // Not an article page
    editArticleBtn.style.display = 'none';

    if (showApi3ArticleBtn) {
      showApi3ArticleBtn.style.display = 'none';
    }

    pageInfo.innerHTML = '<small>Not an article page</small>';
  }
}

// Show status message
function showStatus(message, type = 'success', autoHide = true) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;

  if (autoHide) {
    setTimeout(() => {
      statusMessage.className = 'status-message hidden';
    }, 3000);
  }
}

// Update overlay button text
function updateOverlayButton(enabled) {
  toggleOverlayBtn.querySelector('.label').textContent = enabled ? 'Hide Overlay' : 'Show Overlay';
}

// Update user info display
function updateUserInfo(user) {
  if (!user) return;

  // Update header with user name on new line
  const header = document.querySelector('header h1');
  if (header && user.first_name) {
    header.innerHTML = `
      Media24
      <br>
      <small style="font-size: 12px; font-weight: normal; opacity: 0.9;">${user.first_name} ${user.last_name}</small>
    `;
  }

  // Show/hide admin tools based on admin status
  adminToolsSection.style.display = user.admin ? 'flex' : 'none';

  // Log user info for debugging
  console.log('User logged in:', {
    name: `${user.first_name} ${user.last_name}`,
    email: user.email,
    admin: user.admin,
    resources: Object.keys(user.resources || {}).length
  });
}

// === UI STATE FUNCTIONS ===

/**
 * Show loading state while validating authentication
 */
function showLoadingState() {
  // Hide all interactive sections
  toolSection.style.display = 'none';
  adminToolsSection.style.display = 'none';
  statusMessage.className = 'status-message hidden';

  // Show loading indicator
  pageInfo.innerHTML = `
    <div class="loading-spinner"></div>
    <small style="color: #666; margin-top: 8px; display: block;">
      Validating authentication...
    </small>
  `;

  console.log('Showing loading state');
}

/**
 * Show not authenticated state with reason
 * @param {string} reason - Reason for authentication failure (for logging)
 */
function showNotAuthenticated(reason = 'Not authenticated') {
  console.log('Not authenticated:', reason);

  // Hide all tools
  toolSection.style.display = 'none';
  adminToolsSection.style.display = 'none';

  // Show error message
  pageInfo.innerHTML = `
    <small style="color: #d32f2f;">
      ⚠️ Please log in to use editor tools
    </small>
  `;

  showStatus('Not authenticated - please log in', 'error', false);
}

/**
 * Show authenticated UI with tools
 */
function showAuthenticatedUI() {
  console.log('Showing authenticated UI');

  // Show tool section
  toolSection.style.display = 'flex';

  // Update page info (article detection)
  updatePageInfo(articleData);

  // Update user info (name, admin tools)
  updateUserInfo(userData);

  // Hide status message
  statusMessage.className = 'status-message hidden';
}

// Event listeners
editArticleBtn.addEventListener('click', async () => {
  if (!articleData || !articleData.editUrl) {
    showStatus('Edit URL not available', 'error');
    return;
  }

  // Open edit page in new tab
  console.log('Opening edit URL:', articleData.editUrl);
  await chrome.tabs.create({ url: articleData.editUrl });
  window.close();
});

purgeCacheBtn.addEventListener('click', async () => {
  if (!currentTab || !articleData || articleData.isAuthenticated === false) {
    showStatus('Not authenticated', 'error');
    return;
  }

  purgeCacheBtn.disabled = true;
  purgeCacheBtn.querySelector('.label').textContent = 'Purging...';

  try {
    // Send message to background script to purge cache
    const response = await chrome.runtime.sendMessage({
      action: 'purgeCache',
      url: currentTab.url
    });

    if (response.success) {
      showStatus('Cache purged successfully!', 'success');
    } else {
      showStatus('Failed to purge cache', 'error');
    }
  } catch (error) {
    console.error('Error purging cache:', error);
    showStatus('Error purging cache', 'error');
  } finally {
    purgeCacheBtn.disabled = false;
    purgeCacheBtn.querySelector('.label').textContent = 'Purge Cache';
  }
});

toggleOverlayBtn.addEventListener('click', async () => {
  if (!currentTab || !articleData || articleData.isAuthenticated === false) {
    showStatus('Not authenticated', 'error');
    return;
  }

  try {
    // Toggle overlay via content script
    const response = await chrome.tabs.sendMessage(currentTab.id, {
      action: 'toggleOverlay'
    });

    if (response && response.error) {
      showStatus(response.error, 'error');
      return;
    }

    if (response && response.enabled !== undefined) {
      // Save state
      await chrome.storage.local.set({ overlayEnabled: response.enabled });
      updateOverlayButton(response.enabled);
      showStatus(response.enabled ? 'Overlay enabled' : 'Overlay disabled', 'success');

      // Close popup after toggling
      window.close();
    }
  } catch (error) {
    console.error('Error toggling overlay:', error);
    showStatus('Error toggling overlay', 'error');
  }
});

// Admin tools event listeners
showApi3ArticleBtn.addEventListener('click', async () => {
  if (!articleData || !articleData.articleId) {
    showStatus('Article ID not available', 'error');
    return;
  }

  if (!userData || !userData.admin) {
    showStatus('Admin access required', 'error');
    return;
  }

  // Open API3 article URL in new tab
  await chrome.tabs.create({ url: `https://api3.m24.si/api/elastic/articles/${articleData.articleId}` });
  window.close();
});

// Initialize when popup opens
initialize();

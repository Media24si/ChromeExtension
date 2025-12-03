// Background service worker
// Import config
importScripts('../config.js');

console.log('Editor Help Tools background service worker loaded');

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Extension installed');
    // Initialize default settings
    chrome.storage.local.set({
      overlayEnabled: false
    });
  } else if (details.reason === 'update') {
    console.log('Extension updated');
  }
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'purgeCache') {
    handlePurgeCache(request.url)
      .then(result => sendResponse(result))
      .catch(error => {
        console.error('Error in purgeCache:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // Keep message channel open for async response
  }
});

// Handle cache purging
async function handlePurgeCache(url) {
  try {
    // TODO: Customize this based on your caching infrastructure
    // This is a placeholder implementation

    // Option 1: Call your API endpoint to purge cache
    const apiUrl = CONFIG.CACHE_PURGE_API;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add authentication headers if needed
        // 'Authorization': 'Bearer YOUR_TOKEN'
      },
      body: JSON.stringify({
        url: url,
        timestamp: Date.now()
      })
    });

    if (!response.ok) {
      throw new Error(`Cache purge failed: ${response.statusText}`);
    }

    const result = await response.json();

    console.log('Cache purged successfully for:', url);
    return { success: true, data: result };

  } catch (error) {
    console.error('Cache purge error:', error);
    // Return success for now (placeholder)
    // Remove this when you have real API
    return {
      success: true,
      message: 'Cache purge simulated (configure CONFIG.CACHE_PURGE_API for real implementation)'
    };
  }
}

// Optional: Handle browser action clicks (if you want additional behavior)
chrome.action.onClicked.addListener((tab) => {
  console.log('Extension icon clicked on tab:', tab.id);
});

// Optional: Monitor tab updates to refresh extension state
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // You can send messages to content script here if needed
    console.log('Tab updated:', tab.url);
  }
});

// Optional: Context menu items (right-click menu)
// Uncomment and customize if needed
/*
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'editArticle',
    title: 'Edit this article',
    contexts: ['page', 'selection']
  });

  chrome.contextMenus.create({
    id: 'purgeCache',
    title: 'Purge cache for this page',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'editArticle') {
    // Handle edit article
    chrome.tabs.sendMessage(tab.id, { action: 'editArticle' });
  } else if (info.menuItemId === 'purgeCache') {
    // Handle purge cache
    handlePurgeCache(tab.url).then(result => {
      console.log('Cache purged from context menu:', result);
    });
  }
});
*/

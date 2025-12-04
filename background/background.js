// Background service worker
// Import config
importScripts('../config.js');

console.log('Editor Help Tools background service worker loaded');

// Disable the action by default on all tabs
chrome.action.disable();

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

  // Set up declarative rules to show icon only on allowed domains
  setupDeclarativeRules();
});

// Set up rules to enable/disable extension icon based on domain
function setupDeclarativeRules() {
  chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
    // Define allowed domains
    const allowedDomains = [
      'svet24.test',
      'svet24.si',
      'necenzurirano.si',
      'reporter.si'
    ];

    // Create conditions for each allowed domain
    const conditions = allowedDomains.map(domain => {
      return new chrome.declarativeContent.PageStateMatcher({
        pageUrl: { hostContains: domain }
      });
    });

    // Create a rule that enables the action on allowed domains
    const rule = {
      conditions: conditions,
      actions: [new chrome.declarativeContent.ShowAction()]
    };

    // Add the rule
    chrome.declarativeContent.onPageChanged.addRules([rule]);
    console.log('Declarative rules set up for allowed domains');
  });
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

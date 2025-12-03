# Editor Help Tools - Chrome Extension

A Chrome extension that provides editor help tools for your websites, including quick article editing, cache purging, and page overlays.

## Features

- **Quick Edit Article**: One-click access to edit articles directly from your site
- **Purge Cache**: Clear cache for the current page
- **Toggle Overlay**: Display helpful information overlay on pages
- **Article Detection**: Automatically detects article pages and extracts metadata

## Installation

### Development Installation

1. **Add Extension Icons**
   - Add icon files to the `icons/` directory (see [icons/README.md](icons/README.md))
   - Required: icon16.png, icon32.png, icon48.png, icon128.png

2. **Configure Settings**
   - Open [config.js](config.js)
   - Update the following values:
     - `SITE_DOMAINS`: Your website domains
     - `CMS_URL`: Your CMS/admin panel URL
     - `CACHE_PURGE_API`: Your cache purging API endpoint
     - `ARTICLE_URL_PATTERNS`: Regex patterns to detect article pages

3. **Update Manifest Permissions**
   - Open [manifest.json](manifest.json)
   - Update `host_permissions` with your actual domains:
     ```json
     "host_permissions": [
       "https://yourdomain.com/*",
       "https://www.yourdomain.com/*"
     ]
     ```

4. **Customize Article Detection**
   - Open [content/content.js](content/content.js)
   - Modify the `extractArticleId()` function to match your site structure
   - Update the `getEditUrl()` function to generate correct edit URLs

5. **Load Extension in Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select this extension directory
   - The extension icon should appear in your toolbar

## Usage

### Opening the Extension
Click the extension icon in your Chrome toolbar to open the popup menu.

### Available Tools

#### Edit Article
- Only enabled on article pages
- Extracts the article ID from the current page
- Opens the CMS edit page in a new tab

#### Purge Cache
- Sends a request to your cache purging API
- Works on any page
- Shows success/error status

#### Toggle Overlay
- Shows/hides an information overlay on the page
- Displays article ID and page information
- Overlay state persists across page reloads

## File Structure

```
extension/
├── manifest.json           # Extension configuration
├── config.js              # Shared settings
├── popup/
│   ├── popup.html        # Popup interface
│   ├── popup.css         # Popup styling
│   └── popup.js          # Popup logic
├── content/
│   ├── content.js        # Page interaction scripts
│   └── content.css       # Injected styles
├── background/
│   └── background.js     # Background service worker
└── icons/                # Extension icons
```

## Configuration

### Article Detection

The extension uses multiple methods to detect articles:

1. **URL Patterns**: Checks URL for patterns like `/article/123`
2. **URL Parameters**: Looks for `?id=123` or `?article_id=123`
3. **Meta Tags**: Searches for `<meta name="article-id">`
4. **Data Attributes**: Finds elements with `data-article-id`

Customize these in [content/content.js](content/content.js) to match your site.

### Cache Purging

Configure cache purging in [background/background.js](background/background.js):

```javascript
const response = await fetch(apiUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: JSON.stringify({ url: url })
});
```

### Styling

- **Popup**: Edit [popup/popup.css](popup/popup.css)
- **Overlay**: Edit [content/content.css](content/content.css)

## Development

### Debugging

1. **Popup**: Right-click the extension icon → "Inspect popup"
2. **Content Script**: Open DevTools on any page → Console tab
3. **Background**: Visit `chrome://extensions/` → Click "service worker"

### Making Changes

After modifying files:
1. Go to `chrome://extensions/`
2. Click the refresh icon on your extension
3. Reload any open tabs where the extension should run

### Console Logs

Enable debug mode in [config.js](config.js):
```javascript
DEBUG: true
```

## Customization Ideas

### Add More Tools
Edit [popup/popup.html](popup/popup.html) to add new buttons, then implement handlers in [popup/popup.js](popup/popup.js).

### Context Menu
Uncomment the context menu code in [background/background.js](background/background.js) to add right-click menu items.

### Options Page
Create an `options/` directory with settings UI to let users configure:
- API keys
- CMS URLs
- Feature toggles

Add to manifest.json:
```json
"options_page": "options/options.html"
```

## Troubleshooting

### Extension doesn't appear on my site
- Check that your domain is listed in `host_permissions` in manifest.json
- Verify the domain matches in config.js `SITE_DOMAINS`
- Reload the extension and refresh the page

### "Edit Article" button is disabled
- The extension couldn't detect an article ID
- Customize `extractArticleId()` in content/content.js for your site structure
- Check browser console for errors

### Cache purge fails
- Verify `CACHE_PURGE_API` is correct in config.js
- Check authentication headers in background/background.js
- Look at service worker console for error messages

### Overlay doesn't appear
- Check that the content script loaded (see browser console)
- Verify content.css is being injected
- Look for z-index conflicts with your site's CSS

## Security Notes

- Never commit API keys or tokens to version control
- Use environment-specific configuration
- Consider using chrome.storage for sensitive data
- Validate and sanitize all user inputs

## Next Steps

1. Add your extension icons
2. Configure your domains and API endpoints
3. Customize article detection for your site
4. Test all features on your websites
5. Consider adding an options page for user configuration
6. Add error handling and user feedback
7. Prepare for production deployment

## Resources

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Chrome Extension APIs](https://developer.chrome.com/docs/extensions/reference/)

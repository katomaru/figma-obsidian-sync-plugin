# GitHub Release Creation Guide

## After pushing to GitHub:

### 1. Create Release Tag
```bash
git tag 0.1.0
git push origin 0.1.0
```

### 2. Create Release on GitHub

1. Go to your repository: https://github.com/katomaru/figma-obsidian-sync-plugin
2. Click on "Releases" → "Create a new release"
3. Fill in the following:

**Choose a tag**: Select `0.1.0`

**Release title**: `v0.1.0 - Initial Release`

**Release description**:
```markdown
## 🎉 Initial Release

### Features
- 📝 Real-time sync of Figma comments to Obsidian
- 📁 Organized folder structure for comments
- 🔄 Configurable auto-sync intervals
- 🖼️ Optional frame/component information
- 🔒 Secure token storage with encryption
- 🧵 Maintains comment thread structure

### Installation
1. Download `main.js` and `manifest.json` from the assets below
2. Create a folder `figma-obsidian-sync` in your vault's `.obsidian/plugins/` directory
3. Copy both files into this folder
4. Reload Obsidian
5. Enable the plugin in Settings → Community Plugins

### Configuration
1. Get your Figma Personal Access Token from Figma Account Settings
2. Add the token in plugin settings
3. Add Figma files to sync
4. Enjoy automatic comment syncing!

### Requirements
- Obsidian v0.15.0 or higher
- Figma account with Personal Access Token

### Assets
- `main.js` - The compiled plugin code
- `manifest.json` - Plugin metadata
```

### 3. Attach Files
Drag and drop these files to the release:
- `release-assets/main.js`
- `release-assets/manifest.json`

### 4. Publish
Click "Publish release"
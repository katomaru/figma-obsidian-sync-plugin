# Figma Comments Sync for Obsidian

Sync your Figma comments directly into your Obsidian vault as Markdown documents. Keep your design discussions and decisions documented alongside your notes.

## Features

- 📝 **Real-time Comment Sync**: Automatically sync Figma comments to your Obsidian vault
- 📁 **Organized Structure**: Comments are organized by Figma file and thread
- 🔄 **Auto-sync**: Set custom sync intervals (default: 5 minutes)
- 🖼️ **Frame Information**: Optionally fetch and display frame/component information
- 🔒 **Secure Token Storage**: Your Figma Personal Access Token is encrypted and stored securely
- 🧵 **Thread Preservation**: Maintains comment thread structure and relationships

## Installation

### From Obsidian Community Plugins (Coming Soon)
1. Open Obsidian Settings
2. Navigate to Community Plugins and disable Safe Mode
3. Click Browse and search for "Figma Comments Sync"
4. Click Install and then Enable

### Manual Installation
1. Download the latest release from the [Releases](https://github.com/katomaru/figma-obsidian-sync-plugin/releases) page
2. Extract the files to your vault's `.obsidian/plugins/figma-obsidian-sync/` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

## Setup

1. **Get your Figma Personal Access Token**
   - Go to Figma → Account Settings → Personal Access Tokens
   - Create a new token with `file:read` scope
   - Copy the token

2. **Configure the Plugin**
   - Open Obsidian Settings → Figma Comments Sync
   - Paste your Personal Access Token
   - Set your preferred sync folder (default: "Figma Comments")
   - Configure sync interval if needed

3. **Add Figma Files**
   - Click "Add Figma File" in the plugin settings
   - Enter the Figma file URL or key
   - The plugin will automatically fetch the file name
   - Enable/disable files as needed

## Usage

Once configured, the plugin will:
- Automatically sync comments at your specified interval
- Create a folder structure: `Figma Comments/[File Name]/comments/`
- Generate Markdown files for each comment thread
- Update existing comments when changes are detected

### Folder Structure
```
Figma Comments/
└── Your Design File/
    ├── _metadata.md          # File information and last sync time
    └── comments/
        ├── thread_abc123.md  # Comment thread 1
        ├── thread_def456.md  # Comment thread 2
        └── ...
```

### Manual Sync
You can manually trigger a sync using:
- The command palette: `Figma Comments Sync: Sync all files`
- Individual file sync: `Figma Comments Sync: Sync specific file`

## Features in Detail

### Comment Format
Each comment thread is saved as a Markdown file with:
- Thread metadata (participants, timestamps)
- Frame/component information (if enabled)
- All comments in chronological order
- Resolution status

### Frame Information
When enabled, the plugin fetches additional context about where comments are placed:
- Component/Frame names
- Node paths
- Coordinates

## Privacy & Security

- Your Figma token is encrypted before storage
- All API calls are made directly to Figma's official API
- No data is sent to third-party servers
- The plugin is open source for transparency

## Troubleshooting

### Common Issues

**"Invalid token" error**
- Ensure your token has `file:read` permissions
- Check if the token hasn't expired
- Try regenerating the token in Figma

**Comments not syncing**
- Check your internet connection
- Verify the Figma file URL/key is correct
- Check the Obsidian console for error messages

**Missing comments**
- The plugin only syncs visible comments
- Archived or deleted comments won't appear
- Private comments require appropriate permissions

## Development

This plugin is open source. Contributions are welcome!

### Building from Source
```bash
# Clone the repository
git clone https://github.com/katomaru/figma-obsidian-sync-plugin.git

# Install dependencies
npm install

# Build the plugin
npm run build

# For development with auto-reload
npm run dev
```

## Support

- 🐛 Report bugs on [GitHub Issues](https://github.com/katomaru/figma-obsidian-sync-plugin/issues)
- 💡 Request features in [Discussions](https://github.com/katomaru/figma-obsidian-sync-plugin/discussions)
- 📖 Read the [Documentation](https://github.com/katomaru/figma-obsidian-sync-plugin/wiki)

## License

MIT License - see [LICENSE](LICENSE) file for details

## Acknowledgments

- Built for the Obsidian community
- Uses the official Figma REST API
- Inspired by the need to bridge design and documentation

---

Made with ❤️ for designers and knowledge workers who use both Figma and Obsidian
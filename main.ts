import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, TFolder, normalizePath, Modal, requestUrl, ButtonComponent } from 'obsidian';

interface FigmaComment {
  id: string;
  file_key: string;
  parent_id: string | null;
  user: {
    handle: string;
    img_url: string;
  };
  created_at: string;
  resolved_at: string | null;
  message: string;
  client_meta?: {
    node_id?: string;
    node_offset?: { x: number; y: number };
  };
}

interface FigmaCommentsResponse {
  comments: FigmaComment[];
}


interface FigmaFile {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  lastSync?: string;
}

interface FigmaObsidianSyncSettings {
  figmaToken: string;
  syncFolder: string;
  syncInterval: number;
  figmaFiles: FigmaFile[];
  encryptedToken?: string;
  tokenVisible?: boolean;
  fetchFrameInfo?: boolean;
  deleteToTrash?: boolean;
}

// Separate interface for temporary/cache data that shouldn't be synced
interface FigmaObsidianSyncRuntimeData {
  lastSync: string;
  frameInfoCache?: Record<string, FrameCache>;
}

interface FrameCache {
  fileKey: string;
  lastUpdated: string;
  frameMap: Record<string, FrameInfo>;
  fileStructure?: any;
}

interface FrameInfo {
  nodeId: string;
  frameName: string;
  pageName: string;
  fullPath: string;
}

const DEFAULT_SETTINGS: FigmaObsidianSyncSettings = {
  figmaToken: '',
  syncFolder: 'Figma Comments',
  syncInterval: 300000, // 5 minutes in milliseconds
  figmaFiles: [],
  tokenVisible: false,
  fetchFrameInfo: false,
  deleteToTrash: true
};

const DEFAULT_RUNTIME_DATA: FigmaObsidianSyncRuntimeData = {
  lastSync: '',
  frameInfoCache: {}
};

// Simple encryption utility
class TokenManager {
  private static readonly SECRET_KEY = 'figma-obsidian-sync-2025';
  
  static encrypt(text: string): string {
    if (!text) return '';
    // Simple XOR encryption for basic protection
    let encrypted = '';
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i) ^ this.SECRET_KEY.charCodeAt(i % this.SECRET_KEY.length);
      encrypted += String.fromCharCode(charCode);
    }
    return btoa(encrypted);
  }
  
  static decrypt(encrypted: string): string {
    if (!encrypted) return '';
    try {
      const text = atob(encrypted);
      let decrypted = '';
      for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i) ^ this.SECRET_KEY.charCodeAt(i % this.SECRET_KEY.length);
        decrypted += String.fromCharCode(charCode);
      }
      return decrypted;
    } catch {
      return '';
    }
  }
  
  static validateToken(token: string): boolean {
    // Basic Figma token validation
    return token.length > 0 && (token.startsWith('figd_') || token.length >= 40);
  }
}

// Folder migration utility
class FolderMigrationManager {
  constructor(private app: App, private plugin: FigmaObsidianSyncPlugin) {}
  
  async migrateSyncFolder(oldPath: string, newPath: string): Promise<boolean> {
    if (oldPath === newPath) return true;
    
    const existingFiles = await this.detectExistingFiles(oldPath);
    if (existingFiles.length === 0) return true;
    
    const confirmed = await this.showMigrationDialog(existingFiles, newPath);
    if (!confirmed) return false;
    
    try {
      await this.moveFiles(oldPath, newPath);
      new Notice(`Successfully migrated ${existingFiles.length} files to ${newPath}`);
      return true;
    } catch (error) {
      new Notice(`Migration failed: ${error.message}`);
      return false;
    }
  }
  
  private async detectExistingFiles(path: string): Promise<string[]> {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder || !(folder instanceof TFolder)) return [];
    
    const files: string[] = [];
    const traverse = (folder: TFolder) => {
      folder.children.forEach(child => {
        if (child instanceof TFile && child.path.endsWith('_comments.md')) {
          files.push(child.path);
        } else if (child instanceof TFolder) {
          traverse(child);
        }
      });
    };
    
    traverse(folder);
    return files;
  }
  
  private async showMigrationDialog(files: string[], newPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.textContent = 'Sync folder migration';
      
      const content = modal.contentEl;
      content.createEl('p', { text: `Found ${files.length} existing sync files. Do you want to move them to the new location?` });
      
      const fileList = content.createEl('ul');
      files.forEach(file => {
        fileList.createEl('li', { text: file });
      });
      
      content.createEl('p', { text: `New location: ${newPath}` });
      
      const buttonContainer = content.createEl('div', { cls: 'modal-button-container' });
      
      const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
      cancelBtn.onclick = () => {
        modal.close();
        resolve(false);
      };
      
      new ButtonComponent(buttonContainer)
        .setButtonText('Move files')
        .setCta()
        .onClick(() => {
          modal.close();
          resolve(true);
        });
      
      modal.open();
    });
  }
  
  private async moveFiles(oldPath: string, newPath: string): Promise<void> {
    const files = await this.detectExistingFiles(oldPath);
    
    // Ensure new folder exists
    await this.ensureFolder(newPath);
    
    for (const filePath of files) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        const fileName = file.name;
        const newFilePath = normalizePath(`${newPath}/${fileName}`);
        await this.app.vault.rename(file, newFilePath);
      }
    }
    
    // Remove old empty folder if possible
    try {
      const oldFolder = this.app.vault.getAbstractFileByPath(oldPath);
      if (oldFolder instanceof TFolder && oldFolder.children.length === 0) {
        if (this.plugin.settings.deleteToTrash) {
          await this.app.fileManager.trashFile(oldFolder);
        } else {
          await this.app.vault.delete(oldFolder);
        }
      }
    } catch {
      // Ignore if folder can't be deleted
    }
  }
  
  private async ensureFolder(path: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder) {
      await this.app.vault.createFolder(path);
    }
  }
}

// Frame information fetcher
class FrameInfoFetcher {
  constructor(private token: string, private cache: Record<string, FrameCache>) {}
  
  async getFrameInfo(fileKey: string, nodeId: string, coordinates?: { x: number; y: number }): Promise<FrameInfo | null> {
    // If we have a specific node_id (not root), use it
    if (nodeId && nodeId !== '0:1') {
      return await this.getFrameInfoByNodeId(fileKey, nodeId);
    }
    
    // If it's a root comment but we have coordinates, find the frame at those coordinates
    if (coordinates && coordinates.x !== undefined && coordinates.y !== undefined) {
      return await this.getFrameInfoByCoordinates(fileKey, coordinates.x, coordinates.y);
    }
    
    return null;
  }
  
  private async getFrameInfoByNodeId(fileKey: string, nodeId: string): Promise<FrameInfo | null> {
    // Check cache first
    const cachedInfo = this.getCachedFrameInfo(fileKey, nodeId);
    if (cachedInfo) {
      return cachedInfo;
    }
    
    // Fetch file structure if not cached
    const fileStructure = await this.fetchFileStructure(fileKey);
    if (!fileStructure) {
      return null;
    }
    
    // Find node and build frame info
    const frameInfo = this.findFrameInfo(nodeId, fileStructure);
    if (frameInfo) {
      this.cacheFrameInfo(fileKey, nodeId, frameInfo);
    }
    
    return frameInfo;
  }
  
  private async getFrameInfoByCoordinates(fileKey: string, x: number, y: number): Promise<FrameInfo | null> {
    // Create a cache key for coordinate-based lookups
    const coordKey = `coord_${x}_${y}`;
    
    // Check cache first
    const cachedInfo = this.getCachedFrameInfo(fileKey, coordKey);
    if (cachedInfo) {
      return cachedInfo;
    }
    
    // Fetch file structure if not cached
    const fileStructure = await this.fetchFileStructure(fileKey);
    if (!fileStructure) {
      return null;
    }
    
    // Find frame at coordinates
    const frameInfo = this.findFrameAtCoordinates(x, y, fileStructure);
    if (frameInfo) {
      this.cacheFrameInfo(fileKey, coordKey, frameInfo);
    }
    
    return frameInfo;
  }
  
  private getCachedFrameInfo(fileKey: string, nodeId: string): FrameInfo | null {
    const cache = this.cache[fileKey];
    if (!cache) return null;
    
    // Check if cache is still valid (24 hours)
    const cacheAge = Date.now() - new Date(cache.lastUpdated).getTime();
    if (cacheAge > 24 * 60 * 60 * 1000) {
      delete this.cache[fileKey];
      return null;
    }
    
    return cache.frameMap[nodeId] || null;
  }
  
  private async fetchFileStructure(fileKey: string): Promise<any> {
    try {
      // Use geometry=paths to get bounding box information for coordinate-based detection
      const response = await requestUrl({
        url: `https://api.figma.com/v1/files/${fileKey}?depth=3&geometry=paths`,
        method: 'GET',
        headers: {
          'X-Figma-Token': this.token
        }
      });
      
      if (response.status !== 200) {
        console.error('Failed to fetch file structure:', response.status);
        return null;
      }
      
      const data = response.json;
      
      // Cache the file structure
      if (!this.cache[fileKey]) {
        this.cache[fileKey] = {
          fileKey,
          lastUpdated: new Date().toISOString(),
          frameMap: {},
          fileStructure: data
        };
      }
      
      return data;
    } catch (error) {
      console.error('Error fetching file structure:', error);
      return null;
    }
  }
  
  private findFrameAtCoordinates(x: number, y: number, fileData: any): FrameInfo | null {
    let bestMatchNode: any = null;
    let bestMatchPath: any[] = [];
    let bestScore = -1;
    
    // Traverse all nodes to find frames that contain the coordinates
    this.traverseNodes(fileData.document, (node: any, path: any[]) => {
      if (this.isFrameNode(node) && node.absoluteBoundingBox) {
        const bounds = node.absoluteBoundingBox;
        
        // Check if coordinates are within this frame's bounds
        if (this.isPointInBounds(x, y, bounds)) {
          // Calculate score - smaller frames are better matches (more specific)
          const area = bounds.width * bounds.height;
          const score = 1000000 / area; // Higher score for smaller area
          
          if (score > bestScore) {
            bestScore = score;
            bestMatchNode = node;
            bestMatchPath = path;
          }
        }
      }
    });
    
    if (bestMatchNode) {
      return this.buildFrameInfoFromPath(bestMatchNode, bestMatchPath);
    }
    
    return null;
  }
  
  private isFrameNode(node: any): boolean {
    return node.type === 'FRAME' || 
           node.type === 'COMPONENT' || 
           node.type === 'INSTANCE';
  }
  
  private isPointInBounds(x: number, y: number, bounds: any): boolean {
    return x >= bounds.x && 
           x <= bounds.x + bounds.width && 
           y >= bounds.y && 
           y <= bounds.y + bounds.height;
  }
  
  private traverseNodes(node: any, callback: (node: any, path: any[]) => void, path: any[] = []): void {
    const currentPath = [...path, node];
    callback(node, currentPath);
    
    if (node.children) {
      for (const child of node.children) {
        this.traverseNodes(child, callback, currentPath);
      }
    }
  }
  
  private buildFrameInfoFromPath(node: any, path: any[]): FrameInfo {
    // Find the page this frame belongs to
    const page = path.find(n => n.type === 'CANVAS');
    const pageName = page ? page.name : 'Unknown Page';
    
    // Build the path from page to frame
    const pageIndex = path.findIndex(n => n.type === 'CANVAS');
    const framePathNodes = path.slice(pageIndex + 1);
    const fullPath = framePathNodes.map(n => n.name).join(' > ');
    
    return {
      nodeId: node.id,
      frameName: node.name,
      pageName,
      fullPath: fullPath || node.name
    };
  }
  
  private findFrameInfo(nodeId: string, fileData: any): FrameInfo | null {
    const path: any[] = [];
    let frameFound = false;
    let pageName = '';
    
    // Recursive function to find node
    const findNode = (node: any, currentPath: any[]): boolean => {
      if (node.id === nodeId) {
        frameFound = true;
        return true;
      }
      
      if (node.children) {
        for (const child of node.children) {
          if (findNode(child, [...currentPath, node])) {
            return true;
          }
        }
      }
      
      return false;
    };
    
    // Search through all pages
    if (fileData.document && fileData.document.children) {
      for (const page of fileData.document.children) {
        if (page.type === 'CANVAS') {
          pageName = page.name;
          if (findNode(page, [page])) {
            path.unshift(page);
            break;
          }
        }
      }
    }
    
    if (!frameFound) {
      return null;
    }
    
    // Find the closest frame in the path
    let frameName = 'Root';
    const frames = path.filter(node => 
      node.type === 'FRAME' || 
      node.type === 'COMPONENT' || 
      node.type === 'INSTANCE'
    );
    
    if (frames.length > 0) {
      frameName = frames[frames.length - 1].name;
    }
    
    const fullPath = path
      .slice(1) // Remove page from path
      .map(node => node.name)
      .join(' > ');
    
    return {
      nodeId,
      frameName,
      pageName,
      fullPath: fullPath || frameName
    };
  }
  
  private cacheFrameInfo(fileKey: string, nodeId: string, frameInfo: FrameInfo): void {
    if (!this.cache[fileKey]) {
      this.cache[fileKey] = {
        fileKey,
        lastUpdated: new Date().toISOString(),
        frameMap: {}
      };
    }
    
    this.cache[fileKey].frameMap[nodeId] = frameInfo;
  }

  // Public method to clear cache
  clearCache(): void {
    this.cache = {};
  }
}

export default class FigmaObsidianSyncPlugin extends Plugin {
  settings: FigmaObsidianSyncSettings;
  runtimeData: FigmaObsidianSyncRuntimeData;
  syncIntervalId: number | null = null;
  frameInfoFetcher: FrameInfoFetcher | null = null;

  async onload() {
    await this.loadSettings();
    
    // Initialize frame info fetcher if enabled
    if (this.settings.fetchFrameInfo && this.settings.figmaToken) {
      this.frameInfoFetcher = new FrameInfoFetcher(
        this.settings.figmaToken,
        this.runtimeData.frameInfoCache || {}
      );
    }

    // Add ribbon icon
    this.addRibbonIcon('sync', 'Sync Figma Comments', () => {
      this.syncAllFiles(true); // Clear cache on manual sync
    });

    // Add command
    this.addCommand({
      id: 'sync-figma-comments',
      name: 'Sync Figma Comments',
      callback: () => {
        this.syncAllFiles(true); // Clear cache on manual sync
      }
    });

    // Add settings tab
    this.addSettingTab(new FigmaObsidianSyncSettingTab(this.app, this));

    // Start auto-sync if configured
    if (this.settings.figmaToken && this.settings.figmaFiles.length > 0) {
      this.startAutoSync();
    }
  }

  onunload() {
    this.stopAutoSync();
  }

  async loadSettings() {
    const loadedData = await this.loadData();
    
    // Separate settings and runtime data
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.runtimeData = Object.assign({}, DEFAULT_RUNTIME_DATA);
    
    if (loadedData) {
      // Load persistent settings (excluding runtime data)
      const { lastSync, frameInfoCache, ...persistentSettings } = loadedData;
      Object.assign(this.settings, persistentSettings);
      
      // Load runtime data from memory only (not persisted)
      if (lastSync) this.runtimeData.lastSync = lastSync;
      if (frameInfoCache) this.runtimeData.frameInfoCache = frameInfoCache;
    }
    
    // Decrypt token if encrypted
    if (this.settings.encryptedToken && !this.settings.figmaToken) {
      this.settings.figmaToken = TokenManager.decrypt(this.settings.encryptedToken);
    }
  }

  async saveSettings() {
    // Update frame info fetcher if needed
    if (this.settings.fetchFrameInfo && this.settings.figmaToken) {
      if (!this.frameInfoFetcher) {
        this.frameInfoFetcher = new FrameInfoFetcher(
          this.settings.figmaToken,
          this.runtimeData.frameInfoCache || {}
        );
      }
    } else {
      this.frameInfoFetcher = null;
    }
    
    // Save only persistent settings (not runtime data like lastSync, frameInfoCache)
    const settingsToSave: any = { ...this.settings };
    
    // Encrypt token before saving
    if (this.settings.figmaToken) {
      settingsToSave.encryptedToken = TokenManager.encrypt(this.settings.figmaToken);
      // Don't save plain token to disk
      delete settingsToSave.figmaToken;
    }
    
    // Never save runtime data to prevent Git conflicts
    delete settingsToSave.lastSync;
    delete settingsToSave.frameInfoCache;
    
    await this.saveData(settingsToSave);
  }

  startAutoSync() {
    this.stopAutoSync();
    if (this.settings.syncInterval > 0) {
      this.syncIntervalId = this.registerInterval(
        window.setInterval(() => {
          this.syncAllFiles();
        }, this.settings.syncInterval)
      );
    }
  }

  stopAutoSync() {
    if (this.syncIntervalId) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  async syncAllFiles(clearCache: boolean = false) {
    if (!this.settings.figmaToken) {
      new Notice('Please configure your Figma token in settings');
      return;
    }

    if (this.settings.figmaFiles.length === 0) {
      new Notice('No Figma files configured for sync');
      return;
    }

    // Clear frame info cache if requested (for manual sync)
    if (clearCache && this.settings.fetchFrameInfo) {
      this.runtimeData.frameInfoCache = {};
      if (this.frameInfoFetcher) {
        this.frameInfoFetcher.clearCache();
      }
      new Notice('Frame info cache cleared - fetching latest data...');
    }

    new Notice('Starting Figma sync...');

    const enabledFiles = this.settings.figmaFiles.filter(file => file.enabled !== false);
    
    for (const file of enabledFiles) {
      try {
        await this.syncFile(file);
      } catch (error) {
        console.error(`Error syncing file ${file.name}:`, error);
        new Notice(`Failed to sync ${file.name}: ${error.message}`);
      }
    }

    this.runtimeData.lastSync = new Date().toISOString();
    // Note: we don't save runtime data to prevent Git conflicts
    new Notice('Figma sync completed');
  }

  async syncFile(file: FigmaFile) {
    const comments = await this.fetchComments(file.key);
    await this.saveComments(file, comments);
  }

  async fetchComments(fileKey: string): Promise<FigmaComment[]> {
    const response = await requestUrl({
      url: `https://api.figma.com/v1/files/${fileKey}/comments`,
      method: 'GET',
      headers: {
        'X-Figma-Token': this.settings.figmaToken
      }
    });

    if (response.status !== 200) {
      throw new Error(`Figma API error: ${response.status}`);
    }

    const data: FigmaCommentsResponse = response.json;
    return data.comments;
  }

  async saveComments(file: FigmaFile, comments: FigmaComment[]) {
    // Ensure sync folder exists
    const syncFolderPath = normalizePath(this.settings.syncFolder);
    await this.ensureFolder(syncFolderPath);

    // Save all comments in a single file
    await this.saveCommentsToSingleFile(syncFolderPath, file, comments);
  }

  async ensureFolder(path: string) {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder) {
      await this.app.vault.createFolder(path);
    }
  }

  async saveCommentsToSingleFile(folderPath: string, file: FigmaFile, comments: FigmaComment[]) {
    const filePath = normalizePath(`${folderPath}/${file.name}_comments.md`);
    
    // Check if a file with the same figma_file_key already exists (possibly renamed)
    const existingFileWithSameKey = await this.findExistingFileByKey(folderPath, file.key);
    const targetFile = existingFileWithSameKey || filePath;
    
    let content = `---
title: ${file.name} - Figma Comments
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
figma_file_key: ${file.key}
total_comments: ${comments.length}
resolved_comments: ${comments.filter(c => c.resolved_at).length}
open_comments: ${comments.filter(c => !c.resolved_at).length}
---

# ${file.name} - Figma Comments

## Summary
- **Total Comments**: ${comments.length}
- **Open Comments**: ${comments.filter(c => !c.resolved_at).length}
- **Resolved Comments**: ${comments.filter(c => c.resolved_at).length}
- **Last Sync**: ${new Date().toLocaleString()}
- **File Link**: [Open in Figma](https://www.figma.com/file/${file.key})

## Comments

`;

    // Sort comments by creation date (newest first)
    const sortedComments = comments.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    for (const comment of sortedComments) {
      const isResolved = comment.resolved_at !== null;
      const checkbox = isResolved ? '- [x]' : '- [ ]';
      const resolvedInfo = isResolved ? `Resolved: ${new Date(comment.resolved_at!).toLocaleString()}` : 'Open';
      
      content += `${checkbox} ${new Date(comment.created_at).toLocaleString()}
  - ${comment.message.replace(/\n/g, '\n    ')}
  - Author: ${comment.user.handle}`;
      
      // Add frame info if enabled and available
      if (this.settings.fetchFrameInfo && this.frameInfoFetcher && comment.client_meta?.node_id) {
        const coordinates = comment.client_meta.node_offset ? {
          x: comment.client_meta.node_offset.x,
          y: comment.client_meta.node_offset.y
        } : undefined;
        
        const frameInfo = await this.frameInfoFetcher.getFrameInfo(
          file.key, 
          comment.client_meta.node_id, 
          coordinates
        );
        
        if (frameInfo) {
          content += `
  - Frame: ${frameInfo.fullPath}
  - Page: ${frameInfo.pageName}`;
        }
      }
      
      content += `
  - Status: ${resolvedInfo}

`;
    }

    const existingFile = this.app.vault.getAbstractFileByPath(targetFile);
    if (existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, content);
    } else {
      await this.app.vault.create(targetFile, content);
    }
  }

  // Find existing file by figma_file_key in frontmatter (handles renamed files)
  async findExistingFileByKey(folderPath: string, fileKey: string): Promise<string | null> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder || !(folder instanceof TFolder)) return null;

    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        try {
          const cache = this.app.metadataCache.getFileCache(child);
          if (cache?.frontmatter?.figma_file_key === fileKey) {
            return child.path;
          }
        } catch (error) {
          // Skip files that can't be read
          continue;
        }
      }
    }
    return null;
  }

}

class SecurityModal extends Modal {
  plugin: FigmaObsidianSyncPlugin;
  
  constructor(app: App, plugin: FigmaObsidianSyncPlugin) {
    super(app);
    this.plugin = plugin;
  }
  
  onOpen() {
    this.titleEl.textContent = '🔒 Security';
    this.render();
  }
  
  render() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('p', { 
      text: 'Your Figma access token is encrypted and stored securely.',
      cls: 'setting-item-description'
    });
    
    // Token field with show/hide
    const tokenVisible = this.plugin.settings.tokenVisible || false;
    const tokenValue = this.plugin.settings.figmaToken || '';
    const displayValue = tokenVisible ? tokenValue : '•'.repeat(Math.min(tokenValue.length, 20));
    
    new Setting(contentEl)
      .setName('Figma personal access token')
      .setDesc('Get your token from https://www.figma.com/developers/api#access-tokens')
      .addText(text => {
        text.setPlaceholder('Enter your token')
          .setValue(displayValue)
          .onChange(async (value) => {
            if (tokenVisible || value !== displayValue) {
              this.plugin.settings.figmaToken = value;
              await this.plugin.saveSettings();
            }
          });
        
        // Style as password field when hidden
        if (!tokenVisible) {
          text.inputEl.type = 'password';
        }
      });

    // Add buttons in a separate Setting below the token input
    new Setting(contentEl)
      .addButton(button => button
        .setButtonText(tokenVisible ? 'Hide' : 'Show')
        .onClick(async () => {
          this.plugin.settings.tokenVisible = !tokenVisible;
          await this.plugin.saveSettings();
          this.render(); // Re-render instead of reopening
        }))
      .addButton(button => button
        .setButtonText('Test connection')
        .setCta()
        .onClick(async () => {
          await this.testConnection();
        }));
  }
  
  private async testConnection(): Promise<void> {
    if (!this.plugin.settings.figmaToken) {
      new Notice('Please enter a Figma token first');
      return;
    }
    
    try {
      const response = await requestUrl({
        url: 'https://api.figma.com/v1/me',
        method: 'GET',
        headers: {
          'X-Figma-Token': this.plugin.settings.figmaToken
        }
      });
      
      if (response.status === 200) {
        const user = response.json;
        new Notice(`✅ Connected successfully as ${user.email}`);
      } else {
        new Notice(`❌ Connection failed: ${response.status}`);
      }
    } catch (error) {
      new Notice(`❌ Connection failed: ${error.message}`);
    }
  }
}

class FigmaObsidianSyncSettingTab extends PluginSettingTab {
  plugin: FigmaObsidianSyncPlugin;
  private folderMigration: FolderMigrationManager;
  private securityTitle = '🔒 Security Settings';

  constructor(app: App, plugin: FigmaObsidianSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.folderMigration = new FolderMigrationManager(app, plugin);
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();

    // Remove top-level heading per Obsidian guidelines

    // Sync file names with actual files before displaying
    await this.syncFileNamesWithActualFiles();

    // General Settings Section
    this.addGeneralSettings(containerEl);
    
    // Security Section (with icon access)
    this.addSecuritySection(containerEl);
    
    // File Management Section
    this.addFileManagementSettings(containerEl);
    
    // Actions Section
    this.addActionsSection(containerEl);
  }
  
  private addGeneralSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('⚙️ General').setHeading();
    
    // Sync Folder with migration
    new Setting(containerEl)
      .setName('Sync folder')
      .setDesc('Parent folder for all synced comments. Example: "Figma Comments" → saves as "Figma Comments/FileName_comments.md"')
      .addText(text => {
        const oldPath = this.plugin.settings.syncFolder;
        let currentValue = oldPath;
        
        text
          .setPlaceholder('Figma Comments')
          .setValue(this.plugin.settings.syncFolder)
          .onChange((value) => {
            // Just track the current value, don't trigger migration yet
            currentValue = value;
          });
        
        // Handle migration when field loses focus
        text.inputEl.addEventListener('blur', async () => {
          if (oldPath !== currentValue && currentValue.trim() !== '') {
            const migrated = await this.folderMigration.migrateSyncFolder(oldPath, currentValue);
            if (migrated) {
              this.plugin.settings.syncFolder = currentValue;
              await this.plugin.saveSettings();
            } else {
              // Revert the input field if migration was cancelled
              text.setValue(oldPath);
              currentValue = oldPath;
            }
          } else if (currentValue.trim() === '') {
            // Revert to old path if empty
            text.setValue(oldPath);
            currentValue = oldPath;
            new Notice('Sync folder cannot be empty');
          }
        });
        
        return text;
      });

    // Sync Interval
    new Setting(containerEl)
      .setName('Auto-sync interval (minutes)')
      .setDesc('How often to automatically sync comments (0 to disable)')
      .addText(text => text
        .setPlaceholder('5')
        .setValue(String(this.plugin.settings.syncInterval / 60000))
        .onChange(async (value) => {
          const minutes = parseInt(value) || 0;
          this.plugin.settings.syncInterval = minutes * 60000;
          await this.plugin.saveSettings();
          this.plugin.startAutoSync();
        }));
    
    // Frame Info Toggle
    new Setting(containerEl)
      .setName('Fetch frame information')
      .setDesc('Retrieve and display which frame/component each comment belongs to (uses additional API calls). Note: Frame information is cached for 24 hours. If Figma frame names are not reflecting after changes, use "Clear Cache" button below or perform manual sync.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.fetchFrameInfo || false)
        .onChange(async (value) => {
          this.plugin.settings.fetchFrameInfo = value;
          await this.plugin.saveSettings();
          
          if (value) {
            new Notice('Frame information will be fetched on next sync');
          } else {
            new Notice('Frame information disabled');
          }
        }));

    // Delete to Trash Toggle
    new Setting(containerEl)
      .setName('Move empty folders to trash')
      .setDesc('Move empty folders to trash when changing sync locations, following your Obsidian trash settings.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.deleteToTrash ?? true)
        .onChange(async (value) => {
          this.plugin.settings.deleteToTrash = value;
          await this.plugin.saveSettings();
          
          if (value) {
            new Notice('Empty folders will be moved to trash');
          } else {
            new Notice('Empty folders will be permanently deleted');
          }
        }));
  }

  private addSecuritySection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('🔒 Security').setHeading();
    
    // Add security settings with icon button
    new Setting(containerEl)
      .setName('Figma access token')
      .setDesc('Configure your Figma personal access token securely')
      .addButton(button => button
        .setIcon('settings')
        .setTooltip('Open security settings')
        .onClick(() => {
          this.openSecurityModal();
        }));
  }

  private openSecurityModal(): void {
    new SecurityModal(this.app, this.plugin).open();
  }

  
  private addFileManagementSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('📁 File management').setHeading();
    containerEl.createEl('p', { 
      text: 'Manage Figma files to sync comments from. Toggle files on/off to control syncing.',
      cls: 'setting-item-description' 
    });

    // Display existing files with edit capability
    if (this.plugin.settings.figmaFiles.length > 0) {
      this.plugin.settings.figmaFiles.forEach((file, index) => {
        this.addFileEntry(containerEl, file, index);
      });
      
      // Add separator before new file section
      containerEl.createEl('div', { cls: 'setting-item-heading' });
    }

    // Add new file section
    this.addNewFileSection(containerEl);
  }
  
  private addFileEntry(containerEl: HTMLElement, file: FigmaFile, index: number): void {
    const setting = new Setting(containerEl)
      .setName(`${file.name}`)
      .setDesc(`Key: ${file.key}`);
    
    // Toggle for enable/disable
    setting.addToggle(toggle => toggle
      .setValue(file.enabled !== false)
      .onChange(async (value) => {
        this.plugin.settings.figmaFiles[index].enabled = value;
        await this.plugin.saveSettings();
      }));
    
    // Edit button
    setting.addButton(button => button
      .setButtonText('Edit')
      .onClick(() => {
        this.editFileDialog(file, index);
      }));
    
    // Remove button
    setting.addButton(button => button
      .setButtonText('Remove')
      .setWarning()
      .onClick(async () => {
        this.plugin.settings.figmaFiles.splice(index, 1);
        await this.plugin.saveSettings();
        this.display();
      }));
  }
  
  private addNewFileSection(containerEl: HTMLElement): void {
    containerEl.createEl('h4', { text: '➕ Add new file' });
    
    let newFileName = '';
    let newFileKey = '';

    // Single setting with both inputs side by side
    const setting = new Setting(containerEl)
      .setName('Add Figma file')
      .setDesc('Enter a friendly name and the file key from Figma URL');
    
    // File name input (left side)
    setting.addText(text => text
      .setPlaceholder('File name')
      .onChange(value => newFileName = value));
    
    // File key input (right side)
    setting.addText(text => text
      .setPlaceholder('File key (e.g., ABC123XYZ)')
      .onChange(value => newFileKey = value));
    
    // Add button
    setting.addButton(button => button
      .setButtonText('Add')
      .setCta()
      .onClick(async () => {
        if (newFileName && newFileKey) {
          if (newFileKey.length >= 10) {
            const newFile: FigmaFile = {
              id: Date.now().toString(),
              name: newFileName,
              key: newFileKey,
              enabled: true
            };
            this.plugin.settings.figmaFiles.push(newFile);
            await this.plugin.saveSettings();
            
            // Clear inputs after successful add
            setting.components.forEach((component: any) => {
              if (component.inputEl) {
                component.setValue('');
              }
            });
            newFileName = '';
            newFileKey = '';
            
            this.display();
            new Notice(`Added "${newFile.name}" to sync list`);
          } else {
            new Notice('Please enter a valid Figma file key (at least 10 characters)');
          }
        } else {
          new Notice('Please enter both file name and key');
        }
      }));
  }
  
  private addActionsSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('🔄 Actions').setHeading();
    
    // Last Sync Info
    if (this.plugin.runtimeData.lastSync) {
      containerEl.createEl('p', {
        text: `Last sync: ${new Date(this.plugin.runtimeData.lastSync).toLocaleString()}`,
        cls: 'setting-item-description'
      });
    }

    // Manual Sync Button
    new Setting(containerEl)
      .setName('Manual sync')
      .setDesc('Sync all enabled Figma files now')
      .addButton(button => button
        .setButtonText('Sync now')
        .setCta()
        .onClick(() => {
          this.plugin.syncAllFiles(true); // Clear cache on manual sync
        }));

    // Add cache management section
    if (this.plugin.settings.fetchFrameInfo) {
      new Setting(containerEl)
        .setName('Clear frame info cache')
        .setDesc('Clear cached frame information to fetch the latest data from Figma. Use this if frame names changed in Figma but are not reflecting in synced comments.')
        .addButton(button => button
          .setButtonText('Clear cache')
          .onClick(() => {
            this.plugin.runtimeData.frameInfoCache = {};
            if (this.plugin.frameInfoFetcher) {
              this.plugin.frameInfoFetcher.clearCache();
            }
            // Note: no saveSettings() call here since runtime data isn't persisted
            new Notice('Frame info cache cleared');
          }));
    }
  }
  
  private editFileDialog(file: FigmaFile, index: number): void {
    const modal = new Modal(this.app);
    modal.titleEl.textContent = 'Edit Figma file';
    
    const content = modal.contentEl;
    
    let editName = file.name;
    let editKey = file.key;
    
    new Setting(content)
      .setName('File name')
      .addText(text => text
        .setValue(file.name)
        .onChange(value => editName = value));
    
    new Setting(content)
      .setName('File key')
      .addText(text => text
        .setValue(file.key)
        .onChange(value => editKey = value));
    
    const buttonContainer = content.createEl('div', { cls: 'modal-button-container' });
    
    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => modal.close();
    
    new ButtonComponent(buttonContainer)
      .setButtonText('Save')
      .setCta()
      .onClick(async () => {
        if (editName && editKey) {
          this.plugin.settings.figmaFiles[index] = {
            ...file,
            name: editName,
            key: editKey
          };
          await this.plugin.saveSettings();
          modal.close();
          this.display();
        }
      });
    
    modal.open();
  }

  // Sync file names in settings with actual file names in vault
  private async syncFileNamesWithActualFiles(): Promise<void> {
    const syncFolder = this.plugin.settings.syncFolder;
    let hasChanges = false;

    for (let i = 0; i < this.plugin.settings.figmaFiles.length; i++) {
      const file = this.plugin.settings.figmaFiles[i];
      const actualFilePath = await this.plugin.findExistingFileByKey(syncFolder, file.key);
      
      if (actualFilePath) {
        // Extract the actual file name without extension and "_comments" suffix
        const actualFileName = actualFilePath.split('/').pop()?.replace('.md', '') || '';
        const actualDisplayName = actualFileName.replace(/_comments$/, '');
        
        // Update the name in settings if it differs
        if (actualDisplayName !== file.name) {
          this.plugin.settings.figmaFiles[i].name = actualDisplayName;
          hasChanges = true;
        }
      }
    }

    // Save changes if any were made
    if (hasChanges) {
      await this.plugin.saveSettings();
    }
  }
}
// Enhanced frame detection using coordinates when node_id is "0:1"
class CoordinateBasedFrameDetector {
  constructor(token, cache) {
    this.token = token;
    this.cache = cache;
  }

  async getFrameInfoByCoordinates(fileKey, nodeId, coordinates) {
    // If we have a specific node_id, use it
    if (nodeId && nodeId !== '0:1') {
      return await this.getFrameInfoByNodeId(fileKey, nodeId);
    }

    // If it's a root comment but we have coordinates, find the frame at those coordinates
    if (coordinates && coordinates.x && coordinates.y) {
      return await this.findFrameAtCoordinates(fileKey, coordinates.x, coordinates.y);
    }

    return null;
  }

  async findFrameAtCoordinates(fileKey, x, y) {
    console.log(`🎯 Finding frame at coordinates (${x}, ${y})`);
    
    const fileStructure = await this.fetchFileStructure(fileKey);
    if (!fileStructure) {
      return null;
    }

    let bestMatch = null;
    let bestScore = -1;

    // Search through all frames to find the one that contains these coordinates
    this.traverseNodes(fileStructure.document, (node, path) => {
      if (this.isFrameNode(node) && node.absoluteBoundingBox) {
        const bounds = node.absoluteBoundingBox;
        
        // Check if coordinates are within this frame's bounds
        if (this.isPointInBounds(x, y, bounds)) {
          // Calculate how well this frame matches (smaller frames are better matches)
          const area = bounds.width * bounds.height;
          const score = 1 / area; // Smaller area = higher score
          
          if (score > bestScore) {
            bestScore = score;
            bestMatch = {
              node,
              path,
              bounds,
              area
            };
          }
        }
      }
    });

    if (bestMatch) {
      const frameInfo = this.buildFrameInfo(bestMatch.node, bestMatch.path);
      console.log(`✅ Found frame at coordinates: ${frameInfo.frameName}`);
      return frameInfo;
    }

    console.log(`⚠️ No frame found at coordinates (${x}, ${y})`);
    return null;
  }

  isPointInBounds(x, y, bounds) {
    return x >= bounds.x && 
           x <= bounds.x + bounds.width && 
           y >= bounds.y && 
           y <= bounds.y + bounds.height;
  }

  isFrameNode(node) {
    return node.type === 'FRAME' || 
           node.type === 'COMPONENT' || 
           node.type === 'INSTANCE';
  }

  traverseNodes(node, callback, path = []) {
    const currentPath = [...path, node];
    callback(node, currentPath);
    
    if (node.children) {
      for (const child of node.children) {
        this.traverseNodes(child, callback, currentPath);
      }
    }
  }

  buildFrameInfo(node, path) {
    // Find the page this frame belongs to
    const page = path.find(n => n.type === 'CANVAS');
    const pageName = page ? page.name : 'Unknown Page';
    
    // Build the path from page to frame
    const framePathNodes = path.slice(path.indexOf(page) + 1);
    const fullPath = framePathNodes.map(n => n.name).join(' > ');
    
    return {
      nodeId: node.id,
      frameName: node.name,
      pageName,
      fullPath: fullPath || node.name,
      coordinates: node.absoluteBoundingBox
    };
  }

  async fetchFileStructure(fileKey) {
    // Use existing cache logic
    const cached = this.cache[fileKey];
    if (cached) {
      const cacheAge = Date.now() - new Date(cached.lastUpdated).getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) {
        return cached.fileStructure;
      }
    }

    try {
      const response = await fetch(`https://api.figma.com/v1/files/${fileKey}?geometry=paths`, {
        headers: {
          'X-Figma-Token': this.token
        }
      });
      
      if (!response.ok) {
        console.error('Failed to fetch file structure:', response.statusText);
        return null;
      }
      
      const data = await response.json();
      
      // Cache the result
      this.cache[fileKey] = {
        fileKey,
        lastUpdated: new Date().toISOString(),
        frameMap: {},
        fileStructure: data
      };
      
      return data;
    } catch (error) {
      console.error('Error fetching file structure:', error);
      return null;
    }
  }

  async getFrameInfoByNodeId(fileKey, nodeId) {
    // Existing logic for when we have a proper node_id
    const fileStructure = await this.fetchFileStructure(fileKey);
    if (!fileStructure) {
      return null;
    }

    // Find the node by ID
    let foundNode = null;
    let foundPath = null;
    
    this.traverseNodes(fileStructure.document, (node, path) => {
      if (node.id === nodeId) {
        foundNode = node;
        foundPath = path;
      }
    });

    if (foundNode) {
      return this.buildFrameInfo(foundNode, foundPath);
    }

    return null;
  }
}

// Test the coordinate-based detection
async function testCoordinateDetection() {
  console.log('🧪 Testing coordinate-based frame detection...');
  
  // Mock token and cache
  const token = 'test-token';
  const cache = {};
  
  const detector = new CoordinateBasedFrameDetector(token, cache);
  
  // Test cases from the real comments
  const testCases = [
    { x: 18371, y: 10941, comment: "test2" },
    { x: 16539, y: 11585, comment: "test" },
    { x: 18230, y: 10956, comment: "プロダクト原則..." },
    { x: 18077, y: 10925, comment: "デザイン原則..." }
  ];
  
  console.log('📍 Test coordinates:');
  testCases.forEach((test, i) => {
    console.log(`${i + 1}. (${test.x}, ${test.y}) - "${test.comment}"`);
  });
  
  console.log('\n💡 This approach would:');
  console.log('1. 座標でフレームを検索する');
  console.log('2. 重なるフレームがある場合は最小のフレームを選択');
  console.log('3. フレーム階層を正確に取得');
  console.log('4. 既存のnode_idベースの検索と併用');
  
  return detector;
}

testCoordinateDetection().catch(console.error);
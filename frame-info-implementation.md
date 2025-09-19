# フレーム情報取得の実装設計

## 問題
- コメントのnode_idが常に"0:1"で意味をなさない
- どのフレームへのコメントか分からない

## 解決策

### 方法1: Files APIでノード情報を取得（推奨）
```typescript
// Step 1: ファイル全体の構造を取得（初回のみ）
const fileData = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
  headers: { 'X-Figma-Token': token }
});

// Step 2: ノードIDから親フレームを探索
async function getFrameInfo(nodeId: string, fileStructure: any) {
  // ノードを探して親フレームまでたどる
  const nodePath = findNodePath(nodeId, fileStructure.document);
  return {
    frameName: nodePath.frame?.name || 'Unknown Frame',
    pageName: nodePath.page?.name || 'Unknown Page',
    fullPath: nodePath.map(n => n.name).join(' > ')
  };
}
```

### 方法2: Nodes APIで特定ノード情報を取得
```typescript
// 各コメントのnode_idに対して個別にAPI呼び出し
const nodeData = await fetch(
  `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${nodeId}`,
  { headers: { 'X-Figma-Token': token } }
);
```

## 実装提案

### 1. キャッシュシステム
```typescript
interface FrameCache {
  fileKey: string;
  lastUpdated: string;
  frameMap: Map<string, FrameInfo>;
}

interface FrameInfo {
  nodeId: string;
  frameName: string;
  pageName: string;
  fullPath: string;
}
```

### 2. 表示フォーマット
```markdown
- [ ] 2025/07/18 14:30:00
  - コメント内容
  - Author: john.doe
  - Frame: Home Page > Header > Logo
  - Page: Desktop Designs
  - Status: Open
```

### 3. 設定オプション
- フレーム情報取得: ON/OFF（API呼び出し数増加のため）
- 表示階層の深さ: 1-3レベル
- キャッシュ有効期限: 1-24時間

## API使用量への影響
- Files API: 1回/ファイル/同期（キャッシュ可能）
- Nodes API: コメント数×同期回数（要注意）

## パフォーマンス最適化
1. ファイル構造は初回取得後キャッシュ
2. 変更があったノードのみ更新
3. バッチ処理でAPI呼び出し削減
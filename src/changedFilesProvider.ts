import * as vscode from 'vscode';
import * as path from 'path';
import { GitService, ChangedFile } from './gitService';
import { StateStore, DEFAULT_BASE_BRANCH } from './stateStore';
import { matchesAny } from './glob';

type Node = FolderNode | FileNode | MessageNode;

type ViewState = 'unviewed' | 'viewed' | 'stale';

interface FolderNode {
  kind: 'folder';
  name: string;
  fullPath: string;
  children: Node[];
}

interface FileNode {
  kind: 'file';
  file: ChangedFile;
  viewState: ViewState;
}

interface MessageNode {
  kind: 'message';
  text: string;
  variant: 'info' | 'error';
}

export class ChangedFilesProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private root: Node[] = [];
  private hiddenCount = 0;
  private error: string | undefined;
  private loaded = false;

  constructor(
    private readonly git: GitService,
    private readonly store: StateStore,
  ) {}

  async refresh(): Promise<void> {
    await this.load();
    this.emitter.fire();
  }

  private async load(): Promise<void> {
    this.error = undefined;
    let files: ChangedFile[] = [];
    let viewed: Record<string, string> = {};
    try {
      const cfg = vscode.workspace.getConfiguration('showDiff');
      const configured =
        (await this.store.getBaseBranch()) ?? DEFAULT_BASE_BRANCH;
      const base = await this.git.resolveBase(configured);
      const all = await this.git.changedFiles(base);
      viewed = await this.store.getViewed();

      const hide = await this.store.getHideTestFiles();
      const patterns = cfg.get<string[]>('testFilePatterns', []);

      if (hide) {
        const visible = all.filter(f => !matchesAny(patterns, f.path));
        this.hiddenCount = all.length - visible.length;
        files = visible;
      } else {
        this.hiddenCount = 0;
        files = all;
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.root = [];
      this.hiddenCount = 0;
      this.loaded = true;
      return;
    }
    this.root = buildTree(files, viewed);
    if (this.hiddenCount > 0) {
      const s = this.hiddenCount === 1 ? '' : 's';
      this.root.push({
        kind: 'message',
        text: `+ ${this.hiddenCount} hidden test file${s}`,
        variant: 'info',
      });
    }
    this.loaded = true;
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return toTreeItem(node);
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!this.loaded) {
      await this.load();
    }
    if (!element) {
      if (this.error) {
        return [{ kind: 'message', text: `Error: ${this.error}`, variant: 'error' }];
      }
      if (this.root.length === 0) {
        return [{ kind: 'message', text: 'No changed files', variant: 'info' }];
      }
      return this.root;
    }
    if (element.kind === 'folder') return element.children;
    return [];
  }
}

function viewStateOf(
  file: ChangedFile,
  viewed: Record<string, string>,
): ViewState {
  const reviewed = viewed[file.path];
  if (reviewed === undefined) return 'unviewed';
  return reviewed === file.hash ? 'viewed' : 'stale';
}

function buildTree(
  files: ChangedFile[],
  viewed: Record<string, string>,
): Node[] {
  const root: FolderNode = {
    kind: 'folder',
    name: '',
    fullPath: '',
    children: [],
  };
  // Use a transient map structure while building, then convert to arrays.
  const folderMap = new Map<string, FolderNode>();
  folderMap.set('', root);

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean);
    let parentPath = '';
    let parent = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const fullPath = parentPath ? `${parentPath}/${segment}` : segment;
      let folder = folderMap.get(fullPath);
      if (!folder) {
        folder = { kind: 'folder', name: segment, fullPath, children: [] };
        folderMap.set(fullPath, folder);
        parent.children.push(folder);
      }
      parent = folder;
      parentPath = fullPath;
    }
    parent.children.push({
      kind: 'file',
      file,
      viewState: viewStateOf(file, viewed),
    });
  }

  sortFolder(root);
  return root.children.map(c => (c.kind === 'folder' ? compact(c) : c));
}

function sortFolder(folder: FolderNode): void {
  folder.children.sort((a, b) => {
    const aIsFolder = a.kind === 'folder' ? 0 : 1;
    const bIsFolder = b.kind === 'folder' ? 0 : 1;
    if (aIsFolder !== bIsFolder) return aIsFolder - bIsFolder;
    const aName = nameOf(a);
    const bName = nameOf(b);
    return aName.localeCompare(bName);
  });
  for (const c of folder.children) {
    if (c.kind === 'folder') sortFolder(c);
  }
}

function nameOf(n: Node): string {
  if (n.kind === 'folder') return n.name;
  if (n.kind === 'file') return path.basename(n.file.path);
  return n.text;
}

function compact(folder: FolderNode): FolderNode {
  // Recurse first.
  folder.children = folder.children.map(c =>
    c.kind === 'folder' ? compact(c) : c,
  );
  // If exactly one child and it's a folder, merge names.
  if (folder.children.length === 1 && folder.children[0].kind === 'folder') {
    const only = folder.children[0];
    return {
      kind: 'folder',
      name: `${folder.name}/${only.name}`,
      fullPath: only.fullPath,
      children: only.children,
    };
  }
  return folder;
}

function toTreeItem(node: Node): vscode.TreeItem {
  if (node.kind === 'message') {
    const item = new vscode.TreeItem(
      node.text,
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon(
      node.variant === 'error' ? 'error' : 'info',
    );
    item.contextValue = `message-${node.variant}`;
    return item;
  }
  if (node.kind === 'folder') {
    const item = new vscode.TreeItem(
      node.name,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.resourceUri = vscode.Uri.file(node.fullPath);
    item.iconPath = vscode.ThemeIcon.Folder;
    item.contextValue = 'folder';
    item.id = `folder:${node.fullPath}`;
    item.tooltip = node.fullPath;
    return item;
  }
  // file
  const file = node.file;
  const item = new vscode.TreeItem(
    path.basename(file.path),
    vscode.TreeItemCollapsibleState.None,
  );
  item.resourceUri = vscode.Uri.file(file.path);
  const base =
    (file.status === 'R' || file.status === 'C') && file.oldPath
      ? `${statusLabel(file.status)}: ${file.oldPath} → ${file.path}`
      : `${statusLabel(file.status)}: ${file.path}`;
  item.command = {
    command: 'showDiff.openDiff',
    title: 'Open Diff',
    arguments: [file],
  };
  item.id = `file:${file.path}`;

  if (node.viewState === 'viewed') {
    item.contextValue = 'file-viewed';
    item.description = 'viewed';
    item.tooltip = `${base}\nViewed`;
    item.iconPath = new vscode.ThemeIcon(
      'check',
      new vscode.ThemeColor('testing.iconPassed'),
    );
  } else if (node.viewState === 'stale') {
    item.contextValue = 'file-stale';
    item.description = 'changed since viewed';
    item.tooltip = `${base}\nChanged since you last viewed it`;
    item.iconPath = statusIcon(file.status);
  } else {
    item.contextValue = 'file-unviewed';
    item.tooltip = base;
    item.iconPath = statusIcon(file.status);
  }
  return item;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'A': return 'Added';
    case 'D': return 'Deleted';
    case 'M': return 'Modified';
    case 'R': return 'Renamed';
    case 'C': return 'Copied';
    case 'T': return 'Type changed';
    case 'U': return 'Unmerged';
    default: return status;
  }
}

function statusIcon(status: string): vscode.ThemeIcon {
  switch (status) {
    case 'A':
      return new vscode.ThemeIcon(
        'diff-added',
        new vscode.ThemeColor('gitDecoration.addedResourceForeground'),
      );
    case 'D':
      return new vscode.ThemeIcon(
        'diff-removed',
        new vscode.ThemeColor('gitDecoration.deletedResourceForeground'),
      );
    case 'M':
      return new vscode.ThemeIcon(
        'diff-modified',
        new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
      );
    case 'R':
    case 'C':
      return new vscode.ThemeIcon(
        'diff-renamed',
        new vscode.ThemeColor('gitDecoration.renamedResourceForeground'),
      );
    default:
      return new vscode.ThemeIcon('file');
  }
}

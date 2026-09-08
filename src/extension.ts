import * as vscode from 'vscode';
import * as path from 'path';
import { GitService, ChangedFile } from './gitService';
import { ChangedFilesProvider } from './changedFilesProvider';
import {
  BaseContentProvider,
  SCHEME,
  buildVirtualUri,
} from './baseContentProvider';
import { StateStore, DEFAULT_BASE_BRANCH } from './stateStore';
import { ReviewService } from './reviewService';
import { FilterViewProvider } from './filterViewProvider';

export async function activate(context: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || !context.storageUri) {
    return;
  }
  const git = new GitService(folder.uri.fsPath);
  const repoRoot = await git.getRoot();
  if (!repoRoot) {
    return;
  }

  const store = new StateStore(context.storageUri, () => git.currentBranch());
  const reviews = new ReviewService(repoRoot, () => git.currentBranch());
  const provider = new ChangedFilesProvider(git, store);
  const treeView = vscode.window.createTreeView('showDiff.changedFiles', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  const filterView = new FilterViewProvider(
    () => provider.getFilter(),
    () => provider.getFilterState(),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(FilterViewProvider.viewId, filterView),
    provider.onDidChangeTreeData(() => filterView.sync()),
  );

  const baseProvider = new BaseContentProvider(git);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, baseProvider),
  );

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBar.command = 'showDiff.pickBaseBranch';
  context.subscriptions.push(statusBar);

  const getConfiguredBase = async () =>
    (await store.getBaseBranch()) ?? DEFAULT_BASE_BRANCH;

  const getBase = async () => git.resolveBase(await getConfiguredBase());

  const updateStatusBar = async () => {
    const base = await getBase();
    statusBar.text = `$(git-compare) ${base}`;
    statusBar.tooltip = `Branch Diff base: ${base} (click to change)`;
    statusBar.show();
  };

  const updateTitle = async () => {
    try {
      const [branch, base] = await Promise.all([git.currentBranch(), getBase()]);
      const filter = provider.getFilter();
      treeView.description = filter
        ? `${branch} ↔ ${base} [filter: "${filter}"]`
        : `${branch} ↔ ${base}`;
    } catch {
      // ignore
    }
  };

  const applyFilter = async (query: string) => {
    provider.setFilter(query);
    await vscode.commands.executeCommand(
      'setContext',
      'showDiff.isFiltered',
      Boolean(provider.getFilter()),
    );
    await provider.refresh();
    await updateTitle();
  };
  context.subscriptions.push(filterView.onDidChangeFilter(applyFilter));

  context.subscriptions.push(
    vscode.commands.registerCommand('showDiff.refresh', async () => {
      await provider.refresh();
      await updateTitle();
    }),

    vscode.commands.registerCommand('showDiff.pickBaseBranch', async () => {
      let branches: string[];
      let head = '';
      try {
        [branches, head] = await Promise.all([
          git.listBranches(),
          git.currentBranch().catch(() => ''),
        ]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Failed to list branches: ${msg}`);
        return;
      }
      const currentBase = await getConfiguredBase();
      const items: vscode.QuickPickItem[] = branches
        .filter(b => b !== head)
        .map(b => ({
          label: b,
          description: b === currentBase ? '(current base)' : undefined,
        }));
      const picked = await vscode.window.showQuickPick(items, {
        title: head
          ? `Select base to compare against (you are on "${head}")`
          : 'Select base branch to compare against',
        placeHolder: `Current base: ${currentBase}`,
        matchOnDescription: true,
      });
      if (!picked) return;
      await store.setBaseBranch(picked.label);
      await provider.refresh();
      await updateStatusBar();
      await updateTitle();
    }),

    vscode.commands.registerCommand('showDiff.toggleTestFiles', async () => {
      const next = !(await store.getHideTestFiles());
      await store.setHideTestFiles(next);
      await provider.refresh();
      vscode.window.setStatusBarMessage(
        next ? 'Branch Diff: hiding test files' : 'Branch Diff: showing test files',
        2000,
      );
    }),

    vscode.commands.registerCommand('showDiff.toggleReviews', async () => {
      const next = !(await store.getShowReviews());
      await store.setShowReviews(next);
      vscode.window.setStatusBarMessage(
        next
          ? 'Branch Diff: showing file reviews'
          : 'Branch Diff: hiding file reviews',
        2000,
      );
    }),

    vscode.commands.registerCommand('showDiff.filterFiles', () =>
      filterView.focus(),
    ),

    vscode.commands.registerCommand('showDiff.clearFilter', () =>
      applyFilter(''),
    ),

    vscode.commands.registerCommand(
      'showDiff.openDiff',
      async (file: ChangedFile) => {
        try {
          await openDiff(repoRoot, file, await getBase());
          if (await store.getShowReviews()) {
            const reviewUri = await reviews.getExplanationUri(file.path);
            if (reviewUri) {
              await vscode.commands.executeCommand(
                'markdown.showPreviewToSide',
                reviewUri,
              );
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          vscode.window.showErrorMessage(`Failed to open diff: ${msg}`);
        }
      },
    ),

    vscode.commands.registerCommand(
      'showDiff.markViewed',
      async (node?: { file?: ChangedFile }) => {
        if (!node?.file) return;
        await store.setViewed(node.file.path, node.file.hash);
        await provider.refresh();
      },
    ),

    vscode.commands.registerCommand(
      'showDiff.markNotViewed',
      async (node?: { file?: ChangedFile }) => {
        if (!node?.file) return;
        await store.clearViewed(node.file.path);
        await provider.refresh();
      },
    ),

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('showDiff')) {
        updateStatusBar();
        provider.refresh();
        updateTitle();
      }
    }),
  );

  // Refresh when the branch is switched. HEAD changes on checkout, so watch it.
  const gitDir = await git.gitDir();
  if (gitDir) {
    const headWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(gitDir), 'HEAD'),
    );
    let headDebounce: ReturnType<typeof setTimeout> | undefined;
    const onHeadChange = () => {
      if (headDebounce) {
        clearTimeout(headDebounce);
      }
      headDebounce = setTimeout(() => {
        provider.refresh();
        updateStatusBar();
        updateTitle();
      }, 150);
    };
    headWatcher.onDidChange(onHeadChange);
    headWatcher.onDidCreate(onHeadChange);
    context.subscriptions.push(headWatcher);
  }

  await vscode.commands.executeCommand(
    'setContext',
    'showDiff.isFiltered',
    false,
  );
  updateStatusBar();
  await provider.refresh();
  await updateTitle();
}

async function openDiff(repoRoot: string, file: ChangedFile, base: string) {
  const filename = path.basename(file.path);
  let leftUri: vscode.Uri;
  let rightUri: vscode.Uri;
  let title: string;

  if (file.status === 'A') {
    leftUri = buildVirtualUri(`/${file.path}`, 'EMPTY', file.path);
    rightUri = vscode.Uri.file(path.join(repoRoot, file.path));
    title = `${filename} (Added)`;
  } else if (file.status === 'D') {
    leftUri = buildVirtualUri(`/${file.path}`, base, file.path);
    rightUri = buildVirtualUri(`/${file.path}`, 'EMPTY', file.path);
    title = `${filename} (Deleted)`;
  } else if ((file.status === 'R' || file.status === 'C') && file.oldPath) {
    leftUri = buildVirtualUri(`/${file.oldPath}`, base, file.oldPath);
    rightUri = vscode.Uri.file(path.join(repoRoot, file.path));
    title = `${file.oldPath} → ${file.path}`;
  } else {
    leftUri = buildVirtualUri(`/${file.path}`, base, file.path);
    rightUri = vscode.Uri.file(path.join(repoRoot, file.path));
    title = `${filename} (${base} ↔ working tree)`;
  }

  await vscode.commands.executeCommand(
    'vscode.diff',
    leftUri,
    rightUri,
    title,
    { preview: true },
  );
}

export function deactivate() {}

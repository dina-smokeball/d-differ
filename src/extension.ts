import * as vscode from 'vscode';
import * as path from 'path';
import { GitService, ChangedFile } from './gitService';
import { ChangedFilesProvider } from './changedFilesProvider';
import {
  BaseContentProvider,
  SCHEME,
  buildVirtualUri,
} from './baseContentProvider';

export async function activate(context: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return;
  }
  const git = new GitService(folder.uri.fsPath);
  const repoRoot = await git.getRoot();
  if (!repoRoot) {
    return;
  }

  const provider = new ChangedFilesProvider(git);
  const treeView = vscode.window.createTreeView('showDiff.changedFiles', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

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

  const getBase = () =>
    vscode.workspace
      .getConfiguration('showDiff')
      .get<string>('baseBranch', 'origin/develop');

  const updateStatusBar = () => {
    const base = getBase();
    statusBar.text = `$(git-compare) ${base}`;
    statusBar.tooltip = `Branch Diff base: ${base} (click to change)`;
    statusBar.show();
  };

  const updateTitle = async () => {
    try {
      const branch = await git.currentBranch();
      treeView.description = `${branch} ↔ ${getBase()}`;
    } catch {
      // ignore
    }
  };

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
      const currentBase = getBase();
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
      await vscode.workspace
        .getConfiguration('showDiff')
        .update(
          'baseBranch',
          picked.label,
          vscode.ConfigurationTarget.Workspace,
        );
    }),

    vscode.commands.registerCommand('showDiff.toggleTestFiles', async () => {
      const cfg = vscode.workspace.getConfiguration('showDiff');
      const current = cfg.get<boolean>('hideTestFiles', false);
      await cfg.update(
        'hideTestFiles',
        !current,
        vscode.ConfigurationTarget.Workspace,
      );
      const next = !current;
      vscode.window.setStatusBarMessage(
        next ? 'Branch Diff: hiding test files' : 'Branch Diff: showing test files',
        2000,
      );
    }),

    vscode.commands.registerCommand(
      'showDiff.openDiff',
      async (file: ChangedFile) => {
        try {
          await openDiff(repoRoot, file, getBase());
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          vscode.window.showErrorMessage(`Failed to open diff: ${msg}`);
        }
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

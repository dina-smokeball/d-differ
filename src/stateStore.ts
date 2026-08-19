import * as vscode from 'vscode';

/** Base branch used when nothing has been chosen yet for a branch. */
export const DEFAULT_BASE_BRANCH = 'origin/develop';

/**
 * State stored for a single branch of the workspace: the base branch it's
 * compared against, and the set of files marked viewed. `viewed` maps a file
 * path to the git blob hash that was reviewed, so the mark clears itself once
 * the file's content changes (e.g. after pulling the branch owner's update).
 */
interface BranchState {
  baseBranch?: string;
  viewed?: Record<string, string>;
}

/**
 * Shape of the per-workspace state persisted to disk. View preferences live at
 * the root (they belong to the workspace, not to a branch); everything keyed
 * by branch name sits under `branches`.
 */
interface State {
  branches?: Record<string, BranchState>;
  showReviews?: boolean;
  hideTestFiles?: boolean;
}

/**
 * Reads and writes per-workspace state as a JSON file inside the extension's
 * private storage directory (context.storageUri). Branch-specific state (base
 * branch, viewed files) is keyed by the current branch; view preferences live
 * at the root. The directory is keyed by the opened folder path, so two clones
 * of the same repo stay independent and nothing lands in the repo or VS Code
 * settings.
 */
export class StateStore {
  private readonly fileUri: vscode.Uri;
  private cache: State | undefined;

  constructor(
    private readonly storageUri: vscode.Uri,
    private readonly getBranch: () => Promise<string>,
  ) {
    this.fileUri = vscode.Uri.joinPath(storageUri, 'state.json');
  }

  /** Absolute location of the state file (for docs/diagnostics). */
  get location(): vscode.Uri {
    return this.fileUri;
  }

  private async read(): Promise<State> {
    if (this.cache) {
      return this.cache;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(this.fileUri);
      this.cache = JSON.parse(Buffer.from(bytes).toString('utf8')) as State;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private async write(state: State): Promise<void> {
    this.cache = state;
    await vscode.workspace.fs.createDirectory(this.storageUri);
    const data = Buffer.from(JSON.stringify(state, null, 2), 'utf8');
    await vscode.workspace.fs.writeFile(this.fileUri, data);
  }

  /** Current branch name to key state by, or undefined if it can't be used. */
  private async currentKey(): Promise<string | undefined> {
    try {
      const branch = (await this.getBranch()).trim();
      // "HEAD" means detached; we have no stable per-branch key to use.
      return branch && branch !== 'HEAD' ? branch : undefined;
    } catch {
      return undefined;
    }
  }

  /** Apply a change to the current branch's state, no-op if no branch key. */
  private async update(fn: (b: BranchState) => BranchState): Promise<void> {
    const key = await this.currentKey();
    if (!key) {
      return;
    }
    const state = await this.read();
    const branches = { ...(state.branches ?? {}) };
    branches[key] = fn(branches[key] ?? {});
    await this.write({ ...state, branches });
  }

  async getShowReviews(): Promise<boolean> {
    return (await this.read()).showReviews ?? true;
  }

  async setShowReviews(value: boolean): Promise<void> {
    await this.write({ ...(await this.read()), showReviews: value });
  }

  async getHideTestFiles(): Promise<boolean> {
    return (await this.read()).hideTestFiles ?? false;
  }

  async setHideTestFiles(value: boolean): Promise<void> {
    await this.write({ ...(await this.read()), hideTestFiles: value });
  }

  async getBaseBranch(): Promise<string | undefined> {
    const key = await this.currentKey();
    if (!key) {
      return undefined;
    }
    return (await this.read()).branches?.[key]?.baseBranch;
  }

  async setBaseBranch(base: string): Promise<void> {
    await this.update(b => ({ ...b, baseBranch: base }));
  }

  /** Map of path -> reviewed blob hash for the current branch. */
  async getViewed(): Promise<Record<string, string>> {
    const key = await this.currentKey();
    if (!key) {
      return {};
    }
    return (await this.read()).branches?.[key]?.viewed ?? {};
  }

  async setViewed(path: string, hash: string): Promise<void> {
    await this.update(b => ({
      ...b,
      viewed: { ...(b.viewed ?? {}), [path]: hash },
    }));
  }

  async clearViewed(path: string): Promise<void> {
    await this.update(b => {
      if (!b.viewed || !(path in b.viewed)) {
        return b;
      }
      const viewed = { ...b.viewed };
      delete viewed[path];
      return { ...b, viewed };
    });
  }
}

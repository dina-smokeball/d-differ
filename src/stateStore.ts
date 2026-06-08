import * as vscode from 'vscode';

/** Base branch used when nothing has been chosen yet for a branch. */
export const DEFAULT_BASE_BRANCH = 'origin/develop';

/**
 * State stored for a single branch of the workspace. Kept small for now;
 * file viewed/reviewed tracking will be added here later, e.g.
 * `viewed: { [path]: reviewedCommitSha }`.
 */
interface BranchState {
  baseBranch?: string;
}

/** Shape of the per-workspace state persisted to disk, keyed by branch name. */
interface State {
  branches?: Record<string, BranchState>;
}

/**
 * Reads and writes per-workspace state as a JSON file inside the extension's
 * private storage directory (context.storageUri). State is keyed by the
 * current branch, so each branch keeps its own base branch (and, later, its
 * own viewed-files set). The directory is keyed by the opened folder path, so
 * two clones of the same repo stay independent and nothing lands in the repo
 * or VS Code settings.
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

  async getBaseBranch(): Promise<string | undefined> {
    const key = await this.currentKey();
    if (!key) {
      return undefined;
    }
    return (await this.read()).branches?.[key]?.baseBranch;
  }

  async setBaseBranch(base: string): Promise<void> {
    const key = await this.currentKey();
    if (!key) {
      return;
    }
    const state = await this.read();
    const branches = { ...(state.branches ?? {}) };
    branches[key] = { ...(branches[key] ?? {}), baseBranch: base };
    await this.write({ ...state, branches });
  }
}

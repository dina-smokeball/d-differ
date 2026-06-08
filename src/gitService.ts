import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type FileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U';

export interface ChangedFile {
  status: FileStatus | string;
  path: string;
  oldPath?: string;
  /** git blob hash of the file's content at HEAD (old blob for deletions). */
  hash: string;
}

export class GitService {
  private rootPromise: Promise<string | null>;

  constructor(private readonly startDir: string) {
    this.rootPromise = this.resolveRoot();
  }

  private async resolveRoot(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', '--show-toplevel'],
        { cwd: this.startDir },
      );
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async getRoot(): Promise<string | null> {
    return this.rootPromise;
  }

  private async run(args: string[]): Promise<string> {
    const root = await this.rootPromise;
    const cwd = root ?? this.startDir;
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  }

  async isGitRepo(): Promise<boolean> {
    return (await this.rootPromise) !== null;
  }

  async currentBranch(): Promise<string> {
    return (await this.run(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  }

  /**
   * Absolute path to the git directory (handles worktrees). HEAD lives at
   * `<gitDir>/HEAD` and changes whenever the branch is switched, so it's a
   * reliable thing to watch.
   */
  async gitDir(): Promise<string | null> {
    try {
      return (await this.run(['rev-parse', '--absolute-git-dir'])).trim();
    } catch {
      return null;
    }
  }

  async listBranches(): Promise<string[]> {
    const out = await this.run(['branch', '-a', '--format=%(refname:short)']);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of out.split('\n')) {
      const b = raw.trim();
      if (!b || b.startsWith('origin/HEAD')) continue;
      if (!seen.has(b)) {
        seen.add(b);
        result.push(b);
      }
    }
    return result;
  }

  async changedFiles(base: string): Promise<ChangedFile[]> {
    // --raw gives us the source and destination blob hashes alongside the
    // status, so we can identify each file's content version in one call.
    const out = await this.run([
      'diff',
      '--raw',
      '--no-abbrev',
      '-M',
      '-C',
      `${base}...HEAD`,
    ]);
    const ZERO = '0'.repeat(40);
    const files: ChangedFile[] = [];
    for (const line of out.split('\n')) {
      if (!line.startsWith(':')) continue;
      const tab = line.indexOf('\t');
      if (tab === -1) continue;
      // meta before the first tab: "<srcmode> <dstmode> <srcsha> <dstsha> <status>"
      const meta = line.slice(1, tab).split(' ');
      const paths = line.slice(tab + 1).split('\t');
      const srcSha = meta[2];
      const dstSha = meta[3];
      const status = (meta[4] ?? '')[0];
      // Use the new blob; for deletions there is none, so fall back to the old.
      const hash = dstSha && dstSha !== ZERO ? dstSha : srcSha;
      if ((status === 'R' || status === 'C') && paths.length >= 2) {
        files.push({ status, oldPath: paths[0], path: paths[1], hash });
      } else if (paths.length >= 1) {
        files.push({ status, path: paths[0], hash });
      }
    }
    return files;
  }

  async showFile(ref: string, filePath: string): Promise<string> {
    try {
      return await this.run(['show', `${ref}:${filePath}`]);
    } catch {
      return '';
    }
  }

  async refExists(ref: string): Promise<boolean> {
    try {
      await this.run(['rev-parse', '--verify', '--quiet', ref]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve the effective base branch. Uses the configured ref if it exists,
   * otherwise falls back to the first existing candidate (e.g. origin/develop
   * not present, so compare against origin/main instead).
   */
  async resolveBase(configured: string): Promise<string> {
    if (await this.refExists(configured)) {
      return configured;
    }
    const fallbacks = ['origin/develop', 'origin/main', 'main', 'master'];
    for (const candidate of fallbacks) {
      if (candidate !== configured && (await this.refExists(candidate))) {
        return candidate;
      }
    }
    return configured;
  }
}

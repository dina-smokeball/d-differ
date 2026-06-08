import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type FileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U';

export interface ChangedFile {
  status: FileStatus | string;
  path: string;
  oldPath?: string;
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
    const out = await this.run([
      'diff',
      '--name-status',
      '-M',
      '-C',
      `${base}...HEAD`,
    ]);
    const files: ChangedFile[] = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      const code = parts[0];
      const status = code[0];
      if ((status === 'R' || status === 'C') && parts.length >= 3) {
        files.push({ status, oldPath: parts[1], path: parts[2] });
      } else if (parts.length >= 2) {
        files.push({ status, path: parts[1] });
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
}

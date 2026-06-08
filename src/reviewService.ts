import * as vscode from 'vscode';

/**
 * Locates per-file review artifacts produced by the d-branch-review skill,
 * which writes them under:
 *
 *   .local/reviews/<branch with "/" -> "-">/v<N>/explanations/<file path>.md
 *
 * We always use the highest version directory (latest review run).
 */
export class ReviewService {
  constructor(
    private readonly repoRoot: string,
    private readonly getBranch: () => Promise<string>,
  ) {}

  /** Directory of the latest review version for the current branch, if any. */
  private async latestVersionDir(): Promise<vscode.Uri | undefined> {
    let branch: string;
    try {
      branch = (await this.getBranch()).trim();
    } catch {
      return undefined;
    }
    if (!branch) {
      return undefined;
    }
    const sanitized = branch.replace(/\//g, '-');
    const branchDir = vscode.Uri.joinPath(
      vscode.Uri.file(this.repoRoot),
      '.local',
      'reviews',
      sanitized,
    );

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(branchDir);
    } catch {
      return undefined;
    }

    let bestVersion = 0;
    let bestName: string | undefined;
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) continue;
      const match = /^v(\d+)$/.exec(name);
      if (!match) continue;
      const n = parseInt(match[1], 10);
      if (n > bestVersion) {
        bestVersion = n;
        bestName = name;
      }
    }
    return bestName ? vscode.Uri.joinPath(branchDir, bestName) : undefined;
  }

  /** URI of the review markdown for a changed file, or undefined if none. */
  async getExplanationUri(filePath: string): Promise<vscode.Uri | undefined> {
    const versionDir = await this.latestVersionDir();
    if (!versionDir) {
      return undefined;
    }
    const uri = vscode.Uri.joinPath(
      versionDir,
      'explanations',
      `${filePath}.md`,
    );
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      return stat.type === vscode.FileType.File ? uri : undefined;
    } catch {
      return undefined;
    }
  }
}

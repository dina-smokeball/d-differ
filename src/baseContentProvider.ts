import * as vscode from 'vscode';
import { GitService } from './gitService';

export const SCHEME = 'show-diff';

export class BaseContentProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly git: GitService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const ref = params.get('ref');
    const filePath = params.get('path');
    if (!ref || !filePath) return '';
    if (ref === 'EMPTY') return '';
    return this.git.showFile(ref, filePath);
  }
}

export function buildVirtualUri(
  displayPath: string,
  ref: string,
  gitPath: string,
): vscode.Uri {
  const params = new URLSearchParams();
  params.set('ref', ref);
  params.set('path', gitPath);
  return vscode.Uri.parse(`${SCHEME}:${displayPath}?${params.toString()}`);
}

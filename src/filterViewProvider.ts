import * as vscode from 'vscode';
import { FolderChip } from './folderChips';

export interface FilterState {
  shown: number;
  total: number;
  chips: FolderChip[];
}

type FromWebview = { type: 'ready' } | { type: 'filter'; value: string };

/**
 * The always-visible filter box that sits above the changed-files tree.
 * Tree views can't host inputs, so this is a tiny webview view in the same
 * container; it only talks to the extension through two messages.
 */
export class FilterViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'showDiff.filter';

  private view: vscode.WebviewView | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<string>();
  /** Fires with the raw query each time the user edits the box. */
  readonly onDidChangeFilter = this.changeEmitter.event;

  constructor(
    private readonly getFilter: () => string,
    private readonly getState: () => FilterState,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((msg: FromWebview) => {
      if (msg.type === 'ready') {
        this.sync();
        return;
      }
      if (msg.type === 'filter') {
        this.changeEmitter.fire(msg.value);
      }
    });
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
      }
    });
  }

  /** Push the current query, match counts and folder chips into the box. */
  sync(): void {
    this.view?.webview.postMessage({
      type: 'state',
      value: this.getFilter(),
      ...this.getState(),
    });
  }

  async focus(): Promise<void> {
    await vscode.commands.executeCommand(`${FilterViewProvider.viewId}.focus`);
    this.view?.webview.postMessage({ type: 'focus' });
  }

  private html(): string {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body {
    margin: 0;
    padding: 4px 12px 8px;
    overflow: hidden;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
  }
  .box { position: relative; display: flex; align-items: center; }
  input {
    flex: 1;
    box-sizing: border-box;
    height: 26px;
    padding: 2px 26px 2px 6px;
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font: inherit;
    outline: none;
  }
  input::placeholder { color: var(--vscode-input-placeholderForeground); }
  input:focus { border-color: var(--vscode-focusBorder); }
  .clear {
    position: absolute;
    right: 4px;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-input-foreground);
    font-size: 13px;
    line-height: 20px;
    cursor: pointer;
  }
  .clear:hover { background: var(--vscode-toolbar-hoverBackground); }
  .clear[hidden] { display: none; }
  .count { margin-top: 6px; color: var(--vscode-descriptionForeground); }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
    max-height: 48px;
    overflow: hidden;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px;
    border: 0;
    border-radius: 11px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    font: inherit;
    cursor: pointer;
  }
  .chip:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .chip.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .chip .n { opacity: 0.7; font-size: 0.9em; }
</style>
</head>
<body>
  <div class="box">
    <input id="q" type="text" placeholder="Filter by file name or path"
      autocomplete="off" spellcheck="false" />
    <button id="clear" class="clear" title="Clear filter" hidden>&#x2715;</button>
  </div>
  <div id="count" class="count"></div>
  <div id="chips" class="chips"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('q');
    const clear = document.getElementById('clear');
    const count = document.getElementById('count');
    const chips = document.getElementById('chips');
    let timer;

    const post = () => vscode.postMessage({ type: 'filter', value: input.value });

    const send = () => {
      clear.hidden = input.value.trim() === '';
      clearTimeout(timer);
      timer = setTimeout(post, 150);
    };

    const setFilter = value => {
      input.value = value;
      clear.hidden = value === '';
      clearTimeout(timer);
      post();
    };

    const renderChips = (list, active) => {
      chips.replaceChildren();
      for (const c of list) {
        const b = document.createElement('button');
        b.className = 'chip' + (c.query === active ? ' active' : '');
        b.title = c.query;
        b.append(c.label);
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = c.count;
        b.append(n);
        // Clicking the active chip clears the filter again.
        b.addEventListener('click', () => setFilter(c.query === active ? '' : c.query));
        chips.append(b);
      }
    };

    const files = n => (n === 1 ? '1 file' : n + ' files');

    input.addEventListener('input', send);
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape' && input.value) {
        input.value = '';
        send();
      }
    });
    clear.addEventListener('click', () => {
      input.value = '';
      send();
      input.focus();
    });
    window.addEventListener('focus', () => input.focus());

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.type === 'focus') {
        input.focus();
        input.select();
        return;
      }
      if (msg.type !== 'state') return;
      // Only overwrite what the user typed when it really differs, so a
      // trailing space mid-typing doesn't get snapped away.
      if (input.value.trim() !== msg.value) input.value = msg.value;
      clear.hidden = msg.value === '';
      count.textContent = msg.value
        ? msg.shown + ' of ' + files(msg.total)
        : files(msg.total);
      renderChips(msg.chips, msg.value);
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

# d-differ (Branch Diff)

A VS Code extension that shows the files changed between your current branch and
a base branch, and lets you open a diff for each file. Files appear in a
collapsible tree in the **Branch Diff** activity bar view, with add/modify/
delete/rename status icons. A status bar item shows the active base branch and
lets you change it.

## Base branch

The base branch defaults to `origin/develop`. If that ref does not exist, the
extension falls back to the first existing ref among `origin/develop`,
`origin/main`, `main`, `master`. The status bar and view title always show the
base actually being compared against.

You change the base from the status bar item or the **Branch Diff: Change Base
Branch** command. Your choice is saved per branch (see below), so each branch
remembers its own base.

## Per-workspace state storage

Settings like the chosen base branch are **not** stored in VS Code settings or
in the repo. They live in the extension's private per-workspace storage
directory, which VS Code provides via `context.storageUri`.

- **Where:** a folder VS Code keys to the *opened folder path*, under your user
  profile. On macOS:

  ```
  ~/Library/Application Support/Code/User/workspaceStorage/<workspace-hash>/d-pod.d-differ/state.json
  ```

  (On Linux: `~/.config/Code/...`; on Windows: `%APPDATA%\Code\...`. Use
  `Code - Insiders` instead of `Code` for Insiders builds.)

- **What it holds:** a small JSON file, keyed by branch name. Currently just
  the base branch each branch is compared against:

  ```json
  {
    "branches": {
      "feature/login": { "baseBranch": "origin/main" },
      "feature/checkout": { "baseBranch": "origin/develop" }
    }
  }
  ```

- **Scope:** keyed by the folder path you open, so two clones of the same repo
  in different directories keep independent state and never interfere. It is
  private to your user account and is never committed to the repo.

- **Inspecting / clearing:** you can open or delete the file by hand at any
  time. VS Code also removes the folder if you drop the workspace.

### Where it is used in code

- [`src/stateStore.ts`](src/stateStore.ts) — `StateStore` reads/writes
  `state.json`; `DEFAULT_BASE_BRANCH` is the seed used when nothing is stored.
- [`src/extension.ts`](src/extension.ts) — builds the `StateStore` from
  `context.storageUri`, reads the base for the status bar/title/diff, and writes
  it when you pick a new base.
- [`src/changedFilesProvider.ts`](src/changedFilesProvider.ts) — reads the base
  from the store to compute the changed-files list.

This storage is intended to grow: planned uses include tracking which files
you have viewed/reviewed per branch.

## Development

```bash
npm install
npm run compile   # or: npm run watch
```

Press `F5` in VS Code to launch an Extension Development Host.

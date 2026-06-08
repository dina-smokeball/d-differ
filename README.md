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

## Marking files as viewed

While reviewing, hover a file and click the check icon (or right-click → **Mark
as Viewed**) to mark it done. Viewed files show a green check; use the X icon /
**Mark as Not Viewed** to undo.

A viewed mark is tied to the file's git blob hash, not just its name. So if the
branch owner pushes a new version and you pull it, the content hash changes and
the file flips to **changed since viewed** (it keeps its status icon and shows
that note), telling you exactly what moved since your last look. Viewed marks
are stored per branch.

## Showing AI reviews

If the `d-branch-review` Claude Code skill has reviewed the branch, it writes
per-file explanations under:

```
.local/reviews/<branch with "/" -> "-">/v<N>/explanations/<file path>.md
```

When the **Toggle File Reviews** button (book icon) in the view title is on,
opening a file's diff also opens that file's review markdown beside it, if one
exists. The latest version directory (`v<N>`) is always used. Turn the toggle
off to just see diffs. This is controlled by the `showDiff.showReviews` setting
(on by default); files without a review simply open as a normal diff.

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

- **What it holds:** a small JSON file, keyed by branch name. Per branch, the
  base it's compared against plus the files marked viewed (path → reviewed blob
  hash):

  ```json
  {
    "branches": {
      "feature/login": {
        "baseBranch": "origin/main",
        "viewed": {
          "src/auth/login.ts": "9f1c2a7e0b...",
          "src/auth/session.ts": "3ab44de91c..."
        }
      },
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
  `state.json` (base branch and viewed map, keyed by branch);
  `DEFAULT_BASE_BRANCH` is the seed used when nothing is stored.
- [`src/extension.ts`](src/extension.ts) — builds the `StateStore` from
  `context.storageUri`, reads/writes the base, and handles the mark-viewed
  commands.
- [`src/changedFilesProvider.ts`](src/changedFilesProvider.ts) — reads the base
  and viewed map from the store to build the changed-files tree and each file's
  viewed state.
- [`src/gitService.ts`](src/gitService.ts) — `changedFiles` returns each file's
  blob hash (via `git diff --raw`), which is what viewed marks are tied to.
- [`src/reviewService.ts`](src/reviewService.ts) — `ReviewService` finds the
  latest review version and the per-file explanation under `.local/reviews/`.

## Development

```bash
npm install
npm run compile   # or: npm run watch
```

Press `F5` in VS Code to launch an Extension Development Host.

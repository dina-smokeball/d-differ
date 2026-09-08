export interface FolderChip {
  label: string;
  /** Text to put in the filter box so the tree narrows to this folder. */
  query: string;
  count: number;
}

/**
 * One chip per folder at the first level where the changed files spread out.
 * Folders every file shares (e.g. everything under `src/`) are skipped, since
 * a chip for them would match everything.
 */
export function folderChips(paths: string[], max = 8): FolderChip[] {
  const prefix = commonFolderPrefix(paths);
  const counts = new Map<string, number>();
  for (const p of paths) {
    const segments = p.split('/');
    const sitsDirectlyInPrefix = segments.length <= prefix.length + 1;
    if (sitsDirectlyInPrefix) continue;
    const folder = segments[prefix.length];
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  const base = prefix.length ? `${prefix.join('/')}/` : '';
  return [...counts]
    .map(([label, count]) => ({ label, query: `${base}${label}/`, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, max);
}

function commonFolderPrefix(paths: string[]): string[] {
  if (paths.length === 0) return [];
  let prefix = folderSegments(paths[0]);
  for (const p of paths.slice(1)) {
    const segments = folderSegments(p);
    let i = 0;
    while (i < prefix.length && i < segments.length && prefix[i] === segments[i]) {
      i++;
    }
    prefix = prefix.slice(0, i);
    if (prefix.length === 0) break;
  }
  return prefix;
}

function folderSegments(path: string): string[] {
  return path.split('/').slice(0, -1);
}

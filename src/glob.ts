export function matchGlob(pattern: string, str: string): boolean {
  let regex = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        regex += '.*';
        i += 2;
        if (pattern[i] === '/') i++;
      } else {
        regex += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      regex += '[^/]';
      i++;
    } else if ('.+^$(){}|[]\\'.includes(c)) {
      regex += '\\' + c;
      i++;
    } else {
      regex += c;
      i++;
    }
  }
  regex += '$';
  return new RegExp(regex).test(str);
}

export function matchesAny(patterns: string[], str: string): boolean {
  return patterns.some(p => matchGlob(p, str));
}

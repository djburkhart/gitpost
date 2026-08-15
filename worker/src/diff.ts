/** Minimal unified diff for POST.md history. */

export function unifiedDiff(oldText: string, newText: string, from = "a/POST.md", to = "b/POST.md"): string {
  if (oldText === newText) return "";
  const a = oldText.replace(/\r\n/g, "\n").split("\n");
  const b = newText.replace(/\r\n/g, "\n").split("\n");
  const pairs = lcsPairs(a, b);
  const lines: string[] = [
    `diff --git ${from} ${to}`,
    `--- ${from}`,
    `+++ ${to}`,
  ];
  let ai = 0;
  let bi = 0;
  let hunk: string[] = [];
  let hunkA = 0;
  let hunkB = 0;
  let aCount = 0;
  let bCount = 0;

  const flush = () => {
    if (!hunk.length) return;
    lines.push(`@@ -${hunkA + 1},${aCount} +${hunkB + 1},${bCount} @@`);
    lines.push(...hunk);
    hunk = [];
    aCount = 0;
    bCount = 0;
  };

  const startHunk = (a0: number, b0: number) => {
    if (!hunk.length) {
      hunkA = a0;
      hunkB = b0;
    }
  };

  for (const [am, bm] of pairs.concat([[a.length, b.length]])) {
    if (ai < am || bi < bm) startHunk(Math.min(ai, am), Math.min(bi, bm));
    while (ai < am) {
      startHunk(ai, bi);
      hunk.push("-" + a[ai++]);
      aCount++;
    }
    while (bi < bm) {
      startHunk(ai, bi);
      hunk.push("+" + b[bi++]);
      bCount++;
    }
    if (am < a.length && bm < b.length) {
      startHunk(ai, bi);
      hunk.push(" " + a[am]);
      aCount++;
      bCount++;
      ai = am + 1;
      bi = bm + 1;
    }
  }
  flush();
  return lines.join("\n") + "\n";
}

function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

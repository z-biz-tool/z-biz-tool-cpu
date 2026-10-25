/* ------------------------------------------------------------------ *
 * EDU-02：参考解记账
 *
 * 为什么只记「看过」而不锁判题：这是自学工具，不是考试。把答案藏起来
 * 只会让人卡死退出；但也不能假装是自己做出来的 —— 所以如实记一笔，
 * 在关卡列表和判题结果里都标出来，人自己决定要不要重做一遍。
 * ------------------------------------------------------------------ */

const KEY = "cpu-solution-seen-v1";

export function loadPeeked(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function markPeeked(id: string): string[] {
  const cur = loadPeeked();
  if (cur.includes(id)) return cur;
  const next = [...cur, id];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存不下就只保留在内存里：这只影响提示，不影响能做什么 */
  }
  return next;
}

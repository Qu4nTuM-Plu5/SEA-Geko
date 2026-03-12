const hashSeed = (value: string): number => {
  let hash = 2166136261;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash ^= value.charCodeAt(idx);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
};

const seededRandomFactory = (seedValue: number): (() => number) => {
  let state = (seedValue >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 4294967296);
  };
};

const isSameOrder = <T>(a: T[], b: T[]): boolean => {
  if (a.length !== b.length) return false;
  for (let idx = 0; idx < a.length; idx += 1) {
    if (!Object.is(a[idx], b[idx])) return false;
  }
  return true;
};

const shuffleWithRandom = <T>(items: T[], nextRandom: () => number): T[] => {
  const out = Array.isArray(items) ? items.slice() : [];
  if (out.length < 2) return out;

  for (let idx = out.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(nextRandom() * (idx + 1));
    [out[idx], out[swapIdx]] = [out[swapIdx], out[idx]];
  }

  if (isSameOrder(items, out) && out.length > 1) {
    const lastIdx = out.length - 1;
    [out[0], out[lastIdx]] = [out[lastIdx], out[0]];
  }

  return out;
};

export const shuffleList = <T>(items: T[]): T[] => {
  return shuffleWithRandom(items, Math.random);
};

export const shuffleListBySeed = <T>(items: T[], seedKey: string): T[] => {
  const seededRandom = seededRandomFactory(hashSeed(String(seedKey || 'default-seed')));
  return shuffleWithRandom(items, seededRandom);
};

export const shuffleOptionsWithAnswer = (
  options: string[],
  correctAnswer: number,
  seedKey = ''
): { options: string[]; correctAnswer: number } => {
  const rows = Array.isArray(options) ? options.slice() : [];
  if (rows.length < 2) {
    return { options: rows, correctAnswer: 0 };
  }

  const safeCorrect = Math.min(Math.max(Number(correctAnswer) || 0, 0), rows.length - 1);
  const indexed = rows.map((value, index) => ({ value, index }));
  const shuffled = seedKey ? shuffleListBySeed(indexed, seedKey) : shuffleList(indexed);
  const nextCorrect = shuffled.findIndex((entry) => entry.index === safeCorrect);

  return {
    options: shuffled.map((entry) => entry.value),
    correctAnswer: nextCorrect >= 0 ? nextCorrect : 0,
  };
};

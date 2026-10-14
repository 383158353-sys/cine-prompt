const MIN_WEIGHT = 3;

export function normalizePaletteWeights(colors) {
  if (!Array.isArray(colors) || colors.length === 0) return [];
  const raw = colors.map((color) => Math.max(0, Number(color.percentage) || 0));
  const total = raw.reduce((sum, value) => sum + value, 0);
  const weights = total > 0
    ? raw.map((value) => value / total * 100)
    : raw.map(() => 100 / raw.length);
  const rounded = weights.map((value) => Math.round(value * 10) / 10);
  rounded[0] = Math.round((rounded[0] + 100 - rounded.reduce((sum, value) => sum + value, 0)) * 10) / 10;
  return colors.map((color, index) => ({ ...color, percentage: rounded[index] }));
}

export function resizePaletteBoundary(colors, boundaryIndex, deltaPercentage, minimum = MIN_WEIGHT) {
  const normalized = normalizePaletteWeights(colors);
  if (boundaryIndex < 0 || boundaryIndex >= normalized.length - 1) return normalized;
  const left = normalized[boundaryIndex].percentage;
  const right = normalized[boundaryIndex + 1].percentage;
  const pairTotal = left + right;
  const nextLeft = Math.min(pairTotal - minimum, Math.max(minimum, left + deltaPercentage));
  const nextRight = pairTotal - nextLeft;
  return normalized.map((color, index) => index === boundaryIndex
    ? { ...color, percentage: Math.round(nextLeft * 10) / 10 }
    : index === boundaryIndex + 1
      ? { ...color, percentage: Math.round(nextRight * 10) / 10 }
      : color);
}

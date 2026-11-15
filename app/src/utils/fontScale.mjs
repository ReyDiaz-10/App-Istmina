export const DEFAULT_FONT_SCALE = 1;
export const MIN_FONT_SCALE = 0.8;
export const MAX_FONT_SCALE = 1.4;

export function normalizeFontScale(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_FONT_SCALE;
  const clamped = Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, value));
  return Math.round(clamped * 10) / 10;
}

export function scaleTextStyle(style, scale) {
  const fontSize = typeof style?.fontSize === 'number' ? style.fontSize : 14;
  const scaledStyle = { ...style, fontSize: fontSize * scale };

  if (typeof style?.lineHeight === 'number') {
    scaledStyle.lineHeight = style.lineHeight * scale;
  }

  return scaledStyle;
}

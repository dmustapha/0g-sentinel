export const DEFAULT_DISPLAY_GRAPHEMES = 160;
export const MAX_RAW_DISPLAY_CODE_UNITS = 4_096;

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}\p{Cs}\u206a-\u206f]/u;
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const EMOJI_MODIFIER = /\p{Emoji_Modifier}/u;
const MARK = /\p{Mark}/u;
const REGIONAL_INDICATOR = /\p{Regional_Indicator}/u;
const VARIATION_SELECTOR = /[\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/u;

export type DisplayValue = Readonly<{ canonical: string; display: string }>;

export function safeDisplayText(value: string, options: Readonly<{
  maxGraphemes?: number;
}> = {}): string {
  const max = options.maxGraphemes ?? DEFAULT_DISPLAY_GRAPHEMES;
  if (!Number.isInteger(max) || max < 1) throw new TypeError("Display limit must be a positive integer");
  const rawTruncated = value.length > MAX_RAW_DISPLAY_CODE_UNITS;
  const raw = value.slice(0, MAX_RAW_DISPLAY_CODE_UNITS);
  const visible = sanitizeUnicode(raw).normalize("NFC");
  const graphemes = splitGraphemes(visible);
  if (!rawTruncated && graphemes.length <= max) return visible;
  return `${graphemes.slice(0, max).join("")}…`;
}

export function displayValue(canonical: string, options?: Readonly<{
  maxGraphemes?: number;
}>): DisplayValue {
  return Object.freeze({ canonical, display: safeDisplayText(canonical, options) });
}

export function configuredDisplayText(value: string | undefined, fallback = "not configured",
  options?: Readonly<{ maxGraphemes?: number }>): string {
  if (!value || !hasVisibleContent(value)) return fallback;
  const display = safeDisplayText(value, options).trim();
  return display || fallback;
}

function splitGraphemes(value: string): string[] {
  const Segmenter = Intl.Segmenter;
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: "grapheme" })
    .segment(value), (item) => item.segment);
  return fallbackGraphemes(value);
}

function fallbackGraphemes(value: string): string[] {
  const clusters: string[] = []; let joinNext = false; let regionalRun = 0;
  for (const point of value) {
    if (REGIONAL_INDICATOR.test(point)) {
      if (regionalRun % 2 === 1 && clusters.length) clusters[clusters.length - 1] += point;
      else clusters.push(point);
      regionalRun += 1; joinNext = false; continue;
    }
    regionalRun = 0;
    const attach = joinNext || MARK.test(point) || VARIATION_SELECTOR.test(point)
      || EMOJI_MODIFIER.test(point) || point === "\u200d";
    if (attach && clusters.length) clusters[clusters.length - 1] += point;
    else clusters.push(point);
    joinNext = point === "\u200d";
  }
  return clusters;
}

function sanitizeUnicode(value: string): string {
  const points = Array.from(value);
  return points.map((point, index) => safeCodePoint(points, index, point)).join("");
}

function safeCodePoint(points: readonly string[], index: number, point: string): string {
  if (point === "\u200d") return validEmojiJoiner(points, index) ? point : "�";
  if (VARIATION_SELECTOR.test(point)) {
    return validEmojiVariation(points, index, point) ? point : "�";
  }
  return DEFAULT_IGNORABLE.test(point) || CONTROL_OR_FORMAT.test(point) ? "�" : point;
}

function validEmojiVariation(points: readonly string[], index: number, point: string): boolean {
  if (index > 0 && EXTENDED_PICTOGRAPHIC.test(points[index - 1]!)) return true;
  return point === "\ufe0f" && index > 0 && index + 1 < points.length
    && /^[0-9#*]$/.test(points[index - 1]!) && points[index + 1] === "\u20e3";
}

function hasVisibleContent(value: string): boolean {
  return Array.from(value.slice(0, MAX_RAW_DISPLAY_CODE_UNITS)).some((point) =>
    point.trim() !== "" && !DEFAULT_IGNORABLE.test(point)
    && !CONTROL_OR_FORMAT.test(point) && !VARIATION_SELECTOR.test(point));
}

function validEmojiJoiner(points: readonly string[], index: number): boolean {
  let previous = index - 1;
  while (previous >= 0 && (EMOJI_MODIFIER.test(points[previous]!)
    || VARIATION_SELECTOR.test(points[previous]!))) previous -= 1;
  return previous >= 0 && EXTENDED_PICTOGRAPHIC.test(points[previous]!)
    && index + 1 < points.length && EXTENDED_PICTOGRAPHIC.test(points[index + 1]!);
}

import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLE_FILES = ["foundations.css", "tokens.css", "components.css", "layouts.css",
  "motion.css", "utilities.css"] as const;
const LAYERS = "reset, tokens, base, components, layouts, motion, utilities, overrides";
const EXTERNAL_VARIABLES = new Set(["--font-chakra", "--font-plex-sans", "--font-plex-mono", "--step"]);
const COMPONENT_TOKENS = {
  "--button-min-height": "var(--control-min)", "--button-primary-height": "var(--control-primary)",
  "--button-border": "var(--border-control-on-dark)", "--button-shadow": "var(--shadow-control)",
  "--button-primary-surface": "var(--action-on-dark)", "--button-primary-text": "var(--action-ink)",
  "--button-disabled-surface": "var(--surface-control)", "--button-disabled-text": "var(--text-muted-on-dark)",
  "--field-min-height": "var(--control-min)", "--field-border": "var(--border-control-on-dark)",
  "--field-surface": "var(--surface-canvas)", "--field-text": "var(--text-on-dark)",
  "--status-badge-padding": "5px 8px", "--status-badge-type": "var(--type-caption)",
  "--status-badge-success-on-paper": "var(--status-success-on-paper)",
  "--status-badge-caution-on-paper": "var(--status-caution-on-paper)",
  "--evidence-sheet-surface": "var(--surface-paper)", "--evidence-sheet-shadow": "var(--shadow-sheet)",
  "--evidence-sheet-cut": "var(--dossier-cut)",
  "--data-row-label-type": "var(--type-caption)", "--data-row-value-type": "var(--type-data)",
  "--data-row-label-on-paper": "var(--text-muted-on-paper)", "--data-row-value-on-paper": "var(--text-on-paper)",
  "--state-message-border": "var(--border-control-on-dark)", "--state-message-padding": "var(--space-2-5)",
  "--proof-plane-gap": "var(--space-2)", "--proof-plane-border": "var(--border-control-on-dark)",
  "--proof-plane-surface": "var(--surface-ceremony)", "--proof-plane-shadow": "var(--shadow-sheet)",
} as const;

describe("canonical Proof Ledger token contract", () => {
  it("imports every canonical stylesheet behind the frozen cascade order", async () => {
    const globals = await css("app/globals.css");
    expect(globals).toContain(`@layer ${LAYERS};`);
    for (const file of STYLE_FILES) expect(globals).toContain(`@import "./styles/${file}";`);
    expect(globals).not.toMatch(/tailwind/i);
    expect(globals).not.toMatch(/(?:^|})\s*[^@\s][^{]*\{/m);
    for (const file of STYLE_FILES) {
      const source = await css(`app/styles/${file}`);
      expect(() => assertOwnedLayer(source, layerFor(file)), file).not.toThrow();
    }
  });

  it("freezes the primitive, semantic, spacing, type, control, and motion values", async () => {
    const tokenSource = await css("app/styles/tokens.css");
    const tokens = declarations(tokenSource);
    expect(() => assertCanonicalTokens(tokenSource)).not.toThrow();
    const expected = {
      "--color-graphite-950": "#111214", "--color-paper-100": "#f1ebdf",
      "--color-violet-400": "#c6f24e", "--surface-canvas": "var(--color-graphite-950)",
      "--text-on-dark": "var(--color-paper-50)", "--text-on-paper": "var(--color-ink-950)",
      "--status-success-on-dark": "#39b982", "--status-success-on-paper": "#116b49",
      "--status-caution-on-dark": "#d79a36", "--status-caution-on-paper": "#91470a",
      "--status-failure-on-dark": "#f07878", "--status-failure-on-paper": "#aa303a",
      "--focus-on-dark": "#d8f57a", "--focus-on-paper": "#446200",
      "--space-half": "4px", "--space-1": "8px", "--space-2": "16px", "--space-3": "24px",
      "--type-caption": "0.75rem", "--type-data": "0.875rem", "--type-body": "1rem",
      "--line-caption": "1.4", "--line-data": "1.45", "--line-body": "1.55",
      "--control-min": "44px", "--control-primary": "48px", "--shape-square": "0",
      "--dossier-cut": "16px", "--shadow-control": "3px 3px 0 var(--shadow-ink)",
      "--shadow-sheet": "5px 5px 0 var(--shadow-ink)", "--duration-fast": "120ms",
      "--duration-standard": "180ms", "--duration-maximum": "300ms", "--duration-stagger": "13ms",
      "--measure-ledger": "1180px", "--breakpoint-ledger": "850px",
      "--breakpoint-mobile": "600px", "--breakpoint-compact": "390px",
      "--breakpoint-minimum": "320px", "--icon-sm": "16px", "--icon-md": "20px",
    } as const;
    for (const [name, value] of Object.entries(expected)) expect(tokens.get(name), name).toBe(value);
    const all = await allStyles();
    for (const [name, value] of Object.entries(COMPONENT_TOKENS)) {
      expect(tokens.get(name), name).toBe(value);
      expect(all.match(new RegExp(`var\\(${name}\\)`, "g"))?.length, `${name} must be consumed`).toBeGreaterThanOrEqual(1);
    }
  });

  it("resolves every custom property reference", async () => {
    const styles = await allStyles(); const active = await allBrowserSource();
    expect(() => assertVariableGraph(styles, active)).not.toThrow();
  });

  it("keeps raw colors inside the explicit token allowlist", async () => {
    const tokenSource = await css("app/styles/tokens.css");
    expect(() => assertTokenColorAllowlist(tokenSource)).not.toThrow();
    expect(() => assertTokenColorAllowlist(tokenSource.replace("--color-graphite-950: #111214", "--color-graphite-950: #ffffff")))
      .toThrow(/mismatch/i);
    const selectorMutant = tokenSource.replace(/\s*}\s*}\s*$/, "\n  }\n  .x { --color-graphite-950: #111214; }\n}\n");
    expect(() => assertTokenColorAllowlist(selectorMutant)).toThrow(/single :root/i);
    for (const file of ["app/globals.css", ...STYLE_FILES.filter((file) => file !== "tokens.css")
      .map((file) => `app/styles/${file}`)]) {
      expect(rawColors(await css(file)), `${file} must consume tokens`).toEqual([]);
    }
    for (const file of await activeUiFiles()) expect(rawColors(await css(file), false), file).toEqual([]);
    for (const file of (await sourceFiles("app")).filter((path) => path.endsWith("opengraph-image.tsx"))) {
      const colors = rawColors(await css(file), false);
      expect(colors.every((color) => OG_COLOR_ALLOWLIST.has(color)), file).toBe(true);
    }
  });

  it("meets documented text and indicator contrast floors", async () => {
    const tokens = declarations(await css("app/styles/tokens.css"));
    const textPairs: Array<readonly [string, string]> = [["--text-on-dark", "--surface-canvas"], ["--text-muted-on-dark", "--surface-canvas"],
      ["--text-placeholder-on-dark", "--surface-canvas"], ["--text-on-paper", "--surface-paper"],
      ["--text-muted-on-paper", "--surface-paper"], ["--action-on-paper", "--surface-paper"],
      ["--status-success-on-paper", "--surface-paper"], ["--status-caution-on-paper", "--surface-paper"],
      ["--status-failure-on-paper", "--surface-paper"]];
    textPairs.push(["--status-success-on-dark", "--surface-canvas"], ["--status-caution-on-dark", "--surface-canvas"],
      ["--status-failure-on-dark", "--surface-canvas"], ["--status-unknown-on-dark", "--surface-canvas"],
      ["--status-unknown-on-paper", "--surface-paper"]);
    for (const pair of textPairs) expect(contrast(tokens, ...pair), pair.join(" / ")).toBeGreaterThanOrEqual(4.5);
    const indicatorPairs: Array<readonly [string, string]> = [["--focus-on-dark", "--surface-canvas"], ["--focus-on-paper", "--surface-paper"],
      ["--border-control-on-dark", "--surface-canvas"], ["--border-control-on-paper", "--surface-paper"]];
    for (const surface of ["--surface-raised", "--surface-control", "--surface-ceremony"])
      indicatorPairs.push(["--border-control-on-dark", surface]);
    for (const pair of indicatorPairs) expect(contrast(tokens, ...pair), pair.join(" / ")).toBeGreaterThanOrEqual(3);
    expect(contrast(tokens, "--rail-end-on-ceremony", "--surface-ceremony"), "alpha rail endpoint").toBeGreaterThanOrEqual(3);
    const components = await css("app/styles/components.css");
    expect(components.match(/var\(--rail-end-on-ceremony\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("governs readable type, touch, shadows, motion, and technical wrapping", async () => {
    const source = await allStyles();
    expect(source).toContain("min-height: var(--control-min)");
    expect(source).toContain("font-size: var(--type-body)");
    expect(source).toContain("box-shadow: var(--shadow-control)");
    expect(source).toContain("box-shadow: var(--proof-plane-shadow)");
    expect(() => assertGovernedCss(source)).not.toThrow();
    const motion = await css("app/styles/motion.css");
    expect(() => assertMotionCss(motion)).not.toThrow();
    const tokens = declarations(await css("app/styles/tokens.css"));
    const runner = await css("components/StreamingScanPanel.tsx");
    const stageList = runner.match(/PROOFLOCK_STAGES[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? "";
    expect(stageList.match(/"[A-Z_]+"/g)).toHaveLength(10);
    expect(ms(tokens, "--duration-standard") + 9 * ms(tokens, "--duration-stagger")).toBeLessThanOrEqual(300);
    const components = await css("app/styles/components.css");
    expect(components).toMatch(/\.health-cell dd\s*\{[^}]*var\(--data-row-value-type\)/s);
    expect(resolveValue(tokens, "--data-row-value-type")).toBe("0.875rem");
    for (const selector of [".wordmark", ".flink", ".identity-link"])
      expect(components).toMatch(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{[^}]*min-height:\\s*var\\(--control-min\\)`, "s"));
    expect(components).toMatch(/\.coverage-item\.covered\s*>\s*span\s*\{[^}]*var\(--status-badge-success-on-paper\)/s);
    expect(components).toMatch(/\.coverage-item\.missing\s*>\s*span\s*\{[^}]*var\(--status-badge-caution-on-paper\)/s);
    expect(components).toMatch(/\.evidence-card \.coverage-total\.state-good\s*\{[^}]*var\(--status-badge-success-on-paper\)/s);
    expect(components).toMatch(/\.evidence-card \.coverage-total\.state-warn\s*\{[^}]*var\(--status-badge-caution-on-paper\)/s);
    expect(components).not.toMatch(/\.coverage-item\.(?:covered|missing)[^{]*\{[^}]*(?:success|caution)-on-dark/s);
    expect(await css("components/ProofCoverageGrid.tsx")).toContain("evidence-card coverage-card");
    const browserSource = await allBrowserSource();
    expect(() => assertGovernedTsx(browserSource)).not.toThrow();
    const active = await activeUiFiles();
    expect(active).toContain("components/ScanInput.tsx");
    expect(source).toMatch(/\.break\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  });

  it("makes documentation and metadata point to the canonical source", async () => {
    const system = await readFile(resolve(process.cwd(), "DESIGN_SYSTEM.md"), "utf8");
    const progress = await readFile(resolve(process.cwd(), "ai/design-progress.md"), "utf8");
    const brand = JSON.parse(await readFile(resolve(process.cwd(), "brand.json"), "utf8"));
    for (const text of ["graphite", "warm paper", "signal lime", "3px 3px 0",
      "5px 5px 0", "Raw-color exception", "token-contract.test.ts"]) expect(system).toContain(text);
    expect(brand.canonicalStyleSource).toBe("app/styles/tokens.css");
    expect(brand).not.toHaveProperty("colorMode");
    expect(() => assertMetadata(brand)).not.toThrow(); expect(() => assertProgress(progress)).not.toThrow();
    for (const [name, value] of Object.entries(COMPONENT_TOKENS))
      expect(system, `document ${name}`).toContain(`${name}: ${value}`);
    expect(progress).toContain("Canonical source: `app/styles/tokens.css`");
    expect(progress).not.toMatch(/cyan|Syne|glass panels/i);
    expect(progress).toContain("../../docs/design/2026-08-28-sentinel-proof-ledger-state-spec.md");
    expect(system).toContain("clipped evidence sheet"); expect(system).toContain("Component token variants");
  });

  it("rejects representative contract mutants", async () => {
    expect(() => assertVariableGraph(":root{--a:var(--missing)}")).toThrow(/Unresolved/);
    expect(() => assertVariableGraph(":root{--a:var(--b);--b:var(--a);}")).toThrow(/cycle/i);
    for (const mutant of [".x{color:#fff}", ".x{color:rgb(0 0 0)}", ".x{color:hsl(0 0% 0%)}",
      ".x{color:oklch(50% .2 20)}", ".x{color:var(--text, #fff)}"])
      expect(rawColors(mutant), mutant).not.toEqual([]);
    expect(() => assertOwnedLayer(".x{color:var(--text)}", "components")).toThrow(/Unlayered/);
    expect(() => assertOwnedLayer("@layer layouts{.x{display:grid}}.y{display:block}", "layouts")).toThrow(/Unlayered/);
    for (const mutant of [".x{font-size:11px}", ".x{font-size:.7rem}", "html{scroll-behavior:smooth}",
      "body{overflow-x:hidden}", ".x{word-break:break-all}", ".x{transition:all 180ms}",
      ".x{box-shadow:0 4px 12px var(--shadow-ink)}", ".x{font:500 10px sans-serif}",
      ".x{transition-property:color}", ".x{filter:drop-shadow(0 2px 4px black)}", ".mono{overflow-wrap:anywhere}"])
      expect(() => assertGovernedCss(mutant), mutant).toThrow();
    expect(() => assertGovernedCss(".x{color:orange}")).toThrow(/named color/i);
    for (const mutant of [".x{transition:opacity 5s}", ".x{animation:pulse 5s}"])
      expect(() => assertGovernedCss(mutant), mutant).toThrow(/duration/i);
    expect(() => assertGovernedCss(":root{--slow:500ms;}.x{transition:opacity var(--slow)}"))
      .toThrow(/duration/i);
    for (const mutant of [".x{transition:opacity calc(200ms + 200ms)}",
      ":root{--duration-standard:180ms;}.x{animation:pulse calc(var(--duration-standard) + var(--duration-standard))}"])
      expect(() => assertGovernedCss(mutant), mutant).toThrow(/duration/i);
    expect(() => assertMotionCss("@layer motion{@keyframes mutant{to{width:20px}}}")).toThrow(/keyframe/i);
    expect(() => assertTokenColorAllowlist("@layer tokens{:root{--color-test:#fff}.x{color:#fff}}"))
      .toThrow(/raw token color/i);
    expect(() => assertTokenColorAllowlist("@layer tokens{:root{--color-graphite-950:#111214;}.x{--color-graphite-950:#fff;}}"))
      .toThrow(/raw token color/i);
    const tokens = await css("app/styles/tokens.css");
    expect(() => assertCanonicalTokens(tokens.replace('"Chakra Petch"', '"Arial"'))).toThrow(/canonical token/i);
    for (const mutant of ["const x=<div style={{fontSize:'10px'}} />", "const x=<div style={{wordBreak:'break-all'}} />",
      "const x=<div style={{transition:'width 600ms'}} />", "const x=<div style={{boxShadow:'0 2px 8px black'}} />",
      "const x=<div style={{color:'red'}} />", "const x=<div style={{fontSize:10}} />",
      "const x=<div style={{boxShadow:`0 2px 8px ${tone}`}} />", "const x=<div style={{animation:'pulse 1s'}} />",
      "const x=<div style={{color:'orange'}} />", "const x=<div style={{backgroundColor:'orange'}} />",
      "const x=<div style={{border:'1px solid orange'}} />"])
      expect(() => assertGovernedTsx(mutant), mutant).toThrow();
    expect(() => assertMetadata({ colors: {} })).toThrow(/duplicated style/i);
    expect(() => assertMetadata({ colorMode: "dark" })).toThrow(/duplicated style/i);
    expect(() => assertProgress("Selected: cyan glass panels")).toThrow(/stale direction/i);
  });
});

function layerFor(file: string): string {
  if (file === "foundations.css") return "reset|base\\.prooflock";
  if (file === "components.css") return "components\\.prooflock";
  if (file === "utilities.css") return "utilities\\.prooflock";
  return file.replace(".css", "");
}

function assertOwnedLayer(source: string, expected: string): void {
  let cursor = 0;
  while (cursor < source.length) {
    cursor = skipWhitespace(source, cursor);
    if (cursor === source.length) return;
    const header = source.slice(cursor).match(/^@layer\s+([\w.-]+)\s*\{/);
    if (!header || !new RegExp(`^(?:${expected})$`).test(header[1])) throw new Error("Unlayered or wrongly layered rule");
    cursor = matchingBraceEnd(source, cursor + header[0].length - 1);
  }
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start;
  while (/\s/.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function matchingBraceEnd(source: string, opening: number): number {
  let depth = 0;
  for (let cursor = opening; cursor < source.length; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    if (source[cursor] === "}" && --depth === 0) return cursor + 1;
  }
  throw new Error("Unbalanced layer block");
}

function assertVariableGraph(definitionSource: string, referenceSource = definitionSource): void {
  const values = declarations(definitionSource);
  for (const reference of `${definitionSource}\n${referenceSource}`.matchAll(/var\((--[\w-]+)/g)) {
    if (!values.has(reference[1]) && !EXTERNAL_VARIABLES.has(reference[1])) throw new Error(`Unresolved ${reference[1]}`);
  }
  const visit = (name: string, path: Set<string>): void => {
    if (path.has(name)) throw new Error(`Variable cycle at ${name}`);
    const nextPath = new Set(path).add(name);
    for (const reference of values.get(name)?.matchAll(/var\((--[\w-]+)/g) ?? []) {
      if (values.has(reference[1])) visit(reference[1], nextPath);
    }
  };
  for (const name of values.keys()) visit(name, new Set());
}

function rawColors(source: string, includeNamed = true): string[] {
  const named = includeNamed ? "|\\b(?:black|white|red|green|blue)(?![\\w-])" : "";
  return [...source.matchAll(new RegExp(`#[\\da-f]{3,8}\\b|\\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\\s*\\(${named}`, "gi"))]
    .map((match) => match[0].toLowerCase());
}

function assertTokenColorAllowlist(source: string): void {
  const contract = source.match(/^\s*@layer\s+tokens\s*\{\s*:root\s*\{([\s\S]*)\}\s*\}\s*$/);
  if (!contract || /[{}]/.test(contract[1])) throw new Error("Raw token color must live in the single :root contract");
  const values = declarations(contract[1]);
  for (const [name, expected] of RAW_TOKEN_DECLARATIONS) {
    if (values.get(name) !== expected) throw new Error(`Raw token color mismatch for ${name}`);
  }
  for (const [name, value] of values) {
    if (rawColors(value).length && RAW_TOKEN_DECLARATIONS.get(name) !== value)
      throw new Error(`Raw token color is not allowed for ${name}`);
  }
  const remainder = contract[1].replace(/(--[\w-]+)\s*:\s*([^;]+);/g, "");
  if (rawColors(remainder).length) throw new Error("Raw token color outside an allowed declaration");
}

function assertCanonicalTokens(source: string): void {
  const actual = declarations(source);
  if (actual.size !== CANONICAL_TOKENS.size) throw new Error("Canonical token count mismatch");
  for (const [name, value] of CANONICAL_TOKENS) {
    if (actual.get(name) !== value) throw new Error(`Canonical token mismatch for ${name}`);
  }
  for (const name of actual.keys()) if (!CANONICAL_TOKENS.has(name)) throw new Error(`Unexpected canonical token ${name}`);
}

function assertGovernedCss(source: string): void {
  const values = declarations(source);
  if (/scroll-behavior\s*:\s*smooth/i.test(source)) throw new Error("Smooth scrolling is forbidden");
  if (/overflow-x\s*:\s*hidden/i.test(source)) throw new Error("Horizontal clipping is forbidden");
  if (/word-break\s*:/i.test(source)) throw new Error("Broad word breaking is forbidden");
  for (const match of source.matchAll(/\b(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|fill|stroke)\s*:\s*([^;}]+)/gi)) {
    assertNoNamedColor(match[1]);
  }
  if (/overflow-wrap\s*:\s*anywhere/i.test(source.replace(/\.break\s*\{[^}]*\}/gis, ""))) throw new Error("Broad wrapping is forbidden");
  for (const match of source.matchAll(/font-size\s*:\s*([.\d]+)(px|rem)/gi)) {
    if ((match[2] === "px" && +match[1] < 12) || (match[2] === "rem" && +match[1] < .75)) throw new Error("Type floor violated");
  }
  for (const match of source.matchAll(/transition\s*:\s*([^;]+)/gi)) {
    if (/\ball\b|background|border|color|width|height/i.test(match[1])) throw new Error("Ungoverned transition");
  }
  for (const match of source.matchAll(/(?:transition|animation)(?:-duration)?\s*:\s*([^;]+)/gi)) {
    const resolved = match[1].replace(/var\((--[\w-]+)\)/g, (_, name: string) => resolveValue(values, name));
    assertDurationLimit(resolved);
  }
  if (/transition-property\s*:\s*(?:all|[^;]*(?:background|border|color|width|height))/i.test(source)) throw new Error("Ungoverned transition property");
  for (const match of source.matchAll(/font\s*:\s*([^;]+)/gi)) {
    const size = match[1].match(/(?:^|\s)([.\d]+)(px|rem)(?:\/|\s)/i);
    if (size && ((size[2] === "px" && +size[1] < 12) || (size[2] === "rem" && +size[1] < .75))) throw new Error("Type floor violated");
  }
  for (const match of source.matchAll(/box-shadow\s*:\s*([^;]+)/gi)) {
    if (!/^(?:var\(--(?:shadow-(?:control|sheet)|button-shadow|evidence-sheet-shadow|proof-plane-shadow)\)|none)$/i.test(match[1].trim())) throw new Error("Blurred or ungoverned shadow");
  }
  if (/(?:filter|backdrop-filter)\s*:[^;]*(?:blur|drop-shadow)\(/i.test(source)) throw new Error("Blurred effect");
}

function assertGovernedTsx(source: string): void {
  if (rawColors(source, false).length) throw new Error("Raw inline color");
  for (const match of source.matchAll(/(?:color|background(?:Color)?|border(?:Color)?|outline(?:Color)?|fill|stroke)\s*:\s*["']([^"']+)["']/gi))
    assertNoNamedColor(match[1]);
  if (/(?:wordBreak|overflowWrap)\s*:/i.test(source)) throw new Error("Broad inline wrapping");
  for (const match of source.matchAll(/fontSize\s*:\s*["']([.\d]+)(px|rem)["']/gi)) {
    if ((match[2] === "px" && +match[1] < 12) || (match[2] === "rem" && +match[1] < .75)) throw new Error("Inline type floor violated");
  }
  for (const match of source.matchAll(/fontSize\s*:\s*(\d+(?:\.\d+)?)(?:\s*[,}])/gi)) if (+match[1] < 12) throw new Error("Inline type floor violated");
  if (/(?:transition|transitionProperty|animation)\s*:\s*["'`][^"'`]*(?:all|width|height|color|background|border|\d)/i.test(source)) throw new Error("Inline motion is ungoverned");
  if (/boxShadow\s*:\s*["'`](?!var\(--shadow-(?:control|sheet)\))[^"'`]+/i.test(source)) throw new Error("Inline shadow is ungoverned");
}

function assertDurationLimit(value: string): void {
  let flattened = value;
  for (const calc of value.matchAll(/calc\(([^()]*)\)/gi)) {
    const terms = calc[1].split("+").map((term) => durationMs(term.trim()));
    if (terms.some((term) => term === undefined)) throw new Error("Unsupported duration calculation");
    flattened = flattened.replace(calc[0], `${terms.reduce<number>((sum, term) => sum + (term ?? 0), 0)}ms`);
  }
  for (const duration of flattened.matchAll(/([.\d]+)(ms|s)\b/gi))
    if (durationMs(duration[0])! > 300) throw new Error("Motion duration exceeds 300ms");
}

function durationMs(value: string): number | undefined {
  const match = value.match(/^([.\d]+)(ms|s)$/i);
  return match ? +match[1] * (match[2].toLowerCase() === "s" ? 1000 : 1) : undefined;
}

function assertNoNamedColor(value: string): void {
  if (rawColors(value, false).length) throw new Error("Raw color is forbidden");
  const withoutVariables = value.replace(/var\([^)]*\)/g, "");
  const allowed = new Set(["transparent", "currentcolor", "inherit", "initial", "unset", "revert", "layer", "none",
    "solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset", "medium", "thin", "thick",
    "auto", "important", "px", "rem", "em", "linear", "radial", "gradient", "to", "bottom", "top", "left", "right", "ellipse", "at", "deg"]);
  const unexpected = withoutVariables.match(/[a-z]+/gi)?.find((word) => !allowed.has(word.toLowerCase()));
  if (unexpected) throw new Error(`Named color ${unexpected} is forbidden`);
}

function assertMotionCss(source: string): void {
  for (const keyframe of source.matchAll(/@keyframes\s+[\w-]+\s*\{/g)) {
    const opening = keyframe.index! + keyframe[0].length - 1;
    const block = source.slice(opening + 1, matchingBraceEnd(source, opening) - 1);
    for (const declaration of block.matchAll(/([\w-]+)\s*:/g)) {
      if (!/^(?:opacity|transform)$/.test(declaration[1])) throw new Error(`Ungoverned keyframe property ${declaration[1]}`);
    }
  }
}

function ms(tokens: Map<string, string>, name: string): number {
  const value = tokens.get(name);
  if (!value?.endsWith("ms")) throw new Error(`Expected millisecond token ${name}`);
  return Number.parseFloat(value);
}

function resolveValue(tokens: Map<string, string>, name: string): string {
  let value = tokens.get(name); const seen = new Set<string>();
  while (value?.startsWith("var(")) {
    const next = value.match(/var\((--[\w-]+)\)/)?.[1];
    if (!next || seen.has(next)) throw new Error(`Unresolvable value ${name}`);
    seen.add(next); value = tokens.get(next);
  }
  if (!value) throw new Error(`Missing value ${name}`);
  return value;
}

function assertMetadata(brand: Record<string, unknown>): void {
  if ("colors" in brand || "fonts" in brand || "colorMode" in brand) throw new Error("Metadata contains duplicated style values");
  const allowed = new Set(["name", "tagline", "logoPath", "canonicalStyleSource", "designSystem"]);
  if (Object.keys(brand).some((key) => !allowed.has(key))) throw new Error("Metadata contains duplicated style values");
}

function assertProgress(progress: string): void {
  if (/cyan|Syne|glass panels/i.test(progress)) throw new Error("Stale direction");
}

async function sourceFiles(...roots: string[]): Promise<string[]> {
  const files: string[] = [];
  const visit = async (path: string): Promise<void> => {
    for (const entry of await readdir(resolve(process.cwd(), path), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (/\.[jt]sx?$/.test(entry.name)) files.push(child);
    }
  };
  await Promise.all(roots.map(visit));
  return files;
}

async function allBrowserSource(): Promise<string> {
  return (await Promise.all((await activeUiFiles()).map(css))).join("\n");
}

async function activeUiFiles(): Promise<string[]> {
  const roots = (await sourceFiles("app")).filter((file) => /\/(?:page|layout|error|not-found)\.tsx$/.test(`/${file}`));
  const visited = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = await css(file);
    for (const match of source.matchAll(/from\s+["'](@\/[^"']+|\.[^"']+)["']/g)) {
      const imported = await resolveTsxImport(file, match[1]);
      if (imported) await visit(imported);
    }
  };
  await Promise.all(roots.map(visit));
  return [...visited].sort();
}

async function resolveTsxImport(from: string, specifier: string): Promise<string | undefined> {
  const base = specifier.startsWith("@/") ? specifier.slice(2) : resolve(dirname(from), specifier);
  const relativeBase = base.startsWith("/") ? base.slice(process.cwd().length + 1) : base;
  for (const candidate of [`${relativeBase}.tsx`, `${relativeBase}/index.tsx`, relativeBase]) {
    if (!candidate.endsWith(".tsx")) continue;
    try { await readFile(resolve(process.cwd(), candidate), "utf8"); return candidate; } catch { /* try next */ }
  }
}

const OG_COLOR_ALLOWLIST = new Set(["#111214", "#f2efe8", "#c6f24e", "#a7a39b"]);

async function css(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), path), "utf8");
}

async function allStyles(): Promise<string> {
  return (await Promise.all([css("app/globals.css"), ...STYLE_FILES.map((file) => css(`app/styles/${file}`))])).join("\n");
}

function declarations(source: string): Map<string, string> {
  return new Map([...source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    .map((match) => [match[1], match[2].trim()]));
}

function contrast(tokens: Map<string, string>, foreground: string, background: string): number {
  const backColor = resolveColor(tokens, background);
  const front = luminance(composite(resolveColor(tokens, foreground), backColor)); const back = luminance(backColor);
  return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
}

type Rgba = readonly [number, number, number, number];

function resolveColor(tokens: Map<string, string>, name: string): Rgba {
  let value = tokens.get(name); const visited = new Set<string>();
  while (value?.startsWith("var(")) {
    const next = value.match(/var\((--[\w-]+)\)/)?.[1];
    if (!next || visited.has(next)) break; visited.add(next); value = tokens.get(next);
  }
  if (!value) throw new Error(`Expected color for ${name}`);
  const hex = value.match(/^#([\da-f]{6})$/i)?.[1];
  if (hex) return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16), 1];
  const rgba = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([.\d]+)\s*\)$/i);
  if (rgba) return [+rgba[1], +rgba[2], +rgba[3], +rgba[4]];
  throw new Error(`Expected supported color for ${name}`);
}

function composite(front: Rgba, back: Rgba): Rgba {
  return [front[0] * front[3] + back[0] * (1 - front[3]), front[1] * front[3] + back[1] * (1 - front[3]),
    front[2] * front[3] + back[2] * (1 - front[3]), 1];
}

function luminance(color: Rgba): number {
  const channels = color.slice(0, 3).map((value) => value / 255)
    .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

const RAW_TOKEN_DECLARATIONS = new Map<string, string>([
  ["--color-graphite-950", "#111214"], ["--color-graphite-900", "#191a1e"],
  ["--color-graphite-800", "#222329"], ["--color-graphite-975", "#0d0e10"],
  ["--color-paper-50", "#f2efe8"], ["--color-paper-100", "#f1ebdf"], ["--color-paper-200", "#e6ddcf"],
  ["--color-ink-950", "#19181a"], ["--color-violet-400", "#c6f24e"], ["--color-violet-700", "#4a6a00"],
  ["--color-action-ink", "#14210a"], ["--surface-topbar", "rgba(17, 18, 20, .96)"],
  ["--surface-subtle", "rgba(255, 255, 255, .025)"], ["--texture-dot", "rgba(255, 255, 255, .08)"],
  ["--grid-line", "rgba(198, 242, 78, .08)"], ["--text-muted-on-dark", "#a7a39b"],
  ["--text-placeholder-on-dark", "#8f8b84"], ["--text-muted-on-paper", "#5b565b"],
  ["--text-data-on-paper", "#423d42"], ["--status-success-on-dark", "#39b982"],
  ["--status-caution-on-dark", "#d79a36"], ["--status-failure-on-dark", "#f07878"],
  ["--status-unknown-on-dark", "#b4afb7"], ["--status-success-on-paper", "#116b49"],
  ["--status-caution-on-paper", "#91470a"], ["--status-failure-on-paper", "#aa303a"],
  ["--status-unknown-on-paper", "#68636b"], ["--focus-on-dark", "#d8f57a"],
  ["--focus-on-paper", "#446200"], ["--border-control-on-dark", "#77767b"],
  ["--border-control-on-paper", "#777076"], ["--border-subtle-on-dark", "rgba(242, 239, 232, .18)"],
  ["--border-subtle-on-paper", "rgba(25, 24, 26, .22)"], ["--status-success-soft", "rgba(57, 185, 130, .14)"],
  ["--status-caution-soft", "rgba(215, 154, 54, .15)"], ["--status-failure-soft", "rgba(240, 120, 120, .14)"],
  ["--action-soft", "rgba(198, 242, 78, .15)"], ["--rail-end-on-ceremony", "rgba(198, 242, 78, .65)"],
  ["--shadow-ink", "#000000"],
]);

const CANONICAL_TOKENS = new Map<string, string>([
  ...RAW_TOKEN_DECLARATIONS,
  ["--surface-canvas", "var(--color-graphite-950)"], ["--surface-raised", "var(--color-graphite-900)"],
  ["--surface-control", "var(--color-graphite-800)"], ["--surface-ceremony", "var(--color-graphite-975)"],
  ["--surface-paper", "var(--color-paper-100)"], ["--surface-paper-muted", "var(--color-paper-200)"],
  ["--text-on-dark", "var(--color-paper-50)"], ["--text-on-paper", "var(--color-ink-950)"],
  ["--action-on-dark", "var(--color-violet-400)"], ["--action-on-paper", "var(--color-violet-700)"],
  ["--action-ink", "var(--color-action-ink)"],
  ["--space-0", "0"], ["--space-half", "4px"], ["--space-1", "8px"], ["--space-1-5", "12px"],
  ["--space-2", "16px"], ["--space-2-5", "20px"], ["--space-3", "24px"], ["--space-4", "32px"],
  ["--space-5", "40px"], ["--space-6", "48px"], ["--space-8", "64px"], ["--space-11", "88px"],
  ["--type-caption", "0.75rem"], ["--type-data", "0.875rem"], ["--type-body", "1rem"],
  ["--type-title", "1.25rem"], ["--type-display-sm", "clamp(1.7rem, 3.4vw, 3rem)"],
  ["--type-display-lg", "clamp(2.6rem, 7vw, 6.4rem)"], ["--line-caption", "1.4"],
  ["--line-data", "1.45"], ["--line-body", "1.55"], ["--line-heading", "1.05"],
  ["--font-display", 'var(--font-chakra), "Chakra Petch", sans-serif'],
  ["--font-body", 'var(--font-plex-sans), "IBM Plex Sans", sans-serif'],
  ["--font-mono", 'var(--font-plex-mono), "IBM Plex Mono", monospace'],
  ["--control-min", "44px"], ["--control-primary", "48px"], ["--shape-square", "0"],
  ["--dossier-cut", "16px"], ["--shadow-control", "3px 3px 0 var(--shadow-ink)"],
  ["--shadow-sheet", "5px 5px 0 var(--shadow-ink)"], ["--duration-fast", "120ms"],
  ["--duration-standard", "180ms"], ["--duration-maximum", "300ms"], ["--duration-stagger", "13ms"],
  ["--ease-standard", "cubic-bezier(.2, .8, .2, 1)"], ["--layer-canvas", "0"],
  ["--layer-content", "2"], ["--layer-header", "50"], ["--measure-ledger", "1180px"],
  ["--measure-verify", "850px"], ["--measure-prose", "740px"], ["--measure-narrow", "580px"],
  ["--icon-sm", "16px"], ["--icon-md", "20px"], ["--icon-lg", "24px"],
  ["--breakpoint-ledger", "850px"], ["--breakpoint-mobile", "600px"],
  ["--breakpoint-compact", "390px"], ["--breakpoint-minimum", "320px"],
  ...Object.entries(COMPONENT_TOKENS),
  ["--graphite", "var(--surface-canvas)"], ["--graphite-2", "var(--surface-raised)"],
  ["--graphite-3", "var(--surface-control)"], ["--paper", "var(--surface-paper)"],
  ["--paper-2", "var(--surface-paper-muted)"], ["--ink", "var(--text-on-paper)"],
  ["--text", "var(--text-on-dark)"], ["--muted", "var(--text-muted-on-dark)"],
  ["--line", "var(--border-subtle-on-dark)"], ["--line-dark", "var(--border-subtle-on-paper)"],
  ["--violet", "var(--action-on-dark)"], ["--violet-soft", "var(--action-soft)"],
  ["--good", "var(--status-success-on-dark)"], ["--good-soft", "var(--status-success-soft)"],
  ["--warn", "var(--status-caution-on-dark)"], ["--warn-soft", "var(--status-caution-soft)"],
  ["--bad", "var(--status-failure-on-dark)"], ["--bad-soft", "var(--status-failure-soft)"],
  ["--elevation-1", "var(--shadow-control)"], ["--elevation-2", "var(--shadow-sheet)"],
  ["--max", "var(--measure-ledger)"],
]);

import { chromium } from "playwright";
const U = "https://sentinel-prooflock.vercel.app";
const PROOF = "0xa4c3bf5c178efaebc568f3d96b98e76c1e7bcd921dc230bccb0938c66028e7c2";
const IK = "0xf89c397909cc23a344999b4d6a7738fca5324143c0b2bcafb8a716277ae56d78";
const routes = [
  ["overview", "/"],
  ["verify", "/proof"],
  ["proof-detail", `/proof/${PROOF}?identityKey=${IK}`],
];
const widths = [["1440", 1440, 900], ["390", 390, 844], ["320", 320, 720]];
const out = "../docs/screenshots/proof-ledger-final";
const browser = await chromium.launch();
for (const [label, w, h] of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const [name, path] of routes) {
    await page.goto(U + path, { waitUntil: "networkidle", timeout: 45000 }).catch(()=>{});
    await page.waitForTimeout(2500);
    const file = `${out}/${name}-${label}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log("captured", file);
  }
  await ctx.close();
}
await browser.close();

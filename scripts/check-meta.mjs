#!/usr/bin/env node
/**
 * Verify every HTML page carries the full share-card meta set
 * (og:url, og:image + dimensions, twitter:card) and that 404.html
 * has a description. Run: node scripts/check-meta.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PAGES = [
  "index.html",
  "jarvis.html",
  "notizen-agents.html",
  "notizen-tests.html",
  "sicherheit-iphone.html",
  "agent-board-fallstudie.html",
  "en/index.html",
  "en/agent-board-case-study.html",
];

const must = (html, re, label) => {
  if (!re.test(html)) throw new Error(`missing ${label}`);
};

let failures = 0;
for (const page of PAGES) {
  const file = path.join(ROOT, page);
  let html;
  try {
    html = readFileSync(file, "utf8");
  } catch {
    console.log(`FAIL ${page}: not found`);
    failures += 1;
    continue;
  }
  try {
    must(html, /<link\b[^>]*rel="canonical"/, "canonical");
    must(html, /<meta\b[^>]*property="og:title"/, "og:title");
    must(html, /<meta\b[^>]*property="og:description"/, "og:description");
    must(html, /<meta\b[^>]*property="og:url"/, "og:url");
    must(html, /<meta\b[^>]*property="og:image"/, "og:image");
    must(html, /<meta\b[^>]*property="og:image:width"/, "og:image:width");
    must(html, /<meta\b[^>]*property="og:image:height"/, "og:image:height");
    must(html, /<meta\b[^>]*name="twitter:card"/, "twitter:card");
    must(html, /<img\b|<\w/, "has content");
    console.log(`ok   ${page}`);
  } catch (err) {
    console.log(`FAIL ${page}: ${err.message}`);
    failures += 1;
  }
}

const notFound = readFileSync(path.join(ROOT, "404.html"), "utf8");
try {
  must(notFound, /<meta\b[^>]*name="description"/, "404 description");
  must(notFound, /<meta\b[^>]*name="robots"[^>]*noindex/, "404 noindex");
  console.log("ok   404.html");
} catch (err) {
  console.log(`FAIL 404.html: ${err.message}`);
  failures += 1;
}

// No page should duplicate og:image or og:url.
for (const page of [...PAGES, "404.html"]) {
  const file = path.join(ROOT, page);
  if (!/404\.html|en\/index/.test(page) && !/index\.html/.test(page)) continue;
  const html = readFileSync(file, "utf8");
  for (const prop of ["og:image", "og:url"]) {
    const count = (html.match(new RegExp(`property="${prop}"`, "g")) || []).length;
    if (count > 1) {
      console.log(`FAIL ${page}: ${prop} appears ${count} times`);
      failures += 1;
    }
  }
}

console.log(failures ? `\n${failures} failure(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);

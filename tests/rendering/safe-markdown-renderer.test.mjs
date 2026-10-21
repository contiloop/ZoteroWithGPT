import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";

import { JSDOM } from "jsdom";

import { SafeMarkdownRenderer } from "../../dist/adapters/rendering/index.js";

function createRenderer(options = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://reader.invalid/",
  });
  return {
    dom,
    renderer: new SafeMarkdownRenderer({ window: dom.window, ...options }),
  };
}

test("renders a long Korean proof, stepwise math, and usable reference links", async () => {
  const { dom, renderer } = createRenderer();
  const source = [
    "### 귀납법 증명",
    "",
    "1. 기초 단계: $s_0 = 1$을 확인한다.",
    "2. 귀납 가정: $s_k = k + 1$이라고 하자.",
    "3. 귀납 단계:",
    "",
    "$$s_{k+1} = s_k + 1 = k + 2$$",
    "",
    "따라서 모든 $k\\ge 0$에 대해 성립한다.",
    "",
    "[원문 DOI](https://doi.org/10.1000/example)",
  ].join("\n");

  const result = await renderer.render({
    content: source,
    source: "annotation",
    requestedFormat: "sanitized_html",
  });

  assert.equal(result.format, "sanitized_html");
  assert.equal(result.untrusted, true);
  const container = dom.window.document.createElement("div");
  container.innerHTML = result.content;

  assert.match(container.textContent, /귀납법 증명/u);
  assert.match(container.textContent, /기초 단계/u);
  assert.match(container.textContent, /귀납 단계/u);
  assert.ok(container.querySelector("math"), "math is rendered as native MathML");
  assert.ok(container.querySelector(".katex-display > .katex > math"));
  const link = container.querySelector("a");
  assert.equal(link?.getAttribute("href"), "https://doi.org/10.1000/example");
  assert.match(link?.getAttribute("rel") ?? "", /noopener/u);
  assert.match(link?.getAttribute("rel") ?? "", /noreferrer/u);
});

test("supports bracket math while leaving code spans literal", async () => {
  const { dom, renderer } = createRenderer();
  const source = [
    "Inline \\(a^2+b^2=c^2\\) proof.",
    "",
    "\\[",
    "\\frac{1}{n} \\sum_{i=1}^{n} x_i",
    "\\]",
    "",
    "`$literal$`",
  ].join("\n");

  const result = await renderer.render({
    content: source,
    source: "annotation",
    requestedFormat: "sanitized_html",
  });
  const container = dom.window.document.createElement("div");
  container.innerHTML = result.content;

  assert.equal(container.querySelectorAll("math").length, 2);
  assert.equal(container.querySelector("code")?.textContent, "$literal$");
});

test("preserves validated MathML attributes that carry formula meaning and layout", async () => {
  const { dom, renderer } = createRenderer();
  const source = [
    "$$\\cancel{x}$$",
    "",
    "$$\\begin{aligned} a&=b+c\\\\ d&=e \\end{aligned}$$",
  ].join("\n");

  const result = await renderer.render({
    content: source,
    source: "annotation",
    requestedFormat: "sanitized_html",
  });
  const container = dom.window.document.createElement("div");
  container.innerHTML = result.content;

  assert.equal(container.querySelector("menclose")?.getAttribute("notation"), "updiagonalstrike");
  const aligned = container.querySelector("mtable");
  assert.equal(aligned?.getAttribute("columnalign"), "right left");
  assert.equal(aligned?.getAttribute("columnspacing"), "0em");
  assert.equal(aligned?.getAttribute("rowspacing"), "0.25em");
});

test("uses complete readable fallback when math delimiter work exceeds its fixed budget", async () => {
  const { dom, renderer } = createRenderer();
  const source = `${"\\[".repeat(5_000)}끝\n둘째 줄`;

  const result = await renderer.render({
    content: source,
    source: "annotation",
    requestedFormat: "sanitized_html",
  });
  const container = dom.window.document.createElement("div");
  container.innerHTML = result.content;

  assert.equal(container.textContent, source.replace("\n", ""));
  assert.equal(container.querySelectorAll("br").length, 1);
  assert.equal(container.querySelector("math"), null);
});

test("handles a valid 512 KiB unmatched-delimiter comment without hanging the test process", async () => {
  const worker = new Worker(new URL("./pathological-math-worker.mjs", import.meta.url));
  let settled = false;
  try {
    const message = await new Promise((resolve, reject) => {
      const guard = setTimeout(() => {
        if (settled) return;
        settled = true;
        void worker.terminate();
        reject(new Error("512 KiB render exceeded the worker guard"));
      }, 5_000);
      worker.once("message", (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        resolve(value);
      });
      worker.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        reject(error);
      });
      worker.once("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        reject(new Error(`pathological render worker exited before reporting (${code})`));
      });
    });
    assert.deepEqual(message, {
      denseFormat: "sanitized_html",
      denseSourceLength: 512 * 1024,
      denseTextMatches: true,
      sparseSourceLength: 512 * 1024,
      sparseUsesMarkdownSemantics: true,
    });
  } finally {
    settled = true;
    await worker.terminate();
  }
});

test("blocks markup, active protocols, remote resources, and KaTeX trust commands", async () => {
  const { dom, renderer } = createRenderer();
  const source = [
    '<script>globalThis.pwned = true</script><img src="https://tracker.invalid/pixel">',
    "![remote](https://tracker.invalid/image.png)",
    "[script](javascript:alert(1))",
    "[data](data:text/html,boom)",
    "[file](file:///etc/passwd)",
    "[safe](https://example.org/reference)",
    "$\\href{javascript:alert(1)}{bad}$",
    "$\\includegraphics{https://tracker.invalid/math.png}$",
  ].join("\n\n");

  const result = await renderer.render({
    content: source,
    source: "annotation",
    requestedFormat: "sanitized_html",
  });
  const container = dom.window.document.createElement("div");
  container.innerHTML = result.content;

  assert.equal(container.querySelector("script, img, iframe, object, embed, style, link"), null);
  assert.equal(container.querySelector("[src], [srcset], [style], [onerror], [onclick]"), null);
  assert.equal(container.querySelector('a[href^="javascript:"]'), null);
  assert.equal(container.querySelector('a[href^="data:"]'), null);
  assert.equal(container.querySelector('a[href^="file:"]'), null);
  const hrefs = [...container.querySelectorAll("a[href]")].map((link) => link.getAttribute("href"));
  assert.ok(hrefs.every((href) => /^https?:\/\//u.test(href)));
  assert.ok(hrefs.includes("https://example.org/reference"));
  assert.match(container.textContent, /<script>/u, "raw HTML is displayed as text");
});

test("returns escaped readable content when Markdown rendering fails", async () => {
  const { dom, renderer } = createRenderer({
    markdown: {
      render() {
        throw new Error("synthetic renderer failure");
      },
    },
  });
  const source = "첫 줄 <img src=https://tracker.invalid>\n둘째 줄";

  const result = await renderer.render({
    content: source,
    source: "annotation",
    requestedFormat: "sanitized_html",
  });
  const container = dom.window.document.createElement("div");
  container.innerHTML = result.content;

  assert.equal(container.querySelector("img"), null);
  assert.equal(container.textContent, "첫 줄 <img src=https://tracker.invalid>둘째 줄");
  assert.equal(container.querySelectorAll("br").length, 1);
});

test("the final sanitizer rejects hostile markup emitted by a renderer dependency", async () => {
  const { dom, renderer } = createRenderer({
    markdown: {
      render() {
        return [
          '<img src="https://tracker.invalid/pixel" onerror="alert(1)">',
          '<a href="javascript:alert(1)" onclick="alert(2)">bad</a>',
          '<math><menclose notation="updiagonalstrike javascript"><mi xlink:href="data:text/html,boom">x</mi></menclose></math>',
          '<math><a href="https://example.org/math-link">math link</a></math>',
          '<a href="https://example.org/good">good</a>',
        ].join("");
      },
    },
  });

  const result = await renderer.render({
    content: "untrusted",
    source: "annotation",
    requestedFormat: "sanitized_html",
  });
  const container = dom.window.document.createElement("div");
  container.innerHTML = result.content;

  assert.equal(container.querySelector("img, script, style, iframe"), null);
  assert.equal(container.querySelector("[onerror], [onclick], [xlink\\:href]"), null);
  assert.equal(container.querySelector("menclose")?.hasAttribute("notation"), false);
  assert.equal(container.querySelector("math a[href]"), null);
  assert.equal(container.querySelector('a[href^="javascript:"]'), null);
  assert.equal(container.querySelector("a[href]")?.getAttribute("href"), "https://example.org/good");
});

test("plain text requests preserve the canonical native comment", async () => {
  const { renderer } = createRenderer();
  const content = "ordinary Zotero edit\n$not rendered$";
  const result = await renderer.render({
    content,
    source: "annotation",
    requestedFormat: "plain_text",
  });

  assert.deepEqual(result, { content, format: "plain_text", untrusted: true });
});

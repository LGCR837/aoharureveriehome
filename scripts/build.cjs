"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { transform } = require("esbuild");
const { minify } = require("html-minifier-terser");
const matter = require("gray-matter");
const MarkdownIt = require("markdown-it");
const markdownItFootnote = require("markdown-it-footnote");
const markdownItTaskLists = require("markdown-it-task-lists");
const markdownItMark = require("markdown-it-mark");
const hljs = require("highlight.js/lib/core");
const JavaScriptObfuscator = require("javascript-obfuscator");

for (const language of ["javascript", "typescript", "json", "bash", "css", "xml", "markdown", "python", "rust", "java", "yaml", "sql"]) {
  hljs.registerLanguage(language, require(`highlight.js/lib/languages/${language}`));
}
hljs.registerLanguage("js", require("highlight.js/lib/languages/javascript"));
hljs.registerLanguage("ts", require("highlight.js/lib/languages/typescript"));
hljs.registerLanguage("sh", require("highlight.js/lib/languages/bash"));
hljs.registerLanguage("shell", require("highlight.js/lib/languages/bash"));
hljs.registerLanguage("html", require("highlight.js/lib/languages/xml"));
hljs.registerLanguage("md", require("highlight.js/lib/languages/markdown"));

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "public");
const postsDirectory = path.join(root, "content", "posts");
const read = (file) => fs.readFile(path.join(root, file), "utf8");
const formatSize = (buffer) => `${(Buffer.byteLength(buffer) / 1024).toFixed(1)} KB`;

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const stripMarkdown = (source) => source
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/\[\^[^\]]+\]/g, " ")
  .replace(/[#>*_`~=[\]-]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const makeExcerpt = (source, length = 110) => {
  const text = stripMarkdown(source);
  return text.length > length ? `${text.slice(0, length).trim()}…` : text;
};

const readingMinutes = (source) => {
  const text = stripMarkdown(source);
  const chineseCharacters = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latinWords = (text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+/g) || []).length;
  return Math.max(1, Math.ceil(chineseCharacters / 320 + latinWords / 220));
};

const dateValue = (value, file) => {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid or missing date in ${file}`);
  }
  return date;
};

const isoDate = (date) => date.toISOString().slice(0, 10);
const displayDate = (date) => isoDate(date).replaceAll("-", ".");
const normalizeSlug = (value) => String(value)
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, "-")
  .replace(/^-+|-+$/g, "");

const uniqueHeadingId = (text, used) => {
  const base = String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "section";
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
};

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(code, language) {
    const requested = String(language || "").toLowerCase();
    const safeLanguage = /^[a-z0-9_+-]+$/.test(requested) ? requested : "text";
    const highlighted = requested && hljs.getLanguage(requested)
      ? hljs.highlight(code, { language: requested, ignoreIllegals: true }).value
      : escapeHtml(code);
    return `<pre class="hljs"><code class="language-${safeLanguage}">${highlighted}</code></pre>`;
  }
});

markdown.use(markdownItFootnote);
markdown.use(markdownItTaskLists, { enabled: false, label: true });
markdown.use(markdownItMark);

markdown.core.ruler.push("heading_ids", (state) => {
  state.env.headings = [];
  const used = new Set();
  for (let index = 0; index < state.tokens.length; index += 1) {
    const token = state.tokens[index];
    if (token.type !== "heading_open") continue;
    const inline = state.tokens[index + 1];
    const text = inline?.children
      ? inline.children.filter((child) => child.type === "text" || child.type === "code_inline").map((child) => child.content).join("")
      : (inline?.content || "");
    const cleanText = text.trim();
    if (!cleanText) continue;
    const id = uniqueHeadingId(cleanText, used);
    token.attrSet("id", id);
    state.env.headings.push({
      level: Number(token.tag.slice(1)),
      text: cleanText,
      id
    });
  }
});

const defaultLinkOpen = markdown.renderer.rules.link_open
  || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const href = tokens[index].attrGet("href") || "";
  if (/^https?:\/\//i.test(href)) {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noopener noreferrer");
  }
  return defaultLinkOpen(tokens, index, options, env, self);
};

async function loadPosts() {
  const files = (await fs.readdir(postsDirectory))
    .filter((file) => file.endsWith(".md"))
    .sort();

  const posts = [];
  const slugs = new Set();

  for (const file of files) {
    const source = await fs.readFile(path.join(postsDirectory, file), "utf8");
    const parsed = matter(source);
    const data = parsed.data;

    if (!data.title) throw new Error(`Missing title in ${file}`);
    const date = dateValue(data.date, file);
    const updated = data.updated ? dateValue(data.updated, file) : date;
    const slug = normalizeSlug(data.slug || file.replace(/\.md$/, ""));
    if (!slug) throw new Error(`Invalid slug in ${file}`);
    if (slugs.has(slug)) throw new Error(`Duplicate slug: ${slug}`);
    slugs.add(slug);

    const env = {};
    const html = markdown.render(parsed.content, env);
    const tags = (Array.isArray(data.tags) ? data.tags : [data.tags])
      .filter(Boolean)
      .map((tag) => String(tag).trim());

    posts.push({
      file,
      slug,
      title: String(data.title),
      summary: String(data.summary || data.description || makeExcerpt(parsed.content)),
      date,
      updated,
      tags,
      draft: Boolean(data.draft),
      readingMinutes: readingMinutes(parsed.content),
      wordCount: stripMarkdown(parsed.content).length,
      html,
      headings: env.headings || []
    });
  }

  return posts
    .filter((post) => !post.draft)
    .sort((left, right) => right.date - left.date);
}

function renderTags(tags, className) {
  if (!tags.length) return "";
  return `<ul class="${className}" aria-label="文章标签">${tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("")}</ul>`;
}

function renderToc(headings) {
  const visibleHeadings = headings.filter((heading) => heading.level >= 2 && heading.level <= 3);
  if (!visibleHeadings.length) {
    return '<p class="toc__empty">这篇文章没有分节标题。</p>';
  }
  return `<ol class="toc__list">${visibleHeadings.map((heading) => (
    `<li class="toc__item toc__item--h${heading.level}"><a href="#${escapeHtml(heading.id)}" data-toc-link>${escapeHtml(heading.text)}</a></li>`
  )).join("")}</ol>`;
}

function renderRecentPosts(posts) {
  if (!posts.length) {
    return '<p class="recent-posts__empty">文章正在准备中。</p>';
  }

  return posts.slice(0, 4).map((post, index) => `
    <a class="article-preview reveal" data-delay="${Math.min(index + 1, 4)}" href="/blog/${post.slug}/">
      <div class="article-preview__top">
        <time datetime="${isoDate(post.date)}">${displayDate(post.date)}</time>
        <span>${String(index + 1).padStart(2, "0")} / POST</span>
      </div>
      <h3>${escapeHtml(post.title)}</h3>
      <p class="article-preview__summary">${escapeHtml(post.summary)}</p>
      <div class="article-preview__bottom">
        ${renderTags(post.tags.slice(0, 2), "article-preview__tags")}
        <span class="article-preview__meta">${post.readingMinutes} MIN READ <i aria-hidden="true">↗</i></span>
      </div>
    </a>
  `).join("");
}

function renderBlogIndex(posts) {
  const items = posts.length
    ? posts.map((post, index) => `
      <a class="post-index-item reveal" href="/blog/${post.slug}/">
        <span class="post-index-item__number">${String(index + 1).padStart(2, "0")}</span>
        <div class="post-index-item__body">
          <div class="post-index-item__meta">
            <time datetime="${isoDate(post.date)}">${displayDate(post.date)}</time>
            <span>${post.readingMinutes} MIN READ</span>
          </div>
          <h3>${escapeHtml(post.title)}</h3>
          <p>${escapeHtml(post.summary)}</p>
          ${renderTags(post.tags, "post-index-item__tags")}
        </div>
        <span class="post-index-item__arrow" aria-hidden="true">↗</span>
      </a>
    `).join("")
    : '<p class="blog-empty">还没有公开的文章。</p>';

  return `
    <div class="blog-shell blog-index">
      <header class="blog-index__hero reveal">
        <p class="blog-kicker"><span class="square-mark"></span> AOHARU / WRITING</p>
        <h1>文章<span>WRITING &amp; NOTES</span></h1>
        <p class="blog-index__deck">写一些关于开发、设计与日常的片段。没有固定的更新频率，只留下真正想写下来的内容。</p>
        <div class="blog-index__meta">
          <span>${String(posts.length).padStart(2, "0")} POSTS</span>
          <span>持续更新中</span>
        </div>
      </header>
      <section class="blog-archive" aria-labelledby="all-posts-title">
        <header class="blog-archive__heading reveal">
          <h2 id="all-posts-title">全部文章</h2>
          <span>ALL POSTS / ${String(posts.length).padStart(2, "0")}</span>
        </header>
        <div class="post-index-list">${items}</div>
      </section>
    </div>
  `;
}

function renderPostPage(post, posts) {
  const toc = renderToc(post.headings);
  const recent = posts.filter((candidate) => candidate.slug !== post.slug).slice(0, 3);
  const recentLinks = recent.length
    ? recent.map((candidate) => `<li><a href="/blog/${candidate.slug}/"><time datetime="${isoDate(candidate.date)}">${displayDate(candidate.date)}</time><span>${escapeHtml(candidate.title)}</span></a></li>`).join("")
    : "<li><span>暂无其它文章</span></li>";
  const updatedRow = isoDate(post.updated) !== isoDate(post.date)
    ? `<div><dt>更新</dt><dd><time datetime="${isoDate(post.updated)}">${displayDate(post.updated)}</time></dd></div>`
    : "";
  const articleTags = renderTags(post.tags, "post-tags");

  return `
    <div class="blog-shell blog-post">
      <header class="post-header reveal">
        <a class="post-header__back" href="/blog/">← 返回文章列表</a>
        <p class="blog-kicker"><span class="square-mark"></span> WRITING / ${displayDate(post.date)}</p>
        <h1>${escapeHtml(post.title)}</h1>
        <p class="post-header__summary">${escapeHtml(post.summary)}</p>
        <div class="post-header__meta">
          <time datetime="${isoDate(post.date)}">${displayDate(post.date)}</time>
          <span>约 ${post.readingMinutes} 分钟阅读</span>
          <span>${post.wordCount} 字</span>
        </div>
      </header>

      <div class="post-layout">
        <aside class="post-rail post-rail--left reveal" data-delay="1">
          <section class="rail-section">
            <p class="rail-label">AOHARU / BLOG</p>
            <p class="rail-note">记录开发、设计，以及一些不想忘记的片段。</p>
            <nav class="rail-nav" aria-label="博客导航">
              <a href="/">首页 <span>↗</span></a>
              <a href="/blog/">文章归档 <span>↗</span></a>
              <a href="/#about">关于我 <span>↗</span></a>
            </nav>
          </section>
          <section class="rail-section">
            <p class="rail-label">最近文章</p>
            <ul class="rail-posts">${recentLinks}</ul>
          </section>
        </aside>

        <article class="post-content">
          <details class="mobile-toc">
            <summary>文章目录 <span>${post.headings.length} 节</span></summary>
            ${toc}
          </details>
          <div class="post-body">${post.html}</div>
          <footer class="post-footer">
            <div>
              <p class="rail-label">TAGS / 标签</p>
              ${articleTags || '<p class="post-footer__muted">无标签</p>'}
            </div>
            <a class="post-footer__back" href="/blog/">继续阅读 <span aria-hidden="true">↗</span></a>
          </footer>
        </article>

        <aside class="post-rail post-rail--right reveal" data-delay="2">
          <section class="rail-section toc-section">
            <p class="rail-label">ON THIS PAGE</p>
            <h2>目录</h2>
            ${toc}
          </section>
          <section class="rail-section post-info">
            <p class="rail-label">ARTICLE INFO</p>
            <dl>
              <div><dt>发布</dt><dd><time datetime="${isoDate(post.date)}">${displayDate(post.date)}</time></dd></div>
              ${updatedRow}
              <div><dt>阅读</dt><dd>约 ${post.readingMinutes} 分钟</dd></div>
            </dl>
            <button class="rail-action" type="button" data-copy-url>复制本文链接</button>
            <a class="rail-text-link" href="#top">回到顶部 ↑</a>
          </section>
        </aside>
      </div>
    </div>
  `;
}

function renderBlogTemplate(template, values) {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  return output;
}

async function minifyHtml(html) {
  return minify(html, {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    removeRedundantAttributes: true,
    useShortDoctype: true
  });
}

async function bundleCss(source) {
  return (await transform(source, {
    loader: "css",
    minify: true,
    legalComments: "none",
    target: ["chrome100", "firefox100", "safari15"]
  })).code;
}

async function bundleJavaScript(source) {
  const minified = await transform(source, {
    loader: "js",
    minify: true,
    legalComments: "none",
    target: ["es2020"]
  });

  const obfuscator = JavaScriptObfuscator.default || JavaScriptObfuscator;
  const obfuscated = obfuscator.obfuscate(minified.code, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: "hexadecimal",
    log: false,
    numbersToExpressions: false,
    renameGlobals: false,
    renameProperties: false,
    selfDefending: false,
    simplify: true,
    splitStrings: false,
    stringArray: true,
    stringArrayCallsTransform: false,
    stringArrayEncoding: [],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayThreshold: 0.6,
    stringArrayWrappersCount: 1,
    stringArrayWrappersType: "variable",
    target: "browser-no-eval",
    transformObjectKeys: false,
    unicodeEscapeSequence: false
  }).getObfuscatedCode();

  return (await transform(obfuscated, {
    loader: "js",
    minify: true,
    legalComments: "none",
    target: ["es2020"]
  })).code;
}

async function copyReferencedAssets(sources) {
  const combined = sources.join("\n");
  const references = new Set(
    [...combined.matchAll(/assets\/[A-Za-z0-9._/-]+/g)].map((match) => match[0])
  );

  for (const relativePath of references) {
    const sourcePath = path.join(root, relativePath);
    const destinationPath = path.join(outputDirectory, relativePath);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }

  return references.size;
}

async function build() {
  const [homeTemplate, blogTemplate, cssSource, blogCssSource, jsSource, blogJsSource] = await Promise.all([
    read("index.html"),
    read("templates/blog.html"),
    read("styles.css"),
    read("blog.css"),
    read("script.js"),
    read("blog.js")
  ]);
  const posts = await loadPosts();

  const recentStart = "<!-- RECENT_POSTS_START -->";
  const recentEnd = "<!-- RECENT_POSTS_END -->";
  if (!homeTemplate.includes(recentStart) || !homeTemplate.includes(recentEnd)) {
    throw new Error("Recent posts markers are missing from index.html");
  }

  const recentMarkup = renderRecentPosts(posts);
  const homeHtml = homeTemplate.replace(
    new RegExp(`${recentStart}[\\s\\S]*?${recentEnd}`),
    `${recentStart}${recentMarkup}${recentEnd}`
  );

  const blogIndexHtml = renderBlogTemplate(blogTemplate, {
    PAGE_TITLE: "文章 | Aoharu Reverie",
    PAGE_DESCRIPTION: "Aoharu Reverie 的文章归档，记录开发、设计与日常。",
    CANONICAL_URL: "https://aoharu.vc.ci/blog/",
    OG_TYPE: "website",
    ARTICLE_META: "",
    BODY_CLASS: "blog-index-page",
    MAIN_CONTENT: renderBlogIndex(posts),
    BLOG_SCRIPT: ""
  });

  const pages = [
    { file: "index.html", html: homeHtml },
    { file: "blog/index.html", html: blogIndexHtml }
  ];

  for (const post of posts) {
    const jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.summary,
      datePublished: isoDate(post.date),
      dateModified: isoDate(post.updated),
      url: `https://aoharu.vc.ci/blog/${post.slug}/`,
      image: "https://aoharu.vc.ci/assets/hoshino-wallpaper-3840.webp",
      author: { "@type": "Person", name: "Aoharu Reverie" }
    }).replaceAll("<", "\\u003c");

    const articleMeta = [
      `<meta property="article:published_time" content="${isoDate(post.date)}T00:00:00+08:00">`,
      `<meta property="article:modified_time" content="${isoDate(post.updated)}T00:00:00+08:00">`,
      `<script type="application/ld+json">${jsonLd}</script>`
    ].join("\n  ");

    const postHtml = renderBlogTemplate(blogTemplate, {
      PAGE_TITLE: escapeHtml(`${post.title} | Aoharu Reverie`),
      PAGE_DESCRIPTION: escapeHtml(post.summary),
      CANONICAL_URL: `https://aoharu.vc.ci/blog/${post.slug}/`,
      OG_TYPE: "article",
      ARTICLE_META: articleMeta,
      BODY_CLASS: "blog-post-page",
      MAIN_CONTENT: renderPostPage(post, posts),
      BLOG_SCRIPT: '<script src="/blog.js" defer></script>'
    });

    pages.push({ file: `blog/${post.slug}/index.html`, html: postHtml });
  }

  const [minifiedPages, css, blogCss, js, blogJs] = await Promise.all([
    Promise.all(pages.map(async (page) => ({ ...page, html: await minifyHtml(page.html) }))),
    bundleCss(cssSource),
    bundleCss(blogCssSource),
    bundleJavaScript(jsSource),
    bundleJavaScript(blogJsSource)
  ]);

  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });

  for (const page of minifiedPages) {
    const destination = path.join(outputDirectory, page.file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, page.html);
  }

  await Promise.all([
    fs.writeFile(path.join(outputDirectory, "styles.css"), css),
    fs.writeFile(path.join(outputDirectory, "blog.css"), blogCss),
    fs.writeFile(path.join(outputDirectory, "script.js"), js),
    fs.writeFile(path.join(outputDirectory, "blog.js"), blogJs)
  ]);

  const assetCount = await copyReferencedAssets([
    ...pages.map((page) => page.html),
    cssSource,
    blogCssSource
  ]);
  const totalHtmlSize = minifiedPages.reduce((total, page) => total + Buffer.byteLength(page.html), 0);

  console.log(`[build] posts ${posts.length}`);
  console.log(`[build] pages ${minifiedPages.length}`);
  console.log(`[build] HTML  ${(totalHtmlSize / 1024).toFixed(1)} KB`);
  console.log(`[build] CSS   ${formatSize(css)} + blog ${formatSize(blogCss)}`);
  console.log(`[build] JS    ${formatSize(js)} + blog ${formatSize(blogJs)}`);
  console.log(`[build] assets ${assetCount} files`);
  console.log(`[build] output ${path.relative(root, outputDirectory)}/`);
}

build().catch((error) => {
  console.error("[build] failed:", error);
  process.exitCode = 1;
});

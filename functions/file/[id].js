const BASE = "https://pan.moe";
const API = `${BASE}/api/v3`;
const REQUEST_TIMEOUT = 15000;

class PanMoeError extends Error {
  constructor(status) {
    super(String(status));
    this.name = "PanMoeError";
    this.status = status;
  }
}

const normalizeStatus = (code) => {
  const status = Number(code);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
};

const extractKey = (input) => {
  const value = String(input || "").trim();
  const shareMatch = value.match(/\/s\/([A-Za-z0-9]+)/);
  if (shareMatch) return shareMatch[1];
  if (/^[A-Za-z0-9]{4,}$/.test(value)) return value;
  return null;
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const rememberCookies = (response, cookies) => {
  let values = [];
  if (typeof response.headers.getSetCookie === "function") {
    values = response.headers.getSetCookie();
  } else {
    const combined = response.headers.get("set-cookie");
    if (combined) values = combined.split(/,(?=\s*[^=;,\s]+=)/);
  }

  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    const cookieValue = pair.slice(separator + 1).trim();
    if (name) cookies.set(name, cookieValue);
  }
};

const requestApi = async (method, url, cookies) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; PanMoeParser/1.0)"
  });

  if (cookies.size > 0) {
    headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method === "PUT" ? "" : undefined,
      redirect: "manual",
      signal: controller.signal
    });
    rememberCookies(response, cookies);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new PanMoeError(502);
    }

    if (!payload || Number(payload.code) !== 0) {
      throw new PanMoeError(normalizeStatus(payload?.code));
    }
    return payload.data;
  } catch (error) {
    if (error instanceof PanMoeError) throw error;
    throw new PanMoeError(502);
  } finally {
    clearTimeout(timeout);
  }
};

const fetchShareInfo = async (key, password, cookies) => {
  const query = password !== "" ? `?password=${encodeURIComponent(password)}` : "";
  return requestApi("GET", `${API}/share/info/${encodeURIComponent(key)}${query}`, cookies);
};

const resolveShare = async (key, password) => {
  const cookies = new Map();
  const info = await fetchShareInfo(key, password, cookies);

  if (info && info.is_dir) throw new PanMoeError(400);

  const download = await requestApi(
    "PUT",
    `${API}/share/download/${encodeURIComponent(key)}`,
    cookies
  );

  if (typeof download !== "string" || download === "") throw new PanMoeError(502);

  let directUrl;
  try {
    directUrl = new URL(download);
  } catch {
    throw new PanMoeError(502);
  }
  if (directUrl.protocol !== "https:" && directUrl.protocol !== "http:") {
    throw new PanMoeError(502);
  }
  return directUrl.toString();
};

const formatBytes = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "未知";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let size = bytes / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[index]}`;
};

const formatDate = (value) => {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date).replaceAll("/", ".");
};

const formatNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("zh-CN") : "—";
};

const formatExpiry = (value) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds === 0) return "长期有效";
  if (seconds < 0) return "已过期";
  if (seconds >= 86400) return `剩余 ${Math.ceil(seconds / 86400)} 天`;
  if (seconds >= 3600) return `剩余 ${Math.ceil(seconds / 3600)} 小时`;
  return `剩余 ${Math.max(1, Math.ceil(seconds / 60))} 分钟`;
};

const categoryFor = (extension) => {
  const groups = {
    ARCHIVE: ["zip", "rar", "7z", "tar", "gz", "xz", "bz2"],
    VIDEO: ["mp4", "mkv", "webm", "avi", "mov", "flv", "ts"],
    AUDIO: ["mp3", "flac", "wav", "m4a", "ogg", "aac"],
    IMAGE: ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "bmp"],
    DOCUMENT: ["pdf", "doc", "docx", "txt", "md", "ppt", "pptx", "xls", "xlsx"],
    CODE: ["js", "ts", "py", "rs", "java", "go", "css", "html", "json", "yml", "yaml"],
    APP: ["apk", "exe", "dmg", "deb", "rpm", "ipa"],
    FONT: ["ttf", "otf", "woff", "woff2"]
  };
  return Object.entries(groups).find(([, extensions]) => extensions.includes(extension))?.[0] || "FILE";
};

const fileDetails = (name) => {
  const baseName = String(name || "未命名文件").split("/").pop();
  const match = baseName.match(/\.([A-Za-z0-9]{1,10})$/);
  const extension = match ? match[1].toLowerCase() : "file";
  return {
    name: baseName,
    extension: extension.toUpperCase(),
    category: categoryFor(extension)
  };
};

const page = ({ title, description, content, status = 200 }) => new Response(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#07101f">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/file.css">
</head>
<body class="file-gateway">
  <div class="site-background" aria-hidden="true">
    <div class="site-background__drift">
      <picture class="site-background__picture">
        <source media="(max-width: 760px)" srcset="/assets/hoshino-wallpaper-1280.webp">
        <source media="(max-width: 1920px)" srcset="/assets/hoshino-wallpaper-1920.webp">
        <source media="(max-width: 2560px)" srcset="/assets/hoshino-wallpaper-2560.webp">
        <img class="site-background__image" src="/assets/hoshino-wallpaper-3840.webp" alt="" fetchpriority="high">
      </picture>
    </div>
    <div class="site-background__shade"></div>
  </div>

  <div class="file-page">
    <header class="file-topbar">
      <a class="wordmark" href="/" aria-label="Aoharu Reverie，返回首页">
        <span>AOHARU</span><span>REVERIE</span>
      </a>
      <span class="file-topbar__service">FILE GATEWAY / PAN.MOE</span>
      <nav class="file-topbar__nav" aria-label="页面导航">
        <a href="/">首页</a>
        <a href="/blog/">文章</a>
        <a href="https://github.com/LGCR837/aoharureveriehome" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
      </nav>
    </header>

    ${content}

    <footer class="file-footer">
      <p>© 2026 Aoharu Reverie</p>
      <p>文件解析服务 · 内容存放于萌盘</p>
    </footer>
  </div>
</body>
</html>`, {
  status,
  headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  }
});

const errorMessages = {
  400: "分享编号无效，或该分享暂不支持直链解析。",
  401: "访问此分享需要密码，或提供的密码不正确。",
  403: "当前分享不可访问，可能已关闭或受到限制。",
  404: "分享不存在，或已经被删除。",
  410: "分享已经过期。",
  429: "请求太频繁，请稍后再试。",
  500: "萌盘暂时无法完成解析。",
  502: "无法连接萌盘，请稍后再试。"
};

const errorPage = (status, detail) => page({
  title: `${status} | Aoharu File Gateway`,
  description: "文件分享解析失败。",
  status,
  content: `<main class="file-main">
    <section class="file-error-card">
      <p class="file-kicker"><span class="square-mark"></span> RESOLVE FAILED / ${status}</p>
      <p class="file-error-code">${status}</p>
      <h1>无法打开这个分享</h1>
      <p class="file-error-copy">${escapeHtml(detail || errorMessages[status] || errorMessages[500])}</p>
      <div class="file-actions">
        <a class="file-download" href="/">返回首页 <span>↗</span></a>
        <a class="file-secondary" href="/blog/">阅读文章</a>
      </div>
    </section>
  </main>`
});

const passwordPage = (key, message = "") => page({
  title: "需要访问密码 | Aoharu File Gateway",
  description: "这个萌盘分享受密码保护。",
  content: `<main class="file-main">
    <section class="file-card file-card--locked">
      <div class="file-card__top">
        <p class="file-kicker"><span class="square-mark"></span> PROTECTED SHARE / LOCKED</p>
        <span class="file-badge">PRIVATE</span>
      </div>
      <div class="file-lock-mark" aria-hidden="true"><span></span><span></span></div>
      <h1>此分享需要访问密码</h1>
      <p class="file-lock-copy">输入分享者设置的密码后，即可查看文件信息与下载入口。</p>
      ${message ? `<p class="file-form-error" role="alert">${escapeHtml(message)}</p>` : ""}
      <form class="file-password-form" action="/file/${encodeURIComponent(key)}" method="get">
        <label for="file-password">访问密码</label>
        <div class="file-password-row">
          <input id="file-password" name="password" type="password" required autofocus autocomplete="off" spellcheck="false">
          <button type="submit">解锁文件 <span aria-hidden="true">→</span></button>
        </div>
      </form>
      <p class="file-lock-note">密码仅用于本次请求，不会存储在页面中。</p>
    </section>
    <aside class="file-aside">
      <section class="file-side-card">
        <p class="file-label">ABOUT THIS GATEWAY</p>
        <p>这是 Aoharu Reverie 提供的萌盘分享解析入口。本站不保存文件，只负责生成临时下载地址。</p>
      </section>
      <section class="file-side-card">
        <p class="file-label">SHARE KEY</p>
        <p class="file-key">${escapeHtml(key)}</p>
      </section>
    </aside>
  </main>`
});

const filePage = (key, info, password) => {
  if (!info || !info.source || !info.source.name) {
    return errorPage(502, "分享信息不完整，暂时无法展示文件详情。");
  }

  const details = fileDetails(info.source.name);
  const query = new URLSearchParams();
  if (password !== "") query.set("password", password);
  query.set("download", "true");
  const downloadHref = `/file/${encodeURIComponent(key)}?${query.toString()}`;
  const sourceHref = `${BASE}/s/${encodeURIComponent(key)}`;
  const meta = [
    ["文件大小", formatBytes(info.source.size)],
    ["文件类型", details.extension],
    ["分享时间", formatDate(info.create_date)],
    ["下载次数", `${formatNumber(info.downloads)} 次`],
    ["浏览次数", `${formatNumber(info.views)} 次`],
    ["有效期", formatExpiry(info.expire)]
  ];

  return page({
    title: `${details.name} | Aoharu File Gateway`,
    description: `下载 ${details.name}，文件由萌盘分享并通过 Aoharu Reverie 解析。`,
    content: `<main class="file-main">
      <section class="file-card">
        <div class="file-card__top">
          <p class="file-kicker"><span class="square-mark"></span> SHARE RESOLVED / READY</p>
          <span class="file-badge">${password ? "UNLOCKED" : "PUBLIC"}</span>
        </div>
        <div class="file-heading">
          <div class="file-icon" aria-hidden="true">
            <span>${escapeHtml(details.extension)}</span>
            <small>${escapeHtml(details.category)}</small>
          </div>
          <div class="file-heading__text">
            <p class="file-label">SHARED FILE / 萌盘分享</p>
            <h1>${escapeHtml(details.name)}</h1>
            <p class="file-summary">文件已经通过 PanMoe 分享接口解析，可以继续前往下载。</p>
          </div>
        </div>
        <dl class="file-meta">
          ${meta.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
        </dl>
        <div class="file-actions">
          <a class="file-download" href="${escapeHtml(downloadHref)}">下载文件 <span aria-hidden="true">↓</span></a>
          <a class="file-secondary" href="${escapeHtml(sourceHref)}" target="_blank" rel="noopener noreferrer">查看原始分享 ↗</a>
        </div>
        <div class="file-card__foot">
          <span>DIRECT LINK / TEMPORARY</span>
          <p>下载时会跳转到萌盘生成的临时直链。</p>
        </div>
      </section>
      <aside class="file-aside">
        <section class="file-side-card">
          <p class="file-label">DOWNLOAD NOTE</p>
          <p>本站不存储、不代理文件内容。下载由萌盘直接提供，链接可能随时间失效。</p>
        </section>
        <section class="file-side-card">
          <p class="file-label">SHARE KEY</p>
          <p class="file-key">${escapeHtml(info.key || key)}</p>
        </section>
        <section class="file-side-card file-side-card--accent">
          <p class="file-label">AOHARU / FILE</p>
          <p>一个安静的文件中转页。</p>
          <a href="/">回到主页 <span aria-hidden="true">↗</span></a>
        </section>
      </aside>
    </main>`
  });
};

export async function onRequest(context) {
  const request = context.request;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("405", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }

  const key = extractKey(context.params.id);
  if (!key) return errorPage(400);

  const url = new URL(request.url);
  const password = url.searchParams.get("password") || "";
  const directDownload = (url.searchParams.get("download") || "").toLowerCase() === "true";

  if (directDownload) {
    try {
      const target = await resolveShare(key, password);
      return new Response(null, {
        status: 302,
        headers: {
          Location: target,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff"
        }
      });
    } catch (error) {
      const status = error instanceof PanMoeError ? error.status : 502;
      return new Response(String(status), {
        status,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }
  }

  const cookies = new Map();
  try {
    const info = await fetchShareInfo(key, password, cookies);
    if (info?.locked) return passwordPage(key);
    if (info?.is_dir) return errorPage(400, "这是一个文件夹分享，目前仅支持解析单文件分享。");
    return filePage(key, info, password);
  } catch (error) {
    const status = error instanceof PanMoeError ? error.status : 502;
    if ((status === 401 || status === 403) && password === "") {
      return passwordPage(key);
    }
    if (status === 401 || status === 403) {
      return passwordPage(key, "密码不正确，请重新输入。");
    }
    return errorPage(status);
  }
}

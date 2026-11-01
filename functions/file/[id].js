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

const rememberCookies = (response, cookies) => {
  let values = [];
  if (typeof response.headers.getSetCookie === "function") {
    values = response.headers.getSetCookie();
  } else {
    const combined = response.headers.get("set-cookie");
    if (combined) {
      values = combined.split(/,(?=\s*[^=;,\s]+=)/);
    }
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

const textResponse = (body, status = 200) => new Response(body, {
  status,
  headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }
});

const redirectResponse = (location) => new Response(null, {
  status: 302,
  headers: {
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  }
});

const resolveShare = async (key, password) => {
  const cookies = new Map();
  const infoUrl = `${API}/share/info/${encodeURIComponent(key)}${password !== "" ? `?password=${encodeURIComponent(password)}` : ""}`;
  const info = await requestApi("GET", infoUrl, cookies);

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
  if (!key) return textResponse("400", 400);

  const password = new URL(request.url).searchParams.get("password") || "";

  try {
    const target = await resolveShare(key, password);
    return redirectResponse(target);
  } catch (error) {
    const status = error instanceof PanMoeError ? error.status : 502;
    return textResponse(String(status), status);
  }
}

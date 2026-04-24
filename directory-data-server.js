const http = require("http");
const https = require("https");
const fs = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const {
  PORT,
  PROJECT_APPS,
  directoryTarget,
  directoryProxy,
  adminAuth
} = require("./db.config");
const { createDirectoryRepository } = require("./directory-data-repository");

const repositoryPromise = createDirectoryRepository();
const DIRECTORY_TARGET_PROTOCOL = directoryTarget.protocol;
const DIRECTORY_TARGET_HOST = directoryTarget.host;
const DIRECTORY_TARGET_PORT = directoryTarget.port;
const LEGACY_DIRECTORY_TARGET_HOSTS = ["frbs.groupecat.com"];
const DIRECTORY_PROXY_PROTOCOL = directoryProxy.protocol || "http";
const DIRECTORY_PROXY_HOST = directoryProxy.host;
const DIRECTORY_PROXY_PORT = directoryProxy.port;
const DIRECTORY_PROXY_USERNAME = directoryProxy.username;
const DIRECTORY_PROXY_PASSWORD = directoryProxy.password;
const DIRECTORY_PROXY_BYPASS_HOSTS = new Set(
  [
    DIRECTORY_TARGET_HOST.toLowerCase(),
    ...LEGACY_DIRECTORY_TARGET_HOSTS,
    ...(directoryProxy.bypassHosts || [])
  ].map((host) => String(host || "").trim().toLowerCase()).filter(Boolean)
);
const HAS_DIRECTORY_PROXY = Boolean(DIRECTORY_PROXY_HOST);
const DIRECTORY_PROXY_AUTH_HEADER =
  DIRECTORY_PROXY_USERNAME || DIRECTORY_PROXY_PASSWORD
    ? `Basic ${Buffer.from(
        `${DIRECTORY_PROXY_USERNAME}:${DIRECTORY_PROXY_PASSWORD}`
      ).toString("base64")}`
    : "";
const ADMIN_USERNAME = String(adminAuth.username || "admin").trim().toLowerCase();
const ADMIN_PASSWORD = String(adminAuth.password || "");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAbsoluteUrl(value) {
  return /^(https?:)?\/\//i.test(value);
}

function isHostPath(value) {
  return /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\//i.test(value);
}

function normalizeTargetPath(value) {
  return value.replace(/^\/+/, "");
}

function isKnownDirectoryTargetHost(hostname) {
  const normalizedHostname = String(hostname || "").trim().toLowerCase();

  return (
    normalizedHostname === DIRECTORY_TARGET_HOST.toLowerCase() ||
    LEGACY_DIRECTORY_TARGET_HOSTS.includes(normalizedHostname)
  );
}

function rewriteKnownDirectoryTargetUrl(value) {
  const trimmedValue = String(value || "").trim();

  if (!trimmedValue) {
    return "";
  }

  if (isAbsoluteUrl(trimmedValue)) {
    try {
      const parsedUrl = new URL(trimmedValue);

      if (
        isKnownDirectoryTargetHost(parsedUrl.hostname) &&
        (!parsedUrl.port || parsedUrl.port === DIRECTORY_TARGET_PORT)
      ) {
        return `${buildTargetOrigin()}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
      }
    } catch (error) {
      return trimmedValue;
    }

    return trimmedValue;
  }

  if (isHostPath(trimmedValue)) {
    const [hostPart, ...pathParts] = trimmedValue.split("/");

    try {
      const parsedHost = new URL(`http://${hostPart}`);

      if (
        isKnownDirectoryTargetHost(parsedHost.hostname) &&
        (!parsedHost.port || parsedHost.port === DIRECTORY_TARGET_PORT)
      ) {
        return `${buildTargetOrigin()}/${pathParts.join("/")}`;
      }
    } catch (error) {
      return trimmedValue;
    }
  }

  return trimmedValue;
}

function normalizeStoredUrl(value) {
  const trimmedValue = rewriteKnownDirectoryTargetUrl(value);

  if (!trimmedValue) {
    return "";
  }

  if (isAbsoluteUrl(trimmedValue)) {
    try {
      const parsedUrl = new URL(trimmedValue);
      const protocol = parsedUrl.protocol.replace(/:$/, "").toLowerCase();
      const hostname = parsedUrl.hostname.toLowerCase();
      const port = String(parsedUrl.port || "");

      if (
        protocol === DIRECTORY_TARGET_PROTOCOL.toLowerCase() &&
        isKnownDirectoryTargetHost(hostname) &&
        port === DIRECTORY_TARGET_PORT
      ) {
        return normalizeTargetPath(
          `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
        );
      }
    } catch (error) {
      return trimmedValue;
    }

    return trimmedValue;
  }

  const targetHostPattern = new RegExp(
    `^(?:${[DIRECTORY_TARGET_HOST, ...LEGACY_DIRECTORY_TARGET_HOSTS]
      .map((host) => escapeRegExp(host))
      .join("|")})(?::${escapeRegExp(
      DIRECTORY_TARGET_PORT
    )})?/`,
    "i"
  );

  if (targetHostPattern.test(trimmedValue)) {
    return normalizeTargetPath(trimmedValue.replace(targetHostPattern, ""));
  }

  if (isHostPath(trimmedValue)) {
    return `${DIRECTORY_TARGET_PROTOCOL}://${trimmedValue}`;
  }

  return normalizeTargetPath(trimmedValue);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end(html);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTargetOrigin() {
  const portPart = DIRECTORY_TARGET_PORT ? `:${DIRECTORY_TARGET_PORT}` : "";
  return `${DIRECTORY_TARGET_PROTOCOL}://${DIRECTORY_TARGET_HOST}${portPart}`;
}

function getProxyOrigin() {
  const portPart = DIRECTORY_PROXY_PORT ? `:${DIRECTORY_PROXY_PORT}` : "";
  return `${DIRECTORY_PROXY_PROTOCOL}://${DIRECTORY_PROXY_HOST}${portPart}`;
}

function buildPreviewProxyUrl(targetUrl, context = "") {
  const params = new URLSearchParams({
    url: targetUrl
  });

  if (String(context || "").trim()) {
    params.set("context", String(context).trim());
  }

  return `/api/directory-preview?${params.toString()}`;
}

function shouldRewriteResourceUrl(value) {
  const trimmedValue = String(value || "").trim();

  if (!trimmedValue) {
    return false;
  }

  return !/^(#|mailto:|tel:|javascript:|data:)/i.test(trimmedValue);
}

function rewriteHtmlResourceLinks(html, targetUrl, context = "") {
  const htmlWithoutBaseTag = html.replace(/<base\b[^>]*>/gi, "");

  return htmlWithoutBaseTag.replace(
    /\b(href|src|action)=("([^"]*)"|'([^']*)')/gi,
    (fullMatch, attributeName, quotedValue, doubleQuotedValue, singleQuotedValue) => {
      const rawValue =
        doubleQuotedValue !== undefined ? doubleQuotedValue : singleQuotedValue;

      if (!shouldRewriteResourceUrl(rawValue)) {
        return fullMatch;
      }

      try {
        const resolvedUrl = new URL(rawValue, targetUrl).toString();
        const rewrittenValue = escapeHtml(
          buildPreviewProxyUrl(resolvedUrl, context)
        );
        const quote = doubleQuotedValue !== undefined ? '"' : "'";

        return `${attributeName}=${quote}${rewrittenValue}${quote}`;
      } catch (error) {
        return fullMatch;
      }
    }
  );
}

function getRequestClient(protocol) {
  return protocol === "https" || protocol === "https:" ? https : http;
}

function shouldBypassProxy(targetUrl) {
  try {
    const parsedTargetUrl = new URL(targetUrl);
    return DIRECTORY_PROXY_BYPASS_HOSTS.has(parsedTargetUrl.hostname.toLowerCase());
  } catch (error) {
    return false;
  }
}

function createRemoteRequest(targetUrl) {
  const parsedTargetUrl = new URL(targetUrl);
  const commonHeaders = {
    Accept: "*/*",
    "Accept-Encoding": "identity",
    "User-Agent": "APF Directory Proxy/1.0",
    Host: parsedTargetUrl.host
  };

  if (
    HAS_DIRECTORY_PROXY &&
    parsedTargetUrl.protocol === "http:" &&
    !shouldBypassProxy(targetUrl)
  ) {
    const proxyHeaders = {
      ...commonHeaders
    };

    if (DIRECTORY_PROXY_AUTH_HEADER) {
      proxyHeaders["Proxy-Authorization"] = DIRECTORY_PROXY_AUTH_HEADER;
    }

    return {
      client: getRequestClient(DIRECTORY_PROXY_PROTOCOL),
      options: {
        host: DIRECTORY_PROXY_HOST,
        port:
          Number(DIRECTORY_PROXY_PORT) ||
          (DIRECTORY_PROXY_PROTOCOL === "https" ? 443 : 80),
        method: "GET",
        path: targetUrl,
        headers: proxyHeaders
      }
    };
  }

  return {
    client: getRequestClient(parsedTargetUrl.protocol),
    options: {
      host: parsedTargetUrl.hostname,
      port:
        Number(parsedTargetUrl.port) ||
        (parsedTargetUrl.protocol === "https:" ? 443 : 80),
      method: "GET",
      path: `${parsedTargetUrl.pathname}${parsedTargetUrl.search}`,
      headers: commonHeaders
    }
  };
}

function readRemoteBody(remoteResponse) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    remoteResponse.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    remoteResponse.on("end", () => resolve(Buffer.concat(chunks)));
    remoteResponse.on("error", reject);
  });
}

function decodeRemoteBody(body, contentEncoding) {
  const normalizedEncoding = String(contentEncoding || "").toLowerCase();

  if (!normalizedEncoding || normalizedEncoding === "identity") {
    return body;
  }

  if (normalizedEncoding.includes("gzip")) {
    return zlib.gunzipSync(body);
  }

  if (normalizedEncoding.includes("deflate")) {
    return zlib.inflateSync(body);
  }

  if (normalizedEncoding.includes("br")) {
    return zlib.brotliDecompressSync(body);
  }

  return body;
}

function resolveDirectoryPreviewUrl(value) {
  const trimmedValue = rewriteKnownDirectoryTargetUrl(value);

  if (!trimmedValue) {
    return "";
  }

  if (isAbsoluteUrl(trimmedValue)) {
    return trimmedValue;
  }

  if (isHostPath(trimmedValue)) {
    return `http://${trimmedValue}`;
  }

  return `${buildTargetOrigin()}/${normalizeTargetPath(trimmedValue)}`;
}

function requestRemoteResource(targetUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const { client, options } = createRemoteRequest(targetUrl);
    const request = client.request(options, async (remoteResponse) => {
      const statusCode = Number(remoteResponse.statusCode || 0);

      if (
        statusCode >= 300 &&
        statusCode < 400 &&
        remoteResponse.headers.location
      ) {
        if (redirectCount >= 5) {
          reject(new Error("Too many redirects while loading the directory preview."));
          remoteResponse.resume();
          return;
        }

        const redirectedUrl = new URL(
          remoteResponse.headers.location,
          targetUrl
        ).toString();

        remoteResponse.resume();
        resolve(requestRemoteResource(redirectedUrl, redirectCount + 1));
        return;
      }

      try {
        const body = await readRemoteBody(remoteResponse);
        resolve({
          body,
          headers: remoteResponse.headers,
          statusCode,
          finalUrl: targetUrl
        });
      } catch (error) {
        reject(error);
      }
    });

    request.setTimeout(20000, () => {
      request.destroy(new Error("Remote request timed out."));
    });
    request.on("error", reject);
    request.end();
  });
}

function isHtmlLikeResponse(headers, targetUrl) {
  const contentType = String(headers["content-type"] || "").toLowerCase();

  if (contentType.includes("text/html")) {
    return true;
  }

  try {
    const parsedUrl = new URL(targetUrl);
    return parsedUrl.pathname.endsWith("/") || /\.html?$/i.test(parsedUrl.pathname);
  } catch (error) {
    return false;
  }
}

function highlightDirectoryHtml(html, highlightValue) {
  const normalizedHighlight = String(highlightValue || "").trim();

  if (!normalizedHighlight) {
    return {
      html,
      matchCount: 0
    };
  }

  const highlightRegex = new RegExp(escapeRegExp(normalizedHighlight), "ig");
  let matchCount = 0;

  const nextHtml = html.replace(/<tr>([\s\S]*?)<\/tr>/gi, (rowHtml) => {
    if (!/<td/i.test(rowHtml) || /Parent Directory/i.test(rowHtml)) {
      return rowHtml;
    }

    let rowMatched = false;
    const highlightedRow = rowHtml.replace(
      /(<a\b[^>]*>)([\s\S]*?)(<\/a>)/gi,
      (fullMatch, openTag, innerHtml, closeTag) => {
        const plainText = innerHtml.replace(/<[^>]+>/g, "");

        if (!plainText.toLowerCase().includes(normalizedHighlight.toLowerCase())) {
          return fullMatch;
        }

        rowMatched = true;
        matchCount += 1;

        return `${openTag}${innerHtml.replace(
          highlightRegex,
          (matchedText) =>
            `<mark class="apf-file-highlight">${matchedText}</mark>`
        )}${closeTag}`;
      }
    );

    if (!rowMatched) {
      return highlightedRow;
    }

    return highlightedRow.replace("<tr>", '<tr class="apf-file-match">');
  });

  return {
    html: nextHtml,
    matchCount
  };
}

function buildDirectoryPreviewDocument(remoteHtml, targetUrl, highlightValue, context = "") {
  const rewrittenHtml = rewriteHtmlResourceLinks(remoteHtml, targetUrl, context);
  const { html: highlightedHtml, matchCount } = highlightDirectoryHtml(
    rewrittenHtml,
    highlightValue
  );
  const escapedHighlight = escapeHtml(highlightValue);
  const navigationPayload = JSON.stringify({
    type: "apf-directory-location",
    remoteUrl: targetUrl,
    context
  });
  const searchBanner = String(highlightValue || "").trim()
    ? matchCount > 0
      ? `<div class="apf-search-banner">Highlighted ${matchCount} matching file${matchCount === 1 ? "" : "s"} for "<strong>${escapedHighlight}</strong>".</div>`
      : `<div class="apf-search-banner apf-search-banner-empty">No file matched "<strong>${escapedHighlight}</strong>".</div>`
    : "";
  const injectedHead = `
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
  }

  body {
    padding: 12px 14px 18px;
    color: #0d2238;
  }

  table {
    width: 100%;
  }

  .apf-search-banner {
    margin: 0 0 12px;
    padding: 10px 12px;
    border-radius: 10px;
    background: #e8f3ff;
    border: 1px solid rgba(12, 91, 151, 0.16);
    color: #0b4f86;
    font: 700 14px/1.4 Aptos, "Segoe UI", sans-serif;
  }

  .apf-search-banner-empty {
    background: #fff4dc;
    color: #7a4d00;
    border-color: rgba(122, 77, 0, 0.18);
  }

  .apf-file-match td,
  .apf-file-match th {
    background: #fff7bf;
  }

  .apf-file-highlight {
    background: #ffd84d;
    color: #15263d;
    padding: 0 2px;
    border-radius: 4px;
  }
<\/style>
<script>
  window.addEventListener("DOMContentLoaded", function () {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(${navigationPayload}, "*");
    }

    var firstMatch = document.querySelector(".apf-file-match");

    if (firstMatch) {
      firstMatch.scrollIntoView({ block: "center" });
    }
  });
<\/script>`;

  let documentHtml = highlightedHtml;

  if (/<head[^>]*>/i.test(documentHtml)) {
    documentHtml = documentHtml.replace(
      /<head[^>]*>/i,
      (match) => `${match}${injectedHead}`
    );
  } else {
    documentHtml = `${injectedHead}${documentHtml}`;
  }

  if (searchBanner && /<body[^>]*>/i.test(documentHtml)) {
    documentHtml = documentHtml.replace(
      /<body[^>]*>/i,
      (match) => `${match}${searchBanner}`
    );
  } else if (searchBanner) {
    documentHtml = `${searchBanner}${documentHtml}`;
  }

  return documentHtml;
}

function sendRemoteResponse(response, remoteResource) {
  const responseHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Length": String(remoteResource.body.length)
  };
  const passthroughHeaderNames = [
    "content-disposition",
    "content-language",
    "content-type",
    "cache-control",
    "etag",
    "last-modified"
  ];

  passthroughHeaderNames.forEach((headerName) => {
    const headerValue = remoteResource.headers[headerName];

    if (headerValue) {
      responseHeaders[headerName] = headerValue;
    }
  });

  response.writeHead(remoteResource.statusCode || 200, responseHeaders);
  response.end(remoteResource.body);
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }

  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }

  if (extension === ".js") {
    return "application/javascript; charset=utf-8";
  }

  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }

  return "text/plain; charset=utf-8";
}

async function serveProjectApp(response, projectId, requestPath) {
  const projectRoot = PROJECT_APPS[projectId];

  if (!projectRoot) {
    sendJson(response, 404, { error: "Project not found" });
    return;
  }

  const relativePath = requestPath
    .replace(`/apps/${projectId}`, "")
    .replace(/^\/+/, "");
  const safeRelativePath = relativePath || "index.html";
  const targetFile = path.resolve(projectRoot, safeRelativePath);
  const resolvedRoot = path.resolve(projectRoot);

  if (!targetFile.startsWith(resolvedRoot)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const fileContent = await fs.readFile(targetFile);
    response.writeHead(200, {
      "Content-Type": getContentType(targetFile)
    });
    response.end(fileContent);
  } catch (error) {
    sendJson(response, 404, { error: "File not found" });
  }
}

function sanitizeEntry(entry, index) {
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).slice(2, 8);

  return {
    id:
      typeof entry?.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : `custom-${timestamp}-${index}-${randomPart}`,
    bu: String(entry?.bu || "").trim().toLowerCase(),
    type: String(entry?.type || "").trim(),
    label: String(entry?.label || "").trim(),
    url: normalizeStoredUrl(entry?.url),
    backup: String(entry?.backup || "").trim()
  };
}

function sanitizePayload(payload) {
  const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
  const entries = rawEntries
    .map((entry, index) => sanitizeEntry(entry, index))
    .filter((entry) => entry.bu && entry.type && entry.label && entry.url);

  return {
    generatedAt: new Date().toISOString(),
    entries
  };
}

async function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > 5 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function isValidAdminLogin(username, password) {
  return (
    String(username || "").trim().toLowerCase() === ADMIN_USERNAME &&
    String(password || "") === ADMIN_PASSWORD
  );
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const requestUrl = new URL(request.url, `http://localhost:${PORT}`);
  const requestPath = requestUrl.pathname;

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    response.end();
    return;
  }

  if (requestPath === "/api/health" && request.method === "GET") {
    try {
      const repository = await repositoryPromise;
      const health = await repository.getHealth();
      sendJson(response, 200, health);
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: "Directory repository is not ready."
      });
    }
    return;
  }

  if (requestPath === "/api/auth/login" && request.method === "POST") {
    try {
      const body = await readRequestBody(request);
      const parsedBody = body ? JSON.parse(body) : {};
      const username = String(parsedBody.username || "").trim();
      const password = String(parsedBody.password || "");

      if (!isValidAdminLogin(username, password)) {
        sendJson(response, 401, { ok: false, error: "Invalid admin credentials." });
        return;
      }

      sendJson(response, 200, {
        ok: true,
        role: "admin",
        username: ADMIN_USERNAME
      });
    } catch (error) {
      console.error("POST /api/auth/login failed", error);
      sendJson(response, 400, { ok: false, error: "Unable to process admin login." });
    }
    return;
  }

  if (requestPath === "/apps/documentation" && request.method === "GET") {
    response.writeHead(302, { Location: "/apps/documentation/" });
    response.end();
    return;
  }

  if (requestPath === "/apps/sftp" && request.method === "GET") {
    response.writeHead(302, { Location: "/apps/sftp/" });
    response.end();
    return;
  }

  if (requestPath === "/apps/certificate" && request.method === "GET") {
    response.writeHead(302, { Location: "/apps/certificate/" });
    response.end();
    return;
  }

  if (requestPath.startsWith("/apps/documentation/") && request.method === "GET") {
    await serveProjectApp(response, "documentation", requestPath);
    return;
  }

  if (requestPath.startsWith("/apps/sftp/") && request.method === "GET") {
    await serveProjectApp(response, "sftp", requestPath);
    return;
  }

  if (requestPath.startsWith("/apps/certificate/") && request.method === "GET") {
    await serveProjectApp(response, "certificate", requestPath);
    return;
  }

  if (requestPath === "/api/directory-data" && request.method === "GET") {
    try {
      const repository = await repositoryPromise;
      const payload = await repository.readData();
      sendJson(response, 200, payload);
    } catch (error) {
      console.error("GET /api/directory-data failed", error);
      sendJson(response, 500, { error: "Unable to read directory data." });
    }
    return;
  }

  if (requestPath === "/api/directory-data" && request.method === "POST") {
    try {
      const body = await readRequestBody(request);
      const parsedBody = body ? JSON.parse(body) : {};
      const nextPayload = sanitizePayload(parsedBody);
      const repository = await repositoryPromise;
      const savedPayload = await repository.writeData(nextPayload.entries);
      sendJson(response, 200, savedPayload);
    } catch (error) {
      console.error("POST /api/directory-data failed", error);
      sendJson(response, 400, { error: "Unable to save directory data." });
    }
    return;
  }

  if (requestPath === "/api/directory-preview" && request.method === "GET") {
    const targetUrl = resolveDirectoryPreviewUrl(requestUrl.searchParams.get("url"));
    const highlightValue = String(requestUrl.searchParams.get("highlight") || "").trim();
    const previewContext = String(requestUrl.searchParams.get("context") || "").trim();

    if (!targetUrl) {
      sendHtml(
        response,
        400,
        "<!DOCTYPE html><html><body><p>Missing directory preview URL.</p></body></html>"
      );
      return;
    }

    try {
      const remoteResource = await requestRemoteResource(targetUrl);
      const decodedBody = decodeRemoteBody(
        remoteResource.body,
        remoteResource.headers["content-encoding"]
      );

      if (!isHtmlLikeResponse(remoteResource.headers, remoteResource.finalUrl)) {
        sendRemoteResponse(response, {
          ...remoteResource,
          body: decodedBody
        });
        return;
      }

      const previewDocument = buildDirectoryPreviewDocument(
        decodedBody.toString("utf8"),
        remoteResource.finalUrl,
        highlightValue,
        previewContext
      );
      sendHtml(response, remoteResource.statusCode || 200, previewDocument);
    } catch (error) {
      console.error("GET /api/directory-preview failed", error);
      sendHtml(
        response,
        502,
        `<!DOCTYPE html><html><body><p>Unable to load the directory preview.</p><p>${escapeHtml(
          error.message
        )}</p></body></html>`
      );
    }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Directory data API listening on http://localhost:${PORT}`);
  console.log(
    `Directory target: ${DIRECTORY_TARGET_PROTOCOL}://${DIRECTORY_TARGET_HOST}:${DIRECTORY_TARGET_PORT}`
  );
  if (HAS_DIRECTORY_PROXY) {
    console.log(`Directory proxy: ${getProxyOrigin()}`);
  }
  repositoryPromise
    .then((repository) => repository.getHealth())
    .then((health) => {
      console.log(
        `Directory data source: ${health.source} (${health.activeClient})`
      );
      if (health.note) {
        console.log(`Directory data note: ${health.note}`);
      }
    })
    .catch((error) => {
      console.error("Unable to resolve directory repository health", error);
    });
});

server.on("close", () => {
  repositoryPromise
    .then((repository) => repository.close())
    .catch(() => {});
});

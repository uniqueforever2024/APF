const http = require("http");
const https = require("https");
const fs = require("fs/promises");
const path = require("path");
const {
  PORT,
  PROJECT_APPS,
  directoryTarget
} = require("./db.config");
const { createDirectoryRepository } = require("./directory-data-repository");

const repositoryPromise = createDirectoryRepository();
const DIRECTORY_TARGET_PROTOCOL = directoryTarget.protocol;
const DIRECTORY_TARGET_HOST = directoryTarget.host;
const DIRECTORY_TARGET_PORT = directoryTarget.port;

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

function normalizeStoredUrl(value) {
  const trimmedValue = String(value || "").trim();

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
        hostname === DIRECTORY_TARGET_HOST.toLowerCase() &&
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
    `^${escapeRegExp(DIRECTORY_TARGET_HOST)}(?::${escapeRegExp(
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

function resolveDirectoryPreviewUrl(value) {
  const trimmedValue = String(value || "").trim();

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

function fetchRemoteText(targetUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const client = targetUrl.startsWith("https:") ? https : http;
    const request = client.get(targetUrl, (remoteResponse) => {
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
        resolve(fetchRemoteText(redirectedUrl, redirectCount + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        reject(
          new Error(`Remote request failed with status ${statusCode || "unknown"}.`)
        );
        remoteResponse.resume();
        return;
      }

      let body = "";
      remoteResponse.setEncoding("utf8");
      remoteResponse.on("data", (chunk) => {
        body += chunk;
      });
      remoteResponse.on("end", () => {
        resolve({
          body,
          finalUrl: targetUrl
        });
      });
    });

    request.setTimeout(15000, () => {
      request.destroy(new Error("Remote request timed out."));
    });
    request.on("error", reject);
  });
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

function buildDirectoryPreviewDocument(remoteHtml, targetUrl, highlightValue) {
  const { html: highlightedHtml, matchCount } = highlightDirectoryHtml(
    remoteHtml,
    highlightValue
  );
  const escapedTargetUrl = escapeHtml(targetUrl);
  const escapedHighlight = escapeHtml(highlightValue);
  const searchBanner = String(highlightValue || "").trim()
    ? matchCount > 0
      ? `<div class="apf-search-banner">Highlighted ${matchCount} matching file${matchCount === 1 ? "" : "s"} for "<strong>${escapedHighlight}</strong>".</div>`
      : `<div class="apf-search-banner apf-search-banner-empty">No file matched "<strong>${escapedHighlight}</strong>".</div>`
    : "";
  const injectedHead = `
<base href="${escapedTargetUrl}">
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

    if (!targetUrl) {
      sendHtml(
        response,
        400,
        "<!DOCTYPE html><html><body><p>Missing directory preview URL.</p></body></html>"
      );
      return;
    }

    try {
      const { body, finalUrl } = await fetchRemoteText(targetUrl);
      const previewDocument = buildDirectoryPreviewDocument(
        body,
        finalUrl,
        highlightValue
      );
      sendHtml(response, 200, previewDocument);
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

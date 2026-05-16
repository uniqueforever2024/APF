const http = require("http");
const https = require("https");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const {
  PORT,
  PROJECT_APPS,
  BUSINESS_UNITS_FILE,
  directoryTarget,
  directoryProxy,
  adminAuth,
  archiveServer
} = require("./db.config");
const { createDirectoryRepository } = require("./directory-data-repository");
const { createArchiveService } = require("./archive-service");

const repositoryPromise = createDirectoryRepository();
const archiveService = createArchiveService(archiveServer);
const DIRECTORY_TARGET_PROTOCOL = directoryTarget.protocol;
const DIRECTORY_TARGET_HOST = directoryTarget.host;
const DIRECTORY_TARGET_PORT = directoryTarget.port;
const LEGACY_DIRECTORY_TARGET_HOSTS = ["frbs.groupecat.com"];
const DIRECTORY_PROXY_PROTOCOL = directoryProxy.protocol || "http";
const DIRECTORY_PROXY_HOST = directoryProxy.host;
const DIRECTORY_PROXY_PORT = directoryProxy.port;
const DIRECTORY_PROXY_USERNAME = directoryProxy.username;
const DIRECTORY_PROXY_PASSWORD = directoryProxy.password;
const GROUPECAT_LOGO_DATA_URI = (() => {
  try {
    const logoPath = path.join(__dirname, "public", "groupecatlogo.png");
    const logoBuffer = fsSync.readFileSync(logoPath);
    return `data:image/png;base64,${logoBuffer.toString("base64")}`;
  } catch (error) {
    return "";
  }
})();
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
const ADMIN_USERNAME = String(adminAuth.username || "").trim().toLowerCase();
const ADMIN_PASSWORD = String(adminAuth.password || "");
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const adminSessions = new Map();
const MAX_INLINE_PREVIEW_BYTES = 64 * 1024;
const MAX_ARCHIVE_OPEN_BYTES = 12 * 1024 * 1024;
const CORS_ALLOW_HEADERS = "Content-Type, X-Admin-Token";

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
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Cache-Control": "no-store, max-age=0, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
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

function buildDownloadProxyUrl(targetUrl) {
  return targetUrl;
}

function getArchiveOpenContentType(fileName) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  const contentTypes = {
    ".csv": "text/csv; charset=utf-8",
    ".edi": "text/plain; charset=utf-8",
    ".err": "text/plain; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json; charset=utf-8",
    ".log": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8"
  };

  return contentTypes[extension] || "application/octet-stream";
}

function isInlineBrowserType(contentType) {
  return /^image\//i.test(contentType) || /^application\/pdf/i.test(contentType);
}

function formatBytes(value) {
  const size = Number(value) || 0;

  if (!size) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const normalizedValue = size / 1024 ** index;

  return `${normalizedValue >= 10 || index === 0 ? normalizedValue.toFixed(0) : normalizedValue.toFixed(1)} ${units[index]}`;
}

function buildArchiveViewerDocument({
  downloadUrl,
  entry,
  fileName,
  notice = "",
  copyText = "",
  relativePath,
  size,
  modifiedAt,
  theme = "dark",
  title,
  contentHtml
}) {
  const normalizedTheme = getNormalizedTheme(theme);
  const hasCopyContent = String(copyText || "").length > 0;
  const brandLogoHtml = GROUPECAT_LOGO_DATA_URI
    ? `<img class="viewer-brand-logo" src="${GROUPECAT_LOGO_DATA_URI}" alt="Groupecat" />`
    : `<span class="viewer-brand-fallback" aria-hidden="true">G</span>`;
  const enhancedContentHtml = hasCopyContent
    ? String(contentHtml || "").replace(
        /<pre(\b[^>]*)>/i,
        '<pre id="viewer-text-content"$1 spellcheck="false"></pre>'
      )
    : contentHtml;
  const metaHtml = `
    <div class="viewer-detail viewer-detail-file">
      <span class="viewer-detail-label">File</span>
      <strong class="viewer-detail-value viewer-detail-title">${escapeHtml(title)}</strong>
    </div>
    <div class="viewer-detail">
      <span class="viewer-detail-label">Partner</span>
      <span class="viewer-detail-value">${escapeHtml(entry?.label || "Unknown partner")}</span>
    </div>
    <div class="viewer-detail">
      <span class="viewer-detail-label">Size</span>
      <span class="viewer-detail-value">${escapeHtml(formatBytes(size))}</span>
    </div>
    <div class="viewer-detail">
      <span class="viewer-detail-label">Updated</span>
      <span class="viewer-detail-value">${escapeHtml(modifiedAt || "Not available")}</span>
    </div>
  `;
  const copyPayload = JSON.stringify(String(copyText || "")).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        --bg: #08111c;
        --surface: rgba(12, 20, 33, 0.92);
        --surface-soft: rgba(255, 255, 255, 0.04);
        --line: rgba(148, 163, 184, 0.18);
        --text: #edf2ff;
        --text-soft: #afbdd3;
        --accent: #6ee7ff;
        --accent-soft: rgba(110, 231, 255, 0.12);
        --shadow: 0 30px 90px rgba(2, 6, 23, 0.36);
      }

      body[data-theme="light"] {
        --bg: #eff4fb;
        --surface: rgba(255, 255, 255, 0.96);
        --surface-soft: rgba(15, 23, 42, 0.04);
        --line: rgba(71, 85, 105, 0.14);
        --text: #0f172a;
        --text-soft: #475569;
        --shadow: 0 26px 60px rgba(15, 23, 42, 0.1);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        min-height: 100%;
        margin: 0;
      }

      body {
        padding: 18px;
        color: var(--text);
        font: 500 14px/1.55 "IBM Plex Sans", "Segoe UI", Aptos, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(110, 231, 255, 0.16), transparent 26%),
          linear-gradient(180deg, #050b14 0%, var(--bg) 44%, #06101a 100%);
      }

      .viewer-shell {
        min-height: calc(100vh - 36px);
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        gap: 12px;
      }

      .viewer-nav,
      .viewer-header,
      .viewer-content {
        border: 1px solid var(--line);
        border-radius: 20px;
        background: var(--surface);
        box-shadow: var(--shadow);
      }

      .viewer-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 16px;
      }

      .viewer-brand {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .viewer-brand-logo {
        width: auto;
        height: 28px;
        display: block;
        flex-shrink: 0;
      }

      .viewer-brand-fallback {
        width: 2rem;
        height: 2rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        background: linear-gradient(135deg, var(--accent), #14b8d4);
        color: #04111c;
        font-size: 1rem;
        font-weight: 900;
        flex-shrink: 0;
      }

      .viewer-brand-copy {
        min-width: 0;
        display: grid;
        gap: 2px;
      }

      .viewer-brand-label {
        color: var(--text-soft);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .viewer-brand-copy strong {
        font-size: 1.02rem;
        line-height: 1.2;
      }

      .viewer-nav-chip {
        min-height: 38px;
        display: inline-flex;
        align-items: center;
        padding: 0 12px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--surface-soft);
        color: var(--text-soft);
        font-size: 0.82rem;
        font-weight: 700;
        white-space: nowrap;
      }

      .viewer-header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: stretch;
        gap: 12px;
        padding: 14px 16px;
      }

      .viewer-details {
        display: grid;
        grid-template-columns:
          minmax(220px, 1.15fr)
          minmax(150px, 0.85fr)
          minmax(110px, 0.6fr)
          minmax(190px, 0.95fr);
        gap: 10px;
        min-width: 0;
      }

      .viewer-detail {
        display: grid;
        gap: 6px;
        min-width: 0;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 13px;
        background: var(--surface-soft);
        overflow: hidden;
      }

      .viewer-detail-label {
        color: var(--text-soft);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .viewer-detail-value,
      .viewer-notice {
        margin: 0;
        color: var(--text);
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
        white-space: normal;
      }

      .viewer-detail-title {
        font-size: 1rem;
        line-height: 1.28;
      }

      .viewer-actions {
        display: flex;
        flex-direction: column;
        gap: 10px;
        justify-content: center;
        align-self: stretch;
      }

      .viewer-action {
        min-height: 42px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 15px;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
        white-space: nowrap;
        min-width: 148px;
      }

      .viewer-action svg {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }

      .viewer-action svg path,
      .viewer-action svg rect {
        fill: none;
        stroke: currentColor;
        stroke-width: 1.7;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .viewer-action-primary {
        border-color: transparent;
        background: linear-gradient(135deg, var(--accent), #14b8d4);
        color: #04111c;
        font-weight: 800;
      }

      .viewer-action-secondary {
        background: var(--surface-soft);
      }

      .viewer-content {
        min-height: 0;
        padding: 14px 16px;
        overflow: auto;
      }

      .viewer-toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }

      .viewer-search-shell {
        flex: 1 1 320px;
        min-width: min(320px, 100%);
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        padding: 0 14px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--surface-soft);
      }

      .viewer-search-shell svg {
        width: 15px;
        height: 15px;
        color: var(--text-soft);
        flex-shrink: 0;
      }

      .viewer-search-shell input {
        width: 100%;
        min-width: 0;
        border: 0;
        outline: none;
        padding: 0;
        background: transparent;
        color: var(--text);
        font: inherit;
      }

      .viewer-search-shell input::placeholder {
        color: var(--text-soft);
      }

      .viewer-search-button {
        min-width: 44px;
        padding: 0 12px;
      }

      .viewer-search-status {
        min-height: 42px;
        display: inline-flex;
        align-items: center;
        padding: 0 12px;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: var(--surface-soft);
        color: var(--text-soft);
        font-size: 0.84rem;
        white-space: nowrap;
      }

      .viewer-search-status.empty {
        color: var(--text-soft);
      }

      .viewer-search-status.match {
        color: var(--accent);
      }

      .viewer-search-status.error {
        color: #fca5a5;
      }

      .viewer-content pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font: 500 13px/1.65 "Cascadia Code", Consolas, "Courier New", monospace;
      }

      .viewer-content mark {
        padding: 0;
        border-radius: 3px;
        background: rgba(110, 231, 255, 0.28);
        color: inherit;
      }

      ::highlight(viewer-search-match) {
        background: rgba(110, 231, 255, 0.28);
        color: inherit;
      }

      .viewer-notice {
        margin-bottom: 14px;
        padding: 12px 14px;
        border-radius: 12px;
        background: var(--accent-soft);
      }

      @media (max-width: 820px) {
        body {
          padding: 12px;
        }

        .viewer-shell {
          min-height: calc(100vh - 24px);
        }

        .viewer-nav,
        .viewer-header {
          flex-direction: column;
          align-items: flex-start;
        }

        .viewer-header {
          grid-template-columns: 1fr;
        }

        .viewer-nav-chip {
          white-space: normal;
        }

        .viewer-actions {
          flex-direction: row;
          flex-wrap: wrap;
          justify-content: flex-start;
          align-self: start;
        }

        .viewer-action {
          min-width: 0;
        }

        .viewer-search-shell {
          flex-basis: 100%;
          min-width: 0;
        }
      }

      @media (max-width: 1280px) {
        .viewer-details {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 640px) {
        .viewer-details {
          grid-template-columns: 1fr;
        }

        .viewer-action {
          width: 100%;
        }
      }
    </style>
  </head>
  <body data-theme="${escapeHtml(normalizedTheme)}">
    <div class="viewer-shell">
      <nav class="viewer-nav" aria-label="Archive viewer header">
        <div class="viewer-brand">
          ${brandLogoHtml}
          <div class="viewer-brand-copy">
            <span class="viewer-brand-label">Groupecat</span>
            <strong>Archive File Viewer</strong>
          </div>
        </div>
        <div class="viewer-nav-chip">${escapeHtml(entry?.label || "Archive viewer")}</div>
      </nav>
      <header class="viewer-header">
        <div class="viewer-details">
          ${metaHtml}
        </div>
        <div class="viewer-actions">
          ${hasCopyContent ? `
            <button class="viewer-action viewer-action-secondary" type="button" id="viewer-copy-button" aria-label="Copy file content to clipboard">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect x="9" y="9" width="10" height="10" rx="2"></rect>
                <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span data-copy-label>Copy to clipboard</span>
            </button>
          ` : ""}
          <a class="viewer-action viewer-action-primary" href="${escapeHtml(downloadUrl)}">Download</a>
        </div>
      </header>
      <section class="viewer-content">
        ${hasCopyContent ? `
          <div class="viewer-toolbar">
            <label class="viewer-search-shell" for="viewer-search-input">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="11" cy="11" r="6.5"></circle>
                <path d="m16 16 4 4"></path>
              </svg>
              <input
                id="viewer-search-input"
                type="search"
                autocomplete="off"
                spellcheck="false"
                placeholder="Search in file"
              />
            </label>
            <button class="viewer-action viewer-action-secondary viewer-search-button" type="button" id="viewer-search-previous" aria-label="Find previous match">
              Prev
            </button>
            <button class="viewer-action viewer-action-secondary viewer-search-button" type="button" id="viewer-search-next" aria-label="Find next match">
              Next
            </button>
            <div class="viewer-search-status empty" id="viewer-search-status">Type to search</div>
          </div>
        ` : ""}
        ${notice ? `<div class="viewer-notice">${escapeHtml(notice)}</div>` : ""}
        ${enhancedContentHtml}
      </section>
    </div>
    <script>
      (function () {
        var copyButton = document.getElementById("viewer-copy-button");
        var copyValue = ${copyPayload};
        var copyButtonLabel = copyButton ? copyButton.querySelector("[data-copy-label]") : null;
        var idleLabel = "Copy to clipboard";
        var successLabel = "Copied";
        var errorLabel = "Copy failed";
        var resetTimer = null;
        var searchInput = document.getElementById("viewer-search-input");
        var searchPreviousButton = document.getElementById("viewer-search-previous");
        var searchNextButton = document.getElementById("viewer-search-next");
        var searchStatus = document.getElementById("viewer-search-status");
        var viewerContent = document.querySelector(".viewer-content");
        var textContentElement = document.getElementById("viewer-text-content");
        var rawText = String(copyValue || "");
        var rawTextLower = rawText.toLowerCase();
        var activeQuery = "";
        var activeMatchIndex = -1;
        var searchDebounceTimer = null;
        var activeSearchRange = null;
        var canUseCustomHighlights = Boolean(
          window.CSS &&
            CSS.highlights &&
            typeof window.Highlight === "function" &&
            textContentElement
        );

        if (textContentElement) {
          textContentElement.textContent = rawText;
        }

        function escapePreviewHtml(value) {
          return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }

        function setButtonLabel(label) {
          if (copyButtonLabel) {
            copyButtonLabel.textContent = label;
          }
          if (resetTimer) {
            window.clearTimeout(resetTimer);
          }
          resetTimer = window.setTimeout(function () {
            if (copyButtonLabel) {
              copyButtonLabel.textContent = idleLabel;
            }
          }, 1600);
        }

        async function copyToClipboard(value) {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(value);
            return;
          }

          var helper = document.createElement("textarea");
          helper.value = value;
          helper.setAttribute("readonly", "");
          helper.style.position = "fixed";
          helper.style.opacity = "0";
          document.body.appendChild(helper);
          helper.select();
          document.execCommand("copy");
          document.body.removeChild(helper);
        }

        function setSearchStatus(label, tone) {
          if (!searchStatus) {
            return;
          }

          searchStatus.textContent = label;
          searchStatus.className = "viewer-search-status";

          if (tone) {
            searchStatus.classList.add(tone);
          }
        }

        function setSearchButtonsDisabled(disabled) {
          [searchPreviousButton, searchNextButton].forEach(function (button) {
            if (button) {
              button.disabled = disabled;
            }
          });
        }

        function clearSearchHighlight() {
          activeMatchIndex = -1;
          activeSearchRange = null;

          if (canUseCustomHighlights) {
            CSS.highlights.delete("viewer-search-match");
            if (textContentElement) {
              textContentElement.textContent = rawText;
            }
            return;
          }

          if (textContentElement) {
            textContentElement.textContent = rawText;
          }
        }

        function findNextMatch(query, startIndex) {
          if (!query) {
            return -1;
          }

          var queryLower = query.toLowerCase();
          var nextIndex = rawTextLower.indexOf(queryLower, Math.max(startIndex, 0));

          if (nextIndex !== -1) {
            return nextIndex;
          }

          return rawTextLower.indexOf(queryLower, 0);
        }

        function findPreviousMatch(query, startIndex) {
          if (!query) {
            return -1;
          }

          var queryLower = query.toLowerCase();
          var previousIndex = rawTextLower.lastIndexOf(
            queryLower,
            Math.min(startIndex, rawTextLower.length - 1)
          );

          if (previousIndex !== -1) {
            return previousIndex;
          }

          return rawTextLower.lastIndexOf(queryLower);
        }

        function scrollRangeIntoView(range) {
          if (!range || !viewerContent) {
            return;
          }

          var rect = range.getBoundingClientRect();
          var containerRect = viewerContent.getBoundingClientRect();

          if (!rect.height && !rect.width) {
            return;
          }

          var relativeTop = rect.top - containerRect.top;
          var relativeBottom = rect.bottom - containerRect.top;

          if (relativeTop < 16 || relativeBottom > viewerContent.clientHeight - 16) {
            viewerContent.scrollTop += relativeTop - viewerContent.clientHeight / 2;
          }
        }

        function highlightMatch(matchIndex, query) {
          if (!textContentElement || matchIndex < 0 || !query) {
            clearSearchHighlight();
            return false;
          }

          if (canUseCustomHighlights) {
            textContentElement.textContent = rawText;
            var textNode = textContentElement.firstChild;

            if (!textNode) {
              return false;
            }

            var range = document.createRange();
            range.setStart(textNode, matchIndex);
            range.setEnd(textNode, matchIndex + query.length);
            CSS.highlights.set("viewer-search-match", new Highlight(range));
            activeSearchRange = range;
            scrollRangeIntoView(range);
          } else {
            textContentElement.innerHTML = [
              escapePreviewHtml(rawText.slice(0, matchIndex)),
              '<mark id="viewer-search-highlight">',
              escapePreviewHtml(rawText.slice(matchIndex, matchIndex + query.length)),
              "</mark>",
              escapePreviewHtml(rawText.slice(matchIndex + query.length))
            ].join("");

            var highlightedNode = document.getElementById("viewer-search-highlight");

            if (highlightedNode) {
              highlightedNode.scrollIntoView({
                block: "center",
                inline: "nearest"
              });
            }
          }

          activeMatchIndex = matchIndex;
          return true;
        }

        function executeSearch(direction, resetToStart) {
          if (!searchInput || !textContentElement) {
            return;
          }

          var nextQuery = String(searchInput.value || "").trim();
          activeQuery = nextQuery;

          if (!nextQuery) {
            clearSearchHighlight();
            setSearchButtonsDisabled(true);
            setSearchStatus("Type to search", "empty");
            return;
          }

          var matchIndex =
            direction === "previous"
              ? findPreviousMatch(
                  nextQuery,
                  activeMatchIndex > 0 ? activeMatchIndex - 1 : rawTextLower.length - 1
                )
              : findNextMatch(
                  nextQuery,
                  resetToStart || activeMatchIndex < 0
                    ? 0
                    : activeMatchIndex + Math.max(nextQuery.length, 1)
                );

          if (matchIndex === -1 || !highlightMatch(matchIndex, nextQuery)) {
            clearSearchHighlight();
            setSearchButtonsDisabled(true);
            setSearchStatus("No match", "error");
            return;
          }

          setSearchButtonsDisabled(false);
          setSearchStatus("Match found", "match");
        }

        if (copyButton) {
          if (copyButtonLabel) {
            copyButtonLabel.textContent = idleLabel;
          }

          copyButton.addEventListener("click", async function () {
            try {
              await copyToClipboard(copyValue);
              setButtonLabel(successLabel);
            } catch (error) {
              setButtonLabel(errorLabel);
            }
          });
        }

        if (searchInput && textContentElement) {
          setSearchButtonsDisabled(true);

          searchInput.addEventListener("input", function () {
            if (searchDebounceTimer) {
              window.clearTimeout(searchDebounceTimer);
            }

            searchDebounceTimer = window.setTimeout(function () {
              executeSearch("next", true);
            }, 140);
          });

          searchInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
              event.preventDefault();
              executeSearch(event.shiftKey ? "previous" : "next", false);
            }
          });

          if (searchPreviousButton) {
            searchPreviousButton.addEventListener("click", function () {
              executeSearch("previous", false);
            });
          }

          if (searchNextButton) {
            searchNextButton.addEventListener("click", function () {
              executeSearch("next", false);
            });
          }
        }
      })();
    <\/script>
  </body>
</html>`;
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

function getNormalizedTheme(value) {
  return String(value || "").trim().toLowerCase() === "light" ? "light" : "dark";
}

function getUrlPathname(targetUrl) {
  try {
    return new URL(targetUrl).pathname || "";
  } catch (error) {
    return "";
  }
}

function getFileNameFromUrl(targetUrl) {
  const pathname = getUrlPathname(targetUrl).replace(/\/+$/, "");
  const rawName = pathname.split("/").pop() || "download";

  try {
    return decodeURIComponent(rawName);
  } catch (error) {
    return rawName;
  }
}

function stripCompressionExtension(value) {
  return String(value || "").replace(/\.(?:gz|gzip)$/i, "");
}

function isGzipArchiveUrl(targetUrl) {
  return /\.(?:gz|gzip)$/i.test(getUrlPathname(targetUrl));
}

function isZipArchiveUrl(targetUrl) {
  return /\.zip$/i.test(getUrlPathname(targetUrl));
}

function isLikelyTextFile(targetUrl, contentType = "") {
  const normalizedContentType = String(contentType || "").toLowerCase();

  if (
    normalizedContentType.startsWith("text/") ||
    normalizedContentType.includes("json") ||
    normalizedContentType.includes("xml") ||
    normalizedContentType.includes("javascript") ||
    normalizedContentType.includes("yaml")
  ) {
    return true;
  }

  const normalizedPath = stripCompressionExtension(getUrlPathname(targetUrl).toLowerCase());
  return /\.(?:xml|json|txt|csv|log|edi|x12|html?|js|ts|css|md|sql|ya?ml)$/i.test(
    normalizedPath
  );
}

function isProbablyBinaryBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  let suspiciousByteCount = 0;

  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }

    if ((byte < 7 || (byte > 13 && byte < 32)) && byte !== 9) {
      suspiciousByteCount += 1;
    }
  }

  return suspiciousByteCount / sample.length > 0.12;
}

function formatXmlForPreview(value) {
  const normalizedValue = String(value || "")
    .replace(/>\s+</g, "><")
    .replace(/(>)(<)(\/*)/g, "$1\n$2$3");
  let indentLevel = 0;

  return normalizedValue
    .split("\n")
    .map((line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        return "";
      }

      if (/^<\//.test(trimmedLine)) {
        indentLevel = Math.max(indentLevel - 1, 0);
      }

      const paddedLine = `${"  ".repeat(indentLevel)}${trimmedLine}`;
      const opensNestedTag =
        /^<[^!?/][^>]*>$/.test(trimmedLine) &&
        !/^<[^>]+\/>$/.test(trimmedLine) &&
        !/<\/[^>]+>$/.test(trimmedLine);

      if (opensNestedTag) {
        indentLevel += 1;
      }

      return paddedLine;
    })
    .join("\n");
}

function formatTextForPreview(targetUrl, value) {
  const rawValue = String(value || "");
  const trimmedValue = rawValue.trim();

  if (!trimmedValue) {
    return rawValue;
  }

  const normalizedPath = getUrlPathname(targetUrl).toLowerCase();

  if (
    normalizedPath.endsWith(".json") ||
    normalizedPath.endsWith(".json.gz") ||
    normalizedPath.endsWith(".json.gzip") ||
    /^[\[{]/.test(trimmedValue)
  ) {
    try {
      return JSON.stringify(JSON.parse(trimmedValue), null, 2);
    } catch (error) {}
  }

  if (
    normalizedPath.endsWith(".xml") ||
    normalizedPath.endsWith(".xml.gz") ||
    normalizedPath.endsWith(".xml.gzip") ||
    /^<\?xml/i.test(trimmedValue) ||
    /^<[a-zA-Z]/.test(trimmedValue)
  ) {
    return formatXmlForPreview(trimmedValue);
  }

  return rawValue;
}

function getParentDirectoryUrl(targetUrl) {
  try {
    return new URL(".", new URL(targetUrl)).toString();
  } catch (error) {
    return "";
  }
}

function getInlinePreviewData(targetUrl, headers, body) {
  let previewBody = body;

  if (isGzipArchiveUrl(targetUrl)) {
    previewBody = zlib.gunzipSync(body);
  } else if (isZipArchiveUrl(targetUrl)) {
    throw new Error("Inline preview for .zip archives is not supported yet. Use Download instead.");
  }

  const contentType = String(headers["content-type"] || "").toLowerCase();

  if (!isLikelyTextFile(targetUrl, contentType) && isProbablyBinaryBuffer(previewBody)) {
    throw new Error("This file looks binary, so it can't be displayed inline. Use Download instead.");
  }

  let truncated = false;
  let previewSlice = previewBody;

  if (previewSlice.length > MAX_INLINE_PREVIEW_BYTES) {
    previewSlice = previewSlice.subarray(0, MAX_INLINE_PREVIEW_BYTES);
    truncated = true;
  }

  const sourceName = getFileNameFromUrl(targetUrl);
  const displayName = isGzipArchiveUrl(targetUrl)
    ? stripCompressionExtension(sourceName)
    : sourceName;

  return {
    sourceName,
    displayName: displayName || sourceName,
    previewMode: isGzipArchiveUrl(targetUrl)
      ? "Inline unzip preview"
      : "Inline text preview",
    sourceType: isGzipArchiveUrl(targetUrl)
      ? "GZip archive"
      : isZipArchiveUrl(targetUrl)
        ? "ZIP archive"
        : "File",
    truncated,
    text: formatTextForPreview(targetUrl, previewSlice.toString("utf8"))
  };
}

function buildInlineFileDocumentShell({
  targetUrl,
  context = "",
  theme = "dark",
  title,
  eyebrow,
  subtitle = "",
  notice = "",
  stats = [],
  contentHtml
}) {
  const normalizedTheme = getNormalizedTheme(theme);
  const navigationPayload = JSON.stringify({
    type: "apf-directory-location",
    remoteUrl: targetUrl,
    context
  });
  const parentDirectoryUrl = getParentDirectoryUrl(targetUrl);
  const backHref = parentDirectoryUrl
    ? buildPreviewProxyUrl(parentDirectoryUrl, context, normalizedTheme)
    : "";
  const statsHtml = stats
    .filter((item) => item && item.label && item.value)
    .map(
      (item) => `
        <span class="apf-inline-fact">
          <span class="apf-inline-fact-label">${escapeHtml(item.label)}</span>
          <span class="apf-inline-fact-value">${escapeHtml(item.value)}</span>
        </span>
      `
    )
    .join("");
  const toolbarActions = [
    backHref
      ? `<a class="apf-inline-action apf-inline-action-secondary" href="${escapeHtml(
          backHref
        )}">Back to folder</a>`
      : "",
    `<a class="apf-inline-action apf-inline-action-primary" href="${escapeHtml(
      buildDownloadProxyUrl(targetUrl)
    )}">Download</a>`
  ]
    .filter(Boolean)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        --apf-bg: #0f1218;
        --apf-surface: rgba(24, 30, 39, 0.94);
        --apf-surface-soft: rgba(255, 255, 255, 0.05);
        --apf-line: rgba(255, 255, 255, 0.1);
        --apf-text: #f7f4ec;
        --apf-muted: #b8b2a6;
        --apf-accent: #ffda30;
        --apf-accent-soft: rgba(255, 218, 48, 0.14);
        --apf-shadow: 0 24px 70px rgba(0, 0, 0, 0.24);
      }

      body[data-theme="light"] {
        --apf-bg: #f5f7fb;
        --apf-surface: rgba(255, 255, 255, 0.96);
        --apf-surface-soft: rgba(15, 23, 42, 0.04);
        --apf-line: rgba(15, 23, 42, 0.1);
        --apf-text: #111827;
        --apf-muted: #6b7280;
        --apf-accent-soft: rgba(255, 218, 48, 0.22);
        --apf-shadow: 0 20px 50px rgba(15, 23, 42, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        min-height: 100%;
        margin: 0;
      }

      body {
        padding: 18px;
        color: var(--apf-text);
        font: 500 14px/1.55 Inter, "Segoe UI", Aptos, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(255, 218, 48, 0.14), transparent 24%),
          linear-gradient(180deg, var(--apf-bg), color-mix(in srgb, var(--apf-bg) 72%, #05070a));
      }

      a {
        color: inherit;
        text-decoration: none;
      }

      .apf-inline-shell {
        min-height: calc(100vh - 36px);
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 12px;
      }

      .apf-inline-toolbar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        padding: 14px 16px;
        border: 1px solid var(--apf-line);
        border-radius: 22px;
        background:
          linear-gradient(180deg, var(--apf-accent-soft), transparent 72%),
          var(--apf-surface);
        box-shadow: var(--apf-shadow);
      }

      .apf-inline-meta {
        min-width: 0;
        display: grid;
        gap: 8px;
      }

      .apf-inline-eyebrow {
        color: var(--apf-accent);
        font-size: 0.74rem;
        font-weight: 900;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .apf-inline-meta h1 {
        margin: 0;
        font-size: clamp(1.4rem, 2.5vw, 2.3rem);
        line-height: 1.04;
        letter-spacing: -0.03em;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .apf-inline-subtitle,
      .apf-inline-detail {
        color: var(--apf-muted);
        overflow-wrap: anywhere;
      }

      .apf-inline-facts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 10px 14px;
        min-width: 0;
      }

      .apf-inline-fact {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      .apf-inline-fact-label {
        color: var(--apf-muted);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .apf-inline-fact-value {
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .apf-inline-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }

      .apf-inline-action {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 15px;
        border: 1px solid var(--apf-line);
        border-radius: 12px;
        font-weight: 900;
        white-space: nowrap;
      }

      .apf-inline-action-primary {
        color: #111;
        border-color: transparent;
        background: linear-gradient(180deg, #fff3b6, var(--apf-accent));
        box-shadow: 0 10px 20px rgba(255, 218, 48, 0.18);
      }

      .apf-inline-action-secondary {
        background: var(--apf-surface-soft);
      }

      .apf-inline-notice {
        padding: 12px 14px;
        border: 1px solid rgba(255, 218, 48, 0.26);
        border-radius: 14px;
        color: var(--apf-text);
        background: var(--apf-accent-soft);
        font-weight: 700;
      }

      .apf-inline-content-shell {
        min-height: 0;
        padding: 14px 16px;
        border: 1px solid var(--apf-line);
        border-radius: 22px;
        background: color-mix(in srgb, var(--apf-surface) 92%, #06080b);
        box-shadow: var(--apf-shadow);
        overflow: auto;
      }

      body[data-theme="light"] .apf-inline-content-shell {
        background: #f8fafc;
      }

      .apf-inline-content-shell pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        tab-size: 2;
        color: var(--apf-text);
        font: 500 13px/1.65 "Cascadia Code", Consolas, "Courier New", monospace;
      }

      .apf-inline-error {
        display: grid;
        gap: 10px;
        padding: 18px;
        border: 1px solid rgba(248, 113, 113, 0.28);
        border-radius: 18px;
        color: #fca5a5;
        background: rgba(127, 29, 29, 0.2);
      }

      body[data-theme="light"] .apf-inline-error {
        color: #b91c1c;
        background: rgba(254, 226, 226, 0.82);
      }

      @media (max-width: 780px) {
        body {
          padding: 12px;
        }

        .apf-inline-shell {
          min-height: calc(100vh - 24px);
        }

        .apf-inline-toolbar {
          display: grid;
        }

        .apf-inline-actions {
          justify-content: flex-start;
        }

        .apf-inline-action {
          width: 100%;
        }
      }
    </style>
  </head>
  <body data-theme="${escapeHtml(normalizedTheme)}">
    <div class="apf-inline-shell">
      <header class="apf-inline-toolbar">
        <div class="apf-inline-meta">
          <span class="apf-inline-eyebrow">${escapeHtml(eyebrow)}</span>
          <h1>${escapeHtml(title)}</h1>
          <p class="apf-inline-subtitle">${escapeHtml(subtitle)}</p>
          <p class="apf-inline-detail">${escapeHtml(targetUrl)}</p>
          ${statsHtml ? `<div class="apf-inline-facts">${statsHtml}</div>` : ""}
        </div>
        <div class="apf-inline-actions">
          ${toolbarActions}
        </div>
      </header>
      <section class="apf-inline-content-shell">
        ${notice ? `<div class="apf-inline-notice">${escapeHtml(notice)}</div>` : ""}
        ${contentHtml}
      </section>
    </div>
    <script>
      window.addEventListener("DOMContentLoaded", function () {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(${navigationPayload}, "*");
        }
      });
    <\/script>
  </body>
</html>`;
}

function buildInlineFilePreviewDocument({
  targetUrl,
  context = "",
  theme = "dark",
  previewData
}) {
  return buildInlineFileDocumentShell({
    targetUrl,
    context,
    theme,
    title: previewData.displayName,
    eyebrow: previewData.previewMode,
    subtitle: previewData.sourceName,
    notice: previewData.truncated
      ? `Preview truncated to the first ${Math.round(
          MAX_INLINE_PREVIEW_BYTES / 1024
        )} KB for faster loading.`
      : "",
    stats: [
      { label: "Source type", value: previewData.sourceType },
      { label: "Preview mode", value: previewData.previewMode },
      { label: "Displayed file", value: previewData.displayName }
    ],
    contentHtml: `<pre>${escapeHtml(previewData.text)}</pre>`
  });
}

function buildInlineFileErrorDocument({
  targetUrl,
  context = "",
  theme = "dark",
  errorMessage
}) {
  return buildInlineFileDocumentShell({
    targetUrl,
    context,
    theme,
    title: "Unable to preview file",
    eyebrow: "Archive preview",
    subtitle: getFileNameFromUrl(targetUrl),
    stats: [
      { label: "Source file", value: getFileNameFromUrl(targetUrl) || "Unknown file" },
      { label: "Recommended action", value: "Download file" }
    ],
    contentHtml: `<div class="apf-inline-error"><strong>Preview unavailable</strong><p>${escapeHtml(
      errorMessage || "The file could not be displayed inline."
    )}</p></div>`
  });
}

function buildDirectoryPreviewDocument(
  remoteHtml,
  targetUrl,
  highlightValue,
  context = "",
  theme = ""
) {
  {
    const plainRewrittenHtml = rewriteHtmlResourceLinks(remoteHtml, targetUrl, context);
    const { html: plainHighlightedHtml, matchCount: plainMatchCount } = highlightDirectoryHtml(
      plainRewrittenHtml,
      highlightValue
    );
    const plainEscapedHighlight = escapeHtml(highlightValue);
    const plainNavigationPayload = JSON.stringify({
      type: "apf-directory-location",
      remoteUrl: targetUrl,
      context
    });
    const plainSearchBanner = String(highlightValue || "").trim()
      ? plainMatchCount > 0
        ? `<div class="apf-search-banner">Highlighted ${plainMatchCount} matching file${plainMatchCount === 1 ? "" : "s"} for "<strong>${plainEscapedHighlight}</strong>".</div>`
        : `<div class="apf-search-banner apf-search-banner-empty">No file matched "<strong>${plainEscapedHighlight}</strong>".</div>`
      : "";
    const plainInjectedHead = `
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
      window.parent.postMessage(${plainNavigationPayload}, "*");
    }

    var firstMatch = document.querySelector(".apf-file-match");

    if (firstMatch) {
      firstMatch.scrollIntoView({ block: "center" });
    }
  });
<\/script>`;

    let plainDocumentHtml = plainHighlightedHtml;

    if (/<head[^>]*>/i.test(plainDocumentHtml)) {
      plainDocumentHtml = plainDocumentHtml.replace(
        /<head[^>]*>/i,
        (match) => `${match}${plainInjectedHead}`
      );
    } else {
      plainDocumentHtml = `${plainInjectedHead}${plainDocumentHtml}`;
    }

    if (plainSearchBanner && /<body[^>]*>/i.test(plainDocumentHtml)) {
      plainDocumentHtml = plainDocumentHtml.replace(
        /<body[^>]*>/i,
        (match) => `${match}${plainSearchBanner}`
      );
    } else if (plainSearchBanner) {
      plainDocumentHtml = `${plainSearchBanner}${plainDocumentHtml}`;
    }

    return plainDocumentHtml;
  }

  const normalizedTheme = getNormalizedTheme(theme);
  const rewrittenHtml = rewriteHtmlResourceLinks(
    remoteHtml,
    targetUrl,
    context,
    normalizedTheme
  );
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
  :root {
    --apf-bg: #0f1218;
    --apf-surface: rgba(24, 30, 39, 0.94);
    --apf-surface-soft: rgba(255, 255, 255, 0.05);
    --apf-line: rgba(255, 255, 255, 0.1);
    --apf-line-strong: rgba(255, 218, 48, 0.34);
    --apf-text: #f7f4ec;
    --apf-muted: #b8b2a6;
    --apf-accent: #ffda30;
    --apf-accent-soft: rgba(255, 218, 48, 0.14);
    --apf-shadow: 0 22px 60px rgba(0, 0, 0, 0.2);
  }

  body[data-theme="light"] {
    --apf-bg: #f5f7fb;
    --apf-surface: rgba(255, 255, 255, 0.96);
    --apf-surface-soft: rgba(15, 23, 42, 0.04);
    --apf-line: rgba(15, 23, 42, 0.1);
    --apf-line-strong: rgba(190, 142, 0, 0.3);
    --apf-text: #111827;
    --apf-muted: #6b7280;
    --apf-accent-soft: rgba(255, 218, 48, 0.2);
    --apf-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    margin: 0;
    min-height: 100%;
    background:
      radial-gradient(circle at top left, rgba(255, 218, 48, 0.14), transparent 24%),
      linear-gradient(180deg, var(--apf-bg), color-mix(in srgb, var(--apf-bg) 72%, #05070a));
  }

  body {
    padding: 18px;
    color: var(--apf-text);
    font: 500 14px/1.55 Inter, "Segoe UI", Aptos, sans-serif;
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  h1 {
    margin: 0 0 14px;
    font: 900 clamp(1.3rem, 2.4vw, 2.1rem)/1.08 Inter, "Segoe UI", Aptos, sans-serif;
    letter-spacing: -0.03em;
  }

  table {
    width: 100%;
  }

  hr {
    opacity: 0.16;
  }

  .apf-search-banner {
    margin: 0 0 14px;
    padding: 12px 14px;
    border-radius: 14px;
    background: rgba(59, 130, 246, 0.16);
    border: 1px solid rgba(59, 130, 246, 0.22);
    color: var(--apf-text);
    font-weight: 800;
  }

  body[data-theme="light"] .apf-search-banner {
    color: #1d4ed8;
  }

  .apf-search-banner-empty {
    background: rgba(245, 158, 11, 0.16);
    border-color: rgba(245, 158, 11, 0.24);
  }

  body[data-theme="light"] .apf-search-banner-empty {
    color: #92400e;
  }

  .apf-directory-wrapper {
    display: grid;
    gap: 12px;
    margin-top: 14px;
  }

  .apf-directory-intro {
    display: grid;
    gap: 4px;
    padding: 14px 16px;
    border: 1px solid var(--apf-line);
    border-radius: 18px;
    background:
      linear-gradient(180deg, var(--apf-accent-soft), transparent 72%),
      var(--apf-surface);
    box-shadow: var(--apf-shadow);
  }

  .apf-directory-intro strong {
    color: var(--apf-accent);
    font-size: 0.76rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .apf-directory-intro span {
    color: var(--apf-muted);
  }

  .apf-directory-board {
    display: grid;
    gap: 12px;
  }

  .apf-entry-card {
    position: relative;
    display: grid;
    gap: 12px;
    padding: 16px 18px 16px 20px;
    border: 1px solid var(--apf-line);
    border-radius: 18px;
    background:
      linear-gradient(180deg, var(--apf-accent-soft), transparent 72%),
      var(--apf-surface);
    box-shadow: var(--apf-shadow);
  }

  .apf-entry-card::before {
    content: "";
    position: absolute;
    inset: 14px auto 14px 0;
    width: 4px;
    border-radius: 999px;
    background: linear-gradient(180deg, var(--apf-accent), #f59e0b);
  }

  .apf-entry-card-folder::before {
    background: linear-gradient(180deg, #60a5fa, #2563eb);
  }

  .apf-entry-card-parent::before {
    background: linear-gradient(180deg, #34d399, #059669);
  }

  .apf-entry-card-match {
    border-color: var(--apf-line-strong);
    box-shadow: 0 18px 48px rgba(255, 218, 48, 0.16);
  }

  .apf-entry-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .apf-entry-copy {
    min-width: 0;
    display: grid;
    gap: 6px;
  }

  .apf-entry-title {
    font-size: 1rem;
    line-height: 1.35;
    font-weight: 900;
    word-break: break-word;
  }

  .apf-entry-subtitle {
    margin: 0;
    color: var(--apf-muted);
    font-size: 0.88rem;
  }

  .apf-entry-type {
    min-height: 28px;
    display: inline-flex;
    align-items: center;
    padding: 0 10px;
    border: 1px solid var(--apf-line);
    border-radius: 999px;
    background: var(--apf-surface-soft);
    color: var(--apf-muted);
    font-size: 0.72rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .apf-entry-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .apf-meta-chip {
    min-height: 30px;
    display: inline-flex;
    align-items: center;
    padding: 0 10px;
    border: 1px solid var(--apf-line);
    border-radius: 999px;
    background: var(--apf-surface-soft);
    color: var(--apf-muted);
    font-size: 0.82rem;
    font-weight: 700;
  }

  .apf-entry-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .apf-action-link {
    min-height: 42px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 14px;
    border: 1px solid var(--apf-line);
    border-radius: 12px;
    font-weight: 900;
    white-space: nowrap;
  }

  .apf-action-primary {
    color: #111;
    border-color: transparent;
    background: linear-gradient(180deg, #fff3b6, var(--apf-accent));
    box-shadow: 0 10px 20px rgba(255, 218, 48, 0.18);
  }

  .apf-action-secondary {
    background: var(--apf-surface-soft);
  }

  .apf-action-subtle {
    color: var(--apf-muted);
    background: transparent;
  }

  .apf-file-match td,
  .apf-file-match th {
    background: rgba(255, 218, 48, 0.14);
  }

  .apf-file-highlight {
    background: var(--apf-accent);
    color: #111827;
    padding: 0 3px;
    border-radius: 4px;
  }

  @media (max-width: 720px) {
    body {
      padding: 12px;
    }

    .apf-entry-card {
      padding: 14px 14px 14px 18px;
    }

    .apf-entry-card-head {
      display: grid;
    }

    .apf-action-link {
      width: 100%;
    }
  }
<\/style>
<script>
  window.addEventListener("DOMContentLoaded", function () {
    var activeTheme = ${JSON.stringify(normalizedTheme)};

    if (document.body) {
      document.body.setAttribute("data-theme", activeTheme);
    }

    if (window.parent && window.parent !== window) {
      window.parent.postMessage(${navigationPayload}, "*");
    }

    function extractRemoteUrlFromPreviewLink(href) {
      try {
        var parsedUrl = new URL(href, window.location.origin);
        return parsedUrl.searchParams.get("url") || href;
      } catch (error) {
        return href;
      }
    }

    function extractContextFromPreviewLink(href) {
      try {
        var parsedUrl = new URL(href, window.location.origin);
        return parsedUrl.searchParams.get("context") || "";
      } catch (error) {
        return "";
      }
    }

    function buildActionUrl(actionPath, remoteUrl, context, theme) {
      var params = new URLSearchParams({ url: remoteUrl });

      if (context) {
        params.set("context", context);
      }

      if (theme) {
        params.set("theme", theme);
      }

      return actionPath + "?" + params.toString();
    }

    function normalizeText(value) {
      return String(value || "").replace(/\\s+/g, " ").trim();
    }

    function createMetaChip(label, value) {
      if (!value || value === "-") {
        return null;
      }

      var chip = document.createElement("span");
      chip.className = "apf-meta-chip";
      chip.textContent = label + ": " + value;
      return chip;
    }

    function createActionLink(label, href, className) {
      var link = document.createElement("a");
      link.className = className;
      link.href = href;
      link.textContent = label;
      return link;
    }

    function isPreviewableFile(remoteUrl) {
      return /\\.(?:gz|gzip|xml|json|txt|csv|log|edi|x12|html?)$/i.test(
        String(remoteUrl || "").split("?")[0]
      );
    }

    function getEntryTypeLabel(entry) {
      if (entry.isParent) {
        return "Navigate";
      }

      if (entry.isDirectory) {
        return "Folder";
      }

      if (/\\.(?:gz|gzip)$/i.test(String(entry.remoteUrl || "").split("?")[0])) {
        return "GZip archive";
      }

      return "File";
    }

    function getEntrySummary(entry) {
      if (entry.isParent) {
        return "Return to the previous directory.";
      }

      if (entry.isDirectory) {
        return "Open this folder to browse its files.";
      }

      if (/\\.(?:gz|gzip)$/i.test(String(entry.remoteUrl || "").split("?")[0])) {
        return "Use View to unzip the archive inline or Download to save the original file.";
      }

      return "Use View to open the file inline or Download to save the original version.";
    }

    function parseEntryRow(row) {
      var link = row.querySelector("a[href]");

      if (!link) {
        return null;
      }

      var cells = Array.prototype.slice.call(row.querySelectorAll("td"));

      if (!cells.length) {
        return null;
      }

      var previewHref = link.href || link.getAttribute("href") || "";
      var anchorCell = link.closest("td");
      var anchorIndex = Math.max(cells.indexOf(anchorCell), 0);
      var nameText = normalizeText(link.textContent || "");

      return {
        nameHtml: link.innerHTML || nameText,
        nameText: nameText,
        previewHref: previewHref,
        remoteUrl: extractRemoteUrlFromPreviewLink(previewHref),
        context: extractContextFromPreviewLink(previewHref),
        isParent: /parent directory/i.test(nameText),
        isDirectory:
          /parent directory/i.test(nameText) ||
          /\\/$/.test(nameText) ||
          /\\/$/.test(extractRemoteUrlFromPreviewLink(previewHref)),
        lastModified: normalizeText(cells[anchorIndex + 1] && cells[anchorIndex + 1].textContent),
        size: normalizeText(cells[anchorIndex + 2] && cells[anchorIndex + 2].textContent),
        description: normalizeText(cells[anchorIndex + 3] && cells[anchorIndex + 3].textContent),
        isMatch: row.classList.contains("apf-file-match"),
        canView: isPreviewableFile(extractRemoteUrlFromPreviewLink(previewHref))
      };
    }

    function createEntryCard(entry) {
      var card = document.createElement("article");
      var className = "apf-entry-card";

      if (entry.isDirectory) {
        className += " apf-entry-card-folder";
      }

      if (entry.isParent) {
        className += " apf-entry-card-parent";
      }

      if (entry.isMatch) {
        className += " apf-entry-card-match";
      }

      card.className = className;

      var head = document.createElement("div");
      head.className = "apf-entry-card-head";

      var copy = document.createElement("div");
      copy.className = "apf-entry-copy";

      var title = document.createElement("strong");
      title.className = "apf-entry-title";
      title.innerHTML = entry.nameHtml;

      var subtitle = document.createElement("p");
      subtitle.className = "apf-entry-subtitle";
      subtitle.textContent = getEntrySummary(entry);

      var type = document.createElement("span");
      type.className = "apf-entry-type";
      type.textContent = getEntryTypeLabel(entry);

      copy.appendChild(title);
      copy.appendChild(subtitle);
      head.appendChild(copy);
      head.appendChild(type);
      card.appendChild(head);

      var meta = document.createElement("div");
      meta.className = "apf-entry-meta";

      [
        createMetaChip("Modified", entry.lastModified),
        createMetaChip("Size", entry.size),
        createMetaChip("Details", entry.description)
      ]
        .filter(Boolean)
        .forEach(function (chip) {
          meta.appendChild(chip);
        });

      if (meta.childNodes.length > 0) {
        card.appendChild(meta);
      }

      var actions = document.createElement("div");
      actions.className = "apf-entry-actions";

      if (entry.isDirectory) {
        actions.appendChild(
          createActionLink(
            entry.isParent ? "Go back" : "Open folder",
            entry.previewHref,
            "apf-action-link apf-action-primary"
          )
        );
      } else {
        if (entry.canView) {
          actions.appendChild(
            createActionLink(
              "View",
              buildActionUrl("/api/directory-file-view", entry.remoteUrl, entry.context, activeTheme),
              "apf-action-link apf-action-primary"
            )
          );
        } else {
          actions.appendChild(
            createActionLink(
              "Open raw",
              entry.previewHref,
              "apf-action-link apf-action-subtle"
            )
          );
        }

        actions.appendChild(
          createActionLink(
            "Download",
            buildActionUrl("/api/directory-download", entry.remoteUrl, entry.context, ""),
            "apf-action-link apf-action-secondary"
          )
        );
      }

      card.appendChild(actions);
      return card;
    }

    function buildDirectoryBoard() {
      var tables = Array.prototype.slice.call(document.querySelectorAll("table"));
      var sourceTable = tables.find(function (candidate) {
        return candidate.querySelector("tr td a[href]");
      });

      if (!sourceTable) {
        return;
      }

      var entries = Array.prototype.slice
        .call(sourceTable.querySelectorAll("tr"))
        .map(parseEntryRow)
        .filter(Boolean);

      if (!entries.length) {
        return;
      }

      var wrapper = document.createElement("section");
      wrapper.className = "apf-directory-wrapper";

      var intro = document.createElement("div");
      intro.className = "apf-directory-intro";
      intro.innerHTML =
        "<strong>Archive browser</strong><span>Each item is wrapped in a bordered card. Use View to open supported files inline and Download to save the original file.</span>";

      var board = document.createElement("div");
      board.className = "apf-directory-board";

      entries.forEach(function (entry) {
        board.appendChild(createEntryCard(entry));
      });

      wrapper.appendChild(intro);
      wrapper.appendChild(board);
      sourceTable.insertAdjacentElement("afterend", wrapper);
      sourceTable.style.display = "none";

      Array.prototype.slice.call(document.querySelectorAll("hr")).forEach(function (rule) {
        rule.style.display = "none";
      });
    }

    buildDirectoryBoard();

    var firstMatch = document.querySelector(".apf-entry-card-match, .apf-file-match");

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

  if (/<body[^>]*>/i.test(documentHtml)) {
    documentHtml = documentHtml.replace(
      /<body([^>]*)>/i,
      (match, attrs) => `<body${attrs} data-theme="${escapeHtml(normalizedTheme)}">`
    );
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
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
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
    url: archiveService.normalizeArchivePath(entry?.url, entry?.type),
    backup: String(entry?.backup || "").trim()
  };
}

function sanitizeBusinessUnit(businessUnit, index) {
  const id = String(businessUnit?.id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  const fallbackCode = id || `bu-${index + 1}`;
  const label = String(
    businessUnit?.label || `BU ${fallbackCode.toUpperCase()}`
  ).trim();
  const name = String(businessUnit?.name || label).trim();
  const flag = String(businessUnit?.flag || "").trim();
  const flagId = String(businessUnit?.flagId || "").trim().toLowerCase();
  const rawPalette = businessUnit?.palette;
  const palette =
    rawPalette && typeof rawPalette === "object"
      ? {
          base: String(rawPalette.base || "").trim(),
          soft: String(rawPalette.soft || "").trim(),
          glow: String(rawPalette.glow || "").trim(),
          text: String(rawPalette.text || "").trim()
        }
      : null;
  const removed = businessUnit?.removed === true;

  return {
    id: fallbackCode,
    label,
    name,
    flag,
    flagId,
    palette,
    removed
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

async function readArchiveEntries() {
  const repository = await repositoryPromise;
  const payload = await repository.readData();

  return Array.isArray(payload?.entries)
    ? payload.entries.map((entry, index) => sanitizeEntry(entry, index))
    : [];
}

async function findArchiveEntry(entryId) {
  const normalizedEntryId = String(entryId || "").trim();

  if (!normalizedEntryId) {
    return null;
  }

  const entries = await readArchiveEntries();
  return entries.find((entry) => entry.id === normalizedEntryId) || null;
}

function getArchiveAccessOptions(entry) {
  const normalizedEntryRoot = archiveService.normalizeArchivePath(entry?.url, entry?.type);
  const inboundRoot = archiveService.getSectionRoot("inbound");
  const outboundRoot = archiveService.getSectionRoot("outbound");
  const actualSectionRoot = [inboundRoot, outboundRoot].find(
    (sectionRoot) =>
      normalizedEntryRoot === sectionRoot ||
      normalizedEntryRoot.startsWith(`${sectionRoot}/`)
  );

  return {
    allowedRootPath: actualSectionRoot || normalizedEntryRoot
  };
}

function sanitizeBusinessUnits(rawBusinessUnits) {
  const normalizedBusinessUnits = (Array.isArray(rawBusinessUnits) ? rawBusinessUnits : [])
    .map((businessUnit, index) => sanitizeBusinessUnit(businessUnit, index))
    .filter((businessUnit) => businessUnit.id && businessUnit.name);
  const uniqueBusinessUnits = new Map();

  normalizedBusinessUnits.forEach((businessUnit) => {
    uniqueBusinessUnits.set(businessUnit.id, businessUnit);
  });

  return [...uniqueBusinessUnits.values()].sort((leftUnit, rightUnit) =>
    String(leftUnit.label || leftUnit.name).localeCompare(
      String(rightUnit.label || rightUnit.name),
      undefined,
      {
        numeric: true,
        sensitivity: "base"
      }
    )
  );
}

async function readBusinessUnitsFile() {
  try {
    const rawContent = await fs.readFile(BUSINESS_UNITS_FILE, "utf8");
    const parsedValue = JSON.parse(rawContent.replace(/^\uFEFF/, ""));
    const businessUnits = Array.isArray(parsedValue?.businessUnits)
      ? parsedValue.businessUnits
      : Array.isArray(parsedValue)
        ? parsedValue
        : [];

    return sanitizeBusinessUnits(businessUnits);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeBusinessUnitsFile(businessUnits) {
  const normalizedBusinessUnits = sanitizeBusinessUnits(businessUnits);
  const payload = {
    generatedAt: new Date().toISOString(),
    businessUnits: normalizedBusinessUnits
  };
  const temporaryFile = `${BUSINESS_UNITS_FILE}.tmp`;

  try {
    await fs.writeFile(temporaryFile, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(temporaryFile, BUSINESS_UNITS_FILE);
  } finally {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
  }

  return normalizedBusinessUnits;
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
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return false;
  }

  return (
    String(username || "").trim().toLowerCase() === ADMIN_USERNAME &&
    String(password || "") === ADMIN_PASSWORD
  );
}

function pruneExpiredAdminSessions() {
  const now = Date.now();

  adminSessions.forEach((session, token) => {
    if (!session || session.expiresAt <= now) {
      adminSessions.delete(token);
    }
  });
}

function createAdminSessionToken(username) {
  pruneExpiredAdminSessions();

  const token = crypto.randomBytes(24).toString("hex");

  adminSessions.set(token, {
    username,
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS
  });

  return token;
}

function isAuthorizedAdminRequest(request) {
  pruneExpiredAdminSessions();

  const token = String(request.headers["x-admin-token"] || "").trim();

  if (!token) {
    return false;
  }

  const currentSession = adminSessions.get(token);

  if (!currentSession) {
    return false;
  }

  adminSessions.set(token, {
    ...currentSession,
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS
  });

  return true;
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
      "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS
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
      if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
        sendJson(response, 503, {
          ok: false,
          error: "Admin access is not configured on the server."
        });
        return;
      }

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
        username: ADMIN_USERNAME,
        token: createAdminSessionToken(ADMIN_USERNAME)
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
      const [payload, businessUnits] = await Promise.all([
        repository.readData(),
        readBusinessUnitsFile()
      ]);
      sendJson(response, 200, {
        ...payload,
        entries: Array.isArray(payload?.entries)
          ? payload.entries.map((entry, index) => sanitizeEntry(entry, index))
          : [],
        businessUnits
      });
    } catch (error) {
      console.error("GET /api/directory-data failed", error);
      sendJson(response, 500, { error: "Unable to read directory data." });
    }
    return;
  }

  if (requestPath === "/api/directory-data" && request.method === "POST") {
    try {
      if (!isAuthorizedAdminRequest(request)) {
        sendJson(response, 401, {
          ok: false,
          error: "Admin authentication is required to save directory data."
        });
        return;
      }

      const body = await readRequestBody(request);
      const parsedBody = body ? JSON.parse(body) : {};
      const nextPayload = sanitizePayload(parsedBody);
      const nextBusinessUnits = sanitizeBusinessUnits(parsedBody?.businessUnits);
      const repository = await repositoryPromise;
      const [savedPayload, savedBusinessUnits] = await Promise.all([
        repository.writeData(nextPayload.entries),
        writeBusinessUnitsFile(nextBusinessUnits)
      ]);
      sendJson(response, 200, {
        ...savedPayload,
        entries: Array.isArray(savedPayload?.entries)
          ? savedPayload.entries.map((entry, index) => sanitizeEntry(entry, index))
          : [],
        businessUnits: savedBusinessUnits
      });
    } catch (error) {
      console.error("POST /api/directory-data failed", error);
      sendJson(response, 400, { error: "Unable to save directory data." });
    }
    return;
  }

  if (requestPath === "/api/archive-status" && request.method === "GET") {
    sendJson(response, 200, {
      configured: archiveService.isConfigured(),
      host: archiveServer.host || "",
      rootPath: archiveServer.rootPath || ""
    });
    return;
  }

  if (requestPath === "/api/archive/list" && request.method === "GET") {
    try {
      const entryId = requestUrl.searchParams.get("entryId");
      const relativePath = requestUrl.searchParams.get("path") || "";
      const entry = await findArchiveEntry(entryId);

      if (!entry) {
        sendJson(response, 404, { error: "Archive entry not found." });
        return;
      }

      const archivePayload = await archiveService.list(
        entry.url,
        relativePath,
        getArchiveAccessOptions(entry)
      );
      sendJson(response, 200, {
        ok: true,
        entry: {
          id: entry.id,
          bu: entry.bu,
          type: entry.type,
          label: entry.label,
          backup: entry.backup,
          rootPath: entry.url
        },
        ...archivePayload
      });
    } catch (error) {
      console.error("GET /api/archive/list failed", error);
      sendJson(response, 502, { error: error.message || "Unable to load archive files." });
    }
    return;
  }

  if (requestPath === "/api/archive/search" && request.method === "GET") {
    try {
      const query = String(requestUrl.searchParams.get("query") || "").trim();
      const entryId = String(requestUrl.searchParams.get("entryId") || "").trim();
      const entries = await readArchiveEntries();
      const searchPayload = await archiveService.search(entries, query, entryId);

      sendJson(response, 200, {
        ok: true,
        ...searchPayload
      });
    } catch (error) {
      console.error("GET /api/archive/search failed", error);
      sendJson(response, 502, { error: error.message || "Unable to search the archive." });
    }
    return;
  }

  if (requestPath === "/api/archive/file-preview" && request.method === "GET") {
    try {
      const entryId = requestUrl.searchParams.get("entryId");
      const relativePath = requestUrl.searchParams.get("path") || "";
      const entry = await findArchiveEntry(entryId);

      if (!entry) {
        sendJson(response, 404, { error: "Archive entry not found." });
        return;
      }

      const filePayload = await archiveService.readFile(
        entry.url,
        relativePath,
        {
          ...getArchiveAccessOptions(entry),
          maxBytes: MAX_ARCHIVE_OPEN_BYTES
        }
      );

      if (filePayload.tooLarge) {
        sendJson(response, 200, {
          ok: true,
          entry: {
            id: entry.id,
            bu: entry.bu,
            type: entry.type,
            label: entry.label,
            rootPath: entry.url
          },
          relativePath,
          fileName: filePayload.fileName,
          size: filePayload.size,
          modifiedAt: filePayload.modifiedAt,
          contentType: filePayload.contentType,
          previewable: false,
          content: "",
          truncated: false,
          notice: `This file is larger than ${formatBytes(MAX_ARCHIVE_OPEN_BYTES)} and is available for download only.`
        });
        return;
      }

      let fileName = filePayload.fileName;
      let contentType = filePayload.contentType;
      let fileBuffer = filePayload.buffer;
      let notice = "";

      if (/\.(?:gz|gzip)$/i.test(fileName)) {
        fileBuffer = zlib.gunzipSync(fileBuffer);
        fileName = stripCompressionExtension(fileName);
        contentType = getArchiveOpenContentType(fileName);
      } else if (/\.zip$/i.test(fileName)) {
        sendJson(response, 200, {
          ok: true,
          entry: {
            id: entry.id,
            bu: entry.bu,
            type: entry.type,
            label: entry.label,
            rootPath: entry.url
          },
          relativePath,
          fileName,
          size: filePayload.size,
          modifiedAt: filePayload.modifiedAt,
          contentType,
          previewable: false,
          content: "",
          truncated: false,
          notice: "ZIP containers are not rendered inline here. Use Download to inspect the archive."
        });
        return;
      }

      if (
        String(contentType || "").toLowerCase().startsWith("text/") ||
        String(contentType || "").toLowerCase().includes("json") ||
        String(contentType || "").toLowerCase().includes("xml") ||
        String(contentType || "").toLowerCase().includes("markdown") ||
        !isProbablyBinaryBuffer(fileBuffer)
      ) {
        const previewTargetUrl = `http://archive.local/${encodeURI(fileName)}`;

        sendJson(response, 200, {
          ok: true,
          entry: {
            id: entry.id,
            bu: entry.bu,
            type: entry.type,
            label: entry.label,
            rootPath: entry.url
          },
          relativePath,
          fileName,
          size: fileBuffer.length,
          modifiedAt: filePayload.modifiedAt,
          contentType,
          previewable: true,
          content: formatTextForPreview(previewTargetUrl, fileBuffer.toString("utf8")),
          truncated: false,
          notice
        });
        return;
      }

      sendJson(response, 200, {
        ok: true,
        entry: {
          id: entry.id,
          bu: entry.bu,
          type: entry.type,
          label: entry.label,
          rootPath: entry.url
        },
        relativePath,
        fileName,
        size: filePayload.size,
        modifiedAt: filePayload.modifiedAt,
        contentType,
        previewable: false,
        content: "",
        truncated: false,
        notice: isInlineBrowserType(contentType)
          ? "This file type is not displayed inline in the app. Use Download to access it."
          : "This file type is not displayed inline. Use Download to access it."
      });
    } catch (error) {
      console.error("GET /api/archive/file-preview failed", error);
      sendJson(response, 502, {
        error: error.message || "Unable to preview the selected archive file."
      });
    }
    return;
  }

  if (requestPath === "/api/archive/download" && request.method === "GET") {
    try {
      const entryId = requestUrl.searchParams.get("entryId");
      const relativePath = requestUrl.searchParams.get("path") || "";
      const entry = await findArchiveEntry(entryId);

      if (!entry) {
        sendJson(response, 404, { error: "Archive entry not found." });
        return;
      }

      await archiveService.streamFile(
        entry.url,
        relativePath,
        response,
        getArchiveAccessOptions(entry)
      );
    } catch (error) {
      console.error("GET /api/archive/download failed", error);
      if (!response.headersSent) {
        sendJson(response, 502, {
          error: error.message || "Unable to download the selected archive file."
        });
      } else {
        response.end();
      }
    }
    return;
  }

  if (requestPath === "/api/archive/open" && request.method === "GET") {
    const entryId = requestUrl.searchParams.get("entryId");
    const relativePath = requestUrl.searchParams.get("path") || "";
    const requestedTheme = requestUrl.searchParams.get("theme") || "dark";

    try {
      const entry = await findArchiveEntry(entryId);

      if (!entry) {
        sendHtml(
          response,
          404,
          buildArchiveViewerDocument({
            downloadUrl: "#",
            entry: null,
            fileName: "Unknown file",
            relativePath,
            size: 0,
            modifiedAt: "",
            theme: requestedTheme,
            title: "Archive entry not found",
            notice: "The requested archive entry no longer exists.",
            contentHtml: "<pre>Open the file again from the portal.</pre>"
          })
        );
        return;
      }

      const filePayload = await archiveService.readFile(
        entry.url,
        relativePath,
        {
          ...getArchiveAccessOptions(entry),
          maxBytes: MAX_ARCHIVE_OPEN_BYTES
        }
      );
      const downloadUrl = `/api/archive/download?entryId=${encodeURIComponent(
        entry.id
      )}&path=${encodeURIComponent(relativePath)}`;

      if (filePayload.tooLarge) {
        sendHtml(
          response,
          200,
          buildArchiveViewerDocument({
            downloadUrl,
            entry,
            fileName: filePayload.fileName,
            relativePath,
            size: filePayload.size,
            modifiedAt: filePayload.modifiedAt,
            theme: requestedTheme,
            title: filePayload.fileName,
            notice: `This file is larger than ${formatBytes(MAX_ARCHIVE_OPEN_BYTES)} and is provided as a download.`,
            contentHtml: "<pre>Inline viewing is disabled for oversized files.</pre>"
          })
        );
        return;
      }

      let fileName = filePayload.fileName;
      let contentType = filePayload.contentType;
      let fileBuffer = filePayload.buffer;
      let notice = "";

      if (/\.(?:gz|gzip)$/i.test(fileName)) {
        fileBuffer = zlib.gunzipSync(fileBuffer);
        fileName = stripCompressionExtension(fileName);
        contentType = getArchiveOpenContentType(fileName);
      } else if (/\.zip$/i.test(fileName)) {
        sendHtml(
          response,
          200,
          buildArchiveViewerDocument({
            downloadUrl,
            entry,
            fileName,
            relativePath,
            size: filePayload.size,
            modifiedAt: filePayload.modifiedAt,
            theme: requestedTheme,
            title: fileName,
            notice: "ZIP containers are not rendered inline yet. Download the archive to inspect it.",
            contentHtml: "<pre>Binary archive ready for download.</pre>"
          })
        );
        return;
      }

      if (isInlineBrowserType(contentType)) {
        response.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
          "Content-Type": contentType,
          "Content-Length": String(fileBuffer.length),
          "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`
        });
        response.end(fileBuffer);
        return;
      }

      const previewTargetUrl = `http://archive.local/${encodeURI(fileName)}`;

      if (
        String(contentType || "").toLowerCase().startsWith("text/") ||
        String(contentType || "").toLowerCase().includes("json") ||
        String(contentType || "").toLowerCase().includes("xml") ||
        String(contentType || "").toLowerCase().includes("markdown") ||
        !isProbablyBinaryBuffer(fileBuffer)
      ) {
        sendHtml(
          response,
          200,
          buildArchiveViewerDocument({
            downloadUrl,
            entry,
            fileName,
            relativePath,
            size: fileBuffer.length,
            modifiedAt: filePayload.modifiedAt,
            theme: requestedTheme,
            title: fileName,
            notice,
            copyText: formatTextForPreview(previewTargetUrl, fileBuffer.toString("utf8")),
            contentHtml: `<pre>${escapeHtml(
              formatTextForPreview(previewTargetUrl, fileBuffer.toString("utf8"))
            )}</pre>`
          })
        );
        return;
      }

      sendHtml(
        response,
        200,
        buildArchiveViewerDocument({
          downloadUrl,
          entry,
          fileName,
          relativePath,
          size: filePayload.size,
          modifiedAt: filePayload.modifiedAt,
          theme: requestedTheme,
          title: fileName,
          notice: "This file type is not displayed inline. Use Download to access it.",
          contentHtml: "<pre>Binary file ready for download.</pre>"
        })
      );
    } catch (error) {
      console.error("GET /api/archive/open failed", error);
      sendHtml(
        response,
        502,
        buildArchiveViewerDocument({
          downloadUrl: "#",
          entry: null,
          fileName: relativePath || "Unknown file",
          relativePath,
          size: 0,
          modifiedAt: "",
          theme: requestedTheme,
          title: "Unable to open archive file",
          notice: error.message || "The archive file could not be opened.",
          contentHtml: "<pre>Download the file from the main portal and try again.</pre>"
        })
      );
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
  console.log(
    `Archive source: ${archiveServer.host || "not-configured"}:${archiveServer.port || 22}${archiveService.isConfigured() ? ` (${archiveServer.rootPath})` : ""}`
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

const API_BASE = process.env.REACT_APP_DIRECTORY_API || "http://localhost:3001";

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function fetchJson(pathname, params = {}) {
  const requestUrl = new URL(`${API_BASE}${pathname}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    requestUrl.searchParams.set(key, String(value));
  });

  const response = await fetch(requestUrl.toString());
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(payload?.error || "The archive request failed.");
  }

  return payload;
}

export function getArchiveStatus() {
  return fetchJson("/api/archive-status");
}

export function listArchive(entryId, relativePath = "") {
  return fetchJson("/api/archive/list", {
    entryId,
    path: relativePath
  });
}

export function searchArchive(query, options = {}) {
  return fetchJson("/api/archive/search", {
    query,
    entryId: options.entryId || ""
  });
}

export function getArchiveFilePreview(entryId, relativePath = "") {
  return fetchJson("/api/archive/file-preview", {
    entryId,
    path: relativePath
  });
}

export function buildArchiveOpenUrl(entryId, relativePath, theme = "dark") {
  const requestUrl = new URL(`${API_BASE}/api/archive/open`);

  requestUrl.searchParams.set("entryId", String(entryId));
  requestUrl.searchParams.set("path", String(relativePath || ""));
  requestUrl.searchParams.set("theme", String(theme || "dark"));

  return requestUrl.toString();
}

export function buildArchiveDownloadUrl(entryId, relativePath) {
  const requestUrl = new URL(`${API_BASE}/api/archive/download`);

  requestUrl.searchParams.set("entryId", String(entryId));
  requestUrl.searchParams.set("path", String(relativePath || ""));

  return requestUrl.toString();
}

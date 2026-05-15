function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getDirectoryApiBase() {
  const configuredBase = trimTrailingSlash(process.env.REACT_APP_DIRECTORY_API);

  if (configuredBase) {
    return configuredBase;
  }

  if (typeof window === "undefined") {
    return "http://localhost:3001";
  }

  const { origin, protocol, hostname, port } = window.location;

  if (port === "3001") {
    return origin;
  }

  if ((protocol === "http:" || protocol === "https:") && hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
    return `${protocol}//${hostname}:3001`;
  }

  return "http://localhost:3001";
}

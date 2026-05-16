function getIconAssetPath(name) {
  const normalizedName = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");

  if (!normalizedName) {
    return "";
  }

  return `${process.env.PUBLIC_URL || ""}/icon/${normalizedName}.svg`;
}

function AssetIcon({ className = "", name }) {
  const assetPath = getIconAssetPath(name);

  if (!assetPath) {
    return null;
  }

  return (
    <span
      className={`app-icon-mask ${className}`.trim()}
      aria-hidden="true"
      style={{ "--icon-url": `url(${assetPath})` }}
    />
  );
}

export default AssetIcon;

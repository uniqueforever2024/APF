export const LANGUAGES = [
  { id: "en", label: "EN", nativeLabel: "English" },
  { id: "fr", label: "FR", nativeLabel: "Francais" },
  { id: "de", label: "DE", nativeLabel: "Deutsch" },
  { id: "it", label: "IT", nativeLabel: "Italiano" },
  { id: "pl", label: "PL", nativeLabel: "Polski" }
];

function makeFlagEmoji(countryCode) {
  return Array.from(String(countryCode || "").toUpperCase())
    .map((character) => String.fromCodePoint(127397 + character.charCodeAt(0)))
    .join("");
}

export const BU_OPTIONS = [
  { id: "fr", label: "BU FR", name: "France", flag: makeFlagEmoji("FR"), flagId: "fr" },
  { id: "it", label: "BU IT", name: "Italy", flag: makeFlagEmoji("IT"), flagId: "it" },
  { id: "pl", label: "BU PL", name: "Poland", flag: makeFlagEmoji("PL"), flagId: "pl" },
  { id: "ua", label: "BU UA", name: "Ukraine", flag: makeFlagEmoji("UA"), flagId: "ua" },
  { id: "hr", label: "BU HR", name: "Croatia", flag: makeFlagEmoji("HR"), flagId: "hr" },
  { id: "si", label: "BU SI", name: "Slovenia", flag: makeFlagEmoji("SI"), flagId: "si" },
  { id: "lt", label: "BU LT", name: "Lithuania", flag: makeFlagEmoji("LT"), flagId: "lt" },
  { id: "ib", label: "BU IB", name: "Spain", flag: makeFlagEmoji("ES"), flagId: "es" }
];

export const SECTION_ORDER = ["inbound", "outbound"];
export const DEFAULT_SECTION = SECTION_ORDER[0];

export const SECTION_META = {
  inbound: { labelKey: "inbound", directoryName: "RECU" },
  outbound: { labelKey: "outbound", directoryName: "EMIS" }
};

export const LEGACY_TYPE_MAP = {
  inbound: "inbound",
  outbound: "outbound",
  recu: "inbound",
  emis: "outbound",
  annonces: "inbound",
  scans: "inbound",
  annoncescarrieriod: "inbound",
  extractions: "outbound",
  refclients: "outbound",
  extractionannoncecarrier: "outbound",
  integration: "outbound",
  collas: "outbound",
  integrationiodcarrier: "outbound",
  impression: "outbound",
  saisie1sap2mglots: "inbound",
  crintgsaisie1sap2mglots: "inbound",
  saisie2mglots2sap: "outbound",
  crintgsaisie2mglots2sap: "outbound"
};

export const LANGUAGES = [
  { id: "de", label: "DE", nativeLabel: "Deutsch", flag: "🇩🇪" },
  { id: "fr", label: "FR", nativeLabel: "Français", flag: "🇫🇷" },
  { id: "en", label: "EN", nativeLabel: "English", flag: "🇬🇧" },
  { id: "it", label: "IT", nativeLabel: "Italiano", flag: "🇮🇹" },
  { id: "pl", label: "PL", nativeLabel: "Polski", flag: "🇵🇱" }
];

const makeFlagEmoji = (countryCode) =>
  Array.from(countryCode.toUpperCase())
    .map((character) => String.fromCodePoint(127397 + character.charCodeAt(0)))
    .join("");

export const BU_OPTIONS = [
  { id: "fr", label: "BU FR", name: "France", flag: makeFlagEmoji("FR") },
  { id: "it", label: "BU IT", name: "Italy", flag: makeFlagEmoji("IT") },
  { id: "pl", label: "BU PL", name: "Poland", flag: makeFlagEmoji("PL") },
  { id: "ua", label: "BU UA", name: "Ukraine", flag: makeFlagEmoji("UA") },
  { id: "hr", label: "BU HR", name: "Croatia", flag: makeFlagEmoji("HR") },
  { id: "si", label: "BU SI", name: "Slovenia", flag: makeFlagEmoji("SI") },
  { id: "lt", label: "BU LT", name: "Lithuania", flag: makeFlagEmoji("LT") },
  { id: "ib", label: "BU IB", name: "Spain", flag: makeFlagEmoji("ES") }
];

export const MAP_LINKS = [
  { id: "fr", top: "60.5%", left: "34.5%", mapLabel: "FR" },
  { id: "it", top: "71.5%", left: "43.8%", mapLabel: "IT" },
  { id: "pl", top: "49.5%", left: "58.2%", mapLabel: "PL" },
  { id: "ua", top: "54.5%", left: "72.3%", mapLabel: "UA" },
  { id: "hr", top: "69%", left: "54.6%", mapLabel: "HR" },
  { id: "si", top: "67.2%", left: "50.8%", mapLabel: "SI" },
  { id: "lt", top: "38.2%", left: "64%", mapLabel: "LT" },
  { id: "ib", top: "79%", left: "21.2%", mapLabel: "IB" }
];

export const SECTION_ORDER = ["annonces", "extractions"];

export const DEFAULT_SECTION = SECTION_ORDER[0];

export const SIDEBAR_GROUPS = [
  {
    type: "group",
    titleKey: "productionFiles",
    sections: [
      {
        headingKey: "reception",
        items: ["annonces", "scans", "annoncesCarrierIod"]
      },
      {
        headingKey: "emission",
        items: ["extractions", "refclients", "extractionAnnonceCarrier"]
      }
    ]
  },
  {
    type: "list",
    titleKey: "integrationReports",
    items: ["integration", "collas", "integrationIodCarrier"]
  },
  {
    type: "single",
    titleKey: "printDocuments",
    item: "impression"
  },
  {
    type: "group",
    titleKey: "mgLotsSap",
    sections: [
      {
        headingKey: "interfaceFiles",
        items: ["saisie1SAP2MGlots", "saisie2MGlots2SAP"]
      },
      {
        headingKey: "integrationLogs",
        items: ["crIntgSaisie1SAP2MGlots", "crIntgSaisie2MGlots2SAP"]
      }
    ]
  }
];

export const SECTION_META = {
  annonces: { labelKey: "annonces", showsBackup: true },
  scans: { labelKey: "scans", showsBackup: false },
  annoncesCarrierIod: { labelKey: "annoncesCarrierIod", showsBackup: true },
  extractions: { labelKey: "extractions", showsBackup: false },
  refclients: { labelKey: "refclients", showsBackup: false },
  extractionAnnonceCarrier: {
    labelKey: "extractionAnnonceCarrier",
    showsBackup: false
  },
  integration: { labelKey: "integration", showsBackup: false },
  collas: { labelKey: "collas", showsBackup: false },
  integrationIodCarrier: {
    labelKey: "integrationIodCarrier",
    showsBackup: false
  },
  impression: { labelKey: "impression", showsBackup: false },
  saisie1SAP2MGlots: { labelKey: "saisie1SAP2MGlots", showsBackup: false },
  saisie2MGlots2SAP: { labelKey: "saisie2MGlots2SAP", showsBackup: false },
  crIntgSaisie1SAP2MGlots: {
    labelKey: "crIntgSaisie1SAP2MGlots",
    showsBackup: false
  },
  crIntgSaisie2MGlots2SAP: {
    labelKey: "crIntgSaisie2MGlots2SAP",
    showsBackup: false
  }
};

export const LEGACY_TYPE_MAP = {
  annonces: "annonces",
  scans: "scans",
  annoncescarrieriod: "annoncesCarrierIod",
  extractions: "extractions",
  refclients: "refclients",
  extractionannoncecarrier: "extractionAnnonceCarrier",
  integration: "integration",
  collas: "collas",
  integrationiodcarrier: "integrationIodCarrier",
  impression: "impression",
  saisie1sap2mglots: "saisie1SAP2MGlots",
  crintgsaisie1sap2mglots: "crIntgSaisie1SAP2MGlots",
  saisie2mglots2sap: "saisie2MGlots2SAP",
  crintgsaisie2mglots2sap: "crIntgSaisie2MGlots2SAP"
};

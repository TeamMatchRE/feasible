/**
 * Map overlays for the studio — FEMA flood zones, USFWS wetlands, and USGS
 * hillshade — served as Google Maps ImageMapType layers. Each ArcGIS
 * export/exportImage endpoint takes a bbox; we convert a Google tile {x,y,z}
 * into its EPSG:3857 (Web Mercator) bounds so the returned PNG aligns to the
 * tile grid. Client-safe (no server-only import).
 */

export type OverlayId = "flood" | "wetlands" | "elevation";

export interface OverlayDef {
  id: OverlayId;
  label: string;
  color: string;
  attribution: string;
  getTileUrl: (x: number, y: number, z: number) => string;
}

const WORLD = 20037508.342789244; // half the Web-Mercator world extent, metres

function tileBbox(x: number, y: number, z: number): string {
  const size = (2 * WORLD) / Math.pow(2, z);
  const minX = -WORLD + x * size;
  const maxX = minX + size;
  const maxY = WORLD - y * size;
  const minY = maxY - size;
  return `${minX},${minY},${maxX},${maxY}`;
}

function esriExport(base: string, extra: string) {
  return (x: number, y: number, z: number) =>
    `${base}?bbox=${tileBbox(x, y, z)}&bboxSR=3857&imageSR=3857&size=256,256&transparent=true&f=image&${extra}`;
}

export const OVERLAYS: OverlayDef[] = [
  {
    id: "flood",
    label: "Flood",
    color: "#2b6ca3",
    attribution: "FEMA NFHL",
    getTileUrl: esriExport(
      "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export",
      "format=png32",
    ),
  },
  {
    id: "wetlands",
    label: "Wetlands",
    color: "#2f6b4f",
    attribution: "USFWS NWI",
    getTileUrl: esriExport(
      "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/export",
      "format=png32",
    ),
  },
  {
    id: "elevation",
    label: "Slope (hillshade)",
    color: "#5a5346",
    attribution: "USGS 3DEP",
    getTileUrl: esriExport(
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage",
      `format=png&renderingRule=${encodeURIComponent(JSON.stringify({ rasterFunction: "Hillshade Gray" }))}`,
    ),
  },
];

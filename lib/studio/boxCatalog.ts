export type BoxCategory = "carton" | "food" | "luxury" | "flexible" | "cylinder";

export type BoxTypeId =
  | "tuck-end"
  | "mailer"
  | "cake-box"
  | "cylinder"
  | "pillow"
  | "trapezoid"
  | "gable"
  | "sleeve"
  | "pouch"
  | "rigid-box";

export type PanelDefinition = {
  id: string;
  label: string;
  isEditable: boolean;
  bounds: { x: number; y: number; w: number; h: number };
};

export type FoldLine = {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  kind: "fold" | "perforation" | "score";
};

export type UVFaceMap = Record<string, string>;

export type GridLayout = {
  width: number;
  height: number;
  cols: number;
  rows: number;
  cellSize: number;
};

export interface StudioBoxType {
  id: BoxTypeId;
  name: string;
  category: BoxCategory;
  panels: PanelDefinition[];
  foldLines: FoldLine[];
  defaultDimensions: { width: number; height: number; depth: number };
  dieline: {
    svgTemplate: string;
    uvMap: UVFaceMap;
    gridLayout: GridLayout;
  };
  geometry: {
    builderFn: string;
    hasAnimation: boolean;
  };
}

const GRID_4X3: GridLayout = {
  width: 1024,
  height: 768,
  cols: 4,
  rows: 3,
  cellSize: 256,
};

function crossPanels(): PanelDefinition[] {
  return [
    { id: "left", label: "Left face", isEditable: true, bounds: { x: 0, y: 256, w: 256, h: 256 } },
    { id: "front", label: "Front face", isEditable: true, bounds: { x: 256, y: 256, w: 256, h: 256 } },
    { id: "right", label: "Right face", isEditable: true, bounds: { x: 512, y: 256, w: 256, h: 256 } },
    { id: "back", label: "Back face", isEditable: true, bounds: { x: 768, y: 256, w: 256, h: 256 } },
    { id: "top", label: "Top face", isEditable: true, bounds: { x: 256, y: 0, w: 256, h: 256 } },
    { id: "bottom", label: "Bottom face", isEditable: true, bounds: { x: 256, y: 512, w: 256, h: 256 } },
  ];
}

function commonUvMap(): UVFaceMap {
  return {
    front: "panel-front",
    back: "panel-back",
    left: "panel-left",
    right: "panel-right",
    top: "panel-top",
    bottom: "panel-bottom",
  };
}

export const STUDIO_BOX_TYPES: StudioBoxType[] = [
  {
    id: "tuck-end",
    name: "Tuck end box",
    category: "carton",
    panels: crossPanels(),
    foldLines: [],
    defaultDimensions: { width: 80, height: 120, depth: 60 },
    dieline: { svgTemplate: "/templates/tuck-end.svg", uvMap: commonUvMap(), gridLayout: GRID_4X3 },
    geometry: { builderFn: "buildBoxFaces", hasAnimation: true },
  },
  {
    id: "mailer",
    name: "Mailer / shipper box",
    category: "carton",
    panels: crossPanels(),
    foldLines: [],
    defaultDimensions: { width: 140, height: 90, depth: 70 },
    dieline: { svgTemplate: "/templates/mailer.svg", uvMap: commonUvMap(), gridLayout: GRID_4X3 },
    geometry: { builderFn: "buildBoxFaces", hasAnimation: true },
  },
  {
    id: "cake-box",
    name: "Cake carrier box",
    category: "food",
    panels: [
      ...crossPanels(),
      { id: "dome", label: "Dome lid", isEditable: true, bounds: { x: 256, y: 0, w: 256, h: 128 } },
      { id: "handle", label: "Handle", isEditable: true, bounds: { x: 256, y: 0, w: 256, h: 64 } },
    ],
    foldLines: [],
    defaultDimensions: { width: 250, height: 120, depth: 250 },
    dieline: { svgTemplate: "/templates/cake-box.svg", uvMap: commonUvMap(), gridLayout: GRID_4X3 },
    geometry: { builderFn: "buildBoxFaces", hasAnimation: true },
  },
  {
    id: "cylinder",
    name: "Cylinder / tube",
    category: "cylinder",
    panels: [
      { id: "wrap", label: "Wrap label", isEditable: true, bounds: { x: 256, y: 256, w: 768, h: 256 } },
      { id: "top-disc", label: "Top disc", isEditable: true, bounds: { x: 256, y: 0, w: 256, h: 256 } },
      { id: "bottom-disc", label: "Bottom disc", isEditable: true, bounds: { x: 256, y: 512, w: 256, h: 256 } },
    ],
    foldLines: [],
    defaultDimensions: { width: 70, height: 200, depth: 70 },
    dieline: {
      svgTemplate: "/templates/cylinder.svg",
      uvMap: { wrap: "panel-wrap", top: "panel-top-disc", bottom: "panel-bottom-disc" },
      gridLayout: GRID_4X3,
    },
    geometry: { builderFn: "buildBottleFaces", hasAnimation: true },
  },
  {
    id: "pillow",
    name: "Pillow box",
    category: "carton",
    panels: [
      { id: "front", label: "Front face", isEditable: true, bounds: { x: 256, y: 256, w: 256, h: 256 } },
      { id: "back", label: "Back face", isEditable: true, bounds: { x: 768, y: 256, w: 256, h: 256 } },
    ],
    foldLines: [],
    defaultDimensions: { width: 120, height: 70, depth: 35 },
    dieline: { svgTemplate: "/templates/pillow.svg", uvMap: { front: "panel-front", back: "panel-back" }, gridLayout: GRID_4X3 },
    geometry: { builderFn: "buildBoxFaces", hasAnimation: true },
  },
  {
    id: "trapezoid",
    name: "Trapezoid box",
    category: "carton",
    panels: crossPanels(),
    foldLines: [],
    defaultDimensions: { width: 100, height: 110, depth: 75 },
    dieline: { svgTemplate: "/templates/trapezoid.svg", uvMap: commonUvMap(), gridLayout: GRID_4X3 },
    geometry: { builderFn: "buildTrapezoidFaces", hasAnimation: true },
  },
  {
    id: "gable",
    name: "Gable top box",
    category: "food",
    panels: [
      ...crossPanels(),
      { id: "gable-left", label: "Gable left", isEditable: true, bounds: { x: 128, y: 32, w: 128, h: 160 } },
      { id: "gable-right", label: "Gable right", isEditable: true, bounds: { x: 512, y: 32, w: 128, h: 160 } },
    ],
    foldLines: [],
    defaultDimensions: { width: 95, height: 180, depth: 95 },
    dieline: { svgTemplate: "/templates/gable.svg", uvMap: commonUvMap(), gridLayout: GRID_4X3 },
    geometry: { builderFn: "buildBoxFaces", hasAnimation: true },
  },
  {
    id: "sleeve",
    name: "Sleeve / belly band",
    category: "carton",
    panels: [{ id: "wrap", label: "Wrap", isEditable: true, bounds: { x: 256, y: 256, w: 768, h: 256 } }],
    foldLines: [],
    defaultDimensions: { width: 180, height: 55, depth: 85 },
    dieline: { svgTemplate: "/templates/sleeve.svg", uvMap: { wrap: "panel-wrap" }, gridLayout: GRID_4X3 },
    geometry: { builderFn: "buildBoxFaces", hasAnimation: false },
  },
  {
    id: "pouch",
    name: "Stand-up pouch",
    category: "flexible",
    panels: [
      { id: "front", label: "Front", isEditable: true, bounds: { x: 256, y: 256, w: 256, h: 256 } },
      { id: "back", label: "Back", isEditable: true, bounds: { x: 768, y: 256, w: 256, h: 256 } },
      { id: "gusset", label: "Gusset", isEditable: true, bounds: { x: 0, y: 256, w: 256, h: 256 } },
    ],
    foldLines: [],
    defaultDimensions: { width: 140, height: 220, depth: 60 },
    dieline: {
      svgTemplate: "/templates/pouch.svg",
      uvMap: { front: "panel-front", back: "panel-back", gusset: "panel-gusset" },
      gridLayout: GRID_4X3,
    },
    geometry: { builderFn: "buildBoxFaces", hasAnimation: false },
  },
  {
    id: "rigid-box",
    name: "Rigid / luxury box",
    category: "luxury",
    panels: [
      { id: "lid-top", label: "Lid top", isEditable: true, bounds: { x: 256, y: 0, w: 256, h: 256 } },
      { id: "lid-front", label: "Lid front", isEditable: true, bounds: { x: 256, y: 256, w: 256, h: 96 } },
      { id: "lid-back", label: "Lid back", isEditable: true, bounds: { x: 768, y: 256, w: 256, h: 96 } },
      { id: "lid-left", label: "Lid left", isEditable: true, bounds: { x: 0, y: 256, w: 96, h: 256 } },
      { id: "lid-right", label: "Lid right", isEditable: true, bounds: { x: 512, y: 256, w: 96, h: 256 } },
      { id: "base-front", label: "Base front", isEditable: true, bounds: { x: 256, y: 352, w: 256, h: 160 } },
      { id: "base-back", label: "Base back", isEditable: true, bounds: { x: 768, y: 352, w: 256, h: 160 } },
      { id: "base-left", label: "Base left", isEditable: true, bounds: { x: 96, y: 352, w: 160, h: 160 } },
      { id: "base-right", label: "Base right", isEditable: true, bounds: { x: 512, y: 352, w: 160, h: 160 } },
      { id: "base-bottom", label: "Base bottom", isEditable: true, bounds: { x: 256, y: 512, w: 256, h: 256 } },
    ],
    foldLines: [],
    defaultDimensions: { width: 160, height: 85, depth: 120 },
    dieline: {
      svgTemplate: "/templates/rigid-box.svg",
      uvMap: commonUvMap(),
      gridLayout: GRID_4X3,
    },
    geometry: { builderFn: "buildBoxFaces", hasAnimation: true },
  },
];

export function getStudioBoxType(id: string): StudioBoxType | undefined {
  return STUDIO_BOX_TYPES.find((item) => item.id === id);
}

export const BOX_TYPES = [
  "vertical_box",
  "horizontal_box",
  "bottle",
  "cake_box",
  "trapezoid",
] as const;

export type BoxType = (typeof BOX_TYPES)[number];

/** mm — default footprint when user omits custom dimensions */
export function defaultDimensionsMm(boxType: BoxType): {
  width: number;
  height: number;
  depth: number;
} {
  switch (boxType) {
    case "vertical_box":
      return { width: 80, height: 120, depth: 60 };
    case "horizontal_box":
      return { width: 140, height: 90, depth: 70 };
    case "bottle":
      return { width: 70, height: 200, depth: 70 };
    case "cake_box":
      return { width: 250, height: 120, depth: 250 };
    case "trapezoid":
      return { width: 100, height: 110, depth: 75 };
    default:
      return { width: 80, height: 120, depth: 60 };
  }
}

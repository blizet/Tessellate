import { NextResponse } from "next/server";
import { suggestEditsSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

const BASE_SUGGESTIONS = [
  "Make the headline bolder and larger",
  "Increase contrast between text and background",
  "Add a premium accent shape behind the logo",
  "Align copy to a clearer visual hierarchy",
  "Use one brand color as a subtle panel border",
];

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "INVALID_INPUT", message: "Request body must be JSON", statusCode: 400 },
      { status: 400 },
    );
  }

  const parsed = suggestEditsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "INVALID_INPUT",
        message: parsed.error.issues[0]?.message ?? "Invalid request",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  const { panelName, brand } = parsed.data;
  const colorHint = brand.colors[0] ? `Switch accent areas to ${brand.colors[0]}` : "Introduce one bold accent color";
  const styleHint = brand.style ? `Apply a stronger ${brand.style} treatment to this panel` : "Refine the panel for a cleaner premium style";

  const suggestions = [
    `Improve ${panelName} readability with stronger typography`,
    colorHint,
    styleHint,
    ...BASE_SUGGESTIONS.slice(0, 2),
  ].slice(0, 5);

  return NextResponse.json({
    success: true,
    suggestions,
  });
}

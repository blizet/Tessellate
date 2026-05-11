import { NextResponse } from "next/server";
import { STUDIO_BOX_TYPES } from "@/lib/studio/boxCatalog";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    success: true,
    templates: STUDIO_BOX_TYPES,
    count: STUDIO_BOX_TYPES.length,
  });
}

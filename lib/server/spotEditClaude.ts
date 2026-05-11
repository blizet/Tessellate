const CLAUDE_API_VERSION = "2023-06-01";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514";

export type SpotEditOperation =
  | { type: "set-attribute"; elementId: string; attribute: string; value: string }
  | { type: "set-style"; elementId: string; property: string; value: string }
  | { type: "replace-element"; elementId: string; newSVG: string }
  | { type: "remove-element"; elementId: string }
  | {
      type: "insert-element";
      parentId: string;
      svgHTML: string;
      position: "before" | "after" | "append";
    }
  | { type: "set-panel-bg-color"; color: string }
  | { type: "set-text-content"; elementId: string; text: string };

export type SpotEditResponse = {
  operations: SpotEditOperation[];
  description: string;
};

type SpotEditInput = {
  panelImageBase64: string;
  panelSVGSource: string;
  selectedElementIds: string[];
  boxType: string;
  panelName: string;
  brandContext: { name: string; colors: string[]; style: string };
  prompt: string;
};

function claudeApiKey(): string | undefined {
  return (
    process.env.CLAUDE_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_KEY ||
    process.env.CLAUDE_APIKEY
  )?.trim();
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  return JSON.parse(raw);
}

function isHexColor(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

function sanitizeSvgSnippet(svg: string): string {
  // Lightweight defensive sanitization for AI-inserted snippets.
  return svg
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

function sanitizeOperations(input: unknown): SpotEditOperation[] {
  if (!Array.isArray(input)) return [];
  const out: SpotEditOperation[] = [];
  for (const candidate of input) {
    if (!candidate || typeof candidate !== "object") continue;
    const op = candidate as Record<string, unknown>;
    if (op.type === "set-attribute" && typeof op.elementId === "string" && typeof op.attribute === "string" && typeof op.value === "string") {
      out.push({ type: "set-attribute", elementId: op.elementId, attribute: op.attribute, value: op.value });
    } else if (op.type === "set-style" && typeof op.elementId === "string" && typeof op.property === "string" && typeof op.value === "string") {
      out.push({ type: "set-style", elementId: op.elementId, property: op.property, value: op.value });
    } else if (op.type === "replace-element" && typeof op.elementId === "string" && typeof op.newSVG === "string") {
      out.push({ type: "replace-element", elementId: op.elementId, newSVG: sanitizeSvgSnippet(op.newSVG) });
    } else if (op.type === "remove-element" && typeof op.elementId === "string") {
      out.push({ type: "remove-element", elementId: op.elementId });
    } else if (
      op.type === "insert-element" &&
      typeof op.parentId === "string" &&
      typeof op.svgHTML === "string" &&
      (op.position === "before" || op.position === "after" || op.position === "append")
    ) {
      out.push({
        type: "insert-element",
        parentId: op.parentId,
        svgHTML: sanitizeSvgSnippet(op.svgHTML),
        position: op.position,
      });
    } else if (op.type === "set-panel-bg-color" && typeof op.color === "string" && isHexColor(op.color)) {
      out.push({ type: "set-panel-bg-color", color: op.color });
    } else if (op.type === "set-text-content" && typeof op.elementId === "string" && typeof op.text === "string") {
      out.push({ type: "set-text-content", elementId: op.elementId, text: op.text });
    }
  }
  return out;
}

function fallbackPatch(input: SpotEditInput): SpotEditResponse {
  const prompt = input.prompt.toLowerCase();
  const colors = input.brandContext.colors.filter(isHexColor);
  if (prompt.includes("color") || prompt.includes("colour")) {
    const color = colors[0] ?? "#111111";
    return {
      operations: [{ type: "set-panel-bg-color", color }],
      description: `Applied fallback color adjustment to ${input.panelName}.`,
    };
  }

  const target = input.selectedElementIds[0] ?? `${input.panelName}-text-0`;
  return {
    operations: [{ type: "set-text-content", elementId: target, text: input.prompt.slice(0, 80) }],
    description: `Applied fallback text update on ${input.panelName}.`,
  };
}

export async function generateSpotEditPatch(input: SpotEditInput): Promise<SpotEditResponse> {
  const apiKey = claudeApiKey();
  if (!apiKey) return fallbackPatch(input);

  const model = process.env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
  const prompt = `
You are a packaging design assistant. You are given:
1) A PNG image of one panel
2) The raw SVG source for that panel
3) A user instruction describing a specific edit

Return ONLY valid JSON:
{
  "operations": [ ... ],
  "description": "one sentence"
}

Rules:
- Minimal patch only, no full rewrite
- Prefer set-attribute or set-style where possible
- If inserting SVG, only basic elements: rect, circle, text, path, line
- Preserve unrelated element IDs
- Do not output markdown

Context:
Box type: ${input.boxType}
Panel: ${input.panelName}
Brand name: ${input.brandContext.name}
Brand style: ${input.brandContext.style}
Brand colors: ${input.brandContext.colors.join(", ") || "none"}
Selected element IDs: ${input.selectedElementIds.join(", ") || "none"}
Instruction: ${input.prompt}

Panel SVG:
${input.panelSVGSource}
`.trim();

  const body = {
    model,
    max_tokens: 900,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: input.panelImageBase64,
            },
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": CLAUDE_API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return fallbackPatch(input);
    }

    const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = data.content?.find((c) => c.type === "text" && c.text)?.text;
    if (!text) return fallbackPatch(input);

    const parsed = extractJson(text) as { operations?: unknown; description?: unknown };
    const operations = sanitizeOperations(parsed.operations);
    if (!operations.length) return fallbackPatch(input);
    return {
      operations,
      description: typeof parsed.description === "string" ? parsed.description : `Applied spot edit on ${input.panelName}.`,
    };
  } catch {
    return fallbackPatch(input);
  }
}

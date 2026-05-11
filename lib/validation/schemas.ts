import { z } from "zod";
import { BOX_TYPES, type BoxType } from "@/lib/constants/boxTypes";

const boxTypeSchema = z.enum(
  BOX_TYPES as unknown as [BoxType, ...BoxType[]],
);

export const generateDielineSchema = z.object({
  businessName: z.string().min(1, "Business name is required"),
  tagline: z.string().optional(),
  logoBase64: z.string().optional(),
  printDescription: z.string().min(1, "Description is required"),
  boxType: boxTypeSchema,
  customDimensions: z
    .object({
      width: z.number().positive(),
      height: z.number().positive(),
      depth: z.number().positive(),
      unit: z.enum(["mm", "cm", "in"]).optional(),
    })
    .optional(),
  style: z.string().optional(),
});

export const convertTo3dSchema = z.object({
  dielineBase64: z.string().min(1, "dielineBase64 is required"),
  boxType: boxTypeSchema,
  backgroundBase64: z.string().optional(),
  customDimensions: z
    .object({
      width: z.number().positive(),
      height: z.number().positive(),
      depth: z.number().positive(),
    })
    .optional(),
  lightingIntensity: z.number().min(0.2).max(3).optional(),
});

const brandContextSchema = z.object({
  name: z.string().min(1).max(120),
  colors: z.array(z.string().min(1)).max(12).default([]),
  style: z.string().max(200).default(""),
});

export const generatePanelSchema = z.object({
  boxType: z.string().min(1, "boxType is required"),
  panelId: z.string().min(1, "panelId is required"),
  brand: brandContextSchema,
  prompt: z.string().min(3, "Prompt must be at least 3 characters"),
  dimensions: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    depth: z.number().positive(),
  }),
});

export const spotEditSchema = z.object({
  panelImageBase64: z.string().min(1, "panelImageBase64 is required"),
  panelSVGSource: z.string().min(1, "panelSVGSource is required"),
  selectedElementIds: z.array(z.string()).default([]),
  boxType: z.string().min(1),
  panelName: z.string().min(1),
  brandContext: brandContextSchema,
  prompt: z.string().min(2, "Prompt must be at least 2 characters"),
});

export const suggestEditsSchema = z.object({
  panelImageBase64: z.string().optional(),
  panelName: z.string().min(1),
  brand: brandContextSchema,
});

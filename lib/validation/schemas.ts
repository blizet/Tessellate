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

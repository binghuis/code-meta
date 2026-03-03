/**
 * Zod schemas for directory analysis; used for JSON Schema generation and runtime validation.
 */

import * as z from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/** zod-to-json-schema is typed for Zod 3; Zod 4 schemas are compatible at runtime but need a cast. */
type Zod3Compatible = Parameters<typeof zodToJsonSchema>[0];

export const FileAnalysisSchema = z.object({
  name: z.string(),
  purpose: z.string().describe("文件职责，一句话"),
  exports: z.array(z.string()).describe("关键导出名"),
});

export const SubdirAnalysisSchema = z.object({
  name: z.string(),
  summary: z.string().describe("一句话概括子目录"),
});

export const DirAnalysisSchema = z.object({
  summary: z.string().describe("一段话概括该目录的职责、功能、作用，中文"),
  businessDomain: z
    .string()
    .describe("所属业务领域，如「用户系统」「支付」「通用基础设施」"),
  scenarios: z.array(z.string()).describe("使用场景列表，中文"),
  conventions: z.array(z.string()).describe("观察到的编码约定"),
  files: z
    .array(FileAnalysisSchema)
    .describe("该目录下直接文件列表"),
  subdirs: z
    .array(SubdirAnalysisSchema)
    .describe("直接子目录列表"),
});

/** JSON Schema for OpenAI structured output (dir_analysis). */
export function getDirAnalysisJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(DirAnalysisSchema as unknown as Zod3Compatible, {
    target: "openApi3",
    $refStrategy: "none",
  }) as Record<string, unknown>;
}

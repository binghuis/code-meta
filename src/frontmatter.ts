import { stringify } from "yaml";

export function buildFrontmatter(data: Record<string, unknown>): string {
  return stringify(data, { lineWidth: 0 }).trimEnd();
}

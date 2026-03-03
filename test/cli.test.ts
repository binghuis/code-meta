import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli";

describe("cli", () => {
  it("parseArgs parses --help", () => {
    const out = parseArgs(["node", "cli", "--help"]);
    expect(out.help).toBe(true);
  });

  it("parseArgs parses --dry-run and path", () => {
    const out = parseArgs(["node", "cli", "src/foo", "--dry-run"]);
    expect(out.dryRun).toBe(true);
    expect(out.targetPath).toBe("src/foo");
  });

  it("parseArgs parses --depth=N", () => {
    const out = parseArgs(["node", "cli", "--depth=2"]);
    expect(out.depth).toBe(2);
  });

  it("parseArgs parses --emit-only and --force", () => {
    const out = parseArgs(["node", "cli", "--emit-only"]);
    expect(out.emitOnly).toBe(true);
    const out2 = parseArgs(["node", "cli", "--force"]);
    expect(out2.force).toBe(true);
  });

  it("parseArgs parses --version", () => {
    const out = parseArgs(["node", "cli", "-v"]);
    expect(out.version).toBe(true);
  });
});

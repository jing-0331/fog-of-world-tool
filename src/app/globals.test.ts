import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("workflow spacing", () => {
  it("uses one spacing token for workflow sections and action stacks", () => {
    expect(css).toMatch(/--workflow-section-gap:\s*[^;]+;/);
    expect(css).toMatch(
      /\.workflow-shell\s*\{[\s\S]*?gap:\s*var\(--workflow-section-gap\)/,
    );
    expect(css).toMatch(
      /\.workflow-action-stack\s*\{[\s\S]*?gap:\s*var\(--workflow-section-gap\)/,
    );
  });
});

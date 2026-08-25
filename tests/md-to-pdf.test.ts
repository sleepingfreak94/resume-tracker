import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { buildPdfBuffer } from "../lib/md-to-pdf";

const SAMPLE_RESUME = `# Alex Morgan
**Quality Assurance Engineer**
Toronto, ON | alex@example.com | [LinkedIn](https://linkedin.com/in/alex)

## Summary
Quality engineer focused on reliable web applications and accessible user experiences.

## Experience
### Example Company
**Senior QA Engineer** | January 2022 - Present
- Built automated regression coverage for critical customer workflows.
- Partnered with engineering and product teams to improve release quality.

## Skills
**Testing:** Playwright, API testing, accessibility testing
`;

describe("Markdown PDF generation", () => {
  it("creates a readable PDF document from resume Markdown", async () => {
    const buffer = await buildPdfBuffer(SAMPLE_RESUME);
    assert.equal(buffer.subarray(0, 4).toString(), "%PDF");

    const document = await PDFDocument.load(buffer);
    assert.ok(document.getPageCount() >= 1);
    assert.equal(document.getTitle(), "Resume");
  });

  it("preserves Markdown contact links as clickable PDF annotations", async () => {
    const document = await PDFDocument.load(await buildPdfBuffer(SAMPLE_RESUME));
    const annotations = document.getPage(0).node.Annots();
    assert.ok(annotations && annotations.size() >= 1);

    const targets = Array.from({ length: annotations.size() }, (_, index) => {
      const annotation = document.context.lookup(annotations.get(index), PDFDict);
      const action = annotation.lookup(PDFName.of("A"), PDFDict);
      return action.lookup(PDFName.of("URI"), PDFString).decodeText();
    });
    assert.ok(targets.includes("mailto:alex@example.com"));
    assert.ok(targets.includes("https://linkedin.com/in/alex"));
  });

  it("paginates long resumes instead of overflowing one page", async () => {
    const bullets = Array.from({ length: 90 }, (_, index) => `- Achievement ${index + 1} with a measurable result and enough detail to require normal line layout.`).join("\n");
    const document = await PDFDocument.load(await buildPdfBuffer(`# Candidate Name\n\n## Experience\n${bullets}`));
    assert.ok(document.getPageCount() > 1);
  });
});

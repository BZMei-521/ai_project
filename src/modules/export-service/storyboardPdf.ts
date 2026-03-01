import { jsPDF } from "jspdf";
import type { Project, Shot } from "../storyboard-core/types";

const PAGE_MARGIN = 36;
const CARD_HEIGHT = 220;
const CARD_GAP = 18;

export function exportStoryboardPdf(project: Project, shots: Shot[]): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  let y = PAGE_MARGIN;
  let pageShotIndex = 0;

  doc.setFontSize(16);
  doc.text(`${project.name} Storyboard`, PAGE_MARGIN, y);
  y += 24;

  for (const [index, shot] of shots.entries()) {
    if (pageShotIndex === 2) {
      doc.addPage();
      y = PAGE_MARGIN;
      pageShotIndex = 0;
    }

    doc.setDrawColor(148, 163, 184);
    doc.rect(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN * 2, CARD_HEIGHT);

    doc.setFontSize(12);
    doc.text(`Shot ${index + 1}: ${shot.title}`, PAGE_MARGIN + 12, y + 22);
    doc.setFontSize(10);
    doc.text(`Duration: ${shot.durationFrames} frames`, PAGE_MARGIN + 12, y + 40);
    doc.text(`Dialogue: ${shot.dialogue || "-"}`, PAGE_MARGIN + 12, y + 58);

    const notes = doc.splitTextToSize(`Notes: ${shot.notes || "-"}`, pageWidth - PAGE_MARGIN * 2 - 24);
    doc.text(notes, PAGE_MARGIN + 12, y + 76);

    const tags = shot.tags.length > 0 ? shot.tags.join(", ") : "-";
    doc.text(`Tags: ${tags}`, PAGE_MARGIN + 12, y + 130);
    doc.text("Frame placeholder", PAGE_MARGIN + 12, y + 170);

    y += CARD_HEIGHT + CARD_GAP;
    pageShotIndex += 1;
  }

  const safeName = project.name.replace(/[^a-zA-Z0-9-_]+/g, "_");
  doc.save(`${safeName || "storyboard"}.pdf`);
}

import { readFile } from "fs/promises";
import { PDFParse } from "pdf-parse";

export interface PdfReadResult {
  pages: string[];
  totalPages: number;
}

/**
 * Read a PDF file and extract per-page text using pdf-parse v2.
 * Returns an array of page text strings and the total page count.
 */
export async function readPdf(filePath: string): Promise<PdfReadResult> {
  const buffer = await readFile(filePath);

  const pdf = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const textResult = await pdf.getText({ pageJoiner: "" });
    const pages = textResult.pages.map((p) => p.text.trim());
    return { pages, totalPages: textResult.total };
  } finally {
    await pdf.destroy();
  }
}

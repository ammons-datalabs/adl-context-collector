export interface Chunk {
  content: string;
  index: number;
  metadata: {
    page?: number;
    pageEnd?: number;
    heading?: string;
    sourceLabel?: string;
  };
}

export interface IngestOptions {
  domain?: string;
  recursive?: boolean;
  dryRun?: boolean;
}

export interface IngestFileResult {
  filePath: string;
  status: "ingested" | "skipped" | "failed";
  chunkCount: number;
  failedChunks: number;
  skippedDuplicates: number;
  error?: string;
}

export interface IngestDirectoryResult {
  totalFiles: number;
  ingested: number;
  skipped: number;
  failed: number;
  totalChunks: number;
  fileResults: IngestFileResult[];
}

// Chunking constants
export const MAX_CHUNK_CHARS = 6000;   // ~1500 tokens at 4 chars/token
export const MIN_CHUNK_CHARS = 200;    // ~50 tokens
export const OVERLAP_CHARS = 800;      // ~200 tokens for hard-split overlap

export type SupportedFormat = "markdown" | "pdf" | "text";

export function detectFormat(filePath: string): SupportedFormat | null {
  const ext = filePath.toLowerCase().split(".").pop();
  switch (ext) {
    case "md":
    case "markdown":
      return "markdown";
    case "pdf":
      return "pdf";
    case "txt":
      return "text";
    default:
      return null;
  }
}

/*
 * How much can be uploaded at once (delivery notes, invoices). One place, read
 * by the upload form (to warn before sending), by the server (to refuse) and
 * by next.config.ts (the largest request it lets through).
 */

const MB = 1024 * 1024;

/** A phone photo of a multi-page note can be large; 20 MB leaves room. */
export const MAX_FILE_MB = 20;
export const MAX_FILE_BYTES = MAX_FILE_MB * MB;
export const MAX_FILES = 10;
export const MAX_TOTAL_MB = 50;
export const MAX_TOTAL_BYTES = MAX_TOTAL_MB * MB;
/** The largest form the server accepts: all the files plus room for the rest of the form. */
export const MAX_REQUEST = `${MAX_TOTAL_MB + 10}mb` as const;

/** What is wrong with a set of files about to be uploaded, or "" when nothing is. */
export function uploadProblem(files: { name: string; size: number }[]): string {
  const big = files.find((f) => f.size > MAX_FILE_BYTES);
  if (big) return `"${big.name}" is over ${MAX_FILE_MB} MB. Take the photo again at a lower size or upload a PDF.`;
  if (files.length > MAX_FILES) return `Attach at most ${MAX_FILES} files at once.`;
  if (files.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_BYTES) return `Those files add up to more than ${MAX_TOTAL_MB} MB. Upload them in two goes.`;
  return "";
}

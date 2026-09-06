// Extract text from PDF policy documents (some sites publish Terms/Privacy as
// PDFs). unpdf bundles a serverless build of pdf.js that runs in MV3 workers.
import { extractText, getDocumentProxy } from 'unpdf';

export async function pdfToText(arrayBuffer) {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = (Array.isArray(text) ? text.join('\n') : text || '').replace(/[ \t]+/g, ' ').trim();
    return merged || null;
  } catch {
    return null;
  }
}

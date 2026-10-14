import type { ExportResult } from './exporter';

/**
 * Dispara o download do resultado no navegador. Fica separado de `exporter.ts`
 * (que depende da lib de planilhas e roda no Web Worker) para que a thread
 * principal não precise carregar essa lib só para baixar um Blob.
 */
export function downloadBlob({ fileName, blob }: ExportResult): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	// Revogar na hora pode cancelar o download em alguns navegadores.
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

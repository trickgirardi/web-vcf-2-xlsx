import { processFiles, type FileInput } from '$lib/vcard/process-files';
import { buildExport } from '$lib/xlsx/exporter';
import type {
	ConversionProgress,
	FileReadError,
	WorkerFile,
	WorkerRequest,
	WorkerResponse
} from './protocol';

/**
 * Lógica do worker, separada do `self`/`postMessage` para poder ser testada
 * em Node e chamada diretamente (paridade com `processFiles`).
 *
 * Faixas da barra de progresso (`fraction`): leitura 0–5 %, parsing 5–95 %,
 * deduplicação 95–100 %. O tamanho dos arquivos é desconhecido até serem lidos,
 * então a leitura ganha uma faixa fixa e pequena.
 */
const READING_SHARE = 0.05;
const PARSING_SHARE = 0.9;

export type Post = (response: WorkerResponse) => void;

export async function handleRequest(request: WorkerRequest, post: Post): Promise<void> {
	try {
		switch (request.type) {
			case 'process':
				await handleProcess(request.jobId, request.files, post);
				break;
			case 'export': {
				const result = await buildExport(request.contacts, request.fields, request.mode);
				post({ type: 'exported', jobId: request.jobId, result });
				break;
			}
		}
	} catch (error) {
		post({
			type: 'error',
			jobId: request.jobId,
			message: error instanceof Error ? error.message : String(error)
		});
	}
}

async function handleProcess(jobId: number, files: WorkerFile[], post: Post) {
	const progress = (value: ConversionProgress) =>
		post({ type: 'progress', jobId, progress: value });

	const inputs: FileInput[] = [];
	const readErrors: FileReadError[] = [];

	// Leitura sequencial: preserva a ordem dos arquivos (a deduplicação mantém
	// a primeira ocorrência) e limita o pico de memória.
	for (const [index, { id, file }] of files.entries()) {
		progress({
			phase: 'reading',
			fraction: (index / files.length) * READING_SHARE,
			fileName: file.name,
			filesDone: index,
			filesTotal: files.length,
			contactsFound: 0
		});

		try {
			inputs.push({ id, name: file.name, text: await file.text() });
		} catch (error) {
			readErrors.push({
				name: file.name,
				message: error instanceof Error ? error.message : String(error)
			});
		}
	}

	const result = processFiles(inputs, {
		onProgress: (parse) =>
			progress({
				...parse,
				fraction:
					parse.phase === 'parsing'
						? READING_SHARE + parse.fraction * PARSING_SHARE
						: READING_SHARE + PARSING_SHARE,
				// `filesTotal` considera também os arquivos que falharam na leitura.
				filesTotal: files.length
			})
	});

	post({ type: 'processed', jobId, result: { ...result, readErrors } });
}

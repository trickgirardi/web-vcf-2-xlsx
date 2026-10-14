import { deduplicateContacts, type DuplicateContact } from '$lib/domain/contact/deduplicate';
import type { Contact } from '$lib/domain/contact/types';
import { parseVcfFile, type VcfParseError } from './parser';

/**
 * Arquivo já lido (texto puro). Ler o `File` (I/O do browser) é
 * responsabilidade de quem chama `processFiles` — esta função não toca em
 * APIs de DOM/File, só em strings, para rodar sem alteração dentro do Web
 * Worker (ver `$lib/workers`).
 */
export interface FileInput {
	id: string;
	name: string;
	text: string;
}

export interface CardParseError extends VcfParseError {
	fileId: string;
	fileName: string;
}

export type ProcessPhase = 'parsing' | 'deduplicating';

export interface ProcessProgress {
	phase: ProcessPhase;
	/** 0–1, ponderado pelo tamanho (em caracteres) dos arquivos. */
	fraction: number;
	/** Arquivo em processamento (só na fase `parsing`). */
	fileName?: string;
	/** Quantos arquivos já foram totalmente processados. */
	filesDone: number;
	filesTotal: number;
	/** Contatos lidos até agora, antes da deduplicação. */
	contactsFound: number;
}

export interface ProcessFilesOptions {
	/** Emitido com no máximo uma chamada a cada `PROGRESS_INTERVAL_MS` (e sempre no fim de cada arquivo). */
	onProgress?: (progress: ProcessProgress) => void;
}

const PROGRESS_INTERVAL_MS = 50;

export interface ProcessFilesResult {
	/** Contatos únicos, após deduplicação. */
	contacts: Contact[];
	duplicates: DuplicateContact[];
	/** vCards individuais que falharam ao parsear, sem derrubar o arquivo. */
	cardErrors: CardParseError[];
	/** Arquivos que não continham nenhum vCard válido. */
	filesWithNoContacts: string[];
	filesProcessed: number;
	totalContactsFound: number;
}

/**
 * Pipeline completo: VCF (texto) -> vCards -> Contact[] -> deduplicação.
 * (spec, fluxo principal / Etapa 7).
 */
export function processFiles(
	files: FileInput[],
	{ onProgress }: ProcessFilesOptions = {}
): ProcessFilesResult {
	const allContacts: Contact[] = [];
	const cardErrors: CardParseError[] = [];
	const filesWithNoContacts: string[] = [];

	const totalChars = files.reduce((sum, file) => sum + file.text.length, 0);
	let charsDone = 0;
	let lastEmit = Number.NEGATIVE_INFINITY;

	const emit = (file: FileInput, filesDone: number, fileFraction: number, force = false) => {
		if (!onProgress) return;
		const now = performance.now();
		if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return;
		lastEmit = now;

		const done = charsDone + file.text.length * fileFraction;
		onProgress({
			phase: 'parsing',
			fraction: totalChars === 0 ? 1 : done / totalChars,
			fileName: file.name,
			filesDone,
			filesTotal: files.length,
			contactsFound: allContacts.length
		});
	};

	files.forEach((file, index) => {
		const { contacts, errors } = parseVcfFile(
			{ fileId: file.id, fileName: file.name },
			file.text,
			(done, total) => emit(file, index, done / total)
		);

		for (const error of errors) {
			cardErrors.push({ ...error, fileId: file.id, fileName: file.name });
		}

		if (contacts.length === 0) filesWithNoContacts.push(file.name);

		allContacts.push(...contacts);
		emit(file, index + 1, 1, true);
		charsDone += file.text.length;
	});

	onProgress?.({
		phase: 'deduplicating',
		fraction: 1,
		filesDone: files.length,
		filesTotal: files.length,
		contactsFound: allContacts.length
	});

	const { unique, duplicates } = deduplicateContacts(allContacts);

	return {
		contacts: unique,
		duplicates,
		cardErrors,
		filesWithNoContacts,
		filesProcessed: files.length,
		totalContactsFound: allContacts.length
	};
}

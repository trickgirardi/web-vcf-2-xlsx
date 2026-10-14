import type { Contact } from '$lib/domain/contact/types';
import type { ProcessFilesResult } from '$lib/vcard/process-files';
import type { ExportResult } from '$lib/xlsx/exporter';
import type { ContactField, ExportMode } from '$lib/xlsx/types';

/**
 * Protocolo de mensagens entre a UI e o Web Worker. Tudo aqui precisa ser
 * clonável (structured clone): `File`, `Blob` e objetos simples — nada de
 * funções ou instâncias de classe.
 */

export interface WorkerFile {
	id: string;
	file: File;
}

export interface FileReadError {
	name: string;
	message: string;
}

/** Etapas do processamento, na ordem em que ocorrem. */
export type ConversionPhase = 'reading' | 'parsing' | 'deduplicating';

export interface ConversionProgress {
	phase: ConversionPhase;
	/** 0–1, monotônico dentro de um mesmo job. */
	fraction: number;
	/** Arquivo em leitura/parsing no momento, quando aplicável. */
	fileName?: string;
	filesDone: number;
	filesTotal: number;
	contactsFound: number;
}

export interface ProcessedFiles extends ProcessFilesResult {
	/** Arquivos que o navegador não conseguiu ler; os demais seguem normalmente. */
	readErrors: FileReadError[];
}

// --- UI -> worker -----------------------------------------------------------

export type WorkerRequest =
	| { type: 'process'; jobId: number; files: WorkerFile[] }
	| {
			type: 'export';
			jobId: number;
			contacts: Contact[];
			fields: ContactField[];
			mode: ExportMode;
	  };

// --- worker -> UI -----------------------------------------------------------

export type WorkerResponse =
	| { type: 'progress'; jobId: number; progress: ConversionProgress }
	| { type: 'processed'; jobId: number; result: ProcessedFiles }
	| { type: 'exported'; jobId: number; result: ExportResult }
	| { type: 'error'; jobId: number; message: string };

import type { Contact } from '$lib/domain/contact/types';
import type { ExportResult } from '$lib/xlsx/exporter';
import type { ContactField, ExportMode } from '$lib/xlsx/types';
import type {
	ConversionProgress,
	ProcessedFiles,
	WorkerFile,
	WorkerRequest,
	WorkerResponse
} from './protocol';

/** Um trabalho em andamento no worker: resultado + cancelamento. */
export interface Job<T> {
	promise: Promise<T>;
	/** Interrompe o trabalho; `promise` rejeita com `JobCancelledError`. */
	cancel: () => void;
}

export class JobCancelledError extends Error {
	constructor() {
		super('Operação cancelada.');
		this.name = 'JobCancelledError';
	}
}

type WorkerFactory = () => Worker;

const defaultWorkerFactory: WorkerFactory = () =>
	new Worker(new URL('./converter.worker.ts', import.meta.url), { type: 'module' });

interface PendingJob {
	jobId: number;
	onProgress?: (progress: ConversionProgress) => void;
	resolve: (response: WorkerResponse & { type: 'processed' | 'exported' }) => void;
	reject: (error: Error) => void;
}

/**
 * Ponte entre a UI e o Web Worker (`converter.worker.ts`). Um único worker é
 * criado sob demanda e reaproveitado; um job por vez. Cancelar termina o
 * worker (o parsing é síncrono e não consegue ouvir mensagens), e o próximo job
 * cria um worker novo.
 */
export class ConverterClient {
	#createWorker: WorkerFactory;
	#worker: Worker | undefined;
	#nextJobId = 1;
	#pending: PendingJob | undefined;

	constructor(createWorker: WorkerFactory = defaultWorkerFactory) {
		this.#createWorker = createWorker;
	}

	process(
		files: WorkerFile[],
		onProgress?: (progress: ConversionProgress) => void
	): Job<ProcessedFiles> {
		return this.#run(
			(jobId) => ({ type: 'process', jobId, files }),
			onProgress,
			(response) => {
				if (response.type !== 'processed') throw new Error('Resposta inesperada do worker.');
				return response.result;
			}
		);
	}

	export(contacts: Contact[], fields: ContactField[], mode: ExportMode): Job<ExportResult> {
		return this.#run(
			(jobId) => ({ type: 'export', jobId, contacts, fields, mode }),
			undefined,
			(response) => {
				if (response.type !== 'exported') throw new Error('Resposta inesperada do worker.');
				return response.result;
			}
		);
	}

	/** Libera o worker. Qualquer job em andamento é cancelado. */
	dispose() {
		this.#terminate(new JobCancelledError());
	}

	#run<T>(
		buildRequest: (jobId: number) => WorkerRequest,
		onProgress: PendingJob['onProgress'],
		pick: (response: WorkerResponse) => T
	): Job<T> {
		if (this.#pending) {
			throw new Error('Já existe um job em andamento; cancele-o ou aguarde o término.');
		}

		const jobId = this.#nextJobId++;
		const worker = this.#ensureWorker();

		const promise = new Promise<T>((resolve, reject) => {
			this.#pending = {
				jobId,
				onProgress,
				resolve: (response) => {
					try {
						resolve(pick(response));
					} catch (error) {
						reject(error);
					}
				},
				reject
			};
			try {
				worker.postMessage(buildRequest(jobId));
			} catch (error) {
				this.#pending = undefined;
				reject(error);
			}
		});

		return { promise, cancel: () => this.#cancel(jobId) };
	}

	#ensureWorker(): Worker {
		if (this.#worker) return this.#worker;

		const worker = this.#createWorker();
		worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) =>
			this.#onMessage(event.data)
		);
		// Falha ao carregar/executar o script do worker (ex.: bundle quebrado).
		worker.addEventListener('error', (event) => {
			event.preventDefault();
			this.#terminate(new Error(event.message || 'Falha ao executar o worker.'));
		});
		worker.addEventListener('messageerror', () =>
			this.#terminate(new Error('Não foi possível transferir os dados para o worker.'))
		);

		this.#worker = worker;
		return worker;
	}

	#onMessage(response: WorkerResponse) {
		const pending = this.#pending;
		// Mensagens de jobs cancelados/antigos são ignoradas.
		if (!pending || response.jobId !== pending.jobId) return;

		switch (response.type) {
			case 'progress':
				pending.onProgress?.(response.progress);
				return;
			case 'error':
				this.#pending = undefined;
				pending.reject(new Error(response.message));
				return;
			default:
				this.#pending = undefined;
				pending.resolve(response);
		}
	}

	#cancel(jobId: number) {
		if (this.#pending?.jobId !== jobId) return;
		this.#terminate(new JobCancelledError());
	}

	#terminate(reason: Error) {
		const pending = this.#pending;
		this.#pending = undefined;
		this.#worker?.terminate();
		this.#worker = undefined;
		pending?.reject(reason);
	}
}

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { processFiles } from '$lib/vcard/process-files';
import { handleRequest } from './handler';
import type { ConversionProgress, ProcessedFiles, WorkerFile, WorkerResponse } from './protocol';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../vcard/__fixtures__');

function fixtureFile(id: string, name: string, fixture: string): WorkerFile {
	return { id, file: new File([readFileSync(join(fixturesDir, fixture))], name) };
}

async function run(request: Parameters<typeof handleRequest>[0]) {
	const responses: WorkerResponse[] = [];
	await handleRequest(request, (response) => responses.push(response));
	return responses;
}

function progressOf(responses: WorkerResponse[]): ConversionProgress[] {
	return responses.flatMap((r) => (r.type === 'progress' ? [r.progress] : []));
}

describe('handleRequest — process', () => {
	const files = [
		fixtureFile('f1', 'v21.vcf', 'v21.vcf'),
		fixtureFile('f2', 'v30.vcf', 'v30.vcf'),
		fixtureFile('f3', 'v21-repetido.vcf', 'v21.vcf'),
		fixtureFile('f4', 'parcial.vcf', 'partial-invalid.vcf')
	];

	it('produces the same result as calling processFiles directly', async () => {
		const responses = await run({ type: 'process', jobId: 1, files });
		const last = responses.at(-1);
		expect(last?.type).toBe('processed');

		const { readErrors, ...result } = (last as { result: ProcessedFiles }).result;
		const direct = processFiles(
			await Promise.all(
				files.map(async ({ id, file }) => ({ id, name: file.name, text: await file.text() }))
			)
		);

		// `id` dos contatos é aleatório; comparar o restante.
		const strip = (r: typeof direct) => ({
			...r,
			contacts: r.contacts.map(({ id, ...c }) => (void id, c)),
			duplicates: r.duplicates.map((d) => ({
				matchedPhone: d.matchedPhone,
				kept: d.kept.name,
				removed: d.removed.name
			}))
		});
		expect(strip(result)).toEqual(strip(direct));
		expect(readErrors).toEqual([]);
	});

	it('reports progress that never goes backwards, from reading to deduplication', async () => {
		const responses = await run({ type: 'process', jobId: 7, files });
		const progress = progressOf(responses);

		expect(progress.length).toBeGreaterThan(files.length);
		expect(progress[0].phase).toBe('reading');
		expect(progress.at(-1)?.phase).toBe('deduplicating');

		const fractions = progress.map((p) => p.fraction);
		expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
		expect(fractions.every((f) => f >= 0 && f <= 1)).toBe(true);
		expect(responses.every((r) => r.jobId === 7)).toBe(true);
	});

	it('keeps processing the other files when one cannot be read', async () => {
		const unreadable = {
			id: 'bad',
			file: {
				name: 'quebrado.vcf',
				text: () => Promise.reject(new Error('NotReadableError'))
			} as unknown as File
		};

		const responses = await run({
			type: 'process',
			jobId: 1,
			files: [unreadable, fixtureFile('f1', 'v21.vcf', 'v21.vcf')]
		});
		const { result } = responses.at(-1) as { result: ProcessedFiles };

		expect(result.readErrors).toEqual([{ name: 'quebrado.vcf', message: 'NotReadableError' }]);
		expect(result.contacts).toHaveLength(1);
	});

	it('handles an empty selection', async () => {
		const responses = await run({ type: 'process', jobId: 1, files: [] });
		const { result } = responses.at(-1) as { result: ProcessedFiles };

		expect(result.contacts).toEqual([]);
		expect(result.filesProcessed).toBe(0);
	});
});

describe('handleRequest — export', () => {
	it('builds the export and answers with the same job id', async () => {
		const processed = await run({
			type: 'process',
			jobId: 1,
			files: [fixtureFile('f1', 'v21.vcf', 'v21.vcf')]
		});
		const { result } = processed.at(-1) as { result: ProcessedFiles };

		const responses = await run({
			type: 'export',
			jobId: 2,
			contacts: result.contacts,
			fields: ['name', 'phones'],
			mode: 'single-sheet'
		});

		expect(responses).toHaveLength(1);
		expect(responses[0]).toMatchObject({ type: 'exported', jobId: 2 });
		const exported = responses[0] as { result: { fileName: string; blob: Blob } };
		expect(exported.result.fileName).toBe('contatos.xlsx');
		expect(exported.result.blob.size).toBeGreaterThan(0);
	});

	it('answers with an error message instead of throwing', async () => {
		const responses = await run({
			type: 'export',
			jobId: 3,
			contacts: null as never,
			fields: ['name'],
			mode: 'single-sheet'
		});

		expect(responses).toHaveLength(1);
		expect(responses[0]).toMatchObject({ type: 'error', jobId: 3 });
	});
});

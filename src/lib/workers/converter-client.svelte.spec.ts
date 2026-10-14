import { afterEach, describe, expect, it } from 'vitest';
import { ConverterClient, JobCancelledError } from './converter-client';
import type { ConversionProgress } from './protocol';

// Roda no Chromium real (projeto "client"): valida que o bundle do worker
// carrega — inclusive o exceljs — e que o protocolo funciona de ponta a ponta.

const card = (name: string, phone: string) =>
	`BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL:${phone}\nEND:VCARD\n`;

function vcf(name: string, cards: [string, string][]) {
	return { id: name, file: new File([cards.map(([n, p]) => card(n, p)).join('')], name) };
}

describe('ConverterClient (worker real)', () => {
	const clients: ConverterClient[] = [];
	function createClient() {
		const client = new ConverterClient();
		clients.push(client);
		return client;
	}
	afterEach(() => clients.splice(0).forEach((client) => client.dispose()));

	it('processes files in the worker, deduplicates and reports progress', async () => {
		const client = createClient();
		const updates: ConversionProgress[] = [];

		const result = await client.process(
			[
				vcf('a.vcf', [
					['Ana', '+55 47 99999-0001'],
					['Bruno', '47 99999-0002']
				]),
				vcf('b.vcf', [['Ana de novo', '5547999990001']])
			],
			(progress) => updates.push(progress)
		).promise;

		expect(result.totalContactsFound).toBe(3);
		expect(result.contacts.map((c) => c.name)).toEqual(['Ana', 'Bruno']);
		expect(result.duplicates).toHaveLength(1);
		expect(result.readErrors).toEqual([]);
		expect(updates.length).toBeGreaterThan(0);
		expect(updates.at(-1)?.phase).toBe('deduplicating');
	});

	it('exports an XLSX generated inside the worker', async () => {
		const client = createClient();
		const processed = await client.process([vcf('a.vcf', [['Ana', '047999990001']])]).promise;

		const { fileName, blob } = await client.export(
			processed.contacts,
			['name', 'phones'],
			'single-sheet'
		).promise;

		expect(fileName).toBe('contatos.xlsx');
		// XLSX é um ZIP: começa com "PK".
		const header = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
		expect(String.fromCharCode(...header)).toBe('PK');
	});

	it('exports several files as a zip', async () => {
		const client = createClient();
		const processed = await client.process([
			vcf('a.vcf', [['Ana', '111']]),
			vcf('b.vcf', [['Bruno', '222']])
		]).promise;

		const { fileName } = await client.export(processed.contacts, ['name'], 'workbook-per-file')
			.promise;

		expect(fileName).toBe('contatos.zip');
	});

	it('cancels a running job and can start a new one afterwards', async () => {
		const client = createClient();
		const big = vcf(
			'grande.vcf',
			Array.from({ length: 30_000 }, (_, i): [string, string] => [`Contato ${i}`, `${1000 + i}`])
		);

		const job = client.process([big]);
		job.cancel();
		await expect(job.promise).rejects.toBeInstanceOf(JobCancelledError);

		const result = await client.process([vcf('a.vcf', [['Ana', '1']])]).promise;
		expect(result.contacts).toHaveLength(1);
	});

	it('refuses to start a second job while one is running', async () => {
		const client = createClient();
		const first = client.process([vcf('a.vcf', [['Ana', '1']])]);

		expect(() => client.process([vcf('b.vcf', [['Bruno', '2']])])).toThrow(/em andamento/);
		await first.promise;
	});
});

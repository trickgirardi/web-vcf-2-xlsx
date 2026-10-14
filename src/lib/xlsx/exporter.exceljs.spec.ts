import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { buildExport } from './exporter.exceljs';
import type { Contact } from '$lib/domain/contact/types';

let nextId = 0;

function makeContact(overrides: Partial<Contact> = {}): Contact {
	nextId += 1;
	return {
		id: `contact-${nextId}`,
		phones: [],
		emails: [],
		addresses: [],
		websites: [],
		source: { fileId: 'file-1', fileName: 'a.vcf' },
		...overrides
	};
}

async function readWorkbook(blob: Blob): Promise<XLSX.WorkBook> {
	const buffer = await blob.arrayBuffer();
	return XLSX.read(buffer, { type: 'array' });
}

describe('buildExport', () => {
	it('single-sheet: consolidates every contact into one sheet named "Contatos"', async () => {
		const a = makeContact({ name: 'Ana', source: { fileId: 'f1', fileName: 'clientes.vcf' } });
		const b = makeContact({
			name: 'Bruno',
			source: { fileId: 'f2', fileName: 'fornecedores.vcf' }
		});

		const { fileName, blob } = await buildExport([a, b], ['name'], 'single-sheet');
		const workbook = await readWorkbook(blob);

		expect(fileName).toBe('contatos.xlsx');
		expect(workbook.SheetNames).toEqual(['Contatos']);
		const sheet = XLSX.utils.sheet_to_json(workbook.Sheets.Contatos, { header: 1 });
		expect(sheet).toEqual([['Nome'], ['Ana'], ['Bruno']]);
	});

	it('sheet-per-file: one worksheet per source file, in one workbook', async () => {
		const a = makeContact({ name: 'Ana', source: { fileId: 'f1', fileName: 'clientes.vcf' } });
		const b = makeContact({
			name: 'Bruno',
			source: { fileId: 'f2', fileName: 'fornecedores.vcf' }
		});

		const { blob } = await buildExport([a, b], ['name'], 'sheet-per-file');
		const workbook = await readWorkbook(blob);

		expect(workbook.SheetNames).toEqual(['clientes', 'fornecedores']);
		expect(XLSX.utils.sheet_to_json(workbook.Sheets.clientes, { header: 1 })).toEqual([
			['Nome'],
			['Ana']
		]);
		expect(XLSX.utils.sheet_to_json(workbook.Sheets.fornecedores, { header: 1 })).toEqual([
			['Nome'],
			['Bruno']
		]);
	});

	it('sheet-per-file: sanitizes and de-duplicates worksheet names', async () => {
		const a = makeContact({ name: 'Ana', source: { fileId: 'f1', fileName: 'a/b:c.vcf' } });
		const b = makeContact({ name: 'Bruno', source: { fileId: 'f2', fileName: 'a/b:c.vcf' } });

		const { blob } = await buildExport([a, b], ['name'], 'sheet-per-file');
		const workbook = await readWorkbook(blob);

		expect(workbook.SheetNames).toEqual(['a b c', 'a b c (2)']);
	});

	it('workbook-per-file: returns a single .xlsx (no zip) when there is only one source file', async () => {
		const a = makeContact({ name: 'Ana', source: { fileId: 'f1', fileName: 'clientes.vcf' } });
		const b = makeContact({ name: 'Bruno', source: { fileId: 'f1', fileName: 'clientes.vcf' } });

		const { fileName, blob } = await buildExport([a, b], ['name'], 'workbook-per-file');

		expect(fileName).toBe('clientes.xlsx');
		const workbook = await readWorkbook(blob);
		expect(XLSX.utils.sheet_to_json(workbook.Sheets.Contatos, { header: 1 })).toEqual([
			['Nome'],
			['Ana'],
			['Bruno']
		]);
	});

	it('workbook-per-file: zips one .xlsx per source file when there is more than one', async () => {
		const a = makeContact({ name: 'Ana', source: { fileId: 'f1', fileName: 'clientes.vcf' } });
		const b = makeContact({
			name: 'Bruno',
			source: { fileId: 'f2', fileName: 'fornecedores.vcf' }
		});

		const { fileName, blob } = await buildExport([a, b], ['name'], 'workbook-per-file');
		expect(fileName).toBe('contatos.zip');

		const zip = await JSZip.loadAsync(await blob.arrayBuffer());
		expect(Object.keys(zip.files).sort()).toEqual(['clientes.xlsx', 'fornecedores.xlsx']);

		const clientesBuffer = await zip.files['clientes.xlsx'].async('arraybuffer');
		const clientesWorkbook = XLSX.read(clientesBuffer, { type: 'array' });
		expect(XLSX.utils.sheet_to_json(clientesWorkbook.Sheets.Contatos, { header: 1 })).toEqual([
			['Nome'],
			['Ana']
		]);
	});

	it('keeps phone numbers as text cells, preserving leading zeros', async () => {
		const contact = makeContact({
			phones: [{ value: '047999999999', normalized: '047999999999' }]
		});

		const { blob } = await buildExport([contact], ['phones'], 'single-sheet');
		const workbook = await readWorkbook(blob);

		const cell = workbook.Sheets.Contatos.A2;
		expect(cell.t).toBe('s');
		expect(cell.v).toBe('047999999999');
	});

	it('only exports the selected fields', async () => {
		const contact = makeContact({ name: 'Ana', organization: 'Empresa A', jobTitle: 'Gerente' });

		const { blob } = await buildExport([contact], ['name'], 'single-sheet');
		const workbook = await readWorkbook(blob);

		expect(XLSX.utils.sheet_to_json(workbook.Sheets.Contatos, { header: 1 })).toEqual([
			['Nome'],
			['Ana']
		]);
	});
});

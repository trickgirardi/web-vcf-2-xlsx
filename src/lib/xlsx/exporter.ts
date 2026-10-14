import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import type { Contact } from '$lib/domain/contact/types';
import { contactsToRows } from './rows';
import type { ContactField, ExportMode } from './types';

export interface ExportResult {
	fileName: string;
	blob: Blob;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ZIP_MIME = 'application/zip';

interface FileGroup {
	fileId: string;
	fileName: string;
	contacts: Contact[];
}

/**
 * Gera o resultado da exportação (spec, Etapa 11).
 *
 *   Contact[] + selectedFields + exportMode -> XLSX / ZIP
 *
 * Não parseia VCF, não deduplica, não normaliza telefone — recebe os
 * contatos já prontos (tipicamente `ProcessFilesResult.contacts`, já
 * deduplicados). Colunas sempre são texto (ver rows.ts), então nenhum
 * telefone é reinterpretado como número pela biblioteca de XLSX.
 */
export async function buildExport(
	contacts: Contact[],
	fields: ContactField[],
	mode: ExportMode
): Promise<ExportResult> {
	switch (mode) {
		case 'single-sheet':
			return buildSingleSheetWorkbook(contacts, fields);
		case 'sheet-per-file':
			return buildSheetPerFileWorkbook(contacts, fields);
		case 'workbook-per-file':
			return buildWorkbookPerFile(contacts, fields);
	}
}

// --- Modo A: todos os contatos em uma única sheet -------------------------

async function buildSingleSheetWorkbook(
	contacts: Contact[],
	fields: ContactField[]
): Promise<ExportResult> {
	const workbook = new ExcelJS.Workbook();
	addSheet(workbook, 'Contatos', contacts, fields);
	return { fileName: 'contatos.xlsx', blob: xlsxBlob(await workbookToArrayBuffer(workbook)) };
}

// --- Modo B: um workbook, uma sheet por arquivo de origem ------------------

async function buildSheetPerFileWorkbook(
	contacts: Contact[],
	fields: ContactField[]
): Promise<ExportResult> {
	const workbook = new ExcelJS.Workbook();
	const usedNames = new Set<string>();

	for (const group of groupByFile(contacts)) {
		const sheetName = uniqueName(sanitizeSheetName(baseName(group.fileName)), 31, usedNames);
		usedNames.add(sheetName.toLowerCase());
		addSheet(workbook, sheetName, group.contacts, fields);
	}

	return { fileName: 'contatos.xlsx', blob: xlsxBlob(await workbookToArrayBuffer(workbook)) };
}

// --- Modo C: um XLSX por arquivo de origem, agrupados em .zip se houver >1 -

async function buildWorkbookPerFile(
	contacts: Contact[],
	fields: ContactField[]
): Promise<ExportResult> {
	const groups = groupByFile(contacts);
	const usedNames = new Set<string>();

	const files = await Promise.all(
		groups.map(async (group) => {
			const workbook = new ExcelJS.Workbook();
			addSheet(workbook, 'Contatos', group.contacts, fields);
			const fileName = uniqueName(
				`${sanitizeFileName(baseName(group.fileName))}.xlsx`,
				Infinity,
				usedNames
			);
			usedNames.add(fileName.toLowerCase());
			return { fileName, data: await workbookToArrayBuffer(workbook) };
		})
	);

	if (files.length === 0) {
		return {
			fileName: 'contatos.xlsx',
			blob: xlsxBlob(await workbookToArrayBuffer(new ExcelJS.Workbook()))
		};
	}

	if (files.length === 1) {
		const [only] = files;
		return { fileName: only.fileName, blob: xlsxBlob(only.data) };
	}

	// ArrayBuffer, não Blob: `Blob` só é "suportado" pelo jszip quando o
	// runtime expõe `FileReader` (API de browser) — quebraria os testes,
	// que rodam em Node.
	const zip = new JSZip();
	for (const file of files) zip.file(file.fileName, file.data);
	const zipData = await zip.generateAsync({ type: 'arraybuffer' });

	return { fileName: 'contatos.zip', blob: new Blob([zipData], { type: ZIP_MIME }) };
}

// --- Helpers ----------------------------------------------------------------

function addSheet(
	workbook: ExcelJS.Workbook,
	name: string,
	contacts: Contact[],
	fields: ContactField[]
) {
	const { headers, rows } = contactsToRows(contacts, fields);
	const sheet = workbook.addWorksheet(name);
	sheet.addRows([headers, ...rows]);
}

async function workbookToArrayBuffer(workbook: ExcelJS.Workbook): Promise<ArrayBuffer> {
	// Os tipos do exceljs declaram `Buffer extends ArrayBuffer`, mas em runtime
	// `writeBuffer` devolve um Uint8Array (Buffer no Node), possivelmente uma
	// view sobre um ArrayBuffer maior — copiamos só a fatia relevante.
	const bytes = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
	const { buffer, byteOffset, byteLength } = bytes;
	return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

function xlsxBlob(data: ArrayBuffer): Blob {
	return new Blob([data], { type: XLSX_MIME });
}

/** Agrupa por arquivo de origem, preservando a ordem de primeira aparição. */
function groupByFile(contacts: Contact[]): FileGroup[] {
	const groups = new Map<string, FileGroup>();

	for (const contact of contacts) {
		const key = contact.source.fileId;
		const existing = groups.get(key);
		if (existing) {
			existing.contacts.push(contact);
		} else {
			groups.set(key, { fileId: key, fileName: contact.source.fileName, contacts: [contact] });
		}
	}

	return [...groups.values()];
}

function baseName(fileName: string): string {
	return fileName.replace(/\.vcf$/i, '');
}

const INVALID_SHEET_NAME_CHARS = /[:\\/?*[\]]/g;

/** Nomes de worksheet no Excel: sem `: \ / ? * [ ]`, no máximo 31 caracteres, nunca vazio. */
function sanitizeSheetName(name: string): string {
	const cleaned = name
		.replace(INVALID_SHEET_NAME_CHARS, ' ')
		.replace(/^'+|'+$/g, '')
		.trim();
	return cleaned.length > 0 ? cleaned.slice(0, 31) : 'Contatos';
}

const INVALID_FILE_NAME_CHARS = /[\\/:*?"<>|]/g;

function sanitizeFileName(name: string): string {
	const cleaned = name.replace(INVALID_FILE_NAME_CHARS, ' ').trim();
	return cleaned.length > 0 ? cleaned : 'contatos';
}

/** Garante nome único (case-insensitive), truncando pra caber no `maxLength` com o sufixo " (N)". */
function uniqueName(name: string, maxLength: number, used: Set<string>): string {
	if (!used.has(name.toLowerCase())) return name;

	const dot = name.lastIndexOf('.');
	const base = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';

	for (let suffixNumber = 2; ; suffixNumber += 1) {
		const suffix = ` (${suffixNumber})`;
		const budget = Number.isFinite(maxLength)
			? maxLength - suffix.length - ext.length
			: base.length;
		const candidate = `${base.slice(0, Math.max(budget, 0))}${suffix}${ext}`;
		if (!used.has(candidate.toLowerCase())) return candidate;
	}
}

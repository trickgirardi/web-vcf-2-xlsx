import VCard from 'vcf';
import type { Contact, ContactSource } from '$lib/domain/contact/types';
import { vcardToContact } from './normalize';

export interface VcfParseError {
	/** Índice do cartão dentro do arquivo (0-based), quando identificável. */
	index: number;
	message: string;
}

export interface ParsedVcfFile {
	contacts: Contact[];
	errors: VcfParseError[];
}

/**
 * Único ponto do projeto que conhece a biblioteca `vcf`. Responsabilidade
 * (ver spec, Etapa 4):
 *
 *   VCF (texto) -> vCard parseado -> Contact normalizado
 *
 * Não faz deduplicação nem normalização de telefone além do que
 * `vcardToContact` já delega para `normalizePhone`.
 *
 * Um vCard malformado dentro do arquivo não interrompe os demais: cada
 * bloco `BEGIN:VCARD ... END:VCARD` é parseado isoladamente.
 */
export function parseVcfFile(
	source: ContactSource,
	text: string,
	onCardParsed?: CardProgressCallback
): ParsedVcfFile {
	const { cards, errors } = parseVcfText(text, onCardParsed);
	const contacts = cards.map((card) => vcardToContact(card, source));
	return { contacts, errors };
}

/** Chamado após cada vCard do arquivo (com sucesso ou não): `done` de `total`. */
export type CardProgressCallback = (done: number, total: number) => void;

interface VcfParseResult {
	cards: VCard[];
	errors: VcfParseError[];
}

function parseVcfText(text: string, onCardParsed?: CardProgressCallback): VcfParseResult {
	const blocks = splitVcardBlocks(normalizeLineEndings(text));
	const cards: VCard[] = [];
	const errors: VcfParseError[] = [];

	blocks.forEach((block, index) => {
		try {
			cards.push(new VCard().parse(block));
		} catch (error) {
			errors.push({ index, message: error instanceof Error ? error.message : String(error) });
		}
		onCardParsed?.(index + 1, blocks.length);
	});

	return { cards, errors };
}

/**
 * A lib `vcf` assume quebras de linha `\r\n` (RFC 6350) para unfolding e
 * split. Arquivos reais frequentemente vêm com `\n` puro (exportados de
 * Linux/macOS) — sem essa normalização o parsing falha silenciosamente.
 */
function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n|\r|\n/g, '\r\n');
}

/** Mesma regra de split usada por `VCard.parse`, mas com try/catch por bloco. */
function splitVcardBlocks(text: string): string[] {
	return text
		.split(/(?=BEGIN:VCARD)/gi)
		.map((block) => block.trim())
		.filter((block) => block.length > 0);
}

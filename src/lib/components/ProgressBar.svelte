<script lang="ts">
	import type { ConversionProgress } from '$lib/workers/protocol';

	let { progress, onCancel }: { progress: ConversionProgress | null; onCancel: () => void } =
		$props();

	const PHASE_LABELS = {
		reading: 'Lendo arquivos',
		parsing: 'Processando contatos',
		deduplicating: 'Removendo duplicatas'
	} as const;

	const numberFormat = new Intl.NumberFormat('pt-BR');

	const percent = $derived(Math.min(100, Math.round((progress?.fraction ?? 0) * 100)));
	const label = $derived(progress ? PHASE_LABELS[progress.phase] : 'Iniciando');
</script>

<div class="space-y-2" aria-live="polite">
	<div class="flex items-baseline justify-between gap-4 text-sm">
		<p class="font-medium">{label}…</p>
		<p class="text-zinc-400 tabular-nums">{percent}%</p>
	</div>

	<div
		role="progressbar"
		aria-label="Progresso do processamento"
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={percent}
		class="h-2 overflow-hidden rounded-full bg-zinc-800"
	>
		<div
			class="h-full rounded-full bg-emerald-500 transition-[width] duration-150"
			style:width="{percent}%"
		></div>
	</div>

	<div class="flex items-center justify-between gap-4 text-xs text-zinc-400">
		<p class="min-w-0 truncate">
			{#if progress}
				{#if progress.fileName}{progress.fileName} ·
				{/if}{progress.filesDone}/{progress.filesTotal}
				{progress.filesTotal === 1 ? 'arquivo' : 'arquivos'}
				{#if progress.contactsFound > 0}
					· {numberFormat.format(progress.contactsFound)} contatos lidos{/if}
			{/if}
		</p>
		<button
			type="button"
			class="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
			onclick={onCancel}
		>
			Cancelar
		</button>
	</div>
</div>

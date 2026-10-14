# Core Spec — VCF to XLSX Converter

> Documento de referência do escopo do projeto. Define a finalidade, o que entra na **v1** e o que fica para **melhorias futuras**.
> Última atualização: 2026-10-14.

## 1. Finalidade

Aplicação web que converte um ou vários arquivos de contatos **VCF (vCard)** em planilhas **XLSX**, removendo contatos duplicados pelo número de telefone.

**Princípios**

- **Privacidade primeiro:** todo o processamento ocorre no navegador. Nenhum contato é enviado a servidor. O deploy (Cloudflare Workers) serve apenas arquivos estáticos.
- **Nada some em silêncio:** todo contato removido, ignorado ou inválido é reportado ao usuário.
- **Telefone é texto:** nunca é convertido em número (preserva `+`, zeros à esquerda etc.).
- **Simples:** fluxo único em uma página — importar → revisar → exportar.

**Público:** pessoas que precisam migrar, limpar ou consolidar agendas de contatos exportadas de celulares, Google Contacts, iCloud etc.

## 2. Estado atual (base de partida)

Já implementado e testado (32 testes unitários passando):

| Área          | O que existe                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Parsing       | VCF 2.1/3.0/4.0 → `Contact`; cada vCard é parseado isoladamente (um inválido não derruba o arquivo)  |
| Deduplicação  | Por telefone normalizado (só dígitos), mantém a primeira ocorrência, registra as removidas            |
| Exportação    | 3 modos (`single-sheet`, `sheet-per-file`, `workbook-per-file`), todos os campos, colunas numeradas   |
| UI            | Seleção de arquivos, resumo do processamento, lista de duplicatas (somente leitura), download XLSX    |

Lacunas que a v1 fecha: modo de exportação não selecionável na UI, revisão de duplicatas passiva, processamento na thread principal, sem progresso, sem drag & drop, README e resíduos do template.

## 3. Escopo da v1

### 3.1 Importação e conversão (um ou vários arquivos)

- Aceita um ou vários `.vcf` por seleção ou por drag & drop (ver 3.5).
- Arquivos com extensão inválida ou vazios são rejeitados individualmente, sem bloquear os demais (já existe).
- Saída: um XLSX consolidado, uma planilha por arquivo, ou um XLSX por arquivo (ver 3.2).
- Campos exportados na v1: nome, telefones, e-mails, empresa, cargo, endereços, aniversário, sites, notas (todos, sem seleção).

**Critérios de aceite**

- Converter 1 arquivo e N arquivos gera o resultado esperado em cada modo.
- Um vCard malformado não impede os demais; a contagem de ignorados aparece no resumo.

### 3.2 Opções de exportação

O usuário escolhe, antes de baixar, o modo de saída:

| Modo                | Resultado                                                                 |
| ------------------- | ------------------------------------------------------------------------- |
| Planilha única      | Todos os contatos únicos em uma sheet (`contatos.xlsx`)                   |
| Uma aba por arquivo | Um workbook, uma sheet por VCF de origem                                  |
| Um XLSX por arquivo | Um XLSX por VCF; `.zip` se houver mais de um                              |

A lógica já existe em [exporter.ts](../src/lib/xlsx/exporter.ts); a v1 entrega o **seletor na UI** e o estado de exportação (loading + erro).

**Critérios de aceite**

- O modo padrão é "planilha única".
- Falha na geração do arquivo exibe mensagem ao usuário (hoje não há `catch`).
- Nomes de sheet e de arquivo continuam sanitizados e únicos.

### 3.3 Revisão de duplicatas por número

- Critério de duplicidade: **compartilhar ao menos um telefone normalizado** (regra atual, conservadora: sem inferir código de país).
- A lista mostra, para cada duplicata, o contato mantido, o removido, o arquivo de origem de cada um e o número que coincidiu (já existe).
- **Novo na v1:** o usuário pode **restaurar** um contato removido (incluí-lo no resultado mesmo assim) antes de exportar, e desfazer a restauração. O resumo e a exportação refletem a decisão.
- Contatos sem telefone nunca são considerados duplicados.

**Critérios de aceite**

- Restaurar um contato atualiza as contagens do resumo e o conteúdo exportado.
- A deduplicação continua sendo uma função pura, O(n), testada por unidade.

### 3.4 Processamento em Web Worker + barra de progresso

- Leitura, parsing, normalização e deduplicação rodam em um **Web Worker**, mantendo a UI responsiva com arquivos grandes. A geração do XLSX também deve rodar no worker se a medição mostrar travamento.
- `processFiles` já recebe apenas strings (sem DOM), então é reaproveitado sem mudança de contrato.
- O worker emite eventos de progresso (arquivo atual, arquivos concluídos/total, contatos lidos); a UI mostra uma **barra de progresso** e permite **cancelar**.
- A deduplicação roda após o parsing de todos os arquivos, pois depende da ordem (primeira ocorrência é mantida). A ordem dos arquivos deve ser preservada.

**Critérios de aceite**

- Processar ~50 mil contatos não congela a interface (a barra anima e o botão cancelar responde).
- O resultado do worker é idêntico ao de `processFiles` chamado diretamente (teste de paridade).
- Erros dentro do worker chegam à UI como mensagem, sem travar o estado "processando".

### 3.5 Drag & drop

- Área de upload aceita arquivos soltos, além do seletor atual, com estado visual de "arrastando sobre".
- Mesmas regras de validação do seletor (extensão, arquivo vazio).
- Continua acessível por teclado (o input de arquivo permanece como alternativa).

### 3.6 Limpeza de arquivos residuais

Remover o que sobrou do template `sv` e não é usado:

- `src/lib/vitest-examples/` (componente e testes de exemplo)
- Placeholder vazio em `src/lib/index.ts`, se continuar sem uso
- Textos do template no README e na UI que mencionem "próximas etapas"
- Revisar `.cursor/`, `.opencode/` e `AGENTS.md` (ferramentas de IA do template): manter só o que o time usa

### 3.7 README real e simples

Conteúdo mínimo: o que o app faz, a promessa de privacidade, como rodar (`pnpm install && pnpm dev`), scripts principais (`test`, `check`, `lint`, `build`), onde está o deploy e link para este `core-spec`.

### 3.8 Decisão de biblioteca XLSX: `xlsx` vs `exceljs`

Avaliar **antes de investir em novas features de exportação**, com um spike curto.

| Critério               | `xlsx` (SheetJS 0.18.5 no npm)                                                                  | `exceljs`                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Manutenção             | A versão do npm está congelada; versões novas só saem pelo CDN da SheetJS                       | Publicada no npm, mantida de forma irregular                      |
| Segurança              | Advisories conhecidos em versões antigas, relativos a **leitura** de arquivos não confiáveis     | Sem o mesmo histórico, mas com dependências próprias a auditar    |
| Uso no app (hoje)      | Só **escrita** de XLSX, o que reduz a exposição                                                  | Cobre escrita com estilos, larguras de coluna, formatação de célula |
| Tamanho do bundle      | Menor                                                                                           | Maior (medir; relevante para carregar no worker)                  |
| Caminho inverso (futuro) | Exigiria **ler** XLSX do usuário: aqui as vulnerabilidades passam a importar                  | Também lê XLSX                                                    |

**Resultado do spike (2026-10-14, branch `spike/exceljs`, medido em Node 24; não foi testado em navegador nem dentro de um Worker):**

| Medida                                | `xlsx` 0.18.5               | `exceljs` 4.4.0              |
| ------------------------------------- | --------------------------- | ---------------------------- |
| Suíte de exportação (3 modos, texto)  | 19/19 (referência)          | 19/19 (mesmos testes)        |
| 10 mil contatos, planilha única       | ~220–270 ms                 | ~345 ms                      |
| 50 mil contatos, planilha única       | ~1,2 s                      | ~1,6 s                       |
| Tamanho do arquivo, 50 mil contatos   | 18 MB (sem compressão)      | 2 MB                         |
| Idem, `xlsx` com `compression: true`  | 4,3 MB                      | 2 MB                         |
| Bundle do cliente (gzip)              | ~157 KB total (chunk 126 KB) | ~316 KB total (chunk 285 KB) |
| `pnpm audit --prod`                   | 2 *high* (prototype pollution e ReDoS do `xlsx`) | +1 *moderate* (`uuid`, via `exceljs`) |

Observações:

- A medição de memória (heap) foi inconclusiva por causa do GC; não use esse número.
- O `exceljs` publicou a última versão (4.4.0) em out/2023, então também está sem releases novas.
- O `xlsx` atual grava **sem compressão** por padrão. Ligar `compression: true` em [exporter.ts](../src/lib/xlsx/exporter.ts) reduz o arquivo em ~4x, independentemente da decisão de troca.

**Decisão:** migrar para `exceljs`. É a única opção que zera os *high* do `pnpm audit --prod` exigidos em 3.9 sem depender de tarball fora do npm. O custo é ~1,3x de tempo de geração e +~160 KB gzip no bundle, que carrega uma vez e, com o worker, não bloqueia a UI. Se o custo de bundle incomodar, a alternativa é o tarball oficial da SheetJS. Em ambos os casos a troca fica isolada em [xlsx/](../src/lib/xlsx/).

**Próximos passos da migração:**

- Substituir [exporter.ts](../src/lib/xlsx/exporter.ts) pela versão `exporter.exceljs.ts` do spike (mesma API, `buildExport` continua assíncrono).
- Manter `xlsx` como devDependency só nos testes, que leem o arquivo gerado como oráculo independente (ou migrar a leitura nos testes para `exceljs`).
- Remover `xlsx` das dependências de produção e reexecutar o `pnpm audit --prod`.
- Validar o carregamento do `exceljs` dentro do Web Worker (3.4).

### 3.9 Qualidade mínima da v1

- `pnpm check`, `pnpm lint` e `pnpm test` passando em CI. O projeto "client" do vitest requer Chromium do Playwright instalado; documentar ou instalar no CI.
- Testes unitários para: restauração de duplicatas, paridade do worker, validação de drag & drop (lógica extraída para função pura) e seleção de modo.
- `pnpm audit --prod` sem vulnerabilidades *high* nas dependências de produção.

## 4. Fora da v1 (melhorias futuras)

| Item                          | Descrição                                                                                                       | Observação                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Seleção de colunas            | Escolher quais campos exportar e a ordem                                                                        | `contactsToRows` já recebe `fields`; falta UI                           |
| Deduplicação por e-mail/nome  | Critérios adicionais e configuráveis                                                                            | Definir como tratar falsos positivos (ex.: homônimos)                   |
| Normalização com código de país | Tratar `47999999999` e `5547999999999` como o mesmo número                                                    | Provável uso de `libphonenumber-js`; exige configuração de país padrão  |
| Merge de duplicatas           | Combinar telefones, e-mails e demais campos em vez de descartar o removido                                      | Depende dos critérios acima                                             |
| Suporte a mais dados          | Foto, prefixo/sufixo do nome, categorias, campos `X-`, quoted-printable/charsets                                | Ampliar o modelo `Contact` e as fixtures                                |
| Testes E2E                    | Fluxo completo no navegador (importar → duplicatas → exportar)                                                  | Playwright já é dependência                                             |
| Exportação em CSV             | Mesmo pipeline de `rows.ts`, outro formato de saída                                                             | Atenção a encoding (UTF-8 com BOM) e separador                          |
| Caminho inverso (XLSX → VCF)  | Importar planilhas e gerar vCards                                                                               | Exige leitura de XLSX não confiável; reforça o critério de segurança da biblioteca |

## 5. Arquitetura

```text
 UI (SvelteKit, thread principal)           Web Worker
 ───────────────────────────────           ─────────────────────────────
 seleção / drag & drop  ──File.text()──►   processFiles(files)
 barra de progresso     ◄──progress────      ├─ parseVcfFile  (vcf → Contact)
 revisão de duplicatas  ◄──result──────      └─ deduplicateContacts
 escolha do modo        ──contacts+modo─►   buildExport (XLSX/ZIP)  [se necessário]
 download               ◄──Blob────────
```

Módulos e responsabilidades (já existentes):

- `src/lib/vcard/` — único ponto que conhece a lib `vcf`; produz `Contact`.
- `src/lib/domain/contact/` — modelo `Contact`, normalização de telefone e deduplicação (funções puras).
- `src/lib/xlsx/` — conversão `Contact` → linhas e geração de XLSX/ZIP (único ponto que conhece a lib de planilha).
- `src/lib/components/` — componentes de apresentação.
- **Novo:** `src/lib/workers/` — worker e protocolo de mensagens (tipado) entre UI e worker.

Regra de dependência: a UI e o exportador só enxergam `Contact`; nenhum dado bruto do VCF vaza para fora de `vcard/`.

## 6. Modelo de dados

`Contact` conforme [types.ts](../src/lib/domain/contact/types.ts): `id`, nome (completo, primeiro, do meio, sobrenome), `phones[]` (`value` original + `normalized`), `emails[]`, `organization`, `jobTitle`, `addresses[]`, `birthday`, `websites[]`, `notes` e `source` (`fileId`, `fileName`). O valor original do telefone nunca é descartado; a versão normalizada serve apenas de chave de comparação.

## 7. Fluxo do usuário (v1)

1. **Importar:** seleciona ou arrasta um ou mais `.vcf`; vê a lista e os avisos de arquivos ignorados.
2. **Processar:** clica em processar; acompanha a barra de progresso (pode cancelar).
3. **Revisar:** vê o resumo (arquivos, encontrados, únicos, duplicados, inválidos) e a lista de duplicatas; restaura os contatos que quiser manter.
4. **Exportar:** escolhe o modo de exportação e baixa o XLSX (ou ZIP).

## 8. Fora de escopo permanente

- Qualquer envio de contatos a servidor, conta de usuário ou armazenamento remoto.
- Sincronização com Google/iCloud.
- Edição manual de contatos dentro do app.

## 9. Critérios de pronto da v1

- [ ] Todos os itens de 3.1 a 3.7 entregues e com seus critérios de aceite verificados.
- [ ] Decisão sobre `xlsx` vs `exceljs` registrada (3.8) e, se houver troca, aplicada com a suíte de exportação verde.
- [ ] `pnpm check`, `pnpm lint` e `pnpm test` verdes; audit de produção sem *high*.
- [ ] Teste manual com um VCF real de ~10 mil contatos, sem travar a interface.
- [ ] README publicado e resíduos do template removidos.

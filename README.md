# Projeto 6 - Simulador Simples Nacional (CTG)

Simulador web interno para estimar o DAS mensal do Simples Nacional em 2026,
com memoria de calculo por atividade, segmento, tributo e ente federativo.

> Simulacao de apoio. Nao substitui o PGDAS-D, a legislacao vigente nem a
> revisao do profissional fiscal. Uso produtivo depende de homologacao fiscal.

## Como rodar e testar no navegador

URL publica de teste no launcher da Plataforma CTG:
https://jhonyrock21.github.io/simulador-simples-nacional/

Pre-requisito: Node.js LTS instalado (https://nodejs.org).

1. De dois cliques em **`Iniciar Simulador Simples Nacional.bat`**.
   - Na primeira vez ele instala as dependencias sozinho.
   - Deixe a janela preta aberta; fecha-la derruba o servidor.
2. Abra no navegador: **http://localhost:8100**
   - Na rede interna, use `http://SEU-IP:8100` (troque pelo IP do PC).

Alternativa pelo terminal, dentro da pasta do projeto:

```powershell
npm install        # so na primeira vez
npm run dev        # servidor de desenvolvimento em http://localhost:8100
```

Para gerar a versao estatica (build de distribuicao, ainda nao publicada):

```powershell
npm run build      # gera a pasta dist/
npm run preview    # serve o build em http://localhost:8100
```

## Como usar a tela

- Preencha **empresa e periodo** (data de abertura e competencia de 2026).
- Opcionalmente, arraste ou selecione o **Extrato DAS/PGDAS-D em PDF** no bloco
  **Importar Extrato DAS**. A leitura e local no navegador: nenhum arquivo ou
  dado fiscal e enviado para servidor/API. O importador preenche dados
  reconhecidos (empresa, CNPJ, PA, abertura, RBT12/RBA/RBAA, historico mensal e
  algumas receitas de revenda), le os streams byte a byte com fallback local
  para PDF compactado e busca as parcelas ate a proxima atividade do PDF antes
  de mostrar um resumo para revisao. A receita do PA do extrato tambem fica
  guardada no mes correspondente: ao importar junho e selecionar julho, a linha
  de junho no historico e preenchida pelo RPA do proprio PDF.
  As tabelas mensais sao delimitadas pelos titulos completos `2.2.1)`,
  `2.2.2)`, `2.3)` e `2.4)`, evitando misturar Mercado Interno e Mercado
  Externo com numeros presentes na versao do PGDAS-D ou nos valores monetarios.
- O **CNPJ** e opcional e pode ser digitado so com numeros; a tela aplica a
  mascara `00.000.000/0000-00` automaticamente.
- Em **Base RBT12 e folha**, empresa com 12 meses ou mais usa o modo rapido:
  informe a RBT12 como na planilha. Se houver exportacao, separe a parcela de
  exportacao; se nao houver, preencha somente mercado interno.
- Para empresa aberta ha menos de 12 meses, ou para conferir sublimite/excesso,
  use **Historico mensal**. Meses sem receita entram como zero e continuam
  contando no divisor; nao anualize valores manualmente.
- **Sublimite de ICMS/ISS** fica em uma area avancada. Em cenario comum abaixo
  do sublimite, pode ficar zerado; use quando houver faixa 6, excesso,
  impedimento ou necessidade de conferir ICMS/ISS fora do DAS.
- Em **atividades**, escolha Anexo manual ou Fator R (III/V) e distribua a
  receita do PA pelos **segmentos**. Os totais sao somados automaticamente.
- Os valores em dinheiro usam **máscara automática**: digite só os números que
  os centavos entram pela direita (5505555 vira 55.055,55).
- O painel à direita mostra o **Total do DAS**, os tributos, a destinação para
  União/Estado/Município, os avisos fiscais e a **memória de cálculo**.
- Quando houver simulação válida, use **Baixar PDF** ou **Baixar Excel** para
  gerar a memória da simulação atual direto no navegador. Os arquivos usam as
  cores institucionais da Contalger em formato de documento sério; o PDF também
  inclui o ícone da CTG no cabeçalho e o Excel usa layout de relatório com
  colunas largas, seções mescladas e grade visual reduzida.
- Botão **Como usar** (no topo): abre as instruções e a lógica dos cálculos.

O motor é conferido contra a planilha de referência por testes automatizados
(`npm test`).

Nenhum dado sai do navegador: a simulacao roda 100% no cliente, sem servidor de
dados, login ou API.

## Verificar o codigo (motor e interface)

```powershell
npm test           # 92 testes (motor fiscal + parser/mascara + XLSX + PDF DAS)
npm run typecheck  # verificacao de tipos
```

## Estrutura

| Arquivo | Responsabilidade |
|---|---|
| `src/rules-2026.ts` | Tabelas, faixas, reparticoes, segmentos, vigencia e fontes. |
| `src/calc.ts` | Motor puro: calculo, validacoes, totais e memoria. Autoridade unica. |
| `src/sublimit.ts` | Sublimites, limites proporcionais e efeitos temporais. |
| `src/money.ts` | Leitura/formatacao de valores em pt-BR (usado pela interface). |
| `src/app.ts` | Interface: coleta dados, chama `simulate` e apresenta o resultado. |
| `index.html`, `src/styles.css` | Tela unica com a identidade CTG. |
| `tests/` | Testes do motor, do parser/mascara e do gerador de planilha. |

Estado atual: Fase 2 (interface) entregue para teste e registrada no launcher
como modulo web `semente`. Homologacao fiscal com o PGDAS-D (Fase 3) e uso
produtivo ainda dependem de acao humana.

ROI-NADOS V12 — Enterprise Command Center

Arquivos modulares de substituição:
01-enterprise-command-center.css  -> bloco visual V12; inserir antes de </style>.
02-navbar.html                    -> substitui o header antigo e mantém os IDs existentes.
03-overview-command-grid.html     -> substitui o início da seção #view-overview.
04-overview-lower-renderer.js     -> renderiza Top Países e Compras Recentes com dados já existentes.
05-hero-globe-runtime.js          -> controles e renderer do globo hero.

Regras preservadas:
- dashboard-view.js continua exportado por uma única template string Node.js.
- nenhum conteúdo interno novo usa crase.
- nenhum conteúdo interno usa interpolação de template.
- IDs de telemetria/bindings existentes foram preservados.
- período existente continua sendo a fonte dos dados filtrados da Visão Geral.

Validações executadas:
- node --check dashboard-view.js
- validação sintática dos scripts inline extraídos do HTML
- comparação automática dos IDs antes/depois: nenhum ID original removido
- test/data-integrity-v11.test.js: OK
- test/ui-cleanup-v11.test.js: OK

Observação:
- test/dashboard-ui-integrity.test.js requer dashboard/node_modules/typescript, ausente no ZIP recebido; por isso essa suíte não pôde ser iniciada sem instalar dependências externas.

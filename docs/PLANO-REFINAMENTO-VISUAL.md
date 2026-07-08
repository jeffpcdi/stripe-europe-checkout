# Refinamento de Identidade Visual — 206 alterações

> **Contexto para quem chega agora:** este plano refina a **nova dashboard Next.js** que vive em
> `dashboard/` (NÃO a legada `dashboard-view.js`). Leia `docs/HANDOFF-NOVA-IA.md` e o `CLAUDE.md`
> (§19) antes de executar. Identidade: ciano `#25f4ee` + rosa `#fe2c55` sobre preto `#08080a`.

Refinamento profundo da dashboard (ciano `#25f4ee` + rosa `#fe2c55` sobre preto), mantendo a identidade do legado sem poluição visual. Todas as mudanças em `dashboard/` — nada muda no Express nem no legado.

**Revisado após auditoria visual das páginas reais** (screenshots de Visão Geral, Funil, Atividade e Configurações): 4 itens desnecessários foram retirados (marcados ~~assim~~), o bloco R corrige incoerências encontradas, e os blocos S–AB adicionam 104 itens novos, incluindo opções simples de front-end para o usuário.

## A. Atmosfera e fundo (5)

1. **Vinheta radial** no `.app-bg` — escurece bordas da viewport, foco central no conteúdo.
2. **Orbe de aurora terciário** âmbar-fraco atrás da área do globo/gráficos, deriva mais lenta que os dois existentes.
3. ~~Linha de varredura horizontal (scanline)~~ — **retirado**: poluição visual sem ganho, e conflita com o conteúdo denso das tabelas.
4. ~~Grelha de pontos com paralaxe no scroll~~ — **retirado**: custo de performance sem percepção real; a grelha estática atual já cumpre o papel.
5. **Transição de fundo por página**: cor do orbe de aurora muda levemente por seção (ciano na Visão Geral, rosa no Ao Vivo, âmbar na Geografia) via atributo `data-section` no layout.

## B. Sidebar (7)

6. **Glow pulsante na logo** sincronizado com o anel (breathe 6s) + leve `scale(1.02)` no hover.
7. **Tooltip flutuante** ao passar o mouse nos itens (nome + descrição), com popIn rápido.
8. **Indicador ativo animado**: a barra ciano-rosa desliza entre itens com `view-transition`/`transition` em vez de aparecer seca.
9. **Contador ao vivo** no item "Ao Vivo": badge numérico pequeno com visitantes ativos (dados já existentes no SWR), pulso quando muda.
10. **Rodapé da sidebar**: status do sistema (dot verde + "Operacional" + uptime) com hairline superior.
11. **Ícones com micro-bounce** no hover (spring scale 1.15) e cor de acento no item ativo.
12. **Divisórias de seção com gradiente** (hairline ciano→transparente) em vez de cinza chapado.

## C. Header (4)

13. **Breadcrumb animado**: "Seção / Página" com o segmento trocando via fade+slide quando navega.
14. **Relógio ao vivo** (HH:MM:SS mono) ao lado da data, atualizado a cada segundo.
15. **Badge "Ao vivo" interativo**: hover expande mostrando latência do WebSocket (ms).
16. **Hairline inferior com gradiente animado** (sheen lento da esquerda para a direita a cada 8s).

## D. KPIs e cards (7)

17. **Borda gradiente cônica** girando lentamente no card de KPI em destaque (receita) — `conic-gradient` + mask.
18. **Números com slot-machine**: dígitos rolam verticalmente na atualização (melhora o CountUp atual).
19. **Sparkline com gradiente de preenchimento** e ponto final pulsante.
20. **Ícone do KPI em cápsula neon** com glow da cor da métrica.
21. **Delta com seta animada** (sobe/desce com spring) e cor semântica.
22. **Sheen no hover** dos cards de KPI (reflexo diagonal já existe como classe — aplicar) + `translateY(-2px)` com sombra ciano.
23. **Estado vazio ilustrado**: cards sem dados ganham ícone ghost + mensagem, sem skeleton eterno.

## E. Gráficos e tabelas (6)

24. **Área do gráfico de receita com gradiente duplo** (ciano topo → transparente) e linha com `drop-shadow` neon.
25. **Cursor de crosshair customizado** no gráfico: linha vertical ciano + tooltip glass.
26. **Barras com animação `barUp` em stagger** re-disparada ao trocar período.
27. **Linhas de tabela com hover deslizante**: fundo ciano 4% + barra esquerda de 2px surgindo.
28. **Ordenação com seta animada** nos cabeçalhos de tabela (rotação 180° spring).
29. **Realce de célula atualizada**: flash âmbar→transparente quando valor muda via WebSocket (classe `anim-val-flash` aplicada às tabelas ao vivo).

## F. Globo — peça central (8)

30. **Animação de reentrada cinematográfica**: ao montar (e ao abrir fullscreen), o globo inicia em `altitude 4.5` distante, girando rápido, e faz zoom-in suave até `altitude 2.2` com easing custom (1.6s) — estilo "chegada da órbita".
31. **Anel de atmosfera** (`atmosphereColor` ciano, `atmosphereAltitude 0.22`) para halo neon ao redor do planeta.
32. **Arcos de tráfego animados**: arcos ciano→rosa disparando dos países com cliques recentes para o país líder (dados de geo já existentes), com dash animado.
33. **Pontos de calor pulsantes** nos países ativos (rings de propagação via `ringsData`).
34. **Rotação desacelera no hover** (autoRotateSpeed 0.6 → 0.15) e retoma ao sair.
35. **HUD orbital**: cantos do painel com marcas de mira (corner brackets) ciano e legenda "ROI-NADOS · TRÁFEGO GLOBAL" em mono.
36. **Contraste extra no fullscreen**: filtro sobe para `contrast(1.25) saturate(1.4)` e fundo do modal ganha estrelas (dots) sutis.
37. **Botão "recentrar"** (ícone alvo) que refaz a animação de reentrada a qualquer momento.

## G. Botões e controles — mais contraste (6)

38. **`.btn-primary` reforçado**: gradiente ciano→ciano-claro, texto preto `font-semibold`, sombra externa ciano 30%, hover eleva com glow 45%.
39. **`.btn-ghost` com borda visível** (borda `--border-strong` nova, 18% branco) e fundo 6% no repouso — hoje some no fundo escuro.
40. **`.btn-danger` sólido rosa** com glow rosa no hover (hoje é translúcido demais).
41. **Estado de foco neon**: `focus-visible` com anel duplo (ciano interno + offset escuro) em todos os controles.
42. **Período ativo no PeriodPicker** com fundo ciano 12% + texto ciano + borda — contraste bem maior que o atual.
43. **Switches/checkboxes das configurações** com trilha ciano quando ligados e thumb com sombra (hoje cinza baixo contraste).

## H. Tutoriais interativos estilo popup (7)

44. **Componente `TourPopover`**: popup glass ancorado a um elemento-alvo via `data-tour="id"`, com spotlight (backdrop escuro com recorte radial no alvo), título, texto, passo X/Y, botões Anterior/Próximo/Pular.
45. **Motor de tour** (`lib/tour.ts`): sequências por página, navegação por teclado (setas/ESC), persistência em `localStorage` (`tour:overview:done`).
46. **Tour da Visão Geral** (5 passos): sidebar → seletor de período → KPIs → gráfico de receita → badge ao vivo.
47. **Tour do Globo/Geografia** (4 passos): globo → zoom → tela cheia → tabela de países.
48. **Tour do Ao Vivo** (3 passos): feed em tempo real → contador → filtros.
49. **Botão "?" flutuante** no canto inferior direito que reabre o tour da página atual; menu com lista de tours disponíveis.
50. **Animações do tour**: popover entra com popIn spring, spotlight cresce do centro do alvo (transição de `clip-path`), troca de passo com slide direcional.

## I. Micro-detalhes e polish (6)

51. **Scrollbar com gradiente** ciano→rosa no thumb (hoje cinza).
52. **Seleção de texto** com fundo ciano 25% (`::selection`).
53. **`prefers-reduced-motion`**: todas as animações novas respeitam a media query (desliga reentrada do globo, etc.).
54. **Toast de confirmação** padronizado (salvar config, copiar link): glass, barra de progresso ciano, slide-in do canto.
55. **Transição de página** com `revealUp` no container principal ao navegar entre seções.
56. **Favicon/theme-color** ciano no `<meta theme-color>` e title template "ROI-NADOS · {Página}".

## J. Estados de carregamento e skeletons (6)

57. **Skeleton com shimmer neon**: substituir o pulse cinza por varredura de gradiente ciano 8% deslizando (keyframe `shimmer`).
58. **Skeleton mimético**: cada card carrega com a silhueta real do conteúdo (círculo do ícone, linha do valor, sparkline fantasma) em vez de retângulos genéricos.
59. **Stagger de skeletons**: skeletons entram com delay incremental (60ms) simulando a ordem real de renderização.
60. **Transição skeleton→conteúdo com crossfade** (200ms) em vez de troca seca.
61. **Barra de progresso de rota** no topo da viewport (2px, gradiente ciano→rosa) durante navegações e refetch de período.
62. **Spinner da marca**: anel cônico ciano-rosa girando (substitui qualquer spinner padrão) para ações de botão.

## K. Página Ao Vivo (6)

63. **Feed com entrada em cascata**: cada evento novo desliza de cima com spring + flash ciano 6% que esvai em 1.2s.
64. **Contador de visitantes com odômetro** grande (dígitos rolantes) e ring de pulso a cada incremento.
65. **Avatar de país animado**: bandeira/emoji do país do visitante entra com pop e ring ciano.
66. **Linha do tempo vertical** conectando eventos do feed (hairline gradiente com dots pulsantes).
67. **Indicador de conexão WebSocket**: dot com 3 estados animados (verde estável / âmbar reconectando com pulso rápido / vermelho caído) no topo do feed.
68. **Auto-scroll inteligente**: feed acompanha eventos novos, mas pausa com badge "N novos ↓" clicável quando o usuário rola para cima.

## L. Páginas de gestão — Links, Pixels, Gateways, Domínios, Cloaker (8)

69. **Cards de link com favicon do destino** + slug em mono ciano + hover elevando com sheen.
70. **Botão copiar com morph**: ícone clipboard → check verde com rotação spring + toast discreto.
71. **QR code em popover glass** por link (hover/click no ícone), com popIn.
72. **Status de pixel com pulso semântico**: dot verde pulsante (ativo), âmbar (sem eventos 24h), cinza (inativo) + tooltip com último evento.
73. **Cards de gateway com logo da marca** em cápsula e borda da cor da marca no hover (Stripe roxo, etc.).
74. **Badge de ambiente** (Live/Test) com gradiente distinto e micro-animação de flip ao alternar.
75. **Tabela de domínios com status DNS animado**: check verde com draw-in de SVG path (stroke-dashoffset) quando verificado.
76. **Cloaker: toggle mestre dramático** — switch grande com glow rosa quando ativo + banner hairline "Cloaker ativo" com scanline sutil.

## M. Configurações e formulários (6)

77. **Inputs com borda em foco animada**: gradiente ciano cresce das extremidades para o centro (background-size animado).
78. **Labels flutuantes**: label sobe e encolhe ao focar/preencher, na cor de acento.
79. **Validação inline animada**: mensagem de erro entra com shake curto + ícone; sucesso com check draw-in.
80. **Grupos de configuração em cards colapsáveis** com chevron rotativo e expansão suave de altura (grid-template-rows).
81. **Botão salvar com estados**: idle → loading (spinner da marca) → sucesso (check + glow verde 1s) → volta ao idle.
82. **Zona de perigo demarcada**: seção com borda rosa hairline, título rosa e fundo rosa 3%.

## N. Modais, popovers e dropdowns (5)

83. **Sistema unificado de modal**: todos os modais (não só o globo) usam popIn/popBgIn com backdrop blur — inclui confirmações de exclusão.
84. **Dropdowns com origem correta**: menu abre escalando a partir da âncora (transform-origin dinâmico) com fade+scale spring.
85. **Popover de confirmação inline** (excluir link/pixel): mini-popover ancorado no botão, sem modal cheio, com botões contrastados.
86. **Tooltip global padronizado**: componente único glass com seta, delay 400ms, popIn 120ms — substitui `title=` nativo em toda a dashboard.
87. **Command palette (Cmd+K)**: busca rápida de páginas/ações com overlay glass, resultados com hover deslizante e navegação por teclado.

## O. Tipografia e hierarquia (5)

88. **Números tabulares** (`font-variant-numeric: tabular-nums`) em todos os KPIs, tabelas e contadores — sem "dança" de dígitos.
89. **Display font nos valores hero**: valor principal dos KPIs sobe para peso 700 com letter-spacing -0.03em e tamanho maior.
90. **Labels em mono uppercase padronizados**: todas as legendas/eyebrows usam a classe `label-mono` (hoje inconsistente).
91. **Gradiente de texto no título da página**: H1 com gradiente branco→ciano 20% sutil via background-clip.
92. **Hierarquia de opacidade padronizada**: 3 níveis de texto (100% / 64% / 40%) aplicados consistentemente — remove tons intermediários aleatórios.

## P. Efeitos avançados de identidade (6)

93. **Borda animada "energia"** no painel do globo: hairline com gradiente ciano-rosa que percorre o perímetro lentamente (conic-gradient girando com mask).
94. **Efeito de "assinatura" na logo**: a cada 30s o anel da logo dispara um pulso de onda (ripple) único.
95. ~~Cursor personalizado no canvas do globo~~ — **retirado**: cursores custom atrapalham usabilidade (drag/zoom) e destoam do resto do app.
96. **Glow reativo ao valor**: card de receita ganha intensidade de glow proporcional ao delta do período (mais crescimento = mais brilho, com teto).
97. ~~Ruído de filme (noise texture) sobre o fundo~~ — **retirado**: em telas com muito texto pequeno reduz legibilidade; a vinheta (item 1) já dá profundidade.
98. **Reflexo de chão sob o globo**: gradiente radial ciano 6% na base do painel, como se o globo iluminasse a superfície.

## Q. Acessibilidade e consistência final (8)

99. **Estados `:active` táteis**: todos os elementos clicáveis comprimem para scale(0.97) — hoje só alguns têm.
100. **Contraste AA nos textos secundários**: subir `--text-faint` de 40% para 46% mantendo hierarquia.
101. **`aria-live` nos contadores** ao vivo e feed (polite) para leitores de tela.
102. **Skip-link estilizado** ("Pular para conteúdo") que aparece com popIn no primeiro Tab.
103. **Focus trap nos modais** (globo fullscreen, tours, confirmações) com retorno de foco ao elemento de origem.
104. **Empty states ilustrados padronizados**: componente único com ícone ghost neon, título e ação sugerida para todas as tabelas/listas vazias.
105. **Error states com retry**: falha de fetch mostra card com ícone rosa, mensagem e botão "Tentar novamente" pulsante — em vez de skeleton infinito.
106. **Auditoria final de motion**: revisão de todas as durações/easings para a mesma escala (120/240/400ms + spring única), removendo qualquer animação fora do sistema.

## R. Revisão de coerência — problemas encontrados na auditoria visual (14)

107. **Funil: barra azul fora da paleta** → trocar o azul `#3b82f6` da barra "Visitaram" por gradiente ciano→rosa da identidade; etapas seguintes em ciano com opacidade decrescente.
108. **Funil: badges de contagem incoerentes** (círculo azul e verde aleatórios) → cápsulas glass com número mono e cor da etapa.
109. **Funil: rótulo truncado** "Chegaram ao che..." → reduzir para "Checkout" com descrição completa embaixo; nunca truncar rótulo de etapa.
110. **KPI Receita: sparkline verde** destoando → sparkline em ciano com gradiente; verde fica reservado só para deltas positivos e status.
111. **Cards secundários: cores de ícone aleatórias** (verde, ciano, âmbar sem critério) → sistema fixo: ciano = métricas, verde = sucesso/aprovação, âmbar = atenção, rosa = risco (reembolso/disputa).
112. **Card "Aprovação": texto truncado** "0 aprovadas de 0 t..." → abreviar para "0 de 0 transações" e permitir 2 linhas.
113. **Atividade: códigos de país crus** ("CN · /", "IL · /") misturados com nomes ("Brasil") → normalizar sempre para nome PT-BR + bandeira emoji via `Intl.DisplayNames`.
114. **Atividade: ícone único (olho) para todos os eventos** → ícone por tipo: venda (check ciano), lead (user), recusa (x rosa), visita (olho), reembolso (undo âmbar), sistema (engrenagem).
115. **Config: switches sem trilha visível** (bolinha branca solta no escuro) → trilha com fundo 12% branco e borda; ligado = trilha ciano com glow (reforça o item 43).
116. **Config: input com contraste baixo** (placeholder quase invisível) → fundo do input 6% branco, placeholder 40%, borda `--border-strong`.
117. **Visão Geral: hairline superior do primeiro KPI** (linha gradiente solta sobre o card Receita) → ou aplicar em todos os 4 KPIs ou remover; padronizar.
118. **Espaçamento inconsistente entre seções** (gap 24px entre KPIs mas 32px depois do gráfico) → escala única de espaçamento vertical: 16 / 24 / 32px documentada em token.
119. **Header: data em mono às vezes colide** com o badge "Ao vivo" em telas médias → empilhar data acima do badge abaixo de 1100px.
120. **Sidebar: seção "Sistema" sem divisória visual** consistente com Métricas/Gestão → mesmo tratamento de label mono + hairline gradiente.

## S. Opções novas simples de front-end (12)

121. **Modo compacto/confortável**: toggle de densidade nas Configurações — reduz paddings de cards e tabelas em ~25% (atributo `data-density` + tokens).
122. **Toggle "reduzir animações"** nas Configurações (além do respeito automático a `prefers-reduced-motion`), persistido em localStorage.
123. **Sidebar recolhível**: botão para colapsar em modo só-ícones (72px) com tooltips; estado persistido.
124. **Seletor de moeda de exibição** (EUR/USD/BRL, só formatação client-side com taxa informativa) no header do gráfico de receita.
125. **Ocultar valores sensíveis**: botão "olho" no header que borra receita/valores (blur 8px) para gravar tela/demonstrações — modo apresentação.
126. **Ordem dos KPIs configurável**: arrastar e soltar os 4 cards principais (drag com spring), ordem salva em localStorage.
127. **Intervalo de atualização configurável**: seletor 5s/15s/30s/manual para o polling do SWR, nas Configurações.
128. **Fuso horário de exibição**: seletor (Lisboa/São Paulo/UTC) que reformata todos os horários de eventos.
129. **Atalhos de teclado**: `g` + letra navega entre páginas (g v = Visão Geral, g l = Links); modal "?" lista os atalhos.
130. **Exportar CSV** nos painéis de tabela (leads, países, atividade): botão discreto no canto do card, client-side.
131. **Filtro de período custom**: opção "Personalizado" no PeriodPicker com dois date inputs em popover glass.
132. **Notas rápidas por página**: campo de anotação (textarea glass) recolhível no rodapé de cada página, salvo em localStorage.

## T. Visão Geral — refinamentos extras (10)

133. **Comparação com período anterior** nos KPIs: linha secundária "vs. 7d anteriores" com delta percentual colorido.
134. **Meta de receita opcional**: barra de progresso fina sob o KPI de receita quando o usuário define meta nas Configurações.
135. **Melhor dia destacado** no gráfico: ponto com anel dourado + tooltip "melhor dia do período".
136. **Anotações de eventos no gráfico**: marcadores verticais discretos em dias com reembolso/disputa (hover mostra detalhe).
137. **Painel Saúde do sistema: dots pulsantes** nos serviços ativos e âmbar estático nos inativos (hoje badges chapados).
138. **Card de países: mini-bandeiras** dos 3 primeiros em vez do texto "US · BR · ES".
139. **Legenda interativa no gráfico**: clicar em Receita/Vendas/Leads alterna a série com transição de morph suave.
140. **Eixo Y adaptativo com labels compactos** (1,2 mil em vez de 1.200,00 €) e grid lines a 4% branco.
141. **Tooltip do gráfico com delta**: além do valor, mostra variação vs. dia anterior com seta.
142. **Skeleton do gráfico com forma de onda** fantasma (path SVG estático a 6%) em vez de bloco vazio.

## U. Funil — refinamentos (8)

143. **Barras do funil com animação de preenchimento** da esquerda com stagger (300ms entre etapas) ao carregar/trocar período.
144. **Conectores entre etapas**: trapézios sutis ligando as barras mostrando o "vazamento" entre etapas.
145. **Taxa de conversão entre etapas** (não só do topo): "0% do checkout" à direita de cada transição em texto pequeno.
146. **Etapa gargalo destacada**: a maior queda percentual ganha borda âmbar hairline + ícone de alerta com tooltip.
147. **Contagem com CountUp** nos números das etapas ao entrar na página.
148. **Filtro de leads com chips ativos**: mostrar filtros aplicados como chips removíveis (x) acima da tabela.
149. **Busca com highlight**: termo buscado destacado em ciano nos resultados da tabela de leads.
150. **Paginação estilizada**: botões prev/next glass com contagem "1–20 de 69" em mono.

## V. Atividade — refinamentos (8)

151. **Agrupamento por dia**: separadores "Hoje", "Ontem", "05/07" em label mono com hairline.
152. **Timestamps relativos** ("há 2 min") com hover mostrando absoluto; atualizados a cada minuto.
153. **Cor da borda esquerda por tipo de evento**: hairline 2px (ciano venda, rosa recusa, âmbar reembolso) — leitura rápida por cor.
154. **Filtros com contagem**: cada chip mostra o total ("Vendas 12") e anima o número ao filtrar.
155. **Evento expandível**: clicar abre detalhes inline (valor, gateway, UTM) com expansão suave.
156. **Realce de eventos novos**: eventos que chegam com a página aberta entram com flash ciano e badge "novo" por 10s.
157. **Scroll infinito com sentinela** e loader da marca em vez de paginação (ou botão "carregar mais" estilizado).
158. **Ação de copiar detalhes** do evento (JSON resumido) no popover do item.

## W. Geografia além do globo (8)

159. **Tabela de países com barras de proporção** embutidas (largura = % de tráfego, gradiente ciano) atrás do texto.
160. **Bandeiras emoji + nome PT-BR** em todos os países (consistente com item 113).
161. **Sincronização globo↔tabela**: hover numa linha da tabela gira o globo até o país e acende o ring.
162. **Card resumo "país líder"**: destaque com bandeira grande, % do tráfego e delta do período.
163. **Toggle de métrica no globo**: alternar entre visitas/vendas/receita muda a cor dos pontos (ciano/verde/rosa) com crossfade.
164. **Contorno do país ativo** em destaque ciano ao fazer hover no polígono (já há polígonos — subir `strokeColor` no hover).
165. **Mini-legenda do globo**: escala de intensidade (fraco→forte) em gradiente no canto inferior do painel.
166. **Estado sem dados do globo**: mensagem "aguardando tráfego" com globo girando lento e pontos fantasma a 10%.

## X. Responsividade e mobile (10)

167. **KPIs em carrossel horizontal** com snap em telas <640px (scroll-snap-x) em vez de empilhar 4 cards longos.
168. **Tabelas com colunas prioritárias**: esconder colunas secundárias em mobile com botão "+" que expande a linha.
169. **MobileNav com as mesmas seções da sidebar** (Métricas/Gestão/Sistema) e logo neon — hoje é lista simples.
170. **Gráfico com altura adaptativa** (200px mobile / 300px desktop) e menos ticks no eixo X.
171. **PeriodPicker sticky** no topo em mobile ao rolar (backdrop blur), sempre acessível.
172. **Globo com altura proporcional** à viewport em mobile (60vh) e controles maiores (40px) para toque.
173. **Áreas de toque mínimas 44px** em todos os botões/ícones interativos (auditoria).
174. **Modal fullscreen do globo vira sheet** deslizando de baixo em mobile.
175. **Feed ao vivo com swipe**: deslizar evento para a esquerda revela ações (copiar/detalhes) em mobile.
176. **Testar e corrigir breakpoint 768–1100px**: sidebar colapsa para só-ícones automaticamente nessa faixa (hoje salta direto para mobile).

## Y. Performance percebida (8)

177. **`content-visibility: auto`** nas seções abaixo da dobra (tabelas longas, painéis secundários).
178. **Lazy-load do globo** com `next/dynamic` + placeholder com silhueta circular pulsante (hoje bloqueia o bundle da página).
179. **Prefetch dos dados da próxima página** ao fazer hover no item da sidebar (SWR preload).
180. **Debounce visual nas buscas** (300ms) com micro-spinner no input em vez de re-render a cada tecla.
181. **Otimizar animações para GPU**: garantir que tudo anima só `transform`/`opacity` (auditoria das classes existentes; `will-change` pontual).
182. **Memoizar linhas de tabela** e itens do feed (React.memo) para o flash de atualização não re-renderizar a lista toda.
183. **Fonte com `font-display: swap`** e preload do woff2 da mono usada nos números.
184. **Imagens da logo com `sizes` correto** e prioridade só na sidebar (remover priority duplicado do mobile).

## Z. Dados e formatação (10)

185. **Formatação de moeda unificada**: helper único `fmtCurrency` (hoje há "0,00 €" e "0.00€" misturados em componentes diferentes).
186. **Formatação de número compacta** consistente: 1,2 mil / 3,4 mi via `Intl.NumberFormat` PT com `notation: compact`.
187. **Percentuais com 1 casa decimal fixa** (0,0%) em todos os lugares — hoje varia entre 0% e 0.00%.
188. **Datas por extenso no padrão PT** ("qua., 8 de jul.") unificadas via helper; remover formatações manuais.
189. **Zero states com traço** (—) em vez de "0,00 €" onde não houve dado no período (distinção entre zero real e sem dados).
190. **Tooltips de valores exatos**: valores compactados (1,2 mil) mostram o exato no hover.
191. **Sinal de delta explícito**: +12% / −3% sempre com sinal e cor (verde/rosa), nunca só a cor.
192. **Arredondamento consistente de moeda** (sempre 2 casas, half-up) no client — auditoria dos `toFixed` espalhados.
193. **Pluralização correta**: "1 venda" / "2 vendas" via helper (hoje há "1 vendas").
194. **Máscara de valores grandes no odômetro**: separador de milhar animado junto com os dígitos.

## AA. Header e topo — extras (8)

195. **Saudação contextual** discreta acima do título ("Boa tarde" conforme hora) em label mono 11px.
196. **Indicador de rota carregando** no título: shimmer sutil no H1 durante transição de página.
197. **Botão de refresh manual** com ícone girando durante o fetch e timestamp "atualizado há Xs".
198. **Status do WebSocket no badge "Ao vivo"**: cor muda (verde/âmbar/rosa) conforme conexão — integra com item 67.
199. **Menu do usuário**: avatar com inicial no canto direito abrindo dropdown (conta, sair) — hoje "Sair" só existe dentro de Configurações.
200. **Progresso de scroll da página**: hairline ciano 1px no rodapé do header indicando posição de leitura em páginas longas.
201. **Título da aba dinâmico com eventos**: "(3) ROI-NADOS" quando chegam vendas com a aba em segundo plano.
202. **Favicon com dot de status**: variante do favicon com ponto verde quando o WebSocket está conectado.

## AB. Sidebar — extras (8)

203. **Números-resumo nos itens de gestão**: contagem discreta à direita (Links 12, Pixels 3) em mono 11px.
204. **Item com estado de erro**: se um domínio falha verificação, o item "Domínios" ganha dot rosa pulsante.
205. **Micro-preview no hover**: tooltip rico com KPI principal da página (ex.: hover em "Ao Vivo" mostra visitantes ativos).
206. **Animação de entrada da sidebar**: itens entram com stagger de 40ms no primeiro load (uma vez só, sem repetir em navegação).
207. **Logo clicável com easter egg**: clique duplo dispara a onda ripple do anel (item 94) manualmente.
208. **Versão do app no rodapé** da sidebar (v2.0 · mono 10px) junto ao status do sistema.
209. **Scroll interno da sidebar estilizado**: quando os itens excedem a altura, scrollbar fina própria e fade de corte no topo/fundo.
210. **Realce da seção ativa**: o label da seção (MÉTRICAS/GESTÃO) da página atual fica ciano 60% em vez de cinza.

## Arquivos principais

- `app/globals.css` — tokens novos (`--border-strong`, glows), keyframes (reentrada, shimmer, slot, spotlight, ripple, energia), classes de botão reforçadas (A, C, G, I, J, O, P)
- `components/geo/globe.tsx` — reentrada, atmosfera, arcos, rings, HUD, recentrar, borda energia, reflexo (F, P)
- `components/shell/sidebar.tsx`, `header.tsx`, `topnav.tsx` — B, C, AA, AB
- `components/overview/*` — D, E, O, T
- `components/live/*` — K
- `components/links/*`, `pixels/*`, `gateways/*`, `domains/*`, `cloak/*` — L
- `components/config/*` — M, S
- Novos: `components/tour/tour-popover.tsx` + `lib/tour.ts` (H), `components/ui/toast.tsx`, `tooltip.tsx`, `modal.tsx`, `confirm-popover.tsx`, `command-palette.tsx`, `empty-state.tsx`, `error-state.tsx`, `route-progress.tsx` (I, J, N, Q)
- Novos: `lib/preferences.ts` + `components/config/display-prefs.tsx` (opções de front-end — S), `lib/countries.ts` (nomes PT + bandeiras — R/W); `lib/format.ts` já existe — expandir com os helpers do bloco Z
- `components/funnel/*`, `components/activity/*` — U, V
- Views existentes recebem atributos `data-tour` e classes de animação (sem refatorar lógica)

## Ordem de execução (12 fases, commit por fase)

1. **Coerência primeiro** (R) + helpers de formatação (Z) — corrige o que está errado antes de adicionar o novo
2. Fundações CSS: tokens, keyframes, botões, tipografia, scrollbar (A, G, O, I parcial)
3. Sidebar + Header + extras (B, C, AA, AB)
4. KPIs, gráficos, tabelas e skeletons (D, E, J, T)
5. Globo + Geografia (F, P parcial, W)
6. Página Ao Vivo (K) + Atividade (V)
7. Funil (U)
8. Páginas de gestão (L)
9. Configurações + formulários + opções de front-end (M, S)
10. Modais, popovers, command palette (N)
11. Responsividade + performance (X, Y)
12. Tours interativos + acessibilidade + auditoria final (H, Q, P restante)

## Validação

Build de produção + verificação visual com agent-browser página a página (screenshots), teste do tour completo, do fluxo do globo (reentrada, zoom, fullscreen, recentrar), do command palette e dos estados de erro/vazio. `prefers-reduced-motion` testado. Commit e push ao final de cada fase.

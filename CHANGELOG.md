# Changelog

Todas as mudanças relevantes deste projeto. O formato segue, de forma leve,
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/); versionamento
[SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- **Resiliência do funil (caminho do dinheiro):** trava anti-duplo-disparo de
  webhook por `order_id`, timeout de 8s no fetch do Pushcut e limites de corpo
  (200kb global, 5mb no import de backup) — o checkout do cliente nunca fica
  refém de uma dependência lenta.
- **Segurança de conta:** bloqueio suave de e-mail após várias tentativas de
  login, aviso opt-in de novo login por Pushcut, trilha de auditoria por conta
  (`/api/audit`) com IP mascarado, e sessão deslizante de 30 dias.
- **Watchdog de anomalia (opt-in):** alerta quando uma conta com histórico de
  vendas fica 6h sem conversões, por carona no tráfego (sem cron dedicado).
- **Anti-fraude do cloaker:** camada de velocidade contra granjas de device,
  assinaturas de bots atualizadas para a safra 2026 (crawlers de IA e scanners
  de rede) e nova suíte de testes de user-agent.
- **Operação/DX:** `/healthz` para liveness probe, `npm run doctor` (diagnóstico
  de ambiente sem efeitos colaterais), captura de erros de front no backend
  (`/api/client-error`), runbook de incidentes e `.env.example` completo.
- **Gestão de links:** arquivamento (histórico preservado, fora da lista e do
  `/go`), e páginas de erro amigáveis para links inexistentes/desativados.
- **Durabilidade:** snapshots no Redis e migrações idempotentes no Neon para
  domínios, gateways, pixels e moeda por conta, com reconciliação no boot.

### Alterado

- `/api/stats` passou a usar `private, no-cache` com ETag/304, e os feeds "Ao
  Vivo" e "Atividade" agora memoizam as linhas — menos trabalho a cada poll.
- Política de privacidade com seção de cookies e prazos de retenção concretos.
- README reescrito com a matriz de degradação; `CLAUDE.md` com os contratos de
  API da fase de hardening.

## [1.0.0]

- Primeira versão: rastreamento first-party TikTok (pixel + CAPI), cloaker com
  score de bot, gestão de links/pixels/gateways/domínios, dashboard Next.js e
  webhooks de conversão por gateway.

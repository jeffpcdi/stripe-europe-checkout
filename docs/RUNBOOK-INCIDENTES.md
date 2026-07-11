# Runbook de incidentes — ROI-NADOS

> Item 567. O que o **sistema faz sozinho** quando uma dependência cai, e o que o
> **operador** deve fazer. Princípio de projeto: **degradação graciosa** — nenhuma
> queda de dependência derruba o app; ela apenas desliga um recurso e loga o modo.
>
> Diagnóstico rápido a qualquer momento: `npm run doctor` (item 568).

---

## 1. Neon / Postgres caiu (`DATABASE_URL`)

**Sintomas**
- Log: `[db] DATABASE_URL não definido` ou `[db] init falhou, tentando de novo (n/3)`.
- Painel sobe, mas leads/configs/sessões não persistem entre reinícios.

**O que o sistema faz automaticamente**
- Retenta o `init` 3× com backoff antes de desistir.
- Cai para **modo só-arquivo/memória**: continua servindo com o último snapshot local
  (config de links/pixels/gateways é lida do snapshot no Redis quando disponível).
- Webhooks de conversão que chegam nesse período entram na **fila durável de retry**
  (não se perdem; ver `retry-queue`).
- Nada de erro 500 para o visitante: o `/go` e o tracking seguem funcionando.

**O que o operador faz**
1. `npm run doctor` para confirmar que é o Neon (e não Redis/env).
2. Ver status do provedor Neon; se for manutenção, aguardar — o app se reconecta sozinho.
3. Se a URL mudou: atualizar `DATABASE_URL` no ambiente e **reiniciar o processo**
   (o server Express não tem hot-reload de env).
4. Ao voltar: conferir que a fila de retry drenou (contadores de observability da fila).
5. **Não** apagar o snapshot local — é o fallback.

---

## 2. Redis / Upstash caiu (`KV_REST_API_*` / `UPSTASH_REDIS_REST_*`)

**Sintomas**
- Log: `[redis] Variáveis não encontradas — modo memória ativado` ou erros de conexão.
- Presença "ao vivo" e rate-limit param de ser compartilhados entre instâncias.

**O que o sistema faz automaticamente**
- Cai para **estado por-processo**: rate-limit e presença passam a valer só na
  instância atual (ainda protegem, só não somam entre réplicas).
- Snapshots de config que iam para o Redis passam a depender do Neon/arquivo.
- Nenhuma requisição falha por causa disso.

**O que o operador faz**
1. `npm run doctor` para confirmar.
2. Se rodando **múltiplas instâncias**, considerar reduzir para 1 até o Redis voltar
   (evita rate-limit e presença divergentes).
3. Restaurar as credenciais e reiniciar. O app volta a compartilhar estado sozinho.

---

## 3. TikTok Events API (CAPI) fora / rejeitando

**Sintomas**
- Conversões marcadas como não entregues ao TikTok; log de erro do CAPI.
- `EMQ`/qualidade de correspondência caindo no painel do TikTok.

**O que o sistema faz automaticamente**
- Envio server-side é **idempotente por `event_id`** — reenvio não duplica evento.
- Falhas de entrega vão para **retry com backoff**; o evento não é descartado.
- O dashboard continua registrando a venda localmente (a verdade financeira não
  depende do TikTok ter recebido).

**O que o operador faz**
1. Distinguir os dois casos:
   - **Token/credencial** (`TIKTOK_ACCESS_TOKEN` expirado ou pixel errado): renovar no
     painel da conta ou no env padrão; reprocessar a fila.
   - **Instabilidade do TikTok**: aguardar — o retry entrega quando o serviço voltar.
2. Verificar `EMQ`: se caiu junto, provavelmente é payload/credencial, não queda.
3. Conferir na fila que os eventos pendentes drenaram após a normalização.

---

## Referência rápida

| Dependência | Env | Modo degradado | Perde dado? |
|---|---|---|---|
| Neon | `DATABASE_URL` | só-arquivo/memória + fila de retry | Não (fila durável) |
| Redis | `KV_REST_API_*` / `UPSTASH_*` | estado por-processo | Não |
| TikTok CAPI | `TIKTOK_ACCESS_TOKEN` + `TIKTOK_PIXEL_CODE` | retry idempotente | Não (venda local intacta) |
| Railway (domínios) | `RAILWAY_API_TOKEN` | provisão manual de domínio | Não |

**Regra de ouro:** antes de qualquer ação drástica, rode `npm run doctor` e leia o log
de boot — o app quase sempre já está se defendendo sozinho.

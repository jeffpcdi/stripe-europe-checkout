'use client'

// Item 59: painel "Como funciona a Gestão" — visão geral do fluxo
// Link → Pixel → Gateway → Domínio → Cloaker e o que é pré-requisito de quê.
// Reusa o TutorialModal (item 28); o gatilho é um "?" discreto ao lado do
// label da seção Gestão no sidebar.

import { useState } from 'react'
import { CircleHelp } from 'lucide-react'
import { TutorialModal, type TutorialStep } from '@/components/tutorial-modal'

const GESTAO_STEPS: TutorialStep[] = [
  {
    title: 'O fluxo inteiro em uma frase',
    body: (
      <p>
        Você cria um <strong>Link</strong> rastreável, instala um <strong>Pixel</strong> na página
        de destino, conecta o <strong>Gateway</strong> de pagamento para registrar as vendas, usa um{' '}
        <strong>Domínio</strong> próprio para dar credibilidade e liga o <strong>Cloaker</strong>{' '}
        para filtrar tráfego indesejado. Cada aba da Gestão cuida de uma dessas peças.
      </p>
    ),
    tip: 'Não precisa configurar tudo de uma vez — Link + Pixel já bastam para começar a medir.',
  },
  {
    title: 'Links — a porta de entrada',
    body: (
      <p>
        Cada link (<code>/go/slug</code>) redireciona o visitante para a página de venda e registra
        o clique. Dá para dividir o tráfego em variantes A/B por peso, filtrar por país/idioma e
        associar um pixel para os disparos automáticos.
      </p>
    ),
    tip: 'Use o UTM builder do editor para gerar a URL pronta para anúncios.',
  },
  {
    title: 'Pixels — os olhos na página',
    body: (
      <p>
        O pixel dispara eventos (visita, carrinho, compra…) para a plataforma de anúncio. Instale o
        script na página de destino e ligue só os eventos que fazem sentido.{' '}
        <strong>Eventos de dinheiro (Compra/Pagamento) exigem um gateway conectado</strong> — eles
        só saem do webhook do gateway, nunca do navegador.
      </p>
    ),
    tip: 'Sem Access Token o pixel dispara, mas com menos qualidade de correspondência (EMQ).',
  },
  {
    title: 'Gateways — a fonte da verdade das vendas',
    body: (
      <p>
        O gateway de pagamento chama nosso webhook a cada venda. É isso que permite atribuir
        receita a cada link/variante e disparar os eventos de compra com segurança (o navegador
        pode mentir; o gateway não).
      </p>
    ),
    tip: 'Cole a URL do webhook no painel do gateway e configure o segredo de assinatura quando houver.',
  },
  {
    title: 'Domínios — credibilidade no link',
    body: (
      <p>
        Um domínio próprio (<code>promo.suamarca.com</code>) substitui o domínio padrão nos links e
        no cloaker. Requer verificação por DNS — o passo a passo está na própria aba. Links com
        domínio próprio <strong>exigem que a verificação esteja concluída</strong>.
      </p>
    ),
  },
  {
    title: 'Cloaker — o filtro de tráfego',
    body: (
      <p>
        O cloaker decide, visita a visita, quem vê a página real e quem vê a página alternativa —
        por país, idioma, dispositivo, bots conhecidos e outras camadas. Funciona nos links{' '}
        <code>/c/slug</code> e pode usar os mesmos domínios verificados.
      </p>
    ),
    tip: 'Comece em modo permissivo e aperte as camadas aos poucos, acompanhando o log de decisões.',
  },
]

export function GestaoHelp() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Como funciona a Gestão"
        title="Como funciona a Gestão"
        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-brand-cyan"
      >
        <CircleHelp className="size-3.5" aria-hidden="true" />
      </button>
      <TutorialModal
        open={open}
        onClose={() => setOpen(false)}
        title="Como funciona a Gestão"
        steps={GESTAO_STEPS}
      />
    </>
  )
}

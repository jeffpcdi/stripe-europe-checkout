'use client'

import { DialogPortal } from '@/components/ui/dialog-portal'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Rocket, UploadCloud, X, Sparkles, Wand2 } from 'lucide-react'
import { adsUpload, apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useModalA11y } from '@/lib/use-modal-a11y'
import {
  TIKTOK_CTA_OPTIONS,
  TIKTOK_MIN_BUDGET,
  tiktokMinimumBudgetMessage,
  tomorrowLocalIsoDate,
  toLocalIsoDate,
} from './tiktok-contracts'

const STEPS = ['Configuração', 'Criativo', 'Revisão'] as const

interface FormState {
  name: string
  budgetAmount: string
  budgetType: 'daily' | 'lifetime'
  budgetOptimization: 'adgroup' | 'campaign'
  endDate: string
  countries: string
  videoUrl: string
  body: string
  linkUrl: string
  callToAction: string
}

const INITIAL: FormState = {
  name: '',
  budgetAmount: '',
  budgetType: 'daily',
  budgetOptimization: 'adgroup',
  endDate: '',
  countries: 'BR',
  videoUrl: '',
  body: '',
  linkUrl: '',
  callToAction: 'SHOP_NOW',
}

export function CreateAdPanel({
  open,
  onClose,
  advertiserId,
  currency,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  advertiserId: string
  currency: string
  onCreated: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  
  // MODO MÁGICO
  const [magicMode, setMagicMode] = useState(true)
  
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>(INITIAL)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const idempotencyKey = useMemo(
    () => (open ? `ttads-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` : ''),
    [open],
  )

  useModalA11y(open, dialogRef, submitting ? () => {} : onClose)

  useEffect(() => {
    if (!open) return
    setStep(0)
    setForm(INITIAL)
    setUploading(false)
    setSubmitting(false)
    setMagicMode(true) // Sempre abre no modo mágico
  }, [open])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const error = useMemo(() => {
    if (magicMode) {
      if (!/^https:\/\/\S+/.test(form.videoUrl.trim())) return 'Adicione um vídeo por upload ou URL HTTPS'
      if (!/^https:\/\/\S+/.test(form.linkUrl.trim())) return 'Informe a página HTTPS para onde o anúncio levará'
      return null
    }

    if (step === 0) {
      if (!form.name.trim()) return 'Informe o nome da campanha'
      if (!(Number(form.budgetAmount) >= TIKTOK_MIN_BUDGET)) return tiktokMinimumBudgetMessage(currency)
      if (form.budgetType === 'lifetime' && !/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) {
        return 'Orçamento total exige uma data de término'
      }
      if (form.budgetType === 'lifetime' && form.endDate <= toLocalIsoDate(new Date())) {
        return 'A data de término precisa ser futura'
      }
      const countries = form.countries.split(/[\s,]+/).filter(Boolean)
      if (!countries.length || countries.some((country) => !/^[A-Za-z]{2}$/.test(country))) {
        return 'Use códigos de país com duas letras, como BR ou US'
      }
    }
    if (step === 1) {
      if (!/^https:\/\/\S+/.test(form.videoUrl.trim())) return 'Adicione um vídeo por upload ou URL HTTPS'
      if (!/^https:\/\/\S+/.test(form.linkUrl.trim())) return 'Informe a página HTTPS para onde o anúncio levará'
    }
    return null
  }, [currency, form, step, magicMode])

  async function uploadVideo(file: File) {
    if (!file.type.startsWith('video/')) {
      toast.error('Escolha um arquivo de vídeo')
      return
    }
    setUploading(true)
    try {
      const result = await adsUpload(file, 'video')
      update('videoUrl', result.url)
      toast.success('Vídeo enviado')
    } catch (uploadError) {
      toast.error('Falha ao enviar o vídeo', {
        hint: uploadError instanceof Error ? uploadError.message : undefined,
      })
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    setSubmitting(true)
    try {
      // No modo mágico, a IA sobrescreve a configuração com os melhores defaults
      const finalForm = magicMode ? {
        ...form,
        name: `🚀 Auto-Scaling Magic ${new Date().toLocaleDateString('pt-BR')}`,
        budgetOptimization: 'campaign' as const,
        budgetType: 'daily' as const,
        budgetAmount: Math.max(Number(form.budgetAmount) || 0, TIKTOK_MIN_BUDGET),
        countries: 'BR', // Pode ser expandido
        callToAction: 'SHOP_NOW',
      } : form

      const payload = {
        adAccountId: advertiserId,
        goal: 'conversions',
        name: finalForm.name.trim(),
        budgetAmount: Number(finalForm.budgetAmount),
        budgetType: finalForm.budgetType,
        budgetOptimization: finalForm.budgetOptimization,
        bidStrategy: 'lowest_cost',
        endDate: finalForm.budgetType === 'lifetime' ? finalForm.endDate : undefined,
        countries: finalForm.countries
          .split(/[\s,]+/)
          .map((country) => country.trim().toUpperCase())
          .filter(Boolean),
        videoUrl: finalForm.videoUrl.trim(),
        body: finalForm.body.trim() || undefined,
        linkUrl: finalForm.linkUrl.trim(),
        callToAction: finalForm.callToAction || undefined,
        idempotencyKey,
      }

      await apiSend('/api/ads/create/preflight', 'POST', payload)
      await apiSend('/api/ads/create', 'POST', payload)
      
      toast.success('Campanha Lançada com Sucesso! 🚀', {
        hint: magicMode 
          ? 'A IA definiu a estrutura ótima (CBO, Máxima Conversão) baseada no seu Pixel. Apenas relaxe.' 
          : 'A campanha foi criada com suas configurações manuais.',
      })
      onCreated()
    } catch (submitError) {
      toast.error('Não foi possível criar a campanha', {
        hint: submitError instanceof Error ? submitError.message : undefined,
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <DialogPortal><div
      className="ads-dialog fixed inset-0 z-[60] flex justify-center bg-[radial-gradient(circle_at_top,rgba(37,244,238,.08),#050506_55%)] p-0 backdrop-blur-3xl sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Nova campanha de conversão"
        tabIndex={-1}
        className="anim-pop-in flex h-full w-full max-w-3xl flex-col border-x border-white/10 bg-card/80 shadow-2xl outline-none sm:h-[calc(100dvh-3rem)] sm:rounded-2xl sm:border"
      >
        <header className="border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Rocket className="size-4 text-primary" aria-hidden="true" />
                Nova campanha
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">Conversão · compra · TikTok</p>
            </div>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} disabled={submitting} aria-label="Fechar">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {/* MAGIC TOGGLE */}
          <div className="mt-6 flex items-center justify-center p-1 rounded-xl bg-secondary/30 border border-border">
            <button
              className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all flex items-center justify-center gap-2 ${magicMode ? 'bg-[color:var(--brand-cyan)] text-black shadow-[0_0_15px_rgba(37,244,238,0.4)] scale-[1.02]' : 'text-muted-foreground hover:bg-white/5'}`}
              onClick={() => setMagicMode(true)}
              disabled={submitting}
            >
              <Wand2 className="size-4" />
              Modo Inteligente (IA)
            </button>
            <button
              className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all flex items-center justify-center gap-2 ${!magicMode ? 'bg-secondary text-foreground shadow-md' : 'text-muted-foreground hover:bg-white/5'}`}
              onClick={() => setMagicMode(false)}
              disabled={submitting}
            >
              Modo Manual
            </button>
          </div>

          {!magicMode && (
            <ol className="mt-4 grid grid-cols-3 gap-2" aria-label="Etapas">
              {STEPS.map((label, index) => (
                <li
                  key={label}
                  aria-current={index === step ? 'step' : undefined}
                  className={`rounded-lg border px-2 py-2 text-center text-[11px] font-medium ${
                    index === step
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : index < step
                        ? 'border-success/30 text-success'
                        : 'border-border text-muted-foreground'
                  }`}
                >
                  {index + 1}. {label}
                </li>
              ))}
            </ol>
          )}
        </header>

        <main className="flex-1 overflow-y-auto px-5 py-5">
          {magicMode ? (
            <section className="anim-content-in space-y-6">
              
              <div className="rounded-xl border border-[color:var(--brand-cyan)]/30 bg-[color:var(--brand-cyan)]/5 p-4 relative overflow-hidden">
                <Sparkles className="absolute right-4 top-4 size-16 text-[color:var(--brand-cyan)]/10" />
                <h3 className="text-sm font-bold text-foreground mb-1">Criação Expressa (Zero Setup)</h3>
                <p className="text-xs text-muted-foreground max-w-[85%]">
                  Nossa inteligência assume o controle. Vamos aplicar CBO com Máxima Conversão, usar seu Pixel e abrir o público para você apenas escalar.
                </p>
              </div>

              <div>
                <span className="text-xs font-bold text-foreground uppercase tracking-widest">Vídeo do Criativo</span>
                <label className="mt-1.5 flex min-h-32 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-border bg-secondary/20 p-4 text-center transition-all hover:border-[color:var(--brand-cyan)]/50 hover:bg-[color:var(--brand-cyan)]/5">
                  <input
                    type="file"
                    accept="video/*"
                    className="sr-only"
                    disabled={uploading}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void uploadVideo(file)
                    }}
                  />
                  {uploading ? (
                    <span className="flex items-center gap-2 text-sm font-bold text-[color:var(--brand-cyan)]"><Loader2 className="size-5 animate-spin" /> Fazendo upload para o TikTok...</span>
                  ) : (
                    <span className="text-sm font-bold text-muted-foreground flex flex-col items-center"><UploadCloud className="mb-2 size-8 text-foreground/50" />Arraste um vídeo ou clique para enviar</span>
                  )}
                </label>
                <input
                  className="input mt-2 w-full"
                  type="url"
                  value={form.videoUrl}
                  onChange={(event) => update('videoUrl', event.target.value)}
                  placeholder="...ou cole a URL HTTPS do vídeo se preferir"
                />
              </div>

              <label className="block text-xs font-bold text-foreground uppercase tracking-widest">
                Link do Produto (URL Mágica)
                <input
                  className="input mt-1.5 w-full bg-secondary/30"
                  type="url"
                  value={form.linkUrl}
                  onChange={(event) => update('linkUrl', event.target.value)}
                  placeholder="Ex: https://link.suasaude.com/oferta"
                />
              </label>

              <label className="block text-xs font-bold text-foreground uppercase tracking-widest">
                Texto Principal (Opcional)
                <textarea
                  className="input mt-1.5 min-h-24 w-full resize-y bg-secondary/30"
                  value={form.body}
                  onChange={(event) => update('body', event.target.value)}
                  maxLength={100}
                  placeholder="Escreva algo curto para chamar atenção..."
                />
              </label>
            </section>
          ) : (
            <>
              {step === 0 && (
                <section className="anim-content-in space-y-4">
                  <label className="block text-xs font-medium text-foreground">
                    Nome
                    <input
                      className="input mt-1.5 w-full"
                      value={form.name}
                      onChange={(event) => update('name', event.target.value)}
                      placeholder="Ex.: Produto X · Brasil · ABO"
                      autoFocus
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs font-medium text-foreground">
                      Orçamento ({currency})
                      <input
                        className="input mt-1.5 w-full"
                        type="number"
                        min={TIKTOK_MIN_BUDGET}
                        step="0.01"
                        value={form.budgetAmount}
                        onChange={(event) => update('budgetAmount', event.target.value)}
                        placeholder={String(TIKTOK_MIN_BUDGET)}
                      />
                    </label>
                    <label className="block text-xs font-medium text-foreground">
                      Período
                      <select
                        className="input mt-1.5 w-full"
                        value={form.budgetType}
                        onChange={(event) => update('budgetType', event.target.value as FormState['budgetType'])}
                      >
                        <option value="daily">Por dia</option>
                        <option value="lifetime">Total da campanha</option>
                      </select>
                    </label>
                  </div>

                  {form.budgetType === 'lifetime' && (
                    <label className="block text-xs font-medium text-foreground">
                      Data de término
                      <input
                        className="input mt-1.5 w-full"
                        type="date"
                        min={tomorrowLocalIsoDate()}
                        value={form.endDate}
                        onChange={(event) => update('endDate', event.target.value)}
                      />
                    </label>
                  )}

                  <fieldset>
                    <legend className="text-xs font-medium text-foreground">Distribuição do orçamento</legend>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      {([
                        ['adgroup', 'ABO', 'Por conjunto'],
                        ['campaign', 'CBO', 'Pela campanha'],
                      ] as const).map(([value, label, hint]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => update('budgetOptimization', value)}
                          className={`rounded-xl border p-3 text-left ${
                            form.budgetOptimization === value
                              ? 'border-primary/50 bg-primary/10'
                              : 'border-border bg-secondary/30 hover:border-primary/30'
                          }`}
                        >
                          <span className="block text-xs font-semibold text-foreground">{label}</span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <label className="block text-xs font-medium text-foreground">
                    Países
                    <input
                      className="input mt-1.5 w-full uppercase"
                      value={form.countries}
                      onChange={(event) => update('countries', event.target.value)}
                      placeholder="BR"
                    />
                    <span className="mt-1 block text-[11px] font-normal text-muted-foreground">Separe por vírgula. O público permanece amplo para escala.</span>
                  </label>
                </section>
              )}

              {step === 1 && (
                <section className="anim-content-in space-y-4">
                  <div>
                    <span className="text-xs font-medium text-foreground">Vídeo</span>
                    <label className="mt-1.5 flex min-h-24 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border bg-secondary/20 p-4 text-center hover:border-primary/40">
                      <input
                        type="file"
                        accept="video/*"
                        className="sr-only"
                        disabled={uploading}
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (file) void uploadVideo(file)
                        }}
                      />
                      {uploading ? (
                        <span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Enviando vídeo…</span>
                      ) : (
                        <span className="text-xs text-muted-foreground"><UploadCloud className="mx-auto mb-2 size-5 text-primary" />Clique para enviar</span>
                      )}
                    </label>
                    <input
                      className="input mt-2 w-full"
                      type="url"
                      value={form.videoUrl}
                      onChange={(event) => update('videoUrl', event.target.value)}
                      placeholder="ou cole a URL HTTPS do vídeo"
                    />
                  </div>

                  <label className="block text-xs font-medium text-foreground">
                    Página do produto
                    <input
                      className="input mt-1.5 w-full"
                      type="url"
                      value={form.linkUrl}
                      onChange={(event) => update('linkUrl', event.target.value)}
                      placeholder="https://sualoja.com/produto"
                    />
                  </label>

                  <label className="block text-xs font-medium text-foreground">
                    Texto do anúncio
                    <textarea
                      className="input mt-1.5 min-h-24 w-full resize-y"
                      value={form.body}
                      onChange={(event) => update('body', event.target.value)}
                      maxLength={100}
                      placeholder="Uma mensagem curta e direta"
                    />
                    <span className="mt-1 block text-right text-[11px] font-normal text-muted-foreground">{form.body.length}/100</span>
                  </label>

                  <label className="block text-xs font-medium text-foreground">
                    Botão
                    <select
                      className="input mt-1.5 w-full"
                      value={form.callToAction}
                      onChange={(event) => update('callToAction', event.target.value)}
                    >
                      {TIKTOK_CTA_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </section>
              )}

              {step === 2 && (
                <section className="anim-content-in space-y-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
                    Pronta para criar
                  </div>
                  <dl className="divide-y divide-border rounded-xl border border-border bg-secondary/20 px-4">
                    {[
                      ['Campanha', form.name.trim()],
                      ['Estratégia', `${form.budgetOptimization === 'campaign' ? 'CBO' : 'ABO'} · ${currency} ${Number(form.budgetAmount).toLocaleString('pt-BR')} ${form.budgetType === 'daily' ? 'por dia' : 'total'}`],
                      ['Público', form.countries.toUpperCase()],
                      ['Objetivo', 'Conversão · compra'],
                      ['Pixel', 'Da conta TikTok'],
                      ['Destino', form.linkUrl.trim()],
                    ].map(([label, value]) => (
                      <div key={label} className="grid grid-cols-[110px_1fr] gap-3 py-3 text-xs">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="break-all font-medium text-foreground">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-xs text-muted-foreground">A campanha, o conjunto e o anúncio serão criados pausados para revisão segura.</p>
                </section>
              )}
            </>
          )}
        </main>

        <footer className="border-t border-border px-5 py-4">
          {error && <p className="mb-3 text-xs text-destructive" role="alert">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className="btn-ghost"
              onClick={(step === 0 || magicMode) ? onClose : () => setStep((current) => current - 1)}
              disabled={submitting}
            >
              {step > 0 && !magicMode && <ChevronLeft className="size-4" aria-hidden="true" />}
              {(step === 0 || magicMode) ? 'Cancelar' : 'Voltar'}
            </button>
            
            {magicMode ? (
              <button 
                type="button" 
                className="btn-primary w-1/2 flex items-center justify-center gap-2 bg-[color:var(--brand-cyan)] text-black hover:bg-[color:var(--brand-cyan)] hover:brightness-110 border-none shadow-[0_0_20px_rgba(37,244,238,0.4)] transition-all hover:scale-[1.02]" 
                disabled={Boolean(error) || uploading || submitting} 
                onClick={() => void submit()}
              >
                {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Rocket className="size-4" aria-hidden="true" />}
                Lançar Foguete 🚀
              </button>
            ) : (
              step < STEPS.length - 1 ? (
                <button type="button" className="btn-primary" disabled={Boolean(error) || uploading} onClick={() => setStep((current) => current + 1)}>
                  Continuar <ChevronRight className="size-4" aria-hidden="true" />
                </button>
              ) : (
                <button type="button" className="btn-primary" disabled={submitting} onClick={() => void submit()}>
                  {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Rocket className="size-4" aria-hidden="true" />}
                  Criar pausada
                </button>
              )
            )}
          </div>
        </footer>
      </div>
    </div></DialogPortal>
  )
}

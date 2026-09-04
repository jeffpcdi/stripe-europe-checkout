'use client'

// Feedback premium e discreto. Respeita redução de movimento e a preferência
// local `roi_action_feedback=off`; vibração simplesmente não opera em aparelhos
// sem suporte.
export function actionFeedback() {
  if (typeof window === 'undefined' || localStorage.getItem('roi_action_feedback') === 'off') return
  if (navigator.vibrate) navigator.vibrate(18)
  try {
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(520, ctx.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(760, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.018, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1)
    oscillator.connect(gain).connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.11)
    oscillator.addEventListener('ended', () => void ctx.close())
  } catch {
    // Autoplay e WebAudio variam entre navegadores; feedback nunca bloqueia a ação.
  }
}

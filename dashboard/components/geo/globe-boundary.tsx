'use client'

import { Component, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

/** Uma falha de WebGL ou do módulo não derruba a Visão geral. */
export class GlobeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <div className="presence-stage">
      <div className="presence-loading flex-col" role="status">
        <p>Não foi possível abrir o globo.</p>
        <button type="button" className="presence-retry" onClick={() => this.setState({ failed: false })}><RefreshCw size={14} />Tentar novamente</button>
        <p className="text-xs">Se persistir, verifique a aceleração gráfica do navegador.</p>
      </div>
    </div>
  }
}

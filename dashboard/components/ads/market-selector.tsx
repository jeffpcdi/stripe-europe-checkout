'use client'

export type AdMarket = { countries: string[]; languages: string[] }
const MARKETS = [
  ['BR', 'Brasil', 'pt'], ['PT', 'Portugal', 'pt'], ['US', 'Estados Unidos', 'en'],
  ['GB', 'Reino Unido', 'en'], ['CA', 'Canadá', 'en'], ['AU', 'Austrália', 'en'],
  ['ES', 'Espanha', 'es'], ['MX', 'México', 'es'], ['AR', 'Argentina', 'es'],
  ['CL', 'Chile', 'es'], ['CO', 'Colômbia', 'es'], ['FR', 'França', 'fr'],
  ['DE', 'Alemanha', 'de'], ['IT', 'Itália', 'it'], ['JP', 'Japão', 'ja'],
] as const
export function defaultMarket(country = 'BR'): AdMarket {
  return { countries: [country], languages: [] }
}

export function MarketSelector({ value, onChange, disabled, languageAvailable = true }: {
  value: AdMarket; onChange: (value: AdMarket) => void; disabled?: boolean; languageAvailable?: boolean
}) {
  return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-border bg-secondary/20 p-3">
    <legend className="px-1 text-xs font-semibold">Onde anunciar</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs text-muted-foreground">País
        <select className="input-base w-full" value={value.countries[0]} onChange={(event) => {
          const country = event.target.value
          const language = MARKETS.find((market) => market[0] === country)?.[2]
          onChange({ countries: [country], languages: languageAvailable && language ? [language] : [] })
        }}>
          {!MARKETS.some((market) => market[0] === value.countries[0]) && <option value={value.countries[0]}>{value.countries[0]}</option>}
          {MARKETS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">Idioma do público
        <select className="input-base w-full" disabled={!languageAvailable} value={value.languages[0] || ''} onChange={(event) => onChange({ ...value, languages: event.target.value ? [event.target.value] : [] })}>
          <option value="">Todos os idiomas</option>
          {[['pt', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol'], ['fr', 'Francês'], ['de', 'Alemão'], ['it', 'Italiano'], ['ja', 'Japonês']].map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
    </div>
    <p className="text-[11px] text-muted-foreground">Vale para todo o lote. Use vídeo, texto e página no idioma escolhido.{!languageAvailable && ' O conector ainda não permite filtrar idioma neste formato.'}</p>
  </fieldset>
}

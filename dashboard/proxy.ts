import { NextResponse, type NextRequest } from 'next/server'

// Guard de autenticação da dashboard Next.js.
//
// A sessão é do Express (cookie HttpOnly `dash_session`, compartilhado via
// COOKIE_DOMAIN=.dominio.com em produção). Aqui só checamos a PRESENÇA do
// cookie — a validação real acontece no Express a cada chamada de API
// (401 → o cliente redireciona). Sem cookie, mandamos direto pro login.
//
// Login do Express. Como a dashboard é servida via proxy no MESMO domínio
// do Express (/dashboard), o redirect padrão é relativo ao próprio host.
// EXPRESS_LOGIN_URL só é necessária se o login morar em outro domínio.
const LOGIN_URL = process.env.EXPRESS_LOGIN_URL || '/login'

export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has('dash_session')
  if (hasSession) return NextResponse.next()

  // Sem sessão → login do Express (que após autenticar leva à dashboard)
  return NextResponse.redirect(new URL(LOGIN_URL, request.url))
}

export const config = {
  // Protege todas as rotas de página; ignora assets estáticos, as APIs
  // (que já são proxiadas pro Express, dono da validação de sessão) e
  // qualquer arquivo com extensão (ex: logo .jpg do /public — o otimizador
  // de imagens do Next busca o arquivo internamente SEM cookie de sessão,
  // e um redirect pro login quebraria a renderização da logo).
  matcher: ['/((?!api|assets|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}

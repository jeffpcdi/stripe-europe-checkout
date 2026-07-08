import { NextResponse, type NextRequest } from 'next/server'

// Guard de autenticação da dashboard Next.js.
//
// A sessão é do Express (cookie HttpOnly `dash_session`, compartilhado via
// COOKIE_DOMAIN=.dominio.com em produção). Aqui só checamos a PRESENÇA do
// cookie — a validação real acontece no Express a cada chamada de API
// (401 → o cliente redireciona). Sem cookie, mandamos direto pro login.
//
// LOGIN_URL: URL absoluta do login do Express.
//   dev      → http://localhost:3000/login (mesmo host, cookies compartilhados)
//   produção → https://dominio.com/login
const LOGIN_URL = process.env.EXPRESS_LOGIN_URL || 'http://localhost:3000/login'

export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has('dash_session')
  if (hasSession) return NextResponse.next()

  // Sem sessão → login do Express (que após autenticar leva à dashboard)
  return NextResponse.redirect(LOGIN_URL)
}

export const config = {
  // Protege todas as rotas de página; ignora assets estáticos e as APIs
  // (que já são proxiadas pro Express, dono da validação de sessão).
  matcher: ['/((?!api|assets|_next/static|_next/image|favicon.ico).*)'],
}

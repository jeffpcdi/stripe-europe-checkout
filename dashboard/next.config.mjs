/** @type {import('next').NextConfig} */
const nextConfig = {
  // A dashboard vive sob /dashboard — o Express (servidor público) faz
  // proxy reverso de /dashboard/* para este app (porta interna 3001).
  // Assim tudo roda no MESMO domínio: sessão, APIs e WS sem CORS.
  basePath: '/dashboard',
  // Em dev o app é acessado ATRAVÉS do proxy do Express (porta 3000) —
  // sem isso o runtime dev do Next bloqueia a origem e a hidratação
  // falha silenciosamente (página fica presa nos skeletons).
  // Só afeta desenvolvimento; produção usa `next start` e ignora isso.
  allowedDevOrigins: ['localhost:3000', '127.0.0.1:3000'],
  experimental: {
    viewTransition: true,
  },
  async rewrites() {
    // Em dev, o front acessa o Next direto (localhost:3001/dashboard) e as
    // chamadas fetch('/api/...') caem aqui — proxiamos pro Express local.
    // Em produção o Express é quem serve /api no mesmo domínio, mas manter
    // o rewrite (apontando pra loopback) é inofensivo e cobre o dev.
    const apiUrl = process.env.EXPRESS_API_URL || 'http://localhost:3000'
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
        basePath: false,
      },
      {
        source: '/assets/:path*',
        destination: `${apiUrl}/assets/:path*`,
        basePath: false,
      },
      {
        source: '/logout',
        destination: `${apiUrl}/logout`,
        basePath: false,
      },
    ]
  },
}

export default nextConfig

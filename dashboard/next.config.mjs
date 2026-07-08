/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    viewTransition: true,
  },
  async rewrites() {
    // Em dev, proxia as APIs para o Express local (sem CORS).
    // Em produção, NEXT_PUBLIC_API_URL aponta direto pro Express (Railway).
    const apiUrl = process.env.EXPRESS_API_URL || 'http://localhost:3000'
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
      {
        source: '/assets/:path*',
        destination: `${apiUrl}/assets/:path*`,
      },
      {
        source: '/logout',
        destination: `${apiUrl}/logout`,
      },
    ]
  },
}

export default nextConfig

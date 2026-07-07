'use client'

// Sparklines SVG leves — réplica dos spark()/sparkBars() legados.

export function SparkLine({
  data,
  color,
  width = 96,
  height = 28,
}: {
  data: number[]
  color: string
  width?: number
  height?: number
}) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - 3 - ((v - min) / range) * (height - 6)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="1000"
        style={{ animation: 'drawLine 1.2s var(--ease) both' }}
      />
    </svg>
  )
}

export function SparkBars({
  data,
  color,
  width = 96,
  height = 28,
}: {
  data: number[]
  color: string
  width?: number
  height?: number
}) {
  if (data.length === 0) return null
  const max = Math.max(...data, 1)
  const bw = Math.max(width / data.length - 2, 2)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="shrink-0"
    >
      {data.map((v, i) => {
        const h = Math.max((v / max) * (height - 4), 1.5)
        return (
          <rect
            key={i}
            x={(i * width) / data.length + 1}
            y={height - h}
            width={bw}
            height={h}
            rx="1"
            fill={color}
            opacity={0.85}
            style={{
              transformOrigin: `center ${height}px`,
              animation: `barUp 500ms var(--spring) both`,
              animationDelay: `${i * 30}ms`,
            }}
          />
        )
      })}
    </svg>
  )
}

'use client'

import { useEffect, useState } from 'react'

interface Star {
  id: number
  top: number
  left: number
  delay: number
}

export function ShootingStars() {
  const [stars, setStars] = useState<Star[]>([])

  useEffect(() => {
    // Generate a fixed number of stars with random positions and delays
    const newStars = Array.from({ length: 15 }).map((_, i) => ({
      id: i,
      top: Math.random() * 80, // 0 to 80%
      left: Math.random() * 80 + 20, // 20 to 100% (so they fly left)
      delay: Math.random() * 10, // 0 to 10s delay
    }))
    setStars(newStars)
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {stars.map((star) => (
        <div
          key={star.id}
          className="shooting-star"
          style={{
            top: `${star.top}%`,
            left: `${star.left}%`,
            animationDelay: `${star.delay}s`,
          }}
        />
      ))}
    </div>
  )
}

'use client'

import { useEffect } from 'react'

export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .catch((error) => console.warn('Service worker registration failed', error))
  }, [])
  return null
}

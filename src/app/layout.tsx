import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { PRODUCT_NAME } from './branding'
import { RegisterServiceWorker } from './register-sw'
import './styles.css'

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: 'A local-first term-sheet bargaining studio.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  )
}

import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import '@/styles/globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'StageFlow',
    template: '%s | StageFlow',
  },
  description:
    'The competition management platform built for dance. Entries, scheduling, invoicing, and real-time results — all in one place.',
  keywords: ['dance competition', 'event management', 'dance studio', 'competition software', 'StageFlow'],
  openGraph: {
    title: 'StageFlow',
    description: 'The competition management platform built for dance.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          forcedTheme="dark"
          disableTransitionOnChange
        >
          {children}
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              style: {
                background: '#202020',
                color: '#FFFFFF',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '0px',
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}

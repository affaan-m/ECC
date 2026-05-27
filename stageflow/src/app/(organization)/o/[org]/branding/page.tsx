import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Branding',
  description: 'Customize your competition branding and visual identity.',
}

export default function BrandingPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Branding</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Customize the look and feel of your competition portal
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Logo upload */}
        <div className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Logo</h2>
          <div className="flex items-center gap-6">
            <div className="flex h-24 w-24 items-center justify-center border border-dashed border-border bg-surface-elevated text-foreground-muted">
              Logo
            </div>
            <div>
              <button type="button" className="btn-outline-gold px-4 py-2 text-xs">UPLOAD LOGO</button>
              <p className="mt-2 text-xs text-foreground-muted">PNG or SVG. Max 2MB. Min 200x200px.</p>
            </div>
          </div>
        </div>

        {/* Favicon */}
        <div className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Favicon</h2>
          <div className="flex items-center gap-6">
            <div className="flex h-16 w-16 items-center justify-center border border-dashed border-border bg-surface-elevated text-xs text-foreground-muted">
              ICO
            </div>
            <div>
              <button type="button" className="btn-outline-gold px-4 py-2 text-xs">UPLOAD FAVICON</button>
              <p className="mt-2 text-xs text-foreground-muted">ICO or PNG. 32x32px recommended.</p>
            </div>
          </div>
        </div>

        {/* Color scheme */}
        <div className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Color Scheme</h2>
          <div className="space-y-4">
            {[
              { label: 'Primary Color', value: '#FFC000', desc: 'Buttons, links, accents' },
              { label: 'Background', value: '#000000', desc: 'Page background' },
              { label: 'Surface', value: '#202020', desc: 'Cards and panels' },
              { label: 'Text', value: '#FFFFFF', desc: 'Primary text color' },
            ].map((color) => (
              <div key={color.label} className="flex items-center gap-4">
                <div className="h-10 w-10 border border-border" style={{ backgroundColor: color.value }} />
                <div className="flex-1">
                  <div className="text-sm font-medium">{color.label}</div>
                  <div className="text-xs text-foreground-muted">{color.desc}</div>
                </div>
                <input
                  type="text"
                  defaultValue={color.value}
                  className="input-dark w-28 font-mono text-sm"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Typography */}
        <div className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Typography</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="heading-font" className="mb-1.5 block text-sm font-medium text-foreground-secondary">
                Heading Font
              </label>
              <select id="heading-font" className="input-dark w-full">
                <option>Inter (Default)</option>
                <option>Montserrat</option>
                <option>Poppins</option>
                <option>Raleway</option>
              </select>
            </div>
            <div>
              <label htmlFor="body-font" className="mb-1.5 block text-sm font-medium text-foreground-secondary">
                Body Font
              </label>
              <select id="body-font" className="input-dark w-full">
                <option>Inter (Default)</option>
                <option>Open Sans</option>
                <option>Lato</option>
                <option>Source Sans Pro</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div className="surface-card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-muted">Live Preview</h2>
        <div className="border border-border bg-background p-8">
          <div className="mx-auto max-w-md text-center">
            <div className="mx-auto mb-4 h-12 w-12 bg-gold-muted" />
            <h3 className="text-xl font-bold">Summer Showcase 2026</h3>
            <p className="mt-2 text-sm text-foreground-muted">Register your studio for our annual showcase.</p>
            <button type="button" className="btn-gold mt-4 px-6 py-2 text-sm">REGISTER NOW</button>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button type="button" className="btn-outline-gold px-5 py-2.5 text-xs">RESET TO DEFAULTS</button>
        <button type="button" className="btn-gold px-5 py-2.5 text-xs">SAVE CHANGES</button>
      </div>
    </div>
  )
}

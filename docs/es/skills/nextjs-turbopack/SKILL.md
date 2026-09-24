---
name: nextjs-turbopack
description: Next.js 16+ y Turbopack — bundling incremental, caché en sistema de archivos, velocidad de desarrollo y cuándo usar Turbopack frente a webpack.
origin: ECC
---

# Next.js y Turbopack

Next.js 16+ usa Turbopack por defecto para el desarrollo local: un bundler incremental escrito en Rust que acelera significativamente el inicio del servidor de desarrollo y las actualizaciones en caliente.

## Cuándo Usar

- **Turbopack (desarrollo por defecto)**: Usar para el desarrollo diario. Inicio en frío y HMR más rápidos, especialmente en apps grandes.
- **Webpack (desarrollo heredado)**: Usar solo si encuentras un bug de Turbopack o dependes de un plugin exclusivo de webpack en desarrollo. Desactivar con `--webpack` (o `--no-turbopack` según la versión de Next.js; consultar la documentación de tu versión).
- **Producción**: El comportamiento del build de producción (`next build`) puede usar Turbopack o webpack según la versión de Next.js; consultar la documentación oficial de Next.js para tu versión.

Usar cuando: se desarrollen o depuren apps Next.js 16+, se diagnostique un inicio de desarrollo lento o HMR, o se optimicen bundles de producción.

## Cómo Funciona

- **Turbopack**: Bundler incremental para el desarrollo de Next.js. Usa caché en sistema de archivos para que los reinicios sean mucho más rápidos (ej. 5-14x en proyectos grandes).
- **Por defecto en desarrollo**: Desde Next.js 16, `next dev` se ejecuta con Turbopack a menos que se deshabilite.
- **Caché en sistema de archivos**: Los reinicios reutilizan el trabajo anterior; la caché está típicamente en `.next`; no se necesita configuración adicional para uso básico.
- **Bundle Analyzer (Next.js 16.1+)**: Bundle Analyzer experimental para inspeccionar la salida y encontrar dependencias pesadas; habilitarlo mediante configuración o flag experimental (ver documentación de Next.js para tu versión).

## Ejemplos

### Comandos

```bash
next dev
next build
next start
```

### Uso

Ejecutar `next dev` para el desarrollo local con Turbopack. Usar el Bundle Analyzer (ver documentación de Next.js) para optimizar el code-splitting y eliminar dependencias grandes. Preferir App Router y server components donde sea posible.

## Nomenclatura del Archivo de Middleware

Next.js 16 introdujo `proxy.ts` como nombre del archivo de middleware, reemplazando la convención anterior de `middleware.ts`:

- **Next.js 16+**: usar `proxy.ts` en la raíz del proyecto
- **Anterior a Next.js 16**: usar `middleware.ts` en la raíz del proyecto

El cambio de nombre de archivo está vinculado a la **versión de Next.js**, no al bundler que se usa (Turbopack o webpack). Siempre consultar la documentación oficial para la versión que se está revisando.

**No marcar `proxy.ts` como un archivo de middleware mal nombrado o faltante en proyectos Next.js 16.** El archivo es correcto e intencional. Sugerir renombrarlo a `middleware.ts` romperá la ejecución del middleware.

## Buenas Prácticas

- Mantenerse en una versión reciente de Next.js 16.x para un comportamiento estable de Turbopack y caché.
- Si el desarrollo es lento, asegurarse de estar usando Turbopack (predeterminado) y que la caché no se esté borrando innecesariamente.
- Para problemas de tamaño de bundle en producción, usar las herramientas oficiales de análisis de bundle de Next.js para tu versión.

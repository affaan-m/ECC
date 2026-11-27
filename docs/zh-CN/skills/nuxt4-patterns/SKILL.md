---
name: nuxt4-patterns
description: Nuxt 4 应用模式，涵盖水合安全、性能优化、路由规则、懒加载，以及使用 useFetch 和 useAsyncData 进行 SSR 安全的数据获取。
origin: ECC
---

# Nuxt 4 模式

在构建或调试具有 SSR、混合渲染、路由规则或页面级数据获取的 Nuxt 4 应用时使用。

## 何时激活

* 服务器 HTML 与客户端状态之间的水合不匹配
* 路由级别的渲染决策，例如预渲染、SWR、ISR 或仅客户端部分
* 围绕懒加载、延迟水合或有效负载大小的性能工作
* 使用 `useFetch`、`useAsyncData` 或 `$fetch` 进行页面或组件数据获取
* 与路由参数、中间件或 SSR/客户端差异相关的 Nuxt 路由问题

## 水合安全性

* 保持首次渲染是确定性的。不要将 `Date.now()`、`Math.random()`、仅限浏览器的 API 或存储读取直接放入 SSR 渲染的模板状态中。
* 当服务器无法生成相同标记时，将仅限浏览器的逻辑移到 `onMounted()`、`import.meta.client`、`ClientOnly` 或 `.client.vue` 组件后面。
* 使用 Nuxt 的 `useRoute()` 组合式函数，而不是来自 `vue-router` 的那个。
* 不要使用 `route.fullPath` 来驱动 SSR 渲染的标记。URL 片段是仅客户端的，这可能导致水合不匹配。
* 将 `ssr: false` 视为真正仅限浏览器区域的逃生舱口，而不是解决不匹配的默认修复方法。

## 数据获取

* 在页面和组件中，优先使用 `await useFetch()` 进行 SSR 安全的 API 读取。它将服务器获取的数据转发到 Nuxt 有效负载中，并避免在水合时进行第二次获取。
* 当数据获取器不是简单的 `$fetch()` 调用，或者需要自定义键，或者正在组合多个异步源时，使用 `useAsyncData()`。
* 为 `useAsyncData()` 提供一个稳定的键以重用缓存并实现可预测的刷新行为。
* 保持 `useAsyncData()` 处理程序无副作用。它们可能在 SSR 和水合期间运行。
* 将 `$fetch()` 用于用户触发的写入或仅客户端操作，而不是应该从 SSR 水合而来的顶级页面数据。
* 对于不应阻塞导航的非关键数据，使用 `lazy: true`、`useLazyFetch()` 或 `useLazyAsyncData()`。在 UI 中处理 `status === 'pending'`。
* 仅对 SEO 或首次绘制不需要的数据使用 `server: false`。
* 使用 `pick` 修剪有效负载大小，并在不需要深层响应性时优先使用较浅的有效负载。

```ts
const route = useRoute()

const { data: article, status, error, refresh } = await useAsyncData(
  () => `article:${route.params.slug}`,
  () => $fetch(`/api/articles/${route.params.slug}`),
)

const { data: comments } = await useFetch(`/api/articles/${route.params.slug}/comments`, {
  lazy: true,
  server: false,
})
```

## 路由规则

在 `nuxt.config.ts` 中优先使用 `routeRules` 来定义渲染和缓存策略：

```ts
export default defineNuxtConfig({
  routeRules: {
    '/': { prerender: true },
    '/products/**': { swr: 3600 },
    '/blog/**': { isr: true },
    '/admin/**': { ssr: false },
    '/api/**': { cache: { maxAge: 60 * 60 } },
  },
})
```

* `prerender`：在构建时生成静态 HTML
* `swr`：提供缓存内容并在后台重新验证
* `isr`：在支持的平台上进行增量静态再生
* `ssr: false`：客户端渲染的路由
* `cache` 或 `redirect`：Nitro 级别的响应行为

按路由组选择路由规则，而非全局设置。营销页面、产品目录、仪表板和 API 通常需要不同的策略。

## 懒加载与性能

* Nuxt 已经按路由进行代码分割。在微优化组件分割之前，保持路由边界的意义。
* 使用 `Lazy` 前缀来动态导入非关键组件。
* 使用 `v-if` 有条件地渲染懒加载组件，以便在 UI 实际需要时才加载该代码块。
* 对首屏下方或非关键的交互式 UI 使用延迟水合。

```vue
<template>
  <LazyRecommendations v-if="showRecommendations" />
  <LazyProductGallery hydrate-on-visible />
</template>
```

* 对于自定义策略，使用 `defineLazyHydrationComponent()` 配合可见性或空闲策略。
* Nuxt 延迟水合适用于单文件组件。向延迟水合的组件传递新 props 将立即触发水合。
* 在内部导航中使用 `NuxtLink`，以便 Nuxt 可以预取路由组件和生成的有效负载。

## 检查清单

* 首次 SSR 渲染和水合后的客户端渲染产生相同的标记
* 页面数据使用 `useFetch` 或 `useAsyncData`，而非顶层的 `$fetch`
* 非关键数据是懒加载的，并具有明确的加载 UI
* 路由规则符合页面的 SEO 和新鲜度要求
* 重量级交互式组件是懒加载或延迟水合的

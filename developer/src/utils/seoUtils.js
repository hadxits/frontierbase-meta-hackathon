/**
 * SEO Utilities for FrontierBase Developer Documentation
 * Dynamic meta title, description, Open Graph, Twitter Card, JSON-LD
 * Vue 3 compatible
 */

const BASE_URL = 'https://developers.frontierbase.io'
const DEFAULT_OG_IMAGE = `${BASE_URL}/image/icons/android-chrome-512x512.png`

/**
 * Generate meta tags for a page
 * @param {Object} options - SEO options
 * @param {string} options.title - Page title
 * @param {string} options.description - Meta description
 * @param {string} options.url - Canonical URL
 * @param {string} options.type - OG type (website, article)
 * @param {string} options.image - OG/Twitter image URL
 * @returns {Object} Meta tags object
 */
export function generateMetaTags({
  title = 'FrontierBase Developer Documentation',
  description = 'API reference for Session and Chat (RAG), plus the chatbot script guide to embed a chat widget on your site.',
  url = BASE_URL,
  type = 'website',
  image = DEFAULT_OG_IMAGE
} = {}) {
  return {
    title,
    meta: [
      { name: 'title', content: title },
      { name: 'description', content: description },
      { name: 'author', content: 'FrontierBase' },
      { name: 'robots', content: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1' },
      { property: 'og:url', content: url },
      { property: 'og:type', content: type },
      { property: 'og:site_name', content: 'FrontierBase Developer Documentation' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:image', content: image },
      { property: 'og:image:width', content: '512' },
      { property: 'og:image:height', content: '512' },
      { property: 'og:image:alt', content: title },
      { property: 'twitter:card', content: 'summary_large_image' },
      { property: 'twitter:title', content: title },
      { property: 'twitter:description', content: description },
      { property: 'twitter:image', content: image },
      { property: 'twitter:image:alt', content: title }
    ],
    link: [{ rel: 'canonical', href: url }]
  }
}

/**
 * Update document title and meta tags dynamically
 * @param {Object} options - { titleKey?, descriptionKey?, title?, description?, url? }
 * @param {Function} t - i18n translation function (optional)
 * @param {string} currentLocale - Current locale code (optional)
 */
export function updatePageSEO(options, t = null, currentLocale = null) {
  let finalOptions = { ...options }
  if (t && typeof t === 'function') {
    if (options.titleKey) finalOptions.title = t(options.titleKey)
    if (options.descriptionKey) finalOptions.description = t(options.descriptionKey)
  }
  finalOptions.url = finalOptions.url || BASE_URL

  if (currentLocale) {
    document.documentElement.lang = currentLocale
    const ogLocaleMap = {
      ko: 'ko_KR',
      en: 'en_US',
      ja: 'ja_JP',
      'zh-TW': 'zh_TW',
      de: 'de_DE',
      it: 'it_IT',
      fr: 'fr_FR',
      es: 'es_ES'
    }
    const ogLocale = ogLocaleMap[currentLocale] || 'en_US'
    let el = document.querySelector('meta[property="og:locale"]')
    if (el) el.setAttribute('content', ogLocale)
    else {
      el = document.createElement('meta')
      el.setAttribute('property', 'og:locale')
      el.setAttribute('content', ogLocale)
      document.head.appendChild(el)
    }
  }

  const meta = generateMetaTags(finalOptions)

  if (document.title !== meta.title) document.title = meta.title

  meta.meta.forEach((tag) => {
    const selector = tag.property ? `meta[property="${tag.property}"]` : `meta[name="${tag.name}"]`
    let element = document.querySelector(selector)
    if (!element && tag.property) {
      element = document.querySelector(`meta[name="${tag.property}"]`)
      if (element) {
        element.removeAttribute('name')
        element.setAttribute('property', tag.property)
      }
    }
    if (!element && tag.name) {
      element = document.querySelector(`meta[property="${tag.name}"]`)
      if (element) {
        element.removeAttribute('property')
        element.setAttribute('name', tag.name)
      }
    }
    if (!element) {
      element = document.createElement('meta')
      if (tag.property) element.setAttribute('property', tag.property)
      else element.setAttribute('name', tag.name)
      document.head.appendChild(element)
    }
    if (element) element.setAttribute('content', tag.content)
  })

  if (meta.link?.length) {
    let canonical = document.querySelector('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.setAttribute('rel', 'canonical')
      document.head.appendChild(canonical)
    }
    canonical.setAttribute('href', meta.link[0].href)
  }
}

/**
 * Inject JSON-LD script into document head
 * @param {Object} jsonLd - JSON-LD object
 * @param {string} id - Unique ID for the script
 */
export function injectJsonLd(jsonLd, id = 'json-ld') {
  const existing = document.getElementById(id)
  if (existing) existing.remove()
  const script = document.createElement('script')
  script.id = id
  script.type = 'application/ld+json'
  script.textContent = JSON.stringify(jsonLd)
  document.head.appendChild(script)
}

/**
 * Generate JSON-LD for WebSite (developer docs)
 * @param {Function} t - i18n translation function (optional)
 * @returns {Object} JSON-LD object
 */
export function generateWebsiteJsonLd(t = null) {
  let description = 'API reference for FrontierBase Session API and Chat (RAG) API, plus the chatbot script guide to embed a chat widget on your site.'
  if (t && typeof t === 'function') {
    const key = 'meta.website.description'
    if (t(key) !== key) description = t(key)
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'FrontierBase Developer Documentation',
    url: BASE_URL,
    description
  }
}

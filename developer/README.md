# FrontierBase Developer Documentation

Documentation site for [developers.frontierbase.io](https://developers.frontierbase.io): Session API and Chat API usage for `https://api.frontierbase.io/session` and `https://api.frontierbase.io/chat`.

## Stack

- Vue 3
- Vite
- Vue Router
- vue-i18n (en, ko, ja, it, de, fr, zh-TW, es)

## Setup

```bash
cd developer
npm install
npm run dev
```

## Build

```bash
npm run build
```

Output is in `dist/`. Deploy that folder to your host (e.g. Firebase Hosting, Vercel, or any static host) for `https://developers.frontierbase.io`.

**SPA fallback:** The app uses HTML5 history mode (no `#` in URLs). Configure your host so that requests to `/session`, `/chat`, `/chatbot`, etc. are served with `index.html` (e.g. Firebase: `"rewrites": [{"source": "**", "destination": "/index.html"}]`; nginx: `try_files $uri $uri/ /index.html`).

## Reference

Layout and structure inspired by [Cursor Docs](https://cursor.com/docs).
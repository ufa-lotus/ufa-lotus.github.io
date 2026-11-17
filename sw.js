/*
 * Service worker «Лотос Детейлинг».
 *
 * Что он делает:
 *  - при установке сохраняет оболочку приложения: все страницы (главная, запись, гараж,
 *    профиль, конфиденциальность), скрипты, стили, шрифты, иконки и офлайн-страницу.
 *    Список файлов и версию подставляет scripts/gh-postbuild.mjs после сборки;
 *  - страницы запрашивает из сети, а без сети отдаёт сохранённые — приложение открывается офлайн;
 *  - статику отдаёт по схеме stale-while-revalidate: сразу из кэша, а в фоне обновляет.
 *
 * Личных данных в страницах нет: профиль, гараж и заявки лежат в localStorage устройства.
 *
 * Обновление: новая версия скачивается в фоне и ждёт. Страница показывает «Доступна новая версия»
 * (не во время заполнения заявки и мойки) и по нажатию «Обновить» присылает SKIP_WAITING.
 * Кэши привязаны к VERSION: после активации старые удаляются целиком.
 */
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const VERSION = "lotos-abe7646d92";
const STATIC = `lotos-static-${VERSION}`;
const PAGES = `lotos-pages-${VERSION}`;
const OFFLINE_URL = `${BASE}/offline.html`;

/** Страницы-оболочки: без личных данных, их можно показывать из кэша. */
const SHELL = ["/", "/booking/", "/garage/", "/profile/", "/privacy/", "/call/"].map((p) => `${BASE}${p}`);
/** Файлы сборки — подставляются после `next build`. */
const ASSETS = ["/_next/static/JzTqVrbYXIeNDBXFiRARb/_buildManifest.js","/_next/static/JzTqVrbYXIeNDBXFiRARb/_clientMiddlewareManifest.js","/_next/static/JzTqVrbYXIeNDBXFiRARb/_ssgManifest.js","/_next/static/chunks/0cz1d0mv5g_q7.js","/_next/static/chunks/0l4cq3rhrk14i.js","/_next/static/chunks/0qs_5y57wi-qj.js","/_next/static/chunks/13jocodtc_m5k.js","/_next/static/chunks/14chcq9aigrco.js","/_next/static/chunks/14mtyhp9gu5r-.js","/_next/static/chunks/164uauvwgs3mv.js","/_next/static/chunks/16gdf-wkea2iz.js","/_next/static/chunks/17ff3iaz9jz6-.js","/_next/static/chunks/1g7nauncuafa3.js","/_next/static/chunks/1imjnz-52_-w3.js","/_next/static/chunks/1k6vud4yuzdun.js","/_next/static/chunks/1pcw6gskne7pf.js","/_next/static/chunks/1ua2kfq9s-me6.js","/_next/static/chunks/1wt7al7iiuzbs.js","/_next/static/chunks/2cjb_6g9zsglo.js","/_next/static/chunks/2fxo7t787hc55.js","/_next/static/chunks/2whg2n5r_t_s1.js","/_next/static/chunks/3-qlvrln-i_is.js","/_next/static/chunks/306l4kye9fggg.js","/_next/static/chunks/346ye3ng2qydu.js","/_next/static/chunks/3ppwoaa_odsd_.js","/_next/static/chunks/3qfyyoib054k_.css","/_next/static/chunks/44yf2y15n4xoh.js","/_next/static/chunks/turbopack-2u1d16houkiyo.js","/_next/static/chunks/turbopack-2zirdtg2ogys5.js","/_next/static/chunks/turbopack-worker-1hrsqshz0gfey.js","/_next/static/media/276a8f4fe816cb6b-s.p.2v2sz4qlut9s1.woff2","/_next/static/media/33ee198db9637ef4-s.23qr8woi9ij9e.woff2","/_next/static/media/82450a180bcad83c-s.p.0p-wng2nn8o-p.woff2","/_next/static/media/82b67ad56d243b47-s.09bkcrcuv-0po.woff2","/_next/static/media/fbb7028efdf70529-s.1_0gbi-gsbqmd.woff2","/_next/static/media/ffc7b595a48b6846-s.3q9gh2jvntrwt.woff2","/_next/static/media/generateMeshBVH.worker.420b_2wru1rq7.js","/images/car-dirty-1000.webp","/images/car-dirty.webp","/images/car-ground-shadow.webp"];
const ICONS = [`${BASE}/icons/icon-192.png`, `${BASE}/icons/icon-512.png`, `${BASE}/brand/logo.png`, `${BASE}/manifest.webmanifest`];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const pages = await caches.open(PAGES);
      await pages.addAll([OFFLINE_URL, ...SHELL]);
      const statics = await caches.open(STATIC);
      // По одному: если какой-то файл не скачался, остальные всё равно сохранятся.
      await Promise.all([...ICONS, ...ASSETS.map((a) => `${BASE}${a}`)].map((u) => statics.add(u).catch(() => {})));
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== PAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request, { ignoreSearch: true });
  const fresh = fetch(request)
    .then((response) => {
      // Частичные ответы (206) в Cache Storage положить нельзя.
      if (response.ok && response.status === 200) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || fresh;
}

/** Ключ страницы: /garage и /garage/ — одна и та же оболочка. */
const pageKey = (url) => (url.pathname.endsWith("/") || url.pathname.includes(".") ? url.pathname : `${url.pathname}/`);

async function page(request, url) {
  const key = pageKey(url);
  try {
    const response = await fetch(request);
    if (response.ok && SHELL.includes(key)) {
      const cache = await caches.open(PAGES);
      cache.put(key, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(PAGES);
    return (
      (await cache.match(key)) ||
      (await cache.match(OFFLINE_URL)) ||
      new Response("Нет подключения к интернету", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(page(request, url));
    return;
  }
  if (!url.pathname.startsWith(`${BASE}/`)) return;
  // Данные переходов внутри приложения (RSC): из сети, без сети — из кэша, если есть.
  if (/\.txt$/.test(url.pathname) || request.headers.has("RSC") || url.searchParams.has("_rsc")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(STATIC).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request, { ignoreSearch: true })) || Response.error()),
    );
    return;
  }
  if (/\.(?:js|css|woff2?|png|webp|svg|glb|webmanifest|json)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

const CACHE_NAME = "pwpal-v3";
const APP_SHELL = [
	"./",
	"./index.html",
	"./global.css",
	"./main.js",
	"./manifest.webmanifest",
	"./icons/icon.svg",
	"./icons/icon-192.png",
	"./icons/icon-512.png"
].map(path => new URL(path, self.location.href).href);

self.addEventListener("install", event => {
	event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", event => {
	event.waitUntil((async () => {
		const keys = await caches.keys();
		await Promise.all(keys.filter(key => key.startsWith("pwpal-") && key !== CACHE_NAME)
			.map(key => caches.delete(key)));
		await self.clients.claim();
	})());
});

self.addEventListener("fetch", event => {
	if (event.request.method !== "GET") return;
	if (event.request.mode !== "navigate" && !APP_SHELL.includes(event.request.url)) return;
	event.respondWith(caches.open(CACHE_NAME).then(async cache => {
		const cached = await cache.match(event.request.mode === "navigate" ? APP_SHELL[1] : event.request);
		return cached || fetch(event.request);
	}));
});

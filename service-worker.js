/* =====================================================================
   टॉयलेट सेवा v2.0 — Service Worker
   अहिल्यानगर महानगरपालिका
   App shell: cache-first  |  नकाशा टाइल्स: stale-while-revalidate
   ===================================================================== */

var VERSION    = 'v2.2.0-qr';
var SHELL_CACHE = 'toilet-seva-shell-' + VERSION;
var TILE_CACHE  = 'toilet-seva-tiles-' + VERSION;
var LIB_CACHE   = 'toilet-seva-lib-'  + VERSION;
var TILE_LIMIT  = 300;

/* अत्यावश्यक फाइल्स — इंटरनेट नसताना ॲप याच फाइल्सवर चालते */
var CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

/* वैकल्पिक — नसल्यास install अयशस्वी होऊ नये (उदा. logo.png अजून जोडलेला नसेल) */
var OPTIONAL = [
  './logo.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.addAll(CORE).then(function () {
        // प्रत्येक वैकल्पिक फाइल स्वतंत्रपणे — एक अयशस्वी झाली तरी install पूर्ण होते
        return Promise.all(OPTIONAL.map(function (url) {
          return cache.add(new Request(url, { mode: 'no-cors' })).catch(function () { /* दुर्लक्ष */ });
        }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  var keep = [SHELL_CACHE, TILE_CACHE, LIB_CACHE];
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        if (keep.indexOf(n) === -1) return caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* कॅशेचा आकार मर्यादित ठेवा */
function trimCache(cacheName, maxItems) {
  return caches.open(cacheName).then(function (cache) {
    return cache.keys().then(function (keys) {
      if (keys.length <= maxItems) return;
      return cache.delete(keys[0]).then(function () {
        return trimCache(cacheName, maxItems);
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* 1. OpenStreetMap टाइल्स — आधी कॅश, मागे नेटवर्कने अद्ययावत */
  if (/tile\.openstreetmap\.org$/.test(url.hostname)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          var net = fetch(req).then(function (res) {
            if (res && (res.ok || res.type === 'opaque')) {
              cache.put(req, res.clone());
              trimCache(TILE_CACHE, TILE_LIMIT);
            }
            return res;
          }).catch(function () { return hit; });
          return hit || net;
        });
      })
    );
    return;
  }

  /* Firestore चे थेट (live) कनेक्शन कधीही अडवू नका —
     onSnapshot चा प्रवाह कॅश केल्यास तो तुटतो */
  if (/^(firestore|firebaseinstallations|identitytoolkit|securetoken)\.googleapis\.com$/.test(url.hostname)) {
    return;
  }

  /* 2. Leaflet + Firebase लायब्ररी (CDN) — cache-first */
  if (url.hostname === 'unpkg.com' || url.hostname === 'www.gstatic.com') {
    event.respondWith(
      caches.open(LIB_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  /* 3. इतर बाह्य विनंत्या — service worker मध्ये हाताळू नका */
  if (url.origin !== self.location.origin) return;

  /* 4. नेव्हिगेशन — नेटवर्क आधी, अयशस्वी झाल्यास कॅशमधील index.html */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(SHELL_CACHE).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || new Response(
            '<h1 style="font-family:sans-serif;text-align:center;margin-top:60px">' +
            'ऑफलाइन — कृपया इंटरनेट जोडून पुन्हा प्रयत्न करा</h1>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        });
      })
    );
    return;
  }

  /* 5. ॲपच्या स्वतःच्या फाइल्स — cache-first, मग नेटवर्क */
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});

/* तक्रार सुटल्याची सूचना — नोटिफिकेशनवर क्लिक केल्यास ॲप उघडा */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});

/* भविष्यातील push सूचना (Play Store आवृत्तीसाठी तयार) */
self.addEventListener('push', function (event) {
  var data = { title: 'टॉयलेट सेवा', body: 'तुमच्या तक्रारीची स्थिती बदलली आहे.' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body, icon: './icon.svg', badge: './icon.svg', lang: 'mr', tag: 'toilet-seva'
    })
  );
});

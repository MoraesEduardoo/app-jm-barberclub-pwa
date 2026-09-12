// worker/index.js
//
// O @ducanh2912/next-pwa procura automaticamente por este arquivo
// (worker/index.js na raiz do projeto) e injeta o conteúdo dele via
// importScripts() dentro do public/sw.js gerado a cada build de
// produção. É aqui — e não no public/sw.js, que é sobrescrito a cada
// build — que ficam os listeners de Web Push.
//
// Sem este arquivo, a API /api/push/send até envia a notificação com
// sucesso, mas nenhum aviso aparece no aparelho do barbeiro: é o
// service worker quem precisa escutar o evento "push" e chamar
// showNotification.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'JM Barberclub', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'JM Barberclub';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/logo-192.png',
    badge: data.badge || '/icons/logo-192.png',
    data: { url: data.url || '/admin' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/admin';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

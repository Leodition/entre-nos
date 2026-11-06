self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    await self.registration.showNotification("Entre Nós", {
      body: "Chegou algo novo na sua conversa.",
      icon: "/entre-nos-192.png",
      tag: "entre-nos",
    });
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    windows.forEach((client) => client.postMessage({ type: "new-message" }));
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const conversation = windows.find((client) => new URL(client.url).pathname === "/entre-nos.html");
    if (conversation) return conversation.focus();
    return self.clients.openWindow("/entre-nos.html");
  })());
});

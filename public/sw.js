self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      payload = { title: "Pocket", body: event.data?.text() || "You have a reminder." };
    }

    const title = payload.title || "Pocket";
    const options = {
      body: payload.body || "You have a reminder.",
      tag: payload.tag || "pocket-reminder",
      renotify: true,
      data: { url: payload.url || "/" },
    };

    await self.registration.showNotification(title, options);

    try {
      if (self.registration.setAppBadge && payload.badge !== false) {
        await self.registration.setAppBadge(1);
      }
    } catch {}
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client && client.url !== new URL(url, self.location.origin).href) {
          await client.navigate(url);
        }
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(url);
  })());
});

self.addEventListener("notificationclose", () => {});

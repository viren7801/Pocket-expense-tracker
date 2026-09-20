function base64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function registerPocketServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser does not support service workers.");
  }
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function getPocketPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const registration = await registerPocketServiceWorker();
  return registration.pushManager.getSubscription();
}

export async function enablePocketNotifications() {
  if (!window.isSecureContext) {
    throw new Error("Phone notifications require HTTPS.");
  }
  if (!("Notification" in window)) {
    throw new Error("Notifications are not available here. On iPhone, install Pocket on the Home Screen first.");
  }
  if (!("PushManager" in window)) {
    throw new Error("Push notifications are not supported by this browser.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked. Enable Pocket notifications in your device settings."
        : "Notification permission was not granted.",
    );
  }

  const keyResponse = await fetch("/api/push?action=vapid-key");
  const keyData = await keyResponse.json();
  if (!keyResponse.ok || !keyData.publicKey) {
    throw new Error(keyData.error || "Push notifications are not configured.");
  }

  const registration = await registerPocketServiceWorker();
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8Array(keyData.publicKey),
    });
  }

  const payload = subscription.toJSON();
  const response = await fetch("/api/push?action=subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not save notification subscription.");

  return subscription;
}

export async function disablePocketNotifications() {
  const subscription = await getPocketPushSubscription();
  if (!subscription) return true;

  await fetch("/api/push?action=unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });

  return subscription.unsubscribe();
}

export async function sendPocketTestNotification() {
  const response = await fetch("/api/push?action=test", {
    method: "POST",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not send test notification.");
  return data;
}

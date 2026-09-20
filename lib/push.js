import webpush from "web-push";

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function configure() {
  webpush.setVapidDetails(
    env("VAPID_SUBJECT"),
    env("VAPID_PUBLIC_KEY"),
    env("VAPID_PRIVATE_KEY"),
  );
}

export async function sendPushNotification(subscription, payload) {
  configure();
  return webpush.sendNotification(
    subscription,
    JSON.stringify(payload),
    { TTL: 60 * 60 },
  );
}

export async function sendPushToAll(supabase, payload) {
  const { data: subscriptions, error } = await supabase
    .from("push_subscription")
    .select("id, endpoint, p256dh, auth");

  if (error) throw error;

  let sent = 0;
  let failed = 0;
  const staleIds = [];

  for (const row of subscriptions || []) {
    try {
      await sendPushNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        payload,
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = Number(error?.statusCode || error?.status || 0);
      if (statusCode === 404 || statusCode === 410) staleIds.push(row.id);
      console.error("Web Push send failed:", error);
    }
  }

  if (staleIds.length) {
    await supabase.from("push_subscription").delete().in("id", staleIds);
  }

  return { sent, failed, total: (subscriptions || []).length };
}

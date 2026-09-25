import webpush from 'web-push'
import { createClient } from '@/lib/supabase/server'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

export async function POST(request) {
  try {
    const { title, body, userId } = await request.json()
    const supabase = createClient()

    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId)

    if (error || !subscriptions) {
      return Response.json({ success: false, error: 'Subscrições não encontradas' }, { status: 404 })
    }

    const payload = JSON.stringify({ title, body, icon: '/icons/logo-192.png' })

    const notifications = subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }

      try {
        await webpush.sendNotification(pushSubscription, payload)
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Remove subscrição expirada/inválida do Supabase
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        } else {
          console.error('Erro ao enviar push notification:', err)
        }
      }
    })

    await Promise.all(notifications)
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 })
  }
}
// ════════════════════════════════════════════════════════════
// BOT-WATCHDOG — Trigger Processor
// תפקיד: בודק טבלת bot_triggers כל דקה.
//         כשיש טריגר pending — מפעיל את הבוט ב-Railway API.
//
// תדירות: כל דקה (Railway cron: * * * * *)
//
// Env vars:
//   SUPABASE_URL          — כבר ב-.env
//   SUPABASE_SERVICE_KEY  — כבר ב-.env
//   RAILWAY_API_TOKEN     — ee56f3e5-3ebc-4eee-83a5-38074eac157b
// ════════════════════════════════════════════════════════════

import supabase from '../shared/supabaseClient.mjs';
import { createLogger } from '../shared/logger.mjs';

const BOT_ID = 'BOT-WATCHDOG';
const log = createLogger(BOT_ID);

const RAILWAY_SERVICE_IDS = {
  'BOT-17': 'f7809f56-93a4-4468-be6d-f73cf3ba2a52',
  'BOT-18': '86f1d7ff-1f07-4971-8f1f-bb528cd5f42c',
  'BOT-19': '43a4e602-0bad-4bc8-886a-19fc9657c058',
  'BOT-20': 'fe52be8f-9493-41ec-be84-4433a8a1eabe',
  'BOT-22': '5a0fd1c9-53f1-42a3-b8cd-cea7bcf9d591',
  'BOT-23': 'a4ec6a30-9428-4f2a-84ff-f6c9d8162698',
  'BOT-26': 'eebde9ff-1666-4cc5-951d-3e3478fe04c5',
  'BOT-27': '45087bfe-155c-416e-afff-5079acb934f0',
  'BOT-29': '452f924d-f99a-493e-8486-71ffa8a253f6',
  'BOT-30': '9d4046f5-bbb9-4ee0-907d-46c652a7bf8c',
  'BOT-35': '0fb3ab19-312f-4f67-8848-8aa6389e164e',
  'BOT-72': '62779f8c-100c-4801-83d1-298b13adeea0',
  'BOT-09': '2e271abd-3b9f-4bcc-bb06-84738c727842',
}

const RAILWAY_ENV_ID = '0f84555d-e42d-43bb-a082-764108dbbec5'

// ════════════════════════════════════════════════════════════
// processTriggers — בודק ומפעיל טריגרים pending
// ════════════════════════════════════════════════════════════

async function processTriggers() {
  const { data: triggers, error } = await supabase
    .from('bot_triggers')
    .select('*')
    .eq('status', 'pending')
    .order('triggered_at', { ascending: true })
    .limit(5)

  if (error || !triggers?.length) return

  for (const trigger of triggers) {
    log.log(`🎯 טריגר ידני: ${trigger.bot_id}`)

    // סמן כ-processing
    await supabase.from('bot_triggers')
      .update({ status: 'processing' })
      .eq('id', trigger.id)

    try {
      const serviceId = RAILWAY_SERVICE_IDS[trigger.bot_id]
      if (serviceId) {
        const mutation = `mutation { serviceInstanceRedeploy(environmentId: "${RAILWAY_ENV_ID}", serviceId: "${serviceId}") }`
        await fetch('https://backboard.railway.app/graphql/v2', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.RAILWAY_API_TOKEN}`,
          },
          body: JSON.stringify({ query: mutation }),
        })
        log.ok(`✅ ${trigger.bot_id} הופעל ב-Railway`)
      } else {
        log.warn(`⚠️ ${trigger.bot_id} — אין Service ID`)
      }

      await supabase.from('bot_triggers')
        .update({ status: 'done' })
        .eq('id', trigger.id)

    } catch (e) {
      await supabase.from('bot_triggers')
        .update({ status: 'error' })
        .eq('id', trigger.id)
      log.warn(`❌ שגיאה: ${e.message}`)
    }
  }
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — Trigger Processor`)

  let logId
  try {
    const { data, error } = await supabase
      .from('bots_log')
      .insert({ bot_id: BOT_ID, status: 'running' })
      .select('id').single()
    if (!error) logId = data.id
  } catch (e) { log.warn(`bots_log: ${e.message}`) }

  await processTriggers()

  if (logId) {
    await supabase.from('bots_log').update({
      finished_at: new Date().toISOString(),
      status: 'done',
      errors: log.errors,
    }).eq('id', logId)
  }

  return { errors: log.errors }
}

const isMain = process.argv[1]?.endsWith('bot-watchdog.mjs')
if (isMain) {
  main().catch(err => { console.error('❌ BOT-WATCHDOG crashed:', err); process.exit(1) })
}

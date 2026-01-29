import { chromium } from "playwright"

import {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  CITY,
  STREET,
  HOUSE,
  SHUTDOWNS_PAGE,
} from "./constants.js"

import {
  capitalize,
  deleteLastMessage,
  getCurrentTime,
  loadLastMessage,
  saveLastMessage,
} from "./helpers.js"

async function getInfo() {
  console.log("🌀 Getting info...")

  const browser = await chromium.launch({ headless: true })
  const browserPage = await browser.newPage()

  try {
    await browserPage.goto(SHUTDOWNS_PAGE, {
      waitUntil: "load",
    })

    const csrfTokenTag = await browserPage.waitForSelector(
      'meta[name="csrf-token"]',
      { state: "attached" }
    )
    const csrfToken = await csrfTokenTag.getAttribute("content")

    const info = await browserPage.evaluate(
      async ({ CITY, STREET, csrfToken }) => {
        const formData = new URLSearchParams()
        formData.append("method", "getHomeNum")
        formData.append("data[0][name]", "city")
        formData.append("data[0][value]", CITY)
        formData.append("data[1][name]", "street")
        formData.append("data[1][value]", STREET)
        formData.append("data[2][name]", "updateFact")
        formData.append("data[2][value]", new Date().toLocaleString("uk-UA"))

        const response = await fetch("/ua/ajax", {
          method: "POST",
          headers: {
            "x-requested-with": "XMLHttpRequest",
            "x-csrf-token": csrfToken,
          },
          body: formData,
        })
        return await response.json()
      },
      { CITY, STREET, csrfToken }
    )

    console.log("✅ Getting info finished.")
    return info
  } catch (error) {
    throw Error(`❌ Getting info failed: ${error.message}`)
  } finally {
    await browser.close()
  }
}

function checkIsLastMessage(lastMessage) {
  const isLastMessage = lastMessage?.message_id && lastMessage?.start_date &&
      lastMessage?.end_date && lastMessage?.reason?.trim()

  return isLastMessage
}

function checkIsOutage(info) {
  console.log("🌀 Checking power outage...")

  if (!info?.data) {
    throw Error("❌ Power outage info missed.")
  }

  const { sub_type, start_date, end_date, type } = info?.data?.[HOUSE] || {}
  const isOutageDetected =
    sub_type !== "" || start_date !== "" || end_date !== "" || type !== ""

  isOutageDetected
    ? console.log("🚨 Power outage detected!")
    : console.log("⚡️ No power outage!")

  return isOutageDetected
}

function checkIsScheduled(info) {
  console.log("🌀 Checking whether power outage scheduled...")

  if (!info?.data) {
    throw Error("❌ Emergency power outage info missed.")
  }

  const { sub_type } = info?.data?.[HOUSE] || {}
  const isScheduled =
    !sub_type.toLowerCase().includes("авар") &&
    !sub_type.toLowerCase().includes("екст")

  isScheduled
    ? console.log("🗓️ Power outage scheduled!")
    : console.log("⚠️ Power outage not scheduled!")

  return isScheduled
}

function generateOutageMessage(info) {
  console.log("🌀 Generating outage message...")

  const { sub_type, start_date, end_date } = info?.data?.[HOUSE] || {}
  const { updateTimestamp } = info || {}

  const reason = capitalize(sub_type)

  return {
    text: [
      `⚡️ <b>Зафіксовано відключення:</b>`,
      "",
      `🪫 Час початку - ${start_date}`,
      `🔌 Орієнтовний час відновлення - ${end_date}`,
      "",
      `⚠️ <i>${reason}.</i>`,
      "",
      `🔄 <i>Дата оновлення інформації – ${updateTimestamp}</i>`,
      `💬 <i>Дата оновлення повідомлення – ${getCurrentTime()}</i>`
    ].join("\n"),
    start_date: start_date,
    end_date: end_date,
    reason: reason
  }
}

function generateCancelMessage(info, lastMessage) {
  console.log("🌀 Generating cancel message...")

  if ( checkIsLastMessage(lastMessage) ) {
    const { updateTimestamp } = info || {}
    const start_date = lastMessage?.start_date
    const end_date = lastMessage?.end_date
    const reason = capitalize(lastMessage?.reason)
  
    return {
      text: [
        `<s>⚡️ <b>Зафіксовано відключення:</b></s>`,
        "",
        `<s>🪫 Час початку - ${start_date}</s>`,
        `<s>🔌 Орієнтовний час відновлення - ${end_date}</s>`,
        "",
        `<s>⚠️ <i>${reason}.</i></s>`,
        "",
        `🔄 <i>Дата оновлення інформації – ${updateTimestamp}</i>`,
        `💬 <i>Дата оновлення повідомлення – ${getCurrentTime()}</i>`
      ].join("\n"),
      start_date: start_date,
      end_date: end_date,
      reason: reason
    }
  } else {
     console.log("🔴 Missing last message.")
  }
}

function generateBlankMessage(info) {
  console.log("🌀 Generating blank message...")

  const currentTime = getCurrentTime()
  const { updateTimestamp } = info || {}
  const reason = `Інформація про відключення відсутня`
  
  return {
    text: [
      `⚡️ <b>Наразі, без екстрених відключень:</b>`,
      "",
      `⚠️ <i>Якщо в даний момент у вас відсутнє світло, імовірно виникла аварійна ситуація. Перевірте інформацію через 15 хвилин на сайті ДТЕК.
У разі відсутності світла у зоні, що гарантує його наявність (на графіку – білий колір), оформіть заявку на сайті ДТЕК.</i>`,
      "",
      `🔄 <i>Дата оновлення інформації – ${updateTimestamp}</i>`,
      `💬 <i>Дата оновлення повідомлення – ${currentTime}</i>`
    ].join("\n"),
    start_date: `0`,
    end_date: `0`,
    reason: reason
  }
}

async function sendNotification(message, lastMessage) {
  if (!TELEGRAM_BOT_TOKEN)
    throw Error("❌ Missing telegram bot token or chat id.")
  if (!TELEGRAM_CHAT_ID) throw Error("❌ Missing telegram chat id.")

  console.log("🌀 Sending notification...")

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${
        lastMessage?.message_id &&
        message?.start_date === lastMessage?.start_date &&
        message?.end_date === lastMessage?.end_date &&
        message?.reason?.trim() === lastMessage?.reason?.trim()
        ? "editMessageText" : "sendMessage"        
      }`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message?.text ?? undefined,
          parse_mode: "HTML",
          message_id: lastMessage.message_id ?? undefined,
        }),
      }
    )

    const data = await response.json()
      
    if (!response.ok) {
      if ( data?.error_code === 400 && data?.description?.includes("message is not modified")) {
        console.log("ℹ️ Telegram: message not modified, skipping")
        return
      }
      console.error("🪲 Telegram API error:", JSON.stringify(data, null, 2));
    } else {
      saveLastMessage({ ...data.result, ...message})
      console.log("🟢 Notification sent.")
      //console.log("🪲 Telegram API response:", JSON.stringify(data, null, 2));
    } 
  } catch (error) {
    console.log("🔴 Notification not sent.", error.message)
    saveLastMessage()
  }
}

async function sendCancelReplay(lastMessage) {
  if (!TELEGRAM_BOT_TOKEN)
    throw Error("❌ Missing telegram bot token or chat id.")
  if (!TELEGRAM_CHAT_ID) throw Error("❌ Missing telegram chat id.")

  if ( checkIsLastMessage(lastMessage) ) {
    console.log("🌀 Sending cancel replay...")
    
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: [
              `🔌 <b>Наразі, без екстрених відключень:</b>`,
              "",
            `⚠️ <i>Якщо в даний момент у вас відсутнє світло, імовірно виникла аварійна ситуація. Перевірте інформацію через 15 хвилин на сайті ДТЕК.
У разі відсутності світла у зоні, що гарантує його наявність (на графіку – білий колір), оформіть заявку на сайті ДТЕК.</i>`
            ].join("\n"),
            parse_mode: "HTML",
            reply_to_message_id: lastMessage.message_id,
          }),
        }
      )
  
      console.log("🟢 Cancel replay sent.")
    } catch (error) {
      console.log("🔴 Cancel replay not sent.", error.message) 
    }
  } else {
      console.log("🌀 Missing notification message.")
  }
  saveLastMessage()
}

async function clearTGQueue() {
  if (!TELEGRAM_BOT_TOKEN)
    throw Error("❌ Missing telegram bot token or chat id.")
  if (!TELEGRAM_CHAT_ID) throw Error("❌ Missing telegram chat id.")
  
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`);
  const data = await res.json();

  if (!data.ok || data.result.length === 0) {
    console.log("🟢 TG Queue empty");
    return;
  }

  const lastId = data.result[data.result.length - 1].update_id;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastId + 1}`);

  console.log("🟢 Clear TG Queue to update_id:", lastId);
}

async function run() {
  const info = await getInfo()
  const lastMessage = loadLastMessage() || {}
  
  const isOutage = checkIsOutage(info)
  const isScheduled = checkIsScheduled(info)
  let message

  if (isOutage) {
    message = generateOutageMessage(info)
    await clearTGQueue()
    await sendNotification(message, lastMessage)
  } else {
    if (checkIsLastMessage(lastMessage) && !isOutage) {
      message = generateCancelMessage(info, lastMessage)
      await clearTGQueue()
      await sendNotification(message, lastMessage)
      await sendCancelReplay(lastMessage)
    }
  }
}

run().catch((error) => console.error(error.message))

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const questions = require("./questions");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const USERS_FILE = "rating.json";

let session = {};


// ================== UTIL ==================

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

// 🔥 Fisher–Yates shuffle
function shuffle(arr) {
  let array = [...arr];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ================== START ==================

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name;

  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);

  if (!user) {
    user = { chatId, name, exams: [] };
    users.push(user);
    saveUsers(users);
  }

  bot.sendMessage(
    chatId,
    `Assalom alaykum ${name}!\n\n` +
    `Imtihon botiga hush kelibsiz 🚀\n\n` +
    `▶ Imtihonni boshlash: /boshlash\n` +
    `📊 Mening natijalarim: /reyting\n` +
    `🏆 Reytinglar: /retinglar`
  );
});

// ================== BOSHLASH ==================

bot.onText(/\/boshlash/, (msg) => {
  const chatId = msg.chat.id;
  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);

  if (!user)
    return bot.sendMessage(chatId, "Iltimos avval /start bosing.");

  if (user.exams.length >= 5) {
    return bot.sendMessage(
      chatId,
      `❌ Siz 5 marta imtihon topshirgansiz.\n\nAdmin: ${process.env.ADMIN_USERNAME}`
    );
  }

  bot.sendMessage(chatId, "Imtihon 5 sekunddan keyin boshlanadi ⏳");

  setTimeout(() => {
    session[chatId] = {
      index: 0,
      score: 0,
      questions: shuffle(questions),
      timer: null,
      answered: false
    };

    sendQuestion(chatId);
  }, 5000);
});

// ================== SAVOL ==================

function sendQuestion(chatId) {
  const s = session[chatId];
  if (!s) return;

  if (s.index >= s.questions.length) {
    finishExam(chatId);
    return;
  }

  s.answered = false;
  const q = s.questions[s.index];

  const progress = `Savol ${s.index + 1}/${s.questions.length}\n\n`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        q.options.map(opt => ({
          text: `${opt}) ${q.textOptions[opt]}`,
          callback_data: JSON.stringify({
            qId: q.id,
            ans: opt
          })
        }))
      ]
    }
  };

  if (q.image && fs.existsSync(q.image)) {
    bot.sendPhoto(chatId, path.resolve(q.image), {
      caption: progress + q.question,
      ...keyboard
    });
  } else {
    bot.sendMessage(chatId, progress + q.question, keyboard);
  }

  // ⏱ 30 sekund timer
  s.timer = setTimeout(() => {
    if (!s.answered) {
      bot.sendMessage(chatId, "⏳ Vaqt tugadi!");
      s.index++;
      sendQuestion(chatId);
    }
  }, 30000);
}

// ================== JAVOB ==================

bot.on("callback_query", (cb) => {
  const chatId = cb.message.chat.id;
  const s = session[chatId];
  if (!s || s.answered) return;

  s.answered = true;
  if (s.timer) clearTimeout(s.timer);

  const data = JSON.parse(cb.data);
  const q = s.questions.find(x => x.id == data.qId);

  if (!q) return;

  if (data.ans === q.correct) {
    s.score++;
    bot.sendMessage(chatId, "✔ To‘g‘ri javob!");
  } else {
    bot.sendMessage(
      chatId,
      `❌ Noto‘g‘ri!\nTo‘g‘ri javob: ${q.correct}) ${q.textOptions[q.correct]}`
    );
  }

  s.index++;
  bot.answerCallbackQuery(cb.id);
  sendQuestion(chatId);
});

// ================== FINISH ==================

function finishExam(chatId) {
  const s = session[chatId];
  if (!s) return;

  if (s.timer) clearTimeout(s.timer);

  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);
  if (!user) return;

  user.exams.push({
    score: s.score,
    date: new Date().toISOString()
  });

  saveUsers(users);

  const remaining = 3 - user.exams.length;
  const percent = Math.round(
    (s.score / s.questions.length) * 100
  );

  let text =
    `🎉 Imtihon tugadi!\n\n` +
    `Ball: ${s.score}/${s.questions.length}\n` +
    `Foiz: ${percent}%\n\n` +
    `Qolgan urinishlar: ${remaining}\n`;

  if (remaining > 0) {
    text += `\nYana /boshlash qilishingiz mumkin.`;
  } else {
    text += `\nLimit tugadi.\nAdmin: ${process.env.ADMIN_USERNAME}`;
  }

  bot.sendMessage(chatId, text);

  delete session[chatId];
}

// ================== REYTING (SHAXSIY) ==================

bot.onText(/\/reyting$/, (msg) => {
  const chatId = msg.chat.id;
  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);

  if (!user || user.exams.length === 0)
    return bot.sendMessage(chatId, "Siz hali imtihon topshirmagansiz.");

  let text = "📊 Natijalaringiz:\n\n";

  user.exams.forEach((e, i) => {
    text += `${i + 1}. ${e.score} ball — ${new Date(
      e.date
    ).toLocaleString()}\n`;
  });

  bot.sendMessage(chatId, text);
});

// ================== GLOBAL REYTING ==================

bot.onText(/\/retinglar/, (msg) => {
  let users = loadUsers();

  const list = users
    .filter(u => u.exams.length > 0)
    .map(u => ({
      name: u.name,
      score: Math.max(...u.exams.map(e => e.score))
    }))
    .sort((a, b) => b.score - a.score);

  if (list.length === 0)
    return bot.sendMessage(msg.chat.id, "Reyting yo‘q.");

  let text = "🏆 Umumiy Reyting (Eng yaxshi natija):\n\n";

  list.forEach((u, i) => {
    text += `${i + 1}. ${u.name} — ${u.score}\n`;
  });

  bot.sendMessage(msg.chat.id, text);
});

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const questions = require("./questions");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const USERS_FILE = "rating.json";
const MAX_EXAMS = 5;
const MAX_MISSED = 5;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME; // @username

let session = {};

// ================== UTIL ==================

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function shuffle(arr) {
  let array = [...arr];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ================== MAIN MENU BUTTONS ==================

const mainMenu = {
  reply_markup: {
    keyboard: [
      ["🚀 Boshlash"],
      ["📊 Mening natijalarim"],
      ["🏆 Reytinglar"]
    ],
    resize_keyboard: true
  }
};

// ================== START ==================

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name;

  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);

  if (!user) {
    user = { chatId, name, exams: [], username: msg.from.username || "" };
    users.push(user);
    saveUsers(users);
  }

  bot.sendMessage(
    chatId,
    `Assalom alaykum ${name}!\n\nImtihon botiga hush kelibsiz 🚀`,
    mainMenu
  );
});

// ================== BUTTONS HANDLER ==================

bot.onText(/🚀 Boshlash/, (msg) => {
  bot.emit("text", { chat: msg.chat, text: "/boshlash" });
});
bot.onText(/📊 Mening natijalarim/, (msg) => {
  bot.emit("text", { chat: msg.chat, text: "/reyting" });
});
bot.onText(/🏆 Reytinglar/, (msg) => {
  bot.emit("text", { chat: msg.chat, text: "/retinglar" });
});

// ================== BOSHLASH ==================

bot.onText(/\/boshlash/, (msg) => {
  const chatId = msg.chat.id;
  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);

  if (!user)
    return bot.sendMessage(chatId, "Iltimos avval /start bosing.");

  if (user.exams.length >= MAX_EXAMS) {
    return bot.sendMessage(
      chatId,
      `❌ Siz ${MAX_EXAMS} marta imtihon topshirgansiz.\nAdmin: ${ADMIN_USERNAME}`
    );
  }

  bot.sendMessage(chatId, "Imtihon 5 sekunddan keyin boshlanadi ⏳");

  setTimeout(() => {
    session[chatId] = {
      index: 0,
      score: 0,
      questions: shuffle(questions),
      timer: null,
      answered: false,
      missed: 0
    };
    sendQuestion(chatId);
  }, 5000);
});

// ================== SEND QUESTION ==================

function sendQuestion(chatId) {
  const s = session[chatId];
  if (!s) return;

  if (s.index >= s.questions.length) return finishExam(chatId);

  s.answered = false;
  const q = s.questions[s.index];
  const progress = `Savol ${s.index + 1}/${s.questions.length}\n\n`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        q.options.map(opt => ({
          text: `${opt}) ${q.textOptions[opt]}`,
          callback_data: JSON.stringify({ qId: q.id, ans: opt })
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

  s.timer = setTimeout(() => {
    if (!s.answered) {
      s.missed++;
      if (s.missed >= MAX_MISSED) {
        bot.sendMessage(chatId,
          "⚠ Siz 5 ta savolga javob bermadingiz!\nImtihon to‘xtatildi.");
        return forceFinish(chatId);
      }
      bot.sendMessage(chatId, "⏳ Vaqt tugadi!");
      s.index++;
      sendQuestion(chatId);
    }
  }, 30000);
}

// ================== CALLBACK QUERY ==================

bot.on("callback_query", (cb) => {
  const chatId = cb.message.chat.id;

  if (cb.data === "restart_exam") {
    let users = loadUsers();
    let user = users.find(u => u.chatId === chatId);

    if (!user || user.exams.length >= MAX_EXAMS) {
      return bot.answerCallbackQuery(cb.id, {
        text: "Limit tugagan!",
        show_alert: true
      });
    }

    bot.answerCallbackQuery(cb.id);
    bot.sendMessage(chatId, "Imtihon 3 sekunddan keyin boshlanadi ⏳");

    setTimeout(() => {
      session[chatId] = {
        index: 0,
        score: 0,
        questions: shuffle(questions),
        timer: null,
        answered: false,
        missed: 0
      };
      sendQuestion(chatId);
    }, 3000);

    return;
  }

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
    bot.sendMessage(chatId,
      `❌ Noto‘g‘ri!\nTo‘g‘ri javob: ${q.correct}) ${q.textOptions[q.correct]}`
    );
  }

  s.index++;
  bot.answerCallbackQuery(cb.id);
  sendQuestion(chatId);
});

// ================== FORCE FINISH ==================

function forceFinish(chatId) {
  const s = session[chatId];
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);

  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);
  if (!user) return;

  user.exams.push({ score: s.score, date: new Date().toISOString(), forced: true });
  saveUsers(users);

  const remaining = MAX_EXAMS - user.exams.length;

  bot.sendMessage(chatId,
    `❌ Imtihon bekor qilindi!
Siz 5 ta savolga javob bermadingiz.

Qolgan imkoniyatlar: ${remaining}`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔁 Qaytadan boshlash", callback_data: "restart_exam" }]
        ]
      }
    }
  );

  delete session[chatId];
}

// ================== FINISH ==================

function finishExam(chatId) {
  const s = session[chatId];
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);

  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);
  if (!user) return;

  user.exams.push({ score: s.score, date: new Date().toISOString() });
  saveUsers(users);

  const remaining = MAX_EXAMS - user.exams.length;
  const percent = Math.round((s.score / s.questions.length) * 100);

  bot.sendMessage(chatId,
    `🎉 Imtihon tugadi!

Ball: ${s.score}/${s.questions.length}
Foiz: ${percent}%

Qolgan imkoniyatlar: ${remaining}`
  );

  delete session[chatId];
}

// ================== REYTING ==================

bot.onText(/\/reyting$/, (msg) => {
  const chatId = msg.chat.id;
  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);

  if (!user || user.exams.length === 0)
    return bot.sendMessage(chatId, "Siz hali imtihon topshirmagansiz.");

  let text = "📊 Natijalaringiz:\n\n";
  user.exams.forEach((e, i) => {
    text += `${i + 1}. ${e.score} ball — ${new Date(e.date).toLocaleString()}\n`;
  });

  bot.sendMessage(chatId, text);
});

bot.onText(/\/retinglar/, (msg) => {
  let users = loadUsers();
  const list = users
    .filter(u => u.exams.length > 0)
    .map(u => ({ name: u.name, score: Math.max(...u.exams.map(e => e.score)) }))
    .sort((a, b) => b.score - a.score);

  if (list.length === 0)
    return bot.sendMessage(msg.chat.id, "Reyting yo‘q.");

  let text = "🏆 Umumiy Reyting (Eng yaxshi natija):\n\n";
  list.forEach((u, i) => {
    text += `${i + 1}. ${u.name} — ${u.score}\n`;
  });

  bot.sendMessage(msg.chat.id, text);
});

// ================== ADMIN: USER RESET (@username) ==================

bot.onText(/\/userReset (.+)/, (msg, match) => {
  const chatUsername = msg.from.username ? `@${msg.from.username}` : "";
  if (chatUsername !== ADMIN_USERNAME) {
    return bot.sendMessage(msg.chat.id, "❌ Siz admin emassiz.");
  }

  const targetName = match[1].trim();
  let users = loadUsers();
  let user = users.find(u => u.name.toLowerCase() === targetName.toLowerCase());

  if (!user) return bot.sendMessage(msg.chat.id, "❌ Bunday user topilmadi.");

  user.exams = [];
  saveUsers(users);

  bot.sendMessage(msg.chat.id,
    `✅ ${user.name} foydalanuvchining limiti tiklandi.\nEndi u ${MAX_EXAMS} marta topshira oladi.`
  );

  bot.sendMessage(user.chatId,
    `🎉 Admin sizning limitni tikladi!\nEndi yana ${MAX_EXAMS} marta imtihon topshira olasiz.`
  );
});

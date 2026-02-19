require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const questions = require("./questions");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const USERS_FILE = "rating.json";
const MAX_EXAMS = 5;
const MAX_MISSED = 5;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;

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

// ================== MENU (ADMIN CHECK) ==================

function getMainMenu(isAdmin = false) {
  const keyboard = [
    ["🚀 Boshlash"],
    ["📊 Mening natijalarim"],
    ["🏆 Reytinglar"]
  ];

  if (isAdmin) {
    keyboard.push(["⚙ User Reset"]);
  }

  return {
    reply_markup: {
      keyboard,
      resize_keyboard: true
    }
  };
}

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

  const isAdmin =
    msg.from.username &&
    `@${msg.from.username}` === ADMIN_USERNAME;

  bot.sendMessage(
    chatId,
    `Assalom alaykum ${name}!\n\nImtihon botiga hush kelibsiz 🚀`,
    getMainMenu(isAdmin)
  );
});

// ================== START EXAM FUNCTION ==================

function startExam(chatId) {
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
}

// ================== BUTTON HANDLERS ==================

bot.onText(/🚀 Boshlash/, (msg) => {
  startExam(msg.chat.id);
});

bot.onText(/📊 Mening natijalarim/, (msg) => {
  bot.emit("text", { chat: msg.chat, text: "/reyting" });
});

bot.onText(/🏆 Reytinglar/, (msg) => {
  bot.emit("text", { chat: msg.chat, text: "/retinglar" });
});

bot.onText(/⚙ User Reset/, (msg) => {
  const chatUsername = msg.from.username ? `@${msg.from.username}` : "";

  if (chatUsername !== ADMIN_USERNAME) {
    return bot.sendMessage(msg.chat.id, "❌ Siz admin emassiz.");
  }

  bot.sendMessage(
    msg.chat.id,
    "Qaysi foydalanuvchini reset qilmoqchisiz?\n\nMasalan:\n/userReset Ali"
  );
});

// ================== SEND QUESTION ==================

function sendQuestion(chatId) {
  const s = session[chatId];
  if (!s) return;

  if (s.index >= s.questions.length) return finishExam(chatId);

  s.answered = false;
  const q = s.questions[s.index];
  const progress = `Savol ${s.index + 1}/${s.questions.length}\n\n`;

  // ✅ JAVOBLAR VERTIKAL
  const keyboard = {
    reply_markup: {
      inline_keyboard: q.options.map(opt => ([
        {
          text: `${opt}) ${q.textOptions[opt]}`,
          callback_data: JSON.stringify({ qId: q.id, ans: opt })
        }
      ]))
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
  }, 60000);
}

// ================== CALLBACK ==================

bot.on("callback_query", (cb) => {
  const chatId = cb.message.chat.id;

  if (cb.data === "restart_exam") {
    bot.answerCallbackQuery(cb.id);
    return startExam(chatId);
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

// ================== FINISH / FORCE ==================

function forceFinish(chatId) {
  const s = session[chatId];
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);

  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);
  if (!user) return;

  user.exams.push({ score: s.score, date: new Date().toISOString(), forced: true });
  saveUsers(users);

  delete session[chatId];
}

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

// ================== USER RESET COMMAND ==================

bot.onText(/\/userReset (.+)/, (msg, match) => {
  const chatUsername = msg.from.username ? `@${msg.from.username}` : "";

  if (chatUsername !== ADMIN_USERNAME) {
    return bot.sendMessage(msg.chat.id, "❌ Siz admin emassiz.");
  }

  const targetName = match[1].trim();
  let users = loadUsers();
  let user = users.find(u =>
    u.name.toLowerCase() === targetName.toLowerCase()
  );

  if (!user)
    return bot.sendMessage(msg.chat.id, "❌ Bunday user topilmadi.");

  user.exams = [];
  saveUsers(users);

  bot.sendMessage(msg.chat.id,
    `✅ ${user.name} limiti tiklandi.`
  );

  bot.sendMessage(user.chatId,
    `🎉 Admin sizning limitni tikladi!\nEndi ${MAX_EXAMS} marta topshira olasiz.`
  );
});

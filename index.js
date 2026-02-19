require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const questions = require("./questions");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const USERS_FILE = "rating.json";
const MAX_EXAMS = 5;
const MAX_MISSED = 5;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;

let session = {};
let awaitingReset = false; // Admindan username kutilmoqda

// ================= UTIL =================

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// ================= MENU =================

function getMainMenu(isAdmin = false) {
  const keyboard = [
    ["🚀 Boshlash"],
    ["📊 Mening natijalarim"],
    ["🏆 Reytinglar"]
  ];
  if (isAdmin) keyboard.push(["⚙ User Reset"]);

  return {
    reply_markup: {
      keyboard,
      resize_keyboard: true
    }
  };
}

// ================= START =================

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username ? "@" + msg.from.username : "";

  let users = loadUsers();
  let user = users.find(u => u.username === username);

  if (!user) {
    user = {
      chatId,
      name: msg.from.first_name,
      username, // @username saqlanadi
      exams: []
    };
    users.push(user);
    saveUsers(users);
  }

  const isAdmin = username === ADMIN_USERNAME;

  bot.sendMessage(
    chatId,
    `Assalom alaykum ${msg.from.first_name}!\n\nImtihon botiga hush kelibsiz 🚀`,
    getMainMenu(isAdmin)
  );
});

// ================= START EXAM =================

function startExam(chatId) {
  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);

  if (!user) return bot.sendMessage(chatId, "Avval /start bosing.");

  if (user.exams.length >= MAX_EXAMS) {
    return bot.sendMessage(chatId, `❌ Siz ${MAX_EXAMS} marta topshirgansiz.`);
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

bot.onText(/🚀 Boshlash/, (msg) => startExam(msg.chat.id));

// ================= RESULTS =================

bot.onText(/📊 Mening natijalarim/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username ? "@" + msg.from.username : "";

  let users = loadUsers();
  let user = users.find(u => u.username === username);

  if (!user || user.exams.length === 0) {
    return bot.sendMessage(chatId, "❌ Siz hali imtihon topshirmagansiz.");
  }

  let text = "📊 Natijalar:\n\n";
  user.exams.forEach((e, i) => {
    text += `${i + 1}) Ball: ${e.score} (${e.forced ? "To‘xtatilgan" : "Tugagan"})\n`;
  });

  bot.sendMessage(chatId, text);
});

// ================= RATING =================

bot.onText(/🏆 Reytinglar/, (msg) => {
  const chatId = msg.chat.id;
  let users = loadUsers();

  if (users.length === 0)
    return bot.sendMessage(chatId, "Reyting mavjud emas.");

  users.sort((a, b) => {
    const aBest = Math.max(...a.exams.map(e => e.score), 0);
    const bBest = Math.max(...b.exams.map(e => e.score), 0);
    return bBest - aBest;
  });

  let text = "🏆 Top 10 Reyting:\n\n";

  users.slice(0, 10).forEach((u, i) => {
    const best = Math.max(...u.exams.map(e => e.score), 0);
    text += `${i + 1}) ${u.username} — ${best}\n`;
  });

  bot.sendMessage(chatId, text);
});

// ================= USER RESET =================

bot.onText(/⚙ User Reset/, (msg) => {
  const username = msg.from.username ? "@" + msg.from.username : "";
  if (username !== ADMIN_USERNAME) return bot.sendMessage(msg.chat.id, "❌ Siz admin emassiz.");

  awaitingReset = true;
  bot.sendMessage(msg.chat.id, "Iltimos, reset qilmoqchi bo‘lgan userning **@username**ini yuboring (masalan: @Ali)");
});

// ================= ADMIN USERNAME QABUL =================

bot.on("message", (msg) => {
  const username = msg.from.username ? "@" + msg.from.username : "";
  if (!awaitingReset || username !== ADMIN_USERNAME) return;

  const targetUsername = msg.text.trim();
  let users = loadUsers();
  let user = users.find(u => u.username === targetUsername);

  if (!user) {
    bot.sendMessage(msg.chat.id, "❌ Bunday user topilmadi.");
    awaitingReset = false;
    return;
  }

  // Userning imtihonlarini o'chirish
  user.exams = [];
  saveUsers(users);

  bot.sendMessage(msg.chat.id, `✅ ${targetUsername} limit va reytinglari tozalandi.`);
  bot.sendMessage(user.chatId, `🎉 Admin sizning imtihon limit va reytinglaringizni yangiladi!\nEndi siz ${MAX_EXAMS} marta imtihon topshira olasiz.`);

  awaitingReset = false;
});

// ================= SEND QUESTION =================

function sendQuestion(chatId) {
  const s = session[chatId];
  if (!s) return;
  if (s.index >= s.questions.length) return finishExam(chatId);

  s.answered = false;
  const q = s.questions[s.index];
  const progress = `Savol ${s.index + 1}/${s.questions.length}\n\n`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: q.options.map(opt => ([
        {
          text: `${opt}) ${q.textOptions[opt]}`,
          callback_data: JSON.stringify({
            qId: q.id,
            index: s.index,
            ans: opt
          })
        }
      ]))
    }
  };

  // Rasm bilan yuborish
  if (q.image) {
    const photo = q.image.startsWith("http")
      ? q.image
      : fs.readFileSync(__dirname + "/" + q.image);

    bot.sendPhoto(chatId, photo, {
      caption: progress + q.question,
      reply_markup: keyboard.reply_markup
    });
  } else {
    bot.sendMessage(chatId, progress + q.question, keyboard);
  }

  s.timer = setTimeout(() => {
    if (!s.answered) {
      s.missed++;
      if (s.missed >= MAX_MISSED) {
        bot.sendMessage(chatId, "⚠ 5 ta savolga javob bermadingiz. Imtihon to‘xtatildi.");
        return forceFinish(chatId);
      }
      s.index++;
      sendQuestion(chatId);
    }
  }, 60000);
}

// ================= CALLBACK =================

bot.on("callback_query", (cb) => {
  const chatId = cb.message.chat.id;
  const s = session[chatId];
  if (!s) return;

  const data = JSON.parse(cb.data);

  if (data.index !== s.index) return bot.answerCallbackQuery(cb.id);
  if (s.answered) return;

  s.answered = true;
  if (s.timer) clearTimeout(s.timer);

  const q = s.questions[s.index];

  if (q.correct === data.ans) {
    s.score++;
    bot.sendMessage(chatId, "✔ To‘g‘ri javob!");
  } else {
    bot.sendMessage(chatId, `❌ Noto‘g‘ri!\nTo‘g‘ri javob: ${q.correct}) ${q.textOptions[q.correct]}`);
  }

  s.index++;
  bot.answerCallbackQuery(cb.id);
  sendQuestion(chatId);
});

// ================= FINISH =================

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

  const percent = Math.round((s.score / s.questions.length) * 100);

  bot.sendMessage(chatId, `🎉 Imtihon tugadi!\n\nBall: ${s.score}/${s.questions.length}\nFoiz: ${percent}%`);

  delete session[chatId];
}

// ================= FORCE FINISH =================

function forceFinish(chatId) {
  const s = session[chatId];
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);

  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);
  if (!user) return;

  user.exams.push({
    score: s.score,
    date: new Date().toISOString(),
    forced: true
  });

  saveUsers(users);
  delete session[chatId];
}

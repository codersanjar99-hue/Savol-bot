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
  const name = msg.from.first_name;

  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);

  if (!user) {
    user = {
      chatId,
      name,
      username: msg.from.username || "",
      exams: []
    };
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

// ================= START EXAM =================

function startExam(chatId) {
  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);

  if (!user) return bot.sendMessage(chatId, "Avval /start bosing.");

  if (user.exams.length >= MAX_EXAMS) {
    return bot.sendMessage(
      chatId,
      `❌ Siz ${MAX_EXAMS} marta topshirgansiz.\nAdmin: ${ADMIN_USERNAME}`
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

bot.onText(/🚀 Boshlash/, (msg) => {
  startExam(msg.chat.id);
});

// ================= RESULTS =================

bot.onText(/📊 Mening natijalarim/, (msg) => {
  const chatId = msg.chat.id;
  let users = loadUsers();
  let user = users.find(u => u.chatId === chatId);

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
    text += `${i + 1}) ${u.name} — ${best}\n`;
  });

  bot.sendMessage(chatId, text);
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
            index: s.index
          })
        }
      ]))
    }
  };

  bot.sendMessage(chatId, progress + q.question, keyboard);

  s.timer = setTimeout(() => {
    if (!s.answered) {
      s.missed++;

      if (s.missed >= MAX_MISSED) {
        bot.sendMessage(chatId,
          "⚠ 5 ta savolga javob bermadingiz. Imtihon to‘xtatildi.");
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

  // ❗ Eski savolni bloklaymiz
  if (data.index !== s.index) {
    return bot.answerCallbackQuery(cb.id);
  }

  if (s.answered) return;

  s.answered = true;
  if (s.timer) clearTimeout(s.timer);

  const q = s.questions[s.index];

  if (data.qId == q.id) {
    const selected = cb.message.reply_markup.inline_keyboard
      .flat()
      .find(btn => JSON.parse(btn.callback_data).qId == q.id);

    if (selected) {
      const userAnswer = JSON.parse(cb.data);

      if (userAnswer.qId == q.id) {
        if (q.correct === userAnswer.ans) {
          s.score++;
          bot.sendMessage(chatId, "✔ To‘g‘ri javob!");
        } else {
          bot.sendMessage(
            chatId,
            `❌ Noto‘g‘ri!\nTo‘g‘ri javob: ${q.correct}) ${q.textOptions[q.correct]}`
          );
        }
      }
    }
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

  bot.sendMessage(chatId,
    `🎉 Imtihon tugadi!

Ball: ${s.score}/${s.questions.length}
Foiz: ${percent}%`
  );

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

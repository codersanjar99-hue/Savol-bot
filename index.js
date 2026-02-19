require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const questions = require("./questions");
const User = require("./models/User");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const MAX_EXAMS = 3;
const MAX_MISSED = 5;

let session = {};

// ===== MongoDB CONNECT (FIXED) =====
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB ulandi"))
  .catch(err => console.log("Mongo xato:", err));

// ===== Level =====
function getLevel(percent) {
  if (percent >= 90) return "Expert";
  if (percent >= 70) return "Advanced";
  if (percent >= 50) return "Intermediate";
  return "Beginner";
}

// ===== START =====
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name;

  let user = await User.findOne({ chatId });

  if (!user) {
    await User.create({ chatId, name });
  }

  bot.sendMessage(chatId,
    `Imtihon botiga hush kelibsiz 🚀

/boshlash
/reyting
/retinglar`
  );
});

// ===== BOSHLASH =====
bot.onText(/\/boshlash/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await User.findOne({ chatId });

  if (!user)
    return bot.sendMessage(chatId, "Avval /start");

  if (user.exams.length >= MAX_EXAMS)
    return bot.sendMessage(chatId, "❌ Limit tugagan");

  session[chatId] = {
    index: 0,
    score: 0,
    questions: [...questions].sort(() => Math.random() - 0.5),
    missed: 0,
    answered: false
  };

  sendQuestion(chatId);
});

// ===== SAVOL =====
function sendQuestion(chatId) {
  const s = session[chatId];
  if (!s) return;

  if (s.index >= s.questions.length)
    return finishExam(chatId);

  s.answered = false;
  const q = s.questions[s.index];

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        q.options.map(opt => ({
          text: `${opt}) ${q.textOptions[opt]}`,
          callback_data: `${q.id}_${opt}`
        }))
      ]
    }
  };

  bot.sendMessage(chatId,
    `Savol ${s.index + 1}/${s.questions.length}

${q.question}`, keyboard);

  s.timer = setTimeout(() => {
    if (!s.answered) {
      s.missed++;
      if (s.missed >= MAX_MISSED)
        return forceFinish(chatId);

      s.index++;
      sendQuestion(chatId);
    }
  }, 20000);
}

// ===== JAVOB =====
bot.on("callback_query", async (cb) => {
  const chatId = cb.message.chat.id;
  const s = session[chatId];
  if (!s) return;

  s.answered = true;
  clearTimeout(s.timer);

  const [qId, ans] = cb.data.split("_");
  const q = s.questions.find(x => x.id == qId);

  if (ans === q.correct) {
    s.score++;
    bot.sendMessage(chatId, "✔ To‘g‘ri");
  } else {
    bot.sendMessage(chatId,
      `❌ Noto‘g‘ri
To‘g‘ri javob: ${q.correct}) ${q.textOptions[q.correct]}`);
  }

  s.index++;
  sendQuestion(chatId);

  bot.answerCallbackQuery(cb.id);
});

// ===== FINISH =====
async function finishExam(chatId) {
  const s = session[chatId];
  if (!s) return;

  const percent = Math.round((s.score / s.questions.length) * 100);
  const level = getLevel(percent);

  await User.updateOne(
    { chatId },
    {
      $push: {
        exams: {
          score: s.score,
          percent,
          level
        }
      }
    }
  );

  bot.sendMessage(chatId,
    `🎉 Imtihon tugadi!

Ball: ${s.score}
Foiz: ${percent}%
Daraja: ${level}`
  );

  delete session[chatId];
}

async function forceFinish(chatId) {
  bot.sendMessage(chatId, "⚠ Imtihon to‘xtatildi");
  await finishExam(chatId);
}

// ===== REYTING =====
bot.onText(/\/reyting$/, async (msg) => {
  const user = await User.findOne({ chatId: msg.chat.id });

  if (!user || user.exams.length === 0)
    return bot.sendMessage(msg.chat.id, "Natija yo‘q");

  let text = "📊 Natijalar:\n\n";

  user.exams.forEach((e, i) => {
    text += `${i + 1}. ${e.score} ball - ${e.level}\n`;
  });

  bot.sendMessage(msg.chat.id, text);
});

// ===== GLOBAL REYTING =====
bot.onText(/\/retinglar/, async (msg) => {
  const users = await User.find({ "exams.0": { $exists: true } });

  const list = users
    .map(u => ({
      name: u.name,
      score: Math.max(...u.exams.map(e => e.score))
    }))
    .sort((a, b) => b.score - a.score);

  if (list.length === 0)
    return bot.sendMessage(msg.chat.id, "Reyting yo‘q");

  let text = "🏆 Top Reyting:\n\n";

  list.forEach((u, i) => {
    text += `${i + 1}. ${u.name} - ${u.score}\n`;
  });

  bot.sendMessage(msg.chat.id, text);
});

const mongoose = require("mongoose");

const examSchema = new mongoose.Schema({
    score: Number,
    percent: Number,
    level: String,
    date: { type: Date, default: Date.now },
    forced: { type: Boolean, default: false }
});

const userSchema = new mongoose.Schema({
    chatId: { type: Number, unique: true },
    name: String,
    exams: [examSchema]
});

module.exports = mongoose.model("User", userSchema);

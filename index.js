const { Telegraf } = require("telegraf");
const JSZip = require("jszip");
const axios = require("axios");
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const path = require("path");

const {
  TELEGRAM_TOKEN,
  GH_TOKEN,
  GH_OWNER,
  GH_REPO,
  GH_BRANCH,
} = require("./config");

const bot = new Telegraf(TELEGRAM_TOKEN);
const octo = new Octokit({ auth: GH_TOKEN });

const temp = {};

function sendHTML(ctx, text) {
  return ctx.reply(text, { parse_mode: "HTML" });
}

function esc(text) {
  return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

async function downloadFile(fileId, ctx) {
  const file = await ctx.telegram.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
  const res = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(res.data);
}

async function uploadGitHub(filePath, buffer) {
  let sha;
  try {
    const { data } = await octo.repos.getContent({
      owner: GH_OWNER,
      repo: GH_REPO,
      path: filePath,
      ref: GH_BRANCH
    });
    sha = data.sha;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  return octo.repos.createOrUpdateFileContents({
    owner: GH_OWNER,
    repo: GH_REPO,
    branch: GH_BRANCH,
    path: filePath,
    message: `Upload ${filePath} via Telegram Bot`,
    content: buffer.toString("base64"),
    sha: sha 
  });
}

async function downloadRepo(dir = "", basePath = "/home/container") {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${dir}?ref=${GH_BRANCH}`;
  
  const { data } = await axios.get(url, {
      headers: {
          "User-Agent": "Mozilla/5.0",
          "Authorization": `token ${GH_TOKEN}` 
      }
  });

  for (const item of data) {
      const local = path.join(basePath, item.path);

      if (item.type === "file") {
          const fileData = await axios.get(item.download_url, { responseType: "arraybuffer" });
          fs.mkdirSync(path.dirname(local), { recursive: true });
          fs.writeFileSync(local, Buffer.from(fileData.data));
          console.log("[UPDATE] Menulis file:", local);
      }

      if (item.type === "dir") {
          fs.mkdirSync(local, { recursive: true });
          await downloadRepo(item.path, basePath);
      }
  }
}

bot.start((ctx) => {
  const thumbnail = "https://d.top4top.io/p_3615qg2ah1.jpg";
  
  const caption = `
<b>👋 Halo ${esc(ctx.from.first_name)}!</b>

Selamat datang di <b>GitHub Manager Bot</b>.
Kelola & update script kamu langsung dari Telegram dengan mudah.

<b>📁 MENU UTAMA:</b>
•/uploadgh — Upload file yang ingin diproses ke GitHub
•/pullupdate — Update script bot otomatis

<b>📌 Cara Upload:</b>
1. Kirim File atau ZIP 
2. Reply file tersebut.
3. Jalankan perintah <code>/uploadgh</code>.

<b>🛠 Developer:</b> <a href="https://t.me/vinzxiterr">t.me/vinzxiterr</a>
`;

  ctx.replyWithPhoto(thumbnail, {
    caption: caption,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔗 Repository", url: `https://github.com/${GH_OWNER}/${GH_REPO}` },
          { text: "👤 Contact Owner", url: "https://t.me/vinzxiterr" } 
        ]
      ]
    }
  });
});

bot.on("document", async (ctx) => {
  const file = ctx.message.document;
  const filename = file.file_name;

  sendHTML(ctx, `<b>Menerima file:</b> <code>${esc(filename)}</code>\n⏳ Sedang download...`);

  try {
    const buffer = await downloadFile(file.file_id, ctx);

    temp[ctx.chat.id] = { buffer, filename };

    sendHTML(
      ctx,
      `File berhasil diunduh.\n<b>Balas file ini</b> lalu ketik:\n<code>/uploadgh</code>`
    );
  } catch (err) {
    sendHTML(ctx, `<b>Error download:</b>\n<pre>${esc(err.message)}</pre>`);
  }
});

bot.command("uploadgh", async (ctx) => {
  const chat = ctx.chat.id;

  if (!temp[chat])
    return sendHTML(ctx, "<b>Tidak ada file yang siap upload.</b>");

  const { buffer, filename } = temp[chat];

  sendHTML(ctx, "<b>Memproses file...</b>");

  try {
    let files = [];

    if (filename.endsWith(".zip")) {
      sendHTML(ctx, "<b>ZIP terdeteksi, extracting...</b>");
      const zip = await JSZip.loadAsync(buffer);

      for (const entry of Object.keys(zip.files)) {
        const item = zip.files[entry];
        if (item.dir) continue;
        const buf = await item.async("nodebuffer");
        files.push({ path: entry, buffer: buf });
      }
    } else {
      files.push({ path: filename, buffer });
    }

    sendHTML(ctx, `<b>Uploading ke GitHub...</b>\nFile: <code>${files.length}</code>`);

    for (const f of files) {
      await uploadGitHub(f.path, f.buffer);
    }

    sendHTML(
      ctx,
      `<b>UPLOAD SELESAI!</b>\nTotal: <code>${files.length}</code>\nRepo: <code>${GH_OWNER}/${GH_REPO}</code>`
    );
  } catch (err) {
    sendHTML(ctx, `<b>ERROR UPLOAD:</b>\n<pre>${esc(err.message)}</pre>`);
  }

  delete temp[chat];
});

bot.command("pullupdate", async (ctx) => {
     if (ctx.chat.id !== 7922656711) return; 

    await ctx.reply("🔄 <b>Proses Auto Update...</b>\nSedang mengunduh dari GitHub...", { parse_mode: "HTML" });

    try {
        await downloadRepo("", "/home/container"); 
        
        await ctx.reply("✅ <b>Update selesai!</b>\n🔁 Bot restart otomatis dalam 2 detik...", { parse_mode: "HTML" });
        
        setTimeout(() => process.exit(0), 2000);
    } catch (e) {
        await ctx.reply(`❌ <b>Gagal update:</b>\n<pre>${e.message}</pre>`, { parse_mode: "HTML" });
        console.error(e);
    }
});

bot.launch();
console.log("🤖  Bot started...");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fetch from "node-fetch";
import ytdl from 'yt-dlp-exec';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    historyFile: path.join(__dirname, "history.json"),
    rawVideo: path.join(__dirname, "raw_video.mp4"),
    finalVideo: path.join(__dirname, "final_video.mp4"),
    clipDuration: 180, // 3 دقائق بالثواني
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    channels: ["Film.Arena", "Chnese-drama", "Drama-Portal", "Neon.History", "drama.box"]
};

// --- 1. جلب الفيديوهات ---
async function fetchVideos() {
    let allVideos = [];
    const arabicRegex = /[\u0600-\u06FF]/;
    for (const channel of CONFIG.channels) {
        console.log(`📡 فحص قناة: ${channel}...`);
        try {
            const res = await fetch(`https://api.dailymotion.com/user/${channel}/videos?fields=id,title,duration&limit=20&sort=recent`);
            const data = await res.json();
            if (data.list) {
                data.list.forEach(v => {
                    if (arabicRegex.test(v.title) && v.duration >= 180) allVideos.push(v);
                });
            }
        } catch (e) { console.error(`❌ خطأ قناة ${channel}`); }
    }
    return allVideos;
}

// --- 2. تحميل وقص الفيديو (طريقة الـ Direct Stream) ---
async function downloadAndClip(videoId) {
    try {
        console.log(`🔍 استخراج رابط البث المباشر لـ ${videoId}...`);
        
        // جلب الرابط باستخدام yt-dlp مع منع ffmpeg الداخلي الخاص به
        const info = await ytdl(`https://www.dailymotion.com/video/${videoId}`, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: [`User-Agent:${CONFIG.userAgent}`, 'Referer:https://www.dailymotion.com/']
        });

        const streamUrl = info.url;
        if (!streamUrl) throw new Error("لم يتم العثور على رابط البث");

        console.log(`📥 جاري التحميل والقص المباشر عبر FFmpeg...`);

        // تشغيل ffmpeg مباشرة مع تمرير الـ Headers لضمان عدم حدوث 404
        const ffmpegCmd = `ffmpeg -headers "User-Agent: ${CONFIG.userAgent}\r\nReferer: https://www.dailymotion.com/\r\n" -i "${streamUrl}" -t ${CONFIG.clipDuration} -c:v copy -c:a copy -y "${CONFIG.rawVideo}"`;
        
        execSync(ffmpegCmd, { stdio: 'inherit' });

        return fs.existsSync(CONFIG.rawVideo) && fs.statSync(CONFIG.rawVideo).size > 1000000;
    } catch (err) {
        console.error(`❌ فشل في التحميل/القص: ${err.message}`);
        return false;
    }
}

// --- 3. معالجة الفيديو (تغيير البصمة) ---
function processVideo() {
    console.log(`🎨 معالجة الفيديو لإضافة فلاتر التخطي...`);
    try {
        const cmd = `ffmpeg -i "${CONFIG.rawVideo}" -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -c:v libx264 -crf 23 -pix_fmt yuv420p -af "atempo=1.05" -y "${CONFIG.finalVideo}"`;
        execSync(cmd, { stdio: 'inherit' });
        return fs.existsSync(CONFIG.finalVideo);
    } catch (e) {
        console.error(`❌ خطأ في المعالجة: ${e.message}`);
        return false;
    }
}

// --- 4. الرفع لـ TikTok ---
async function uploadToTikTok(videoPath, title) {
    const cookiesStr = process.env.TIKTOK_COOKIES;
    if (!cookiesStr) return false;
    let browser;
    try {
        browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setUserAgent(CONFIG.userAgent);
        await page.setCookie(...JSON.parse(cookiesStr));
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 120000 });

        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        const caption = `${title} ${CONFIG.fixedText} #explore #dramabox #drama`;
        const editor = '.public-DraftEditor-content';
        await page.waitForSelector(editor);
        await page.focus(editor);
        await page.keyboard.type(caption);

        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 300000 }, postBtn);

        await page.click(postBtn);
        await new Promise(r => setTimeout(r, 20000));
        console.log(`✅ تم النشر بنجاح!`);
        return true;
    } catch (err) {
        console.error(`❌ خطأ رفع: ${err.message}`);
        return false;
    } finally {
        if (browser) await browser.close();
    }
}

// --- 5. التنفيذ الرئيسي ---
(async () => {
    console.log("🚀 تشغيل البوت...");
    let history = { posted: [] };
    if (fs.existsSync(CONFIG.historyFile)) {
        try { history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8')); } catch (e) {}
    }

    const videos = await fetchVideos();
    const unposted = videos.filter(v => !history.posted.includes(v.id));
    if (unposted.length === 0) return console.log("👋 لا محتوى جديد.");

    const selected = unposted[Math.floor(Math.random() * unposted.length)];
    console.log(`🎯 المختار: ${selected.title}`);

    if (await downloadAndClip(selected.id)) {
        if (processVideo()) {
            if (await uploadToTikTok(CONFIG.finalVideo, selected.title)) {
                history.posted.push(selected.id);
                fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
            }
        }
    }

    [CONFIG.rawVideo, CONFIG.finalVideo].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
})();

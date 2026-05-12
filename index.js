import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fetch from "node-fetch";

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    historyFile: path.join(__dirname, "history.json"),
    rawVideo: path.join(__dirname, "raw_video.mp4"),
    finalVideo: path.join(__dirname, "final_video.mp4"),
    clipDuration: 180, 
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    channels: ["Film.Arena", "Chnese-drama", "Drama-Portal", "Neon.History", "drama.box"],
    chromePath: '/usr/bin/google-chrome'
};

// --- 1. جلب الفيديوهات من Dailymotion ---
async function fetchVideos() {
    let allVideos = [];
    const arabicRegex = /[\u0600-\u06FF]/;
    for (const channel of CONFIG.channels) {
        console.log(`📡 فحص قناة: ${channel}...`);
        try {
            const res = await fetch(`https://api.dailymotion.com/user/${channel}/videos?fields=id,title,duration&limit=15`);
            const data = await res.json();
            if (data.list) {
                data.list.forEach(v => {
                    if (arabicRegex.test(v.title) && v.duration >= 180) allVideos.push(v);
                });
            }
        } catch (e) { console.error(`❌ خطأ في قناة ${channel}`); }
    }
    return allVideos;
}

// --- 2. صيد رابط البث (Sniffing) ---
async function sniffM3U8(videoId) {
    console.log(`🕵️ جاري صيد رابط البث للفيديو ${videoId}...`);
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: CONFIG.chromePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    let m3u8Url = null;

    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = request.url();
        if (url.includes("manifest.m3u8") && !m3u8Url) {
            m3u8Url = url;
        }
        request.continue();
    });

    try {
        await page.goto(`https://www.dailymotion.com/video/${videoId}`, { waitUntil: 'networkidle2', timeout: 60000 });
        let wait = 0;
        while (!m3u8Url && wait < 15) {
            await new Promise(r => setTimeout(r, 1000));
            wait++;
        }
    } catch (e) {}
    await browser.close();
    return m3u8Url;
}

// --- 3. الرفع لـ TikTok ---
async function uploadToTikTok(videoPath, title) {
    const cookiesStr = process.env.TIKTOK_COOKIES;
    if (!cookiesStr) return false;
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: "new", 
            executablePath: CONFIG.chromePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        const page = await browser.newPage();
        await page.setUserAgent(CONFIG.userAgent);
        await page.setCookie(...JSON.parse(cookiesStr));
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 120000 });

        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        const caption = `${title} ${CONFIG.fixedText} #explore #dramabox`;
        const editor = '.public-DraftEditor-content';
        await page.waitForSelector(editor);
        await page.click(editor);
        await page.keyboard.type(caption);

        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 300000 }, postBtn);

        await page.click(postBtn);
        await new Promise(r => setTimeout(r, 20000));
        console.log("✅ تم النشر!");
        return true;
    } catch (e) { return false; }
    finally { if (browser) await browser.close(); }
}

// --- 4. التشغيل الرئيسي ---
(async () => {
    let history = { posted: [] };
    if (fs.existsSync(CONFIG.historyFile)) {
        try { history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8')); } catch (e) {}
    }

    const videos = await fetchVideos();
    const unposted = videos.filter(v => !history.posted.includes(v.id));
    if (unposted.length === 0) return console.log("👋 لا يوجد جديد.");

    const selected = unposted[Math.floor(Math.random() * unposted.length)];
    console.log(`🎯 الفيديو المختار: ${selected.title}`);

    const streamUrl = await sniffM3U8(selected.id);
    if (!streamUrl) return console.error("❌ تعذر صيد الرابط.");

    try {
        // التحميل والقص
        console.log("📥 جاري التحميل والقص...");
        execSync(`ffmpeg -headers "User-Agent: ${CONFIG.userAgent}\r\n" -i "${streamUrl}" -t ${CONFIG.clipDuration} -c copy -y "${CONFIG.rawVideo}"`, { stdio: 'inherit' });

        // المعالجة (الفلاتر)
        console.log("🎨 معالجة الفيديو...");
        execSync(`ffmpeg -i "${CONFIG.rawVideo}" -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -c:v libx264 -crf 23 -pix_fmt yuv420p -af "atempo=1.05" -y "${CONFIG.finalVideo}"`, { stdio: 'inherit' });

        // الرفع
        if (await uploadToTikTok(CONFIG.finalVideo, selected.title)) {
            history.posted.push(selected.id);
            fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
        }
    } catch (e) { console.error("❌ خطأ:", e.message); }

    // تنظيف الملفات
    [CONFIG.rawVideo, CONFIG.finalVideo].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
})();

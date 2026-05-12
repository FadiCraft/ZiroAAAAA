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

// --- الإعدادات ---
const CONFIG = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    historyFile: path.join(__dirname, "history.json"),
    rawVideo: path.join(__dirname, "raw_video.mp4"),
    tempVideo: path.join(__dirname, "final_video.mp4"),
    clipDuration: "00:03:00", // مدة 3 دقائق بتنسيق ffmpeg
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    channels: ["Film.Arena", "Chnese-drama", "Drama-Portal", "Neon.History", "drama.box"]
};

// --- 1. دالة جلب قائمة الفيديوهات من القنوات ---
async function fetchVideos() {
    let allVideos = [];
    const arabicRegex = /[\u0600-\u06FF]/;
    
    for (const channel of CONFIG.channels) {
        console.log(`📡 فحص قناة: ${channel}...`);
        try {
            const res = await fetch(`https://api.dailymotion.com/user/${channel}/videos?fields=id,title&limit=20&sort=recent`);
            const data = await res.json();
            if (data.list) {
                data.list.forEach(v => {
                    if (arabicRegex.test(v.title)) {
                        allVideos.push(v);
                    }
                });
            }
        } catch (e) { 
            console.error(`❌ خطأ في الاتصال بقناة ${channel}`); 
        }
    }
    return allVideos;
}

// --- 2. دالة الرفع لـ TikTok ---
async function uploadToTikTok(videoPath, title) {
    const cookiesStr = process.env.TIKTOK_COOKIES;
    if (!cookiesStr) {
        console.error("❌ Cookies missing!");
        return false;
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);
    
    try {
        await page.setCookie(...JSON.parse(cookiesStr));
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 120000 });

        console.log(`📤 جاري رفع الفيديو لـ TikTok...`);
        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        const caption = `${title} ${CONFIG.fixedText} #explore #dramabox #foryou`;
        const editorSelector = '.public-DraftEditor-content';
        await page.waitForSelector(editorSelector, { timeout: 60000 });
        await page.focus(editorSelector);
        
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(caption, { delay: 50 });

        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 240000 }, postBtn);

        await page.click(postBtn);
        await new Promise(r => setTimeout(r, 15000)); 
        console.log("✅ تم النشر بنجاح!");
        return true;
    } catch (err) {
        console.error("❌ فشل الرفع:", err.message);
        return false;
    } finally {
        await browser.close();
    }
}

// --- 3. المحرك الرئيسي (التحميل المباشر) ---
(async () => {
    console.log("🚀 بدء تشغيل البوت...");

    let history = { posted: [] };
    if (fs.existsSync(CONFIG.historyFile)) {
        try { history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8')); } catch (e) {}
    }

    const videos = await fetchVideos();
    const unposted = videos.filter(v => !history.posted.includes(v.id));

    if (unposted.length === 0) return console.log("👋 لا يوجد محتوى جديد.");

    const selected = unposted[Math.floor(Math.random() * unposted.length)];
    console.log(`🎯 الفيديو المختار: ${selected.title}`);
    
    try {
        console.log(`📥 المرحلة 1: تحميل الفيديو مباشرة باستخدام yt-dlp...`);
        // التحميل مباشرة وحفظه كملف raw_video.mp4
        // نستخدم --download-sections لقص أول 3 دقائق مباشرة أثناء التحميل لتوفير الوقت والمساحة
        await ytdl(`https://www.dailymotion.com/video/${selected.id}`, {
            output: CONFIG.rawVideo,
            format: 'bestvideo+bestaudio/best',
            downloadSections: `*00:00:00-${CONFIG.clipDuration}`,
            forceOverwrites: true,
            noCheckCertificates: true,
            addHeader: [`User-Agent:${CONFIG.userAgent}`, 'Referer:https://www.dailymotion.com/']
        });

        if (fs.existsSync(CONFIG.rawVideo) && fs.statSync(CONFIG.rawVideo).size > 1000000) {
            console.log(`🎨 المرحلة 2: تطبيق الفلاتر (الأبعاد والسطوع والسرعة)...`);
            const processCmd = `ffmpeg -i "${CONFIG.rawVideo}" -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -c:v libx264 -crf 23 -pix_fmt yuv420p -af "atempo=1.05" -y "${CONFIG.tempVideo}"`;
            execSync(processCmd, { stdio: 'inherit' });

            const success = await uploadToTikTok(CONFIG.tempVideo, selected.title);
            if (success) {
                history.posted.push(selected.id);
                fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
            }
        } else {
            console.error("❌ فشل التحميل أو الملف فارغ.");
        }
    } catch (e) {
        console.error("⚠️ خطأ تقني:", e.message);
    }

    if (fs.existsSync(CONFIG.rawVideo)) fs.unlinkSync(CONFIG.rawVideo);
    if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
})();

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
    finalVideo: path.join(__dirname, "final_video.mp4"),
    clipDuration: "00:03:00",
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

// --- 2. تحميل المقطع (تغيير الصيغة لتجنب الـ 404) ---
async function downloadClip(videoId) {
    try {
        console.log(`📥 محاولة تحميل مقطع ${videoId} بصيغة mp4 مباشرة...`);
        const url = `https://www.dailymotion.com/video/${videoId}`;
        
        // هنا السر: نطلب صيغة mp4 المباشرة (http) بدلاً من HLS (m3u8) لتجنب الـ Proxy 404
        await ytdl(url, {
            output: CONFIG.rawVideo,
            // نختار أفضل جودة mp4 جاهزة بدلاً من دمج روابط m3u8
            format: 'best[ext=mp4]/best', 
            downloadSections: `*00:00:00-${CONFIG.clipDuration}`,
            noCheckCertificates: true,
            userAgent: CONFIG.userAgent,
            addHeader: ['Referer:https://www.dailymotion.com/'],
            forceOverwrites: true
        });

        if (fs.existsSync(CONFIG.rawVideo) && fs.statSync(CONFIG.rawVideo).size > 1000000) {
            console.log(`✅ تم التحميل بنجاح.`);
            return true;
        }
        return false;
    } catch (err) {
        console.error(`❌ فشل التحميل: ${err.message}`);
        return false;
    }
}

// --- 3. معالجة الفيديو ---
function processVideo() {
    console.log(`🎨 معالجة الفيديو وإضافة الفلاتر...`);
    try {
        const cmd = `ffmpeg -i "${CONFIG.rawVideo}" -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -c:v libx264 -crf 23 -pix_fmt yuv420p -af "atempo=1.05" -y "${CONFIG.finalVideo}"`;
        execSync(cmd, { stdio: 'inherit' });
        return fs.existsSync(CONFIG.finalVideo);
    } catch (e) {
        return false;
    }
}

// --- 4. رفع إلى TikTok ---
async function uploadToTikTok(videoPath, title) {
    const cookiesStr = process.env.TIKTOK_COOKIES;
    if (!cookiesStr) return false;
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
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
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(caption);

        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 300000 }, postBtn);

        await page.click(postBtn);
        await new Promise(r => setTimeout(r, 15000));
        console.log(`✅ تم النشر!`);
        return true;
    } catch (err) {
        return false;
    } finally {
        if (browser) await browser.close();
    }
}

// --- 5. التشغيل ---
(async () => {
    let history = { posted: [] };
    if (fs.existsSync(CONFIG.historyFile)) {
        try { history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8')); } catch (e) {}
    }

    const videos = await fetchVideos();
    const unposted = videos.filter(v => !history.posted.includes(v.id));
    if (unposted.length === 0) return;

    const selected = unposted[Math.floor(Math.random() * unposted.length)];
    console.log(`🎯 المختار: ${selected.title}`);
    
    if (await downloadClip(selected.id)) {
        if (processVideo()) {
            if (await uploadToTikTok(CONFIG.finalVideo, selected.title)) {
                history.posted.push(selected.id);
                fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
            }
        }
    }

    [CONFIG.rawVideo, CONFIG.finalVideo].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
    });
})();

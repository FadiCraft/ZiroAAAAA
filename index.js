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
    clipDuration: 180, // 3 دقائق (180 ثانية)
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    channels: ["Film.Arena", "Chnese-drama", "Drama-Portal", "Neon.History", "drama.box"]
};

// --- 1. دالة جلب رابط الفيديو باستخدام المحرك الذكي لتجاوز الـ 404 ---
async function getM3U8Url(videoId) {
    try {
        console.log(`🔍 جاري استخراج الرابط المباشر للفيديو ${videoId} عبر yt-dlp...`);
        const output = await ytdl(`https://www.dailymotion.com/video/${videoId}`, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            addHeader: [
                `User-Agent:${CONFIG.userAgent}`,
                'Referer:https://www.dailymotion.com/'
            ],
        });
        
        return output.url; 
    } catch (e) {
        console.error(`❌ فشل استخراج الرابط: ${e.message}`);
        return "";
    }
}

// --- 2. دالة جلب قائمة الفيديوهات من القنوات ---
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

// --- 3. دالة الرفع لـ TikTok ---
async function uploadToTikTok(videoPath, title) {
    const cookiesStr = process.env.TIKTOK_COOKIES;
    if (!cookiesStr) {
        console.error("❌ Cookies are missing in environment variables!");
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
        console.log("✅ تم النشر على TikTok بنجاح!");
        return true;
    } catch (err) {
        console.error("❌ فشل الرفع:", err.message);
        return false;
    } finally {
        await browser.close();
    }
}

// --- 4. المحرك الرئيسي (تحميل -> معالجة محلياً -> رفع) ---
(async () => {
    console.log("🚀 بدء تشغيل البوت...");

    let history = { posted: [] };
    if (fs.existsSync(CONFIG.historyFile)) {
        try {
            history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8'));
        } catch (e) {
            console.log("⚠️ سجل التاريخ تالف، سيتم البدء من جديد.");
        }
    }

    const videos = await fetchVideos();
    const unposted = videos.filter(v => !history.posted.includes(v.id));

    if (unposted.length === 0) {
        console.log("👋 لا يوجد محتوى جديد غير منشور.");
        return;
    }

    const selected = unposted[Math.floor(Math.random() * unposted.length)];
    console.log(`🎯 الفيديو المختار: ${selected.title}`);
    
    const m3u8Url = await getM3U8Url(selected.id);

    if (m3u8Url) {
        try {
            console.log(`📥 المرحلة 1: تحميل أول 3 دقائق (نسخ خام)...`);
            const downloadCmd = `ffmpeg -headers "Referer: https://www.dailymotion.com/" -i "${m3u8Url}" -t ${CONFIG.clipDuration} -c copy -y "${CONFIG.rawVideo}"`;
            execSync(downloadCmd, { stdio: 'inherit' });

            if (fs.existsSync(CONFIG.rawVideo) && fs.statSync(CONFIG.rawVideo).size > 1000000) {
                console.log(`🎨 المرحلة 2: تطبيق الفلاتر والمعالجة محلياً...`);
                // الفلاتر: تغيير الحجم + سطوع + تسريع 5%
                const processCmd = `ffmpeg -i "${CONFIG.rawVideo}" -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -c:v libx264 -crf 23 -pix_fmt yuv420p -af "atempo=1.05" -y "${CONFIG.tempVideo}"`;
                execSync(processCmd, { stdio: 'inherit' });

                const success = await uploadToTikTok(CONFIG.tempVideo, selected.title);
                if (success) {
                    history.posted.push(selected.id);
                    fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
                    console.log("💾 تم التحديث بنجاح.");
                }
            } else {
                console.error("❌ فشل التحميل: الملف الناتج غير صالح.");
            }
        } catch (e) {
            console.error("⚠️ خطأ في المعالجة:", e.message);
        }
    }

    // تنظيف
    if (fs.existsSync(CONFIG.rawVideo)) fs.unlinkSync(CONFIG.rawVideo);
    if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
})();

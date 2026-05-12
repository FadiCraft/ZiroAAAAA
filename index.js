import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- الإعدادات ---
const CONFIG = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    historyFile: path.join(__dirname, "history.json"),
    tempVideo: path.join(__dirname, "temp_video.mp4"),
    clipDuration: 150, // 2.5 دقيقة
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    channels: ["Film.Arena", "Chnese-drama", "Drama-Portal", "Neon.History", "drama.box"]
};

// --- إدارة سجل التاريخ ---
function getHistory() {
    if (fs.existsSync(CONFIG.historyFile)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8'));
        } catch (e) {
            return { posted: [] };
        }
    }
    return { posted: [] };
}

// --- وظائف Dailymotion ---
async function getM3U8Url(videoId) {
    try {
        const response = await fetch(`https://www.dailymotion.com/player/metadata/video/${videoId}`, {
            headers: { 'User-Agent': CONFIG.userAgent }
        });
        const data = await response.json();
        return data.qualities?.auto?.[0]?.url || "";
    } catch { return ""; }
}

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
                    if (arabicRegex.test(v.title)) allVideos.push(v);
                });
            }
        } catch (e) { console.error(`❌ خطأ في فحص ${channel}`); }
    }
    return allVideos;
}

// --- وظيفة الرفع لـ TikTok ---
async function uploadToTikTok(videoPath, title) {
    const cookiesStr = process.env.TIKTOK_COOKIES;
    if (!cookiesStr) {
        console.error("❌ Cookies are missing in Environment Variables!");
        return false;
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);
    
    try {
        await page.setCookie(...JSON.parse(cookiesStr));
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 120000 });

        console.log(`📤 جاري رفع الفيديو لـ تيك توك...`);
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
        console.log("⏳ انتظار تأكيد النشر...");
        await new Promise(r => setTimeout(r, 15000)); 
        console.log("✅ تمت عملية الرفع بنجاح!");
        return true;
    } catch (err) {
        console.error("❌ فشل الرفع:", err.message);
        return false;
    } finally {
        await browser.close();
    }
}

// --- المحرك الرئيسي ---
(async () => {
    let history = getHistory();
    const videos = await fetchVideos();
    const unposted = videos.filter(v => !history.posted.includes(v.id));

    if (unposted.length === 0) {
        console.log("👋 لا يوجد محتوى جديد (كل الفيديوهات الحالية منشورة مسبقاً).");
        return;
    }

    // اختيار فيديو عشوائي من الجديد
    const selected = unposted[Math.floor(Math.random() * unposted.length)];
    const m3u8Url = await getM3U8Url(selected.id);

    if (m3u8Url) {
        try {
            console.log(`📥 جاري تحميل ومعالجة: ${selected.title}`);
            
            // أمر FFmpeg المحسن لحل مشكلة "No Streams" وضمان توافق تيك توك
            const ffmpegCmd = `ffmpeg -user_agent "${CONFIG.userAgent}" -headers "Referer: https://www.dailymotion.com/" -reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i "${m3u8Url}" -t ${CONFIG.clipDuration} -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -map 0:v:0 -map 0:a:0? -c:v libx264 -crf 23 -pix_fmt yuv420p -preset fast -af "atempo=1.05" -y "${CONFIG.tempVideo}"`;
            
            execSync(ffmpegCmd, { stdio: 'inherit' });

            if (fs.existsSync(CONFIG.tempVideo) && fs.statSync(CONFIG.tempVideo).size > 500000) {
                const success = await uploadToTikTok(CONFIG.tempVideo, selected.title);
                if (success) {
                    history.posted.push(selected.id);
                    fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
                    console.log("💾 تم تحديث السجل بنجاح.");
                }
            } else {
                console.error("❌ ملف الفيديو الناتج غير صالح أو حجمه صغير جداً.");
            }

        } catch (e) { 
            console.error("⚠️ خطأ تقني في المعالجة:", e.message); 
        }
    }
    
    // تنظيف الملفات المؤقتة
    if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
})();

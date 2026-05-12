import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// 1. ضع رابط الـ m3u8 المباشر هنا:
const DIRECT_M3U8_URL = "https://cdndirector.dailymotion.com/cdn/manifest/video/xa1abpa.m3u8?sec=FvfvbV7Z0_Vl_VNAf60C1K8PVYZ9uhm2eDiJ9rYUGNhBDbkcUTyzCHvUTHLBz7tP_aJ8xyREKb4_14DhIK7eEc716MmG_OL5oiPmJ2G0i1LUM9VsJL0KGlDl6nNz2Ssu&dmTs=127121&dmV1st=1fa328e4-00eb-5fa4-aa73-5db74587e0a8"; 

// 2. ضع عنوان الفيديو للنشر:
const VIDEO_TITLE = "عنوان الفيديو هنا";
// ==========================================

const CONFIG = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    rawVideo: path.join(__dirname, "raw_video.mp4"),
    finalVideo: path.join(__dirname, "final_video.mp4"),
    clipDuration: 180, // مدة المقطع (3 دقائق)
    chromePath: '/usr/bin/google-chrome'
};

async function uploadToTikTok(videoPath, title) {
    const cookiesStr = process.env.TIKTOK_COOKIES;
    if (!cookiesStr) return console.error("❌ Cookies missing!"), false;

    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: CONFIG.chromePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(CONFIG.userAgent);
        await page.setCookie(...JSON.parse(cookiesStr));
        
        console.log("📤 جاري فتح صفحة الرفع...");
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 120000 });

        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);
        console.log("⏳ جاري الرفع...");

        const caption = `${title} | شاهد الحلقة كاملة الرابط في البايو 🔗 #explore #drama`;
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
    } catch (e) {
        console.error(`❌ فشل الرفع: ${e.message}`);
    } finally {
        await browser.close();
    }
}

(async () => {
    try {
        // الخطوة 1: التحميل والقص المباشر
        console.log("📥 جاري تحميل أول 3 دقائق من الرابط المباشر...");
        // أحياناً الـ m3u8 يحتاج Referer ليعمل، أضفناه للاحتياط
        const ffmpegCmd = `ffmpeg -headers "User-Agent: ${CONFIG.userAgent}\r\nReferer: https://www.dailymotion.com/\r\n" -i "${DIRECT_M3U8_URL}" -t ${CONFIG.clipDuration} -c copy -y "${CONFIG.rawVideo}"`;
        execSync(ffmpegCmd, { stdio: 'inherit' });

        // الخطوة 2: المعالجة لتغيير البصمة (ضروري جداً لتجنب حظر تيك توك)
        console.log("🎨 معالجة الفيديو وإضافة فلاتر التخطي...");
        const processCmd = `ffmpeg -i "${CONFIG.rawVideo}" -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -c:v libx264 -crf 23 -pix_fmt yuv420p -af "atempo=1.05" -y "${CONFIG.finalVideo}"`;
        execSync(processCmd, { stdio: 'inherit' });

        // الخطوة 3: الرفع
        await uploadToTikTok(CONFIG.finalVideo, VIDEO_TITLE);

    } catch (e) {
        console.error(`❌ خطأ: ${e.message}`);
    } finally {
        if (fs.existsSync(CONFIG.rawVideo)) fs.unlinkSync(CONFIG.rawVideo);
        if (fs.existsSync(CONFIG.finalVideo)) fs.unlinkSync(CONFIG.finalVideo);
    }
})();

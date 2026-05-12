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
// الإعدادات المباشرة
const DIRECT_M3U8_URL = "https://box-1103-o.vmeas.cloud/hls/,xqx2ocxpybokjiqbteic5m2e4bsv4sz5chhkiofn5eza6oxddcd4dt2rgw2a,.urlset/master.m3u8"; 

const VIDEO_TITLE = "مقطع جديد من المسلسل"; // يمكنك تغيير العنوان هنا
// ==========================================

const CONFIG = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    rawVideo: path.join(__dirname, "raw_video.mp4"),
    finalVideo: path.join(__dirname, "final_video.mp4"),
    clipDuration: 180, // 3 دقائق
    chromePath: '/usr/bin/google-chrome'
};

async function uploadToTikTok(videoPath, title) {
    const cookiesStr = process.env.TIKTOK_COOKIES;
    if (!cookiesStr) {
        console.error("❌ Cookies missing in Secrets!");
        return false;
    }

    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: CONFIG.chromePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(CONFIG.userAgent);
        await page.setCookie(...JSON.parse(cookiesStr));
        
        console.log("📤 جاري فتح صفحة الرفع على تيك توك...");
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 120000 });

        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);
        console.log("⏳ جاري الرفع ومعالجة العنوان...");

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
        console.log("⏳ تم الضغط على نشر، بانتظار التأكيد النهائي...");
        await new Promise(r => setTimeout(r, 25000));
        console.log("✅ تمت عملية النشر بنجاح!");
        return true;
    } catch (e) {
        console.error(`❌ فشل أثناء الرفع: ${e.message}`);
        return false;
    } finally {
        await browser.close();
    }
}

(async () => {
    try {
        console.log("🎬 بدء العملية المباشرة...");

        // 1. التحميل والقص المباشر
        console.log("📥 جاري تحميل أول 3 دقائق باستخدام FFmpeg...");
        const ffmpegCmd = `ffmpeg -headers "User-Agent: ${CONFIG.userAgent}\r\nReferer: https://www.dailymotion.com/\r\n" -i "${DIRECT_M3U8_URL}" -t ${CONFIG.clipDuration} -c copy -y "${CONFIG.rawVideo}"`;
        execSync(ffmpegCmd, { stdio: 'inherit' });

        // 2. المعالجة لتغيير بصمة الفيديو
        console.log("🎨 إضافة فلاتر التخطي والمعالجة...");
        const processCmd = `ffmpeg -i "${CONFIG.rawVideo}" -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -c:v libx264 -crf 23 -pix_fmt yuv420p -af "atempo=1.05" -y "${CONFIG.finalVideo}"`;
        execSync(processCmd, { stdio: 'inherit' });

        // 3. الرفع
        if (fs.existsSync(CONFIG.finalVideo)) {
            await uploadToTikTok(CONFIG.finalVideo, VIDEO_TITLE);
        }

    } catch (e) {
        console.error(`❌ خطأ تقني: ${e.message}`);
    } finally {
        // تنظيف الملفات
        if (fs.existsSync(CONFIG.rawVideo)) fs.unlinkSync(CONFIG.rawVideo);
        if (fs.existsSync(CONFIG.finalVideo)) fs.unlinkSync(CONFIG.finalVideo);
        console.log("🧹 تم تنظيف الملفات المؤقتة.");
    }
})();

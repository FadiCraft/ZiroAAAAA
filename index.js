import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    historyFile: path.join(__dirname, "history.json"),
    rawVideo: path.join(__dirname, "raw_video.mp4"), // ملف التحميل الخام
    tempVideo: path.join(__dirname, "final_video.mp4"), // الملف النهائي للمعالجة
    clipDuration: 180, // 3 دقائق
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    channels: ["Film.Arena", "Chnese-drama", "Drama-Portal", "Neon.History", "drama.box"]
};

// ... (دوال getHistory و getM3U8Url و fetchVideos و uploadToTikTok تبقى كما هي)

// --- المحرك الرئيسي المحسن ---
(async () => {
    let history = fs.existsSync(CONFIG.historyFile) ? JSON.parse(fs.readFileSync(CONFIG.historyFile)) : { posted: [] };
    const videos = await fetchVideos();
    const unposted = videos.filter(v => !history.posted.includes(v.id));

    if (unposted.length === 0) return console.log("👋 لا يوجد محتوى جديد.");

    const selected = unposted[Math.floor(Math.random() * unposted.length)];
    const m3u8Url = await getM3U8Url(selected.id);

    if (m3u8Url) {
        try {
            console.log(`📥 المرحلة 1: تحميل الفيديو الخام من Dailymotion...`);
            // تحميل مباشر بدون فلاتر لضمان عدم انقطاع السيرفر
            const downloadCmd = `ffmpeg -user_agent "${CONFIG.userAgent}" -headers "Referer: https://www.dailymotion.com/" -i "${m3u8Url}" -t ${CONFIG.clipDuration} -c copy -bsf:a aac_adtstoasc -y "${CONFIG.rawVideo}"`;
            execSync(downloadCmd, { stdio: 'inherit' });

            if (fs.existsSync(CONFIG.rawVideo) && fs.statSync(CONFIG.rawVideo).size > 1000000) {
                console.log(`🎨 المرحلة 2: معالجة الفيديو محلياً (تغيير الأبعاد والسطوع)...`);
                // المعالجة محلياً بعد التحميل
                const processCmd = `ffmpeg -i "${CONFIG.rawVideo}" -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -c:v libx264 -crf 24 -pix_fmt yuv420p -af "atempo=1.05" -y "${CONFIG.tempVideo}"`;
                execSync(processCmd, { stdio: 'inherit' });

                const success = await uploadToTikTok(CONFIG.tempVideo, selected.title);
                if (success) {
                    history.posted.push(selected.id);
                    fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
                    console.log("✅ تمت العملية بنجاح!");
                }
            } else {
                console.error("❌ فشل تحميل الفيديو الخام.");
            }
        } catch (e) {
            console.error("⚠️ خطأ تقني:", e.message);
        }
    }

    // تنظيف
    if (fs.existsSync(CONFIG.rawVideo)) fs.unlinkSync(CONFIG.rawVideo);
    if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
})();

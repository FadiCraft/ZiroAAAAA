import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== الإعدادات ====================
const CONFIG = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    historyFile: path.join(__dirname, "history.json"),
    outputVideo: path.join(__dirname, "output.mp4"),
    clipDuration: 150 // مدة اللقطة بالثواني (دقيقتين ونصف)
};

const CHANNELS = [
    "Film.Arena",
    "Chnese-drama",
    "Drama-Portal",
    "Neon.History",
    "drama.box"
];

// ==================== دوال المساعدة ====================
class DailymotionClient {
    constructor() {
        this.baseUrl = "https://api.dailymotion.com";
    }

    async getM3U8Url(videoId) {
        try {
            const response = await fetch(`https://www.dailymotion.com/player/metadata/video/${videoId}`, {
                headers: { 'User-Agent': CONFIG.userAgent }
            });
            const data = await response.json();
            return data.qualities?.auto?.[0]?.url || "";
        } catch { return ""; }
    }

    async getUserVideos(username) {
        const url = `${this.baseUrl}/user/${username}/videos?fields=id,title,created_time&limit=50&sort=recent`;
        const response = await fetch(url, { headers: { 'User-Agent': CONFIG.userAgent } });
        return await response.json();
    }
}

// ==================== التشغيل ====================
(async () => {
    console.log("🚀 بدء التشغيل التجريبي لسحب لقطة فيديو...");

    // 1. قراءة سجل الفيديوهات السابقة لمنع التكرار
    let history = { posted: [] };
    if (fs.existsSync(CONFIG.historyFile)) {
        history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8'));
    }

    const client = new DailymotionClient();
    const arabicRegex = /[\u0600-\u06FF]/;
    let availableVideos = [];

    // 2. جلب الفيديوهات من القنوات وفلترتها
    for (const channel of CHANNELS) {
        console.log(`📡 فحص قناة: ${channel}...`);
        const data = await client.getUserVideos(channel);
        if (!data.list) continue;

        for (const video of data.list) {
            // التحقق: هل العنوان عربي؟ + هل الفيديو غير موجود في السجل؟
            if (arabicRegex.test(video.title) && !history.posted.includes(video.id)) {
                availableVideos.push(video);
            }
        }
    }

    if (availableVideos.length === 0) {
        console.log("👋 لا توجد فيديوهات عربية جديدة متوفرة حالياً.");
        return;
    }

    // 3. اختيار فيديو عشوائي
    const selectedVideo = availableVideos[Math.floor(Math.random() * availableVideos.length)];
    console.log(`🎯 تم اختيار فيديو: ${selectedVideo.title}`);
    console.log(`🔗 جلب رابط M3U8 للفيديو (ID: ${selectedVideo.id})...`);

    const m3u8Url = await client.getM3U8Url(selectedVideo.id);
    if (!m3u8Url) {
        console.error("❌ فشل في استخراج رابط M3U8 الخاص بالفيديو.");
        return;
    }

    // 4. تحميل ومعالجة الفيديو باستخدام FFmpeg
    // دمجنا رابط M3U8 مباشرة كمدخل (Input) مع قص المدة الزمنية وتطبيق فلاتر التيك توك
    if (fs.existsSync(CONFIG.outputVideo)) fs.unlinkSync(CONFIG.outputVideo);

    try {
        console.log(`📥 جاري تحميل ومعالجة أول ${CONFIG.clipDuration} ثانية من الفيديو... الرجاء الانتظار.`);
        
        const ffmpegCmd = `ffmpeg -i "${m3u8Url}" -t ${CONFIG.clipDuration} -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -c:v libx264 -crf 23 -preset fast -af "atempo=1.05" -y "${CONFIG.outputVideo}"`;
        
        execSync(ffmpegCmd, { stdio: 'ignore' }); // ignore لتخفيف الضغط على الكونسول
        
        console.log("✅ تم استخراج الفيديو ومعالجته بنجاح!");

        // 5. حفظ الـ ID في السجل (وهمي في هذه التجربة، لكن ليحفظه المحرك)
        history.posted.push(selectedVideo.id);
        fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));

    } catch (error) {
        console.error("❌ حدث خطأ أثناء المعالجة بواسطة FFmpeg:", error.message);
    }
})();

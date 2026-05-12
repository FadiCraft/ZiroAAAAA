import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== إعدادات المسارات ====================
const OUTPUT_DIR = path.join(__dirname, "output");
const RAW_VIDEO = path.join(OUTPUT_DIR, "raw_video.mp4");
const CLIP_VIDEO = path.join(OUTPUT_DIR, "clip_part1.mp4");
const INFO_FILE = path.join(OUTPUT_DIR, "video_info.json");

// ==================== الإعدادات ====================
const CONFIG = {
    clipDuration: 180,        // 3 دقائق للمقطع الواحد
    startTime: 0,             // بداية المقطع (الثواني) - الجزء الأول دائماً من البداية
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    requestDelay: 1000
};

// قائمة القنوات العربية على Dailymotion
const CHANNELS = [
    "Film.Arena",
    "Chnese-drama", 
    "Drama-Portal",
    "Neon.History",
    "drama.box"
];

// ==================== دوالم المساعدة ====================
const createDirectories = async () => {
    if (!fs.existsSync(OUTPUT_DIR)) {
        await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
    }
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Regex للكشف عن النص العربي
const ARABIC_REGEX = /[\u0600-\u06FF]/;

// ==================== نظام Dailymotion API ====================
class DailymotionExtractor {
    constructor() {
        this.baseUrl = "https://api.dailymotion.com";
    }

    // جلب فيديوهات قناة معينة
    async getChannelVideos(channelName) {
        console.log(`📡 جلب فيديوهات القناة: ${channelName}...`);
        
        try {
            const url = `${this.baseUrl}/user/${channelName}/videos?fields=id,title,thumbnail_url,duration,created_time,views_total&limit=50&sort=recent`;
            const response = await fetch(url, {
                headers: { 'User-Agent': CONFIG.userAgent }
            });
            const data = await response.json();
            
            if (!data.list || data.list.length === 0) {
                console.log(`⚠️ القناة ${channelName} لا تحتوي على فيديوهات`);
                return [];
            }
            
            console.log(`✅ تم جلب ${data.list.length} فيديو من ${channelName}`);
            return data.list;
        } catch (error) {
            console.error(`❌ خطأ في جلب فيديوهات ${channelName}:`, error.message);
            return [];
        }
    }

    // جلب رابط m3u8 لفيديو معين
    async getM3U8Url(videoId) {
        try {
            console.log(`🔗 جلب رابط m3u8 للفيديو: ${videoId}...`);
            
            const response = await fetch(
                `https://www.dailymotion.com/player/metadata/video/${videoId}`,
                { headers: { 'User-Agent': CONFIG.userAgent } }
            );
            
            const data = await response.json();
            const m3u8Url = data.qualities?.auto?.[0]?.url || "";
            
            if (m3u8Url) {
                console.log(`✅ تم العثور على رابط m3u8`);
            } else {
                console.log(`❌ لم يتم العثور على رابط m3u8`);
            }
            
            return m3u8Url;
        } catch (error) {
            console.error(`❌ خطأ في جلب m3u8:`, error.message);
            return "";
        }
    }

    // البحث عن فيديو عربي عشوائي
    async findRandomArabicVideo() {
        console.log("🔍 البحث عن فيديو عربي عشوائي...\n");
        
        // خلط القنوات عشوائياً
        const shuffledChannels = [...CHANNELS].sort(() => Math.random() - 0.5);
        
        for (const channel of shuffledChannels) {
            const videos = await this.getChannelVideos(channel);
            
            // تصفية الفيديوهات العربية
            const arabicVideos = videos.filter(v => ARABIC_REGEX.test(v.title));
            
            if (arabicVideos.length > 0) {
                // اختيار فيديو عشوائي من الفيديوهات العربية
                const randomVideo = arabicVideos[Math.floor(Math.random() * arabicVideos.length)];
                
                console.log(`\n🎯 تم اختيار فيديو عشوائي:`);
                console.log(`   العنوان: ${randomVideo.title}`);
                console.log(`   المدة: ${randomVideo.duration} ثانية`);
                console.log(`   المشاهدات: ${randomVideo.views_total}`);
                
                return randomVideo;
            } else {
                console.log(`⚠️ لا توجد فيديوهات عربية في قناة ${channel}\n`);
            }
        }
        
        console.log("❌ لم يتم العثور على أي فيديو عربي في جميع القنوات");
        return null;
    }
}

// ==================== نظام تحميل وتقطيع الفيديو ====================
class VideoProcessor {
    // تحميل الفيديو كاملاً من رابط m3u8
    static async downloadVideo(m3u8Url, outputPath) {
        return new Promise((resolve, reject) => {
            console.log("📥 جاري تحميل الفيديو... (قد يستغرق عدة دقائق)");
            
            try {
                // استخدام ffmpeg لتحميل وحفظ الفيديو
                const command = `ffmpeg -i "${m3u8Url}" -c copy -bsf:a aac_adtstoasc "${outputPath}" -y`;
                
                execSync(command, { 
                    stdio: 'inherit',
                    timeout: 600000 // 10 دقائق كحد أقصى
                });
                
                console.log("✅ تم تحميل الفيديو بنجاح");
                resolve(true);
            } catch (error) {
                console.error("❌ فشل تحميل الفيديو:", error.message);
                reject(error);
            }
        });
    }

    // تقطيع مقطع من الفيديو
    static async cutClip(inputPath, outputPath, startTime, duration) {
        return new Promise((resolve, reject) => {
            console.log(`✂️ جاري تقطيع المقطع (من ${startTime}ث لمدة ${duration}ث)...`);
            
            try {
                // استخدام ffmpeg لتقطيع المقطع مع تحسينات بسيطة
                const command = `ffmpeg -ss ${startTime} -i "${inputPath}" -t ${duration} -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -map_metadata -1 -c:v libx264 -crf 22 -af "atempo=1.05" -y "${outputPath}"`;
                
                execSync(command, { 
                    stdio: 'inherit',
                    timeout: 300000 // 5 دقائق كحد أقصى
                });
                
                console.log("✅ تم تقطيع المقطع بنجاح");
                resolve(true);
            } catch (error) {
                console.error("❌ فشل تقطيع المقطع:", error.message);
                reject(error);
            }
        });
    }

    // الحصول على مدة الفيديو
    static getVideoDuration(videoPath) {
        try {
            const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
            const duration = parseFloat(execSync(command, { encoding: 'utf-8' }).trim());
            return Math.floor(duration);
        } catch (error) {
            console.error("❌ فشل قراءة مدة الفيديو:", error.message);
            return 0;
        }
    }
}

// ==================== الدالة الرئيسية ====================
async function main() {
    console.log("🚀 بدء عملية استخراج الفيديو...\n");
    
    // 1. إنشاء المجلدات
    await createDirectories();
    
    // 2. البحث عن فيديو عربي عشوائي
    const extractor = new DailymotionExtractor();
    const video = await extractor.findRandomArabicVideo();
    
    if (!video) {
        console.log("❌ فشل العملية: لم يتم العثور على فيديو");
        return;
    }
    
    // 3. جلب رابط m3u8
    const m3u8Url = await extractor.getM3U8Url(video.id);
    
    if (!m3u8Url) {
        console.log("❌ فشل العملية: لم يتم العثور على رابط m3u8");
        return;
    }
    
    // 4. تحميل الفيديو كاملاً
    console.log("\n📥 بدء تحميل الفيديو...");
    await VideoProcessor.downloadVideo(m3u8Url, RAW_VIDEO);
    
    // 5. الحصول على مدة الفيديو
    const videoDuration = VideoProcessor.getVideoDuration(RAW_VIDEO);
    console.log(`📊 مدة الفيديو الكلية: ${videoDuration} ثانية (${Math.floor(videoDuration/60)} دقيقة)`);
    
    // 6. تقطيع الجزء الأول فقط
    console.log("\n✂️ تقطيع الجزء الأول...");
    await VideoProcessor.cutClip(RAW_VIDEO, CLIP_VIDEO, CONFIG.startTime, CONFIG.clipDuration);
    
    // 7. حساب عدد الأجزاء الكلي
    const totalParts = Math.floor(videoDuration / CONFIG.clipDuration);
    
    // 8. حفظ معلومات الفيديو
    const videoInfo = {
        videoId: video.id,
        title: video.title,
        totalDuration: videoDuration,
        clipDuration: CONFIG.clipDuration,
        totalParts: totalParts,
        m3u8Url: m3u8Url,
        selectedAt: new Date().toISOString(),
        testPart: 1 // هذا اختبار للجزء الأول فقط
    };
    
    fs.writeFileSync(INFO_FILE, JSON.stringify(videoInfo, null, 2));
    console.log(`\n💾 تم حفظ معلومات الفيديو في: ${INFO_FILE}`);
    
    // 9. ملخص العملية
    console.log("\n" + "=".repeat(50));
    console.log("✨ ملخص العملية:");
    console.log(`   📹 الفيديو: ${video.title}`);
    console.log(`   ⏱️  المدة الكلية: ${Math.floor(videoDuration/60)} دقيقة`);
    console.log(`   🔢 عدد الأجزاء: ${totalParts} (كل جزء ${CONFIG.clipDuration/60} دقائق)`);
    console.log(`   📁 المقطع التجريبي: ${CLIP_VIDEO}`);
    console.log(`   📋 المعلومات: ${INFO_FILE}`);
    console.log("=".repeat(50));
    
    // 10. تنظيف (اختياري) - حذف الفيديو الخام لتوفير المساحة
    // إذا أردت الاحتفاظ بالفيديو الخامل للتقطيع لاحقاً، علق على السطر التالي
    // fs.unlinkSync(RAW_VIDEO);
    
    console.log("\n🎉 تمت العملية بنجاح! المقطع جاهز للمعاينة.");
}

// تشغيل البرنامج
main().catch(error => {
    console.error("❌ خطأ غير متوقع:", error);
    process.exit(1);
});

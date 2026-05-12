require('dotenv').config();
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// البيانات التي حصلت عليها من موقع تلجرام (يفضل وضعها في ملف .env)
const apiId = parseInt(process.env.API_ID); 
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(""); // اتركه فارغاً في أول مرة تشغيل

(async () => {
    console.log("--- بدأت عملية الأتمتة لقناة Kiro Zozo ---");

    // 1. الاتصال بتلجرام
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text("أدخل رقم هاتفك (مثال +905xxx): "),
        password: async () => await input.text("أدخل كلمة مرور التحقق بخطوتين (إن وجدت): "),
        phoneCode: async () => await input.text("أدخل الكود الذي وصلك على تلجرام: "),
        onError: (err) => console.log("خطأ في الاتصال:", err),
    });

    console.log("✅ تم تسجيل الدخول بنجاح.");
    // احفظ هذا الكود المطبوع في ملف .env مستقبلاً لتجنب تسجيل الدخول مرة أخرى
    console.log("Session String الخاصة بك هي (احفظها):", client.session.save());

    // 2. البحث عن آخر فيديو في القناة
    const channelId = "kirozozo"; 
    console.log(`🔎 جاري البحث عن فيديوهات في قناة @${channelId}...`);
    
    const messages = await client.getMessages(channelId, { limit: 10 });
    const videoMessage = messages.find(m => m.video);

    if (!videoMessage) {
        console.log("❌ لم يتم العثور على أي فيديو مؤخراً.");
        return;
    }

    // 3. تحميل الفيديو
    const rawPath = path.join(__dirname, 'temp_video.mp4');
    const outputPath = path.join(__dirname, 'kiro_clip_3min.mp4');

    console.log("📥 جاري تحميل الفيديو من تلجرام...");
    const buffer = await client.downloadMedia(videoMessage, {
        progressCallback: (total, downloaded) => {
            process.stdout.write(`⏳ تحميل: ${((downloaded / total) * 100).toFixed(1)}% \r`);
        }
    });

    fs.writeFileSync(rawPath, buffer);
    console.log("\n✅ اكتمل التحميل.");

    // 4. معالجة الفيديو (القص + إضافة الصورة)
    console.log("🎬 جاري تقطيع أول 3 دقائق وإضافة الشعار...");

    ffmpeg(rawPath)
        .setStartTime(0)
        .setDuration(180) // 180 ثانية = 3 دقائق
        .input('logo.png') // تأكد من وجود الصورة
        .complexFilter([
            {
                filter: 'overlay',
                options: {
                    x: '(main_w-overlay_w)/2', // التوسيط عرضياً
                    y: 20                      // المسافة من الأعلى
                }
            }
        ])
        .on('start', (cmd) => console.log("بدأت المعالجة عبر FFmpeg..."))
        .on('error', (err) => console.error("❌ خطأ أثناء المعالجة:", err.message))
        .on('end', () => {
            console.log("✨ مبروك! الفيديو جاهز الآن باسم: " + outputPath);
            // تنظيف الملفات المؤقتة
            if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
            process.exit();
        })
        .save(outputPath);

})();

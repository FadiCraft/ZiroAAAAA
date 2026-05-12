import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fetch from "node-fetch";

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- الإعدادات ---
const CONFIG = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    historyFile: path.join(__dirname, "history.json"),
    rawVideo: path.join(__dirname, "raw_video.mp4"),
    tempVideo: path.join(__dirname, "final_video.mp4"),
    clipDuration: 180, // 3 دقائق بالثواني
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    channels: ["Film.Arena", "Chnese-drama", "Drama-Portal", "Neon.History", "drama.box"]
};

// --- 1. الحصول على رابط m3u8 مباشر (طازج) ---
async function getFreshM3U8(videoId) {
    console.log(`🔗 جلب رابط m3u8 مباشر للفيديو: ${videoId}...`);
    
    try {
        // استخدام API metadata للحصول على رابط جديد
        const response = await fetch(
            `https://www.dailymotion.com/player/metadata/video/${videoId}`,
            {
                headers: {
                    'User-Agent': CONFIG.userAgent,
                    'Referer': 'https://www.dailymotion.com/',
                    'Accept': 'application/json'
                }
            }
        );
        
        const data = await response.json();
        
        // محاولة الحصول على أفضل جودة متاحة
        const qualities = data.qualities;
        if (!qualities) {
            console.error("❌ لا توجد روابط جودة متاحة");
            return null;
        }
        
        // تجربة auto أولاً، ثم 1080، ثم 720، ثم 480
        const qualityOrder = ['auto', '1080', '720', '480', '380', '240', '144'];
        
        for (const quality of qualityOrder) {
            if (qualities[quality] && qualities[quality].length > 0) {
                const m3u8Url = qualities[quality][0].url;
                console.log(`✅ تم العثور على رابط m3u8 بجودة ${quality}`);
                return m3u8Url;
            }
        }
        
        console.error("❌ لم يتم العثور على أي رابط m3u8 مناسب");
        return null;
        
    } catch (error) {
        console.error(`❌ خطأ في جلب رابط m3u8:`, error.message);
        return null;
    }
}

// --- 2. جلب قائمة الفيديوهات من القنوات ---
async function fetchVideos() {
    let allVideos = [];
    const arabicRegex = /[\u0600-\u06FF]/;
    
    for (const channel of CONFIG.channels) {
        console.log(`📡 فحص قناة: ${channel}...`);
        try {
            const res = await fetch(
                `https://api.dailymotion.com/user/${channel}/videos?fields=id,title,duration&limit=20&sort=recent`,
                {
                    headers: { 'User-Agent': CONFIG.userAgent }
                }
            );
            
            if (!res.ok) {
                console.error(`❌ فشل الاتصال بقناة ${channel}: ${res.status}`);
                continue;
            }
            
            const data = await res.json();
            
            if (data.list && data.list.length > 0) {
                // تصفية الفيديوهات العربية فقط والتي مدتها كافية (أكثر من 3 دقائق)
                data.list.forEach(v => {
                    if (arabicRegex.test(v.title) && v.duration >= CONFIG.clipDuration) {
                        allVideos.push(v);
                    }
                });
                
                console.log(`   ✅ وجد ${data.list.length} فيديو، منها ${data.list.filter(v => arabicRegex.test(v.title)).length} عربي`);
            }
        } catch (e) { 
            console.error(`❌ خطأ في فحص قناة ${channel}: ${e.message}`); 
        }
    }
    
    return allVideos;
}

// --- 3. تحميل المقطع باستخدام ffmpeg مباشرة ---
async function downloadClip(m3u8Url, outputPath, duration) {
    return new Promise((resolve, reject) => {
        console.log(`📥 بدء تحميل ${duration} ثانية من الفيديو...`);
        
        try {
            // استخدام ffmpeg لتحميل المقطع مباشرة من رابط m3u8
            // نضيف headers للتأكد من السماح بالتحميل
            const command = [
                'ffmpeg',
                '-headers', `User-Agent: ${CONFIG.userAgent}\r\nReferer: https://www.dailymotion.com/\r\n`,
                '-i', `"${m3u8Url}"`,
                '-t', String(duration),
                '-c', 'copy',
                '-bsf:a', 'aac_adtstoasc',
                '-y',
                `"${outputPath}"`
            ].join(' ');
            
            console.log(`🔧 تنفيذ: ffmpeg -i [m3u8_url] -t ${duration} ...`);
            
            execSync(command, { 
                stdio: 'inherit',
                timeout: 300000 // 5 دقائق كحد أقصى
            });
            
            // التحقق من نجاح التحميل
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000000) {
                console.log(`✅ تم التحميل بنجاح (${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB)`);
                resolve(true);
            } else {
                reject(new Error("الملف المحمل صغير جداً أو غير موجود"));
            }
            
        } catch (error) {
            reject(error);
        }
    });
}

// --- 4. معالجة الفيديو (فلاتر + تحسينات) ---
async function processVideo(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        console.log(`🎨 تطبيق الفلاتر والتحسينات...`);
        
        try {
            const command = [
                'ffmpeg',
                '-i', `"${inputPath}"`,
                '-vf', '"setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05"',
                '-c:v', 'libx264',
                '-crf', '23',
                '-pix_fmt', 'yuv420p',
                '-af', '"atempo=1.05"',
                '-y',
                `"${outputPath}"`
            ].join(' ');
            
            execSync(command, { 
                stdio: 'inherit',
                timeout: 300000
            });
            
            console.log(`✅ تمت المعالجة بنجاح`);
            resolve(true);
            
        } catch (error) {
            reject(error);
        }
    });
}

// --- 5. الرفع لـ TikTok ---
async function uploadToTikTok(videoPath, title) {
    const cookiesStr = process.env.TIKTOK_COOKIES;
    if (!cookiesStr) {
        console.error("❌ Cookies missing!");
        return false;
    }

    console.log(`🌐 بدء تشغيل المتصفح للرفع...`);
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);
    
    try {
        // تعيين الكوكيز
        const cookies = JSON.parse(cookiesStr);
        await page.setCookie(...cookies);
        
        console.log(`🔗 فتح صفحة الرفع...`);
        await page.goto('https://www.tiktok.com/upload?lang=ar', { 
            waitUntil: 'networkidle2', 
            timeout: 120000 
        });

        // رفع الفيديو
        console.log(`📤 جاري رفع "${path.basename(videoPath)}"...`);
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 30000 });
        await fileInput.uploadFile(videoPath);

        // كتابة الوصف
        const hashtags = title.split(' ').slice(0, 3).map(w => `#${w.replace(/[^a-zA-Z\u0600-\u06FF]/g, '')}`).join(' ');
        const caption = `${title} ${CONFIG.fixedText} ${hashtags} #dramabox #explore`;
        
        console.log(`📝 كتابة الوصف...`);
        const editorSelector = '.public-DraftEditor-content';
        await page.waitForSelector(editorSelector, { timeout: 60000 });
        await page.click(editorSelector);
        
        // مسح النص الموجود
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        
        // كتابة النص الجديد
        await page.keyboard.type(caption, { delay: 50 });

        // انتظار زر النشر
        console.log(`⏳ انتظار تجهيز الفيديو...`);
        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 300000 }, postBtn);

        // النشر
        console.log(`🚀 جاري النشر...`);
        await page.click(postBtn);
        
        // انتظار التأكيد
        await new Promise(r => setTimeout(r, 15000));
        
        console.log(`✅ تم النشر بنجاح!`);
        return true;
        
    } catch (err) {
        console.error(`❌ فشل الرفع:`, err.message);
        
        // التقاط screenshot للتشخيص
        try {
            await page.screenshot({ path: path.join(__dirname, 'error_screenshot.png') });
            console.log(`📸 تم حفظ screenshot للخطأ`);
        } catch (e) {}
        
        return false;
    } finally {
        await browser.close();
    }
}

// --- 6. المحرك الرئيسي ---
(async () => {
    console.log("🚀 بدء تشغيل بوت Dailymotion → TikTok\n");
    
    // تحميل التاريخ
    let history = { posted: [] };
    if (fs.existsSync(CONFIG.historyFile)) {
        try { 
            history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8')); 
            console.log(`📋 تم تحميل التاريخ: ${history.posted.length} فيديو منشور سابقاً`);
        } catch (e) {
            console.log(`⚠️ ملف التاريخ تالف، بدء من جديد`);
        }
    }

    // جلب الفيديوهات
    const videos = await fetchVideos();
    console.log(`\n📊 إجمالي الفيديوهات العربية المتاحة: ${videos.length}`);
    
    // استبعاد المنشور منها
    const unposted = videos.filter(v => !history.posted.includes(v.id));
    console.log(`🆕 الفيديوهات الجديدة: ${unposted.length}`);
    
    if (unposted.length === 0) {
        console.log("👋 لا يوجد محتوى جديد للنشر.");
        return;
    }

    // اختيار فيديو عشوائي
    const selected = unposted[Math.floor(Math.random() * unposted.length)];
    console.log(`\n🎯 الفيديو المختار: "${selected.title}"`);
    console.log(`⏱️ المدة: ${Math.floor(selected.duration / 60)} دقيقة`);
    
    try {
        // الخطوة 1: جلب رابط m3u8 طازج
        const m3u8Url = await getFreshM3U8(selected.id);
        
        if (!m3u8Url) {
            console.error("❌ فشل الحصول على رابط الفيديو");
            return;
        }
        
        // الخطوة 2: تحميل أول 3 دقائق مباشرة
        console.log(`\n📥 تحميل أول 3 دقائق...`);
        await downloadClip(m3u8Url, CONFIG.rawVideo, CONFIG.clipDuration);
        
        // الخطوة 3: معالجة الفيديو
        console.log(`\n🎨 معالجة الفيديو...`);
        await processVideo(CONFIG.rawVideo, CONFIG.tempVideo);
        
        // الخطوة 4: رفع لـ TikTok
        console.log(`\n📤 الرفع لـ TikTok...`);
        const success = await uploadToTikTok(CONFIG.tempVideo, selected.title);
        
        if (success) {
            // حفظ في التاريخ
            history.posted.push(selected.id);
            fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
            console.log(`💾 تم تحديث ملف التاريخ`);
        }
        
    } catch (e) {
        console.error(`\n⚠️ خطأ تقني:`, e.message);
    } finally {
        // تنظيف
        if (fs.existsSync(CONFIG.rawVideo)) {
            fs.unlinkSync(CONFIG.rawVideo);
            console.log(`🧹 تم حذف الملف الخام`);
        }
        if (fs.existsSync(CONFIG.tempVideo)) {
            fs.unlinkSync(CONFIG.tempVideo);
            console.log(`🧹 تم حذف الملف المعالج`);
        }
    }
    
    console.log(`\n✅ اكتمل التشغيل`);
})();

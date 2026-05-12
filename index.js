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
    clipVideo: path.join(__dirname, "clip_3min.mp4"),
    finalVideo: path.join(__dirname, "final_video.mp4"),
    clipDuration: 180, // 3 دقائق بالثواني
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    channels: ["Film.Arena", "Chnese-drama", "Drama-Portal", "Neon.History", "drama.box"]
};

// --- 1. جلب قائمة الفيديوهات ---
async function fetchVideos() {
    let allVideos = [];
    const arabicRegex = /[\u0600-\u06FF]/;
    
    for (const channel of CONFIG.channels) {
        console.log(`📡 فحص قناة: ${channel}...`);
        try {
            const res = await fetch(
                `https://api.dailymotion.com/user/${channel}/videos?fields=id,title,duration&limit=20&sort=recent`,
                { headers: { 'User-Agent': CONFIG.userAgent } }
            );
            
            if (!res.ok) continue;
            
            const data = await res.json();
            
            if (data.list && data.list.length > 0) {
                data.list.forEach(v => {
                    if (arabicRegex.test(v.title) && v.duration >= CONFIG.clipDuration) {
                        allVideos.push(v);
                    }
                });
                console.log(`   ✅ ${data.list.length} فيديو، ${data.list.filter(v => arabicRegex.test(v.title)).length} عربي`);
            }
        } catch (e) { 
            console.error(`❌ خطأ: ${e.message}`); 
        }
    }
    
    return allVideos;
}

// --- 2. تحميل أول 3 دقائق باستخدام yt-dlp (الطريقة الصحيحة) ---
function downloadClip(videoId) {
    console.log(`📥 تحميل أول 3 دقائق من الفيديو...`);
    
    try {
        const url = `https://www.dailymotion.com/video/${videoId}`;
        
        // أمر yt-dlp الصحيح لتحميل جزء محدد
        const cmd = [
            'yt-dlp',
            `"${url}"`,
            '-o', `"${CONFIG.rawVideo}"`,
            '--download-sections', '*0:00-3:00',  // تحميل من 0 إلى 3 دقائق
            '-f', 'best[ext=mp4]',  // أفضل جودة بصيغة mp4
            '--no-check-certificates',
            '--user-agent', `"${CONFIG.userAgent}"`,
            '--force-overwrites',
            '--no-playlist'
        ].join(' ');
        
        console.log(`🔧 ${cmd}`);
        
        execSync(cmd, { 
            stdio: 'inherit',
            timeout: 300000
        });
        
        // التأكد من وجود الملف
        if (fs.existsSync(CONFIG.rawVideo)) {
            const size = fs.statSync(CONFIG.rawVideo).size;
            console.log(`✅ تم التحميل (${(size / 1024 / 1024).toFixed(2)} MB)`);
            
            if (size < 100000) {
                console.error('❌ الملف صغير جداً!');
                return false;
            }
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.error(`❌ فشل التحميل:`, error.message);
        return false;
    }
}

// --- 3. تحويل وتقطيع الفيديو باستخدام ffmpeg ---
function processClip() {
    console.log(`✂️ معالجة الفيديو وإضافة التأثيرات...`);
    
    try {
        const cmd = [
            'ffmpeg',
            '-i', `"${CONFIG.rawVideo}"`,
            '-t', String(CONFIG.clipDuration),
            '-vf', 'setpts=0.95*PTS,eq=brightness=0.03:contrast=1.05',
            '-c:v', 'libx264',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-af', 'atempo=1.05',
            '-y',
            `"${CONFIG.finalVideo}"`
        ].join(' ');
        
        execSync(cmd, { 
            stdio: 'inherit',
            timeout: 300000
        });
        
        if (fs.existsSync(CONFIG.finalVideo)) {
            const size = fs.statSync(CONFIG.finalVideo).size;
            console.log(`✅ تمت المعالجة (${(size / 1024 / 1024).toFixed(2)} MB)`);
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.error(`❌ فشل المعالجة:`, error.message);
        return false;
    }
}

// --- 4. رفع إلى TikTok ---
async function uploadToTikTok(videoPath, title) {
    const cookiesStr = process.env.TIKTOK_COOKIES;
    if (!cookiesStr) {
        console.error("❌ Cookies missing!");
        return false;
    }

    console.log(`🌐 فتح المتصفح...`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent(CONFIG.userAgent);
        
        const cookies = JSON.parse(cookiesStr);
        await page.setCookie(...cookies);
        
        console.log(`🔗 الذهاب إلى صفحة الرفع...`);
        await page.goto('https://www.tiktok.com/upload?lang=ar', { 
            waitUntil: 'networkidle2', 
            timeout: 120000 
        });

        // رفع الفيديو
        console.log(`📤 رفع الملف...`);
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 30000 });
        await fileInput.uploadFile(videoPath);

        // كتابة الوصف
        const hashtags = title.split(' ').slice(0, 3)
            .map(w => `#${w.replace(/[^a-zA-Z\u0600-\u06FF]/g, '')}`)
            .filter(h => h.length > 1)
            .join(' ');
        
        const caption = `${title} ${CONFIG.fixedText} ${hashtags} #dramabox #explore`;
        
        console.log(`📝 كتابة الوصف...`);
        const editor = '.public-DraftEditor-content';
        await page.waitForSelector(editor, { timeout: 60000 });
        await page.click(editor);
        
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(caption, { delay: 50 });

        // انتظار النشر
        console.log(`⏳ انتظار...`);
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
        console.error(`❌ فشل:`, err.message);
        return false;
    } finally {
        if (browser) await browser.close();
    }
}

// --- 5. الدالة الرئيسية ---
(async () => {
    console.log("🚀 بدء التشغيل...\n");
    
    // تحميل التاريخ
    let history = { posted: [] };
    if (fs.existsSync(CONFIG.historyFile)) {
        try { 
            history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8')); 
        } catch (e) {}
    }

    // جلب الفيديوهات
    const videos = await fetchVideos();
    console.log(`\n📊 المجموع: ${videos.length}`);
    
    const unposted = videos.filter(v => !history.posted.includes(v.id));
    console.log(`🆕 الجديد: ${unposted.length}`);
    
    if (unposted.length === 0) {
        console.log("👋 لا جديد.");
        return;
    }

    const selected = unposted[Math.floor(Math.random() * unposted.length)];
    console.log(`\n🎯 "${selected.title}"`);
    
    try {
        // خطوة 1: تحميل أول 3 دقائق
        console.log(`\n--- تحميل ---`);
        const downloaded = downloadClip(selected.id);
        
        if (!downloaded) {
            console.error("❌ فشل التحميل");
            return;
        }
        
        // خطوة 2: معالجة
        console.log(`\n--- معالجة ---`);
        const processed = processClip();
        
        if (!processed) {
            console.error("❌ فشل المعالجة");
            return;
        }
        
        // خطوة 3: رفع
        console.log(`\n--- رفع ---`);
        const success = await uploadToTikTok(CONFIG.finalVideo, selected.title);
        
        if (success) {
            history.posted.push(selected.id);
            fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
            console.log(`💾 تم الحفظ`);
        }
        
    } catch (e) {
        console.error(`\n⚠️ ${e.message}`);
    } finally {
        // تنظيف
        [CONFIG.rawVideo, CONFIG.finalVideo].forEach(f => {
            if (fs.existsSync(f)) fs.unlinkSync(f);
        });
    }
    
    console.log(`\n✅ انتهى`);
})();

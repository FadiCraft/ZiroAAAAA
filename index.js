import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
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

// --- 1. الحصول على رابط m3u8 مباشر ---
async function getFreshM3U8(videoId) {
    console.log(`🔗 جلب رابط m3u8 مباشر للفيديو: ${videoId}...`);
    
    try {
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
        
        if (!data.qualities) {
            console.error("❌ لا توجد روابط جودة متاحة");
            console.log("📋 البيانات المستلمة:", JSON.stringify(data).substring(0, 300));
            return null;
        }
        
        // تجربة الجودات بالترتيب - نختار جودة منخفضة لتجنب مشاكل protection
        const qualityOrder = ['380', '480', '720', 'auto', '240', '144'];
        
        for (const quality of qualityOrder) {
            if (data.qualities[quality] && data.qualities[quality].length > 0) {
                const m3u8Url = data.qualities[quality][0].url;
                console.log(`✅ تم العثور على رابط m3u8 بجودة ${quality}`);
                console.log(`🔗 الرابط: ${m3u8Url.substring(0, 100)}...`);
                return m3u8Url;
            }
        }
        
        return null;
        
    } catch (error) {
        console.error(`❌ خطأ في جلب رابط m3u8:`, error.message);
        return null;
    }
}

// --- 2. جلب قائمة الفيديوهات ---
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
            
            if (!res.ok) continue;
            
            const data = await res.json();
            
            if (data.list && data.list.length > 0) {
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

// --- 3. تحميل المقطع - طريقة مضمونة مع إعادة ترميز ---
async function downloadClip(m3u8Url, outputPath, duration) {
    return new Promise((resolve, reject) => {
        console.log(`📥 بدء تحميل ${duration} ثانية...`);
        
        // الحل: إعادة ترميز بدلاً من النسخ المباشر
        const args = [
            '-user_agent', CONFIG.userAgent,
            '-headers', `Referer: https://www.dailymotion.com/\r\nOrigin: https://www.dailymotion.com`,
            '-i', m3u8Url,
            '-t', String(duration),
            '-c:v', 'libx264',     // إعادة ترميز الفيديو
            '-c:a', 'aac',         // إعادة ترميز الصوت
            '-preset', 'fast',     // سرعة متوسطة
            '-crf', '23',          // جودة جيدة
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-y',
            outputPath
        ];
        
        console.log(`🔧 تشغيل ffmpeg مع إعادة ترميز...`);
        
        const ffmpeg = spawn('ffmpeg', args, {
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let stderr = '';
        
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
            if (data.toString().includes('time=')) {
                process.stdout.write(`\r⏳ ${data.toString().match(/time=(\S+)/)?.[0] || ''}`);
            }
        });
        
        ffmpeg.on('close', (code) => {
            console.log('');
            if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 500000) {
                console.log(`✅ تم التحميل بنجاح (${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB)`);
                resolve(true);
            } else {
                console.error(`❌ فشل (كود ${code})`);
                // طباعة آخر جزء من الخطأ
                const lines = stderr.split('\n');
                console.error('🔍 آخر 10 أسطر من الخطأ:');
                lines.slice(-10).forEach(line => console.error(line));
                reject(new Error(`ffmpeg exited with code ${code}`));
            }
        });
        
        ffmpeg.on('error', (err) => {
            reject(new Error(`فشل تشغيل ffmpeg: ${err.message}`));
        });
        
        setTimeout(() => {
            ffmpeg.kill();
            reject(new Error('انتهت مهلة التحميل'));
        }, 300000);
    });
}

// --- 4. معالجة إضافية (اختيارية لأننا نعيد الترميز مسبقاً) ---
async function processVideo(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        console.log(`🎨 إضافة تأثيرات...`);
        
        const args = [
            '-i', inputPath,
            '-vf', 'setpts=0.95*PTS,eq=brightness=0.03:contrast=1.05',
            '-c:v', 'libx264',
            '-crf', '24',
            '-pix_fmt', 'yuv420p',
            '-af', 'atempo=1.05',
            '-y',
            outputPath
        ];
        
        const ffmpeg = spawn('ffmpeg', args);
        
        ffmpeg.stderr.on('data', (data) => {
            if (data.toString().includes('time=')) {
                process.stdout.write(`\r⏳ ${data.toString().match(/time=(\S+)/)?.[0] || ''}`);
            }
        });
        
        ffmpeg.on('close', (code) => {
            console.log('');
            if (code === 0) {
                console.log(`✅ تمت المعالجة`);
                resolve(true);
            } else {
                reject(new Error(`فشلت المعالجة (كود ${code})`));
            }
        });
        
        ffmpeg.on('error', reject);
        
        setTimeout(() => {
            ffmpeg.kill();
            reject(new Error('انتهت مهلة المعالجة'));
        }, 300000);
    });
}

// --- 5. الرفع لـ TikTok (نفس الكود السابق) ---
async function uploadToTikTok(videoPath, title) {
    const cookiesStr = process.env.TIKTOK_COOKIES;
    if (!cookiesStr) {
        console.error("❌ Cookies missing!");
        return false;
    }

    console.log(`🌐 بدء تشغيل المتصفح...`);
    
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
        
        await page.goto('https://www.tiktok.com/upload?lang=ar', { 
            waitUntil: 'networkidle2', 
            timeout: 120000 
        });

        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 30000 });
        await fileInput.uploadFile(videoPath);

        const hashtags = title.split(' ').slice(0, 3)
            .map(w => `#${w.replace(/[^a-zA-Z\u0600-\u06FF]/g, '')}`)
            .filter(h => h.length > 1)
            .join(' ');
        
        const caption = `${title} ${CONFIG.fixedText} ${hashtags} #dramabox #explore`;
        
        const editorSelector = '.public-DraftEditor-content';
        await page.waitForSelector(editorSelector, { timeout: 60000 });
        await page.click(editorSelector);
        
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(caption, { delay: 50 });

        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 300000 }, postBtn);

        await page.click(postBtn);
        await new Promise(r => setTimeout(r, 15000));
        
        console.log(`✅ تم النشر بنجاح!`);
        return true;
        
    } catch (err) {
        console.error(`❌ فشل الرفع:`, err.message);
        return false;
    } finally {
        if (browser) await browser.close();
    }
}

// --- 6. المحرك الرئيسي ---
(async () => {
    console.log("🚀 بدء تشغيل بوت Dailymotion → TikTok\n");
    
    let history = { posted: [] };
    if (fs.existsSync(CONFIG.historyFile)) {
        try { 
            history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8')); 
        } catch (e) {}
    }

    const videos = await fetchVideos();
    console.log(`\n📊 إجمالي الفيديوهات: ${videos.length}`);
    
    const unposted = videos.filter(v => !history.posted.includes(v.id));
    console.log(`🆕 الجديد: ${unposted.length}`);
    
    if (unposted.length === 0) {
        console.log("👋 لا يوجد محتوى جديد.");
        return;
    }

    const selected = unposted[Math.floor(Math.random() * unposted.length)];
    console.log(`\n🎯 المختار: "${selected.title}"`);
    
    try {
        const m3u8Url = await getFreshM3U8(selected.id);
        
        if (!m3u8Url) {
            console.error("❌ فشل الحصول على رابط الفيديو");
            return;
        }
        
        // الخطوة 1: تحميل مع إعادة ترميز
        console.log(`\n📥 تحميل 3 دقائق...`);
        await downloadClip(m3u8Url, CONFIG.rawVideo, CONFIG.clipDuration);
        
        // الخطوة 2: تأثيرات إضافية
        console.log(`\n🎨 إضافة تأثيرات...`);
        await processVideo(CONFIG.rawVideo, CONFIG.tempVideo);
        
        // الخطوة 3: رفع لـ TikTok
        console.log(`\n📤 رفع لـ TikTok...`);
        const success = await uploadToTikTok(CONFIG.tempVideo, selected.title);
        
        if (success) {
            history.posted.push(selected.id);
            fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
            console.log(`💾 تم التحديث`);
        }
        
    } catch (e) {
        console.error(`\n⚠️ خطأ:`, e.message);
    } finally {
        try {
            if (fs.existsSync(CONFIG.rawVideo)) fs.unlinkSync(CONFIG.rawVideo);
            if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
        } catch (e) {}
    }
    
    console.log(`\n✅ اكتمل`);
})();

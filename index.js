import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fetch from "node-fetch";
import ytdl from 'yt-dlp-exec'; // استخدام المكتبة مباشرة

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- الإعدادات ---
const CONFIG = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    historyFile: path.join(__dirname, "history.json"),
    rawVideo: path.join(__dirname, "raw_video.mp4"),
    finalVideo: path.join(__dirname, "final_video.mp4"),
    clipDuration: "00:03:00", // 3 دقائق
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    channels: ["Film.Arena", "Chnese-drama", "Drama-Portal", "Neon.History", "drama.box"]
};

// --- 1. جلب الفيديوهات ---
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
                    if (arabicRegex.test(v.title) && v.duration >= 180) {
                        allVideos.push(v);
                    }
                });
                console.log(`   ✅ ${data.list.filter(v => arabicRegex.test(v.title)).length} فيديو عربي`);
            }
        } catch (e) { 
            console.error(`❌ ${e.message}`); 
        }
    }
    return allVideos;
}

// --- 2. تحميل المقطع (تم استبدال npx بـ library call) ---
async function downloadClip(videoId) {
    try {
        console.log(`📥 تحميل أول 3 دقائق لـ ${videoId}...`);
        const url = `https://www.dailymotion.com/video/${videoId}`;
        
        await ytdl(url, {
            output: CONFIG.rawVideo,
            downloadSections: `*00:00:00-${CONFIG.clipDuration}`,
            format: 'bestvideo+bestaudio/best',
            mergeOutputFormat: 'mp4',
            noCheckCertificates: true,
            userAgent: CONFIG.userAgent,
            forceOverwrites: true,
            noPlaylist: true,
            noWarnings: true
        });

        if (fs.existsSync(CONFIG.rawVideo) && fs.statSync(CONFIG.rawVideo).size > 1000000) {
            const size = fs.statSync(CONFIG.rawVideo).size;
            console.log(`✅ تم التحميل (${(size / 1024 / 1024).toFixed(2)} MB)`);
            return true;
        }
        return false;
    } catch (err) {
        console.error(`❌ فشل التحميل: ${err.message}`);
        return false;
    }
}

// --- 3. معالجة الفيديو ---
function processVideo() {
    console.log(`🎨 إضافة تأثيرات...`);
    try {
        const cmd = `ffmpeg -i "${CONFIG.rawVideo}" -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -c:v libx264 -crf 23 -pix_fmt yuv420p -af "atempo=1.05" -y "${CONFIG.finalVideo}"`;
        execSync(cmd, { stdio: 'inherit', timeout: 300000 });
        
        if (fs.existsSync(CONFIG.finalVideo)) {
            console.log(`✅ تمت المعالجة`);
            return true;
        }
        return false;
    } catch (e) {
        console.error(`❌ خطأ في معالجة FFmpeg: ${e.message}`);
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
        
        const editor = '.public-DraftEditor-content';
        await page.waitForSelector(editor, { timeout: 60000 });
        await page.click(editor);
        
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
        
        console.log(`✅ تم النشر!`);
        return true;
        
    } catch (err) {
        console.error(`❌ خطأ أثناء الرفع: ${err.message}`);
        return false;
    } finally {
        if (browser) await browser.close();
    }
}

// --- 5. الدالة الرئيسية ---
(async () => {
    console.log("🚀 بدء التشغيل...\n");
    
    let history = { posted: [] };
    if (fs.existsSync(CONFIG.historyFile)) {
        try { 
            history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8')); 
        } catch (e) {}
    }

    const videos = await fetchVideos();
    console.log(`\n📊 المجموع: ${videos.length}`);
    
    const unposted = videos.filter(v => !history.posted.includes(v.id));
    console.log(`🆕 الجديد: ${unposted.length}\n`);
    
    if (unposted.length === 0) {
        console.log("👋 لا يوجد فيديوهات جديدة للنشر.");
        return;
    }

    const selected = unposted[Math.floor(Math.random() * unposted.length)];
    console.log(`🎯 الفيديو المختار: "${selected.title}"\n`);
    
    // 1. تحميل
    const downloaded = await downloadClip(selected.id);
    if (!downloaded) return;
    
    // 2. معالجة
    const processed = processVideo();
    if (!processed) return;
    
    // 3. رفع
    const success = await uploadToTikTok(CONFIG.finalVideo, selected.title);
    
    if (success) {
        history.posted.push(selected.id);
        fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
        console.log(`💾 تم حفظ الفيديو في السجل.`);
    }
    
    // تنظيف الملفات
    [CONFIG.rawVideo, CONFIG.finalVideo].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
    });
    
    console.log(`\n✅ انتهت العملية بنجاح.`);
})();

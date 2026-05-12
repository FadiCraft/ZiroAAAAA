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

const CONFIG = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    historyFile: path.join(__dirname, "history.json"),
    rawVideo: path.join(__dirname, "raw_video.mp4"),
    finalVideo: path.join(__dirname, "final_video.mp4"),
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    channels: ["Film.Arena", "Chnese-drama", "Drama-Portal", "Neon.History", "drama.box"]
};

// --- 1. تثبيت yt-dlp تلقائياً إذا لم يكن موجوداً ---
function ensureYtDlp() {
    const ytDlpPath = path.join(__dirname, 'yt-dlp');
    
    if (!fs.existsSync(ytDlpPath)) {
        console.log('📥 تحميل yt-dlp...');
        execSync(
            'wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O yt-dlp && chmod +x yt-dlp',
            { stdio: 'inherit' }
        );
    }
    return ytDlpPath;
}

// --- 2. جلب الفيديوهات ---
async function fetchVideos() {
    let allVideos = [];
    const arabicRegex = /[\u0600-\u06FF]/;
    
    for (const channel of CONFIG.channels) {
        console.log(`📡 ${channel}...`);
        try {
            const res = await fetch(
                `https://api.dailymotion.com/user/${channel}/videos?fields=id,title,duration&limit=20&sort=recent`,
                { headers: { 'User-Agent': CONFIG.userAgent } }
            );
            const data = await res.json();
            
            if (data.list) {
                data.list.forEach(v => {
                    if (arabicRegex.test(v.title) && v.duration >= 180) {
                        allVideos.push(v);
                    }
                });
                console.log(`   ✅ ${data.list.filter(v => arabicRegex.test(v.title)).length} عربي`);
            }
        } catch (e) {}
    }
    return allVideos;
}

// --- 3. تحميل المقطع ---
function downloadClip(videoId, ytDlpPath) {
    console.log(`📥 تحميل أول 3 دقائق...`);
    
    try {
        const cmd = [
            ytDlpPath,
            `https://www.dailymotion.com/video/${videoId}`,
            '-o', CONFIG.rawVideo,
            '--download-sections', '*0:00-3:00',
            '-f', 'best',
            '--merge-output-format', 'mp4',
            '--no-check-certificates',
            '--user-agent', CONFIG.userAgent,
            '--force-overwrites',
            '--no-playlist'
        ].join(' ');
        
        execSync(cmd, { stdio: 'inherit', timeout: 300000 });
        
        if (fs.existsSync(CONFIG.rawVideo) && fs.statSync(CONFIG.rawVideo).size > 500000) {
            console.log(`✅ تم التحميل (${(fs.statSync(CONFIG.rawVideo).size / 1024 / 1024).toFixed(2)} MB)`);
            return true;
        }
        
        return false;
    } catch (e) {
        console.error(`❌ فشل التحميل`);
        return false;
    }
}

// --- 4. معالجة الفيديو ---
function processVideo() {
    console.log(`🎨 إضافة تأثيرات...`);
    try {
        const cmd = [
            'ffmpeg',
            '-i', CONFIG.rawVideo,
            '-t', '180',
            '-vf', 'setpts=0.95*PTS,eq=brightness=0.03:contrast=1.05',
            '-c:v', 'libx264',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-af', 'atempo=1.05',
            '-y',
            CONFIG.finalVideo
        ].join(' ');
        
        execSync(cmd, { stdio: 'ignore', timeout: 300000 });
        
        if (fs.existsSync(CONFIG.finalVideo) && fs.statSync(CONFIG.finalVideo).size > 500000) {
            console.log(`✅ تمت المعالجة`);
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

// --- 5. رفع إلى TikTok ---
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
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent(CONFIG.userAgent);
        await page.setCookie(...JSON.parse(cookiesStr));
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 120000 });

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
        console.error(`❌ ${err.message}`);
        return false;
    } finally {
        if (browser) await browser.close();
    }
}

// --- الدالة الرئيسية ---
(async () => {
    console.log("🚀 بدء التشغيل...\n");
    
    // تحميل yt-dlp تلقائياً
    const ytDlpPath = ensureYtDlp();
    
    let history = { posted: [] };
    if (fs.existsSync(CONFIG.historyFile)) {
        try { history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8')); } catch (e) {}
    }

    const videos = await fetchVideos();
    console.log(`📊 ${videos.length} فيديو\n`);
    
    const unposted = videos.filter(v => !history.posted.includes(v.id));
    
    if (unposted.length === 0) {
        console.log("👋 لا جديد");
        return;
    }

    const selected = unposted[Math.floor(Math.random() * unposted.length)];
    console.log(`🎯 "${selected.title}"\n`);
    
    // تحميل
    if (!downloadClip(selected.id, ytDlpPath)) return;
    
    // معالجة
    if (!processVideo()) return;
    
    // رفع
    const success = await uploadToTikTok(CONFIG.finalVideo, selected.title);
    
    if (success) {
        history.posted.push(selected.id);
        fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
        console.log(`💾 تم الحفظ`);
    }
    
    // تنظيف
    [CONFIG.rawVideo, CONFIG.finalVideo].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
    });
    
    console.log(`\n✅ انتهى`);
})();

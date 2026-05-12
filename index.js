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
    finalVideo: path.join(__dirname, "final_video.mp4"),
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    channels: ["Film.Arena", "Chnese-drama", "Drama-Portal", "Neon.History", "drama.box"]
};

// --- 1. جلب رابط m3u8 طازج ---
async function getFreshM3U8(videoId) {
    console.log(`🔗 جلب رابط m3u8 طازج...`);
    
    // نحتاج نحاكي متصفح حقيقي عشان نجيب رابط صالح
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        await page.setUserAgent(CONFIG.userAgent);
        
        // نفتح صفحة الفيديو مباشرة
        await page.goto(`https://www.dailymotion.com/video/${videoId}`, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        // نستخرج رابط m3u8 من طلبات الشبكة
        const m3u8Url = await page.evaluate(() => {
            // نحاول نلاقي الرابط في عنصر الفيديو
            const video = document.querySelector('video');
            if (video && video.src) return video.src;
            
            // أو من metadata
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const text = script.textContent;
                if (text.includes('m3u8')) {
                    const match = text.match(/(https:\/\/[^"'\s]*\.m3u8[^"'\s]*)/);
                    if (match) return match[1];
                }
            }
            return null;
        });
        
        if (m3u8Url) {
            console.log(`✅ تم العثور على رابط m3u8`);
            return m3u8Url;
        }
        
        // إذا ما لقينا، نجيب من API
        const response = await fetch(
            `https://www.dailymotion.com/player/metadata/video/${videoId}`,
            { headers: { 'User-Agent': CONFIG.userAgent } }
        );
        const data = await response.json();
        
        if (data.qualities?.auto?.[0]?.url) {
            console.log(`✅ تم العثور على رابط m3u8 من API`);
            return data.qualities.auto[0].url;
        }
        
        return null;
    } finally {
        await browser.close();
    }
}

// --- 2. تحميل وتحويل مباشر (بسرعة قبل ما ينتهي الرابط) ---
function downloadAndProcess(m3u8Url) {
    console.log(`📥 تحميل ومعالجة 3 دقائق...`);
    
    try {
        // أمر واحد يسوي كل شي: تحميل + قص + تأثيرات
        const cmd = [
            'ffmpeg',
            '-headers', `User-Agent: ${CONFIG.userAgent}`,
            '-i', `"${m3u8Url}"`,
            '-t', '180',
            '-vf', 'setpts=0.95*PTS,eq=brightness=0.03:contrast=1.05',
            '-c:v', 'libx264',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-af', 'atempo=1.05',
            '-y',
            `"${CONFIG.finalVideo}"`
        ].join(' ');
        
        execSync(cmd, { stdio: 'inherit', timeout: 300000 });
        
        if (fs.existsSync(CONFIG.finalVideo) && fs.statSync(CONFIG.finalVideo).size > 500000) {
            console.log(`✅ تم (${(fs.statSync(CONFIG.finalVideo).size / 1024 / 1024).toFixed(2)} MB)`);
            return true;
        }
        return false;
    } catch (e) {
        console.error(`❌ فشل`);
        return false;
    }
}

// --- 3. جلب الفيديوهات ---
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
    console.log("🚀 بدء...\n");
    
    let history = { posted: [] };
    if (fs.existsSync(CONFIG.historyFile)) {
        try { history = JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf8')); } catch (e) {}
    }

    const videos = await fetchVideos();
    const unposted = videos.filter(v => !history.posted.includes(v.id));
    
    if (unposted.length === 0) {
        console.log("👋 لا جديد");
        return;
    }

    const selected = unposted[Math.floor(Math.random() * unposted.length)];
    console.log(`🎯 "${selected.title}"\n`);
    
    // الحل: نجيب رابط طازج ونحمله فوراً
    const m3u8Url = await getFreshM3U8(selected.id);
    
    if (!m3u8Url) {
        console.error("❌ فشل جلب الرابط");
        return;
    }
    
    // تحميل فوري قبل ما ينتهي الرابط
    if (!downloadAndProcess(m3u8Url)) return;
    
    // رفع
    const success = await uploadToTikTok(CONFIG.finalVideo, selected.title);
    
    if (success) {
        history.posted.push(selected.id);
        fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
        console.log(`💾 تم الحفظ`);
    }
    
    if (fs.existsSync(CONFIG.finalVideo)) fs.unlinkSync(CONFIG.finalVideo);
    
    console.log(`\n✅ انتهى`);
})();

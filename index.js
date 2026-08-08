const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const BASE_URL = 'https://fabor-tv.to/matches-today/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Options لإطلاق المتصفح بشكل خفيف
const puppeteerOptions = {
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
    ]
};

// 1️⃣ API: جلب قائمة المباريات المباشرة من الصفحة الرئيسية (سريع جداً)
app.get('/api/matches', async (req, res) => {
    let browser;
    try {
        console.log("🔍 جاري جلب المباريات مباشرة...");
        browser = await puppeteer.launch(puppeteerOptions);
        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);
        
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });

        const matches = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('.AY_Match').forEach(el => {
                const linkElement = el.querySelector('a');
                items.push({
                    team1: el.querySelector('.TM1 .TM_Name')?.innerText.trim() || "",
                    team1Logo: el.querySelector('.TM1 .TM_Logo img')?.src || "",
                    team2: el.querySelector('.TM2 .TM_Name')?.innerText.trim() || "",
                    team2Logo: el.querySelector('.TM2 .TM_Logo img')?.src || "",
                    time: el.querySelector('.MT_Time span')?.innerText.trim() || "",
                    status: el.querySelector('.MT_Stat')?.innerText.trim() || "",
                    league: el.querySelector('.TourName')?.innerText.trim() || "",
                    matchUrl: linkElement ? linkElement.href : ""
                });
            });
            return items;
        });

        res.json({
            success: true,
            count: matches.length,
            data: matches
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// 2️⃣ API: جلب رابط البث M3U8 لمباراة واحدة محددة مباشرة (On-Demand)
app.get('/api/stream', async (req, res) => {
    const { matchUrl } = req.query;

    if (!matchUrl) {
        return res.status(400).json({ success: false, error: 'الرجاء تزويد رابط المباراة عبر matchUrl' });
    }

    let browser;
    try {
        console.log(`🎬 جاري استخراج البث مباشرة لـ: ${matchUrl}`);
        browser = await puppeteer.launch(puppeteerOptions);
        
        const matchPage = await browser.newPage();
        await matchPage.setUserAgent(USER_AGENT);
        
        // 1. فتح صفحة المباراة
        await matchPage.goto(matchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

        let frameUrl = "";
        try {
            await matchPage.waitForSelector('iframe#player', { timeout: 6000, visible: true });
            frameUrl = await matchPage.evaluate(() => {
                const iframe = document.querySelector('iframe#player');
                return iframe ? iframe.src : "";
            });
        } catch (err) {
            frameUrl = await matchPage.evaluate(() => {
                const iframes = document.querySelectorAll('iframe');
                for (let iframe of iframes) {
                    if (iframe.src && iframe.src.includes('fabortvcdn.com')) return iframe.src;
                }
                return "";
            });
        }

        if (!frameUrl) {
            return res.json({ success: false, message: 'لم يتم العثور على سيرفر لهذه المباراة' });
        }

        // 2. فتح الـ iframe واستخراج ملف m3u8
        const fullIframeUrl = frameUrl.startsWith('//') ? `https:${frameUrl}` : frameUrl;
        const streamPage = await browser.newPage();
        await streamPage.setUserAgent(USER_AGENT);

        let m3u8Url = "";
        await streamPage.setRequestInterception(true);
        streamPage.on('request', (request) => {
            const url = request.url();
            if ((url.includes('.m3u8') || url.includes('m3u8')) && !m3u8Url) {
                m3u8Url = url;
            }
            request.continue();
        });

        await streamPage.goto(fullIframeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await sleep(3000);

        // محاولة النقر للتشغيل إذا لم يظهر الرابط تلقائياً
        if (!m3u8Url) {
            try {
                const playButton = await streamPage.$('button[aria-label="Play"], .play-button, .vjs-big-play-button');
                if (playButton) {
                    await playButton.click();
                    await sleep(2500);
                }
            } catch (e) {}
        }

        res.json({
            success: true,
            iframeUrl: frameUrl,
            stream: m3u8Url || "لم يتم العثور على رابط m3u8 مباشر"
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`🚀 API يعمل مباشرة على المنفذ: ${PORT}`);
});

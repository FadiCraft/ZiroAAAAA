// === هذا السطر يحل مشكلة المتصفح في ريندر ===
const path = require('path');
process.env.PUPPETEER_CACHE_DIR = path.join(__dirname, '.cache', 'puppeteer');
// ============================================

const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

const BASE_URL = 'https://fabor-tv.to/matches-today/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// دالة مساعدة للنوم (بديلة عن waitForTimeout)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// دالة التقاط الروابط من الشبكة (كما هي من الكود الخاص بك)
async function getDirectStream(browser, iframeUrl) {
    if (!iframeUrl) return "";
    const fullIframeUrl = iframeUrl.startsWith('//') ? `https:${iframeUrl}` : iframeUrl;

    return new Promise(async (resolve) => {
        let found = false;
        let page;
        const timeout = setTimeout(() => {
            if (!found && page) {
                page.close().catch(() => {});
                resolve("");
            }
        }, 15000);

        try {
            page = await browser.newPage();
            await page.setUserAgent(USER_AGENT);
            
            await page.setRequestInterception(true);
            page.on('request', (request) => {
                const url = request.url();
                if ((url.includes('.m3u8') || url.includes('m3u8')) && !found) {
                    found = true;
                    clearTimeout(timeout);
                    resolve(url);
                    page.close().catch(() => {});
                }
                request.continue();
            });

            await page.goto(fullIframeUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 30000 
            });
            
            await sleep(5000);
            
            try {
                const playButton = await page.$('button[aria-label="Play"], .play-button, .vjs-big-play-button');
                if (playButton) {
                    await playButton.click();
                    await sleep(3000);
                }
            } catch (e) {
                // تجاهل الخطأ
            }
            
        } catch (e) {
            clearTimeout(timeout);
            if (page) await page.close().catch(() => {});
            resolve("");
        }
    });
}

// الـ API الرئيسي المباشر (بدون تخزين)
app.get('/api/matches', async (req, res) => {
    let browser;
    try {
        console.log("🚀 جاري تهيئة المتصفح وبدء الجلب المباشر...");
        browser = await puppeteer.launch({ 
            headless: "new", 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ] 
        });

        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);
        await page.setViewport({ width: 1366, height: 768 });
        
        console.log("🔍 جاري فتح الموقع الرئيسي...");
        await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
        
        await sleep(3000);

        const matches = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('.AY_Match').forEach(el => {
                const linkElement = el.querySelector('a');
                const matchUrl = linkElement ? linkElement.href : "";

                items.push({
                    team1: el.querySelector('.TM1 .TM_Name')?.innerText.trim() || "",
                    team1Logo: el.querySelector('.TM1 .TM_Logo img')?.src || "",
                    team2: el.querySelector('.TM2 .TM_Name')?.innerText.trim() || "",
                    team2Logo: el.querySelector('.TM2 .TM_Logo img')?.src || "",
                    time: el.querySelector('.MT_Time span')?.innerText.trim() || "",
                    status: el.querySelector('.MT_Stat')?.innerText.trim() || "",
                    league: el.querySelector('.TourName')?.innerText.trim() || "",
                    matchUrl: matchUrl,
                    streamUrl: "",
                    channel: "غير متوفر",
                    LastTime: new Date().toLocaleString('ar-EG'),
                    stream: ""
                });
            });
            return items;
        });

        console.log(`✅ تم العثور على ${matches.length} مباريات، جاري استخراج روابط m3u8...`);

        // المرور على كل مباراة لاستخراج الـ m3u8
        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            if (match.matchUrl) {
                console.log(`\n🔗 [${i + 1}/${matches.length}] فحص مباراة: ${match.team1} ضد ${match.team2}`);
                
                let frameUrl = "";
                let matchPage;

                try {
                    matchPage = await browser.newPage();
                    await matchPage.setUserAgent(USER_AGENT);
                    await matchPage.setViewport({ width: 1366, height: 768 });
                    
                    await matchPage.goto(match.matchUrl, { 
                        waitUntil: 'networkidle2', 
                        timeout: 30000 
                    });
                    
                    await sleep(5000);

                    try {
                        await matchPage.waitForSelector('iframe#player', { 
                            timeout: 10000,
                            visible: true 
                        });
                        
                        frameUrl = await matchPage.evaluate(() => {
                            const iframe = document.querySelector('iframe#player');
                            return iframe ? iframe.src : "";
                        });
                    } catch (err) {
                        frameUrl = await matchPage.evaluate(() => {
                            const iframes = document.querySelectorAll('iframe');
                            for (let iframe of iframes) {
                                if (iframe.src && iframe.src.includes('fabortvcdn.com')) {
                                    return iframe.src;
                                }
                            }
                            return "";
                        });
                    }

                    match.streamUrl = frameUrl;

                    if (match.streamUrl) {
                        match.stream = await getDirectStream(browser, match.streamUrl);
                    }
                    
                } catch (err) {
                    console.log(`⚠️ خطأ في صفحة المباراة: ${err.message}`);
                } finally {
                    if (matchPage) await matchPage.close().catch(() => {});
                }
                
                await sleep(2000);
            }
        }

        // مسح matchUrl وإرجاع النتيجة مباشرة بدون حفظ في ملف
        const finalMatches = matches.map(({ matchUrl, ...rest }) => rest);

        console.log("🎉 اكتمل الجلب وتم إرسال البيانات.");
        
        // إرسال البيانات للمستخدم مباشرة
        res.json(finalMatches);

    } catch (error) {
        console.error('❌ خطأ فادح:', error.message);
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل على المنفذ: ${PORT}`);
    console.log(`👉 ادخل إلى: http://localhost:${PORT}/api/matches`);
});

const puppeteer = require('puppeteer');
const https = require('https');
const http = require('http');

const BASE_URL = 'https://fabor-tv.to/matches-today/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// دالة إرسال البيانات إلى API خارجي
function sendDataToAPI(data, webhookUrl) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const url = new URL(webhookUrl);
        
        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                console.log('✅ تم إرسال البيانات بنجاح');
                resolve(responseData);
            });
        });

        req.on('error', (error) => {
            console.error('❌ خطأ في إرسال البيانات:', error.message);
            reject(error);
        });

        req.write(payload);
        req.end();
    });
}

// دالة حفظ البيانات في متغير بيئة (للتخزين المؤقت)
function saveToEnvironment(data) {
    try {
        // تحويل البيانات إلى نص وضغطها
        const compressed = JSON.stringify(data);
        console.log(`💾 تم حفظ ${compressed.length} بايت في الذاكرة`);
        console.log('📋 البيانات المحفوظة:');
        console.log(compressed.substring(0, 500) + '...'); // طباعة أول 500 حرف
        return true;
    } catch (error) {
        console.error('❌ خطأ في حفظ البيانات:', error.message);
        return false;
    }
}

// دالة مساعدة للنوم
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// دالة التقاط الروابط من الشبكة
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
            } catch (e) {}
            
        } catch (e) {
            clearTimeout(timeout);
            if (page) await page.close().catch(() => {});
            resolve("");
        }
    });
}

async function scrapeMatches() {
    let browser;
    const startTime = Date.now();
    
    console.log(`🔧 بدء التشغيل في: ${new Date().toLocaleString('ar-EG')}`);
    console.log(`💻 Node Version: ${process.version}`);
    console.log(`🖥️ Platform: ${process.platform}`);
    console.log(`📁 Current Directory: ${process.cwd()}`);
    
    try {
        console.log("🚀 جاري تهيئة المتصفح...");
        
        const launchOptions = {
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--single-process',
                '--no-zygote'
            ]
        };
        
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        }
        
        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);
        await page.setViewport({ width: 1366, height: 768 });
        
        console.log("🔍 جاري فتح الموقع الرئيسي...");
        await page.goto(BASE_URL, { 
            waitUntil: 'networkidle2', 
            timeout: 30000 
        });
        
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

        console.log(`✅ تم العثور على ${matches.length} مباريات، جاري البحث عن الروابط...`);

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
                    
                    console.log(`   📄 فتح صفحة المباراة: ${match.matchUrl}`);
                    
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
                        
                        console.log(`   ✅ تم العثور على iframe: ${frameUrl}`);
                    } catch (err) {
                        console.log(`   ⚠️ لم يتم العثور على iframe#player: ${err.message}`);
                        
                        frameUrl = await matchPage.evaluate(() => {
                            const iframes = document.querySelectorAll('iframe');
                            for (let iframe of iframes) {
                                if (iframe.src && iframe.src.includes('fabortvcdn.com')) {
                                    return iframe.src;
                                }
                            }
                            return "";
                        });
                        
                        if (frameUrl) {
                            console.log(`   ✅ تم العثور على iframe بديل: ${frameUrl}`);
                        }
                    }

                    match.streamUrl = frameUrl;

                    if (match.streamUrl) {
                        console.log(`   ⏳ جاري استخراج بث الـ m3u8 من المشغل...`);
                        match.stream = await getDirectStream(browser, match.streamUrl);
                        if (match.stream) {
                            console.log(`   ✅ تم العثور على البث بنجاح!`);
                        } else {
                            console.log(`   ❌ لم يتم العثور على ملف m3u8`);
                        }
                    } else {
                        console.log(`   ❌ لم يتم العثور على سيرفر لهذه المباراة`);
                    }
                    
                } catch (err) {
                    console.log(`   ⚠️ حدث خطأ: ${err.message}`);
                } finally {
                    if (matchPage) await matchPage.close().catch(() => {});
                }
                
                await sleep(2000);
            }
        }

        const finalMatches = matches.map(({ matchUrl, ...rest }) => rest);

        // ============ حفظ البيانات بطرق متعددة ============
        
        // 1. طباعة النتائج في السجلات (دائماً متاح)
        console.log("\n" + "=".repeat(50));
        console.log("📊 نتائج المباريات:");
        console.log(JSON.stringify(finalMatches, null, 2));
        console.log("=".repeat(50));
        
        // 2. حفظ في متغيرات البيئة (مؤقت - للجلسة الحالية)
        process.env.LAST_MATCHES = JSON.stringify(finalMatches);
        
        // 3. محاولة الحفظ في ملف (قد يفشل في Render لكن نحاول)
        try {
            const fs = require('fs');
            const path = require('path');
            const outputPath = path.join('/tmp', 'match1.json');
            fs.writeFileSync(outputPath, JSON.stringify(finalMatches, null, 2), 'utf8');
            console.log(`✅ تم حفظ الملف في: ${outputPath}`);
            
            // طباعة محتوى الملف للتأكيد
            const savedData = fs.readFileSync(outputPath, 'utf8');
            console.log(`📄 حجم الملف: ${savedData.length} بايت`);
        } catch (fileError) {
            console.log(`⚠️ لم يتم حفظ الملف (هذا طبيعي في Render): ${fileError.message}`);
        }
        
        // 4. إرسال إلى Webhook إذا تم تكوينه
        const webhookUrl = process.env.WEBHOOK_URL;
        if (webhookUrl) {
            try {
                await sendDataToAPI(finalMatches, webhookUrl);
                console.log('✅ تم إرسال البيانات إلى Webhook');
            } catch (webhookError) {
                console.log(`⚠️ فشل إرسال Webhook: ${webhookError.message}`);
            }
        }

        // 5. حفظ في متغير ذاكرة عالمي
        global.matchesData = finalMatches;
        console.log('✅ تم حفظ البيانات في الذاكرة العالمية');
        
        // ملخص نهائي
        console.log("\n📈 إحصائيات:");
        console.log(`📊 إجمالي المباريات: ${finalMatches.length}`);
        console.log(`📺 المباريات المتاحة: ${finalMatches.filter(m => m.stream).length}`);
        
        const duration = (Date.now() - startTime) / 1000;
        console.log(`⏱️ وقت التنفيذ: ${duration.toFixed(2)} ثانية`);
        
        return finalMatches;

    } catch (error) {
        console.error('❌ خطأ فادح:', error.message);
        console.error('Stack:', error.stack);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log("\n🔒 تم إغلاق المتصفح");
        }
    }
}

// تشغيل السكربت
scrapeMatches()
    .then((data) => {
        console.log(`\n✅ اكتمل التنفيذ بنجاح`);
        console.log(`📝 البيانات جاهزة في السجلات أعلاه`);
        process.exit(0);
    })
    .catch((error) => {
        console.error(`\n❌ فشل التنفيذ: ${error.message}`);
        process.exit(1);
    });

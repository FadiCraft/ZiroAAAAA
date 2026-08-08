const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://fabor-tv.to/matches-today/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';


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
            
            // اعتراض الطلبات للبحث عن m3u8
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
            
            // انتظار إضافي لتحميل المشغل
            await sleep(5000);
            
            // محاولة النقر على زر التشغيل إذا وجد
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

async function scrapeMatches() {
    let browser;
    console.log(`🔧 بدء التشغيل في: ${new Date().toLocaleString('ar-EG')}`);
    console.log(`💻 Node Version: ${process.version}`);
    console.log(`🖥️ Platform: ${process.platform}`);
    
    try {
        console.log("🚀 جاري تهيئة المتصفح...");
        
        // إعدادات محسنة لـ Render
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
                '--no-zygote',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ]
        };
        
        // إضافة executablePath إذا كان محدد في المتغيرات البيئية
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        }
        
        browser = await puppeteer.launch(launchOptions);

        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);
        await page.setViewport({ width: 1366, height: 768 });
        
        // تعطيل بعض الميزات لتوفير الذاكرة
        await page.setJavaScriptEnabled(true);
        await page.setDefaultNavigationTimeout(30000);
        
        console.log("🔍 جاري فتح الموقع الرئيسي...");
        await page.goto(BASE_URL, { 
            waitUntil: 'networkidle2', 
            timeout: 30000 
        });
        
        // انتظار إضافي للتأكد من تحميل جميع المباريات
        await sleep(3000);

        // استخراج البيانات الأساسية وروابط صفحات المباريات
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

        // المرور على كل مباراة للحصول على رابط السيرفر (iframe)
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
                    
                    // استخدام networkidle2 للانتظار حتى يكتمل تحميل الصفحة
                    await matchPage.goto(match.matchUrl, { 
                        waitUntil: 'networkidle2', 
                        timeout: 30000 
                    });
                    
                    // انتظار إضافي لضمان تنفيذ JavaScript
                    await sleep(5000);

                    // محاولة انتظار ظهور عنصر iframe#player مع مهلة زمنية
                    try {
                        await matchPage.waitForSelector('iframe#player', { 
                            timeout: 10000,
                            visible: true 
                        });
                        
                        // استخراج رابط السيرفر من iframe#player
                        frameUrl = await matchPage.evaluate(() => {
                            const iframe = document.querySelector('iframe#player');
                            return iframe ? iframe.src : "";
                        });
                        
                        console.log(`   ✅ تم العثور على iframe: ${frameUrl}`);
                    } catch (err) {
                        console.log(`   ⚠️ لم يتم العثور على iframe#player (Timeout): ${err.message}`);
                        
                        // محاولة بديلة: البحث عن أي iframe
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

                    // إذا وجدنا رابط السيرفر، نقوم بتشغيل دالة استخراج الـ m3u8
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
                    console.log(`   ⚠️ حدث خطأ أثناء فتح صفحة المباراة: ${err.message}`);
                } finally {
                    if (matchPage) await matchPage.close().catch(() => {});
                }
                
                // تأخير بسيط بين كل مباراة لتجنب الحظر
                await sleep(2000);
            }
        }

        // مسح matchUrl من النتيجة النهائية
        const finalMatches = matches.map(({ matchUrl, ...rest }) => rest);

        // حفظ النتائج
        const outputPath = process.env.OUTPUT_PATH || path.join(__dirname, 'match1.json');
        fs.writeFileSync(outputPath, JSON.stringify(finalMatches, null, 2), 'utf8');
        
        console.log("\n" + "=".repeat(50));
        console.log("🎉 انتهى العمل. تم حفظ البيانات في match1.json");
        console.log(`📊 إجمالي المباريات: ${finalMatches.length}`);
        console.log(`📺 المباريات التي تم العثور على بث لها: ${finalMatches.filter(m => m.stream).length}`);
        console.log("=".repeat(50));
        
        // طباعة النتائج للسجلات
        if (finalMatches.length > 0) {
            console.log("\n📋 ملخص المباريات:");
            finalMatches.forEach((match, index) => {
                console.log(`\n${index + 1}. ${match.team1} vs ${match.team2}`);
                console.log(`   🕐 الوقت: ${match.time}`);
                console.log(`   📊 الحالة: ${match.status}`);
                console.log(`   🏆 الدوري: ${match.league}`);
                console.log(`   📺 البث: ${match.stream ? '✅ متوفر' : '❌ غير متوفر'}`);
            });
        }

        return finalMatches;

    } catch (error) {
        console.error('❌ خطأ فادح:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    } finally {
        if (browser) {
            await browser.close();
            console.log("\n🔒 تم إغلاق المتصفح");
        }
    }
}

// تشغيل السكربت مع إحصائيات الوقت
const startTime = Date.now();
scrapeMatches()
    .then(() => {
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        console.log(`\n⏱️ وقت التنفيذ: ${duration.toFixed(2)} ثانية`);
        console.log(`✅ اكتمل التنفيذ بنجاح في: ${new Date().toLocaleString('ar-EG')}`);
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ فشل التنفيذ:', error.message);
        process.exit(1);
    });

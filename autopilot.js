import { chromium } from 'playwright';
import fs from 'fs';
import { execSync } from 'child_process';

(async () => {
    // تشغيل المتصفح مع إعدادات تخطي الحماية
    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] 
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 1000 }
    });

    const page = await context.newPage();
    let m3u8Url = null;

    // استماع الشبكة لاصطياد روابط m3u8 فقط
    page.on('request', request => {
        const url = request.url();
        if (url.includes('.m3u8') && !url.includes('google-analytics')) {
            if (!m3u8Url) {
                console.log(`🎯 تم اصطياد رابط m3u8: ${url}`);
                m3u8Url = url;
            }
        }
    });

    const shelfUrl = 'https://www.reelshort.com/ar/shelf/%D9%85%D8%AF%D8%A8%D9%84%D8%AC-short-movies-dramas-118859';

    try {
        console.log("🔍 الدخول لصفحة الرف...");
        await page.goto(shelfUrl, { waitUntil: 'networkidle', timeout: 60000 });[cite: 2]

        const seriesLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/movie/"]'))
                               .map(a => a.href);
            return [...new Set(links)]; 
        });

        console.log(`✅ وجدنا ${seriesLinks.length} مسلسل.`);

        for (const url of seriesLinks) {
            console.log(`🎬 معالجة المسلسل: ${url}`);
            m3u8Url = null; 

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });[cite: 2]
                await page.waitForTimeout(5000); 

                // النقر على الحلقة لتوليد رابط m3u8 في الشبكة
                const clicked = await page.evaluate(() => {
                    const btn = document.querySelector('[class*="EpisodePage_tabs_box"]');
                    if (btn) { btn.click(); return true; }
                    return false;
                });

                if (clicked) {
                    console.log("🖱️ تم النقر. انتظار رابط m3u8...");
                    // انتظار الرابط لمدة تصل لـ 20 ثانية
                    for (let i = 0; i < 20; i++) {
                        if (m3u8Url) break;
                        await page.waitForTimeout(1000);
                    }
                }

                if (m3u8Url) {
                    const outputName = `episode_${Date.now()}.mp4`;
                    console.log(`📥 جاري تحويل m3u8 إلى mp4...`);
                    
                    try {
                        // استخدام FFmpeg لدمج القطع وتحويلها لملف واحد[cite: 2]
                        execSync(`ffmpeg -i "${m3u8Url}" -c copy -bsf:a aac_adtstoasc ${outputName} -y`, { stdio: 'inherit' });[cite: 2]
                        console.log(`🚀 تم التحميل والتحويل: ${outputName}`);
                        
                        // حذف الملف لتوفير مساحة[cite: 2]
                        if (fs.existsSync(outputName)) fs.unlinkSync(outputName);
                    } catch (err) {
                        console.error("❌ خطأ FFmpeg في معالجة m3u8.");
                    }
                } else {
                    console.log("⚠️ لم يتم العثور على رابط m3u8 (تأكد من أن الحلقة مجانية).");
                }

            } catch (innerError) {
                console.log(`❌ خطأ في الصفحة: ${innerError.message}`);
            }
            console.log("---");
        }
    } catch (err) {
        console.error("❌ خطأ كلي:", err.message);
    } finally {
        await browser.close();
    }
})();

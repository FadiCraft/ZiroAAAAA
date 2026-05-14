import { chromium } from 'playwright';
import fs from 'fs';
import { execSync } from 'child_process';

(async () => {
    // إعداد المتصفح لتجاوز الأنظمة الدفاعية
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

    // مراقبة الشبكة لصيد روابط m3u8 فقط
    page.on('request', request => {
        const url = request.url();
        if (url.includes('.m3u8') && !url.includes('google-analytics')) {
            if (!m3u8Url) {
                console.log(`🎯 تم العثور على رابط m3u8: ${url}`);
                m3u8Url = url;
            }
        }
    });

    const shelfUrl = 'https://www.reelshort.com/ar/shelf/%D9%85%D8%AF%D8%A8%D9%84%D8%AC-short-movies-dramas-118859';

    try {
        console.log("🔍 جاري جلب قائمة المسلسلات...");
        await page.goto(shelfUrl, { waitUntil: 'networkidle', timeout: 60000 });[cite: 2]

        const seriesData = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('a[href*="/movie/"]'));
            return items.map(a => ({
                title: a.innerText.trim() || "video",
                url: a.href
            })).filter((v, i, s) => s.findIndex(t => t.url === v.url) === i); // إزالة التكرار
        });

        console.log(`✅ تم اكتشاف ${seriesData.length} مسلسل.`);

        for (const series of seriesData) {
            console.log(`🎬 معالجة: ${series.title}`);
            m3u8Url = null; 

            try {
                await page.goto(series.url, { waitUntil: 'domcontentloaded', timeout: 60000 });[cite: 2]
                await page.waitForTimeout(5000); 

                // النقر على الحلقة الأولى لتشغيل الفيديو واستخراج الرابط
                const clicked = await page.evaluate(() => {
                    const btn = document.querySelector('[class*="EpisodePage_tabs_box"]');
                    if (btn) { btn.click(); return true; }
                    return false;
                });

                if (clicked) {
                    console.log("🖱️ تم تشغيل الحلقة، بانتظار الرابط...");
                    for (let i = 0; i < 20; i++) {
                        if (m3u8Url) break;
                        await page.waitForTimeout(1000);
                    }
                }

                if (m3u8Url) {
                    // تنظيف الاسم من الرموز غير المسموحة في الملفات
                    const safeTitle = series.title.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_');
                    const outputName = `${safeTitle}_${Date.now()}.mp4`;
                    
                    console.log(`📥 جاري التحويل بواسطة FFmpeg...`);
                    try {
                        // تحويل m3u8 إلى mp4 مع دمج القطع[cite: 2]
                        execSync(`ffmpeg -i "${m3u8Url}" -c copy -bsf:a aac_adtstoasc "${outputName}" -y`, { stdio: 'inherit' });[cite: 2]
                        console.log(`🚀 تم بنجاح! الملف جاهز: ${outputName}`);
                        
                        // تنظيف: حذف الملف بعد الرفع (اختياري)
                        // fs.unlinkSync(outputName); 
                    } catch (err) {
                        console.error("❌ فشل FFmpeg في التحويل.");
                    }
                } else {
                    console.log("⚠️ لم يتم رصد رابط m3u8.");
                }

            } catch (innerError) {
                console.log(`❌ خطأ في الصفحة: ${innerError.message}`);
            }
            console.log("-----------------------");
        }
    } catch (err) {
        console.error("❌ خطأ كلي:", err.message);
    } finally {
        await browser.close();
    }
})();

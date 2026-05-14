import { chromium } from 'playwright';
import fs from 'fs';
import { execSync } from 'child_process';

(async () => {
    // تشغيل المتصفح مع إعدادات لتجنب كشف البوت
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    // التقاط رابط m3u8 من الشبكة مباشرة
    let m3u8Url = null;
    page.on('request', request => {
        const url = request.url();
        if (url.includes('.m3u8') && !m3u8Url) {
            m3u8Url = url;
        }
    });

    const shelfUrl = 'https://www.reelshort.com/ar/shelf/%D9%85%D8%AF%D8%A8%D9%84%D8%AC-short-movies-dramas-118859';

    try {
        console.log("🔍 جاري فحص الصفحة...");
        await page.goto(shelfUrl, { waitUntil: 'networkidle' });

        const seriesLinks = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href*="/movie/"]'))
                        .map(a => 'https://www.reelshort.com' + a.getAttribute('href'))
                        .filter((value, index, self) => self.indexOf(value) === index); // إزالة التكرار
        });

        for (const url of seriesLinks.slice(0, 5)) { // تجربة أول 5 مسلسلات فقط كبداية
            console.log(`🎬 الدخول للمسلسل: ${url}`);
            await page.goto(url, { waitUntil: 'networkidle' });

            // الضغط على أول حلقة متاحة لتشغيل الفيديو وتوليد الرابط
            const playButton = await page.$('.EpisodePage_tabs_box__aoOUL');
            if (playButton) {
                await playButton.click();
                await page.waitForTimeout(7000); // وقت كافٍ لظهور رابط الـ m3u8 في الشبكة
            }

            if (m3u8Url) {
                console.log(`✅ تم العثور على الرابط من الشبكة: ${m3u8Url}`);
                const output = 'video.mp4';
                
                // تحميل الفيديو باستخدام ffmpeg
                console.log("📥 جاري التحميل...");
                execSync(`ffmpeg -i "${m3u8Url}" -c copy -bsf:a aac_adtstoasc ${output} -y`);
                
                // هنا يجب إضافة كود رفع TikTok باستخدام API أو مكتبة مخصصة
                console.log(`🚀 الفيديو جاهز للرفع: ${output}`);

                m3u8Url = null; // تصفير الرابط للحلقة القادمة
            }
        }
    } catch (err) {
        console.error("❌ خطأ:", err.message);
    } finally {
        await browser.close();
    }
})();

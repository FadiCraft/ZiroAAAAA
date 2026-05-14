import { chromium } from 'playwright';
import fs from 'fs';
import { execSync } from 'child_process';

/**
 * هذا الكود مخصص للعمل داخل GitHub Actions
 * يقوم باستخراج روابط m3u8 وتحميلها كملفات mp4
 */

(async () => {
    // تشغيل المتصفح مع إعدادات لتجنب كشف البوت
    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();
    let m3u8Url = null;

    // محرك استخراج الروابط: يراقب طلبات الشبكة بحثاً عن رابط الفيديو
    page.on('request', request => {
        const url = request.url();
        if (url.includes('.m3u8') && !m3u8Url) {
            console.log(`🎯 تم اكتشاف رابط فيديو: ${url}`);
            m3u8Url = url;
        }
    });

    const shelfUrl = 'https://www.reelshort.com/ar/shelf/%D9%85%D8%AF%D8%A8%D9%84%D8%AC-short-movies-dramas-118859';

    try {
        console.log("🔍 جاري الدخول إلى قائمة المسلسلات...");
        await page.goto(shelfUrl, { waitUntil: 'networkidle' });

        // الحصول على روابط المسلسلات الفريدة من الصفحة
        const seriesLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/movie/"]'))
                               .map(a => 'https://www.reelshort.com' + a.getAttribute('href'));
            return [...new Set(links)]; // حذف الروابط المكررة
        });

        console.log(`✅ وجدنا ${seriesLinks.length} مسلسل.`);

        for (const url of seriesLinks) {
            console.log(`🎬 معالجة: ${url}`);
            m3u8Url = null; // تصفير الرابط قبل كل محاولة جديدة

            await page.goto(url, { waitUntil: 'domcontentloaded' });
            
            // محاولة تشغيل الفيديو لتوليد رابط الـ m3u8 في الشبكة
            try {
                await page.waitForSelector('.EpisodePage_tabs_box__aoOUL', { timeout: 8000 });
                const episodes = await page.$$('.EpisodePage_tabs_box__aoOUL');
                
                if (episodes.length > 0) {
                    await episodes[0].click(); // النقر على أول حلقة متاحة
                    console.log("🖱️ تم النقر لتشغيل الحلقة...");
                    await page.waitForTimeout(10000); // انتظار كافٍ لبدء التشغيل
                }
            } catch (e) {
                console.log("⚠️ تخطي: لم يتم العثور على حلقات متاحة أو الصفحة محمية.");
                continue;
            }

            if (m3u8Url) {
                const outputName = `video_${Date.now()}.mp4`;
                console.log(`📥 جاري التحميل بواسطة FFmpeg: ${outputName}`);
                
                try {
                    // تحميل الفيديو باستخدام FFmpeg
                    execSync(`ffmpeg -i "${m3u8Url}" -c copy -bsf:a aac_adtstoasc ${outputName} -y`, { stdio: 'inherit' });
                    console.log(`🚀 تم التحميل بنجاح!`);

                    // --- أضف كود الرفع الخاص بك هنا ---

                    // تنظيف المساحة (مهم جداً في GitHub Actions)
                    if (fs.existsSync(outputName)) {
                        fs.unlinkSync(outputName);
                        console.log("🧹 تم حذف الملف المحلي بعد المعالجة.");
                    }
                } catch (err) {
                    console.error("❌ فشل تحميل الفيديو:", err.message);
                }
            }
        }
    } catch (err) {
        console.error("❌ خطأ عام:", err.message);
    } finally {
        await browser.close();
    }
})();

import { chromium } from 'playwright';
import fs from 'fs';
import { execSync } from 'child_process';

(async () => {
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

    // مراقبة الشبكة لالتقاط الفيديو
    page.on('request', request => {
        const url = request.url();
        if ((url.includes('.m3u8') || url.includes('.mp4')) && !m3u8Url) {
            console.log(`🎯 تم صيد الرابط: ${url}`);
            m3u8Url = url;
        }
    });

    const shelfUrl = 'https://www.reelshort.com/ar/shelf/%D9%85%D8%AF%D8%A8%D9%84%D8%AC-short-movies-dramas-118859';

    try {
        console.log("🔍 فتح صفحة الرف...");
        await page.goto(shelfUrl, { waitUntil: 'networkidle' });
        await page.mouse.wheel(0, 2000); // تمرير لتحميل الصور والروابط
        await page.waitForTimeout(2000);

        const seriesLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/movie/"]'))
                               .map(a => a.href);
            return [...new Set(links)]; 
        });

        console.log(`✅ وجدنا ${seriesLinks.length} مسلسل.`);

        for (const url of seriesLinks) {
            console.log(`🎬 معالجة: ${url}`);
            m3u8Url = null; 

            try {
                await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
                
                // التمرير للأسفل قليلاً لضمان ظهور قائمة الحلقات
                await page.mouse.wheel(0, 500);
                await page.waitForTimeout(3000);

                // البحث عن أي حلقة للضغط عليها (استراتيجية مرنة)
                const episodeFound = await page.evaluate(() => {
                    // البحث عن عناصر تحتوي على رقم الحلقة أو تبدو كأزرار حلقات
                    const elements = Array.from(document.querySelectorAll('div, li, span, button'));
                    const episodeBtn = elements.find(el => 
                        (el.innerText && /الحلقة\s*1|Episode\s*1|1/.test(el.innerText)) && 
                        el.offsetWidth > 0 && el.offsetHeight > 0
                    );
                    if (episodeBtn) {
                        episodeBtn.click();
                        return true;
                    }
                    return false;
                });

                if (episodeFound) {
                    console.log("🖱️ تم النقر على الحلقة، بانتظار الرابط...");
                    await page.waitForTimeout(12000); 
                } else {
                    // محاولة النقر على أي عنصر يحمل كلاس مشابه لما وجدناه سابقاً
                    const backupBtn = await page.$('[class*="EpisodePage_tabs_box"]');
                    if (backupBtn) {
                        await backupBtn.click();
                        await page.waitForTimeout(10000);
                    }
                }

                if (m3u8Url) {
                    const outputName = `video_${Date.now()}.mp4`;
                    console.log(`📥 تحميل...`);
                    execSync(`ffmpeg -i "${m3u8Url}" -c copy -bsf:a aac_adtstoasc ${outputName} -y`, { stdio: 'ignore' });
                    console.log(`🚀 جاهز: ${outputName}`);
                    if (fs.existsSync(outputName)) fs.unlinkSync(outputName);
                } else {
                    console.log("⚠️ فشل استخراج الرابط (ربما الحلقة مغلقة أو محمية).");
                }

            } catch (innerError) {
                console.log(`❌ خطأ في هذه الصفحة: ${innerError.message}`);
            }
            console.log("---");
        }
    } catch (err) {
        console.error("❌ خطأ كلي:", err.message);
    } finally {
        await browser.close();
    }
})();

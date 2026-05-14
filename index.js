const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  // تشغيل المتصفح في وضع الخفاء
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // الرابط الذي وضعته كمثال
  const targetUrl = 'https://www.reelshort.com/ar/episodes/episode-1-%D8%AE%D9%8A%D8%A7%D9%86%D8%A9-%D8%A7%D9%84%D8%B9%D8%B1%D9%88%D8%B3-%D8%A8%D9%8A%D9%86-%D8%A7%D9%84%D8%B3%D9%85-%D9%88%D8%A7%D9%84%D9%81%D8%AE-6976d3d973079f59c401f6b1-fmt59elc6t?play_time=1';

  try {
    console.log("جارٍ فتح الموقع...");
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    // الانتظار قليلاً لضمان تحميل قائمة الجودات (options)
    await page.waitForTimeout(5000);

    // البحث عن الرابط داخل هيكل li كما وصفت تماماً
    const videoUrl = await page.evaluate(() => {
      const item = document.querySelector('li.option-item[url*=".m3u8"]');
      return item ? item.getAttribute('url') : null;
    });

    if (videoUrl) {
      console.log("تم العثور على الرابط: " + videoUrl);
      fs.writeFileSync('video_url.txt', videoUrl);
    } else {
      console.error("لم يتم العثور على رابط m3u8. قد يكون الموقع يحتاج لتفاعل بشري أو الرمز مختلف.");
      process.exit(1);
    }
  } catch (error) {
    console.error("حدث خطأ أثناء الاستخراج: ", error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

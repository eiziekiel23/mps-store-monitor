import { test, expect } from '../base.js';

test.describe('How-To-Enter Video', () => {
  test('video.how_to_enter: homepage video loads and plays', {
    annotation: { type: 'check', description: 'video.how_to_enter' }
  }, async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // The theme renders <video class="mps-video" id="mps-video-<section>">.
    // Its <source> is lazy-loaded by an IntersectionObserver, so nothing is
    // fetched until the element is scrolled into the viewport.
    const video = page.locator('video.mps-video').first();
    await expect(video, 'How-to-enter video element not found').toBeAttached();

    // Scroll it into view to trip the IntersectionObserver (threshold 0.25),
    // which copies data-src -> src and calls video.load().
    await video.scrollIntoViewIfNeeded();

    const handle = await video.elementHandle();

    // Wait for the source to resolve and the media to have enough data to play.
    // readyState >= 2 (HAVE_CURRENT_DATA) means at least the current frame is decoded.
    await expect
      .poll(async () => handle.evaluate((v) => v.readyState), {
        message: 'Video never reached HAVE_CURRENT_DATA (source failed to load?)',
        timeout: 20_000
      })
      .toBeGreaterThanOrEqual(2);

    // Mute and play programmatically: headless Chromium blocks unmuted autoplay,
    // and the theme otherwise only plays on a user click.
    await handle.evaluate(async (v) => {
      v.muted = true;
      try { await v.play(); } catch { /* play() may reject; currentTime poll is the real check */ }
    });

    // The real proof of playback: currentTime advances past zero.
    await expect
      .poll(async () => handle.evaluate((v) => v.currentTime), {
        message: 'Video currentTime did not advance — playback never started',
        timeout: 15_000
      })
      .toBeGreaterThan(0);
  });
});

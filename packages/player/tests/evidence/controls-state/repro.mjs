import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const root = process.cwd();
const require = createRequire(resolve(root, 'packages/player/package.json'));
const puppeteer = require('puppeteer-core');
const phase = process.argv[2] ?? 'before';
const scenario = process.argv[3] ?? 'playing';
const browser = await puppeteer.launch({
  executablePath: '/snap/bin/chromium', headless: true,
  args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage'],
  defaultViewport: {width: 1000, height: 700, deviceScaleFactor: 1}
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Player controls state</title>
<style>html{color-scheme:dark;background:#171719;color:#eee;font:18px system-ui}body{margin:48px auto;width:800px}h1{font-size:28px;margin-bottom:8px}p{margin:0 0 28px}hyperframes-player{display:block;width:800px;height:450px}output{display:block;margin-top:20px;font:16px ui-monospace,monospace}</style>
<h1>Show controls during playback</h1><p>Muted video, playback at 2x, seek to 3 seconds, then show controls.</p><output id="state"></output></html>`);
  await page.addScriptTag({path: resolve(root,'packages/player/dist/hyperframes-player.global.js')});
  const video = await readFile(resolve(root, 'packages/player/tests/perf/fixtures/10-video-grid/sample.mp4'));
  await page.evaluate(src => {
    const player = document.createElement('hyperframes-player');
    player.id = 'player';
    player.setAttribute('type','video/mp4');
    player.setAttribute('muted','');
    player.setAttribute('src',src);
    document.body.insertBefore(player, document.querySelector('output'));
  }, `data:video/mp4;base64,${video.toString('base64')}`);
  await page.waitForFunction(() => document.getElementById('player').ready);
  const result = await page.evaluate(async scenario => {
    const player = document.getElementById('player');
    player.playbackRate = 2;
    player.seek(3);
    const video = player.shadowRoot.querySelector('video');
    if (video.seeking) await new Promise(resolve => video.addEventListener('seeked', resolve, {once:true}));
    player.play();
    await new Promise(resolve => video.addEventListener('playing',resolve,{once:true}));
    if (scenario === 'paused') player.pause();
    player.setAttribute('controls','');
    const state = {
      paused:player.paused,
      playbackRate:player.playbackRate,
      currentTime:player.currentTime,
      duration:player.duration,
      button:player.shadowRoot.querySelector('.hfp-play-btn').getAttribute('aria-label'),
      speed:player.shadowRoot.querySelector('.hfp-speed-btn').textContent,
      time:player.shadowRoot.querySelector('.hfp-time').textContent
    };
    document.getElementById('state').textContent = `player.paused = ${state.paused}; player.playbackRate = ${state.playbackRate}`;
    return state;
  }, scenario);
  await page.screenshot({path:`/tmp/hyperframes-player-recovery/${phase}-${scenario}.png`});
  const afterClick = await page.evaluate(() => {
    const player = document.getElementById('player');
    player.shadowRoot.querySelector('.hfp-play-btn').click();
    const state = {paused:player.paused};
    player.pause();
    return state;
  });
  const output = {phase,scenario,browser:await browser.version(),beforeClick:result,afterClick,errors};
  await writeFile(`/tmp/hyperframes-player-recovery/${phase}-${scenario}.json`,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify(output,null,2));
} finally { await browser.close(); }

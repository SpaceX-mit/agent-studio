const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');

async function main() {
  const dist = path.resolve(__dirname, '../dist');
  const artifacts = path.resolve(__dirname, '../../.project-cache/ui-checks');
  fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((req, res) => {
    const filename = path.resolve(dist, '.' + (req.url === '/' ? '/index.html' : req.url));
    if (!filename.startsWith(dist + path.sep) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(filename).pipe(res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const titles = [
        '优化聊天排版与会话列表',
        '检查本地 Codex 的编译状态',
        '插件和技能管理',
        '这是一条很长的会话标题，用来检查文字截断后不会挤压侧栏或者改变行高',
        'Agent Studio UI review',
      ];
      if (!localStorage.getItem('codex-desktop-state-v1')) localStorage.setItem('codex-desktop-state-v1', JSON.stringify({
        theme: 'light', model: 'test-model', activeThreadId: 'thread-0', activeProjectId: 'project',
        projects: [{ id: 'project', name: 'my-agent-plantform', environment: 'local', git: { isRepository: true, branch: 'main' } }], automations: [],
        threads: Array.from({ length: 48 }, (_, index) => ({
          id: `thread-${index}`, title: titles[index] || `工作区检查 ${index + 1}`, pinned: index === 2,
          archived: false, status: 'completed', updatedAt: new Date().toISOString(),
          messages: [{ id: `message-${index}`, role: 'assistant', content: '检查完成。', createdAt: new Date().toISOString() }],
        })).reverse(),
      }));
      window.desktop = { getProjectRoot: async () => localStorage.getItem('test-working-directory') || 'D:\\Workspace2026\\my-agent-plantform', providerStatus: async () => ({ keyConfigured: true }), listModels: async () => ({ ok: true, models: ['test-model'] }) };
      window.__requests = [];
      window.codex = {
        connect: async () => ({ ok: true }), notify: async () => {},
        request: async (method, params) => {
          window.__requests.push({ method, params });
          if (method === 'thread/start') return { ok: true, result: { thread: { id: 'test-remote' } } };
          if (method === 'turn/start') {
            queueMicrotask(() => window.__notify({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: 'test-turn', status: 'completed' } } }));
            return { ok: true, result: { turn: { id: 'test-turn' } } };
          }
          return { ok: true, result: { data: [] } };
        },
        onNotification: fn => { window.__notify = fn; return () => {}; }, onServerRequest: () => () => {},
        onError: () => () => {}, onStderr: () => () => {}, onClosed: () => () => {},
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const rows = page.locator('.sidebar .recent');
    const selected = page.locator('.sidebar .recent[aria-current="page"]');
    const background = locator => locator.evaluate(element => getComputedStyle(element).backgroundColor);
    const back = page.getByRole('button', { name: '后退', exact: true });
    const forward = page.getByRole('button', { name: '前进', exact: true });
    assert.equal(await page.locator('.sidebar .brand').innerText(), 'Code');
    assert.equal(await page.getByRole('button', { name: 'Pull Request', exact: true }).count(), 0);
    const modeTrigger = page.getByRole('button', { name: '切换模式', exact: true });
    await modeTrigger.click();
    assert.equal(await page.getByRole('menuitemradio', { name: 'Code', exact: true }).getAttribute('aria-checked'), 'true');
    assert.equal(await page.getByRole('menuitemradio', { name: '工作', exact: true }).locator('small').innerText(), '创建、学习和探索');
    assert.equal(await page.getByRole('menuitemradio', { name: 'Code', exact: true }).locator('small').innerText(), '构建、调试和发布');
    for (const item of await page.locator('.mode-menu button').all()) {
      assert.equal(await item.evaluate(element => element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth), false);
    }
    await page.screenshot({ path: path.join(artifacts, 'mode-menu.png') });
    await page.getByRole('menuitemradio', { name: '工作', exact: true }).click();
    assert.equal(await modeTrigger.innerText(), '工作');
    assert.equal(await page.locator('#sidebar-projects').isVisible(), true);
    assert.equal(await page.locator('.sidebar-project').isVisible(), true);
    assert.deepEqual(await page.locator('.sidebar-nav').allTextContents(), ['新对话', '已安排', '插件']);
    assert.equal(await rows.count(), 48);
    await page.screenshot({ path: path.join(artifacts, 'work-sidebar.png') });
    await page.reload();
    assert.equal(await modeTrigger.innerText(), '工作');
    assert.equal(await page.locator('#sidebar-projects').isVisible(), true);
    assert.equal(await page.locator('.sidebar-project').isVisible(), true);
    await modeTrigger.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.equal(await modeTrigger.innerText(), 'Code');
    assert.equal(await page.locator('#sidebar-projects').count(), 1);
    await modeTrigger.click();
    await page.keyboard.press('Escape');
    assert.equal(await modeTrigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await modeTrigger.evaluate(element => document.activeElement === element), true);
    await modeTrigger.click();
    await page.locator('.desktop-titlebar').click({ position: { x: 700, y: 15 } });
    assert.equal(await page.getByRole('menu', { name: '模式', exact: true }).count(), 0);
    assert.equal(await page.locator('.desktop-titlebar').getByText('Codex', { exact: true }).count(), 0);
    assert.equal(await back.isDisabled(), true);
    assert.equal(await forward.isDisabled(), true);
    await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
    assert.equal(await page.locator('.sidebar').isVisible(), false);
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
    assert.equal(await page.locator('.sidebar').isVisible(), true);
    assert.equal(await rows.count(), 48);
    assert.equal(await selected.innerText(), '优化聊天排版与会话列表');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const longRow = rows.nth(3);
    await longRow.hover();
    await page.waitForFunction(() => document.querySelectorAll('.recent')[3]?.dataset.overflow === 'true');
    const scrollMotion = await longRow.evaluate(button => {
      const viewport = button.querySelector('.thread-title-viewport');
      const text = button.querySelector('.thread-title-text');
      const animation = text.getAnimations()[0];
      if (!animation) return null;
      animation.pause();
      animation.currentTime = 0;
      const start = text.getBoundingClientRect().left;
      animation.currentTime = Number(animation.effect.getTiming().duration) + 600;
      const end = text.getBoundingClientRect();
      return { moved: end.left < start, endVisible: end.right <= viewport.getBoundingClientRect().right + 1, height: button.getBoundingClientRect().height };
    });
    assert.deepEqual(scrollMotion, { moved: true, endVisible: true, height: 28 });
    await page.screenshot({ path: path.join(artifacts, 'thread-title-scrolling.png') });
    await page.mouse.move(800, 400);
    assert.equal(await longRow.locator('.thread-title-text').evaluate(element => getComputedStyle(element).transform), 'none');
    await rows.first().hover();
    assert.equal(await rows.first().locator('.thread-title-text').evaluate(element => getComputedStyle(element).animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await longRow.hover();
    assert.equal(await longRow.locator('.thread-title-text').evaluate(element => getComputedStyle(element).animationName), 'none');
    await page.mouse.move(800, 400);
    assert.equal(await background(selected), 'rgb(230, 231, 232)');
    await rows.nth(1).hover();
    assert.equal(await background(rows.nth(1)), 'rgb(238, 238, 239)');
    assert.equal(await background(selected), 'rgb(230, 231, 232)');
    await page.screenshot({ path: path.join(artifacts, 'sidebar-desktop.png') });
    await rows.nth(1).click();
    assert.equal(await selected.count(), 1);
    assert.equal(await background(selected), 'rgb(223, 224, 225)');
    await page.mouse.move(800, 400);
    assert.equal(await background(selected), 'rgb(230, 231, 232)');
    assert.equal(await background(rows.first()), 'rgba(0, 0, 0, 0)');
    await back.click();
    assert.equal(await selected.innerText(), '优化聊天排版与会话列表');
    await forward.click();
    assert.equal(await selected.innerText(), '检查本地 Codex 的编译状态');
    await back.click();
    await rows.nth(2).click();
    assert.equal(await forward.isDisabled(), true, 'A new visit clears forward history');
    await back.click();
    assert.equal(await selected.innerText(), '优化聊天排版与会话列表');
    await forward.click();
    assert.equal(await selected.innerText(), '插件和技能管理');
    await rows.nth(1).click();
    await page.reload();
    assert.equal(await selected.innerText(), '检查本地 Codex 的编译状态');
    await rows.first().focus();
    await page.keyboard.press('Enter');
    assert.equal(await selected.innerText(), '优化聊天排版与会话列表');
    assert.equal(await selected.evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    const search = page.getByRole('textbox', { name: '搜索最近会话' });
    await search.fill('不存在的标题');
    assert.equal(await rows.count(), 0);
    await page.getByText('没有匹配的会话', { exact: true }).waitFor();
    await search.fill('编译');
    assert.equal(await rows.count(), 1);
    await search.press('Escape');
    assert.equal(await rows.count(), 48);
    await page.getByRole('button', { name: '已安排', exact: true }).click();
    assert.equal(await selected.count(), 0);
    await back.click();
    assert.equal(await selected.innerText(), '优化聊天排版与会话列表');
    await forward.click();
    assert.equal(await page.getByRole('button', { name: '已安排', exact: true }).getAttribute('aria-current'), 'page');
    await page.getByRole('button', { name: '新对话', exact: true }).click();
    assert.equal(await selected.innerText(), '新对话');
    assert.equal(await page.locator('.sidebar-nav[aria-current="page"]').count(), 0);
    assert.equal(await page.locator('.global-thread-toolbar').count(), 0, 'Empty chats do not need a thread toolbar');
    assert.match(await page.locator('.welcome h1').innerText(), /my-agent-plantform/);
    assert.equal(await page.locator('.sidebar-project').innerText(), 'my-agent-plantform');
    assert.equal(await page.locator('.project-strip .project').innerText(), 'my-agent-plantform');
    assert.equal(await page.locator('.welcome h1 span').getAttribute('title'), 'D:\\Workspace2026\\my-agent-plantform');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('codex-desktop-state-v1')).activeProjectId), 'project', 'Display rename must preserve project identity');
    assert.equal(await page.locator('.suggestion-icon').count(), 4);
    assert.equal(await page.locator('.project-branch').innerText(), 'main');
    const messageInput = page.getByRole('textbox', { name: '消息', exact: true });
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '探索并理解代码', exact: true }).click();
    assert.equal(await messageInput.inputValue(), '探索并理解代码');
    assert.equal(await messageInput.evaluate(element => element === document.activeElement), true);
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isEnabled(), true);
    await messageInput.fill('');
    await page.getByRole('button', { name: '选择模型', exact: true }).click();
    const menuBounds = await page.locator('.model-catalog').boundingBox();
    const composerBounds = await page.locator('.composer').boundingBox();
    assert.ok(menuBounds.y + menuBounds.height <= composerBounds.y + composerBounds.height);
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('.welcome-mark').hover();
    const motion = await page.locator('.welcome-badge').evaluate(element => {
      const animation = element.getAnimations()[0];
      if (!animation) return false;
      animation.pause();
      animation.currentTime = 0;
      const start = getComputedStyle(element).transform;
      animation.currentTime = 280;
      return getComputedStyle(element).transform !== start;
    });
    assert.ok(motion, 'Welcome icon changes transform during hover animation');
    await page.screenshot({ path: path.join(artifacts, 'welcome-motion.png') });
    for (const color of ['explore', 'build', 'review', 'fix']) {
      const icon = page.locator(`.suggestion-icon.${color}`);
      await icon.hover();
      assert.notEqual(await icon.evaluate(element => getComputedStyle(element).animationName), 'none');
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.welcome-mark').hover();
    assert.equal(await page.locator('.welcome-badge').evaluate(element => getComputedStyle(element).animationName), 'none');
    await page.locator('.suggestion-icon.review').hover();
    assert.equal(await page.locator('.suggestion-icon.review').evaluate(element => getComputedStyle(element).animationName), 'none');
    await page.mouse.move(0, 0);
    await rows.first().click();
    for (const viewport of [{ width: 1280, height: 820 }, { width: 960, height: 640 }, { width: 600, height: 720 }]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => {
        const sidebar = document.querySelector('.sidebar');
        const scroll = document.querySelector('.sidebar-scroll');
        const rows = [...document.querySelectorAll('.sidebar .recent')];
        const navTop = document.querySelector('.sidebar-nav').getBoundingClientRect().top;
        scroll.scrollTop = scroll.scrollHeight;
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          sidebarOverflow: sidebar.scrollHeight > sidebar.clientHeight,
          scrolled: scroll.scrollTop > 0,
          stableNavigation: navTop === document.querySelector('.sidebar-nav').getBoundingClientRect().top,
          rowHeights: rows.every(row => row.getBoundingClientRect().height === 28),
          rowFits: rows.every(row => row.scrollWidth === row.clientWidth),
        };
      });
      assert.deepEqual(layout, { overflow: false, sidebarOverflow: false, scrolled: true, stableNavigation: true, rowHeights: true, rowFits: true });
      const welcomeLayout = await page.evaluate(() => {
        const welcome = document.querySelector('.welcome').getBoundingClientRect();
        const dock = document.querySelector('.composer-dock').getBoundingClientRect();
        const strip = document.querySelector('.project-strip').getBoundingClientRect();
        const composer = document.querySelector('.composer').getBoundingClientRect();
        const main = document.querySelector('main').getBoundingClientRect();
        const footer = document.querySelector('.composer-footer');
        return {
          noOverlap: welcome.bottom <= dock.top + 1 && strip.bottom <= composer.top + 1,
          bottomAnchored: Math.abs(main.bottom - dock.bottom - 8) < 1,
          footerFits: footer.scrollWidth <= footer.clientWidth,
          cardFits: [...document.querySelectorAll('.cards button')].every(button => button.scrollHeight <= button.clientHeight && button.scrollWidth <= button.clientWidth),
        };
      });
      assert.deepEqual(welcomeLayout, { noOverlap: true, bottomAnchored: true, footerFits: true, cardFits: true });
      await page.locator('.sidebar-scroll').evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: path.join(artifacts, `sidebar-${viewport.width}.png`) });
    }
    await page.setViewportSize({ width: 960, height: 480 });
    await page.getByRole('button', { name: '添加附件', exact: true }).click();
    const shortLayout = await page.evaluate(() => {
      const welcome = document.querySelector('.welcome');
      const composer = document.querySelector('.composer').getBoundingClientRect();
      return welcome.scrollHeight > welcome.clientHeight && welcome.getBoundingClientRect().bottom <= composer.top && composer.bottom <= innerHeight;
    });
    assert.ok(shortLayout, 'Short windows scroll the welcome section without hiding the composer');
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('codex-desktop-state-v1'));
      state.theme = 'dark';
      localStorage.setItem('codex-desktop-state-v1', JSON.stringify(state));
    });
    await page.reload();
    await page.setViewportSize({ width: 1280, height: 820 });
    assert.equal(await background(selected), 'rgb(61, 64, 67)');
    await rows.nth(1).hover();
    assert.equal(await background(rows.nth(1)), 'rgb(50, 52, 54)');
    await page.screenshot({ path: path.join(artifacts, 'sidebar-dark.png') });
    for (const [directory, name] of [['D:\\Workspace2026\\another-workspace\\', 'another-workspace'], ['/workspace/another-project/', 'another-project']]) {
      await page.evaluate(directory => localStorage.setItem('test-working-directory', directory), directory);
      await page.reload();
      await page.waitForFunction(name => document.querySelector('.welcome h1 span')?.textContent === name, name);
      assert.equal(await page.locator('.project-strip .project').innerText(), name, 'Actual working directory overrides saved display name');
      assert.equal(await page.locator('.sidebar .brand').innerText(), 'Code', 'Mode label stays separate from working directory');
    }
    const firstPrompt = '检查当前工作目录中的配置文件，分析编译失败原因，并给出完整的修复步骤和验证结果';
    const turnsBeforeEnter = await page.evaluate(() => window.__requests.filter(request => request.method === 'turn/start').length);
    await messageInput.fill('   ');
    await messageInput.press('Enter');
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
    await messageInput.fill('中文输入');
    await messageInput.dispatchEvent('compositionstart');
    await messageInput.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
    await messageInput.dispatchEvent('compositionend');
    await messageInput.press('Shift+Enter');
    assert.equal(await messageInput.inputValue(), '中文输入\n', 'Shift+Enter inserts a newline');
    assert.equal(await page.evaluate(() => window.__requests.filter(request => request.method === 'turn/start').length), turnsBeforeEnter, 'Blank input and IME confirmation never send');
    await messageInput.fill(firstPrompt);
    await messageInput.press('Enter');
    await page.waitForFunction(title => document.querySelector('.recent[aria-current="page"]')?.getAttribute('aria-label') === title, firstPrompt);
    await page.waitForFunction(() => window.__requests.some(request => request.method === 'thread/name/set'));
    assert.equal(await page.evaluate(() => window.__requests.filter(request => request.method === 'turn/start').length), turnsBeforeEnter + 1, 'Enter sends exactly one turn');
    assert.equal(await page.evaluate(() => window.__requests.find(request => request.method === 'thread/name/set').params.name), firstPrompt);
    page.once('dialog', dialog => dialog.accept('新对话'));
    await page.getByRole('button', { name: '重命名', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.recent[aria-current="page"]')?.getAttribute('aria-label') === '新对话');
    await messageInput.fill('继续检查');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    assert.equal(await selected.innerText(), '新对话', 'An explicitly renamed placeholder is not automatically replaced');
    await page.reload();
    assert.equal(await selected.innerText(), '新对话');
    await modeTrigger.click();
    await page.getByRole('menuitemradio', { name: '工作', exact: true }).click();
    await page.locator('.sidebar-nav').filter({ hasText: '新对话' }).click();
    await page.getByRole('heading', { name: '我们要做什么？', exact: true }).waitFor();
    assert.equal(await messageInput.inputValue(), '');
    assert.equal(await page.locator('.welcome-mark, .cards').count(), 0);
    assert.equal(await page.locator('.attachment-list').count(), 0, 'New chats do not inherit another chat’s attachments');
    const workDraft = '帮我整理本周的工作进展，并列出下周需要跟进的事项。';
    await messageInput.fill(workDraft);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.querySelector('.desktop-app').classList.toggle('dark', theme === 'dark'), theme);
      for (const viewport of [{ width: 1280, height: 820 }, { width: 960, height: 640 }, { width: 600, height: 720 }]) {
        await page.setViewportSize(viewport);
        const geometry = await page.evaluate(() => {
          const main = document.querySelector('main').getBoundingClientRect();
          const heading = document.querySelector('.work-welcome-heading').getBoundingClientRect();
          const composer = document.querySelector('.composer').getBoundingClientRect();
          const strip = document.querySelector('.project-strip').getBoundingClientRect();
          const footer = document.querySelector('.composer-footer');
          return { ordered: heading.bottom < composer.top && Math.abs(composer.bottom - strip.top) < 1, contained: strip.bottom <= main.bottom && heading.top >= main.top, fits: footer.scrollWidth <= footer.clientWidth && document.documentElement.scrollWidth <= innerWidth };
        });
        assert.deepEqual(geometry, { ordered: true, contained: true, fits: true });
        await page.screenshot({ path: path.join(artifacts, `work-new-chat-${theme}-${viewport.width}.png`) });
      }
    }
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.locator('.work-plugins').click();
    await page.getByRole('button', { name: '连接插件', exact: true }).click();
    await page.getByRole('menuitem', { name: '浏览所有插件', exact: true }).click();
    await page.locator('.extensions').waitFor();
    await back.click();
    await page.getByRole('heading', { name: '我们要做什么？', exact: true }).waitFor();
    assert.equal(await messageInput.inputValue(), workDraft, 'Plugin navigation preserves the draft');
    await messageInput.press('Enter');
    await page.locator('.thread-view .message.user').getByText(workDraft, { exact: true }).waitFor();
    assert.equal(await page.locator('.work-welcome-heading').count(), 0);
    assert.ok(await page.locator('.thread-view').evaluate(element => getComputedStyle(element).overflowY === 'auto'));
    await page.locator('.sidebar-nav').filter({ hasText: '新对话' }).click();
    await modeTrigger.click();
    await page.getByRole('menuitemradio', { name: 'Code', exact: true }).click();
    await page.locator('.welcome-mark').waitFor();
    assert.equal(await page.locator('.cards button').count(), 4);
    assert.equal(await page.locator('.work-welcome-heading').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: Code/Work mode menu, persistence, keyboard dismissal, removed Pull Request, history navigation, sidebar toggle, selected/hover colors, search, new chat, scrolling and narrow/dark layouts.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

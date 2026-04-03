/**
 * 計時器元件 — 自建 SPA 版（狀態機架構）
 *
 * 用 data-duration 控制秒數，支援三種模式：
 * - 15 秒：大圓環進度條，平滑消失（不顯示秒數）
 * - 30 秒：圓環 + 呼吸脈動效果
 * - 120 秒：分:秒格式，最後 30 秒環形變磚紅
 *
 * 狀態機：
 * - navigation 狀態：空白鍵啟動計時器
 * - timer-active 狀態：空白鍵暫停/繼續，Escape 退出
 *
 * 不依賴 Reveal.js，透過 window.setKeyboardState() 與主控制器溝通
 */
class PresentationTimer {
  constructor() {
    /** @type {HTMLElement|null} 目前啟動的計時器頁面 */
    this.activePage = null;
    /** @type {number|null} requestAnimationFrame ID */
    this.animationId = null;
    /** @type {boolean} 是否正在計時中 */
    this.running = false;
    /** @type {boolean} 是否暫停 */
    this.paused = false;
    /** @type {number} 暫停時已累計的時間（ms） */
    this.pausedElapsed = 0;
    /** @type {number} 本次開始/繼續的時間戳 */
    this.segmentStart = 0;
    /** @type {number} 總時長（ms） */
    this.totalMs = 0;
    /** @type {Set<HTMLElement>} 已完成的計時器集合，防止重複啟動 */
    this.completedTimers = new Set();
    /** @type {number} 用於生成唯一 SVG gradient ID 的計數器 */
    this._gradientCounter = 0;
  }

  /**
   * 初始化所有計時器 UI
   * 在 DOM 建構完成後呼叫
   */
  init() {
    const timerContainers = document.querySelectorAll('.timer-container[data-duration]');
    timerContainers.forEach(container => {
      const duration = parseInt(container.getAttribute('data-duration'), 10);
      this._buildTimerUI(container, duration);
    });
  }

  /**
   * 從頁面啟動計時器（由主控制器的鍵盤事件呼叫）
   * @param {HTMLElement} pageEl - 頁面元素
   * @param {number} duration - 秒數
   */
  startFromPage(pageEl, duration) {
    if (this.running) return;
    if (this.completedTimers.has(pageEl)) return;

    const container = pageEl.querySelector('.timer-container');
    if (!container) return;

    this._start(pageEl, container, duration);
  }

  /**
   * 暫停 / 繼續 toggle
   */
  togglePause() {
    if (!this.running) return;

    if (this.paused) {
      // 繼續：記錄新的 segment 起點
      this.paused = false;
      this.segmentStart = performance.now();
      // 移除暫停指示
      this._removePausedIndicator();
      // 繼續動畫
      this.animationId = requestAnimationFrame(this._animate.bind(this));
    } else {
      // 暫停：累計已跑時間
      this.paused = true;
      this.pausedElapsed += performance.now() - this.segmentStart;
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
      // 顯示暫停指示
      this._showPausedIndicator();
    }
  }

  /**
   * 中斷計時器（Escape 鍵）
   */
  abort() {
    if (!this.running) return;
    this._cleanup();
    // 恢復「按空白鍵開始」提示
    if (this._container) {
      const hint = this._container.querySelector('.timer-hint');
      if (hint) hint.style.display = '';
    }
    window.setKeyboardState('navigation');
  }

  /**
   * 建構計時器 UI
   * @param {HTMLElement} container - .timer-container 元素
   * @param {number} duration - 秒數
   */
  _buildTimerUI(container, duration) {
    // 每個計時器用唯一 gradient ID
    const gradId = `ring-grad-${this._gradientCounter++}`;
    const circumference = 2 * Math.PI * 90;

    if (duration <= 30) {
      // 圓環模式（15 秒或 30 秒）
      container.innerHTML = `
        <div class="timer-ring-wrapper">
          <svg class="timer-ring" viewBox="0 0 200 200">
            <defs>
              <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#D4956A"/>
                <stop offset="100%" stop-color="#C8553D"/>
              </linearGradient>
            </defs>
            <circle class="timer-ring-bg" cx="100" cy="100" r="90"
              fill="none" stroke="#5C4033" stroke-width="4" opacity="0.15"/>
            <circle class="timer-ring-progress" cx="100" cy="100" r="90"
              fill="none" stroke="url(#${gradId})" stroke-width="6"
              stroke-linecap="round"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="0"
              transform="rotate(-90 100 100)"/>
          </svg>
        </div>`;
    } else {
      // 數字模式（120 秒）
      const mins = Math.floor(duration / 60);
      const secs = duration % 60;
      container.innerHTML = `
        <div class="timer-digital-wrapper">
          <svg class="timer-ring timer-ring-large" viewBox="0 0 200 200">
            <defs>
              <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#D4956A"/>
                <stop offset="100%" stop-color="#C8553D"/>
              </linearGradient>
            </defs>
            <circle class="timer-ring-bg" cx="100" cy="100" r="90"
              fill="none" stroke="#5C4033" stroke-width="4" opacity="0.15"/>
            <circle class="timer-ring-progress" cx="100" cy="100" r="90"
              fill="none" stroke="url(#${gradId})" stroke-width="6"
              stroke-linecap="round"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="0"
              transform="rotate(-90 100 100)"/>
          </svg>
          <div class="timer-digital">${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}</div>
        </div>`;
    }
  }

  /**
   * 啟動計時器
   * @param {HTMLElement} pageEl - 頁面元素
   * @param {HTMLElement} container - .timer-container 元素
   * @param {number} duration - 秒數
   */
  _start(pageEl, container, duration) {
    this.running = true;
    this.paused = false;
    this.pausedElapsed = 0;
    this.activePage = pageEl;
    this.totalMs = duration * 1000;

    // 切換鍵盤狀態
    window.setKeyboardState('timer-active');

    // 隱藏 hint
    const hint = pageEl.querySelector('.timer-hint');
    if (hint) hint.style.display = 'none';

    // 快取 DOM 元素供動畫使用
    this._ring = container.querySelector('.timer-ring-progress');
    this._circumference = 2 * Math.PI * 90;
    this._digital = container.querySelector('.timer-digital');
    this._wrapper = container.querySelector('.timer-ring-wrapper, .timer-digital-wrapper');
    this._duration = duration;
    this._container = container;

    // 30 秒計時器加呼吸脈動
    if (duration === 30 && this._wrapper) {
      this._wrapper.classList.add('breathing-timer');
    }

    // 記錄起始時間
    this.segmentStart = performance.now();

    // 啟動動畫
    this.animationId = requestAnimationFrame(this._animate.bind(this));
  }

  /**
   * 動畫迴圈
   * @param {number} now - performance.now() 時間戳
   */
  _animate(now) {
    const elapsed = this.pausedElapsed + (now - this.segmentStart);
    const progress = Math.min(elapsed / this.totalMs, 1);

    // 更新圓環
    if (this._ring) {
      this._ring.setAttribute('stroke-dashoffset', String(this._circumference * progress));
    }

    // 更新數字顯示（120 秒模式）
    if (this._digital) {
      const remaining = Math.max(0, Math.ceil((this.totalMs - elapsed) / 1000));
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      this._digital.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      // 最後 30 秒變磚紅
      if (remaining <= 30 && this._ring) {
        this._ring.setAttribute('stroke', '#C8553D');
      }
    }

    if (progress < 1) {
      this.animationId = requestAnimationFrame(this._animate.bind(this));
    } else {
      this._onComplete();
    }
  }

  /**
   * 計時結束
   */
  _onComplete() {
    // 移除呼吸效果
    if (this._wrapper) {
      this._wrapper.classList.remove('breathing-timer');
      this._wrapper.classList.add('timer-fade-out');
    }

    // 標記已完成
    this.completedTimers.add(this.activePage);

    // 隱藏 hint
    const hint = this.activePage.querySelector('.timer-hint');
    if (hint) {
      hint.textContent = '';
      hint.style.display = 'none';
    }

    // 延遲恢復導航狀態
    setTimeout(() => {
      this.running = false;
      this.paused = false;
      this.activePage = null;
      window.setKeyboardState('navigation');
    }, 800);
  }

  /**
   * 清理計時器狀態
   */
  _cleanup() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this._removePausedIndicator();
    this.running = false;
    this.paused = false;
    this.pausedElapsed = 0;
    this.activePage = null;
  }

  /**
   * 顯示暫停指示文字
   */
  _showPausedIndicator() {
    if (!this._container) return;
    // 避免重複建立
    if (this._container.querySelector('.timer-paused-indicator')) return;
    const indicator = document.createElement('div');
    indicator.className = 'timer-paused-indicator';
    indicator.textContent = '已暫停';
    this._container.appendChild(indicator);
  }

  /**
   * 移除暫停指示文字
   */
  _removePausedIndicator() {
    if (!this._container) return;
    const indicator = this._container.querySelector('.timer-paused-indicator');
    if (indicator) indicator.remove();
  }
}

// 全域實例
const presentationTimer = new PresentationTimer();

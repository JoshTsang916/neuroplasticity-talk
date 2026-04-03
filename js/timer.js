/**
 * 計時器元件
 * 用 data-duration 控制秒數，支援三種模式：
 * - 15 秒：大圓環進度條，平滑消失
 * - 30 秒：圓環 + 呼吸脈動效果
 * - 120 秒：分:秒格式，最後 30 秒變磚紅
 *
 * 按空白鍵或點擊螢幕啟動
 * 啟動時關閉 Reveal 鍵盤，結束後恢復
 */
class PresentationTimer {
  constructor() {
    /** @type {HTMLElement|null} 目前啟動的計時器容器 */
    this.activeTimer = null;
    /** @type {number|null} requestAnimationFrame ID */
    this.animationId = null;
    /** @type {boolean} 是否正在計時中 */
    this.running = false;
    /** @type {Set<HTMLElement>} BUG-3 修正：已完成的計時器集合，防止重複啟動 */
    this.completedTimers = new Set();
    /** @type {number} 用於生成唯一 SVG gradient ID 的計數器 */
    this._gradientCounter = 0;
  }

  /**
   * 初始化所有計時器頁面
   * 在 Reveal ready 後呼叫
   */
  init() {
    const timerSlides = document.querySelectorAll('[data-timer]');
    timerSlides.forEach(slide => {
      const duration = parseInt(slide.getAttribute('data-timer'), 10);
      this._buildTimerUI(slide, duration);
    });

    // 監聽空白鍵與點擊
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this._isTimerSlide()) {
        e.preventDefault();
        this._startFromCurrentSlide();
      }
    });

    document.addEventListener('click', (e) => {
      // 避免與 reveal 導航衝突，只在計時器頁處理
      if (this._isTimerSlide() && !this.running) {
        this._startFromCurrentSlide();
      }
    });

    // 離開計時器頁面時清理
    Reveal.on('slidechanged', () => {
      if (this.running && !this._isTimerSlide()) {
        this._cleanup();
      }
    });
  }

  /**
   * 判斷目前頁面是否為計時器頁
   * @returns {boolean}
   */
  _isTimerSlide() {
    const current = Reveal.getCurrentSlide();
    return current && current.hasAttribute('data-timer');
  }

  /**
   * 從目前頁面啟動計時器
   * BUG-3 修正：已完成的計時器不會被重新啟動
   */
  _startFromCurrentSlide() {
    if (this.running) return;
    const slide = Reveal.getCurrentSlide();
    if (!slide || !slide.hasAttribute('data-timer')) return;

    // BUG-3：已完成的計時器，防止重複啟動
    if (this.completedTimers.has(slide)) return;

    const duration = parseInt(slide.getAttribute('data-timer'), 10);
    this._start(slide, duration);
  }

  /**
   * 建構計時器 UI
   * BUG-4 修正：hint 移到 wrapper 外面，避免被 SVG 遮住
   * @param {HTMLElement} slide - 投影片容器
   * @param {number} duration - 秒數
   */
  _buildTimerUI(slide, duration) {
    const container = slide.querySelector('.timer-container');
    if (!container) return;

    // 每個計時器用唯一 gradient ID，避免多個同秒數計時器 ID 衝突
    const gradId = `ring-grad-${this._gradientCounter++}`;

    if (duration <= 30) {
      // 圓環模式 — hint 在 wrapper 外面
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
              fill="none" stroke="#5C4033" stroke-width="4" opacity="0.3"/>
            <circle class="timer-ring-progress" cx="100" cy="100" r="90"
              fill="none" stroke="url(#${gradId})" stroke-width="6"
              stroke-linecap="round"
              stroke-dasharray="${2 * Math.PI * 90}"
              stroke-dashoffset="0"
              transform="rotate(-90 100 100)"/>
          </svg>
        </div>
        <div class="timer-hint">按空白鍵開始</div>
      `;
    } else {
      // 數字模式（120 秒）— hint 在 wrapper 外面
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
              fill="none" stroke="#5C4033" stroke-width="4" opacity="0.3"/>
            <circle class="timer-ring-progress" cx="100" cy="100" r="90"
              fill="none" stroke="url(#${gradId})" stroke-width="6"
              stroke-linecap="round"
              stroke-dasharray="${2 * Math.PI * 90}"
              stroke-dashoffset="0"
              transform="rotate(-90 100 100)"/>
          </svg>
          <div class="timer-digital">${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}</div>
        </div>
        <div class="timer-hint">按空白鍵開始</div>
      `;
    }
  }

  /**
   * 啟動計時器
   * @param {HTMLElement} slide - 投影片容器
   * @param {number} duration - 秒數
   */
  _start(slide, duration) {
    this.running = true;
    this.activeTimer = slide;

    // 關閉 Reveal 鍵盤導航
    Reveal.configure({ keyboard: false });

    const container = slide.querySelector('.timer-container');
    const hint = container.querySelector('.timer-hint');
    if (hint) hint.style.display = 'none';

    const ring = container.querySelector('.timer-ring-progress');
    const circumference = 2 * Math.PI * 90;
    const digital = container.querySelector('.timer-digital');
    const wrapper = container.querySelector('.timer-ring-wrapper, .timer-digital-wrapper');

    // 呼吸脈動（30 秒計時器）
    if (duration === 30 && wrapper) {
      wrapper.classList.add('breathing');
    }

    const startTime = performance.now();
    const totalMs = duration * 1000;

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / totalMs, 1);

      // 更新圓環
      if (ring) {
        ring.setAttribute('stroke-dashoffset', String(circumference * progress));
      }

      // 更新數字顯示（大於 30 秒的模式）
      if (digital) {
        const remaining = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        digital.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        // 最後 30 秒變磚紅（覆蓋漸層為純磚紅）
        if (remaining <= 30 && ring) {
          ring.setAttribute('stroke', '#C8553D');
        }
      }

      if (progress < 1) {
        this.animationId = requestAnimationFrame(animate);
      } else {
        this._onComplete(slide, duration);
      }
    };

    this.animationId = requestAnimationFrame(animate);
  }

  /**
   * 計時結束
   * BUG-3 修正：標記已完成，防止重新啟動
   * @param {HTMLElement} slide - 投影片容器
   * @param {number} duration - 秒數
   */
  _onComplete(slide, duration) {
    const container = slide.querySelector('.timer-container');
    const wrapper = container.querySelector('.timer-ring-wrapper, .timer-digital-wrapper');

    // 移除呼吸效果
    if (wrapper) {
      wrapper.classList.remove('breathing');
    }

    // 淡出效果
    if (wrapper) {
      wrapper.classList.add('timer-fade-out');
    }

    // 隱藏 hint（已移到 wrapper 外面）
    const hint = container.querySelector('.timer-hint');
    if (hint) {
      hint.textContent = '';
      hint.style.display = 'none';
    }

    // BUG-3：標記此計時器已完成
    this.completedTimers.add(slide);

    // 恢復 Reveal 鍵盤
    setTimeout(() => {
      Reveal.configure({ keyboard: true });
      this.running = false;
      this.activeTimer = null;
    }, 800);
  }

  /**
   * 清理計時器狀態（離開頁面時）
   */
  _cleanup() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.running = false;
    this.activeTimer = null;
    Reveal.configure({ keyboard: true });
  }
}

// 全域實例
const presentationTimer = new PresentationTimer();

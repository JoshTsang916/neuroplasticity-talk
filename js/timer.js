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
   */
  _startFromCurrentSlide() {
    if (this.running) return;
    const slide = Reveal.getCurrentSlide();
    if (!slide || !slide.hasAttribute('data-timer')) return;

    const duration = parseInt(slide.getAttribute('data-timer'), 10);
    this._start(slide, duration);
  }

  /**
   * 建構計時器 UI
   * @param {HTMLElement} slide - 投影片容器
   * @param {number} duration - 秒數
   */
  _buildTimerUI(slide, duration) {
    const container = slide.querySelector('.timer-container');
    if (!container) return;

    if (duration <= 30) {
      // 圓環模式
      container.innerHTML = `
        <div class="timer-ring-wrapper">
          <svg class="timer-ring" viewBox="0 0 200 200">
            <circle class="timer-ring-bg" cx="100" cy="100" r="90"
              fill="none" stroke="#5C4033" stroke-width="4" opacity="0.3"/>
            <circle class="timer-ring-progress" cx="100" cy="100" r="90"
              fill="none" stroke="#D4956A" stroke-width="6"
              stroke-linecap="round"
              stroke-dasharray="${2 * Math.PI * 90}"
              stroke-dashoffset="0"
              transform="rotate(-90 100 100)"/>
          </svg>
          <div class="timer-hint">按空白鍵開始</div>
        </div>
      `;
    } else {
      // 數字模式（120 秒）
      const mins = Math.floor(duration / 60);
      const secs = duration % 60;
      container.innerHTML = `
        <div class="timer-digital-wrapper">
          <svg class="timer-ring timer-ring-large" viewBox="0 0 200 200">
            <circle class="timer-ring-bg" cx="100" cy="100" r="90"
              fill="none" stroke="#5C4033" stroke-width="4" opacity="0.3"/>
            <circle class="timer-ring-progress" cx="100" cy="100" r="90"
              fill="none" stroke="#D4956A" stroke-width="6"
              stroke-linecap="round"
              stroke-dasharray="${2 * Math.PI * 90}"
              stroke-dashoffset="0"
              transform="rotate(-90 100 100)"/>
          </svg>
          <div class="timer-digital">${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}</div>
          <div class="timer-hint">按空白鍵開始</div>
        </div>
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

        // 最後 30 秒變磚紅
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

    // 顯示完成提示
    const hint = container.querySelector('.timer-hint');
    if (hint) {
      hint.textContent = '';
      hint.style.display = 'block';
    }

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

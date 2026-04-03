/**
 * Supabase 投稿即時訂閱 + Polling Fallback — 念頭氣泡版
 *
 * 功能：
 * - Supabase Realtime 訂閱 presentation_submissions 表
 * - 5 秒 polling fallback（Realtime 斷線時自動接手）
 * - 卡片動畫節流：每 400ms 最多渲染一張新氣泡
 * - 最多同時顯示 30 張，舊的漸淡移除
 * - 右上角即時計數器
 * - 「念頭氣泡」佈局：flexbox wrap + 隨機大小 + 隨機旋轉
 * - 保活模式：離開頁面暫停、回來恢復，不重複渲染
 */
class SubmissionWall {
  /**
   * @param {Object} options
   * @param {string} options.questionId - 過濾的問題 ID（'1' 或 '2'）
   * @param {string} options.wallSelector - 投稿牆容器的 CSS selector
   * @param {string} options.counterSelector - 計數器的 CSS selector
   * @param {string} options.counterLabel - 計數器標籤
   */
  constructor(options = {}) {
    this.questionId = options.questionId || '1';
    this.wallSelector = options.wallSelector || '#submission-wall-1';
    this.counterSelector = options.counterSelector || '#submission-counter-1';
    this.counterLabel = options.counterLabel || '個大象';

    this.submissions = [];
    this.renderQueue = [];
    this.maxVisible = 30;
    this.throttleMs = 400;
    this.throttleTimer = null;
    this.totalCount = 0;
    this.supabase = null;
    this.channel = null;
    this.pollingInterval = null;
    this.realtimeConnected = false;
    this.seenIds = new Set();
    this.lastPolledAt = null;

    /** @type {boolean} 是否已初始化過（保活用） */
    this.initialized = false;
    /** @type {boolean} 是否處於活躍狀態 */
    this.active = false;
  }

  /**
   * 初始化投稿牆（只會執行一次）
   * 第二次呼叫會自動走 resume 路徑
   */
  async init() {
    // 已初始化過 → 恢復訂閱即可，不重複載入
    if (this.initialized) {
      this.resume();
      return;
    }

    if (typeof window.supabase === 'undefined') {
      console.error('Supabase client 未載入');
      return;
    }

    this.supabase = window.supabase.createClient(
      SUPABASE_CONFIG.url,
      SUPABASE_CONFIG.anonKey
    );

    await this._loadExisting();
    this._subscribeRealtime();
    this._startPolling();

    this.initialized = true;
    this.active = true;
  }

  /**
   * 恢復訂閱（從暫停狀態回來）
   */
  resume() {
    if (this.active) return;

    // 重新訂閱 Realtime（之前被移除了）
    if (!this.channel) {
      this._subscribeRealtime();
    }

    // 重新啟動 polling
    if (!this.pollingInterval) {
      this._startPolling();
    }

    this.active = true;
  }

  /**
   * 暫停訂閱（離開頁面時），保留 DOM 和狀態
   */
  pause() {
    if (!this.active) return;

    // 停止 Realtime
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }

    // 停止 polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }

    this.active = false;
    // 注意：不清 DOM、不清 seenIds、不清 submissions
  }

  /**
   * 完全銷毀（頁面卸載時才需要）
   */
  destroy() {
    this.pause();
    this.initialized = false;
    this.seenIds.clear();
    this.submissions = [];
    this.totalCount = 0;
  }

  // ────────────────────────────
  // 內部方法
  // ────────────────────────────

  async _loadExisting() {
    try {
      const { data, error, count } = await this.supabase
        .from(SUPABASE_CONFIG.table)
        .select('*', { count: 'exact' })
        .eq('session_id', SUPABASE_CONFIG.sessionId)
        .eq('question_id', this.questionId)
        .order('created_at', { ascending: false })
        .limit(this.maxVisible);

      if (error) throw error;

      this.totalCount = count || 0;
      this._updateCounter();

      if (data && data.length > 0) {
        this.lastPolledAt = data[0].created_at;
        // 反轉為時間順序（舊→新），逐一渲染
        data.reverse().forEach(item => {
          this.seenIds.add(item.id);
          this._addToRenderQueue(item);
        });
      }
    } catch (err) {
      console.error('載入投稿失敗:', err);
    }
  }

  _subscribeRealtime() {
    this.channel = this.supabase
      .channel(`submissions-realtime-q${this.questionId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: SUPABASE_CONFIG.table,
          filter: `session_id=eq.${SUPABASE_CONFIG.sessionId}`
        },
        (payload) => {
          this.realtimeConnected = true;
          const newItem = payload.new;
          if (newItem.question_id !== this.questionId) return;
          if (!this.seenIds.has(newItem.id)) {
            this.seenIds.add(newItem.id);
            this.totalCount++;
            this._updateCounter();
            this._addToRenderQueue(newItem);
          }
        }
      )
      .subscribe((status) => {
        this.realtimeConnected = (status === 'SUBSCRIBED');
      });
  }

  _startPolling() {
    this.pollingInterval = setInterval(async () => {
      if (this.realtimeConnected) return;

      try {
        let query = this.supabase
          .from(SUPABASE_CONFIG.table)
          .select('*')
          .eq('session_id', SUPABASE_CONFIG.sessionId)
          .eq('question_id', this.questionId)
          .order('created_at', { ascending: false })
          .limit(10);

        if (this.lastPolledAt) {
          query = query.gt('created_at', this.lastPolledAt);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (data && data.length > 0) {
          this.lastPolledAt = data[0].created_at;
          data.reverse().forEach(item => {
            if (!this.seenIds.has(item.id)) {
              this.seenIds.add(item.id);
              this.totalCount++;
              this._addToRenderQueue(item);
            }
          });
          this._updateCounter();
        }
      } catch (err) {
        console.error('Polling 失敗:', err);
      }
    }, 5000);
  }

  _addToRenderQueue(item) {
    this.renderQueue.push(item);
    this._processQueue();
  }

  _processQueue() {
    if (this.throttleTimer) return;
    if (this.renderQueue.length === 0) return;

    const item = this.renderQueue.shift();
    this._renderBubble(item);

    if (this.renderQueue.length > 0) {
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        this._processQueue();
      }, this.throttleMs);
    }
  }

  /**
   * 渲染一個念頭氣泡
   * 隨機大小、微旋轉、淡入放大動畫
   */
  _renderBubble(item) {
    const wall = document.querySelector(this.wallSelector);
    if (!wall) return;

    const bubble = document.createElement('div');
    bubble.className = 'thought-bubble';

    // 根據文字長度決定氣泡大小等級
    const textLen = (item.content || '').length;
    if (textLen <= 10) {
      bubble.classList.add('bubble-sm');
    } else if (textLen <= 30) {
      bubble.classList.add('bubble-md');
    } else {
      bubble.classList.add('bubble-lg');
    }

    // 隨機微旋轉（-4 到 4 度）
    const rotation = (Math.random() - 0.5) * 8;
    bubble.style.setProperty('--bubble-rotate', `${rotation}deg`);

    // 隨機動畫延遲（0-200ms，讓同時出現的氣泡有層次）
    const delay = Math.random() * 0.2;
    bubble.style.animationDelay = `${delay}s`;

    // 用 textContent 防 XSS
    const text = document.createElement('span');
    text.textContent = item.content || '';
    bubble.appendChild(text);

    // 加入牆面
    wall.appendChild(bubble);
    this.submissions.push(item);

    // 超過上限時移除最舊的
    while (wall.children.length > this.maxVisible) {
      const oldest = wall.firstChild;
      oldest.classList.add('bubble-fade-out');
      setTimeout(() => {
        if (oldest.parentNode === wall) {
          wall.removeChild(oldest);
        }
      }, 500);
      this.submissions.shift();
    }
  }

  _updateCounter() {
    const counter = document.querySelector(this.counterSelector);
    if (counter) {
      counter.textContent = this.totalCount;
    }
  }
}

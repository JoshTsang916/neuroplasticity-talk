/**
 * Supabase 投稿即時訂閱 + Polling Fallback
 *
 * 功能：
 * - Supabase Realtime 訂閱 presentation_submissions 表
 * - 5 秒 polling fallback（Realtime 斷線時自動接手）
 * - 卡片動畫節流：每 300ms 最多渲染一張新卡片
 * - 最多同時顯示 20 張，舊的漸淡移除
 * - 右上角即時計數器
 */
class SubmissionWall {
  constructor() {
    /** @type {Array<Object>} 目前顯示中的投稿 */
    this.submissions = [];
    /** @type {Array<Object>} 等待渲染的佇列 */
    this.renderQueue = [];
    /** @type {number} 最大同時顯示數量 */
    this.maxVisible = 20;
    /** @type {number} 渲染節流間隔（ms） */
    this.throttleMs = 300;
    /** @type {number|null} 節流 timer */
    this.throttleTimer = null;
    /** @type {number} 總投稿計數 */
    this.totalCount = 0;
    /** @type {Object|null} Supabase client */
    this.supabase = null;
    /** @type {Object|null} Realtime channel */
    this.channel = null;
    /** @type {number|null} Polling interval ID */
    this.pollingInterval = null;
    /** @type {boolean} Realtime 是否連線中 */
    this.realtimeConnected = false;
    /** @type {Set<string>} 已顯示過的投稿 ID（防重複） */
    this.seenIds = new Set();
    /** @type {string|null} 上次 polling 的最新時間戳 */
    this.lastPolledAt = null;
  }

  /**
   * 初始化投稿牆
   * 需要在投稿牆頁面進入時呼叫
   */
  async init() {
    // 初始化 Supabase client（使用 CDN 載入的 supabase-js）
    if (typeof window.supabase === 'undefined') {
      console.error('Supabase client 未載入');
      return;
    }

    this.supabase = window.supabase.createClient(
      SUPABASE_CONFIG.url,
      SUPABASE_CONFIG.anonKey
    );

    // 載入現有投稿
    await this._loadExisting();

    // 啟動 Realtime 訂閱
    this._subscribeRealtime();

    // 啟動 polling fallback
    this._startPolling();
  }

  /**
   * 載入現有投稿（初始化時）
   */
  async _loadExisting() {
    try {
      const { data, error, count } = await this.supabase
        .from(SUPABASE_CONFIG.table)
        .select('*', { count: 'exact' })
        .eq('session_id', SUPABASE_CONFIG.sessionId)
        .order('created_at', { ascending: false })
        .limit(this.maxVisible);

      if (error) throw error;

      this.totalCount = count || 0;
      this._updateCounter();

      if (data && data.length > 0) {
        // 記錄最新時間戳供 polling 用
        this.lastPolledAt = data[0].created_at;

        // 反轉為時間順序（舊→新），逐一加入渲染佇列
        data.reverse().forEach(item => {
          this.seenIds.add(item.id);
          this._addToRenderQueue(item);
        });
      }
    } catch (err) {
      console.error('載入投稿失敗:', err);
    }
  }

  /**
   * 訂閱 Supabase Realtime
   */
  _subscribeRealtime() {
    this.channel = this.supabase
      .channel('submissions-realtime')
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

  /**
   * 啟動 5 秒 polling fallback
   */
  _startPolling() {
    this.pollingInterval = setInterval(async () => {
      // Realtime 正常時跳過 polling
      if (this.realtimeConnected) return;

      try {
        // BUG-2 修正：polling 帶 gt() 篩選時，count: 'exact' 返回的是篩選後筆數
        // 而非總數。改用 this.totalCount += 新增數量 來累加計數。
        let query = this.supabase
          .from(SUPABASE_CONFIG.table)
          .select('*')
          .eq('session_id', SUPABASE_CONFIG.sessionId)
          .order('created_at', { ascending: false })
          .limit(10);

        if (this.lastPolledAt) {
          query = query.gt('created_at', this.lastPolledAt);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (data && data.length > 0) {
          this.lastPolledAt = data[0].created_at;
          // 反轉為時間順序
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

  /**
   * 將投稿加入渲染佇列（節流處理）
   * @param {Object} item - 投稿資料
   */
  _addToRenderQueue(item) {
    this.renderQueue.push(item);
    this._processQueue();
  }

  /**
   * 處理渲染佇列（每 300ms 最多渲染一張）
   */
  _processQueue() {
    if (this.throttleTimer) return;
    if (this.renderQueue.length === 0) return;

    const item = this.renderQueue.shift();
    this._renderCard(item);

    if (this.renderQueue.length > 0) {
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        this._processQueue();
      }, this.throttleMs);
    }
  }

  /**
   * 渲染一張投稿卡片
   * 進場帶隨機微旋轉 + 縮放，讓動畫更有趣
   * @param {Object} item - 投稿資料
   */
  _renderCard(item) {
    const wall = document.getElementById('submission-wall');
    if (!wall) return;

    // 隨機微旋轉角度（-3 ~ 3 度）和起始縮放
    const randomRotate = (Math.random() - 0.5) * 6;
    const startScale = 0.85 + Math.random() * 0.1;

    // 建立卡片
    const card = document.createElement('div');
    card.className = 'submission-card';
    card.style.opacity = '0';
    card.style.transform = `translateY(20px) rotate(${randomRotate}deg) scale(${startScale})`;

    // 用 textContent 防 XSS
    const text = document.createElement('p');
    text.textContent = item.content || '';
    card.appendChild(text);

    // 加入牆面（最前面）
    wall.insertBefore(card, wall.firstChild);
    this.submissions.unshift(item);

    // 淡入動畫（保留微旋轉，縮放歸一）
    requestAnimationFrame(() => {
      card.style.transition = 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
      card.style.opacity = '1';
      card.style.transform = `translateY(0) rotate(${randomRotate * 0.3}deg) scale(1)`;
    });

    // 超過上限時移除最舊的
    while (wall.children.length > this.maxVisible) {
      const oldest = wall.lastChild;
      oldest.style.transition = 'opacity 0.5s ease';
      oldest.style.opacity = '0';
      setTimeout(() => {
        if (oldest.parentNode === wall) {
          wall.removeChild(oldest);
        }
      }, 500);
      this.submissions.pop();
    }
  }

  /**
   * 更新右上角計數器
   */
  _updateCounter() {
    const counter = document.getElementById('submission-counter');
    if (counter) {
      counter.textContent = this.totalCount;
    }
  }

  /**
   * 銷毀（離開投稿牆時清理）
   */
  destroy() {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
  }
}

// 全域實例
const submissionWall = new SubmissionWall();

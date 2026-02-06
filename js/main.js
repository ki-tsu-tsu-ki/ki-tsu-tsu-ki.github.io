/**
 * 会議室空き状況チェッカー
 * Google Calendar APIを使用して会議室の空き状況をタイムライン表示するアプリ
 */

(function() {
    'use strict';

    // アプリケーション設定
    const CONFIG = {
        VERSION: '1.1.0',
        SCOPES: 'https://www.googleapis.com/auth/calendar.readonly',
        DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
        STORAGE_KEYS: {
            CLIENT_ID: 'meetingroom_client_id',
            SELECTED_CALENDARS: 'meetingroom_selected_calendars'
        },
        // タイムライン表示設定
        TIMELINE: {
            START_HOUR: 8,
            END_HOUR: 20,
            SLOT_HEIGHT: 40  // 30分あたりの高さ(px)
        }
    };

    // アプリケーション状態
    const state = {
        isSignedIn: false,
        tokenClient: null,
        calendars: [],
        selectedCalendarIds: new Set(),
        accessToken: null,
        currentDate: new Date(),
        events: {},  // カレンダーIDをキーとしたイベントデータ
        searchDuration: 30  // 検索する空き時間の長さ（分）
    };

    // DOM要素
    const elements = {};

    /**
     * DOM要素を取得
     */
    function initElements() {
        elements.loginSection = document.getElementById('login-section');
        elements.appSection = document.getElementById('app-section');
        elements.userInfo = document.getElementById('user-info');
        elements.userName = document.getElementById('user-name');
        elements.signinBtn = document.getElementById('signin-btn');
        elements.signoutBtn = document.getElementById('signout-btn');
        elements.dateInput = document.getElementById('date-input');
        elements.prevDayBtn = document.getElementById('prev-day-btn');
        elements.nextDayBtn = document.getElementById('next-day-btn');
        elements.todayBtn = document.getElementById('today-btn');
        elements.timelineContainer = document.getElementById('timeline-container');
        elements.calendarListContainer = document.getElementById('calendar-list-container');
        elements.configModal = document.getElementById('config-modal');
        elements.clientIdInput = document.getElementById('client-id-input');
        elements.saveConfigBtn = document.getElementById('save-config-btn');
        elements.cancelConfigBtn = document.getElementById('cancel-config-btn');
        elements.configBtn = document.getElementById('config-btn');
        elements.durationSelect = document.getElementById('duration-select');
    }

    /**
     * イベントリスナーを設定
     */
    function initEventListeners() {
        elements.signinBtn.addEventListener('click', handleSignIn);
        elements.signoutBtn.addEventListener('click', handleSignOut);
        elements.dateInput.addEventListener('change', handleDateChange);
        elements.prevDayBtn.addEventListener('click', () => changeDate(-1));
        elements.nextDayBtn.addEventListener('click', () => changeDate(1));
        elements.todayBtn.addEventListener('click', goToToday);
        elements.configBtn.addEventListener('click', showConfigModal);
        elements.saveConfigBtn.addEventListener('click', handleSaveConfig);
        elements.cancelConfigBtn.addEventListener('click', hideConfigModal);

        // 空き時間の長さ選択
        if (elements.durationSelect) {
            elements.durationSelect.addEventListener('change', handleDurationChange);
        }

        // 日付入力のデフォルト値を今日に設定
        updateDateInput();
    }

    /**
     * 検索する空き時間の長さを変更
     */
    function handleDurationChange() {
        state.searchDuration = parseInt(elements.durationSelect.value, 10);
    }

    /**
     * 日付入力を更新
     */
    function updateDateInput() {
        elements.dateInput.value = formatDateForInput(state.currentDate);
    }

    /**
     * 日付をinput[type=date]用にフォーマット
     */
    function formatDateForInput(date) {
        return date.toISOString().split('T')[0];
    }

    /**
     * 日付変更ハンドラー
     */
    function handleDateChange() {
        state.currentDate = new Date(elements.dateInput.value + 'T00:00:00');
        loadEventsAndRender();
    }

    /**
     * 日付を変更
     */
    function changeDate(days) {
        state.currentDate.setDate(state.currentDate.getDate() + days);
        updateDateInput();
        loadEventsAndRender();
    }

    /**
     * 今日に移動
     */
    function goToToday() {
        state.currentDate = new Date();
        updateDateInput();
        loadEventsAndRender();
    }

    /**
     * ローカルストレージから設定を読み込む
     */
    function loadSettings() {
        const savedClientId = localStorage.getItem(CONFIG.STORAGE_KEYS.CLIENT_ID);
        if (savedClientId) {
            elements.clientIdInput.value = savedClientId;
        }

        const savedSelectedCalendars = localStorage.getItem(CONFIG.STORAGE_KEYS.SELECTED_CALENDARS);
        if (savedSelectedCalendars) {
            state.selectedCalendarIds = new Set(JSON.parse(savedSelectedCalendars));
        }
    }

    /**
     * 選択したカレンダーを保存
     */
    function saveSelectedCalendars() {
        localStorage.setItem(
            CONFIG.STORAGE_KEYS.SELECTED_CALENDARS,
            JSON.stringify([...state.selectedCalendarIds])
        );
    }

    /**
     * Google API クライアントを初期化
     */
    async function initGoogleApi() {
        const clientId = localStorage.getItem(CONFIG.STORAGE_KEYS.CLIENT_ID);
        if (!clientId) {
            return;
        }

        try {
            await new Promise((resolve, reject) => {
                if (typeof gapi !== 'undefined') {
                    gapi.load('client', resolve);
                } else {
                    const checkGapi = setInterval(() => {
                        if (typeof gapi !== 'undefined') {
                            clearInterval(checkGapi);
                            gapi.load('client', resolve);
                        }
                    }, 100);
                    setTimeout(() => {
                        clearInterval(checkGapi);
                        reject(new Error('gapi not loaded'));
                    }, 10000);
                }
            });

            await gapi.client.init({
                discoveryDocs: [CONFIG.DISCOVERY_DOC]
            });

            await new Promise((resolve, reject) => {
                if (typeof google !== 'undefined' && google.accounts) {
                    resolve();
                } else {
                    const checkGoogle = setInterval(() => {
                        if (typeof google !== 'undefined' && google.accounts) {
                            clearInterval(checkGoogle);
                            resolve();
                        }
                    }, 100);
                    setTimeout(() => {
                        clearInterval(checkGoogle);
                        reject(new Error('Google Identity Services not loaded'));
                    }, 10000);
                }
            });

            state.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: CONFIG.SCOPES,
                callback: handleTokenResponse
            });

        } catch (error) {
            console.error('Google API初期化エラー:', error);
        }
    }

    /**
     * トークンレスポンスのハンドラー
     */
    function handleTokenResponse(response) {
        if (response.error) {
            console.error('認証エラー:', response);
            showError('認証に失敗しました: ' + (response.error_description || response.error));
            return;
        }

        state.accessToken = response.access_token;
        state.isSignedIn = true;
        updateUI();
        fetchUserInfo();
        fetchCalendarList();
    }

    /**
     * ユーザー情報を取得
     */
    async function fetchUserInfo() {
        try {
            const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { 'Authorization': `Bearer ${state.accessToken}` }
            });
            const userInfo = await response.json();
            elements.userName.textContent = userInfo.email || userInfo.name || 'ログイン中';
        } catch (error) {
            console.error('ユーザー情報取得エラー:', error);
        }
    }

    /**
     * カレンダー一覧を取得
     */
    async function fetchCalendarList() {
        if (elements.calendarListContainer) {
            elements.calendarListContainer.innerHTML = '<p class="placeholder-text">カレンダー一覧を読み込み中...</p>';
        }

        try {
            // 隠れているカレンダーも含めて取得
            const response = await gapi.client.calendar.calendarList.list({
                showHidden: true,
                showDeleted: false,
                minAccessRole: 'freeBusyReader'  // 最低限の権限でも取得
            });

            state.calendars = response.result.items || [];

            // 会議室リソースを識別してフィルタリング
            const roomCalendars = state.calendars.filter(cal => isRoomCalendar(cal));
            const otherCalendars = state.calendars.filter(cal => !isRoomCalendar(cal));

            // 会議室を先頭に、その他を後に並べる
            state.calendars = [...roomCalendars, ...otherCalendars];

            // 保存された選択をフィルタリング（存在しないカレンダーを除去）
            const validCalendarIds = new Set(state.calendars.map(cal => cal.id));
            const validSelectedIds = [...state.selectedCalendarIds].filter(id => validCalendarIds.has(id));
            state.selectedCalendarIds = new Set(validSelectedIds);

            // 選択が空の場合、会議室カレンダーを自動選択
            if (state.selectedCalendarIds.size === 0 && roomCalendars.length > 0) {
                roomCalendars.forEach(cal => {
                    state.selectedCalendarIds.add(cal.id);
                });
            }
            saveSelectedCalendars();

            renderCalendarList();
            loadEventsAndRender();
        } catch (error) {
            console.error('カレンダー一覧取得エラー:', error);
            if (elements.calendarListContainer) {
                elements.calendarListContainer.innerHTML = '<p class="error-message">カレンダー一覧の取得に失敗しました</p>';
            }
        }
    }

    /**
     * 会議室カレンダーかどうかを判定
     */
    function isRoomCalendar(calendar) {
        // Google Workspaceの会議室リソース
        if (calendar.id && calendar.id.includes('resource.calendar.google.com')) {
            return true;
        }

        // freeBusyReader権限のみのカレンダー（会議室の典型的な権限）
        if (calendar.accessRole === 'freeBusyReader') {
            return true;
        }

        // 名前に会議室関連のキーワードが含まれる
        const summary = (calendar.summary || '').toLowerCase();
        const roomKeywords = ['会議室', '会議', 'meeting', 'room', 'mtg', 'conf', '応接', 'ミーティング'];
        if (roomKeywords.some(keyword => summary.includes(keyword.toLowerCase()))) {
            return true;
        }

        return false;
    }

    /**
     * カレンダー一覧を描画
     */
    function renderCalendarList() {
        if (!elements.calendarListContainer) {
            return;
        }

        if (state.calendars.length === 0) {
            elements.calendarListContainer.innerHTML = '<p class="placeholder-text">カレンダーが見つかりませんでした</p>';
            return;
        }

        const roomCalendars = state.calendars.filter(cal => isRoomCalendar(cal));
        const otherCalendars = state.calendars.filter(cal => !isRoomCalendar(cal));

        let html = `
            <div class="calendar-actions">
                <button class="btn btn-small btn-secondary" onclick="app.selectAll()">全選択</button>
                <button class="btn btn-small btn-secondary" onclick="app.deselectAll()">全解除</button>
                <button class="btn btn-small btn-primary" onclick="app.selectRoomsOnly()">会議室のみ</button>
            </div>
        `;

        // 会議室セクション
        if (roomCalendars.length > 0) {
            html += '<div class="calendar-section"><h3>会議室 (' + roomCalendars.length + '件)</h3>';
            roomCalendars.forEach(cal => {
                html += renderCalendarItem(cal);
            });
            html += '</div>';
        } else {
            html += `
                <div class="calendar-section">
                    <h3>会議室</h3>
                    <div class="room-help-message">
                        <p><strong>会議室が見つかりませんでした</strong></p>
                        <p>会議室を表示するには、以下の方法をお試しください：</p>
                        <ol>
                            <li>Googleカレンダーで「他のカレンダー」→「カレンダーに登録」から会議室カレンダーを追加</li>
                            <li>または、会議室を使った予定を一度作成すると、自動的に追加される場合があります</li>
                        </ol>
                        <p><small>※ 組織のGoogle Workspace管理者が設定した会議室リソースは、<br>
                        カレンダーに明示的に追加するまで表示されません。</small></p>
                    </div>
                </div>
            `;
        }

        // その他のカレンダーセクション
        if (otherCalendars.length > 0) {
            html += '<div class="calendar-section"><h3>その他のカレンダー (' + otherCalendars.length + '件)</h3>';
            otherCalendars.forEach(cal => {
                html += renderCalendarItem(cal);
            });
            html += '</div>';
        }

        elements.calendarListContainer.innerHTML = html;
    }

    /**
     * カレンダーアイテムを描画
     */
    function renderCalendarItem(cal) {
        const isChecked = state.selectedCalendarIds.has(cal.id);
        const colorStyle = cal.backgroundColor ? `border-left: 4px solid ${cal.backgroundColor}` : '';
        const isRoom = isRoomCalendar(cal);
        const roomBadge = isRoom ? '<span class="room-badge">会議室</span>' : '';

        return `
            <div class="calendar-item ${isRoom ? 'is-room' : ''}" style="${colorStyle}">
                <label class="calendar-label">
                    <input type="checkbox"
                           value="${escapeHtml(cal.id)}"
                           ${isChecked ? 'checked' : ''}
                           onchange="app.toggleCalendar('${escapeHtml(cal.id)}')">
                    <span class="calendar-name">${escapeHtml(cal.summary || cal.id)} ${roomBadge}</span>
                </label>
            </div>
        `;
    }

    /**
     * イベントを読み込んでタイムラインを描画
     */
    async function loadEventsAndRender() {
        const selectedCalendars = state.calendars.filter(cal =>
            state.selectedCalendarIds.has(cal.id)
        );

        if (selectedCalendars.length === 0) {
            elements.timelineContainer.innerHTML = `
                <div class="no-rooms-message">
                    <p>表示する会議室が選択されていません</p>
                    <p>下の「会議室の設定」から会議室を選択してください</p>
                </div>
            `;
            return;
        }

        elements.timelineContainer.innerHTML = '<p class="placeholder-text">読み込み中...</p>';

        // 日付の開始と終了を計算
        const dateStr = formatDateForInput(state.currentDate);
        const timeMin = new Date(`${dateStr}T00:00:00`).toISOString();
        const timeMax = new Date(`${dateStr}T23:59:59`).toISOString();

        try {
            // 各カレンダーのイベントを取得
            const eventPromises = selectedCalendars.map(cal =>
                gapi.client.calendar.events.list({
                    calendarId: cal.id,
                    timeMin: timeMin,
                    timeMax: timeMax,
                    singleEvents: true,
                    orderBy: 'startTime'
                }).then(response => ({
                    calendarId: cal.id,
                    events: response.result.items || []
                })).catch(error => ({
                    calendarId: cal.id,
                    events: [],
                    error: error
                }))
            );

            const results = await Promise.all(eventPromises);

            // イベントデータを保存
            state.events = {};
            results.forEach(result => {
                state.events[result.calendarId] = result.events;
            });

            renderTimeline(selectedCalendars);
        } catch (error) {
            console.error('イベント取得エラー:', error);
            elements.timelineContainer.innerHTML = '<p class="error-message">イベントの取得に失敗しました</p>';
        }
    }

    /**
     * 終日イベントかどうかを判定
     */
    function isAllDayEvent(event) {
        // dateTimeがなくdateのみの場合は終日イベント
        return !event.start.dateTime && event.start.date;
    }

    /**
     * タイムラインを描画
     */
    function renderTimeline(selectedCalendars) {
        const { START_HOUR, END_HOUR, SLOT_HEIGHT } = CONFIG.TIMELINE;
        const totalSlots = (END_HOUR - START_HOUR) * 2; // 30分単位

        let html = `<div class="timeline-grid" style="grid-template-columns: 60px repeat(${selectedCalendars.length}, 1fr);">`;

        // ヘッダー行
        html += '<div class="timeline-header">';
        html += '<div class="timeline-header-cell time-column">時間</div>';

        selectedCalendars.forEach(cal => {
            const color = cal.backgroundColor || '#4285f4';
            html += `
                <div class="timeline-header-cell">
                    <div class="room-header">
                        <span class="room-color-indicator" style="background: ${color}"></span>
                        <span class="room-name-text" title="${escapeHtml(cal.summary || cal.id)}">${escapeHtml(cal.summary || cal.id)}</span>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        // 時間行を生成
        for (let slot = 0; slot < totalSlots; slot++) {
            const hour = START_HOUR + Math.floor(slot / 2);
            const minute = (slot % 2) * 30;
            const isHourStart = minute === 0;
            const timeLabel = isHourStart ? `${hour}:00` : '';

            html += '<div class="timeline-row">';
            html += `<div class="timeline-time" data-slot="${slot}">${timeLabel}</div>`;

            selectedCalendars.forEach(cal => {
                const cellClass = isHourStart ? 'timeline-cell hour-start' : 'timeline-cell';
                html += `<div class="${cellClass}" data-calendar="${escapeHtml(cal.id)}" data-slot="${slot}">`;

                // このスロットに該当するイベントを描画（終日イベントは除外）
                const events = (state.events[cal.id] || []).filter(e => !isAllDayEvent(e));
                events.forEach(event => {
                    const eventStart = new Date(event.start.dateTime);
                    const eventEnd = new Date(event.end.dateTime);

                    // イベントがこのスロットで開始するか確認
                    const slotStart = new Date(state.currentDate);
                    slotStart.setHours(hour, minute, 0, 0);
                    const slotEnd = new Date(slotStart);
                    slotEnd.setMinutes(slotEnd.getMinutes() + 30);

                    if (eventStart >= slotStart && eventStart < slotEnd) {
                        // イベントの長さを計算（30分単位）
                        const durationMinutes = (eventEnd - eventStart) / (1000 * 60);
                        const durationSlots = Math.ceil(durationMinutes / 30);
                        const height = durationSlots * SLOT_HEIGHT - 4;

                        const eventTitle = event.summary || '(タイトルなし)';
                        const timeStr = formatEventTime(eventStart, eventEnd);
                        const bgColor = cal.backgroundColor || '#ea4335';

                        html += `
                            <div class="event-block"
                                 style="height: ${height}px; background: ${bgColor};"
                                 title="${escapeHtml(eventTitle)}\n${timeStr}">
                                ${escapeHtml(eventTitle)}
                            </div>
                        `;
                    }
                });

                html += '</div>';
            });

            html += '</div>';
        }

        html += '</div>';
        elements.timelineContainer.innerHTML = html;

        // タイムラインにホバーイベントを設定
        setupTimelineHoverEvents();
    }

    /**
     * タイムラインのホバーイベントを設定
     */
    function setupTimelineHoverEvents() {
        const cells = elements.timelineContainer.querySelectorAll('.timeline-cell');
        const timeLabels = elements.timelineContainer.querySelectorAll('.timeline-time');

        cells.forEach(cell => {
            cell.addEventListener('mouseenter', handleCellMouseEnter);
            cell.addEventListener('mouseleave', handleCellMouseLeave);
        });
    }

    /**
     * セルにマウスが入った時のハンドラー
     */
    function handleCellMouseEnter(e) {
        const cell = e.currentTarget;

        // イベントブロックの上にいる場合はハイライトしない
        if (e.target.classList.contains('event-block')) {
            return;
        }

        const startSlot = parseInt(cell.dataset.slot, 10);
        const slotsToHighlight = state.searchDuration / 30; // 30分単位

        highlightSlots(startSlot, slotsToHighlight);
    }

    /**
     * セルからマウスが出た時のハンドラー
     */
    function handleCellMouseLeave(e) {
        clearHighlights();
    }

    /**
     * 指定したスロットから横串でハイライト
     */
    function highlightSlots(startSlot, count) {
        const { START_HOUR, END_HOUR } = CONFIG.TIMELINE;
        const totalSlots = (END_HOUR - START_HOUR) * 2;

        for (let i = 0; i < count; i++) {
            const slotIndex = startSlot + i;
            if (slotIndex >= totalSlots) break;

            const cells = elements.timelineContainer.querySelectorAll(
                `.timeline-cell[data-slot="${slotIndex}"]`
            );
            const timeLabel = elements.timelineContainer.querySelector(
                `.timeline-time[data-slot="${slotIndex}"]`
            );

            cells.forEach(cell => {
                if (i === 0) {
                    cell.classList.add('slot-highlight-start');
                } else {
                    cell.classList.add('slot-highlight');
                }
            });
        }
    }

    /**
     * すべてのハイライトをクリア
     */
    function clearHighlights() {
        const highlighted = elements.timelineContainer.querySelectorAll(
            '.slot-highlight, .slot-highlight-start'
        );
        highlighted.forEach(el => {
            el.classList.remove('slot-highlight', 'slot-highlight-start');
        });
    }

    /**
     * イベント時間をフォーマット
     */
    function formatEventTime(start, end) {
        const formatTime = (date) => {
            return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        };
        return `${formatTime(start)} - ${formatTime(end)}`;
    }

    /**
     * カレンダーの選択を切り替え
     */
    function toggleCalendar(calendarId) {
        if (state.selectedCalendarIds.has(calendarId)) {
            state.selectedCalendarIds.delete(calendarId);
        } else {
            state.selectedCalendarIds.add(calendarId);
        }
        saveSelectedCalendars();
        loadEventsAndRender();
    }

    /**
     * 全選択
     */
    function selectAll() {
        state.calendars.forEach(cal => state.selectedCalendarIds.add(cal.id));
        saveSelectedCalendars();
        renderCalendarList();
        loadEventsAndRender();
    }

    /**
     * 全解除
     */
    function deselectAll() {
        state.selectedCalendarIds.clear();
        saveSelectedCalendars();
        renderCalendarList();
        loadEventsAndRender();
    }

    /**
     * 会議室のみ選択
     */
    function selectRoomsOnly() {
        state.selectedCalendarIds.clear();
        state.calendars.forEach(cal => {
            if (isRoomCalendar(cal)) {
                state.selectedCalendarIds.add(cal.id);
            }
        });
        saveSelectedCalendars();
        renderCalendarList();
        loadEventsAndRender();
    }

    /**
     * サインイン処理
     */
    function handleSignIn() {
        const clientId = localStorage.getItem(CONFIG.STORAGE_KEYS.CLIENT_ID);
        if (!clientId) {
            showConfigModal();
            alert('先にAPI設定でクライアントIDを設定してください。');
            return;
        }

        if (!state.tokenClient) {
            initGoogleApi().then(() => {
                if (state.tokenClient) {
                    state.tokenClient.requestAccessToken();
                }
            });
        } else {
            state.tokenClient.requestAccessToken();
        }
    }

    /**
     * サインアウト処理
     */
    function handleSignOut() {
        if (state.accessToken) {
            google.accounts.oauth2.revoke(state.accessToken);
        }
        state.isSignedIn = false;
        state.accessToken = null;
        state.calendars = [];
        state.events = {};
        updateUI();
    }

    /**
     * UIを更新
     */
    function updateUI() {
        if (state.isSignedIn) {
            elements.loginSection.classList.add('hidden');
            elements.appSection.classList.remove('hidden');
            elements.userInfo.classList.remove('hidden');
        } else {
            elements.loginSection.classList.remove('hidden');
            elements.appSection.classList.add('hidden');
            elements.userInfo.classList.add('hidden');
            elements.userName.textContent = '';
        }
    }

    /**
     * 設定モーダルを表示
     */
    function showConfigModal() {
        elements.configModal.classList.remove('hidden');
    }

    /**
     * 設定モーダルを非表示
     */
    function hideConfigModal() {
        elements.configModal.classList.add('hidden');
    }

    /**
     * 設定を保存
     */
    function handleSaveConfig() {
        const clientId = elements.clientIdInput.value.trim();
        if (!clientId) {
            alert('クライアントIDを入力してください。');
            return;
        }

        localStorage.setItem(CONFIG.STORAGE_KEYS.CLIENT_ID, clientId);
        hideConfigModal();
        state.tokenClient = null;
        initGoogleApi();
        alert('設定を保存しました。「Googleでログイン」ボタンをクリックしてください。');
    }

    /**
     * HTMLエスケープ
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * エラーメッセージを表示
     */
    function showError(message) {
        alert(message);
    }

    /**
     * アプリケーションを初期化
     */
    function init() {
        initElements();
        initEventListeners();
        loadSettings();
        initGoogleApi();

        // バージョン情報を表示
        const versionEl = document.getElementById('version-info');
        if (versionEl) {
            versionEl.textContent = `v${CONFIG.VERSION}`;
        }
    }

    // グローバルに公開
    window.app = {
        toggleCalendar: toggleCalendar,
        selectAll: selectAll,
        deselectAll: deselectAll,
        selectRoomsOnly: selectRoomsOnly
    };

    // DOMContentLoaded時に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

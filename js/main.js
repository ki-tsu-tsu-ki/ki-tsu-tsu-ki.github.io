/**
 * 会議室空き状況チェッカー
 * Google Calendar APIを使用して会議室の空き状況をタイムライン表示するアプリ
 */

(function() {
    'use strict';

    // アプリケーション設定
    const CONFIG = {
        SCOPES: 'https://www.googleapis.com/auth/calendar.readonly',
        DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
        STORAGE_KEYS: {
            CLIENT_ID: 'meetingroom_client_id'
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
        allCalendars: [],      // 全カレンダー
        roomCalendars: [],     // 会議室カレンダー（自動検出）
        accessToken: null,
        currentDate: new Date(),
        events: {}
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
        elements.roomInfo = document.getElementById('room-info');
        elements.configModal = document.getElementById('config-modal');
        elements.clientIdInput = document.getElementById('client-id-input');
        elements.saveConfigBtn = document.getElementById('save-config-btn');
        elements.cancelConfigBtn = document.getElementById('cancel-config-btn');
        elements.configBtn = document.getElementById('config-btn');
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

        updateDateInput();
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
     * カレンダー一覧を取得し、会議室を自動検出
     */
    async function fetchCalendarList() {
        elements.timelineContainer.innerHTML = '<p class="placeholder-text">カレンダー情報を取得中...</p>';
        elements.roomInfo.innerHTML = '';

        try {
            const response = await gapi.client.calendar.calendarList.list({
                showHidden: false,
                showDeleted: false
            });

            state.allCalendars = response.result.items || [];

            // 会議室カレンダーを自動検出
            state.roomCalendars = state.allCalendars.filter(cal => isRoomCalendar(cal));

            // 会議室情報を表示
            renderRoomInfo();

            // イベントを読み込んで表示
            loadEventsAndRender();
        } catch (error) {
            console.error('カレンダー一覧取得エラー:', error);
            elements.timelineContainer.innerHTML = '<p class="error-message">カレンダー一覧の取得に失敗しました</p>';
        }
    }

    /**
     * 会議室カレンダーかどうかを判定
     */
    function isRoomCalendar(calendar) {
        // Google Workspaceの会議室リソースを検出
        if (calendar.id.includes('resource.calendar.google.com')) {
            return true;
        }

        // freeBusyReader権限のカレンダー（会議室の典型的な権限）
        if (calendar.accessRole === 'freeBusyReader') {
            return true;
        }

        // 名前に「会議室」「MTG」「Room」などが含まれるカレンダー
        const roomKeywords = ['会議室', '会議', 'meeting', 'room', 'mtg', 'conf', '応接'];
        const summary = (calendar.summary || '').toLowerCase();
        if (roomKeywords.some(keyword => summary.includes(keyword.toLowerCase()))) {
            return true;
        }

        return false;
    }

    /**
     * 会議室情報を表示
     */
    function renderRoomInfo() {
        if (state.roomCalendars.length === 0) {
            elements.roomInfo.innerHTML = `
                <p class="room-info-text">会議室が見つかりませんでした。Googleカレンダーに会議室リソースを追加してください。</p>
            `;
            return;
        }

        const roomNames = state.roomCalendars.map(cal => cal.summary || cal.id).join('、');
        elements.roomInfo.innerHTML = `
            <p class="room-info-text">${state.roomCalendars.length}件の会議室を検出: ${escapeHtml(roomNames)}</p>
        `;
    }

    /**
     * イベントを読み込んでタイムラインを描画
     */
    async function loadEventsAndRender() {
        if (state.roomCalendars.length === 0) {
            elements.timelineContainer.innerHTML = `
                <div class="no-rooms-message">
                    <p>会議室が見つかりませんでした</p>
                    <p>Googleカレンダーに会議室リソースが登録されているか確認してください</p>
                </div>
            `;
            return;
        }

        elements.timelineContainer.innerHTML = '<p class="placeholder-text">予約状況を読み込み中...</p>';

        const dateStr = formatDateForInput(state.currentDate);
        const timeMin = new Date(`${dateStr}T00:00:00`).toISOString();
        const timeMax = new Date(`${dateStr}T23:59:59`).toISOString();

        try {
            const eventPromises = state.roomCalendars.map(cal =>
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

            state.events = {};
            results.forEach(result => {
                state.events[result.calendarId] = result.events;
            });

            renderTimeline();
        } catch (error) {
            console.error('イベント取得エラー:', error);
            elements.timelineContainer.innerHTML = '<p class="error-message">予約情報の取得に失敗しました</p>';
        }
    }

    /**
     * タイムラインを描画
     */
    function renderTimeline() {
        const { START_HOUR, END_HOUR, SLOT_HEIGHT } = CONFIG.TIMELINE;
        const totalSlots = (END_HOUR - START_HOUR) * 2;

        let html = `<div class="timeline-grid" style="grid-template-columns: 60px repeat(${state.roomCalendars.length}, 1fr);">`;

        // ヘッダー行
        html += '<div class="timeline-header">';
        html += '<div class="timeline-header-cell time-column">時間</div>';

        state.roomCalendars.forEach(cal => {
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
            html += `<div class="timeline-time">${timeLabel}</div>`;

            state.roomCalendars.forEach(cal => {
                const cellClass = isHourStart ? 'timeline-cell hour-start' : 'timeline-cell';
                html += `<div class="${cellClass}" data-calendar="${escapeHtml(cal.id)}" data-slot="${slot}">`;

                const events = state.events[cal.id] || [];
                events.forEach(event => {
                    const eventStart = new Date(event.start.dateTime || event.start.date);
                    const eventEnd = new Date(event.end.dateTime || event.end.date);

                    const slotStart = new Date(state.currentDate);
                    slotStart.setHours(hour, minute, 0, 0);
                    const slotEnd = new Date(slotStart);
                    slotEnd.setMinutes(slotEnd.getMinutes() + 30);

                    if (eventStart >= slotStart && eventStart < slotEnd) {
                        const durationMinutes = (eventEnd - eventStart) / (1000 * 60);
                        const durationSlots = Math.ceil(durationMinutes / 30);
                        const height = durationSlots * SLOT_HEIGHT - 4;

                        const eventTitle = event.summary || '(予約)';
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
        state.allCalendars = [];
        state.roomCalendars = [];
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
    }

    // DOMContentLoaded時に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

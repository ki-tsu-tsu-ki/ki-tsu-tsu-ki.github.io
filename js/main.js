/**
 * 会議室空き状況チェッカー
 * Google Calendar APIを使用して会議室の空き状況を確認するアプリ
 */

(function() {
    'use strict';

    // アプリケーション設定
    const CONFIG = {
        SCOPES: 'https://www.googleapis.com/auth/calendar.readonly',
        DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
        STORAGE_KEYS: {
            CLIENT_ID: 'meetingroom_client_id',
            SELECTED_CALENDARS: 'meetingroom_selected_calendars'
        }
    };

    // アプリケーション状態
    const state = {
        isSignedIn: false,
        tokenClient: null,
        calendars: [],
        selectedCalendarIds: new Set(),
        accessToken: null
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
        elements.calendarListContainer = document.getElementById('calendar-list-container');
        elements.refreshCalendarsBtn = document.getElementById('refresh-calendars-btn');
        elements.dateInput = document.getElementById('date-input');
        elements.startTime = document.getElementById('start-time');
        elements.endTime = document.getElementById('end-time');
        elements.checkAvailabilityBtn = document.getElementById('check-availability-btn');
        elements.availabilityResults = document.getElementById('availability-results');
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
        elements.refreshCalendarsBtn.addEventListener('click', fetchCalendarList);
        elements.checkAvailabilityBtn.addEventListener('click', handleCheckAvailability);
        elements.configBtn.addEventListener('click', showConfigModal);
        elements.saveConfigBtn.addEventListener('click', handleSaveConfig);
        elements.cancelConfigBtn.addEventListener('click', hideConfigModal);

        // 日付入力のデフォルト値を今日に設定
        elements.dateInput.value = new Date().toISOString().split('T')[0];
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
            // GAPI クライアントの初期化を待つ
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

            // Token Client の初期化を待つ
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
                headers: {
                    'Authorization': `Bearer ${state.accessToken}`
                }
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
        elements.calendarListContainer.innerHTML = '<p class="placeholder-text">カレンダー一覧を読み込み中...</p>';

        try {
            const response = await gapi.client.calendar.calendarList.list({
                showHidden: false,
                showDeleted: false
            });

            state.calendars = response.result.items || [];
            renderCalendarList();
        } catch (error) {
            console.error('カレンダー一覧取得エラー:', error);
            let errorMessage = 'カレンダー一覧の取得に失敗しました。';
            if (error.result && error.result.error) {
                errorMessage += ` (${error.result.error.message})`;
            }
            elements.calendarListContainer.innerHTML = `<p class="error-message">${escapeHtml(errorMessage)}</p>`;
        }
    }

    /**
     * カレンダー一覧を描画
     */
    function renderCalendarList() {
        if (state.calendars.length === 0) {
            elements.calendarListContainer.innerHTML = '<p class="placeholder-text">カレンダーが見つかりませんでした</p>';
            return;
        }

        // カレンダーを種類別に分類
        const primaryCalendar = state.calendars.find(cal => cal.primary);
        const resourceCalendars = state.calendars.filter(cal =>
            cal.id.includes('resource.calendar.google.com') ||
            cal.accessRole === 'freeBusyReader'
        );
        const otherCalendars = state.calendars.filter(cal =>
            !cal.primary &&
            !cal.id.includes('resource.calendar.google.com') &&
            cal.accessRole !== 'freeBusyReader'
        );

        let html = '';

        // マイカレンダー
        if (primaryCalendar) {
            html += '<div class="calendar-section">';
            html += '<h3>マイカレンダー</h3>';
            html += renderCalendarItem(primaryCalendar);
            html += '</div>';
        }

        // 会議室・リソース
        if (resourceCalendars.length > 0) {
            html += '<div class="calendar-section">';
            html += '<h3>会議室・リソース</h3>';
            html += resourceCalendars.map(cal => renderCalendarItem(cal)).join('');
            html += '</div>';
        }

        // その他のカレンダー
        if (otherCalendars.length > 0) {
            html += '<div class="calendar-section">';
            html += '<h3>その他のカレンダー</h3>';
            html += otherCalendars.map(cal => renderCalendarItem(cal)).join('');
            html += '</div>';
        }

        // 全選択/全解除ボタン
        html = `
            <div class="calendar-actions">
                <button class="btn btn-small btn-secondary" onclick="app.selectAll()">全選択</button>
                <button class="btn btn-small btn-secondary" onclick="app.deselectAll()">全解除</button>
            </div>
        ` + html;

        elements.calendarListContainer.innerHTML = html;
    }

    /**
     * カレンダーアイテムを描画
     */
    function renderCalendarItem(calendar) {
        const isChecked = state.selectedCalendarIds.has(calendar.id);
        const colorStyle = calendar.backgroundColor ? `border-left: 4px solid ${calendar.backgroundColor}` : '';

        return `
            <div class="calendar-item" style="${colorStyle}">
                <label class="calendar-label">
                    <input type="checkbox"
                           value="${escapeHtml(calendar.id)}"
                           ${isChecked ? 'checked' : ''}
                           onchange="app.toggleCalendar('${escapeHtml(calendar.id)}')">
                    <span class="calendar-name">${escapeHtml(calendar.summary || calendar.id)}</span>
                </label>
                <span class="calendar-id">${escapeHtml(calendar.id)}</span>
            </div>
        `;
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
    }

    /**
     * 全選択
     */
    function selectAll() {
        state.calendars.forEach(cal => state.selectedCalendarIds.add(cal.id));
        saveSelectedCalendars();
        renderCalendarList();
    }

    /**
     * 全解除
     */
    function deselectAll() {
        state.selectedCalendarIds.clear();
        saveSelectedCalendars();
        renderCalendarList();
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
            elements.calendarListContainer.innerHTML = '<p class="placeholder-text">カレンダー一覧を読み込み中...</p>';
        }
    }

    /**
     * 空き状況を確認
     */
    async function handleCheckAvailability() {
        const selectedCalendars = state.calendars.filter(cal =>
            state.selectedCalendarIds.has(cal.id)
        );

        if (selectedCalendars.length === 0) {
            alert('先にカレンダーを選択してください。');
            return;
        }

        const date = elements.dateInput.value;
        const startTime = elements.startTime.value;
        const endTime = elements.endTime.value;

        if (!date || !startTime || !endTime) {
            alert('日付と時間を入力してください。');
            return;
        }

        const timeMin = new Date(`${date}T${startTime}:00`).toISOString();
        const timeMax = new Date(`${date}T${endTime}:00`).toISOString();

        if (new Date(timeMin) >= new Date(timeMax)) {
            alert('終了時刻は開始時刻より後にしてください。');
            return;
        }

        elements.checkAvailabilityBtn.disabled = true;
        elements.checkAvailabilityBtn.textContent = '確認中...';
        elements.availabilityResults.innerHTML = '<p class="placeholder-text">空き状況を確認中...</p>';

        try {
            const response = await gapi.client.calendar.freebusy.query({
                timeMin: timeMin,
                timeMax: timeMax,
                items: selectedCalendars.map(cal => ({ id: cal.id }))
            });

            renderAvailabilityResults(response.result, selectedCalendars, timeMin, timeMax);
        } catch (error) {
            console.error('空き状況確認エラー:', error);
            let errorMessage = '空き状況の確認に失敗しました。';
            if (error.result && error.result.error) {
                errorMessage += ` (${error.result.error.message})`;
            }
            elements.availabilityResults.innerHTML = `<p class="error-message">${escapeHtml(errorMessage)}</p>`;
        } finally {
            elements.checkAvailabilityBtn.disabled = false;
            elements.checkAvailabilityBtn.textContent = '空き状況を確認';
        }
    }

    /**
     * 空き状況結果を描画
     */
    function renderAvailabilityResults(result, selectedCalendars, timeMin, timeMax) {
        const calendarsData = result.calendars;
        const queryStart = new Date(timeMin);
        const queryEnd = new Date(timeMax);

        let html = '';

        for (const calendar of selectedCalendars) {
            const calendarData = calendarsData[calendar.id];
            const calendarName = calendar.summary || calendar.id;
            const colorStyle = calendar.backgroundColor ? `border-left-color: ${calendar.backgroundColor}` : '';

            if (!calendarData) {
                html += `
                    <div class="room-availability busy" style="${colorStyle}">
                        <div class="room-availability-header">
                            <span class="room-availability-name">${escapeHtml(calendarName)}</span>
                            <span class="status-badge busy">エラー</span>
                        </div>
                        <div class="busy-slots">カレンダー情報を取得できませんでした</div>
                    </div>
                `;
                continue;
            }

            if (calendarData.errors && calendarData.errors.length > 0) {
                html += `
                    <div class="room-availability busy" style="${colorStyle}">
                        <div class="room-availability-header">
                            <span class="room-availability-name">${escapeHtml(calendarName)}</span>
                            <span class="status-badge busy">エラー</span>
                        </div>
                        <div class="busy-slots">${escapeHtml(calendarData.errors[0].reason)}</div>
                    </div>
                `;
                continue;
            }

            const busySlots = calendarData.busy || [];

            if (busySlots.length === 0) {
                html += `
                    <div class="room-availability available" style="${colorStyle}">
                        <div class="room-availability-header">
                            <span class="room-availability-name">${escapeHtml(calendarName)}</span>
                            <span class="status-badge available">空き</span>
                        </div>
                        <div class="busy-slots">指定時間帯は全て空いています</div>
                    </div>
                `;
            } else {
                const freeSlots = calculateFreeSlots(busySlots, queryStart, queryEnd);
                const statusClass = freeSlots.length > 0 ? 'partial' : 'busy';
                const statusText = freeSlots.length > 0 ? '一部空き' : '予約済み';

                html += `
                    <div class="room-availability ${statusClass}" style="${colorStyle}">
                        <div class="room-availability-header">
                            <span class="room-availability-name">${escapeHtml(calendarName)}</span>
                            <span class="status-badge ${statusClass}">${statusText}</span>
                        </div>
                        <div class="busy-slots">
                            <strong>予約済み:</strong>
                            ${busySlots.map(slot => `
                                <div class="busy-slot">
                                    ${formatTime(new Date(slot.start))} - ${formatTime(new Date(slot.end))}
                                </div>
                            `).join('')}
                            ${freeSlots.length > 0 ? `
                                <br><strong>空き時間:</strong>
                                ${freeSlots.map(slot => `
                                    <div class="busy-slot">
                                        ${formatTime(slot.start)} - ${formatTime(slot.end)}
                                    </div>
                                `).join('')}
                            ` : ''}
                        </div>
                    </div>
                `;
            }
        }

        elements.availabilityResults.innerHTML = html || '<p class="placeholder-text">カレンダーの空き状況を確認できませんでした</p>';
    }

    /**
     * 空き時間スロットを計算
     */
    function calculateFreeSlots(busySlots, queryStart, queryEnd) {
        const freeSlots = [];
        let currentStart = queryStart;

        const sortedBusy = busySlots
            .map(slot => ({
                start: new Date(slot.start),
                end: new Date(slot.end)
            }))
            .sort((a, b) => a.start - b.start);

        for (const busy of sortedBusy) {
            if (currentStart < busy.start) {
                freeSlots.push({
                    start: currentStart,
                    end: busy.start
                });
            }
            if (busy.end > currentStart) {
                currentStart = busy.end;
            }
        }

        if (currentStart < queryEnd) {
            freeSlots.push({
                start: currentStart,
                end: queryEnd
            });
        }

        return freeSlots;
    }

    /**
     * 時刻をフォーマット
     */
    function formatTime(date) {
        return date.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit'
        });
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

        // Google API を再初期化
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

    // グローバルに公開
    window.app = {
        toggleCalendar: toggleCalendar,
        selectAll: selectAll,
        deselectAll: deselectAll
    };

    // DOMContentLoaded時に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

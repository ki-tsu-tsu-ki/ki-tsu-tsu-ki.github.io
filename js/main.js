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
            ROOMS: 'meetingroom_rooms',
            ACCESS_TOKEN: 'meetingroom_access_token'
        }
    };

    // アプリケーション状態
    const state = {
        isSignedIn: false,
        tokenClient: null,
        rooms: [],
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
        elements.roomIdInput = document.getElementById('room-id-input');
        elements.roomNameInput = document.getElementById('room-name-input');
        elements.addRoomBtn = document.getElementById('add-room-btn');
        elements.roomList = document.getElementById('room-list');
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
        elements.addRoomBtn.addEventListener('click', handleAddRoom);
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
        const savedRooms = localStorage.getItem(CONFIG.STORAGE_KEYS.ROOMS);
        if (savedRooms) {
            state.rooms = JSON.parse(savedRooms);
            renderRoomList();
        }

        const savedClientId = localStorage.getItem(CONFIG.STORAGE_KEYS.CLIENT_ID);
        if (savedClientId) {
            elements.clientIdInput.value = savedClientId;
        }
    }

    /**
     * 会議室一覧を保存
     */
    function saveRooms() {
        localStorage.setItem(CONFIG.STORAGE_KEYS.ROOMS, JSON.stringify(state.rooms));
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
                    // gapiがまだ読み込まれていない場合は待機
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
            showError('認証に失敗しました。');
            return;
        }

        state.accessToken = response.access_token;
        state.isSignedIn = true;
        updateUI();
        fetchUserInfo();
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
     * 会議室を追加
     */
    function handleAddRoom() {
        const roomId = elements.roomIdInput.value.trim();
        const roomName = elements.roomNameInput.value.trim() || roomId;

        if (!roomId) {
            alert('会議室カレンダーIDを入力してください。');
            return;
        }

        // 重複チェック
        if (state.rooms.some(room => room.id === roomId)) {
            alert('この会議室は既に登録されています。');
            return;
        }

        state.rooms.push({
            id: roomId,
            name: roomName
        });

        saveRooms();
        renderRoomList();

        // 入力フィールドをクリア
        elements.roomIdInput.value = '';
        elements.roomNameInput.value = '';
    }

    /**
     * 会議室を削除
     */
    function handleRemoveRoom(roomId) {
        state.rooms = state.rooms.filter(room => room.id !== roomId);
        saveRooms();
        renderRoomList();
    }

    /**
     * 会議室一覧を描画
     */
    function renderRoomList() {
        if (state.rooms.length === 0) {
            elements.roomList.innerHTML = '<p class="placeholder-text">会議室が登録されていません</p>';
            return;
        }

        elements.roomList.innerHTML = state.rooms.map(room => `
            <div class="room-item">
                <div class="room-item-info">
                    <div class="room-name">${escapeHtml(room.name)}</div>
                    <div class="room-id">${escapeHtml(room.id)}</div>
                </div>
                <button class="btn btn-danger btn-small" onclick="app.removeRoom('${escapeHtml(room.id)}')">削除</button>
            </div>
        `).join('');
    }

    /**
     * 空き状況を確認
     */
    async function handleCheckAvailability() {
        if (state.rooms.length === 0) {
            alert('先に会議室を追加してください。');
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
                items: state.rooms.map(room => ({ id: room.id }))
            });

            renderAvailabilityResults(response.result, timeMin, timeMax);
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
    function renderAvailabilityResults(result, timeMin, timeMax) {
        const calendars = result.calendars;
        const queryStart = new Date(timeMin);
        const queryEnd = new Date(timeMax);

        let html = '';

        for (const room of state.rooms) {
            const calendarData = calendars[room.id];

            if (!calendarData) {
                html += `
                    <div class="room-availability busy">
                        <div class="room-availability-header">
                            <span class="room-availability-name">${escapeHtml(room.name)}</span>
                            <span class="status-badge busy">エラー</span>
                        </div>
                        <div class="busy-slots">カレンダー情報を取得できませんでした</div>
                    </div>
                `;
                continue;
            }

            if (calendarData.errors && calendarData.errors.length > 0) {
                html += `
                    <div class="room-availability busy">
                        <div class="room-availability-header">
                            <span class="room-availability-name">${escapeHtml(room.name)}</span>
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
                    <div class="room-availability available">
                        <div class="room-availability-header">
                            <span class="room-availability-name">${escapeHtml(room.name)}</span>
                            <span class="status-badge available">空き</span>
                        </div>
                        <div class="busy-slots">指定時間帯は全て空いています</div>
                    </div>
                `;
            } else {
                // 空き時間を計算
                const freeSlots = calculateFreeSlots(busySlots, queryStart, queryEnd);
                const statusClass = freeSlots.length > 0 ? 'partial' : 'busy';
                const statusText = freeSlots.length > 0 ? '一部空き' : '予約済み';

                html += `
                    <div class="room-availability ${statusClass}">
                        <div class="room-availability-header">
                            <span class="room-availability-name">${escapeHtml(room.name)}</span>
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

        elements.availabilityResults.innerHTML = html || '<p class="placeholder-text">会議室の空き状況を確認できませんでした</p>';
    }

    /**
     * 空き時間スロットを計算
     */
    function calculateFreeSlots(busySlots, queryStart, queryEnd) {
        const freeSlots = [];
        let currentStart = queryStart;

        // busySlots を開始時間でソート
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

        alert('設定を保存しました。');
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

    // グローバルに公開（onclickからアクセス用）
    window.app = {
        removeRoom: handleRemoveRoom
    };

    // DOMContentLoaded時に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

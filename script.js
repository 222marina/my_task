// =========================================
// データモデル & 状態管理
// =========================================

let calendarData = [];  // CSV から読み込んだ営業日データ
let allTasksData = {};  // 全日付のタスクデータ { "YYYY-MM-DD": { tasks: [], next: [] }, ... }
let currentDate = getToday();  // 現在表示日付

// =========================================
// ユーティリティ関数
// =========================================

/**
 * 本日の日付を YYYY-MM-DD 形式で返す
 */
function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 指定日の翌営業日を返す（CSV 参照）
 */
function getNextBusinessDay(dateStr) {
  const date = new Date(dateStr);
  let nextDate = new Date(date);
  
  while (true) {
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = formatDate(nextDate);
    
    const record = calendarData.find(r => r['日付'] === nextDateStr);
    if (record && record['稼働日'] === '1') {
      return nextDateStr;
    }
    
    // CSV に無い場合は7日まで探索（無限ループ防止）
    if (nextDate > new Date(dateStr)) {
      const daysDiff = (nextDate - new Date(dateStr)) / (1000 * 60 * 60 * 24);
      if (daysDiff > 7) {
        return nextDateStr;
      }
    }
  }
}

/**
 * Date オブジェクトを YYYY-MM-DD 形式にフォーマット
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 指定日の前営業日を返す
 */
function getPreviousBusinessDay(dateStr) {
  const date = new Date(dateStr);
  let prevDate = new Date(date);
  
  while (true) {
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = formatDate(prevDate);
    
    const record = calendarData.find(r => r['日付'] === prevDateStr);
    if (record && record['稼働日'] === '1') {
      return prevDateStr;
    }
    
    // CSV に無い場合は7日まで探索
    if (date - prevDate > 7 * 24 * 60 * 60 * 1000) {
      return prevDateStr;
    }
  }
}

/**
 * CSV データをパース
 */
function parseCSV(csv) {
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',');
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index];
    });
    data.push(row);
  }
  
  return data;
}

/**
 * ファイルダウンロード
 */
function downloadFile(content, filename, mimeType = 'text/yaml') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =========================================
// データ操作
// =========================================

/**
 * 指定日付のデータを取得（無い場合は初期化）
 */
function getDateData(dateStr) {
  if (!allTasksData[dateStr]) {
    allTasksData[dateStr] = { tasks: [], next: [] };
  }
  return allTasksData[dateStr];
}

/**
 * status 自動管理: detail 編集検知（todo → doing）
 */
function updateStatusByDetail(task) {
  if (task.status === 'todo' && task.detail.trim().length > 0) {
    task.status = 'doing';
  }
}

/**
 * タスクを Done に
 */
function markDone(task) {
  if (task.status === 'done') return;
  task.status = 'done';
}

/**
 * タスクを Carry に
 */
function markCarry(task) {
  task.status = 'carry';
}

/**
 * Carry タスクを next にコピー（保存時）
 */
function buildNextTasks(dateStr) {
  const dateData = getDateData(dateStr);
  dateData.next = [];
  
  dateData.tasks.forEach(task => {
    if (task.status === 'carry') {
      dateData.next.push({
        task: task.task,
        detail: task.detail
      });
    }
  });
}

/**
 * タスクを追加
 */
function addTask(dateStr, title) {
  if (!title.trim()) return;
  
  const dateData = getDateData(dateStr);
  dateData.tasks.push({
    task: title,
    detail: '',
    status: 'todo'
  });
  
  renderCurrentView();
}

/**
 * Detail 編集
 */
function onDetailEdit(dateStr, index, text) {
  const dateData = getDateData(dateStr);
  const task = dateData.tasks[index];
  task.detail = text;
  
  updateStatusByDetail(task);
  renderCurrentView();
}

/**
 * Done 操作
 */
function onDone(dateStr, index) {
  const dateData = getDateData(dateStr);
  const task = dateData.tasks[index];
  markDone(task);
  renderCurrentView();
}

/**
 * Carry 操作
 */
function onCarry(dateStr, index) {
  const dateData = getDateData(dateStr);
  const task = dateData.tasks[index];
  markCarry(task);
  renderCurrentView();
}

// =========================================
// 描画・レンダリング
// =========================================

/**
 * タスクグループを HTML 生成
 */
function renderTaskGroup(groupTitle, tasks, dateStr) {
  const groupDiv = document.createElement('div');
  groupDiv.className = 'task-group';
  
  const titleDiv = document.createElement('h3');
  titleDiv.className = 'task-group-title';
  titleDiv.innerText = groupTitle;
  groupDiv.appendChild(titleDiv);
  
  tasks.forEach((task, index) => {
    const card = document.createElement('div');
    card.className = `task-card status-${task.status}`;
    
    const bar = document.createElement('div');
    bar.className = 'task-bar';
    card.appendChild(bar);
    
    const body = document.createElement('div');
    body.className = 'task-body';
    
    const taskTitle = document.createElement('div');
    taskTitle.className = 'task-title';
    taskTitle.innerText = task.task;
    body.appendChild(taskTitle);
    
    const detail = document.createElement('div');
    detail.className = 'task-detail';
    detail.contentEditable = 'true';
    detail.innerText = task.detail || '';
    detail.oninput = (e) => onDetailEdit(dateStr, index, e.target.innerText);
    body.appendChild(detail);
    
    const actions = document.createElement('div');
    actions.className = 'task-actions';
    
    const carryBtn = document.createElement('button');
    carryBtn.className = 'btn-carry';
    carryBtn.innerText = 'Carry';
    carryBtn.onclick = () => onCarry(dateStr, index);
    actions.appendChild(carryBtn);
    
    const doneBtn = document.createElement('button');
    doneBtn.className = 'btn-done';
    doneBtn.innerText = 'Done';
    doneBtn.onclick = () => onDone(dateStr, index);
    actions.appendChild(doneBtn);
    
    body.appendChild(actions);
    card.appendChild(body);
    groupDiv.appendChild(card);
  });
  
  return groupDiv;
}

/**
 * Today ビュー描画
 */
function renderTodayView() {
  const dateData = getDateData(currentDate);
  const prevDate = getPreviousBusinessDay(currentDate);
  const prevData = getDateData(prevDate);
  
  // タスクパネルをクリア
  const taskPanel = document.querySelector('.task-panel');
  taskPanel.innerHTML = '';
  
  // Prev グループ
  const doneTasks = prevData.tasks.filter(t => t.status === 'done');
  if (doneTasks.length > 0) {
    taskPanel.appendChild(renderTaskGroup('prev', doneTasks, currentDate));
  }
  
  // Today グループ
  const todayTasks = dateData.tasks.filter(t => t.status !== 'done');
  if (todayTasks.length > 0 || dateData.tasks.length === 0) {
    taskPanel.appendChild(renderTaskGroup('today', todayTasks, currentDate));
  }
  
  // カレンダー月表示更新
  updateCalendarDisplay();
  
  // ビュータイトル更新
  document.querySelector('.view-title').innerText = 'Today';
}

/**
 * カレンダー UI 更新
 */
function updateCalendarDisplay() {
  const monthSpan = document.querySelector('.calendar-month');
  monthSpan.innerText = currentDate.substring(0, 7);
}

/**
 * Calendar ビュー描画
 */
function renderCalendarView() {
  document.querySelector('.view-title').innerText = 'Calendar';
  const placeholder = document.querySelector('.view-calendar .placeholder');
  placeholder.innerText = `Calendar View - ${currentDate}`;
}

/**
 * History ビュー描画
 */
function renderHistoryView() {
  document.querySelector('.view-title').innerText = 'History';
  const placeholder = document.querySelector('.view-history .placeholder');
  placeholder.innerText = 'History View（読み取り専用）';
}

/**
 * Settings ビュー描画
 */
function renderSettingsView() {
  document.querySelector('.view-title').innerText = 'Settings';
}

/**
 * 現在のビューを描画
 */
function renderCurrentView() {
  const activeTab = document.querySelector('.nav-item.is-active');
  if (!activeTab) return;
  
  const tabName = activeTab.getAttribute('data-tab');
  
  switch (tabName) {
    case 'today':
      renderTodayView();
      break;
    case 'calendar':
      renderCalendarView();
      break;
    case 'history':
      renderHistoryView();
      break;
    case 'settings':
      renderSettingsView();
      break;
  }
}

// =========================================
// イベントハンドラ
// =========================================

/**
 * タブ切り替え
 */
function setupTabNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      // アクティブクラス更新
      document.querySelectorAll('.nav-item').forEach(ni => ni.classList.remove('is-active'));
      item.classList.add('is-active');
      
      // ビュー切り替え
      const tabName = item.getAttribute('data-tab');
      document.querySelectorAll('.view').forEach(view => view.classList.remove('is-visible'));
      document.querySelector(`.view-${tabName}`).classList.add('is-visible');
      
      renderCurrentView();
    });
  });
}

/**
 * Add ボタン
 */
function setupAddTaskButton() {
  const input = document.querySelector('.task-input');
  const button = document.querySelector('.add-task-button');
  
  button.addEventListener('click', () => {
    addTask(currentDate, input.value);
    input.value = '';
    input.focus();
  });
  
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addTask(currentDate, input.value);
      input.value = '';
    }
  });
}

/**
 * Save ボタン
 */
function setupSaveButton() {
  const button = document.querySelector('.save-button');
  button.addEventListener('click', () => {
    // 全日付の Carry をビルド
    Object.keys(allTasksData).forEach(dateStr => {
      buildNextTasks(dateStr);
    });
    
    // YAML 生成
    let yamlContent = '';
    Object.keys(allTasksData)
      .sort()
      .forEach(dateStr => {
        const dateData = allTasksData[dateStr];
        yamlContent += `${dateStr}:\n`;
        yamlContent += `  tasks:\n`;
        dateData.tasks.forEach(task => {
          yamlContent += `    - task: ${task.task}\n`;
          yamlContent += `      detail: "${task.detail || ''}"\n`;
          yamlContent += `      status: ${task.status}\n`;
        });
        yamlContent += `  next:\n`;
        if (dateData.next.length === 0) {
          yamlContent += `    []\n`;
        } else {
          dateData.next.forEach(task => {
            yamlContent += `    - task: ${task.task}\n`;
            yamlContent += `      detail: "${task.detail || ''}"\n`;
          });
        }
      });
    
    // ダウンロード
    const filename = `tasks_${currentDate}.yaml`;
    downloadFile(yamlContent, filename);
  });
}

/**
 * ダークモード切り替え
 */
function setupDarkMode() {
  const checkbox = document.querySelector('.setting-item input[type="checkbox"]');
  
  // OS 設定を確認
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    checkbox.checked = true;
  }
  
  checkbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      document.documentElement.style.colorScheme = 'dark';
    } else {
      document.documentElement.style.colorScheme = 'light';
    }
  });
}

/**
 * CSV ロード（非同期）
 */
async function loadCalendarData() {
  try {
    const response = await fetch('カレンダー.csv');
    const csv = await response.text();
    calendarData = parseCSV(csv);
    console.log('Calendar data loaded:', calendarData.length, 'records');
  } catch (error) {
    console.error('Failed to load calendar data:', error);
  }
}

// =========================================
// 初期化
// =========================================

async function initApp() {
  // CSV データ読み込み
  await loadCalendarData();
  
  // イベントハンドラ設定
  setupTabNavigation();
  setupAddTaskButton();
  setupSaveButton();
  setupDarkMode();
  
  // 初期描画
  renderCurrentView();
  
  console.log('App initialized');
}

// ページロード時に初期化
document.addEventListener('DOMContentLoaded', initApp);
  
// =========================================
// データモデル & 状態管理
// =========================================

let calendarData = [];  // CSV から読み込んだ営業日データ
let allTasksData = {};  // 全日付のタスクデータ { "YYYY-MM-DD": { tasks: [], next: [] }, ... }
let currentDate = null;  // 現在表示日付
let currentFilename = null;  // 現在開いているYAMLファイル名
let currentFileHandle = null;  // ファイルハンドル（再度保存する時に使用）
let dbInstance = null;  // IndexedDB インスタンス

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
 * IndexedDB の初期化
 */
async function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TaskLogDB', 1);
    
    request.onerror = () => {
      console.error('IndexedDB open error');
      reject(request.error);
    };
    
    request.onsuccess = () => {
      dbInstance = request.result;
      console.log('IndexedDB initialized');
      resolve(dbInstance);
    };
    
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
    };
  });
}

/**
 * IndexedDB にファイルを保存
 */
async function saveToIndexedDB(filename, content) {
  if (!dbInstance) return;
  
  return new Promise((resolve, reject) => {
    const transaction = dbInstance.transaction(['files'], 'readwrite');
    const store = transaction.objectStore('files');
    
    const data = {
      id: 'lastFile',
      filename: filename,
      content: content,
      timestamp: new Date().getTime()
    };
    
    const request = store.put(data);
    
    request.onerror = () => {
      console.error('Failed to save to IndexedDB');
      reject(request.error);
    };
    
    request.onsuccess = () => {
      console.log('Saved to IndexedDB:', filename);
      resolve();
    };
  });
}

/**
 * IndexedDB からファイルを読み込み
 */
async function loadFromIndexedDB() {
  if (!dbInstance) return null;
  
  return new Promise((resolve, reject) => {
    const transaction = dbInstance.transaction(['files'], 'readonly');
    const store = transaction.objectStore('files');
    const request = store.get('lastFile');
    
    request.onerror = () => {
      console.error('Failed to load from IndexedDB');
      reject(request.error);
    };
    
    request.onsuccess = () => {
      const result = request.result;
      if (result) {
        console.log('Loaded from IndexedDB:', result.filename);
        resolve(result);
      } else {
        resolve(null);
      }
    };
  });
}

/**
 * YAML 形式の文字列をパース（シンプルなYAML対応）
 */
function parseYAML(yaml) {
  const data = {};
  const lines = yaml.split('\n');
  let currentDate = null;
  let currentSection = null;
  let currentItem = null;
  
  console.log('Starting YAML parse, total lines:', lines.length);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // 空行はスキップ
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    // 日付行（YYYY-MM-DD:）
    const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}):/);
    if (dateMatch) {
      currentDate = dateMatch[1];
      data[currentDate] = { tasks: [], next: [] };
      currentSection = null;
      currentItem = null;
      console.log('Found date:', currentDate);
      continue;
    }
    
    if (!currentDate) continue;
    
    // セクション行（tasks: や next:）
    if (trimmed === 'tasks:' || trimmed === 'next:') {
      currentSection = trimmed.replace(':', '');
      currentItem = null;
      console.log('Found section:', currentSection, 'for date:', currentDate);
      continue;
    }
    
    // 空の配列表記 []
    if (trimmed === '[]') {
      continue;
    }
    
    // タスク行（- task: ...）
    const taskMatch = trimmed.match(/^-\s+task:\s*(.*)/);
    if (taskMatch && currentSection) {
      currentItem = {
        task: taskMatch[1].trim(),
        detail: '',
        status: 'todo'
      };
      if (currentSection === 'tasks') {
        data[currentDate].tasks.push(currentItem);
        console.log('Added task:', currentItem.task, 'to', currentDate, 'tasks');
      } else if (currentSection === 'next') {
        data[currentDate].next.push(currentItem);
        console.log('Added task:', currentItem.task, 'to', currentDate, 'next');
      }
      continue;
    }
    
    // detail行
    const detailMatch = trimmed.match(/^detail:\s*"?([^"]*)"?/);
    if (detailMatch && currentItem) {
      currentItem.detail = detailMatch[1].trim();
      console.log('Added detail:', currentItem.detail);
      continue;
    }
    
    // status行
    const statusMatch = trimmed.match(/^status:\s*(.*)/);
    if (statusMatch && currentItem) {
      currentItem.status = statusMatch[1].trim();
      console.log('Added status:', currentItem.status);
      continue;
    }
  }
  
  console.log('Parsed YAML data:', data);
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
 * 翌営業日のタスクを生成（nextからコピー）
 * 仕様: 前営業日の next をコピーして、status を todo に設定
 */
function generateNextDayTasks(dateStr) {
  const nextBusinessDay = getNextBusinessDay(dateStr);
  const nextDayData = getDateData(nextBusinessDay);
  
  // 既にタスクがあれば上書きしない（手動編集が優先）
  if (nextDayData.tasks.length > 0) {
    return;
  }
  
  // 前日の next から新規タスクを生成
  const dateData = getDateData(dateStr);
  dateData.next.forEach(task => {
    nextDayData.tasks.push({
      task: task.task,
      detail: task.detail,
      status: 'todo'
    });
  });
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
  
  // 翌営業日のタスクを生成
  generateNextDayTasks(dateStr);
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
function onDetailEdit(dateStr, index, text, cardElement) {
  const dateData = getDateData(dateStr);
  const task = dateData.tasks[index];
  task.detail = text;
  
  updateStatusByDetail(task);
  
  // カードのステータスクラスを動的に更新（再描画はしない）
  if (cardElement) {
    cardElement.className = `task-card status-${task.status}`;
  }
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
    detail.spellcheck = 'false';
    detail.innerText = task.detail || '';
    detail.setAttribute('data-placeholder', '詳細を入力');
    
    // フォーカス時のプレースホルダー処理
    detail.addEventListener('focus', (e) => {
      if (detail.innerText === '') {
        detail.innerText = '';
      }
    });
    
    detail.addEventListener('blur', (e) => {
      if (detail.innerText === '') {
        detail.innerText = '';
      }
    });
    
    detail.addEventListener('input', (e) => {
      onDetailEdit(dateStr, index, e.target.innerText, card);
    });
    
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
  try {
    console.log('renderTodayView called, currentDate:', currentDate);
    
    if (!currentDate) {
      console.error('currentDate is not set');
      return;
    }
    
    const dateData = getDateData(currentDate);
    const prevDate = getPreviousBusinessDay(currentDate);
    const prevData = getDateData(prevDate);
    
    console.log('Current date data:', dateData);
    console.log('Previous date:', prevDate, 'data:', prevData);
    
    // タスクパネルをクリア
    const taskPanel = document.querySelector('.task-panel');
    if (!taskPanel) {
      console.error('task-panel not found');
      return;
    }
    taskPanel.innerHTML = '';
    
    // Prev グループ（前営業日のdoneタスク）
    const doneTasks = prevData.tasks.filter(t => t.status === 'done');
    if (doneTasks.length > 0) {
      const prevGroup = renderTaskGroup('prev', doneTasks, prevDate);
      taskPanel.appendChild(prevGroup);
    }
    
    // Today グループ（当日の全タスク - doneを除く）
    const todayTasks = dateData.tasks.filter(t => t.status !== 'done');
    console.log('Today tasks count:', todayTasks.length);
    const todayGroup = renderTaskGroup('today', todayTasks.length > 0 ? todayTasks : [], currentDate);
    taskPanel.appendChild(todayGroup);
    
    // カレンダー月表示更新
    updateCalendarDisplay();
    
    // ビュータイトル更新
    const titleEl = document.querySelector('.view-title');
    if (titleEl) {
      titleEl.innerText = 'Today';
    }
  } catch (error) {
    console.error('Error in renderTodayView:', error);
  }
}

/**
 * 指定日が営業日かどうかを判定
 */
function isBusinessDay(dateStr) {
  // CSVデータをチェック
  if (calendarData && calendarData.length > 0) {
    const record = calendarData.find(r => r['日付'] === dateStr);
    if (record) {
      // CSVに該当日付がある場合は、CSVの値を使用
      return record['稼働日'] === '1';
    }
  }
  
  // CSVに該当日付がない場合、または CSVが読み込まれていない場合
  // 平日（月-金）を営業日として扱う
  const date = new Date(dateStr);
  const dayOfWeek = date.getDay();
  return dayOfWeek > 0 && dayOfWeek < 6; // 1=月 ... 5=金
}

/**
 * カレンダー UI 更新
 */
function updateCalendarDisplay() {
  try {
    console.log('updateCalendarDisplay called');
    
    const monthSpan = document.querySelector('.calendar-month');
    if (!monthSpan) {
      console.error('calendar-month not found');
      return;
    }
    monthSpan.innerText = currentDate.substring(0, 7);
    
    // 月のカレンダー表示を生成
    const [year, month, day] = currentDate.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    
    const tbody = document.querySelector('.calendar-table tbody');
    if (!tbody) {
      console.error('calendar-table tbody not found');
      return;
    }
    tbody.innerHTML = '';
    
    let date = new Date(startDate);
    while (date <= lastDay || date.getDay() !== 0) {
      const tr = document.createElement('tr');
      
      for (let i = 0; i < 7; i++) {
        const td = document.createElement('td');
        td.innerText = date.getDate();
        
        const dateStr = formatDate(date);
        const isBusiness = isBusinessDay(dateStr);
        
        // 今日をマーク
        if (dateStr === currentDate) {
          td.classList.add('is-today');
        }
        
        // 土日をマーク
        if (date.getDay() === 0 || date.getDay() === 6) {
          td.classList.add('is-weekend');
        }
        
        // 非稼働日を灰色化して選択不可
        if (!isBusiness) {
          td.classList.add('is-non-business');
          td.style.cursor = 'not-allowed';
          td.style.opacity = '0.5';
        } else {
          // クリック時に日付選択（稼働日のみ）
          td.style.cursor = 'pointer';
          td.onclick = () => {
            currentDate = dateStr;
            renderCurrentView();
          };
        }
        
        tr.appendChild(td);
        date.setDate(date.getDate() + 1);
      }
      
      tbody.appendChild(tr);
    }
  } catch (error) {
    console.error('Error in updateCalendarDisplay:', error);
  }
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
  try {
    const activeTab = document.querySelector('.nav-item.is-active');
    if (!activeTab) {
      console.warn('No active tab found');
      return;
    }
    
    const tabName = activeTab.getAttribute('data-tab');
    console.log('renderCurrentView - tabName:', tabName, 'currentDate:', currentDate);
    
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
      default:
        console.warn('Unknown tab:', tabName);
    }
  } catch (error) {
    console.error('Error in renderCurrentView:', error);
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
 * Open ボタン（YAML ファイルを開く）- File System Access API 対応
 */
function setupOpenButton() {
  const button = document.querySelector('.open-button');
  const fileInput = document.getElementById('file-input');
  
  button.addEventListener('click', async () => {
    // File System Access API をサポートしているか確認
    if ('showOpenFilePicker' in window) {
      try {
        const [fileHandle] = await window.showOpenFilePicker({
          types: [{
            description: 'YAML files',
            accept: { 'text/yaml': ['.yaml', '.yml'] }
          }],
          multiple: false
        });
        
        // ファイルハンドルを保存
        currentFileHandle = fileHandle;
        currentFilename = fileHandle.name;
        
        // ファイルを読む
        const file = await fileHandle.getFile();
        const text = await file.text();
        const loadedData = parseYAML(text);
        
        // データを置き換え
        allTasksData = loadedData;
        
        // IndexedDB にも保存
        await saveToIndexedDB(currentFilename, text);
        
        console.log('YAML file loaded (File System API):', currentFilename);
        console.log('File handle saved for later write operations');
        console.log('Loaded data:', allTasksData);
        console.log('All dates in file:', Object.keys(allTasksData));
        
        // ロードしたデータから最初の営業日を選択
        const dates = Object.keys(allTasksData).sort();
        if (dates.length > 0) {
          currentDate = dates[0];
          console.log('Set currentDate to:', currentDate);
        }
        
        // 描画を更新
        renderCurrentView();
        
        alert('ファイルを読み込みました: ' + currentFilename + '\n\n※ このファイルは Save で上書きされます');
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log('File picker cancelled');
        } else {
          console.error('File System API error:', error);
          alert('ファイル選択に失敗しました: ' + error.message);
        }
      }
    } else {
      // フォールバック：File System Access API 未サポート
      console.log('File System Access API not supported, using file input fallback');
      fileInput.click();
    }
  });
  
  // フォールバック用：input type="file"
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const loadedData = parseYAML(text);
      
      // データを置き換え
      allTasksData = loadedData;
      
      // ファイル情報を保存（ハンドルなし）
      currentFilename = file.name;
      currentFileHandle = null;  // File System API は使用できない
      
      // IndexedDB にも保存
      await saveToIndexedDB(currentFilename, text);
      
      console.log('YAML file loaded (file input fallback):', currentFilename);
      console.log('Loaded data:', allTasksData);
      console.log('All dates in file:', Object.keys(allTasksData));
      
      // ロードしたデータから最初の営業日を選択
      const dates = Object.keys(allTasksData).sort();
      if (dates.length > 0) {
        currentDate = dates[0];
        console.log('Set currentDate to:', currentDate);
      }
      
      // 描画を更新
      renderCurrentView();
      
      alert('ファイルを読み込みました: ' + currentFilename + '\n\n※ Save ではダウンロードになります（File System API 未サポート環境）');
    } catch (error) {
      console.error('Failed to load YAML file:', error);
      alert('ファイルの読み込みに失敗しました: ' + error.message);
    }
    
    // ファイル選択をリセット
    fileInput.value = '';
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
  button.addEventListener('click', async () => {
    // 全日付の Carry をビルド
    Object.keys(allTasksData).forEach(dateStr => {
      buildNextTasks(dateStr);
    });
    
    // YAML 生成
    let yamlContent = '';
    const sortedDates = Object.keys(allTasksData).sort();
    
    sortedDates.forEach(dateStr => {
      const dateData = allTasksData[dateStr];
      
      // 空のデータは出力しない
      if (dateData.tasks.length === 0 && dateData.next.length === 0) {
        return;
      }
      
      yamlContent += `${dateStr}:\n`;
      yamlContent += `  tasks:\n`;
      
      if (dateData.tasks.length === 0) {
        yamlContent += `    []\n`;
      } else {
        dateData.tasks.forEach(task => {
          yamlContent += `    - task: ${task.task}\n`;
          yamlContent += `      detail: "${task.detail || ''}"\n`;
          yamlContent += `      status: ${task.status}\n`;
        });
      }
      
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
    
    // ファイルハンドルがある場合は直接上書き
    if (currentFileHandle) {
      try {
        // ファイルに書き込み権限を要求
        const writable = await currentFileHandle.createWritable();
        
        // ファイル内容をクリアして新しい内容を書き込み
        await writable.truncate(0);
        await writable.write(yamlContent);
        await writable.close();
        
        // IndexedDB にも保存
        await saveToIndexedDB(currentFilename, yamlContent);
        
        console.log('File saved (direct overwrite):', currentFilename);
        alert('ファイルを保存しました: ' + currentFilename + '\n\n※ 元のファイルが上書きされました');
      } catch (error) {
        console.error('Failed to save file with File System API:', error);
        
        // フォールバック：ダウンロード
        const filename = currentFilename || `tasks_${currentDate}.yaml`;
        downloadFile(yamlContent, filename);
        
        // IndexedDB にも保存
        if (currentFilename) {
          await saveToIndexedDB(currentFilename, yamlContent);
        }
        
        alert('ファイル保存がエラーになったため、ダウンロードしました: ' + filename);
      }
    } else {
      // File System API が使えない場合はダウンロード
      const filename = currentFilename || `tasks_${currentDate}.yaml`;
      downloadFile(yamlContent, filename);
      
      // IndexedDB にも保存
      if (currentFilename) {
        await saveToIndexedDB(currentFilename, yamlContent);
        console.log('Saved to IndexedDB (no file handle):', filename);
      }
      
      alert('ファイルをダウンロードしました: ' + filename);
    }
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
    
    // デバッグ: 最初と最後のレコードを確認
    if (calendarData.length > 0) {
      console.log('First record:', calendarData[0]);
      console.log('Last record:', calendarData[calendarData.length - 1]);
    }
  } catch (error) {
    console.error('Failed to load calendar data:', error);
    console.warn('Using default business day logic (Mon-Fri)');
  }
}

// =========================================
// 初期化
// =========================================

async function initApp() {
  // 現在日付を設定
  currentDate = getToday();
  console.log('Current date:', currentDate);
  
  // CSV データ読み込み
  await loadCalendarData();
  console.log('Calendar data loaded:', calendarData.length, 'records');
  
  // IndexedDB 初期化
  try {
    await initIndexedDB();
  } catch (error) {
    console.error('Failed to initialize IndexedDB:', error);
  }
  
  // イベントハンドラ設定
  setupTabNavigation();
  setupOpenButton();
  setupAddTaskButton();
  setupSaveButton();
  setupDarkMode();
  
  // 前回開いたファイルを IndexedDB から読み込み
  try {
    const savedFile = await loadFromIndexedDB();
    if (savedFile) {
      console.log('Loading saved file from IndexedDB:', savedFile.filename);
      const loadedData = parseYAML(savedFile.content);
      
      // データを置き換え
      allTasksData = loadedData;
      currentFilename = savedFile.filename;
      
      // ロードしたデータから最初の日付を選択
      const dates = Object.keys(allTasksData).sort();
      if (dates.length > 0) {
        currentDate = dates[0];
        console.log('Set currentDate to:', currentDate);
      }
      
      console.log('Successfully restored saved file');
    }
  } catch (error) {
    console.error('Failed to load saved file from IndexedDB:', error);
  }
  
  // 初期描画
  renderCurrentView();
  
  console.log('App initialized successfully');
}

// ページロード時に初期化
document.addEventListener('DOMContentLoaded', initApp);
  
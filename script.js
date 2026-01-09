// 内部データモデル
let appState = {
    date: getToday(),          // YYYY-MM-DD
    tasks: [],                 // 当日タスク
    next: []                   // 翌日タスク
  };


// status遷移
function updateStatusByDetail(task) {
    if (task.status === "todo" && task.detail.trim().length > 0) {
      task.status = "doing";
    }
  }

  function markDone(task) {
    if (task.status === "done") return;
    task.status = "done";
  }

  function markCarry(task) {
    task.status = "carry";
  }


// --- データバインディング ---

// タスク追加
function addTask(title) {
    if (!title.trim()) return;

    appState.tasks.push({
        task: title,
        detail: "",
        status: "todo"
    });

    renderTasks();
}

// detail 編集検知（todo → doing）
function onDetailEdit(index, text) {
    const task = appState.tasks[index];
    task.detail = text;
  
    updateStatusByDetail(task);
    renderTasks();
  }

// Done/Carry 操作
function onDone(index) {
    markDone(appState.tasks[index]);
    renderTasks();
  }
  
  function onCarry(index) {
    markCarry(appState.tasks[index]);
    renderTasks();
  }

// 描画(status -> UI)
function renderTasks() {
    const todayContainer = document.querySelector(".task-group.today");
    todayContainer.innerHTML = "";
  
    appState.tasks.forEach((task, index) => {
      const card = document.createElement("div");
      card.className = `task-card status-${task.status}`;
  
      card.innerHTML = `
        <div class="task-bar"></div>
        <div class="task-body">
          <div class="task-title">${task.task}</div>
          <div class="task-detail" contenteditable="true"></div>
          <div class="task-actions">
            <button onclick="onCarry(${index})">Carry</button>
            <button onclick="onDone(${index})">Done</button>
          </div>
        </div>
      `;
  
      card.querySelector(".task-detail").innerText = task.detail;
      card.querySelector(".task-detail").oninput = (e) =>
        onDetailEdit(index, e.target.innerText);
  
      todayContainer.appendChild(card);
    });
}


// carry → next 生成（保存時）
function buildNextTasks() {
    appState.next = [];
  
    appState.tasks.forEach(task => {
      if (task.status === "carry") {
        appState.next.push({
          task: task.task,
          detail: task.detail
        });
      }
    });
  }

// 翌日データ生成ルール
function generateNextDayState() {
    const nextDate = getNextBusinessDay(appState.date);
  
    return {
      date: nextDate,
      tasks: appState.next.map(t => ({
        task: t.task,
        detail: t.detail,
        status: "todo"
      })),
      next: []
    };
}

// YAML 生成（保存）
function exportYaml() {
    buildNextTasks();
  
    const data = {
      date: appState.date,
      tasks: appState.tasks,
      next: appState.next
    };
  
    // js-yaml 使用
    const yaml = jsyaml.dump(data);
    download(yaml)
  }
  
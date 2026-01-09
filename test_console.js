// テスト用のコンソールコマンド
// ブラウザのコンソール（F12キーで開く）に貼り付けて実行してください

// 1. 現在の状態を確認
console.log('Current filename:', currentFilename);
console.log('Current date:', currentDate);
console.log('All tasks data keys:', Object.keys(allTasksData));

// 2. IndexedDB の状態を確認
loadFromIndexedDB().then(result => {
  console.log('IndexedDB saved data:', result);
});

// 3. データベースをリセット（テスト用）
function resetIndexedDB() {
  const request = indexedDB.deleteDatabase('TaskLogDB');
  request.onsuccess = () => console.log('IndexedDB reset successful');
  request.onerror = () => console.log('IndexedDB reset failed');
}

// 4. テストデータを保存
async function testSaveData() {
  const testYAML = `2026-01-09:
  tasks:
    - task: "テストタスク"
      detail: "テスト詳細"
      status: doing
  next: []`;
  
  await saveToIndexedDB('test.yaml', testYAML);
  console.log('Test data saved');
}

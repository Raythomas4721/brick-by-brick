import { useRef } from 'react';
import { isIOS, pushSupport } from '../push/client';
import { defaultSettings, emptyData, exportJson, importJson } from '../storage';
import type { AppApi } from '../useApp';
import { localDate } from '../util';

export default function SettingsView({ app }: { app: AppApi }) {
  const { settings } = app.data;
  const fileRef = useRef<HTMLInputElement>(null);
  const support = pushSupport();

  function download() {
    const blob = new Blob([exportJson(app.data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `brick-by-brick-${localDate(Date.now())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function upload(file: File) {
    try {
      const next = importJson(await file.text());
      if (confirm('匯入會覆蓋目前所有資料，確定嗎？')) {
        // push credentials belong to the device that created them; this device subscribes on its own
        app.replaceData({ ...next, settings: { ...defaultSettings(), pushShowTitle: next.settings.pushShowTitle } });
        app.toast('匯入完成');
      }
    } catch {
      app.toast('檔案格式不正確');
    }
  }

  return (
    <div className="settings">
      <section className="card">
        <h2>🔔 推播通知</h2>
        <p>開啟後，就算 App 關著，提醒時間到也會跳出通知，不用另外安裝其他 App。</p>

        {support === 'not-configured' && <p className="hint">推播服務還在設定中，完成後這裡就能開啟。</p>}

        {support === 'install-first' && (
          <>
            <p>iPhone 要先把積木城市加入主畫面，才能收到通知：</p>
            <ol className="steps">
              <li>用 <b>Safari</b> 打開這個網站。</li>
              <li>點下方的「分享」按鈕，選「<b>加入主畫面</b>」。</li>
              <li>從主畫面的積木城市圖示打開，再回到這頁開啟通知。</li>
            </ol>
            <p className="hint">主畫面 App 和 Safari 的資料是分開的；已經有資料的話，先在下面「匯出 JSON」，再到主畫面 App 裡匯入。</p>
          </>
        )}

        {support === 'unsupported' && <p className="hint">這個瀏覽器不支援推播通知。{isIOS() ? '' : '可以改用 Chrome、Edge 或 Safari。'}</p>}

        {support === 'ok' && (
          settings.pushEnabled ? (
            <>
              <p>✅ 這台裝置已開啟推播通知。</p>
              <div className="row">
                <button className="primary" onClick={app.testPush}>送出測試通知</button>
                <button className="ghost danger" onClick={app.turnOffPush}>關閉推播</button>
              </div>
            </>
          ) : (
            <button className="primary" onClick={app.turnOnPush}>開啟推播通知</button>
          )
        )}

        <label className="switch">
          <input type="checkbox" checked={settings.pushShowTitle} onChange={(e) => app.updateSettings({ pushShowTitle: e.target.checked })} />
          通知內容顯示事項標題
        </label>
        <p className="hint">
          提醒時間會存在推播伺服器上，才能在 App 關著時準時送出。預設通知只寫「你有一件高重要性的事項要做」，不會把標題傳上去；勾選上面的選項才會顯示標題。
        </p>
      </section>

      <section className="card">
        <h2>💾 資料</h2>
        <p>事項和遊戲進度只存在這台裝置裡。換手機、換瀏覽器或清除資料前，記得先匯出備份。</p>
        <div className="row">
          <button onClick={download}>匯出 JSON</button>
          <button onClick={() => fileRef.current?.click()}>匯入 JSON</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <button
            className="ghost danger"
            onClick={() => confirm('清除所有事項和遊戲進度？這無法復原。') && app.replaceData(emptyData())}
          >
            全部清除
          </button>
        </div>
      </section>

      <section className="card">
        <h2>📜 規則速查</h2>
        <ul className="rules">
          <li>完成一件事拿 ❤️ 體力 ×1；間隔型（例如喝水）是達到當天目標才算完成。</li>
          <li>每天前三件完成的事是「今日三大建設」：另外送 🔨 鎚子、🔀 洗牌或 ➕5 步其中一個。</li>
          <li>習慣連續 7／30／100 次，各送一個 💎 彩虹積木。</li>
          <li>開一關用 1 顆體力，過關會退回；每天第一次打開送 2 顆，最多存 30 顆。</li>
          <li>關卡無限多：每 10 關是一個大關，過關多送一個道具。</li>
          <li>每週一次自動「請假」：漏掉一次習慣，連續次數不會斷。</li>
          <li>3 天沒完成事項後回來，完成第一件事時送回歸禮 ❤️ ×3。</li>
        </ul>
      </section>
    </div>
  );
}

import { useRef, useState } from 'react';
import { sendTestNtfy } from '../reminders/ntfy';
import { emptyData, exportJson, importJson, randomTopic } from '../storage';
import type { AppApi } from '../useApp';
import { localDate } from '../util';

export default function SettingsView({ app }: { app: AppApi }) {
  const { settings } = app.data;
  const [topic, setTopic] = useState(settings.ntfyTopic);
  const [server, setServer] = useState(settings.ntfyServer);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = topic !== settings.ntfyTopic || server !== settings.ntfyServer;

  async function test() {
    try {
      await sendTestNtfy(settings);
      app.toast('已送出測試推播，看看 ntfy App 有沒有收到');
    } catch {
      app.toast('送出失敗，請確認伺服器網址與網路');
    }
  }

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
        app.replaceData(next);
        setTopic(next.settings.ntfyTopic);
        setServer(next.settings.ntfyServer);
        app.toast('匯入完成');
      }
    } catch {
      app.toast('檔案格式不正確');
    }
  }

  return (
    <div className="settings">
      <section className="card">
        <h2>📱 手機推播（ntfy）</h2>
        <p>網頁關掉時，靠 ntfy 幫你推播提醒。ntfy 最多只能預排 3 天內的提醒，所以每次打開網頁都會自動補滿接下來 3 天（包含每天、每週的重複提醒）。</p>
        <ol className="steps">
          <li>在手機或電腦安裝 <a href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy</a> App（免費）。</li>
          <li>在 App 裡按「訂閱主題」，輸入下面的主題名稱。</li>
          <li>打開下面的開關，按「送出測試」確認收得到。</li>
        </ol>
        <label className="switch">
          <input type="checkbox" checked={settings.ntfyEnabled} onChange={(e) => app.updateSettings({ ntfyEnabled: e.target.checked })} />
          啟用 ntfy 推播
        </label>
        <label>
          主題名稱
          <div className="row">
            <input value={topic} onChange={(e) => setTopic(e.target.value.replace(/[^\w-]/g, ''))} maxLength={64} />
            <button className="ghost" onClick={() => setTopic(randomTopic())}>重新產生</button>
            <button className="ghost" onClick={() => navigator.clipboard?.writeText(topic)}>複製</button>
          </div>
        </label>
        <label>
          伺服器
          <input value={server} onChange={(e) => setServer(e.target.value.trim())} />
        </label>
        <div className="row">
          <button className="primary" disabled={!dirty || !topic} onClick={() => app.updateSettings({ ntfyTopic: topic, ntfyServer: server })}>儲存主題設定</button>
          <button disabled={dirty || !settings.ntfyEnabled} onClick={test}>送出測試</button>
        </div>
        <label className="switch">
          <input type="checkbox" checked={settings.ntfyShowTitle} onChange={(e) => app.updateSettings({ ntfyShowTitle: e.target.checked })} />
          推播內容顯示事項標題
        </label>
        <p className="hint">
          ⚠️ ntfy.sh 公開伺服器上，知道主題名稱的人都能看到推播。預設只顯示「你有一件高重要性的事項要做」，不含標題；主題名稱請保持隨機、不要分享。
        </p>
      </section>

      <section className="card">
        <h2>💾 資料</h2>
        <p>所有資料只存在這個瀏覽器裡。換電腦或清除瀏覽器資料前，記得先匯出備份。</p>
        <div className="row">
          <button onClick={download}>匯出 JSON</button>
          <button onClick={() => fileRef.current?.click()}>匯入 JSON</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <button
            className="ghost danger"
            onClick={() => confirm('清除所有事項和城市進度？這無法復原。') && app.replaceData(emptyData())}
          >
            全部清除
          </button>
        </div>
      </section>

      <section className="card">
        <h2>📜 規則速查</h2>
        <ul className="rules">
          <li>完成事項拿金幣（低 30／中 40／高 50／緊急 60）和 1 個建設點。</li>
          <li>每天前三件完成的事是「今日三大建設」：金幣和建設點都加倍。</li>
          <li>建設點會讓靠路的住宅區、商業區自動長出房子、商店和餐廳；用不完的會先存著（最多 30）。</li>
          <li>幸福度 50 以上住宅可長到 2 級，70 以上可長成公寓。</li>
          <li>每週一次自動「市政假日」：漏掉一次習慣，連續次數不會斷。</li>
          <li>3 天沒完成事項城市會睡著，回來完成一件就天亮，並拿 100 金幣回歸獎勵。</li>
        </ul>
      </section>
    </div>
  );
}

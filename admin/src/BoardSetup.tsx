// Flash a board and set its Wi-Fi and character from this page, over USB
// (board setup spec). The flashing and the serial line are injected so the
// page's logic is tested without hardware.
import { useEffect, useState } from 'react';
import { api } from './api';
import { rememberBoard } from './boardMemory';
import { BoardConsole, ConsoleError, checkWifi, type LinePort } from './boardConsole';
import * as realSerial from './boardSerial';
import { lang, t } from './i18n';
import type { Summary } from './types';
import { SCREENS, FIRMWARE_DRIVERS, screenLabel, type Screen } from '../../core/screens.js';

export interface Serial {
  supportsSerial(): boolean;
  openBoard(known?: SerialPort): Promise<LinePort>;
  flashBoard(manifestUrl: string, onProgress: (percent: number) => void): Promise<SerialPort>;
}

type Step = 'idle' | 'flashing' | 'saving' | 'waiting' | 'reading';

export function BoardSetup({ serial = realSerial, replyTimeoutMs, screens = SCREENS }: { serial?: Serial; replyTimeoutMs?: number; screens?: Screen[] }) {
  const [list, setList] = useState<Summary[] | null>(null);
  const [mode, setMode] = useState<'flash' | 'settings'>('flash');
  const [ssid, setSsid] = useState('');
  const [pass, setPass] = useState('');
  const [character, setCharacter] = useState('');
  // 'keep' leaves the board's own setting alone; 'off' clears it; anything else
  // is a model id the page offered. Never inferred from what the board reported.
  const [screenChoice, setScreenChoice] = useState('keep');
  const [boardScreen, setBoardScreen] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.list().then((l) => { if (live) setList(l); }, () => { if (live) setList([]); });
    return () => { live = false; };
  }, []);

  if (!serial.supportsSerial()) return <p role="alert" className="board-error">{t('boardNeedsChrome')}</p>;

  const busy = step !== 'idle';
  /** Only a panel that was lit on a real board, and that the firmware drives, may be offered. */
  const offered = screens.filter((s) => s.verified && FIRMWARE_DRIVERS.has(s.controller));

  /** Fill the form with what the board holds: name, password, and the character whose token it carries. */
  async function readBoard() {
    setError(null);
    setDone(null);
    setNote(null);
    let port: LinePort | null = null;
    try {
      setStep('reading');
      port = await serial.openBoard();
      const stored = await new BoardConsole(port, { replyTimeoutMs }).readSettings();
      setSsid(stored.ssid);
      setPass(stored.pass);
      // A model this page cannot offer is reported, not written back: the board
      // keeps working with what it has.
      setBoardScreen(stored.screenKnown ? stored.screen : null);
      setScreenChoice('keep');
      // The list holds no tokens: ask for each character's own (never regenerate).
      const details = await Promise.all((list ?? []).map((c) => api.get(c.id)));
      const match = details.find((d) => d.token === stored.token);
      if (match) setCharacter(match.id);
      setNote(match ? t('boardReadDone') : t('boardTokenUnknown'));
    } catch (e) {
      setError(explain(e));
    } finally {
      setStep('idle');
      await port?.close().catch(() => {});
    }
  }

  /** The panel the board is left with, named only when this build knows it. */
  function writtenScreen(): string | null {
    const written = screenChoice === 'off' ? null : screenChoice !== 'keep' ? screenChoice : boardScreen;
    return written !== null && SCREENS.some((s) => s.id === written) ? written : null;
  }

  async function start() {
    setError(null);
    setDone(null);
    const bad = checkWifi(ssid, pass);
    if (bad) return setError(bad === 'bad-ssid' ? t('boardBadSsid') : t('boardBadPass'));
    if (!character) return setError(t('boardNoCharacter'));
    let port: LinePort | null = null;
    try {
      // The token is read, never regenerated: regenerating would disconnect
      // a body already paired with this character. Its setup id comes from the
      // same detail, so the board memory names exactly this pairing.
      const { token, setupId } = await api.get(character);
      let flashed: SerialPort | undefined;
      if (mode === 'flash') {
        setStep('flashing');
        setPercent(0);
        flashed = await serial.flashBoard('/firmware/manifest.json', setPercent);
      }
      setStep('saving');
      port = await serial.openBoard(flashed);
      const board = new BoardConsole(port, { replyTimeoutMs });
      await board.setWifi(ssid, pass);
      await board.useDiscovery();
      await board.setToken(token);
      if (screenChoice === 'off') await board.clearScreen();
      else if (screenChoice !== 'keep') await board.setScreen(screenChoice);
      await board.reboot();
      // A flashed board is remembered even if the reboot drops the USB link
      // before it can greet us: the flash and every write before it succeeded.
      // Changing settings is not a flash, and reading the board says nothing
      // about what this computer put on it.
      if (mode === 'flash') {
        rememberBoard({ characterId: character, setupId, screen: writtenScreen(), flashedAt: Date.now() });
      }
      setStep('waiting');
      setDone(await board.waitWelcomed(15000));
    } catch (e) {
      // A reboot usually drops the USB-CDC link before the board can say
      // anything. That is not a Wi-Fi failure: the board may be online.
      if (e instanceof ConsoleError && e.reason === 'disconnected') setNote(t('boardRebootedNoConfirm'));
      else setError(explain(e));
    } finally {
      setStep('idle');
      await port?.close().catch(() => {});
    }
  }

  /** The label the page shows: models carry a Chinese label beside the SKU. */
  function label(s: Screen): string {
    return screenLabel(s, lang);
  }
  /** A model the board reports may not be in the table at all; then its id is all we have. */
  function nameOf(id: string): string {
    const found = screens.find((s) => s.id === id);
    return found ? label(found) : id;
  }

  return (
    <section className="board">
      <h2>{t('boardTitle')}</h2>
      <p>{t('boardIntro')}</p>
      <fieldset disabled={busy}>
        <label><input type="radio" name="board-mode" checked={mode === 'flash'} onChange={() => setMode('flash')} /> {t('boardModeFlash')}</label>
        <label><input type="radio" name="board-mode" checked={mode === 'settings'} onChange={() => setMode('settings')} /> {t('boardModeSettings')}</label>
        <label>{t('boardWifiName')}<input value={ssid} onChange={(e) => setSsid(e.target.value)} autoComplete="off" /></label>
        <label>{t('boardWifiPass')}<input type="text" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" /></label>
        {list && (
          <label>{t('boardCharacter')}
            <select value={character} onChange={(e) => setCharacter(e.target.value)}>
              <option value="" />
              {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label>{t('boardScreen')}
          <select disabled={!offered.length} value={screenChoice} onChange={(e) => setScreenChoice(e.target.value)}>
            <option value="keep">{t('boardScreenKeep')}</option>
            <option value="off">{t('boardScreenNone')}</option>
            {offered.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}
          </select>
        </label>
        {!offered.length && <p className="board-note">{t('boardScreenNoneYet')}</p>}
        {boardScreen && !offered.some((s) => s.id === boardScreen) && (
          <p role="alert" className="board-error">
            {t('boardScreenUnsupported').replace('{model}', nameOf(boardScreen))}
          </p>
        )}
        {mode === 'settings' && <button type="button" onClick={() => void readBoard()}>{t('boardRead')}</button>}
        <button type="button" onClick={() => void start()}>{t('boardStart')}</button>
      </fieldset>
      <p role="status">
        {step === 'flashing' && `${t('boardFlashing')} ${percent}%`}
        {step === 'saving' && t('boardSaving')}
        {step === 'waiting' && t('boardWaiting')}
        {step === 'reading' && t('boardReading')}
        {step === 'idle' && note}
        {done && `${t('boardConnected')}${done}`}
      </p>
      {error && <p role="alert" className="board-error">{error}</p>}
    </section>
  );
}

function explain(e: unknown): string {
  if (e instanceof ConsoleError) {
    switch (e.reason) {
      case 'bad-ssid': return t('boardBadSsid');
      case 'bad-screen': return t('boardScreenBad');
      case 'bad-pass': return t('boardBadPass');
      case 'no-reply': return t('boardNoReply');
      case 'rejected': return t('boardRejected') + e.message;
      case 'not-welcomed': return t('boardNotWelcomed');
      default: return t('boardFailed') + e.message;
    }
  }
  // The browser's port chooser, closed without a pick.
  if (e instanceof DOMException && e.name === 'NotFoundError') return t('boardCancelled');
  return t('boardFailed') + (e instanceof Error ? e.message : String(e));
}

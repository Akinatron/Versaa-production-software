"use client";

/*
 * "Check for updates" card for the Mac app (development only, see
 * desktop/UPDATER.md). It shows only inside the desktop app built with the
 * updater; in a browser it renders nothing.
 */
import { useEffect, useState } from "react";

type Build = { number: number; commit: string; commitTime: string };
type Status = {
  current: Build;
  blocked?: string;
  last?: { ok: boolean; at: string; from: number; to: number; message?: string };
};
type Check = { available: boolean; latest: Build & { releaseUrl: string }; notes: string[]; wrongArch?: string };
type Bridge = { status(): Promise<Status>; check(): Promise<Check>; install(): Promise<{ ok: boolean }> };

const bridge = (): Bridge | undefined => (globalThis as { versaaDesktop?: { updates?: Bridge } }).versaaDesktop?.updates;

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const label = (b: Build) => `${b.number ? `build ${b.number}` : "a build made on this Mac"} · ${day(b.commitTime)} · ${b.commit.slice(0, 7)}`;
// Errors from the desktop shell arrive as "Error invoking remote method '…': Error: <message>".
const message = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

export function AppUpdates() {
  const [status, setStatus] = useState<Status>();
  const [check, setCheck] = useState<Check>();
  const [state, setState] = useState<"idle" | "checking" | "installing">("idle");
  const [error, setError] = useState<string>();

  useEffect(() => {
    bridge()
      ?.status()
      .then(setStatus)
      .catch((e) => setError(message(e)));
  }, []);

  if (!bridge() || !status) return null;

  async function onCheck() {
    setState("checking");
    setError(undefined);
    try {
      setCheck(await bridge()!.check());
    } catch (e) {
      setError(message(e));
    } finally {
      setState("idle");
    }
  }

  async function onInstall() {
    setState("installing");
    setError(undefined);
    try {
      await bridge()!.install();
    } catch (e) {
      setError(message(e));
      setState("idle");
    }
  }

  const canInstall = check?.available && !check.wrongArch && !status.blocked;

  return (
    <section className="card" aria-labelledby="app-updates-title">
      <div className="card-head">
        <h2 id="app-updates-title">App updates</h2>
      </div>
      <p className="small muted">This copy: {label(status.current)}</p>

      {status.last && !check && (
        <ul className="issues">
          {status.last.ok ? (
            <li className="ok">
              Updated from build {status.last.from} to build {status.last.to} on {day(status.last.at)}. Your data was kept.
            </li>
          ) : (
            <li className="warn">{status.last.message}</li>
          )}
        </ul>
      )}

      {check && !check.available && (
        <ul className="issues">
          <li className="ok">You have the latest version.</li>
        </ul>
      )}

      {check?.available && (
        <ul className="issues">
          <li className="warn">
            <strong>A new version is ready:</strong> {label(check.latest)}.{check.wrongArch && <div className="small text-bad">{check.wrongArch}</div>}
          </li>
        </ul>
      )}
      {check?.available && check.notes.length > 0 && (
        <>
          <p className="small muted">What changed:</p>
          <ul className="small">
            {check.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}

      {status.blocked && check?.available && <p className="small text-bad">{status.blocked}</p>}
      {error && (
        <ul className="issues">
          <li className="bad">{error}</li>
        </ul>
      )}

      {state === "installing" ? (
        <p className="small" role="status">
          Backing up your data and downloading the new version. Versaa will close and open again by itself.
        </p>
      ) : (
        <div className="form-actions">
          {canInstall ? (
            <>
              <button type="button" className="btn" onClick={onInstall}>
                Update now
              </button>
              <span className="small muted">Your database and documents are backed up first. Nothing is lost.</span>
            </>
          ) : (
            <button type="button" className={`btn secondary${state === "checking" ? " is-pending" : ""}`} onClick={onCheck} disabled={state === "checking"}>
              {state === "checking" ? "Checking…" : "Check for updates"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

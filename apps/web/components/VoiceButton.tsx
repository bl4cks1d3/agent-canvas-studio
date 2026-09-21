"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Botão circular flutuante da barra lateral: fale e o Studio executa. O navegador reconhece a fala (Web Speech API, pt-BR) e o texto
 * vai para o construtor ("Criar com Claude"), que roda o Claude Code só com as ferramentas do Studio. Antes de enviar o texto aparece
 * para você conferir/editar, com uma contagem para cancelar: erro de reconhecimento não vira ação sem você ver.
 *
 * Privacidade: quem transcreve é o serviço de voz do navegador (no Chrome e no Edge o áudio vai para o servidor deles). O Studio só
 * recebe o texto. Firefox não tem reconhecimento de voz.
 */

interface SpeechAlt {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlt;
  length: number;
}
interface SpeechEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

const AUTO_KEY = "studio-voice-auto";
const COUNTDOWN = 4;

const ERRORS: Record<string, string> = {
  "not-allowed": "O microfone está bloqueado. Permita o microfone para este endereço (ícone de cadeado na barra do navegador) e tente de novo.",
  "service-not-allowed": "O navegador não deixou usar o reconhecimento de voz aqui.",
  "no-speech": "Não ouvi nada. Clique e fale logo em seguida.",
  "audio-capture": "Nenhum microfone encontrado.",
  network: "O reconhecimento de voz do navegador precisa de internet (ele usa o serviço de voz do próprio navegador).",
  "language-not-supported": "O navegador não reconhece português neste dispositivo.",
};

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "0";
  } catch {
    return true;
  }
}

type Phase = "idle" | "listening" | "review" | "error";

export default function VoiceButton({ onCommand }: { onCommand: (text: string) => void }) {
  const [supported, setSupported] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(true);
  const [count, setCount] = useState<number | null>(null);

  const recRef = useRef<Recognition | null>(null);
  const textRef = useRef("");
  const phaseRef = useRef<Phase>("idle");
  const failedRef = useRef(false);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  useEffect(() => {
    setSupported(getCtor() !== null);
    setAuto(readAuto());
    return () => {
      const r = recRef.current;
      if (r) {
        r.onresult = r.onerror = r.onend = null;
        try {
          r.abort();
        } catch {
          // já parado
        }
      }
    };
  }, []);

  const send = useCallback(() => {
    const value = textRef.current.trim();
    setCount(null);
    if (!value) return;
    onCommandRef.current(value);
    textRef.current = "";
    setText("");
    setPhaseBoth("idle");
  }, [setPhaseBoth]);

  function cancel() {
    const r = recRef.current;
    if (r) {
      r.onresult = r.onerror = r.onend = null;
      try {
        r.abort();
      } catch {
        // já parado
      }
      recRef.current = null;
    }
    setCount(null);
    textRef.current = "";
    setText("");
    setError("");
    setPhaseBoth("idle");
  }

  // contagem regressiva do envio automático (pausa assim que você mexe no texto)
  useEffect(() => {
    if (count === null) return;
    if (count <= 0) {
      send();
      return;
    }
    const t = setTimeout(() => setCount((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [count, send]);

  function fail(message: string) {
    failedRef.current = true;
    setError(message);
    setPhaseBoth("error");
  }

  function start() {
    const Ctor = getCtor();
    if (!Ctor) {
      setSupported(false);
      fail("Este navegador não tem reconhecimento de voz. Use o Chrome ou o Edge.");
      return;
    }
    setCount(null);
    setError("");
    textRef.current = "";
    setText("");
    failedRef.current = false;
    const rec = new Ctor();
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let out = "";
      for (let i = 0; i < e.results.length; i++) out += e.results[i][0].transcript;
      textRef.current = out;
      setText(out);
    };
    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      fail(ERRORS[e.error] ?? `Não consegui ouvir (${e.error}).`);
    };
    rec.onend = () => {
      recRef.current = null;
      if (failedRef.current || phaseRef.current !== "listening") return;
      if (!textRef.current.trim()) return fail(ERRORS["no-speech"]);
      setPhaseBoth("review");
      setCount(readAuto() ? COUNTDOWN : null);
    };
    recRef.current = rec;
    try {
      rec.start();
      setPhaseBoth("listening");
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  function toggle() {
    if (phase === "listening") {
      recRef.current?.stop();
      return;
    }
    start();
  }

  function toggleAuto(on: boolean) {
    setAuto(on);
    try {
      localStorage.setItem(AUTO_KEY, on ? "1" : "0");
    } catch {
      // sem armazenamento: vale só nesta aba
    }
    if (!on) setCount(null);
    else if (phase === "review") setCount(COUNTDOWN);
  }

  const listening = phase === "listening";
  const label = !supported ? "Voz indisponível neste navegador (use Chrome ou Edge)" : listening ? "Parar e conferir" : "Falar com o Studio";

  return (
    <div className="voice-wrap" data-phase={phase}>
      {(phase !== "idle" || !supported) && (
        <div className="voice-bubble" role="status" aria-live="polite">
          {phase === "listening" && (
            <>
              <div className="voice-hint">Ouvindo… fale o que o Studio deve fazer.</div>
              <div className="voice-text">{text || "…"}</div>
              <div className="voice-actions">
                <button className="btn btn-sm" onClick={() => recRef.current?.stop()}>
                  Terminei
                </button>
                <button className="btn btn-sm" onClick={cancel}>
                  Cancelar
                </button>
              </div>
            </>
          )}
          {phase === "review" && (
            <>
              <div className="voice-hint">{count !== null ? `Enviando em ${count}s… edite para pausar.` : "Confira e envie."}</div>
              <textarea
                className="input voice-edit"
                rows={3}
                value={text}
                onFocus={() => setCount(null)}
                onChange={(e) => {
                  textRef.current = e.target.value;
                  setText(e.target.value);
                  setCount(null);
                }}
              />
              <div className="voice-actions">
                <button className="btn btn-primary btn-sm" onClick={send} disabled={!text.trim()}>
                  Enviar
                </button>
                <button className="btn btn-sm" onClick={start} title="Regravar">
                  Regravar
                </button>
                <button className="btn btn-sm" onClick={cancel}>
                  Cancelar
                </button>
              </div>
              <label className="voice-auto">
                <input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} /> Enviar sozinho após {COUNTDOWN}s
              </label>
            </>
          )}
          {phase === "error" && (
            <>
              <div className="voice-error">{error}</div>
              <div className="voice-actions">
                {supported && (
                  <button className="btn btn-sm" onClick={start}>
                    Tentar de novo
                  </button>
                )}
                <button className="btn btn-sm" onClick={cancel}>
                  Fechar
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <button
        type="button"
        className={`voice-fab${listening ? " listening" : ""}${!supported ? " off" : ""}`}
        onClick={toggle}
        aria-label={label}
        aria-pressed={listening}
        title={label}
      >
        {listening ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
          </svg>
        )}
      </button>
    </div>
  );
}

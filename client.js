/**
 * Live token-throughput meter for the Harness Web chat composer.
 *
 * The meter registers one entry in the composer dock (`conversation.composer.dock`)
 * and renders:
 *
 *   - the current output speed (tokens/s) while a step streams,
 *   - the live output token count of the step being generated,
 *   - the prompt tokens of the turn's request,
 *   - a details panel with exact provider accounting once a step settles.
 *
 * Why the numbers differ while streaming: providers report exact usage exactly
 * once, at the end of the stream, so nothing in the product can know the true
 * output-token count while it is being generated. The live figure therefore
 * prices the streamed delta text with a fixed density heuristic (four characters
 * per token for narrow text, 1.6 characters per token for CJK text); the moment
 * the step settles the meter switches to the provider-reported usage the Host
 * already folds into the `tokenUsage` and `sessionStats` projections.
 *
 * Everything here is derived from state the Client already computes — the live
 * Assistant stream folded into the chat snapshot (`legacy.partial`) and Session
 * projections — so the plugin subscribes to nothing itself and writes no DOM
 * outside its own component.
 */

window.__ModuleLoader__.load({
  id: "dsh-token-speed",
  factory: (require) => {
    const React = require("react");
    const ReactDOM = require("react-dom");

    const h = React.createElement;

    /** Locale namespace and style ownership tag. */
    const NS = "dsh-token-speed";
    const CSS_TAG = NS + "/client.css";
    /** Declared by `@deepseek-ai/dsh-client-ui-conversation`; one list entry among siblings. */
    const SLOT = "conversation.composer.dock";

    /** Rolling window used for the live speed. */
    const SPEED_WINDOW_MS = 2000;
    /** Re-render cadence while a step runs, so a stalled stream decays instead of freezing. */
    const TICK_MS = 200;
    /** Speed-history bars: BAR_SLOTS buckets of BAR_MS covering the recent past. */
    const BAR_SLOTS = 40;
    const BAR_MS = 200;
    /** Sample history kept for the bars (four windows). */
    const SAMPLE_KEEP_MS = SPEED_WINDOW_MS * 4;
    /** Fixed-density pricing, matching the harness's own estimate for narrow text. */
    const NARROW_CHARS_PER_TOKEN = 4;
    /** CJK text is far denser per character; the harness heuristic underprices it badly. */
    const WIDE_CHARS_PER_TOKEN = 1.6;

    /** Static stylesheet, injected on activation and removed with the plugin. */
    const CSS = [
      ".dtsRoot{min-width:0;display:inline-flex;align-items:center}",
      ".dtsPill{box-sizing:border-box;corner-shape:round;max-width:100%;color:var(--dsw-alias-label-tertiary);",
      "font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);font-variant-numeric:tabular-nums;",
      "line-height:inherit;white-space:nowrap;background:0 0;border:none;border-radius:999px;cursor:pointer;",
      "align-items:center;gap:6px;padding:1px 8px;display:inline-flex}",
      ".dtsPill:hover,.dtsPill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
      ".dtsPill:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:1px}",
      ".dtsPill svg{flex:none;width:14px;height:14px}",
      ".dtsDot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}",
      ".dtsDot[data-live=true]{background:var(--dsw-static-green-500)}",
      ".dtsDot[data-live=pulse]{background:var(--dsw-static-green-500);animation:dtsPulse 1.1s ease-in-out infinite}",
      "@keyframes dtsPulse{0%,100%{opacity:1}50%{opacity:.25}}",
      "@media (prefers-reduced-motion:reduce){.dtsDot[data-live=pulse]{animation:none}}",
      ".dtsRate{color:var(--dsw-alias-label-secondary)}",
      ".dtsSep{color:var(--dsw-alias-separator-primary);margin:0 2px}",
      ".dtsStat{color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;gap:3px}",
      ".dtsArrow{font-size:11px;line-height:1;color:var(--dsw-alias-label-caption)}",
      ".dtsPanel{z-index:1100;box-sizing:border-box;position:fixed;border-radius:var(--dsw-radius-lg);",
      "background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);",
      "--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);",
      "color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:16px;font-size:12px;line-height:18px}",
      ".dtsTitle{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;",
      "font-weight:500;display:flex;align-items:center}",
      ".dtsTitleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}",
      ".dtsTitleLabel svg{flex:none;width:14px;height:14px}",
      ".dtsTitleValue{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);font-weight:400}",
      ".dtsRule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}",
      ".dtsSection{color:var(--dsw-alias-label-caption);margin:12px 0 6px;font-size:11px;text-transform:uppercase;",
      "letter-spacing:.4px}",
      ".dtsSection:first-of-type{margin-top:0}",
      ".dtsDetails{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);",
      "gap:6px 16px;margin:0;display:grid}",
      ".dtsDetails dt,.dtsDetails dd{min-width:0;margin:0}",
      ".dtsDetails dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}",
      ".dtsMuted{color:var(--dsw-alias-label-caption)}",
      ".dtsBars{display:flex;align-items:flex-end;gap:1px;height:28px;margin-top:8px}",
      ".dtsBar{flex:1;min-width:0;background:var(--dsw-static-deepseek-450);border-radius:1px;height:1px}",
      ".dtsBar[data-empty=true]{background:var(--dsw-alias-border-l2)}",
      ".dtsMeter{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:hidden;margin-top:6px}",
      ".dtsMeterFill{height:100%;background:var(--dsw-static-deepseek-450)}",
      ".dtsNote{color:var(--dsw-alias-label-caption);margin-top:10px;font-size:11px;line-height:16px}",
      ".dtsClose{background:0 0;border:none;color:var(--dsw-alias-label-caption);cursor:pointer;font:inherit;",
      "padding:0 2px;line-height:1}",
      ".dtsClose:hover{color:var(--dsw-alias-label-secondary)}"
    ].join("");

    const ZH = {
      "unit.tps": "tok/s",
      "unit.tokens": "tok",
      "phase.waiting": "等待首字",
      "phase.streaming": "生成中",
      "phase.settled": "已完成",
      "pill.aria": "实时 Token 速度：{tps} tok/s，输入 {input}，输出 {output}",
      "pill.title": "实时 Token 速度（点击查看详情）",
      "tip.input": "本轮请求的输入（提示词）Token",
      "tip.output": "本步生成的输出 Token",
      "dialog.title": "实时 Token 速度",
      "dialog.close": "关闭",
      "row.phase": "状态",
      "row.elapsed": "已用时",
      "section.input": "输入 · 提示词",
      "row.inputTotal": "输入合计",
      "row.uncached": "未缓存",
      "row.cacheRead": "缓存读取",
      "row.cacheWrite": "缓存写入",
      "row.cacheHit": "缓存命中率",
      "row.context": "上下文占用",
      "section.output": "输出 · 生成",
      "row.output": "输出 Token",
      "row.ttft": "首字延迟",
      "row.decode": "解码时长",
      "row.llm": "模型耗时",
      "row.tool": "工具耗时",
      "row.speedLive": "实时速度",
      "row.speedAvg": "平均速度",
      "section.session": "会话累计",
      "row.sessionIn": "累计输入",
      "row.sessionOut": "累计输出",
      "row.sessionSpeed": "平均速度",
      "row.turns": "轮次 / 步数",
      "value.estimate": "{value}（估算）",
      "value.exact": "{value}（精确）",
      "value.waiting": "等待中…",
      "note.live": "生成中：输入为上下文投影，输出 Token 与速度为流式字符估算；缓存分桶来自最近一次 provider 上报。",
      "note.settled": "已完成：全部数值来自 provider 上报的精确用量。",
      "empty": "—"
    };

    const EN = {
      "unit.tps": "tok/s",
      "unit.tokens": "tok",
      "phase.waiting": "waiting for first token",
      "phase.streaming": "generating",
      "phase.settled": "completed",
      "pill.aria": "Live token speed: {tps} tok/s, input {input}, output {output}",
      "pill.title": "Live token speed (click for details)",
      "tip.input": "Prompt (input) tokens of this request",
      "tip.output": "Output tokens generated in this step",
      "dialog.title": "Live token speed",
      "dialog.close": "Close",
      "row.phase": "State",
      "row.elapsed": "Elapsed",
      "section.input": "Input · prompt",
      "row.inputTotal": "Input total",
      "row.uncached": "Uncached",
      "row.cacheRead": "Cache read",
      "row.cacheWrite": "Cache write",
      "row.cacheHit": "Cache hit rate",
      "row.context": "Context occupancy",
      "section.output": "Output · generation",
      "row.output": "Output tokens",
      "row.ttft": "Time to first token",
      "row.decode": "Decode time",
      "row.llm": "Model time",
      "row.tool": "Tool time",
      "row.speedLive": "Live speed",
      "row.speedAvg": "Average speed",
      "section.session": "Session totals",
      "row.sessionIn": "Input total",
      "row.sessionOut": "Output total",
      "row.sessionSpeed": "Average speed",
      "row.turns": "Turns / steps",
      "value.estimate": "{value} (estimated)",
      "value.exact": "{value} (exact)",
      "value.waiting": "waiting…",
      "note.live": "While generating, input is the context projection and output tokens and speed are streamed-text estimates; cache buckets come from the most recent provider report.",
      "note.settled": "Settled: every figure comes from exact provider-reported usage.",
      "empty": "—"
    };

    /** Character ranges that tokenize far denser than the narrow-text heuristic. */
    const WIDE_RANGES = [
      [0x1100, 0x11ff], [0x2e80, 0x303f], [0x3040, 0x30ff], [0x3130, 0x318f],
      [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa960, 0xa97f], [0xac00, 0xd7ff],
      [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xffef], [0x1f300, 0x1faff]
    ];

    /**
     * Whether one UTF-16 code unit belongs to a dense (CJK) script.
     * @param code - character code.
     * @returns true for wide ranges.
     */
    function isWide(code) {
      for (let index = 0; index < WIDE_RANGES.length; index += 1) {
        const range = WIDE_RANGES[index];
        if (code >= range[0] && code <= range[1]) return true;
      }
      return false;
    }

    /**
     * Count one text run in heuristic character classes.
     * @param text - text to measure.
     * @returns wide and narrow character counts.
     */
    function countText(text) {
      let wide = 0;
      let narrow = 0;
      for (let index = 0; index < text.length; index += 1) {
        if (isWide(text.charCodeAt(index))) wide += 1;
        else narrow += 1;
      }
      return { wide, narrow };
    }

    /**
     * The model-visible text of one streamed assistant block.
     * @param block - chat assistant block.
     * @returns its text, or an empty string for blocks that carry none.
     */
    function blockText(block) {
      if (!block || typeof block !== "object") return "";
      if (block.kind === "text" || block.kind === "reasoning") {
        return typeof block.text === "string" ? block.text : "";
      }
      if (block.kind === "tool-call") {
        return String(block.name || "") + String(block.argsRaw || "");
      }
      return "";
    }

    /**
     * Price one block, reusing the previous count when the block only grew.
     * Streamed blocks are append-only immutable replacements, so the common path
     * measures the appended suffix instead of the whole text.
     * @param previousBlock - the same index in the previous snapshot, if any.
     * @param previousCount - that block's count, if any.
     * @param block - current block.
     * @returns wide and narrow counts for the current block.
     */
    function countBlock(previousBlock, previousCount, block) {
      const text = blockText(block);
      if (previousBlock && previousCount && previousBlock.kind === block.kind) {
        const previousText = blockText(previousBlock);
        if (text.length >= previousText.length && text.indexOf(previousText) === 0) {
          const appended = countText(text.slice(previousText.length));
          return { wide: previousCount.wide + appended.wide, narrow: previousCount.narrow + appended.narrow };
        }
      }
      return countText(text);
    }

    /**
     * Fold the live streamed blocks into heuristic token counts, incrementally.
     * @param state - per-step cache carried in a ref.
     * @param key - `turn:step` identity of the streaming step, or null.
     * @param blocks - streamed assistant blocks.
     * @returns the cache and the current totals.
     */
    function foldStream(state, key, blocks) {
      let cache = state.current;
      if (cache.key !== key) {
        cache = { key: key, blocks: null, counts: [] };
        state.current = cache;
      }
      const list = Array.isArray(blocks) ? blocks : [];
      const counts = [];
      let wide = 0;
      let narrow = 0;
      for (let index = 0; index < list.length; index += 1) {
        const block = list[index];
        const previousBlock = cache.blocks ? cache.blocks[index] : undefined;
        const previousCount = cache.counts[index];
        const count = previousBlock === block && previousCount
          ? previousCount
          : countBlock(previousBlock, previousCount, block);
        counts[index] = count;
        wide += count.wide;
        narrow += count.narrow;
      }
      cache.blocks = list;
      cache.counts = counts;
      return {
        wide: wide,
        narrow: narrow,
        tokens: wide / WIDE_CHARS_PER_TOKEN + narrow / NARROW_CHARS_PER_TOKEN
      };
    }

    /**
     * Compact token count.
     * @param value - token count, or null.
     * @returns display text.
     */
    function formatTokens(value) {
      if (value === null || value === undefined || !Number.isFinite(value)) return "—";
      const number = Math.max(0, value);
      if (number >= 1e6) return trimZeros((number / 1e6).toFixed(2)) + "M";
      if (number >= 1e3) return trimZeros((number / 1e3).toFixed(number >= 1e4 ? 1 : 2)) + "k";
      return String(Math.round(number));
    }

    /**
     * Drop trailing fractional zeros from a fixed-point string.
     * @param text - fixed-point number text.
     * @returns trimmed text.
     */
    function trimZeros(text) {
      return text.indexOf(".") < 0 ? text : text.replace(/\.?0+$/, "");
    }

    /**
     * Tokens-per-second text, matching the host pill's precision.
     * @param value - rate, or null.
     * @returns display text.
     */
    function formatRate(value) {
      if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "—";
      if (value >= 10) return String(Math.round(value));
      return (Math.round(value * 10) / 10).toFixed(1);
    }

    /**
     * Short duration text.
     * @param ms - milliseconds, or null.
     * @returns display text.
     */
    function formatDuration(ms) {
      if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
      if (ms < 1000) return Math.round(ms) + "ms";
      const seconds = ms / 1000;
      if (seconds < 60) return (Math.round(seconds * 10) / 10).toFixed(1) + "s";
      const minutes = Math.floor(seconds / 60);
      const rest = Math.round(seconds - minutes * 60);
      return minutes + "m" + (rest < 10 ? "0" : "") + rest + "s";
    }

    /**
     * Percentage text.
     * @param value - percentage, or null.
     * @returns display text.
     */
    function formatPercent(value) {
      if (value === null || value === undefined || !Number.isFinite(value)) return "—";
      return (value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)) + "%";
    }

    /** Stable no-op stand-ins for standard hooks a partial composition may not provide. */
    function noopHook() {
      return undefined;
    }

    function noopProjection() {
      return undefined;
    }

    /**
     * Build the recent speed history as normalized bar heights.
     * @param samples - `{at, tokens}` samples of the current step, oldest first.
     * @param now - current `performance.now()`.
     * @returns normalized rates, oldest bucket first.
     */
    function buildBars(samples, now) {
      const buckets = new Array(BAR_SLOTS).fill(0);
      const origin = now - BAR_SLOTS * BAR_MS;
      let previous = null;
      for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        if (previous && sample.at > origin && sample.at > previous.at) {
          const delta = sample.tokens - previous.tokens;
          if (delta > 0) {
            const slot = Math.min(BAR_SLOTS - 1, Math.max(0, Math.ceil((sample.at - origin) / BAR_MS) - 1));
            buckets[slot] += delta / (BAR_MS / 1000);
          }
        }
        previous = sample;
      }
      let max = 1;
      for (let index = 0; index < buckets.length; index += 1) {
        if (buckets[index] > max) max = buckets[index];
      }
      return buckets.map((rate) => rate / max);
    }

    /** Small speech-bubble glyph used by the pill and the panel title. */
    function GaugeIcon() {
      return h("svg", { viewBox: "0 0 16 16", "aria-hidden": true, focusable: "false" },
        h("path", {
          d: "M2.6 12.2a5.9 5.9 0 1 1 10.8 0",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.4",
          strokeLinecap: "round"
        }),
        h("path", {
          d: "M8 12.2 10.9 7.6",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.4",
          strokeLinecap: "round"
        }),
        h("circle", { cx: "8", cy: "12.2", r: "1.25", fill: "currentColor" })
      );
    }

    /**
     * The composer-dock meter: one live pill plus its details panel.
     * @param props - standard session kit (`useChat`, `useSession`, `useProjection`) and locale seat.
     * @returns the meter element, or null before any measured step exists.
     */
    function TokenSpeedPill(props) {
      const useChat = typeof props.useChat === "function" ? props.useChat : noopHook;
      const useSession = typeof props.useSession === "function" ? props.useSession : noopHook;
      const useProjection = typeof props.useProjection === "function" ? props.useProjection : noopProjection;
      const t = typeof props.t === "function" ? props.t : (key) => key;

      const partial = useChat((snapshot) => (
        snapshot && snapshot.legacy ? snapshot.legacy.partial : null
      ));
      const running = useSession((snapshot) => Boolean(snapshot && snapshot.running));
      const usage = useProjection("tokenUsage");
      const stats = useProjection("sessionStats");
      const pressure = useProjection("contextPressure");

      const [open, setOpen] = React.useState(false);
      const [clock, setClock] = React.useState(() => Date.now());
      const [exactStep, setExactStep] = React.useState(null);
      const [exactInput, setExactInput] = React.useState(null);

      const rootRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const [position, setPosition] = React.useState(null);

      const streamRef = React.useRef({ key: null, blocks: null, counts: [] });
      const samplesRef = React.useRef([]);
      const stepRef = React.useRef({ key: null, tokens: -1, startedAt: 0, firstTokenAt: 0 });
      const runRef = React.useRef({ running: false, since: 0 });
      const statsRef = React.useRef(null);
      const usageRef = React.useRef(null);

      const stepKey = partial ? partial.turn + ":" + partial.step : null;
      const stream = foldStream(streamRef, stepKey, partial ? partial.blocks : null);

      // Track the running interval so the prefill phase has a clock.
      React.useEffect(() => {
        if (running && !runRef.current.running) runRef.current = { running: true, since: Date.now() };
        else if (!running && runRef.current.running) runRef.current = { running: false, since: runRef.current.since };
      }, [running]);

      // One sample per observed token-count change, plus a tick so a stalled
      // stream decays instead of freezing the last number on screen.
      React.useEffect(() => {
        if (stepKey === null) {
          samplesRef.current = [];
          stepRef.current = { key: null, tokens: -1, startedAt: 0, firstTokenAt: 0 };
          return undefined;
        }
        const step = stepRef.current;
        if (step.key !== stepKey) {
          samplesRef.current = [];
          stepRef.current = { key: stepKey, tokens: -1, startedAt: Date.now(), firstTokenAt: 0 };
        }
        const current = stepRef.current;
        if (current.tokens !== stream.tokens) {
          const at = performance.now();
          if (current.tokens <= 0 && stream.tokens > 0) current.firstTokenAt = Date.now();
          current.tokens = stream.tokens;
          const samples = samplesRef.current;
          samples.push({ at: at, tokens: stream.tokens });
          const keepFrom = at - SAMPLE_KEEP_MS;
          while (samples.length > 2 && samples[0].at < keepFrom) samples.shift();
        }
        return undefined;
      }, [stepKey, stream.tokens]);

      React.useEffect(() => {
        if (!running) return undefined;
        const id = setInterval(() => setClock(Date.now()), TICK_MS);
        return () => clearInterval(id);
      }, [running]);

      // Exact per-step figures: the delta between consecutive whole-log folds.
      React.useEffect(() => {
        if (!stats) return;
        const previous = statsRef.current;
        statsRef.current = stats;
        if (!previous || stats.steps <= previous.steps) return;
        setExactStep({
          steps: stats.steps - previous.steps,
          decodeTokens: Math.max(0, stats.decodeTokens - previous.decodeTokens),
          decodeMs: Math.max(0, stats.decodeMs - previous.decodeMs),
          ttftMs: Math.max(0, stats.ttftMs - previous.ttftMs),
          ttftSteps: Math.max(0, stats.ttftSteps - previous.ttftSteps),
          llmMs: Math.max(0, stats.llmMs - previous.llmMs),
          toolMs: Math.max(0, stats.toolMs - previous.toolMs)
        });
      }, [stats]);

      // Exact per-request buckets: the delta between consecutive usage totals.
      React.useEffect(() => {
        if (!usage) return;
        const previous = usageRef.current;
        usageRef.current = usage;
        if (!previous) return;
        const delta = {
          uncached: Math.max(0, usage.uncachedInputTokens - previous.uncachedInputTokens),
          cacheRead: Math.max(0, usage.cacheReadTokens - previous.cacheReadTokens),
          cacheWrite: Math.max(0, usage.cacheWriteTokens - previous.cacheWriteTokens),
          output: Math.max(0, usage.outputTokens - previous.outputTokens)
        };
        if (delta.uncached + delta.cacheRead + delta.cacheWrite + delta.output > 0) setExactInput(delta);
      }, [usage]);

      // Anchor the panel above the pill, clamped to the viewport.
      React.useLayoutEffect(() => {
        if (!open) {
          setPosition(null);
          return undefined;
        }
        const compute = () => {
          const node = rootRef.current;
          if (!node) return;
          const rect = node.getBoundingClientRect();
          const width = Math.min(320, window.innerWidth - 24);
          const left = Math.min(
            Math.max(12, rect.left + rect.width / 2 - width / 2),
            Math.max(12, window.innerWidth - width - 12)
          );
          setPosition({
            left: Math.round(left),
            bottom: Math.round(window.innerHeight - rect.top + 8),
            width: Math.round(width)
          });
        };
        compute();
        window.addEventListener("resize", compute);
        return () => window.removeEventListener("resize", compute);
      }, [open]);

      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const target = event.target;
          if (rootRef.current && rootRef.current.contains(target)) return;
          if (panelRef.current && panelRef.current.contains(target)) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
          document.removeEventListener("pointerdown", onPointerDown, true);
          document.removeEventListener("keydown", onKeyDown);
        };
      }, [open]);

      const nowPerf = performance.now();
      const samples = samplesRef.current;
      let liveRate = null;
      let liveAverage = null;
      if (stepKey !== null && samples.length >= 2) {
        const first = samples[0];
        const elapsed = (nowPerf - first.at) / 1000;
        if (elapsed > 0.2 && stream.tokens > 0) liveAverage = stream.tokens / elapsed;
        const cutoff = nowPerf - SPEED_WINDOW_MS;
        let windowStart = first;
        for (let index = 0; index < samples.length; index += 1) {
          if (samples[index].at >= cutoff) {
            windowStart = samples[index];
            break;
          }
        }
        const span = (nowPerf - windowStart.at) / 1000;
        const gained = stream.tokens - windowStart.tokens;
        if (span >= 0.25 && gained > 0) liveRate = gained / span;
      }

      const hasOutput = stepKey !== null && stream.tokens > 0;
      const phase = hasOutput ? "streaming" : running ? "waiting" : exactStep ? "settled" : "idle";
      if (phase === "idle") return null;

      const step = stepRef.current;
      const runSince = runRef.current.since;
      const exactRate = exactStep && exactStep.decodeMs > 0
        ? exactStep.decodeTokens / (exactStep.decodeMs / 1000)
        : null;
      const liveTtft = hasOutput && runSince > 0 && step.firstTokenAt > 0
        ? step.firstTokenAt - runSince
        : null;

      const exactInputTotal = exactInput
        ? exactInput.uncached + exactInput.cacheRead + exactInput.cacheWrite
        : null;
      const pressureTokens = pressure && Number.isFinite(pressure.pressureTokens) ? pressure.pressureTokens : null;
      const projectedTokens = pressure && Number.isFinite(pressure.projectedTokens) ? pressure.projectedTokens : null;
      const contextWindow = pressure && Number.isFinite(pressure.contextWindow) ? pressure.contextWindow : null;
      // The delivered prompt of the last settled request is exact; while a step
      // runs, the projection answers for the request in flight (or the next one)
      // because the provider reports a request's prompt only when its stream ends.
      const deliveredInput = exactInputTotal === null ? pressureTokens : exactInputTotal;
      const inputNow = running
        ? (projectedTokens === null ? deliveredInput : projectedTokens)
        : (deliveredInput === null ? projectedTokens : deliveredInput);
      const outputTokens = phase === "streaming"
        ? stream.tokens
        : (exactInput ? exactInput.output : (exactStep ? exactStep.decodeTokens : null));
      const rate = phase === "streaming" ? liveRate : exactRate;

      const inputBuckets = exactInput;
      const cacheHit = inputBuckets && deliveredInput
        ? (inputBuckets.cacheRead / deliveredInput) * 100
        : null;

      const bars = phase === "streaming" ? buildBars(samples, nowPerf) : [];
      const sessionRate = stats && stats.decodeMs > 0 ? stats.decodeTokens / (stats.decodeMs / 1000) : null;
      const elapsedMs = phase === "streaming" && step.startedAt > 0
        ? clock - step.startedAt
        : phase === "waiting" && runSince > 0
          ? clock - runSince
          : exactStep
            ? exactStep.decodeMs + exactStep.ttftMs
            : null;

      const rateText = formatRate(rate);
      const inputText = formatTokens(inputNow);
      const outputText = formatTokens(outputTokens);
      const ariaLabel = t("pill.aria", { tps: rateText, input: inputText, output: outputText });

      const rows = (entries) => entries
        .filter((entry) => entry && entry[1] !== null && entry[1] !== undefined && entry[1] !== "")
        .map((entry) => h(React.Fragment, { key: entry[0] },
          h("dt", null, t(entry[0])),
          h("dd", null, entry[1])
        ));

      const meter = contextWindow && inputNow
        ? h("div", { className: "dtsMeter", "aria-hidden": true },
          h("div", {
            className: "dtsMeterFill",
            style: { width: Math.min(100, Math.max(0, (inputNow / contextWindow) * 100)).toFixed(1) + "%" }
          }))
        : null;

      const panel = open && position
        ? ReactDOM.createPortal(
          h("div", {
            ref: panelRef,
            className: "dtsPanel",
            role: "dialog",
            "aria-label": t("dialog.title"),
            style: { left: position.left + "px", bottom: position.bottom + "px", width: position.width + "px" }
          },
            h("div", { className: "dtsTitle" },
              h("span", { className: "dtsTitleLabel" }, h(GaugeIcon), t("dialog.title")),
              h("span", { className: "dtsTitleValue" }, t("phase." + phase))
            ),
            h("div", { className: "dtsRule" }),
            h("div", { className: "dtsSection" }, t("section.input")),
            h("dl", { className: "dtsDetails" }, rows([
              ["row.inputTotal", inputNow === null ? t("empty") : inputText + " " + t("unit.tokens")],
              ["row.uncached", inputBuckets ? formatTokens(inputBuckets.uncached) : null],
              ["row.cacheRead", inputBuckets ? formatTokens(inputBuckets.cacheRead) : null],
              ["row.cacheWrite", inputBuckets ? formatTokens(inputBuckets.cacheWrite) : null],
              ["row.cacheHit", cacheHit === null ? null : formatPercent(cacheHit)],
              ["row.context", contextWindow && inputNow
                ? inputText + " / " + formatTokens(contextWindow) + " (" + formatPercent((inputNow / contextWindow) * 100) + ")"
                : null]
            ])),
            meter,
            h("div", { className: "dtsSection" }, t("section.output")),
            h("dl", { className: "dtsDetails" }, rows([
              ["row.output", outputTokens === null
                ? t("empty")
                : t(phase === "streaming" ? "value.estimate" : "value.exact", { value: outputText + " " + t("unit.tokens") })],
              ["row.speedLive", phase === "streaming"
                ? (rateText === "—" ? t("value.waiting") : rateText + " " + t("unit.tps"))
                : null],
              ["row.speedAvg", phase === "streaming"
                ? (liveAverage === null ? null : formatRate(liveAverage) + " " + t("unit.tps"))
                : (exactRate === null ? null : formatRate(exactRate) + " " + t("unit.tps"))],
              ["row.ttft", phase === "waiting"
                ? t("value.waiting")
                : formatDuration(phase === "streaming" ? liveTtft : (exactStep ? exactStep.ttftMs : null))],
              ["row.decode", exactStep && phase !== "streaming" ? formatDuration(exactStep.decodeMs) : null],
              ["row.elapsed", phase === "streaming" ? formatDuration(elapsedMs) : null],
              ["row.llm", exactStep && phase !== "streaming" ? formatDuration(exactStep.llmMs) : null],
              ["row.tool", exactStep && exactStep.toolMs > 0 ? formatDuration(exactStep.toolMs) : null]
            ])),
            bars.length > 0
              ? h("div", { className: "dtsBars", "aria-hidden": true }, bars.map((value, index) => h("span", {
                key: index,
                className: "dtsBar",
                "data-empty": value <= 0 ? "true" : "false",
                style: { height: Math.max(1, Math.round(value * 28)) + "px" }
              })))
              : null,
            h("div", { className: "dtsSection" }, t("section.session")),
            h("dl", { className: "dtsDetails" }, rows([
              ["row.sessionIn", usage ? formatTokens(usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens) : null],
              ["row.sessionOut", usage ? formatTokens(usage.outputTokens) : null],
              ["row.sessionSpeed", sessionRate === null ? null : formatRate(sessionRate) + " " + t("unit.tps")],
              ["row.turns", stats ? String(stats.turns) + " / " + String(stats.steps) : null]
            ])),
            h("div", { className: "dtsNote" }, t(phase === "settled" ? "note.settled" : "note.live"))
          ),
          document.body
        )
        : null;

      return h("div", { className: "dtsRoot", ref: rootRef, "data-token-speed": "pill" },
        h("button", {
          type: "button",
          className: "dtsPill",
          "aria-haspopup": "dialog",
          "aria-expanded": open,
          "aria-label": ariaLabel,
          title: t("pill.title"),
          onClick: () => setOpen((value) => !value)
        },
          h("span", {
            className: "dtsDot",
            "data-live": phase === "streaming" ? "pulse" : phase === "waiting" ? "true" : "false"
          }),
          h("span", { className: "dtsRate" }, rateText, " ", h("span", { className: "dtsMuted" }, t("unit.tps"))),
          h("span", { className: "dtsSep", "aria-hidden": true }, "·"),
          h("span", { className: "dtsStat", title: t("tip.input") },
            h("span", { className: "dtsArrow", "aria-hidden": true }, "\u2191"),
            inputText
          ),
          h("span", { className: "dtsSep", "aria-hidden": true }, "·"),
          h("span", { className: "dtsStat", title: t("tip.output") },
            h("span", { className: "dtsArrow", "aria-hidden": true }, "\u2193"),
            outputText
          )
        ),
        panel
      );
    }

    /**
     * Mount the meter: one stylesheet, one dictionary, one dock entry.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        const tag = document.createElement("style");
        tag.dataset.plugin = NS;
        tag.dataset.pluginCss = CSS_TAG;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }, "token-speed: stylesheet");
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), "token-speed: dictionaries");
      ctx.slots.inject(SLOT, () => ctx.slots.register({
        name: SLOT,
        id: "token-speed",
        order: 6,
        locale: NS
      }, TokenSpeedPill));
    }

    return {
      inject: ["slots", "locale"],
      apply: apply
    };
  }
});

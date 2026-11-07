export const LEGAL_CSS = `
:root {
  --cd-paper: #ffffff;
  --cd-ink: #1b1b1f;
  --cd-ink-soft: #55565e;
  --cd-rule: #3a3b42;
  --cd-rule-soft: #d4d5da;
  --cd-head-bg: #f2f3f5;
  --cd-chg-bg: transparent;
  --cd-missing: #c02626;
  --cd-missing-bg: #fde8e8;
  --pele-bg: var(--cd-paper);
  --pele-fg: var(--cd-ink);
  --pele-muted: var(--cd-ink-soft);
  --pele-line: var(--cd-ink-soft);
  --pele-surface: #f6f7f9;
  --pele-surface-alt: #eceef2;
  --pele-border: #c9cbd2;
  --pele-accent: #3446c9;
  --cd-ins: #1d4ed8;
  --cd-del: #c02626;
}
.cd-doc, .cd-compare, .cd-inline {
  /* 書式はリポジトリの設定で変えられる（--cd-font など） */
  font-family: var(--cd-font, "Yu Mincho", "YuMincho", "MS Mincho", "Hiragino Mincho ProN", serif);
  font-size: var(--cd-size, 10.5pt);
  line-height: var(--cd-line, 1.8);
  color: var(--cd-ink);
}
.cd-doc p, .cd-compare p, .cd-inline p { margin: 0; }
.cd-title { font-size: 1.5em; text-align: center; font-weight: normal; margin: 0 0 1.5em; letter-spacing: 0.2em; }
.cd-preamble { margin-bottom: 1em; text-indent: 1em; }
/* 章・附則の見出しは中央 */
.cd-chapter-title { font-size: 1em; font-weight: normal; margin: 1.4em 0 0.6em; text-align: center; letter-spacing: 0.1em; }
.cd-supplement > .cd-chapter-title { letter-spacing: 0.5em; }
.cd-article { margin-bottom: 0.2em; }
.cd-article + .cd-article { margin-top: 0.6em; }
.cd-art-title { padding-left: 1em; }
.cd-art-head { font-weight: bold; }
/* ぶら下げインデント：2行目以降を番号の幅だけ下げる */
.cd-para { padding-left: 1em; text-indent: -1em; }
.cd-item.cd-lv1 { padding-left: 2em; text-indent: -1em; }
.cd-item.cd-lv2 { padding-left: 3em; text-indent: -1em; }
.cd-item.cd-lv3 { padding-left: 4em; text-indent: -1em; }
.cd-item.cd-lv4 { padding-left: 5em; text-indent: -1em; }
/* 下位の階層ほど下げる（条 → 項 → 号 → 細分）。条番号のある最初の行だけは条の位置 */
.cd-indent-nested .cd-article .cd-para:not(.cd-first) { padding-left: 2em; }
.cd-indent-nested .cd-article .cd-item.cd-lv1 { padding-left: 3em; }
.cd-indent-nested .cd-article .cd-item.cd-lv2 { padding-left: 4em; }
.cd-indent-nested .cd-article .cd-item.cd-lv3 { padding-left: 5em; }
.cd-indent-nested .cd-article .cd-item.cd-lv4 { padding-left: 6em; }
.cd-indent-nested .cd-article .cd-attach.cd-lv1 { padding-left: 2em; }
.cd-indent-nested .cd-article .cd-attach.cd-lv2 { padding-left: 3em; }
.cd-indent-nested .cd-article .cd-attach.cd-lv3 { padding-left: 4em; }
.cd-indent-nested .cd-article .cd-attach.cd-lv4 { padding-left: 5em; }
.cd-closing { margin-top: 2em; }
.cd-missing { color: var(--cd-missing); background: var(--cd-missing-bg); }

/* 項・号の下の表と図。字下げを本文にそろえる */
.cd-attach { margin: 0.4em 0 0.6em; }
.cd-attach.cd-lv1 { padding-left: 1em; }
.cd-attach.cd-lv2 { padding-left: 2em; }
.cd-attach.cd-lv3 { padding-left: 3em; }
.cd-attach.cd-lv4 { padding-left: 4em; }
.cd-block table, .cd-appendix table { border-collapse: collapse; margin: 0.3em 0; }
.cd-block th, .cd-block td, .cd-appendix th, .cd-appendix td {
  border: 1px solid var(--cd-rule); padding: 0.15em 0.7em; text-indent: 0; text-align: left;
}
.cd-block th, .cd-appendix th { background: var(--cd-head-bg); font-weight: normal; }
.cd-figure { margin: 0.4em 0; text-indent: 0; }
.cd-figure svg { max-width: 100%; height: auto; }
.cd-figure-error { color: var(--cd-missing); font-size: 9pt; }
.cd-figure-error pre { white-space: pre-wrap; color: var(--cd-ink-soft); margin: 0.3em 0 0; }
.cd-appendix { margin-top: 2em; break-before: page; }
.cd-appendix-title { font-size: 1em; font-weight: normal; margin: 0 0 0.6em; }
.cd-appendix p { margin: 0.3em 0; }

.cd-compare { width: 100%; border-collapse: collapse; table-layout: fixed; }
.cd-compare caption { font-size: 12pt; margin-bottom: 0.6em; }
.cd-compare th, .cd-compare td { border: 1px solid var(--cd-rule); padding: 0.3em 0.6em; vertical-align: top; }
.cd-compare th { font-weight: normal; background: var(--cd-head-bg); }
.cd-compare td p { padding-left: 1em; text-indent: -1em; }
.cd-compare .cd-chg { text-decoration: underline; text-underline-offset: 0.2em; background: var(--cd-chg-bg); }
.cd-compare .cd-omit td { text-align: center; }
.cd-inline p { padding-left: 1em; text-indent: -1em; }
.cd-inline-row + .cd-inline-row { margin-top: 0.6em; }
.cd-inline .cd-row-chapter p:first-child { text-align: center; padding-left: 0; text-indent: 0; }
.cd-inline .cd-omit { text-align: center; color: var(--cd-ink-soft); }
.cd-ins { color: var(--cd-ins); text-decoration: underline; text-underline-offset: 0.2em; }
.cd-del { color: var(--cd-del); text-decoration: line-through; }

td[rowspan], th[rowspan] { vertical-align: middle; }
.cd-fixed { table-layout: fixed; width: 100%; }
.cd-fixed td, .cd-fixed th { overflow-wrap: anywhere; }

@media screen {
  .cd-doc .cd-break { position: relative; margin-top: 2.6em; }
  .cd-doc .cd-break::before { content: ''; position: absolute; left: 0; right: 0; top: -1.3em; border-top: 1px dashed var(--cd-ink-soft); }
  .cd-doc .cd-break::after { content: '改ページ'; position: absolute; left: 50%; top: -1.3em; transform: translate(-50%, -50%); padding: 0 8px; background: var(--cd-paper); font-size: 10px; line-height: 1; color: var(--cd-ink-soft); text-indent: 0; }
}

@media print {
  .cd-article { break-inside: avoid; }
  .cd-compare tr { break-inside: avoid; }
}
`

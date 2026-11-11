/**
 * Tests for what the match controls and the status line SAY in every state of a match
 * (ready, running, paused, stopped, finished). The two components are drawn to plain HTML text
 * here - no browser needed - and the text is checked.
 *
 * What these tests protect: from every state there is one obvious way back to a fresh field
 * ("Reset field"), and after a stop or the end of a match the screen says what happened and what
 * to press next.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScoreReport } from '../core/types';
import { ControlBar, type ControlBarProps } from './ControlBar';
import { StatusLine, type StatusLineProps } from './ScoreSheet';
import type { RunState } from './useSimulation';

const STATES: RunState[] = ['ready', 'running', 'paused', 'stopped', 'finished'];

const SCORE: ScoreReport = {
  lines: [
    { id: 'bucket:red', label: 'Red bucket to building A', points: 20, max: 20, ok: true, detail: 'delivered' },
    { id: 'person:red', label: 'Red person onto rescue tower RR', points: 0, max: 20, ok: false, detail: 'still waiting' },
    { id: 'bonus', label: 'Bonus', points: 0, max: 20, ok: false, detail: '' },
    { id: 'restarts', label: 'Restarts', points: 0, max: 0, ok: true, detail: 'no restarts' },
  ],
  total: 20,
  max: 180,
  complete: false,
};

const nothing = (): void => undefined;

function controlBar(runState: RunState): string {
  const props: ControlBarProps = {
    runState,
    canStart: true,
    timeLeft: 170,
    score: SCORE,
    restartPenalty: 5,
    speed: 1,
    onSpeed: nothing,
    onStart: nothing,
    onStop: nothing,
    onPause: nothing,
    onResume: nothing,
    onRestart: nothing,
    onFinished: nothing,
    onReset: nothing,
  };
  return renderToStaticMarkup(createElement(ControlBar, props));
}

function statusLine(runState: RunState, extra: Partial<StatusLineProps> = {}): string {
  const props: StatusLineProps = {
    runState,
    finishReason: runState === 'finished' ? 'program-ended' : null,
    score: SCORE,
    time: 10,
    readyHint: 'Ready. Drag the robot inside the Fire Station.',
    placingProblem: null,
    onShowSheet: nothing,
    ...extra,
  };
  return renderToStaticMarkup(createElement(StatusLine, props));
}

/** The opening tag of the button whose text or aria-label contains `name`. */
function buttonTag(html: string, name: string): string {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const found = buttons.find((b) => b.includes(`aria-label="${name}"`) || b.replace(/<[^>]+>/g, '').trim().startsWith(name));
  assert.ok(found, `there is a "${name}" button`);
  return found.slice(0, found.indexOf('>') + 1);
}

const isDisabled = (tag: string): boolean => /\sdisabled(=""|\s|>)/.test(tag);
/** What a reader sees: the tags taken out, quotation marks back as typed. */
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

test('"Reset field" works in every state except the fresh field itself', () => {
  for (const state of STATES) {
    const reset = buttonTag(controlBar(state), 'Reset field');
    assert.equal(isDisabled(reset), state === 'ready', `Reset field in state "${state}"`);
  }
});

test('"Reset field" stands out once the match was stopped or is over', () => {
  for (const state of STATES) {
    const reset = buttonTag(controlBar(state), 'Reset field');
    const standsOut = reset.includes('bg-sky-50');
    assert.equal(standsOut, state === 'stopped' || state === 'finished', `Reset field in state "${state}"`);
    // one look at a time: the tinted button is not white as well
    if (standsOut) assert.ok(!reset.includes('bg-white'));
  }
});

test('Start is offered whenever no match is on; Stop, Restart and Finished only during a match', () => {
  for (const state of STATES) {
    const html = controlBar(state);
    const matchOn = state === 'running' || state === 'paused';
    assert.equal(isDisabled(buttonTag(html, 'Start')), matchOn, `Start in state "${state}"`);
    for (const name of ['Stop', 'Restart', 'Finished']) {
      assert.equal(isDisabled(buttonTag(html, name)), !matchOn, `${name} in state "${state}"`);
    }
  }
});

test('after a stop the status line says who stopped, that there is no final score, and what to press', () => {
  const line = text(statusLine('stopped'));
  assert.match(line, /Stopped by you at 0:10\.0/);
  assert.match(line, /no final score \(so far 20 \/ 180\)/);
  assert.match(line, /Start tries again/);
  assert.match(line, /Reset puts the field back/);
  assert.match(line, /Score sheet/, 'the score sheet is one click away');
});

test('after the end of a match the status line gives the reason, the time and the final score', () => {
  assert.match(text(statusLine('finished')), /Match over\. The program ended at 0:10\.0\. Final score: 20 \/ 180/);
  assert.match(text(statusLine('finished', { finishReason: 'time', time: 180 })), /Time is up at 3:00\.0/);
  assert.match(text(statusLine('finished', { finishReason: 'declared', restarts: 2, restartPenalty: 5 })), /You declared "Finished".*\(2 restarts: -10 points\)/);
});

test('while a match is on the status line says so; before it, how to get ready or what is wrong', () => {
  assert.match(text(statusLine('running')), /Match running\. 1 of 2 missions complete\./);
  assert.match(text(statusLine('paused')), /Paused at 0:10\.0/);
  assert.match(text(statusLine('ready')), /Ready\. Drag the robot/);
  assert.match(text(statusLine('ready', { placingProblem: 'Not allowed: outside.' })), /Not allowed: outside\./);
});

test('the status line is never squeezed below its text (it sits in a column that can run out of height)', () => {
  for (const state of STATES) {
    const html = statusLine(state);
    const box = html.slice(0, html.indexOf('>') + 1);
    assert.ok(box.includes('shrink-0'), `state "${state}"`);
  }
});
